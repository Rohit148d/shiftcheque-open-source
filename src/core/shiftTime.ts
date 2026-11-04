/**
 * shiftTimeEngine — converts a shift's scheduled/actual wall-clock times into
 * paid MINUTES, handling overnight shifts, DST, breaks and rounding.
 *
 * Precedence (spec 14), implemented exactly here and covered by tests:
 *   1. explicit paidMinutesOverride
 *   2. actual times (when the shift is marked worked and has actual times)
 *   3. scheduled times
 */
import { applyRounding, type Minutes } from './duration.ts';
import { localDateKey, utcToZoned, zonedToUtc, type ZoneId } from './tz.ts';
import type { BreakRule, Shift, TimeSegment } from './types.ts';
import { EARNING_SHIFT_TYPES } from './types.ts';

export type PaidTimeSource = 'override' | 'actual' | 'scheduled';

export type ShiftTimeResult = {
  /** Minutes according to the schedule (never overwritten by actual time). */
  scheduledMinutes: Minutes;
  /** Minutes actually worked (0 when unknown/not worked). */
  actualMinutes: Minutes;
  /** Minutes that count for pay, after the precedence rules and rounding. */
  paidMinutes: Minutes;
  paidUnroundedMinutes: Minutes;
  unpaidBreakMinutes: Minutes;
  paidBreakMinutes: Minutes;
  roundingDeltaMinutes: Minutes;
  source: PaidTimeSource;
  /** Wall-clock minutes between start and end, before breaks (DST aware). */
  elapsedMinutes: Minutes;
  /** Non-zero when a DST transition changed the length of the shift. */
  dstAnomalyMinutes: Minutes;
  startMs: number;
  endMs: number;
  dateKey: string;
  /** Segments (split at local midnight) used by the overtime + premium engines. */
  segments: TimeSegment[];
  warnings: ShiftWarning[];
};

export type ShiftWarning =
  | 'crosses_midnight'
  | 'dst_spring_forward'
  | 'dst_fall_back'
  | 'unpaid_break_exceeds_shift'
  | 'actual_without_scheduled';

export function parseClockTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${value}`);
  return { hour, minute };
}

export function formatClockTime(hour: number, minute: number): string {
  return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Minutes since local midnight for a "HH:MM" string. */
export function clockToMinutes(value: string): number {
  const { hour, minute } = parseClockTime(value);
  return hour * 60 + minute;
}

export function minutesToClock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return formatClockTime(Math.floor(wrapped / 60), wrapped % 60);
}

/**
 * Resolves a shift's start/end instants from a local date + wall-clock times,
 * shifting the end to the next day when needed.
 */
export function resolveShiftInstants(
  zone: ZoneId,
  dateKey: string,
  startClock: string,
  endClock: string,
  forceOvernight?: boolean,
): { startMs: number; endMs: number; overnight: boolean } {
  const [year, month, day] = dateKey.split('-').map(Number);
  const start = parseClockTime(startClock);
  const end = parseClockTime(endClock);
  const startMs = zonedToUtc(zone, { year, month, day, hour: start.hour, minute: start.minute });
  const sameDayEndMs = zonedToUtc(zone, { year, month, day, hour: end.hour, minute: end.minute });
  const impliedOvernight = end.hour * 60 + end.minute < start.hour * 60 + start.minute;
  const overnight = forceOvernight === true ? true : impliedOvernight;
  let endMs = sameDayEndMs;
  if (overnight || sameDayEndMs < startMs) {
    const nextDay = addDaysLocal(dateKey, 1);
    const [y2, m2, d2] = nextDay.split('-').map(Number);
    endMs = zonedToUtc(zone, { year: y2, month: m2, day: d2, hour: end.hour, minute: end.minute });
  }
  return { startMs, endMs, overnight };
}

function addDaysLocal(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const t = Date.UTC(year, month - 1, day) + days * 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Splits an instant range into segments that do not cross local midnight. */
export function splitAtLocalMidnight(zone: ZoneId, startMs: number, endMs: number): TimeSegment[] {
  const segments: TimeSegment[] = [];
  if (endMs <= startMs) return segments;
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard < 400) {
    guard += 1;
    const civil = utcToZoned(zone, cursor);
    const nextDay = addDaysLocal(
      `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`,
      1,
    );
    const [y2, m2, d2] = nextDay.split('-').map(Number);
    const dayEnd = zonedToUtc(zone, { year: y2, month: m2, day: d2, hour: 0, minute: 0 });
    const sliceEnd = Math.min(dayEnd, endMs);
    const minutes = Math.round((sliceEnd - cursor) / 60_000);
    if (minutes > 0) {
      const startCivil = utcToZoned(zone, cursor);
      const endCivil = utcToZoned(zone, sliceEnd);
      const localStartMinute = startCivil.hour * 60 + startCivil.minute;
      let localEndMinute = endCivil.hour * 60 + endCivil.minute;
      if (localEndMinute <= localStartMinute) localEndMinute += 1440;
      segments.push({
        startMs: cursor,
        endMs: sliceEnd,
        minutes,
        dateKey: `${startCivil.year}-${String(startCivil.month).padStart(2, '0')}-${String(startCivil.day).padStart(2, '0')}`,
        localStartMinute,
        localEndMinute,
      });
    }
    cursor = sliceEnd;
  }
  return segments;
}

/** Builds TimeSegment objects from raw instant intervals. */
function segmentsFromIntervals(
  zone: ZoneId,
  intervals: { startMs: number; endMs: number }[],
  shiftId: string,
): TimeSegment[] {
  const segments: TimeSegment[] = [];
  for (const interval of intervals) {
    for (const slice of splitAtLocalMidnight(zone, interval.startMs, interval.endMs)) {
      segments.push({ ...slice, shiftId });
    }
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Removes unpaid break minutes from the middle of the worked span.
 *
 * Breaks in the app do not carry a clock time (most workers just enter "30
 * minutes unpaid"), so removing them from the MIDDLE keeps the start and the
 * end of the shift intact for overtime and premium windows while the PAID total
 * stays exact.
 */
export function subtractUnpaidFromMiddle(
  zone: ZoneId,
  intervals: { startMs: number; endMs: number }[],
  unpaidMinutes: number,
  shiftId: string,
): TimeSegment[] {
  if (unpaidMinutes <= 0 || intervals.length === 0) return segmentsFromIntervals(zone, intervals, shiftId);
  const totalMinutes = intervals.reduce(
    (sum, interval) => sum + Math.round((interval.endMs - interval.startMs) / 60_000),
    0,
  );
  if (totalMinutes <= 0) return [];
  const remove = Math.min(unpaidMinutes, totalMinutes);
  const spanStart = intervals[0].startMs;
  const spanEnd = intervals[intervals.length - 1].endMs;
  const midpoint = spanStart + (spanEnd - spanStart) / 2;
  const removeStart = midpoint - (remove * 60_000) / 2;
  const removeEnd = removeStart + remove * 60_000;

  const kept: { startMs: number; endMs: number }[] = [];
  for (const interval of intervals) {
    if (interval.endMs <= removeStart || interval.startMs >= removeEnd) {
      kept.push(interval);
      continue;
    }
    if (interval.startMs < removeStart) kept.push({ startMs: interval.startMs, endMs: Math.round(removeStart) });
    if (interval.endMs > removeEnd) kept.push({ startMs: Math.round(removeEnd), endMs: interval.endMs });
  }
  return segmentsFromIntervals(zone, kept, shiftId);
}

/** Grows or trims the tail of a segment list so the total matches `targetMinutes`. */
export function adjustSegmentsTotal(
  zone: ZoneId,
  segments: TimeSegment[],
  targetMinutes: number,
  shiftId: string,
): TimeSegment[] {
  if (segments.length === 0) return segments;
  const total = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  const delta = targetMinutes - total;
  if (delta === 0) return segments;
  const intervals = segments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs }));
  if (delta > 0) {
    intervals[intervals.length - 1] = {
      startMs: intervals[intervals.length - 1].startMs,
      endMs: intervals[intervals.length - 1].endMs + delta * 60_000,
    };
  } else {
    let remaining = -delta;
    for (let index = intervals.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const span = Math.round((intervals[index].endMs - intervals[index].startMs) / 60_000);
      const take = Math.min(span, remaining);
      intervals[index] = { startMs: intervals[index].startMs, endMs: intervals[index].endMs - take * 60_000 };
      remaining -= take;
    }
  }
  return segmentsFromIntervals(
    zone,
    intervals.filter((interval) => interval.endMs > interval.startMs),
    shiftId,
  );
}

export type ShiftTimeOptions = {
  zone: ZoneId;
  /** How the employer treats a DST clock change. */
  dstPolicy?: 'wall_clock' | 'elapsed';
  rounding?: { step: number; mode: 'exact' | 'nearest' | 'up' | 'down' };
};

export function computeShiftTime(shift: Shift, options: ShiftTimeOptions): ShiftTimeResult {
  const { zone } = options;
  const dstPolicy = options.dstPolicy ?? 'wall_clock';
  const warnings: ShiftWarning[] = [];
  const scheduled = resolveShiftInstants(
    zone,
    shift.date,
    shift.scheduledStart,
    shift.scheduledEnd,
    shift.scheduledOvernight,
  );
  const elapsedScheduled = Math.round((scheduled.endMs - scheduled.startMs) / 60_000);

  const workTypes = EARNING_SHIFT_TYPES.includes(shift.type);
  const scheduledUnpaid = shift.breaks.filter((b) => !b.paid).reduce((sum, b) => sum + b.minutes, 0);
  const scheduledPaidBreaks = shift.breaks.filter((b) => b.paid).reduce((sum, b) => sum + b.minutes, 0);
  let scheduledSegmentsAll = subtractUnpaidFromMiddle(
    zone,
    [{ startMs: scheduled.startMs, endMs: scheduled.endMs }],
    scheduledUnpaid,
    shift.id,
  );
  let scheduledMinutes = elapsedScheduled - scheduledUnpaid;
  if (dstPolicy === 'wall_clock') {
    // Pay the scheduled wall-clock duration (an 8 hour night shift stays 8
    // paid hours even when the clock jumps).
    const naive = naiveClockMinutes(shift.scheduledStart, shift.scheduledEnd, scheduled.overnight);
    scheduledMinutes = naive - scheduledUnpaid;
  }
  if (scheduledMinutes < 0) {
    scheduledMinutes = 0;
    warnings.push('unpaid_break_exceeds_shift');
  }
  // Keep the segments consistent with the paid total (matters on DST nights
  // and when a paid-hours override is in play).
  scheduledSegmentsAll = adjustSegmentsTotal(zone, scheduledSegmentsAll, scheduledMinutes, shift.id);

  const hasActual = Boolean(shift.actualStart && shift.actualEnd);
  let actualMinutes = 0;
  let actualSegments: TimeSegment[] = [];
  let elapsedActual = 0;
  const actualUnpaid = scheduledUnpaid;
  const actualPaidBreaks = scheduledPaidBreaks;
  if (hasActual) {
    const actual = resolveShiftInstants(
      zone,
      shift.date,
      shift.actualStart as string,
      shift.actualEnd as string,
      shift.actualOvernight ?? shift.scheduledOvernight,
    );
    if (!shift.scheduledOvernight && actual.overnight) warnings.push('actual_without_scheduled');
    elapsedActual = Math.round((actual.endMs - actual.startMs) / 60_000);
    actualSegments = subtractUnpaidFromMiddle(
      zone,
      [{ startMs: actual.startMs, endMs: actual.endMs }],
      actualUnpaid,
      shift.id,
    );
    actualMinutes = Math.max(0, elapsedActual - actualUnpaid);
  }

  // Precedence
  let source: PaidTimeSource = 'scheduled';
  let paidUnrounded = scheduledMinutes;
  let segments: TimeSegment[] = scheduledSegmentsAll;
  let startMs = scheduled.startMs;
  let endMs = scheduled.endMs;

  if (hasActual && shift.confirmed) {
    source = 'actual';
    paidUnrounded = actualMinutes;
    segments = actualSegments;
    startMs = segments[0]?.startMs ?? scheduled.startMs;
    endMs = segments[segments.length - 1]?.endMs ?? scheduled.endMs;
  }
  const rounding: { step: number; mode: 'exact' | 'nearest' | 'up' | 'down' } =
    shift.rounding ?? options.rounding ?? { step: 0, mode: 'exact' };
  let paidMinutes = applyRounding(paidUnrounded, rounding.step as never, rounding.mode);
  if (shift.paidMinutesOverride !== undefined && shift.paidMinutesOverride !== null) {
    source = 'override';
    paidMinutes = Math.max(0, Math.round(shift.paidMinutesOverride));
    paidUnrounded = paidMinutes;
  }
  if (!workTypes) {
    paidMinutes = 0;
    paidUnrounded = 0;
  }

  const dstAnomaly = elapsedScheduled - naiveClockMinutes(shift.scheduledStart, shift.scheduledEnd, scheduled.overnight);
  if (dstAnomaly < 0) warnings.push('dst_spring_forward');
  if (dstAnomaly > 0) warnings.push('dst_fall_back');
  if (scheduled.overnight) warnings.push('crosses_midnight');

  return {
    scheduledMinutes,
    actualMinutes: hasActual ? actualMinutes : 0,
    paidMinutes,
    paidUnroundedMinutes: paidUnrounded,
    unpaidBreakMinutes: actualUnpaid,
    paidBreakMinutes: actualPaidBreaks,
    roundingDeltaMinutes: paidMinutes - paidUnrounded,
    source,
    elapsedMinutes: source === 'actual' ? elapsedActual : elapsedScheduled,
    dstAnomalyMinutes: dstAnomaly,
    startMs,
    endMs,
    dateKey: localDateKey(zone, startMs),
    segments,
    warnings,
  };
}

/** Difference between two wall-clock times ignoring DST (minutes, may exceed 1440). */
export function naiveClockMinutes(startClock: string, endClock: string, overnight: boolean): Minutes {
  const start = clockToMinutes(startClock);
  const end = clockToMinutes(endClock);
  let diff = end - start;
  if (overnight || (diff < 0 && !overnight)) diff += 1440;
  return diff;
}

/** Live shift elapsed minutes derived from persisted timestamps (no timers). */
export function liveElapsedMinutes(shift: Shift, nowMs: number): Minutes {
  if (shift.liveStartedAtMs === undefined) return 0;
  const accumulated = shift.liveAccumulatedMinutes ?? 0;
  if (shift.liveBreakStartedAtMs !== undefined) return accumulated;
  return accumulated + Math.max(0, Math.round((nowMs - shift.liveStartedAtMs) / 60_000));
}

export function totalBreakMinutes(breaks: BreakRule[]): { paid: Minutes; unpaid: Minutes } {
  return breaks.reduce(
    (acc, b) => (b.paid ? { ...acc, paid: acc.paid + b.minutes } : { ...acc, unpaid: acc.unpaid + b.minutes }),
    { paid: 0, unpaid: 0 },
  );
}
