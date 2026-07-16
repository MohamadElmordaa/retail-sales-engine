import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { FxService } from '../fx/fx.service';
import { SalesService } from './sales.service';
import type { CreateSaleDto } from './dto/create-sale.dto';

// Write payloads captured off the mocked $transaction so tests can assert that the
// receipt reconciles against exactly what the service persisted (Decimals, not strings).
interface CapturedTransaction {
  totalBase: Prisma.Decimal;
}
interface CapturedLineItem {
  lineTotalBase: Prisma.Decimal;
}

// Only the surface SalesService touches — cast to the real types at construction so the
// service is exercised unchanged while the mocks keep their jest.Mock control methods.
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
}
interface FxMock {
  getBaseCurrency: jest.Mock;
  getRate: jest.Mock;
}

// Mocked Prisma + Fx — these tests must pass with no database.
describe('SalesService', () => {
  let service: SalesService;
  let prisma: PrismaMock;
  let fx: FxMock;
  let createdData: CapturedTransaction | undefined;
  let lineItemsData: CapturedLineItem[];

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

  it('throws 404 when a barcode matches no product', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    await expect(service.create(baseDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
