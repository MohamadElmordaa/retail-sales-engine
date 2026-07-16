import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import {
  cashierNotFound,
  duplicateSale,
  emptyCart,
  storeNotFound,
  unsupportedCurrency,
} from '../common/errors';
import type { CreateSaleDto } from './dto/create-sale.dto';
import { ReceiptMapper, type SaleReceipt } from './receipt/receipt.mapper';

// Base-currency amounts are rounded once, explicitly, at 4dp (the NUMERIC(14,4) scale).
const MONEY_SCALE = 4;
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

// A line resolved in memory before it hits the transaction. Money is Decimal (never
// number); *_base values are computed at write time from the snapshotted FX rate. `id` is
// assigned here so the unmatched-scan log can reference the exact line item it came from.
interface ComputedLine {
  id: string;
  productId: string | null;
  matched: boolean;
  barcode: string;
  description: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  unitPriceBase: Prisma.Decimal;
  lineTotalBase: Prisma.Decimal;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  async create(dto: CreateSaleDto): Promise<SaleReceipt> {
    // 0. Empty cart is its own error, checked before any DB round-trip.
    if (dto.lineItems.length === 0) {
      throw emptyCart();
    }

    // 1. Resolve store, cashier, currency. Fail fast.
    const store = await this.prisma.store.findUnique({
      where: { code: dto.storeCode },
    });
    if (!store) {
      throw storeNotFound(dto.storeCode);
    }

    const cashier = await this.prisma.user.findUnique({
      where: { id: dto.cashierId },
    });
    if (!cashier) {
      throw cashierNotFound(dto.cashierId);
    }

    // A currency we never claimed to support -> 422 (distinct from Slice 2's internal
    // unknown-rate-pair 500, which is a currency we claimed to support then couldn't price).
    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.currencyCode },
    });
    if (!currency || !currency.isActive) {
      throw unsupportedCurrency(dto.currencyCode);
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

    // 4. Compute each line. An unknown barcode is NOT rejected — it is logged and the sale
    //    completes. FX still applies (the cashier typed a price): unmatched lines convert and
    //    count toward the totals exactly like matched ones. An unknown product is not free.
    const lines: ComputedLine[] = dto.lineItems.map((item) => {
      const product = productByBarcode.get(item.barcode) ?? null;
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const lineTotal = unitPrice.mul(item.quantity);
      return {
        id: randomUUID(),
        productId: product?.id ?? null,
        matched: product !== null,
        barcode: item.barcode,
        description: product?.name ?? null,
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

    const unmatched = lines.filter((line) => !line.matched);
    for (const line of unmatched) {
      this.logger.warn(
        `Unknown barcode '${line.barcode}' at store ${store.code} — logged, sale continues`,
      );
    }

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

    // 6. One atomic transaction: header + all line items + any unmatched-scan rows. The scan
    //    log lives INSIDE the transaction — if the sale rolls back, the log rolls back with it.
    const transaction = await this.runSale(async (tx) => {
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
          id: line.id,
          transactionId: created.id,
          productId: line.productId,
          rawBarcode: line.barcode,
          isUnmatched: !line.matched,
          descriptionSnapshot: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          unitPriceBase: line.unitPriceBase,
          lineTotalBase: line.lineTotalBase,
        })),
      });

      if (unmatched.length > 0) {
        await tx.unmatchedBarcodeScan.createMany({
          data: unmatched.map((line) => ({
            rawBarcode: line.barcode,
            storeId: store.id,
            transactionId: created.id,
            lineItemId: line.id,
          })),
        });
      }

      return created;
    });

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
        matched: line.matched,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      totals: { subtotal, total, totalBase },
    });
  }

  // Runs the atomic write and maps a duplicate (storeId, externalRef) -> DUPLICATE_SALE (409).
  // The raw Prisma error is logged, never surfaced; anything else re-throws to the filter.
  private async runSale<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        timeout: 15_000,
        maxWait: 5_000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(`Duplicate sale rejected (P2002): ${error.message}`);
        throw duplicateSale();
      }
      throw error;
    }
  }
}
