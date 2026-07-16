import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { FxService } from './fx.service';

// No database needed — pure rate math.
describe('FxService', () => {
  let service: FxService;

  beforeEach(() => {
    const config = {
      get: jest.fn().mockReturnValue('USD'),
    } as unknown as ConfigService;
    service = new FxService(config);
  });

  it('returns the base currency from config', () => {
    expect(service.getBaseCurrency()).toBe('USD');
  });

  it('USD -> USD is identity (1.0), same path as any other pair', () => {
    const { rate, source } = service.getRate('USD', 'USD');
    expect(rate.toString()).toBe('1');
    expect(source).toBe('HARDCODED_V1');
  });

  it('EUR -> USD converts at the table rate', () => {
    const { rate, source } = service.getRate('EUR', 'USD');
    expect(rate.toString()).toBe('1.0842');
    expect(source).toBe('HARDCODED_V1');
  });

  it('throws on an unknown currency pair (internal consistency failure)', () => {
    expect(() => service.getRate('JPY', 'USD')).toThrow(
      InternalServerErrorException,
    );
  });
});
