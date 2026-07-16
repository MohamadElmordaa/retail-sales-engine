import { HttpException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { FxService } from '../fx/fx.service';
import { SalesService } from './sales.service';
import type { CreateSaleDto } from './dto/create-sale.dto';

// Write payloads captured off the mocked $transaction so tests can assert what the service
// persisted (Decimals, matched flags, scan rows) without touching a database.
interface CapturedTransaction {
  totalBase: Prisma.Decimal;
}
interface CapturedLineItem {
  id: string;
  productId: string | null;
  isUnmatched: boolean;
  rawBarcode: string;
  lineTotalBase: Prisma.Decimal;
}
interface CapturedScan {
  rawBarcode: string;
  lineItemId: string | null;
  transactionId: string | null;
}

interface PrismaMock {
  store: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  currency: { findUnique: jest.Mock };
  product: { findMany: jest.Mock };
  $transaction: jest.Mock;
}
interface TxMock {
  transaction: { create: jest.Mock };
  transactionLineItem: { createMany: jest.Mock };
  unmatchedBarcodeScan: { createMany: jest.Mock };
}
interface FxMock {
  getBaseCurrency: jest.Mock;
  getRate: jest.Mock;
}

// Await a rejection and hand back the HttpException so its status/code can be asserted.
async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

// Mocked Prisma + Fx — these tests must pass with no database.
describe('SalesService', () => {
  let service: SalesService;
  let prisma: PrismaMock;
  let fx: FxMock;
  let createdData: CapturedTransaction | undefined;
  let lineItemsData: CapturedLineItem[];
  let scanData: CapturedScan[];

  const baseDto: CreateSaleDto = {
    storeCode: 'STR-001',
    cashierId: 'cash-1',
    currencyCode: 'EUR',
    lineItems: [
      { barcode: 'B1', quantity: 2, unitPrice: '3.4900' },
      { barcode: 'B2', quantity: 1, unitPrice: '1.9900' },
    ],
  };

  beforeEach(() => {
    createdData = undefined;
    lineItemsData = [];
    scanData = [];
    prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'store-1',
          code: 'STR-001',
          name: 'Hannover Mitte',
        }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'cash-1', fullName: 'Clara Kassierer' }),
      },
      currency: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ code: 'EUR', isActive: true }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', barcode: 'B1', name: 'Product 1' },
          { id: 'p2', barcode: 'B2', name: 'Product 2' },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: TxMock) => Promise<unknown>) => {
          const tx: TxMock = {
            transaction: {
              create: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: CapturedTransaction }) => {
                    createdData = data;
                    return {
                      id: 'txn-1',
                      occurredAt: new Date('2026-07-16T00:00:00.000Z'),
                      ...data,
                    };
                  },
                ),
            },
            transactionLineItem: {
              createMany: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: CapturedLineItem[] }) => {
                    lineItemsData = data;
                    return { count: data.length };
                  },
                ),
            },
            unmatchedBarcodeScan: {
              createMany: jest
                .fn()
                .mockImplementation(({ data }: { data: CapturedScan[] }) => {
                  scanData = data;
                  return { count: data.length };
                }),
            },
          };
          return cb(tx);
        }),
    };
    fx = {
      getBaseCurrency: jest.fn().mockReturnValue('USD'),
      getRate: jest.fn().mockReturnValue({
        rate: new Prisma.Decimal('1.08420000'),
        source: 'HARDCODED_V1',
      }),
    };
    service = new SalesService(
      prisma as unknown as PrismaService,
      fx as unknown as FxService,
    );
  });

  it('EUR sale: converts each line and totalBase reconciles to the sum of line_total_base', async () => {
    const receipt = await service.create(baseDto);

    // 6.98 x 1.0842 = 7.567716 -> 7.5677 ; 1.99 x 1.0842 = 2.157558 -> 2.1576
    expect(receipt.totals.total).toBe('8.9700');
    expect(receipt.totals.totalBase).toBe('9.7253');
    expect(receipt.totals.totalBase).not.toBe(receipt.totals.total);
    expect(receipt.currency.fxRate).toBe('1.08420000');
    expect(receipt.currency.baseCode).toBe('USD');
    expect(receipt.warnings).toEqual([]);

    // Reconciliation: SUM(line_total_base) === transaction.total_base
    const sumBase = lineItemsData.reduce(
      (sum, line) => sum.add(line.lineTotalBase),
      new Prisma.Decimal(0),
    );
    expect(createdData?.totalBase.toString()).toBe(sumBase.toString());
  });

  it('USD sale: identity FX, totalBase === total', async () => {
    prisma.currency.findUnique.mockResolvedValue({
      code: 'USD',
      isActive: true,
    });
    fx.getBaseCurrency.mockReturnValue('USD');
    fx.getRate.mockReturnValue({
      rate: new Prisma.Decimal('1.00000000'),
      source: 'HARDCODED_V1',
    });

    const receipt = await service.create({ ...baseDto, currencyCode: 'USD' });

    expect(receipt.currency.fxRate).toBe('1.00000000');
    expect(receipt.totals.totalBase).toBe(receipt.totals.total);
  });

  it('unknown barcode: sale completes (201), line is flagged, scan row is logged, FX still applies', async () => {
    // Only B1 is known; B2 matches no product.
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', barcode: 'B1', name: 'Product 1' },
    ]);

    const receipt = await service.create(baseDto);

    // Receipt: one matched line, one flagged, and a matching warning.
    const matched = receipt.lines.find((l) => l.barcode === 'B1');
    const flagged = receipt.lines.find((l) => l.barcode === 'B2');
    expect(matched?.matched).toBe(true);
    expect(flagged?.matched).toBe(false);
    expect(flagged?.flag).toBe('UNKNOWN_BARCODE');
    expect(flagged?.description).toBeNull();
    expect(receipt.warnings).toEqual([
      { code: 'UNKNOWN_BARCODE', barcode: 'B2' },
    ]);

    // Persisted line: product_id NULL + is_unmatched true (satisfies the DB CHECK), raw_barcode kept.
    const unmatchedRow = lineItemsData.find((l) => l.rawBarcode === 'B2');
    expect(unmatchedRow?.productId).toBeNull();
    expect(unmatchedRow?.isUnmatched).toBe(true);

    // FX still applied to the unknown line — an unknown product is not free.
    expect(unmatchedRow?.lineTotalBase.gt(0)).toBe(true);

    // Exactly one scan row, linked to the transaction and to that line item.
    expect(scanData).toHaveLength(1);
    expect(scanData[0].rawBarcode).toBe('B2');
    expect(scanData[0].transactionId).toBe('txn-1');
    expect(scanData[0].lineItemId).toBe(unmatchedRow?.id);
  });

  it('every persisted line carries raw_barcode, matched or not', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', barcode: 'B1', name: 'Product 1' },
    ]);
    await service.create(baseDto);
    expect(lineItemsData.every((l) => Boolean(l.rawBarcode))).toBe(true);
  });

  it('empty cart -> 400 EMPTY_CART, before any DB call', async () => {
    const err = await caught(service.create({ ...baseDto, lineItems: [] }));
    expect(err.getStatus()).toBe(400);
    expect((err.getResponse() as { code: string }).code).toBe('EMPTY_CART');
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
  });

  it('unknown store -> 404 STORE_NOT_FOUND', async () => {
    prisma.store.findUnique.mockResolvedValue(null);
    const err = await caught(service.create(baseDto));
    expect(err.getStatus()).toBe(404);
    expect((err.getResponse() as { code: string }).code).toBe(
      'STORE_NOT_FOUND',
    );
  });

  it('unsupported currency -> 422 UNSUPPORTED_CURRENCY', async () => {
    prisma.currency.findUnique.mockResolvedValue(null);
    const err = await caught(service.create(baseDto));
    expect(err.getStatus()).toBe(422);
    expect((err.getResponse() as { code: string }).code).toBe(
      'UNSUPPORTED_CURRENCY',
    );
  });

  it('duplicate (storeId, externalRef) -> 409 DUPLICATE_SALE, no Prisma text leaks', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const err = await caught(
      service.create({ ...baseDto, externalRef: 'POS-1' }),
    );
    expect(err.getStatus()).toBe(409);
    const body = err.getResponse() as { code: string; message: string };
    expect(body.code).toBe('DUPLICATE_SALE');
    expect(body.message).not.toMatch(/constraint|P2002|prisma/i);
  });
});
