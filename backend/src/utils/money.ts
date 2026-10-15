import { Prisma } from '@prisma/client';

/**
 * Decimal-safe money helpers. All monetary arithmetic uses Prisma.Decimal
 * (arbitrary-precision) - never JavaScript floating point.
 */
export type Money = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function dec(value: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

export function add(...values: Array<number | string | Prisma.Decimal>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, value) => acc.plus(dec(value)), ZERO);
}

export function sub(a: number | string | Prisma.Decimal, b: number | string | Prisma.Decimal): Prisma.Decimal {
  return dec(a).minus(dec(b));
}

export function mul(a: number | string | Prisma.Decimal, b: number | string | Prisma.Decimal): Prisma.Decimal {
  return dec(a).times(dec(b));
}

export function div(a: number | string | Prisma.Decimal, b: number | string | Prisma.Decimal): Prisma.Decimal {
  const divisor = dec(b);
  if (divisor.isZero()) return ZERO;
  return dec(a).div(divisor);
}

/** Rounds to 2 decimal places using half-up rounding (banker-safe for invoicing). */
export function round(value: number | string | Prisma.Decimal, places = 2): Prisma.Decimal {
  return dec(value).toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);
}

export function max(a: number | string | Prisma.Decimal, b: number | string | Prisma.Decimal): Prisma.Decimal {
  return dec(a).greaterThanOrEqualTo(dec(b)) ? dec(a) : dec(b);
}

export function isZero(value: number | string | Prisma.Decimal): boolean {
  return dec(value).isZero();
}

export function toNumber(value: number | string | Prisma.Decimal): number {
  return dec(value).toNumber();
}

/**
 * Percentage of a base amount, rounded to 2dp.
 */
export function percentOf(base: number | string | Prisma.Decimal, percent: number | string | Prisma.Decimal): Prisma.Decimal {
  return round(div(mul(base, percent), 100));
}

/**
 * Largest-remainder reconciliation: distributes a total across weights so the
 * allocated parts sum exactly to the total (avoids rounding drift in
 * profit-sharing splits).
 */
export function allocateByWeights(
  total: Prisma.Decimal,
  weights: number[],
): Prisma.Decimal[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0 || weights.length === 0) return weights.map(() => ZERO);

  const cents = round(total, 2).times(100).toNumber();
  const exact = weights.map((w) => (cents * w) / totalWeight);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = Math.round(cents) - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    result[order[i].index] += 1;
    remainder -= 1;
  }

  return result.map((centsValue) => new Prisma.Decimal(centsValue).div(100).toDecimalPlaces(2));
}

export function formatMoney(
  value: number | string | Prisma.Decimal,
  currency = 'LKR',
  locale = 'en-LK',
): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toNumber(value));
  } catch {
    return `${currency} ${round(value).toFixed(2)}`;
  }
}
