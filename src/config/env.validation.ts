import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

// Currencies the app supports (matches the seeded `currencies` whitelist). BASE_CURRENCY
// must be one of them, validated at boot so a typo fails fast rather than at first sale.
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF'] as const;

class EnvVars {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  DIRECT_URL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  BASE_CURRENCY?: string;
}

// Wired into ConfigModule.forRoot({ validate }). Runs once at startup.
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return validated;
}
