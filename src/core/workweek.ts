/**
 * workWeekEngine + payPeriodEngine.
 *
 * The specification is emphatic: a WORK WEEK (overtime) is not a PAY PERIOD
 * (which earnings appear on a cheque). They are modelled separately here and
 * never conflated.
 */
import { addDays, diffDays, parseDateKey, startOfWeek, WEEKDAY_NAMES_EN } from './tz.ts';
import type { PaySchedule, WorkWeekConfig } from './types.ts';

export type WorkWeek = {
  /** Stable key: the local date of the week's first day. */
  key: string;
  start: string;
  end: string;
  /** 0 = Sunday ... 6 = Saturday */
  startsOn: number;
  index: number;
  label: string;
};

/** The work week that contains a given local date. */
export function workWeekFor(dateKey: string, config: WorkWeekConfig): WorkWeek {
  const startsOn = ((config.startsOn % 7) + 7) % 7;
  const averaging = Math.max(1, Math.floor(config.averagingWeeks || 1));
  const weekStart = startOfWeek(dateKey, startsOn);
  let start: string;
  if (averaging > 1) {
    // Averaging cycles align to a real anchor when the user (or their
    // agreement) provides one; otherwise to a stable epoch so the same weeks
    // always group together.
    const anchorStart = config.averagingAnchor ? startOfWeek(config.averagingAnchor, startsOn) : '2000-01-02';
    const diff = diffDays(anchorStart, weekStart);
    const groupIndex = Math.floor(diff / (7 * averaging));
    start = addDays(anchorStart, groupIndex * 7 * averaging);
  } else {
    start = weekStart;
  }
  const end = addDays(start, averaging * 7 - 1);
  const weeksSinceEpoch = Math.floor(diffDays('2000-01-02', start) / 7);
  return {
    key: start,
    start,
    end,
    startsOn,
    index: weeksSinceEpoch,
    label: weekLabel(start, end, averaging),
  };
}

function weekLabel(start: string, end: string, averaging: number): string {
  const s = parseDateKey(start);
  const e = parseDateKey(end);
  const sName = WEEKDAY_NAMES_EN[new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay()].slice(0, 3);
  const eName = WEEKDAY_NAMES_EN[new Date(Date.UTC(e.year, e.month - 1, e.day)).getUTCDay()].slice(0, 3);
  const label = `${sName} ${s.month}/${s.day} – ${eName} ${e.month}/${e.day}`;
  return averaging > 1 ? `${label} (${averaging}-week averaging)` : label;
}

/** All work weeks (grouped when averaging) between two dates, inclusive. */
export function workWeeksInRange(fromDate: string, toDate: string, config: WorkWeekConfig): WorkWeek[] {
  const weeks: WorkWeek[] = [];
  let cursor = workWeekFor(fromDate, config).start;
  let guard = 0;
  while (diffDays(cursor, toDate) >= 0 && guard < 500) {
    guard += 1;
    const week = workWeekFor(cursor, config);
    weeks.push(week);
    cursor = addDays(week.end, 1);
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

export type PayPeriod = {
  index: number;
  start: string;
  end: string;
  /** The date the money lands (may differ from period end). */
  payday: string;
  /** Days covered, inclusive of both ends. */
  days: number;
  label: string;
};

export function periodLengthDays(schedule: PaySchedule): number {
  switch (schedule.frequency) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'semimonthly':
      return -1; // handled specially
    case 'monthly':
      return -2;
    case 'custom':
      return Math.max(1, schedule.customPeriodDays ?? 14);
    default:
      return 14;
  }
}

/**
 * Pay period containing a date. Anchors are authoritative: periods are
 * generated forward and backward from `anchorStart` so historical periods stay
 * stable even when the schedule is edited later (only the anchor matters).
 */
export function payPeriodFor(dateKey: string, schedule: PaySchedule): PayPeriod {
  const anchor = schedule.anchorStart;
  switch (schedule.frequency) {
    case 'semimonthly': {
      const { year, month, day } = parseDateKey(dateKey);
      const anchorParts = parseDateKey(anchor);
      const isFirstHalf = day <= 15;
      const start = `${year}-${String(month).padStart(2, '0')}-${isFirstHalf ? '01' : '16'}`;
      const end = isFirstHalf
        ? `${year}-${String(month).padStart(2, '0')}-15`
        : `${year}-${String(month).padStart(2, '0')}-${daysInMonth(year, month)}`;
      const monthsSinceAnchor = (year - anchorParts.year) * 12 + (month - anchorParts.month);
      const index = monthsSinceAnchor * 2 + (isFirstHalf ? 0 : 1);
      return buildPeriod(start, end, index, schedule);
    }
    case 'monthly': {
      const { year, month } = parseDateKey(dateKey);
      const anchorParts = parseDateKey(anchor);
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = `${year}-${String(month).padStart(2, '0')}-${daysInMonth(year, month)}`;
      const index = (year - anchorParts.year) * 12 + (month - anchorParts.month);
      return buildPeriod(start, end, index, schedule);
    }
    default: {
      const length = periodLengthDays(schedule);
      const delta = diffDays(anchor, dateKey);
      const index = Math.floor(delta / length);
      const start = addDays(anchor, index * length);
      const end = addDays(start, length - 1);
      return buildPeriod(start, end, index, schedule);
    }
  }
}

function buildPeriod(start: string, end: string, index: number, schedule: PaySchedule): PayPeriod {
  const payday = addDays(end, Math.max(0, Math.round(schedule.paydayOffsetDays)));
  return {
    index,
    start,
    end,
    payday,
    days: diffDays(start, end) + 1,
    label: periodLabel(start, end),
  };
}

export function periodLabel(start: string, end: string): string {
  const s = parseDateKey(start);
  const e = parseDateKey(end);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (s.year === e.year && s.month === e.month) return `${MONTHS[s.month - 1]} ${s.day}–${e.day}, ${s.year}`;
  if (s.year === e.year) return `${MONTHS[s.month - 1]} ${s.day} – ${MONTHS[e.month - 1]} ${e.day}, ${s.year}`;
  return `${MONTHS[s.month - 1]} ${s.day}, ${s.year} – ${MONTHS[e.month - 1]} ${e.day}, ${e.year}`;
}

/** The next period (direction +1) or previous period (direction -1). */
export function adjacentPeriod(period: PayPeriod, schedule: PaySchedule, direction: 1 | -1): PayPeriod {
  const reference = direction > 0 ? addDays(period.end, 1) : addDays(period.start, -1);
  return payPeriodFor(reference, schedule);
}

/** The N periods following (positive) or preceding (negative) the period of `dateKey`. */
export function shiftPeriod(dateKey: string, schedule: PaySchedule, periods: number): PayPeriod {
  let period = payPeriodFor(dateKey, schedule);
  const direction: 1 | -1 = periods >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(periods); i += 1) {
    period = adjacentPeriod(period, schedule, direction);
  }
  return period;
}

/** All periods between two dates (inclusive), oldest first. */
export function payPeriodsInRange(fromDate: string, toDate: string, schedule: PaySchedule, maxPeriods = 240): PayPeriod[] {
  const periods: PayPeriod[] = [];
  let period = payPeriodFor(fromDate, schedule);
  let guard = 0;
  while (guard < maxPeriods) {
    guard += 1;
    if (period.start > toDate) break;
    periods.push(period);
    period = adjacentPeriod(period, schedule, 1);
  }
  return periods;
}

/** Number of pay periods in a calendar year, used for YTD math. */
export function periodsPerYear(schedule: PaySchedule): number {
  switch (schedule.frequency) {
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'semimonthly':
      return 24;
    case 'monthly':
      return 12;
    default:
      return Math.max(1, Math.round(365 / periodLengthDays(schedule)));
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
