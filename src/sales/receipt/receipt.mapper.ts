import { Prisma } from '../../generated/prisma/client';
import { toMoneyString, toRateString } from '../../common/decimal';

// The receipt shape returned to the POS client (project-overview.md §7).
// Slice 1 has no warnings[] — that arrives with the unknown-barcode path in Slice 3.
export interface ReceiptLine {
  barcode: string;
  description: string | null;
  matched: boolean;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface SaleReceipt {
  transactionId: string;
  store: { code: string; name: string };
  cashier: { id: string; fullName: string };
  occurredAt: string;
  currency: {
    code: string;
    baseCode: string;
    fxRate: string;
    fxRateSource: string;
  };
  lines: ReceiptLine[];
  totals: { subtotal: string; total: string; totalBase: string };
}

// Everything the mapper needs, as primitives/Decimals — no Prisma model crosses
// this boundary, so DB internals never leak into the HTTP response.
export interface ReceiptInput {
  transactionId: string;
  occurredAt: Date;
  store: { code: string; name: string };
  cashier: { id: string; fullName: string };
  currency: {
    code: string;
    baseCode: string;
    fxRate: Prisma.Decimal;
    fxRateSource: string;
  };
  lines: Array<{
    barcode: string;
    description: string | null;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
  totals: {
    subtotal: Prisma.Decimal;
    total: Prisma.Decimal;
    totalBase: Prisma.Decimal;
  };
}

export class ReceiptMapper {
  static toReceipt(input: ReceiptInput): SaleReceipt {
    return {
      transactionId: input.transactionId,
      store: input.store,
      cashier: input.cashier,
      occurredAt: input.occurredAt.toISOString(),
      currency: {
        code: input.currency.code,
        baseCode: input.currency.baseCode,
        fxRate: toRateString(input.currency.fxRate),
        fxRateSource: input.currency.fxRateSource,
      },
      lines: input.lines.map((line) => ({
        barcode: line.barcode,
        description: line.description,
        matched: true, // Slice 1 is happy-path only; every line is matched.
        quantity: line.quantity,
        unitPrice: toMoneyString(line.unitPrice),
        lineTotal: toMoneyString(line.lineTotal),
      })),
      totals: {
        subtotal: toMoneyString(input.totals.subtotal),
        total: toMoneyString(input.totals.total),
        totalBase: toMoneyString(input.totals.totalBase),
      },
    };
  }
}
