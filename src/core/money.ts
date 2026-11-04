/**
 * Exact money arithmetic.
 *
 * Financial values are NEVER raw JavaScript floats. Internally every monetary
 * amount is a BigInt number of micro-dollars (1e-6 CAD). Integer arithmetic is
 * exact, deterministic across devices, and rounding happens only where the
 * payroll rules say it does (see PAYROLL_VALIDATION.md).
 *
 *   $1.00        -> 1_000_000n
 *   $24.50/h     -> 24_500_000n
 *   $0.0125      -> 12_500n
 *
 * All public conversion helpers round HALF AWAY FROM ZERO unless the name says
 * otherwise, and every rounding helper is explicit at the call site.
 */

export type Micro = bigint;

export const MICRO_SCALE = 1_000_000n;
export const CENTS_PER_DOLLAR = 100n;
export const MICRO_PER_CENT = 10_000n;

export function microFromCents(cents: number | bigint): Micro {
  return BigInt(cents) * MICRO_PER_CENT;
}

export function microFromDollars(value: number | string): Micro {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(`Not a finite amount: ${value}`);
    return parseDecimalString(value.toFixed(6));
  }
  return parseDecimalString(value);
}

export class MoneyError extends Error {}

/**
 * Parses a human decimal string ("1,234.56", "$24.5", "-3.005") into Micro.
 * Extra precision beyond 1e-6 is rounded half away from zero.
 */
export function parseDecimalString(input: string): Micro {
  const cleaned = input.replace(/[\s,$]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') throw new MoneyError('Empty amount');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`Invalid amount: ${input}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2] ?? '';
  const fracPart = match[3] ?? '';
  if (intPart === '' && fracPart === '') throw new MoneyError(`Invalid amount: ${input}`);
  const fracPadded = (fracPart + '0000000').slice(0, 7);
  const kept = fracPadded.slice(0, 6);
  const nextDigit = Number(fracPadded[6] ?? '0');
  let value = BigInt(intPart === '' ? '0' : intPart) * MICRO_SCALE + BigInt(kept === '' ? '0' : kept);
  if (nextDigit >= 5) value += 1n;
  return sign * value;
}

/** Parses user input; returns null instead of throwing (form fields). */
export function tryParseMoney(input: string): Micro | null {
  try {
    return parseDecimalString(input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/** Rounds a rational a/b (b > 0) to the nearest integer, half away from zero. */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new MoneyError('Division by zero');
  const negative = a < 0n;
  const absA = negative ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = absA / absB;
  const r = absA % absB;
  const bump = r * 2n >= absB ? 1n : 0n;
  const result = q + bump;
  return negative ? -result : result;
}

export function divFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new MoneyError('Division by zero');
  const q = a / b;
  return q;
}

/** Rounds to the nearest cent, half away from zero. */
export function roundToCents(value: Micro): Micro {
  return divRoundHalfUp(value, MICRO_PER_CENT) * MICRO_PER_CENT;
}

/** Rounds UP (toward +infinity) to the next cent. */
export function ceilToCents(value: Micro): Micro {
  const c = value / MICRO_PER_CENT;
  const rem = value % MICRO_PER_CENT;
  return (rem > 0n ? c + 1n : c) * MICRO_PER_CENT;
}

/** Truncates toward zero to whole cents (used where CRA truncates). */
export function truncToCents(value: Micro): Micro {
  return (value / MICRO_PER_CENT) * MICRO_PER_CENT;
}

/** Rounds to whole dollars, half away from zero. */
export function roundToDollars(value: Micro): Micro {
  return divRoundHalfUp(value, MICRO_SCALE) * MICRO_SCALE;
}

/** Rounds to the nearest multiple of `step` (Micro), half away from zero. */
export function roundToStep(value: Micro, step: Micro): Micro {
  return divRoundHalfUp(value, step) * step;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(...values: Micro[]): Micro {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function sub(a: Micro, b: Micro): Micro {
  return a - b;
}

export function neg(a: Micro): Micro {
  return -a;
}

export function abs(a: Micro): Micro {
  return a < 0n ? -a : a;
}

/** value * factor (both Micro-scaled). */
export function mul(value: Micro, factor: Micro): Micro {
  return divRoundHalfUp(value * factor, MICRO_SCALE);
}

/** value * numerator / denominator, rounded half up. */
export function mulRatio(value: Micro, numerator: bigint | number, denominator: bigint | number): Micro {
  return divRoundHalfUp(value * BigInt(numerator), BigInt(denominator));
}

/** value * percent / 100, e.g. percentOf(x, 5.95) for 5.95%. */
export function percentOf(value: Micro, percent: number | string): Micro {
  const rate = microFromDollars(percent); // 5.95 -> 5.95 scaled
  return divRoundHalfUp(value * rate, 100n * MICRO_SCALE);
}

/** min/max helpers that work on Micro. */
export function min(a: Micro, b: Micro): Micro {
  return a < b ? a : b;
}
export function max(a: Micro, b: Micro): Micro {
  return a > b ? a : b;
}
export function clamp(value: Micro, lower: Micro, upper: Micro): Micro {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}

export function isZero(a: Micro): boolean {
  return a === 0n;
}

export function isNegative(a: Micro): boolean {
  return a < 0n;
}

export function isPositive(a: Micro): boolean {
  return a > 0n;
}

// ---------------------------------------------------------------------------
// Conversion / display
// ---------------------------------------------------------------------------

export function toCents(value: Micro): number {
  return Number(divRoundHalfUp(value, MICRO_PER_CENT));
}

export function toDollarsNumber(value: Micro): number {
  return Number(value) / 1_000_000;
}

/** Canonical machine representation (exact, 6 decimals) for persistence/debug. */
export function toDecimalString(value: Micro): string {
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  const units = absValue / MICRO_SCALE;
  const frac = (absValue % MICRO_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  const body = frac.length > 0 ? `${units}.${frac}` : `${units}`;
  return negative ? `-${body}` : body;
}

export function toFixed(value: Micro, digits: number): string {
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  const factor = 10n ** BigInt(6 - digits);
  const rounded = divRoundHalfUp(absValue, factor);
  const units = rounded / (MICRO_SCALE / factor);
  const frac = (rounded % (MICRO_SCALE / factor)).toString().padStart(digits, '0');
  const body = digits > 0 ? `${units}.${frac}` : `${units}`;
  return negative ? `-${body}` : body;
}

export function sum(values: Micro[]): Micro {
  return values.reduce<Micro>((acc, v) => acc + v, 0n);
}
