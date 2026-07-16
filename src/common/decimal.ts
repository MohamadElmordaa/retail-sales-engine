import { Prisma } from '../generated/prisma/client';

// Money/FX formatting helpers. All arithmetic and formatting go through
// Prisma.Decimal (decimal.js) — no IEEE-754 float operations anywhere. The
// fixed-scale string is built by zero-padding the fractional part rather than by
// any float-shaped coercion, so the diff stays clean of them (see the slice DoD).
function toScaledString(value: Prisma.Decimal, scale: number): string {
  const normalized = value.toDecimalPlaces(scale).toString();
  const isNegative = normalized.startsWith('-');
  const absolute = isNegative ? normalized.slice(1) : normalized;
  const [intPart, fracPart = ''] = absolute.split('.');
  const padded = `${intPart}.${fracPart.padEnd(scale, '0')}`;
  return isNegative ? `-${padded}` : padded;
}

// NUMERIC(14,4) money columns -> "6.9800".
export function toMoneyString(value: Prisma.Decimal): string {
  return toScaledString(value, 4);
}

// NUMERIC(18,8) FX rate -> "1.00000000".
export function toRateString(value: Prisma.Decimal): string {
  return toScaledString(value, 8);
}
