import { Prisma } from '../../generated/prisma/client';
import { toMoneyString, toRateString } from '../../common/decimal';

// The receipt shape returned to the POS client (project-overview.md §7).
// Unmatched lines (Slice 3) carry matched:false + flag:"UNKNOWN_BARCODE" and surface a
// corresponding warnings[] entry; the sale still completes (201).
export interface ReceiptLine {
  barcode: string;
  description: string | null;
  matched: boolean;
  flag?: 'UNKNOWN_BARCODE';
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptWarning {
  code: 'UNKNOWN_BARCODE';
  barcode: string;
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
  warnings: ReceiptWarning[];
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
    matched: boolean;
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
    const lines: ReceiptLine[] = input.lines.map((line) => ({
      barcode: line.barcode,
      description: line.description,
      matched: line.matched,
      ...(line.matched ? {} : { flag: 'UNKNOWN_BARCODE' as const }),
      quantity: line.quantity,
      unitPrice: toMoneyString(line.unitPrice),
      lineTotal: toMoneyString(line.lineTotal),
    }));

    // warnings[] is derived from the lines, so the two can never disagree.
    const warnings: ReceiptWarning[] = input.lines
      .filter((line) => !line.matched)
      .map((line) => ({ code: 'UNKNOWN_BARCODE', barcode: line.barcode }));

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
      lines,
      warnings,
      totals: {
        subtotal: toMoneyString(input.totals.subtotal),
        total: toMoneyString(input.totals.total),
        totalBase: toMoneyString(input.totals.totalBase),
      },
    };
  }
}
