import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSaleDto } from './dto/create-sale.dto';
import { ReceiptMapper, type SaleReceipt } from './receipt/receipt.mapper';

// Slice 1: identity FX. Every row written here carries this source tag so a real
// FxService (Slice 2) can grep and backfill them. fxRate = 1, base = txn currency.
const IDENTITY_FX_SOURCE = 'IDENTITY_V0';

// A line resolved in memory before it hits the transaction — barcode matched to a
// product plus the money computed via Decimal (never number).
interface ComputedLine {
  productId: string;
  barcode: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

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

    // Slice 1 treats an unsupported currency as 404; Slice 4 maps it to 422.
    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.currencyCode },
    });
    if (!currency || !currency.isActive) {
      throw new NotFoundException('UNSUPPORTED_CURRENCY');
    }

    // 2. Batch-look-up every product in ONE query — no await in a loop (WAN round-trips).
    const barcodes = dto.lineItems.map((item) => item.barcode);
    const products = await this.prisma.product.findMany({
      where: { barcode: { in: barcodes } },
    });
    const productByBarcode = new Map(
      products.map((product) => [product.barcode, product]),
    );

    // 3. Compute each line. Slice 1 is happy-path: an unknown barcode throws 404.
    //    Slice 3 replaces this with the log-and-continue behaviour the brief requires.
    const lines: ComputedLine[] = dto.lineItems.map((item) => {
      const product = productByBarcode.get(item.barcode);
      if (!product) {
        throw new NotFoundException('UNKNOWN_BARCODE');
      }
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      return {
        productId: product.id,
        barcode: item.barcode,
        description: product.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice.mul(item.quantity),
      };
    });

    // 4. Totals. All Decimal arithmetic; identity FX means base == transaction currency.
    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );
    const total = subtotal;
    const fxRate = new Prisma.Decimal(1);
    const totalBase = total; // total.mul(fxRate) — identity this slice.

    // 5. One atomic transaction: header + all line items. All-or-nothing.
    const transaction = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.transaction.create({
          data: {
            storeId: store.id,
            cashierId: cashier.id,
            externalRef: dto.externalRef ?? null,
            currencyCode: currency.code,
            baseCurrencyCode: currency.code,
            fxRate,
            fxRateSource: IDENTITY_FX_SOURCE,
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
            unitPriceBase: line.unitPrice, // identity FX
            lineTotalBase: line.lineTotal, // identity FX
          })),
        });

        return created;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );

    // 6. Shape the receipt. No Prisma model leaves the service.
    return ReceiptMapper.toReceipt({
      transactionId: transaction.id,
      occurredAt: transaction.occurredAt,
      store: { code: store.code, name: store.name },
      cashier: { id: cashier.id, fullName: cashier.fullName },
      currency: {
        code: currency.code,
        baseCode: currency.code,
        fxRate,
        fxRateSource: IDENTITY_FX_SOURCE,
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
