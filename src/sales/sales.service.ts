import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import type { CreateSaleDto } from './dto/create-sale.dto';
import { ReceiptMapper, type SaleReceipt } from './receipt/receipt.mapper';

// Base-currency amounts are rounded once, explicitly, at 4dp (the NUMERIC(14,4) scale).
const MONEY_SCALE = 4;
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

// A line resolved in memory before it hits the transaction. Money is Decimal (never
// number); *_base values are computed at write time from the snapshotted FX rate.
interface ComputedLine {
  productId: string;
  barcode: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  unitPriceBase: Prisma.Decimal;
  lineTotalBase: Prisma.Decimal;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  async create(dto: CreateSaleDto): Promise<SaleReceipt> {
    // 1. Resolve store, cashier, currency. Fail fast.
    const store = await this.prisma.store.findUnique({
      where: { code: dto.storeCode },
    });
    if (!store) {
      throw new NotFoundException('STORE_NOT_FOUND');
    }

    const cashier = await this.prisma.user.findUnique({
      where: { id: dto.cashierId },
    });
    if (!cashier) {
      throw new NotFoundException('CASHIER_NOT_FOUND');
    }

    // Slice 2 treats an unsupported currency as 404; Slice 4 maps it to 422.
    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.currencyCode },
    });
    if (!currency || !currency.isActive) {
      throw new NotFoundException('UNSUPPORTED_CURRENCY');
    }

    // 2. Snapshot the FX rate applied to this sale. A USD sale is not a special case:
    //    getRate(USD, USD) returns 1.0 via the identical path.
    const baseCurrency = this.fx.getBaseCurrency();
    const { rate, source } = this.fx.getRate(currency.code, baseCurrency);

    // 3. Batch-look-up every product in ONE query — no await in a loop (WAN round-trips).
    const barcodes = dto.lineItems.map((item) => item.barcode);
    const products = await this.prisma.product.findMany({
      where: { barcode: { in: barcodes } },
    });
    const productByBarcode = new Map(
      products.map((product) => [product.barcode, product]),
    );

    // 4. Compute each line. Slice 2 is still happy-path: an unknown barcode throws 404.
    //    Slice 3 replaces this with the log-and-continue behaviour the brief requires.
    const lines: ComputedLine[] = dto.lineItems.map((item) => {
      const product = productByBarcode.get(item.barcode);
      if (!product) {
        throw new NotFoundException('UNKNOWN_BARCODE');
      }
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const lineTotal = unitPrice.mul(item.quantity);
      return {
        productId: product.id,
        barcode: item.barcode,
        description: product.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        // unit_price_base is informational — derive it, don't build totals on it.
        unitPriceBase: unitPrice
          .mul(rate)
          .toDecimalPlaces(MONEY_SCALE, ROUNDING),
        // line_total_base = lineTotal x rate (NOT unitPriceBase x quantity: that would
        // round the unit price first and let the error scale with quantity).
        lineTotalBase: lineTotal
          .mul(rate)
          .toDecimalPlaces(MONEY_SCALE, ROUNDING),
      };
    });

    // 5. Totals. subtotal/total in transaction currency; totalBase is the SUM of the
    //    per-line base amounts (NOT total x rate) so the receipt reconciles to its lines.
    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );
    const total = subtotal;
    const totalBase = lines.reduce(
      (sum, line) => sum.add(line.lineTotalBase),
      new Prisma.Decimal(0),
    );

    // 6. One atomic transaction: header + all line items. All-or-nothing.
    const transaction = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.transaction.create({
          data: {
            storeId: store.id,
            cashierId: cashier.id,
            externalRef: dto.externalRef ?? null,
            currencyCode: currency.code,
            baseCurrencyCode: baseCurrency,
            fxRate: rate,
            fxRateSource: source,
            subtotal,
            total,
            totalBase,
          },
        });

        await tx.transactionLineItem.createMany({
          data: lines.map((line) => ({
            transactionId: created.id,
            productId: line.productId,
            rawBarcode: line.barcode,
            isUnmatched: false,
            descriptionSnapshot: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            unitPriceBase: line.unitPriceBase,
            lineTotalBase: line.lineTotalBase,
          })),
        });

        return created;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );

    // 7. Shape the receipt. No Prisma model leaves the service.
    return ReceiptMapper.toReceipt({
      transactionId: transaction.id,
      occurredAt: transaction.occurredAt,
      store: { code: store.code, name: store.name },
      cashier: { id: cashier.id, fullName: cashier.fullName },
      currency: {
        code: currency.code,
        baseCode: baseCurrency,
        fxRate: rate,
        fxRateSource: source,
      },
      lines: lines.map((line) => ({
        barcode: line.barcode,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      totals: { subtotal, total, totalBase },
    });
  }
}
