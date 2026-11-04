/**
 * Durations are integer MINUTES everywhere. Hours for display are derived, and
 * fractional hours are only ever used through explicit Micro-scaled maths
 * (never floating point money).
 */
import { mulRatio, type Micro } from './money.ts';

export type Minutes = number;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;

/** Duration in minutes between two epoch-ms instants. */
export function minutesBetween(startMs: number, endMs: number): Minutes {
  return Math.round((endMs - startMs) / 60_000);
}

export function hoursFromMinutes(minutes: Minutes): number {
  return minutes / 60;
}

/** Minutes -> Micro-scaled hours, e.g. 90 -> 1.5 (as 1_500_000n). */
export function hoursMicro(minutes: Minutes): Micro {
  return BigInt(Math.round(minutes)) * 1_000_000n / 60n;
}

/** rate (Micro/hour) x duration (minutes), rounded half up, as Micro. */
export function payForMinutes(ratePerHour: Micro, minutes: Minutes): Micro {
  return mulRatio(ratePerHour, Math.round(minutes), 60);
}

/** Formats 90 -> "1.5", 120 -> "2", 8 -> "8" (trimmed, max 2 decimals). */
export function formatHours(minutes: Minutes, maxDecimals = 2): string {
  const negative = minutes < 0;
  const abs = Math.abs(minutes);
  const whole = Math.floor(abs / 60);
  const rem = abs % 60;
  if (rem === 0) return `${negative ? '-' : ''}${whole}`;
  const decimals = rem / 60;
  const text = decimals
    .toFixed(maxDecimals)
    .replace(/^0/, '')
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return `${negative ? '-' : ''}${whole}${text}`;
}

/** Formats 90 -> "1h 30m"; 60 -> "1h"; 45 -> "45m". */
export function formatHoursMinutes(minutes: Minutes): string {
  const negative = minutes < 0;
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rem = abs % 60;
  const sign = negative ? '-' : '';
  if (hours === 0) return `${sign}${rem}m`;
  if (rem === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${rem}m`;
}

/** "7:32" style timer for the live shift screen. */
export function formatTimer(minutes: Minutes): string {
  const abs = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Parses "8", "8.5", "8:30", "8h30" into minutes. Returns null when invalid. */
export function parseDurationToMinutes(input: string): Minutes | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hm = /^(\d{1,3})\s*h\s*(\d{1,2})?m?$/.exec(text);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const decimal = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text);
  if (decimal) {
    const whole = Number(decimal[1]);
    const frac = decimal[2] ? Number(decimal[2].padEnd(2, '0')) / 100 : 0;
    return Math.round((whole + frac) * 60);
  }
  return null;
}

/** Rounds minutes according to the job's rounding policy (spec 31). */
export type RoundingMode = 'exact' | 'nearest' | 'up' | 'down';
export type RoundingStep = 0 | 5 | 6 | 10 | 15;

export function applyRounding(minutes: Minutes, step: RoundingStep, mode: RoundingMode): Minutes {
  if (step === 0 || mode === 'exact') return minutes;
  const sign = minutes < 0 ? -1 : 1;
  const abs = Math.abs(minutes);
  const quotient = Math.floor(abs / step);
  const remainder = abs - quotient * step;
  let result: number;
  switch (mode) {
    case 'up':
      result = remainder === 0 ? abs : (quotient + 1) * step;
      break;
    case 'down':
      result = quotient * step;
      break;
    case 'nearest':
    default: {
      const bump = remainder * 2 >= step ? 1 : 0;
      result = (quotient + bump) * step;
      break;
    }
  }
  return sign * result;
}
