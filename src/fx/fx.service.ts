import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';

// The result of a rate lookup: the multiplier AND where it came from. The source tag is
// snapshotted onto the transaction so a future switch to a live provider never rewrites
// historic receipts (project-overview.md §8).
export interface FxRate {
  rate: Prisma.Decimal;
  source: string;
}

// Hardcoded per the brief — no live FX API in scope. This is a deliberate, scoped
// decision, not an unfinished one; a live provider would slot in behind getRate() and
// nothing else in the app would change.
const FX_RATE_SOURCE = 'HARDCODED_V1';
const DEFAULT_BASE_CURRENCY = 'USD';

// Rate direction (the classic silent bug lives here): each value is how many units of the
// BASE currency (USD) one unit of the keyed currency buys. So totalBase = total x rate.
// EUR 8.18 x 1.0842 = USD 8.8688. Anchored to USD; cross rates are derived by division.
const RATES_TO_USD: Readonly<Record<string, string>> = {
  USD: '1.00000000',
  EUR: '1.08420000',
  GBP: '1.27000000',
  CHF: '1.12000000',
};

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(private readonly config: ConfigService) {}

  // The base currency every sale converts into, from validated config.
  getBaseCurrency(): string {
    return this.config.get<string>('BASE_CURRENCY') ?? DEFAULT_BASE_CURRENCY;
  }

  // The single seam. `rate` = units of `to` that one unit of `from` buys.
  // from === to flows the identical path (rate 1) — no special-case branch.
  getRate(from: string, to: string): FxRate {
    const fromToUsd = RATES_TO_USD[from];
    const toToUsd = RATES_TO_USD[to];
    // A currency in `currencies` but missing from the table is an internal consistency
    // failure, not a user error. Throw loudly; never silently default to 1.
    if (fromToUsd === undefined || toToUsd === undefined) {
      this.logger.error(`Missing FX rate for pair ${from}->${to}`);
      throw new InternalServerErrorException('FX_RATE_UNAVAILABLE');
    }
    const rate = new Prisma.Decimal(fromToUsd)
      .div(new Prisma.Decimal(toToUsd))
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
    return { rate, source: FX_RATE_SOURCE };
  }
}
