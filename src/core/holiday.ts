/**
 * holidayEngine — statutory holiday dates for every Canadian jurisdiction.
 *
 * What this module DOES do: compute the statutory holiday calendar for a year
 * and jurisdiction, including the observed (substitute) date when the holiday
 * falls on a weekend.
 *
 * What this module deliberately does NOT do: decide whether a specific worker
 * is *eligible* for statutory holiday pay. Eligibility depends on qualifying
 * days worked, which the app cannot know. Instead, holiday pay is only
 * estimated when the user has explicitly told us how their workplace handles
 * it (HolidayPolicy), and the UI shows what we assumed. This follows spec 39.
 */
import { addDays, dayOfWeek, daysInMonthFor, toDateKey, type ZoneId } from './tz.ts';
import type { JurisdictionCode } from './types.ts';

export type HolidayKind = 'fixed' | 'nth_weekday' | 'easter' | 'monday_before';

export type StatutoryHolidayDefinition = {
  id: string;
  name: string;
  jurisdictions: JurisdictionCode[];
  kind: HolidayKind;
  month?: number;
  day?: number;
  nth?: number;
  weekday?: number;
  easterOffset?: number;
  observedRule: 'next_weekday' | 'previous_weekday' | 'none' | 'monday_after';
  /**
   * Optional holidays: many employers observe them, but they are not part of
   * the jurisdiction's minimum paid-holiday list. They are kept in the calendar
   * (so premiums can reference them) but excluded from the "paid holiday" count.
   */
  optional?: boolean;
  /** Two holidays that are alternatives of each other (e.g. Good Friday / Easter Monday in QC). */
  alternativeTo?: string;
};

/** Name localisation keys map through i18n using `holiday.<id>`. */
export const HOLIDAY_DEFINITIONS: StatutoryHolidayDefinition[] = [
  { id: 'new_years_day', name: "New Year's Day", jurisdictions: ALL_J(), kind: 'fixed', month: 1, day: 1, observedRule: 'next_weekday' },
  { id: 'family_day', name: 'Family Day', jurisdictions: ['AB', 'BC', 'NB', 'ON', 'SK'], kind: 'nth_weekday', month: 2, nth: 3, weekday: 1, observedRule: 'none' },
  { id: 'louis_riel_day', name: 'Louis Riel Day', jurisdictions: ['MB'], kind: 'nth_weekday', month: 2, nth: 3, weekday: 1, observedRule: 'none' },
  { id: 'heritage_day_ns', name: 'Nova Scotia Heritage Day', jurisdictions: ['NS'], kind: 'nth_weekday', month: 2, nth: 3, weekday: 1, observedRule: 'none' },
  { id: 'islander_day', name: 'Islander Day', jurisdictions: ['PE'], kind: 'nth_weekday', month: 2, nth: 3, weekday: 1, observedRule: 'none' },
  { id: 'heritage_day_yt', name: 'Heritage Day (Yukon)', jurisdictions: ['YT'], kind: 'nth_weekday', month: 2, nth: 5, weekday: 5, observedRule: 'none' },
  { id: 'good_friday', name: 'Good Friday', jurisdictions: ALL_J(), kind: 'easter', easterOffset: -2, observedRule: 'none' },
  { id: 'easter_monday', name: 'Easter Monday', jurisdictions: ['QC'], kind: 'easter', easterOffset: 1, observedRule: 'none', alternativeTo: 'good_friday' },
  { id: 'st_patricks_day', name: "St. Patrick's Day", jurisdictions: ['NL'], kind: 'nth_weekday', month: 3, nth: 3, weekday: 1, observedRule: 'none', optional: true },
  { id: 'st_georges_day', name: "St. George's Day", jurisdictions: ['NL'], kind: 'nth_weekday', month: 4, nth: 4, weekday: 1, observedRule: 'none', optional: true },
  { id: 'victoria_day', name: 'Victoria Day', jurisdictions: ['FED', 'BC', 'MB', 'NT', 'NU', 'ON', 'SK', 'YT', 'AB'], kind: 'nth_weekday', month: 5, nth: 2, weekday: 1, observedRule: 'none' },
  { id: 'victoria_day_nl', name: 'Victoria Day', jurisdictions: ['NL'], kind: 'nth_weekday', month: 5, nth: 2, weekday: 1, observedRule: 'none', optional: true },
  { id: 'national_patriots_day', name: 'National Patriots’ Day', jurisdictions: ['QC'], kind: 'monday_before', month: 5, day: 25, observedRule: 'none' },
  { id: 'national_indigenous_peoples_day', name: 'National Indigenous Peoples Day', jurisdictions: ['NT', 'YT'], kind: 'fixed', month: 6, day: 21, observedRule: 'next_weekday' },
  { id: 'discovery_day_nl', name: 'Discovery Day (NL)', jurisdictions: ['NL'], kind: 'monday_before', month: 6, day: 25, observedRule: 'none', optional: true },
  { id: 'st_jean_baptiste', name: 'Fête nationale du Québec', jurisdictions: ['QC'], kind: 'fixed', month: 6, day: 24, observedRule: 'next_weekday' },
  { id: 'canada_day', name: 'Canada Day', jurisdictions: ALL_J(), kind: 'fixed', month: 7, day: 1, observedRule: 'next_weekday' },
  { id: 'memorial_day_nl', name: 'Memorial Day (NL)', jurisdictions: ['NL'], kind: 'fixed', month: 7, day: 1, observedRule: 'none' },
  { id: 'nunavut_day', name: 'Nunavut Day', jurisdictions: ['NU'], kind: 'fixed', month: 7, day: 9, observedRule: 'next_weekday' },
  { id: 'orangemens_day', name: "Orangemen's Day", jurisdictions: ['NL'], kind: 'monday_before', month: 7, day: 13, observedRule: 'none', optional: true },
  { id: 'civic_holiday', name: 'Civic Holiday', jurisdictions: ['NT', 'NU'], kind: 'nth_weekday', month: 8, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'bc_day', name: 'British Columbia Day', jurisdictions: ['BC'], kind: 'nth_weekday', month: 8, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'nb_day', name: 'New Brunswick Day', jurisdictions: ['NB'], kind: 'nth_weekday', month: 8, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'saskatchewan_day', name: 'Saskatchewan Day', jurisdictions: ['SK'], kind: 'nth_weekday', month: 8, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'terry_fox_day', name: 'Terry Fox Day', jurisdictions: ['MB'], kind: 'nth_weekday', month: 8, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'discovery_day_yt', name: 'Discovery Day (YT)', jurisdictions: ['YT'], kind: 'nth_weekday', month: 8, nth: 3, weekday: 1, observedRule: 'none' },
  { id: 'labour_day', name: 'Labour Day', jurisdictions: ALL_J(), kind: 'nth_weekday', month: 9, nth: 1, weekday: 1, observedRule: 'none' },
  { id: 'truth_and_reconciliation', name: 'National Day for Truth and Reconciliation', jurisdictions: ['FED', 'BC', 'YT', 'NT', 'NU'], kind: 'fixed', month: 9, day: 30, observedRule: 'next_weekday' },
  { id: 'thanksgiving', name: 'Thanksgiving', jurisdictions: ['FED', 'AB', 'BC', 'MB', 'NT', 'NU', 'ON', 'QC', 'SK', 'YT'], kind: 'nth_weekday', month: 10, nth: 2, weekday: 1, observedRule: 'none' },
  { id: 'remembrance_day', name: 'Remembrance Day', jurisdictions: ['FED', 'AB', 'BC', 'NB', 'NL', 'NT', 'NU', 'PE', 'SK', 'YT'], kind: 'fixed', month: 11, day: 11, observedRule: 'next_weekday' },
  { id: 'christmas_day', name: 'Christmas Day', jurisdictions: ALL_J(), kind: 'fixed', month: 12, day: 25, observedRule: 'next_weekday' },
  { id: 'boxing_day', name: 'Boxing Day', jurisdictions: ['FED', 'NL', 'NU', 'ON', 'PE'], kind: 'fixed', month: 12, day: 26, observedRule: 'next_weekday' },
];

function ALL_J(): JurisdictionCode[] {
  return ['FED', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
}

export type HolidayInstance = {
  id: string;
  name: string;
  /** The actual calendar date. */
  date: string;
  /** The day off / substitute day, when the holiday lands on a weekend. */
  observedDate: string;
  isObservedOnWeekend: boolean;
  /** Observed by many employers but not in the jurisdiction's minimum list. */
  optional: boolean;
  alternativeTo?: string;
};

// ---------------------------------------------------------------------------
// Easter (anonymous Gregorian algorithm — exact for all Gregorian years)
// ---------------------------------------------------------------------------

export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstDow = dayOfWeek(year, month, 1);
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return Math.min(day, daysInMonthFor(year, month));
}

function easterDateKey(year: number, offset: number): string {
  const { month, day } = easterSunday(year);
  const key = toDateKey(year, month, day);
  return addDays(key, offset);
}

/** The Monday strictly before a date (used by National Patriots’ Day etc.). */
function mondayBefore(year: number, month: number, day: number): string {
  const key = toDateKey(year, month, day);
  const previous = addDays(key, -1);
  const { year: y, month: m, day: d } = parseParts(previous);
  const dow = dayOfWeek(y, m, d);
  const delta = dow === 1 ? 0 : dow === 0 ? -6 : 1 - dow;
  return addDays(previous, delta);
}

/** Compute a holiday's calendar date for a year. */
export function holidayDateFor(definition: StatutoryHolidayDefinition, year: number): string {
  switch (definition.kind) {
    case 'fixed':
      return toDateKey(year, definition.month as number, Math.min(definition.day as number, daysInMonthFor(year, definition.month as number)));
    case 'nth_weekday':
      return toDateKey(
        year,
        definition.month as number,
        nthWeekdayOfMonth(year, definition.month as number, definition.weekday as number, definition.nth as number),
      );
    case 'monday_before':
      return mondayBefore(year, definition.month as number, definition.day as number);
    case 'easter':
      return easterDateKey(year, definition.easterOffset ?? 0);
  }
}

function observedDateFor(date: string, rule: StatutoryHolidayDefinition['observedRule']): { observed: string; onWeekend: boolean } {
  const { year, month, day } = parseParts(date);
  const dow = dayOfWeek(year, month, day);
  if (rule === 'none' || (dow !== 0 && dow !== 6)) return { observed: date, onWeekend: false };
  switch (rule) {
    case 'previous_weekday':
      return { observed: addDays(date, dow === 0 ? -2 : -1), onWeekend: true };
    case 'monday_after':
      return { observed: addDays(date, dow === 0 ? 1 : 2), onWeekend: true };
    case 'next_weekday':
    default:
      return { observed: addDays(date, dow === 0 ? 1 : 2), onWeekend: true };
  }
}

function parseParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function holidaysForYear(jurisdiction: JurisdictionCode, year: number): HolidayInstance[] {
  const instances: HolidayInstance[] = [];
  for (const definition of HOLIDAY_DEFINITIONS) {
    if (!definition.jurisdictions.includes(jurisdiction)) continue;
    const date = holidayDateFor(definition, year);
    const { observed, onWeekend } = observedDateFor(date, definition.observedRule);
    instances.push({
      id: definition.id,
      name: definition.name,
      date,
      observedDate: observed,
      isObservedOnWeekend: onWeekend,
      optional: definition.optional ?? false,
      alternativeTo: definition.alternativeTo,
    });
  }
  return instances.sort((a, b) => a.date.localeCompare(b.date));
}

/** Holidays the jurisdiction treats as paid holidays (optional ones excluded). */
export function paidHolidayCount(jurisdiction: JurisdictionCode, year: number): number {
  return holidaysForYear(jurisdiction, year).filter((holiday) => !holiday.optional && !holiday.alternativeTo).length;
}

/** Holidays in a date range (handles year boundaries). */
export function holidaysInRange(jurisdiction: JurisdictionCode, fromDate: string, toDate: string): HolidayInstance[] {
  const from = parseParts(fromDate);
  const to = parseParts(toDate);
  const all: HolidayInstance[] = [];
  for (let year = from.year; year <= to.year; year += 1) {
    all.push(...holidaysForYear(jurisdiction, year));
  }
  return all.filter((h) => h.date >= fromDate && h.date <= toDate);
}

export type HolidayLookup = {
  /** Every holiday date and observed date in the lookup window. */
  isHoliday(dateKey: string): boolean;
  /** The holiday instance whose actual date matches, if any. */
  on(dateKey: string): HolidayInstance | undefined;
  /** True when the date is the observed (substitute) day of some holiday. */
  isObserved(dateKey: string): boolean;
  all: HolidayInstance[];
};

export function createHolidayLookup(jurisdiction: JurisdictionCode, fromDate: string, toDate: string): HolidayLookup {
  const all = holidaysInRange(jurisdiction, fromDate, toDate);
  const actualDates = new Set<string>();
  const observedDates = new Set<string>();
  const byDate = new Map<string, HolidayInstance>();
  for (const holiday of all) {
    actualDates.add(holiday.date);
    observedDates.add(holiday.observedDate);
    if (!byDate.has(holiday.date)) byDate.set(holiday.date, holiday);
  }
  return {
    all,
    isHoliday: (dateKey) => actualDates.has(dateKey) || observedDates.has(dateKey),
    on: (dateKey) => byDate.get(dateKey),
    isObserved: (dateKey) => !actualDates.has(dateKey) && observedDates.has(dateKey),
  };
}

/** Convenience for the UI: upcoming holidays for a jurisdiction. */
export function upcomingHolidays(jurisdiction: JurisdictionCode, fromDate: string, count = 4): HolidayInstance[] {
  const year = parseParts(fromDate).year;
  const list = [...holidaysForYear(jurisdiction, year), ...holidaysForYear(jurisdiction, year + 1)];
  return list.filter((h) => h.date >= fromDate).slice(0, count);
}

/** A zone is accepted for signature compatibility with callers that have one. */
export type HolidayEngineOptions = { zone?: ZoneId };
