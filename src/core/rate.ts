/**
 * rateEngine — effective-dated wage rates (spec 27).
 *
 * Historical wages are never mutated. A rate record applies from its
 * effectiveFrom date until the next record begins, and historical shifts keep
 * using the rate that was in force on the day they were worked.
 */
import { microFromDollars, type Micro } from './money.ts';
import type { RateRecord } from './types.ts';

export function sortRates(rates: RateRecord[]): RateRecord[] {
  return [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The rate in force on a date, falling back to the earliest known rate. */
export function rateForDate(rates: RateRecord[], dateKey: string, fallback: Micro = 0n): Micro {
  const sorted = sortRates(rates);
  if (sorted.length === 0) return fallback;
  let selected: RateRecord | undefined;
  for (const rate of sorted) {
    if (rate.effectiveFrom <= dateKey) selected = rate;
    else break;
  }
  return (selected ?? sorted[0]).rate;
}

/** All rate changes inside a range, oldest first (used by the pay breakdown). */
export function ratesInRange(rates: RateRecord[], fromDate: string, toDate: string): RateRecord[] {
  return sortRates(rates).filter((rate) => rate.effectiveFrom >= fromDate && rate.effectiveFrom <= toDate);
}

export type RateChangeInput = {
  amount: string | number;
  effectiveFrom: string;
  note?: string;
};

export function makeRateRecord(jobId: string, input: RateChangeInput, id: string): RateRecord {
  return {
    id,
    jobId,
    rate: typeof input.amount === 'string' ? microFromDollars(input.amount) : microFromDollars(input.amount),
    effectiveFrom: input.effectiveFrom,
    note: input.note,
  };
}

/** Human label for a rate change, e.g. "$24.50 from Mar 1, 2026". */
export function rateChangeLabel(record: RateRecord, formatMoney: (value: Micro) => string, formatDate: (key: string) => string): string {
  return `${formatMoney(record.rate)} from ${formatDate(record.effectiveFrom)}`;
}
