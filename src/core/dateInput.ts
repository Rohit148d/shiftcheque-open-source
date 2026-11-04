/**
 * Strict `YYYY-MM-DD` date-key input handling (pure, testable).
 *
 * Rules:
 *  - only the ISO date-key form is accepted; anything ambiguous such as
 *    `10/05/2026`, `2026/10/05` or `Oct 5, 2026` is REJECTED, never guessed
 *  - real calendar dates are validated (2026-02-30 is invalid)
 *  - the value is a plain string key, so it can never be shifted a day by a
 *    timezone conversion on the way in or out
 *  - the error messages are the exact copy the UI shows
 */
import { isValidDateKey, parseDateKey } from './tz.ts';

export const DATE_FORMAT_HINT = 'YYYY-MM-DD';
export const DATE_EXAMPLE = '2026-10-05';
export const DATE_ERROR_MESSAGE = `Use ${DATE_FORMAT_HINT}, for example ${DATE_EXAMPLE}.`;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export type DateKeyValidation =
  | { ok: true; key: string }
  | { ok: false; reason: 'empty' | 'format' | 'calendar' | 'range'; message: string };

/** Validates user input for a date field. Never reinterprets ambiguous input. */
export function validateDateKeyInput(text: string): DateKeyValidation {
  const value = text.trim();
  if (value === '') {
    return { ok: false, reason: 'empty', message: `Enter a date as ${DATE_FORMAT_HINT}.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, reason: 'format', message: DATE_ERROR_MESSAGE };
  }
  if (!isValidDateKey(value)) {
    return { ok: false, reason: 'calendar', message: `That date does not exist. ${DATE_ERROR_MESSAGE}` };
  }
  const { year } = parseDateKey(value);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { ok: false, reason: 'range', message: `Enter a year between ${MIN_YEAR} and ${MAX_YEAR}.` };
  }
  return { ok: true, key: value };
}

/** Local "today" as a date key. Uses local parts only, so it never shifts. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** First day of the current year, used as the pay-period default. */
export function defaultAnchorKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-01-01`;
}
