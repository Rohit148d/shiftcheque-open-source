/**
 * Canadian timezone + daylight-saving handling without any native tz database.
 *
 * Union rules since 2007: DST starts on the second Sunday of March at 02:00
 * local standard time and ends on the first Sunday of November at 02:00 local
 * daylight time. Saskatchewan (Regina) does not observe DST; the Yukon is
 * permanently on MST; a handful of small BC/QC communities are excluded — the
 * user's job can still override with "paid hours" when it matters.
 *
 * Everything here is deterministic pure integer arithmetic: safe for
 * unit-testing and identical on every device.
 */

export type CivilDateTime = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
};

export type ZoneId =
  | 'America/St_Johns'
  | 'America/Halifax'
  | 'America/Toronto'
  | 'America/Winnipeg'
  | 'America/Regina'
  | 'America/Edmonton'
  | 'America/Vancouver'
  | 'America/Whitehorse'
  | 'America/Iqaluit';

type ZoneDef = {
  id: ZoneId;
  label: string;
  /** Standard offset from UTC in minutes (west of Greenwich is negative). */
  stdOffset: number;
  /** Daylight offset in minutes; equal to stdOffset when DST is not observed. */
  dstOffset: number;
  observesDst: boolean;
};

export const ZONES: Record<ZoneId, ZoneDef> = {
  'America/St_Johns': { id: 'America/St_Johns', label: 'Newfoundland', stdOffset: -210, dstOffset: -150, observesDst: true },
  'America/Halifax': { id: 'America/Halifax', label: 'Atlantic', stdOffset: -240, dstOffset: -180, observesDst: true },
  'America/Toronto': { id: 'America/Toronto', label: 'Eastern', stdOffset: -300, dstOffset: -240, observesDst: true },
  'America/Winnipeg': { id: 'America/Winnipeg', label: 'Central', stdOffset: -360, dstOffset: -300, observesDst: true },
  'America/Regina': { id: 'America/Regina', label: 'Central (Saskatchewan, no DST)', stdOffset: -360, dstOffset: -360, observesDst: false },
  'America/Edmonton': { id: 'America/Edmonton', label: 'Mountain', stdOffset: -420, dstOffset: -360, observesDst: true },
  'America/Vancouver': { id: 'America/Vancouver', label: 'Pacific', stdOffset: -480, dstOffset: -420, observesDst: true },
  'America/Whitehorse': { id: 'America/Whitehorse', label: 'Yukon (no DST)', stdOffset: -420, dstOffset: -420, observesDst: false },
  'America/Iqaluit': { id: 'America/Iqaluit', label: 'Eastern (Nunavut)', stdOffset: -300, dstOffset: -240, observesDst: true },
};

export const ZONE_IDS = Object.keys(ZONES) as ZoneId[];

export function isZoneId(value: string): value is ZoneId {
  return Object.prototype.hasOwnProperty.call(ZONES, value);
}

export function zoneDef(zone: ZoneId): ZoneDef {
  return ZONES[zone];
}

// ---------------------------------------------------------------------------
// Calendar helpers (UTC-based, used for DST rule math)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonthFor(year: number, month: number): number {
  return daysInMonth(year, month);
}

/** Day of week for a civil date; 0 = Sunday. */
export function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** nth weekday of a month: nth=2, weekday=0 (Sunday) -> second Sunday. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstDow = dayOfWeek(year, month, 1);
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

/** Epoch ms of the DST transition instant for a given year (UTC based). */
export function dstTransitions(year: number, zone: ZoneId): { startUtc: number; endUtc: number } | null {
  const def = ZONES[zone];
  if (!def.observesDst) return null;
  const startDay = nthWeekdayOfMonth(year, 3, 0, 2); // second Sunday of March
  const endDay = nthWeekdayOfMonth(year, 11, 0, 1); // first Sunday of November
  // 02:00 local standard time -> UTC instant
  const startUtc = Date.UTC(year, 2, startDay, 2, 0) - def.stdOffset * 60_000;
  // 02:00 local daylight time -> UTC instant
  const endUtc = Date.UTC(year, 10, endDay, 2, 0) - def.dstOffset * 60_000;
  return { startUtc, endUtc };
}

/** Offset in minutes that applies at a given UTC instant. */
export function offsetMinutesAt(zone: ZoneId, epochMs: number): number {
  const def = ZONES[zone];
  if (!def.observesDst) return def.stdOffset;
  const year = new Date(epochMs).getUTCFullYear();
  for (const candidateYear of [year - 1, year, year + 1]) {
    const t = dstTransitions(candidateYear, zone);
    if (!t) continue;
    if (epochMs >= t.startUtc && epochMs < t.endUtc) return def.dstOffset;
    if (candidateYear === year) {
      // handle the wrap: after start of next year's DST
      const next = dstTransitions(candidateYear + 1, zone);
      if (next && epochMs >= next.startUtc) return def.dstOffset;
      const prev = dstTransitions(candidateYear - 1, zone);
      if (prev && epochMs >= prev.endUtc && epochMs < t.startUtc) return def.stdOffset;
    }
  }
  return def.stdOffset;
}

export function isDstAt(zone: ZoneId, epochMs: number): boolean {
  const def = ZONES[zone];
  return def.observesDst && offsetMinutesAt(zone, epochMs) === def.dstOffset;
}

/** Converts a wall-clock civil time in a zone to a UTC instant (epoch ms). */
export function zonedToUtc(zone: ZoneId, civil: CivilDateTime): number {
  const def = ZONES[zone];
  const naiveUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, 0, 0);

  // First guess: standard offset.
  const guessStd = naiveUtc - def.stdOffset * 60_000;
  if (offsetMinutesAt(zone, guessStd) === def.stdOffset) {
    // Could still be ambiguous (fall back): prefer the earlier (DST) instant.
    if (def.observesDst) {
      const guessDst = naiveUtc - def.dstOffset * 60_000;
      if (offsetMinutesAt(zone, guessDst) === def.dstOffset && guessDst < guessStd) return guessDst;
    }
    return guessStd;
  }
  const guessDst = naiveUtc - def.dstOffset * 60_000;
  if (offsetMinutesAt(zone, guessDst) === def.dstOffset) return guessDst;
  // Nonexistent local time (spring forward): map forward by the gap.
  return guessStd;
}

/** Converts a UTC instant into wall-clock civil time in a zone. */
export function utcToZoned(zone: ZoneId, epochMs: number): CivilDateTime {
  const offset = offsetMinutesAt(zone, epochMs);
  const shifted = new Date(epochMs + offset * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Local-date key ("YYYY-MM-DD") for an instant in a zone. Never UTC-shifted. */
export function localDateKey(zone: ZoneId, epochMs: number): string {
  const civil = utcToZoned(zone, epochMs);
  return `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`;
}

/** Parses "YYYY-MM-DD" into civil parts (throws on malformed input). */
export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) throw new Error(`Invalid date: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid date: ${key}`);
  }
  return { year, month, day };
}

export function isValidDateKey(key: string): boolean {
  try {
    parseDateKey(key);
    return true;
  } catch {
    return false;
  }
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const t = Date.UTC(year, month - 1, day) + days * DAY_MS;
  const d = new Date(t);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addMonths(key: string, months: number): string {
  const { year, month, day } = parseDateKey(key);
  const totalMonths = (year * 12 + (month - 1)) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(newYear, newMonth);
  return toDateKey(newYear, newMonth, Math.min(day, maxDay));
}

export function diffDays(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  const aMs = Date.UTC(a.year, a.month - 1, a.day);
  const bMs = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bMs - aMs) / DAY_MS);
}

/** Start of the week containing `key`, given a 0-6 start day (0 = Sunday). */
export function startOfWeek(key: string, weekStartsOn: number): string {
  const { year, month, day } = parseDateKey(key);
  const dow = dayOfWeek(year, month, day);
  const delta = (dow - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function endOfWeek(key: string, weekStartsOn: number): string {
  return addDays(startOfWeek(key, weekStartsOn), 6);
}

export const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
