import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculatePayPeriod, splitSegmentsByWorkedShare, type PayPeriodCalculation } from '../src/core/calculate.ts';
import { calculateExtraShift } from '../src/core/extraShift.ts';
import { classifyShiftProgress } from '../src/core/shiftProgress.ts';
import { payPeriodFor } from '../src/core/workweek.ts';
import { BUNDLED_RULE_BUNDLE } from '../src/rules/bundle.ts';
import { resolveRules } from '../src/rules/loader.ts';
import { calculationCacheKey, createCalculationCache, shiftsFingerprint } from '../src/state/calculationCache.ts';
import type { Job, Shift } from '../src/core/types.ts';
import { makeJob, makeProfile, makeShift, money, premium, TZ } from './helpers.ts';

const TODAY = '2026-10-20';
/** Midday instant so live-shift math is deterministic. */
const NOW = Date.parse('2026-10-20T12:00:00Z');
const RATE = '31.00';

/** 7.5 paid hours, no unpaid break, so the arithmetic is exact. */
function sevenAndAHalfHourShift(id: string, date: string, overrides: Partial<Shift> = {}): Shift {
  return makeShift({
    id,
    date,
    scheduledStart: '08:00',
    scheduledEnd: '15:30',
    scheduledOvernight: false,
    breaks: [],
    ...overrides,
  });
}

function workedShift(id: string, date: string, overrides: Partial<Shift> = {}): Shift {
  return sevenAndAHalfHourShift(id, date, { status: 'completed', confirmed: true, ...overrides });
}

/** The reported case: 8 completed shifts (60 h) + 2 scheduled shifts (15 h). */
function reportedScenario(jobOverrides: Partial<Job> = {}, shiftOverrides: { scheduled?: Partial<Shift> } = {}) {
  const job: Job = makeJob({
    jurisdiction: 'ON',
    taxProvince: 'ON',
    hourlyRate: money(RATE),
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
    ...jobOverrides,
  });
  const period = payPeriodFor(TODAY, job.paySchedule);
  const shifts: Shift[] = [
    workedShift('w-08', '2026-10-08'),
    workedShift('w-09', '2026-10-09'),
    workedShift('w-12', '2026-10-12'),
    workedShift('w-13', '2026-10-13'),
    workedShift('w-14', '2026-10-14'),
    workedShift('w-15', '2026-10-15'),
    workedShift('w-16', '2026-10-16'),
    workedShift('w-19', '2026-10-19'),
    sevenAndAHalfHourShift('s-20', '2026-10-20', shiftOverrides.scheduled),
    sevenAndAHalfHourShift('s-21', '2026-10-21', shiftOverrides.scheduled),
  ];
  const rates = [{ id: 'r1', jobId: job.id, rate: money(RATE), effectiveFrom: '2025-01-01' }];
  const rules = resolveRules({
    bundle: BUNDLED_RULE_BUNDLE,
    job,
    date: period.payday,
    fromDate: period.start,
    toDate: period.end,
    serviceStartDate: '2020-01-01',
  });
  const result = calculatePayPeriod({
    job,
    rates,
    shifts,
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  return { job, period, shifts, rates, rules, result };
}

const hours = (minutes: number) => minutes / 60;

// ---------------------------------------------------------------------------
// 1. The reported regression: 60 worked + 15 scheduled = 75 projected
// ---------------------------------------------------------------------------

test('reported case: worked / scheduled / projected are 60 / 15 / 75 hours', () => {
  const { result, period } = reportedScenario();
  assert.equal(period.start, '2026-10-08');
  assert.equal(period.end, '2026-10-21');
  assert.equal(hours(result.projection.workedMinutes), 60);
  assert.equal(hours(result.projection.scheduledMinutes), 15);
  assert.equal(hours(result.projection.projectedMinutes), 75);
  assert.equal(result.projection.worked.shiftCount, 8);
  assert.equal(result.projection.scheduled.shiftCount, 2);
  // totalPaidMinutes stays the projection, so nothing downstream loses the forecast
  assert.equal(result.totalPaidMinutes, result.projection.projectedMinutes);
});

test('reported case: gross is $1,860 worked, $465 scheduled, $2,325 projected (not $1,860)', () => {
  const { result } = reportedScenario();
  assert.equal(result.projection.worked.gross, money('1860.00'));
  assert.equal(result.projection.scheduled.gross, money('465.00'));
  assert.equal(result.projection.projected.gross, money('2325.00'));
  // the Next Pay basis is the projection
  assert.equal(result.gross.gross, money('2325.00'));
  assert.notEqual(result.gross.gross, money('1860.00'));
  assert.equal(result.gross.regularMinutes, 4500);
  // no overtime, no premiums in this scenario
  assert.equal(result.overtime.overtimeMinutes, 0);
  assert.equal(result.gross.premiumPay, 0n);
});

test('reported case: take-home is derived from the projected gross', () => {
  const { result } = reportedScenario();
  assert.equal(result.deductions.gross, money('2325.00'));
  assert.ok(result.deductions.net < result.deductions.gross, 'deductions reduce the projected gross');
  assert.ok(result.deductions.net > money('1800'), `take-home on 75 h at $31 lands around $1,850 (got ${result.deductions.net})`);
  assert.ok(result.deductions.net < money('1950'), 'and not above the projected gross');
});

test('the projection adds up: worked + scheduled equals projected in every dimension', () => {
  const { result } = reportedScenario();
  const { worked, scheduled, projected } = result.projection;
  assert.equal(worked.minutes + scheduled.minutes, projected.minutes);
  assert.equal(worked.overtimeMinutes + scheduled.overtimeMinutes, projected.overtimeMinutes);
  assert.equal(worked.doubleTimeMinutes + scheduled.doubleTimeMinutes, projected.doubleTimeMinutes);
  assert.equal(worked.gross + scheduled.gross, projected.gross);
  assert.equal(worked.shiftCount + scheduled.shiftCount, projected.shiftCount);
});

// ---------------------------------------------------------------------------
// 2. Shift classification
// ---------------------------------------------------------------------------

test('shift progress classification follows the documented precedence', () => {
  assert.equal(classifyShiftProgress(workedShift('a', '2026-10-01'), TODAY), 'worked');
  assert.equal(classifyShiftProgress(makeShift({ id: 'b', date: '2026-10-01', status: 'scheduled' }), TODAY), 'worked', 'past scheduled shifts count as worked');
  assert.equal(classifyShiftProgress(makeShift({ id: 'c', date: '2026-10-25' }), TODAY), 'scheduled');
  assert.equal(classifyShiftProgress(makeShift({ id: 'd', date: '2026-10-25', status: 'in_progress' }), TODAY), 'in_progress');
  assert.equal(classifyShiftProgress(makeShift({ id: 'e', date: '2026-10-25', status: 'missed' }), TODAY), 'excluded');
  assert.equal(classifyShiftProgress(makeShift({ id: 'f', date: '2026-10-25', type: 'off' }), TODAY), 'excluded');
  assert.equal(classifyShiftProgress(makeShift({ id: 'g', date: '2026-10-25', type: 'vacation' }), TODAY), 'excluded');
});

test('all shifts already worked: nothing is scheduled and projected equals worked', () => {
  const { result, shifts } = reportedScenario();
  const onlyWorked = shifts.filter((shift) => classifyShiftProgress(shift, TODAY) === 'worked');
  const job = makeJob({
    jurisdiction: 'ON',
    taxProvince: 'ON',
    hourlyRate: money(RATE),
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
  });
  const period = payPeriodFor(TODAY, job.paySchedule);
  const calculation = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money(RATE), effectiveFrom: '2025-01-01' }],
    shifts: onlyWorked,
    period,
    today: TODAY,
    rules: resolveRules({
      bundle: BUNDLED_RULE_BUNDLE,
      job,
      date: period.payday,
      fromDate: period.start,
      toDate: period.end,
      serviceStartDate: '2020-01-01',
    }),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(calculation.projection.scheduledMinutes, 0);
  assert.equal(calculation.projection.scheduled.gross, 0n);
  assert.equal(calculation.projection.projectedMinutes, calculation.projection.workedMinutes);
  assert.equal(calculation.projection.projected.gross, calculation.projection.worked.gross);
  void result;
});

test('a future shift marked missed (cancelled) is excluded from the projection', () => {
  const { result } = reportedScenario({}, { scheduled: { status: 'missed' } });
  assert.equal(hours(result.projection.workedMinutes), 60);
  assert.equal(hours(result.projection.scheduledMinutes), 0);
  assert.equal(hours(result.projection.projectedMinutes), 60);
  assert.equal(result.projection.projected.gross, money('1860.00'));
  assert.equal(result.periodShifts.length, 10, 'the cancelled shifts still belong to the period');
});

test('a future shift marked sick does not add hours (vacation/sick pay stays with the configured rules)', () => {
  const { result } = reportedScenario({}, { scheduled: { type: 'sick' } });
  assert.equal(hours(result.projection.workedMinutes), 60);
  assert.equal(hours(result.projection.scheduledMinutes), 0);
  assert.equal(result.projection.projected.gross, money('1860.00'));
});

test('a live in-progress shift splits into worked-so-far and still-scheduled', () => {
  // 07:00–15:30 shift (7.5 h paid) starting at 08:00 local; "now" is 12:00 local.
  const live = makeShift({
    id: 'live',
    date: '2026-10-20',
    scheduledStart: '08:00',
    scheduledEnd: '15:30',
    breaks: [],
    status: 'in_progress',
    liveStartedAtMs: Date.parse('2026-10-20T12:00:00Z'), // 08:00 EDT
    liveAccumulatedMinutes: 0,
  });
  const { shifts, job, period, rates, rules } = reportedScenario();
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts: [...shifts.filter((shift) => shift.id !== 's-20'), live],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: Date.parse('2026-10-20T16:00:00Z'), // 12:00 EDT → four hours elapsed
  });
  const liveWorked = calculation.projection.workedMinutes - 3600; // 8 completed shifts = 60 h
  assert.equal(liveWorked, 240, 'four elapsed hours count as worked');
  assert.equal(hours(calculation.projection.scheduledMinutes), 11, '3.5 h left on the live shift + 7.5 h tomorrow');
  assert.equal(
    calculation.projection.workedMinutes + calculation.projection.scheduledMinutes,
    calculation.projection.projectedMinutes,
    'the live shift is split, never double counted',
  );
  assert.equal(hours(calculation.projection.projectedMinutes), 75);
});

// ---------------------------------------------------------------------------
// 3. Boundaries: pay period, work week, midnight, employers
// ---------------------------------------------------------------------------

test('an overnight shift crossing midnight stays with the day it starts', () => {
  const { job, period, rates, rules, shifts } = reportedScenario();
  const overnight = makeShift({
    id: 'night',
    date: '2026-10-21',
    scheduledStart: '22:00',
    scheduledEnd: '06:00',
    scheduledOvernight: true,
    breaks: [],
  });
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts: [...shifts.filter((shift) => shift.id !== 's-21'), overnight],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  const summary = calculation.projection.scheduled;
  assert.equal(hours(summary.minutes), 15.5, 'the 7.5 h day shift plus the 8 h overnight shift');
  assert.equal(calculation.shiftTimes.get('night')?.segments.length, 2, 'split at local midnight');
});

test('a shift that crosses the pay-period boundary is counted once, in the period it starts', () => {
  const { job, period, rates, rules } = reportedScenario();
  const boundary = makeShift({
    id: 'boundary',
    date: period.end, // starts on the last day of the period
    scheduledStart: '22:00',
    scheduledEnd: '06:00',
    scheduledOvernight: true,
    breaks: [],
  });
  const thisPeriod = calculatePayPeriod({
    job,
    rates,
    shifts: [boundary],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(hours(thisPeriod.projection.projectedMinutes), 8, 'the whole shift belongs to the period it starts in');

  const nextPeriod = payPeriodFor('2026-10-22', job.paySchedule);
  const next = calculatePayPeriod({
    job,
    rates,
    shifts: [boundary],
    period: nextPeriod,
    today: TODAY,
    rules: resolveRules({
      bundle: BUNDLED_RULE_BUNDLE,
      job,
      date: nextPeriod.payday,
      fromDate: nextPeriod.start,
      toDate: nextPeriod.end,
      serviceStartDate: '2020-01-01',
    }),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(next.projection.projectedMinutes, 0, 'it is not counted again in the next period');
});

test('a future shift outside the current pay period is not pulled into this forecast', () => {
  const { job, period, rates, rules, shifts } = reportedScenario();
  const nextPeriodShift = sevenAndAHalfHourShift('next-period', '2026-10-22');
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts: [...shifts, nextPeriodShift],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(hours(calculation.projection.projectedMinutes), 75);
  assert.equal(
    calculation.periodShifts.some((shift) => shift.id === 'next-period'),
    false,
    'next-period work stays out of this period',
  );
});

test('two employers are never combined', () => {
  const { result: jobA } = reportedScenario({ id: 'job-a', name: 'Warehouse' });
  const { result: jobB } = reportedScenario({ id: 'job-b', name: 'Hospital' });
  assert.equal(hours(jobA.projection.projectedMinutes), 75);
  assert.equal(hours(jobB.projection.projectedMinutes), 75);
  // Each calculation only sees its own shifts: 60 + 15 for both, never 150.
  const totalShiftsA = jobA.projection.projected.shiftCount;
  const totalShiftsB = jobB.projection.projected.shiftCount;
  assert.equal(totalShiftsA, 10);
  assert.equal(totalShiftsB, 10);
});

// ---------------------------------------------------------------------------
// 4. Overtime forecasting
// ---------------------------------------------------------------------------

test('scheduled future work is included in projected overtime, but not in worked overtime', () => {
  // Ontario: 44 h weekly threshold. Week of Oct 18–24: 39 h worked + 8 h scheduled.
  const { job, period, rates, rules } = reportedScenario();
  const shifts = [
    workedShift('a-18', '2026-10-18', { scheduledStart: '08:00', scheduledEnd: '21:00' }), // 13 h
    workedShift('a-19', '2026-10-19', { scheduledStart: '08:00', scheduledEnd: '21:00' }), // 13 h
    workedShift('a-20-morning', '2026-10-20', { scheduledStart: '00:00', scheduledEnd: '07:00' }), // 7 h
    workedShift('a-20-mid', '2026-10-20', { scheduledStart: '07:00', scheduledEnd: '13:00' }), // 6 h -> 39 h so far
    sevenAndAHalfHourShift('s-21', '2026-10-21', { scheduledStart: '08:00', scheduledEnd: '16:30' }), // 8.5 h scheduled
  ];
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts,
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  const week = calculation.radar;
  assert.equal(hours(week.workedMinutes), 39);
  assert.equal(hours(week.projectedMinutes), 47.5);
  assert.equal(hours(week.overtimeMinutes), 0, 'nothing worked has crossed the threshold yet');
  assert.equal(hours(week.projectedOvertimeMinutes), 3.5, 'the scheduled shift crosses 44 h');
  assert.equal(week.remainingMinutes, 0, 'no room left before the threshold once the schedule is counted');
});

test('a scheduled shift can create daily overtime without any worked overtime', () => {
  const job = makeJob({
    jurisdiction: 'AB', // 8 h/day and 44 h/week
    taxProvince: 'AB',
    zone: 'America/Edmonton',
    hourlyRate: money(RATE),
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
  });
  const period = payPeriodFor(TODAY, job.paySchedule);
  const scheduledLongDay = makeShift({
    id: 'ab-long',
    date: '2026-10-21',
    scheduledStart: '07:00',
    scheduledEnd: '17:00', // 10 h
    breaks: [],
  });
  const rules = resolveRules({
    bundle: BUNDLED_RULE_BUNDLE,
    job,
    date: period.payday,
    fromDate: period.start,
    toDate: period.end,
    serviceStartDate: '2020-01-01',
  });
  const calculation = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money(RATE), effectiveFrom: '2025-01-01' }],
    shifts: [scheduledLongDay],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(hours(calculation.projection.scheduledMinutes), 10);
  assert.equal(hours(calculation.projection.scheduled.overtimeMinutes), 2, '2 h over the 8 h daily threshold');
  assert.equal(hours(calculation.projection.worked.overtimeMinutes), 0);
  assert.ok(calculation.gross.overtimePay > 0n, 'the projected overtime is paid in the forecast');
});

test('the radar distinguishes worked from scheduled and never presents scheduled work as done', () => {
  const { result } = reportedScenario();
  // Week of Oct 18–24 holds one worked shift (7.5 h) and two scheduled (15 h).
  assert.equal(hours(result.radar.workedMinutes), 7.5);
  assert.equal(hours(result.radar.scheduledRemainingMinutes), 15);
  assert.equal(hours(result.radar.projectedMinutes), 22.5);
  assert.equal(hours(result.radar.projectedOvertimeMinutes), 0);
});

// ---------------------------------------------------------------------------
// 5. Rates, premiums, actuals
// ---------------------------------------------------------------------------

test('a rate change inside the period applies to scheduled work only', () => {
  const { job, period, rules, shifts } = reportedScenario();
  const rates = [
    { id: 'r1', jobId: job.id, rate: money('31.00'), effectiveFrom: '2025-01-01' },
    { id: 'r2', jobId: job.id, rate: money('35.00'), effectiveFrom: '2026-10-20' },
  ];
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts,
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(calculation.projection.worked.gross, money('1860.00'), '60 h at the old rate');
  assert.equal(calculation.projection.scheduled.gross, money('525.00'), '15 h at the new rate');
  assert.equal(calculation.projection.projected.gross, money('2385.00'));
});

test('a premium scheduled in the future lands in scheduled gross, not worked gross', () => {
  const nightRule = premium({
    id: 'night',
    label: 'Night premium',
    type: 'per_hour',
    amount: money('1.25'),
    window: { startMinute: 22 * 60, endMinute: 6 * 60 },
  });
  const { job, period, rates, rules, shifts } = reportedScenario({ premiums: [nightRule] });
  const nightShift = makeShift({
    id: 'night-22',
    date: '2026-10-21',
    scheduledStart: '22:00',
    scheduledEnd: '06:00',
    scheduledOvernight: true,
    breaks: [],
  });
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts: [...shifts.filter((shift) => shift.id !== 's-21'), nightShift],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(calculation.projection.worked.gross, money('1860.00'), 'no premium on the worked side');
  // 7.5 h day shift ($232.50) + 8 h night shift ($248) + 8 h × $1.25 night premium ($10), no vacation configured
  assert.equal(calculation.projection.scheduled.gross, money('490.50'));
  assert.ok(calculation.gross.premiumPay >= money('10.00'), 'the scheduled night shift carries its premium');
  assert.ok(calculation.gross.lines.some((line) => line.label === 'Night premium' && line.minutes === 480));
});

test('actual hours longer than scheduled are what get counted as worked', () => {
  const { job, period, rates, rules, shifts } = reportedScenario();
  const extended = workedShift('w-19', '2026-10-19', {
    scheduledStart: '08:00',
    scheduledEnd: '15:30',
    actualStart: '08:00',
    actualEnd: '16:30',
    actualOvernight: false,
    confirmed: true,
  });
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts: [...shifts.filter((shift) => shift.id !== 'w-19'), extended],
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(hours(calculation.projection.workedMinutes), 61, '60 h + one extra hour actually worked');
  assert.equal(calculation.projection.worked.gross, money('1891.00'), '61 h at $31');
  assert.equal(hours(calculation.projection.scheduledMinutes), 15);
});

test('splitSegmentsByWorkedShare keeps the totals intact', () => {
  const segments = [
    { startMs: 0, endMs: 3_600_000, minutes: 60, dateKey: '2026-10-20', localStartMinute: 480, localEndMinute: 540, overtimeKind: 'none' as const, multiplier: 1, shiftId: 'x' },
    { startMs: 3_600_000, endMs: 7_200_000, minutes: 60, dateKey: '2026-10-20', localStartMinute: 540, localEndMinute: 600, overtimeKind: 'none' as const, multiplier: 1, shiftId: 'x' },
  ];
  const half = splitSegmentsByWorkedShare(segments, 0.5);
  const totalWorked = half.worked.reduce((sum, segment) => sum + segment.minutes, 0);
  const totalRemaining = half.remaining.reduce((sum, segment) => sum + segment.minutes, 0);
  assert.equal(totalWorked, 60);
  assert.equal(totalRemaining, 60);
  assert.equal(totalWorked + totalRemaining, 120);
  // local minute ranges stay contiguous
  assert.equal(half.worked[0].localEndMinute, half.remaining[0].localStartMinute);
});

// ---------------------------------------------------------------------------
// 5b. "What is another shift worth?" must account for already-scheduled work
// ---------------------------------------------------------------------------

test('the extra-shift calculator counts already-scheduled shifts when deciding overtime', () => {
  const job = makeJob({
    jurisdiction: 'ON', // 44 h weekly threshold
    taxProvince: 'ON',
    hourlyRate: money(RATE),
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
  });
  const period = payPeriodFor(TODAY, job.paySchedule);
  const longDay = { scheduledStart: '08:00', scheduledEnd: '21:00', breaks: [] };
  const shifts: Shift[] = [
    workedShift('a-18', '2026-10-18', longDay), // 13 h
    workedShift('a-19', '2026-10-19', longDay), // 13 h
    workedShift('a-20', '2026-10-20', longDay), // 13 h → 39 h worked
    sevenAndAHalfHourShift('s-21', '2026-10-21', { scheduledStart: '08:00', scheduledEnd: '13:00' }), // 5 h scheduled
  ];
  const rates = [{ id: 'r1', jobId: job.id, rate: money(RATE), effectiveFrom: '2025-01-01' }];
  const rules = resolveRules({
    bundle: BUNDLED_RULE_BUNDLE,
    job,
    date: period.payday,
    fromDate: period.start,
    toDate: period.end,
    serviceStartDate: '2020-01-01',
  });
  const calculation = calculatePayPeriod({
    job,
    rates,
    shifts,
    period,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: NOW,
  });
  assert.equal(hours(calculation.radar.workedMinutes), 39);
  assert.equal(hours(calculation.radar.projectedMinutes), 44);

  const extra = calculateExtraShift({
    job,
    rates,
    shifts,
    today: TODAY,
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    dateKey: '2026-10-22',
    startClock: '08:00',
    endClock: '16:00', // 8 h
    now: NOW,
  });
  // 39 worked + 5 scheduled + 7.5 extra (8 h span less the job's 30 min unpaid
  // break) = 51.5 h → the extra shift is overtime from its first minute.
  // Considering only the 39 worked hours would wrongly report 3 h of overtime.
  assert.equal(hours(extra.overtimeMinutes + extra.doubleTimeMinutes), 7.5);
  assert.equal(hours(extra.regularMinutes), 0);
  assert.equal(extra.includesOvertime, true);
  assert.equal(extra.workedMinutes, 450, 'the extra shift pays the scheduled 7.5 h');
});

// ---------------------------------------------------------------------------
// 6. The cache bug that produced the stale 60 h reading
// ---------------------------------------------------------------------------

test('the calculation cache key changes whenever shift data changes', () => {
  const { shifts, job, period } = reportedScenario();
  const base = calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today: TODAY,
    shiftsFingerprint: shiftsFingerprint(shifts),
  });

  const added = calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today: TODAY,
    shiftsFingerprint: shiftsFingerprint([...shifts, sevenAndAHalfHourShift('new', '2026-10-22')]),
  });
  assert.notEqual(added, base, 'adding a shift must invalidate the cached estimate');

  const edited = calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today: TODAY,
    shiftsFingerprint: shiftsFingerprint(
      shifts.map((shift) => (shift.id === 's-20' ? { ...shift, updatedAt: '2026-10-20T09:00:00.000Z' } : shift)),
    ),
  });
  assert.notEqual(edited, base, 'editing a shift must invalidate the cached estimate');

  const statusChanged = calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today: TODAY,
    shiftsFingerprint: shiftsFingerprint(shifts.map((shift) => (shift.id === 's-20' ? { ...shift, status: 'missed' as const } : shift))),
  });
  assert.notEqual(statusChanged, base, 'cancelling a shift must invalidate the cached estimate');

  const identical = calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today: TODAY,
    shiftsFingerprint: shiftsFingerprint(shifts),
  });
  assert.equal(identical, base, 'unchanged data reuses the cache');
});

test('a cache keyed this way serves the new estimate after a shift is added, not the old one', () => {
  const cache = createCalculationCache<number>(4);
  const { shifts, job, period } = reportedScenario();
  const keyFor = (list: Shift[]) =>
    calculationCacheKey({ jobId: job.id, periodStart: period.start, periodEnd: period.end, today: TODAY, shiftsFingerprint: shiftsFingerprint(list) });

  const before = keyFor(shifts.filter((shift) => shift.id.startsWith('w-')));
  cache.set(before, 1860);
  const after = keyFor(shifts);
  assert.equal(cache.get(after), undefined, 'the new key is a miss, so the estimate is recomputed');
  cache.set(after, 2325);
  assert.equal(cache.get(after), 2325);
  assert.equal(cache.get(before), 1860, 'the old entry is still valid for the old data');
});

// ---------------------------------------------------------------------------
// 7. Vacation pay is not silently dropped
// ---------------------------------------------------------------------------

test('configured vacation pay is included in the projection', () => {
  const { result } = reportedScenario({ vacation: { method: 'each_cheque' } });
  assert.ok(result.projection.projected.gross > money('2325.00'), 'vacation pay adds to the projected gross');
  assert.ok(result.gross.lines.some((line) => line.kind === 'vacation'));
  assert.equal(result.projection.worked.gross + result.projection.scheduled.gross, result.projection.projected.gross);
});

// ---------------------------------------------------------------------------
// 8. Historical periods keep using actual data
// ---------------------------------------------------------------------------

test('a fully historical period reports everything as worked', () => {
  const job = makeJob({
    jurisdiction: 'ON',
    taxProvince: 'ON',
    hourlyRate: money(RATE),
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
  });
  const historicalToday = '2026-11-15';
  const period = payPeriodFor(historicalToday, job.paySchedule);
  const shifts = [workedShift('h-1', '2026-11-05'), workedShift('h-2', '2026-11-06'), workedShift('h-3', '2026-11-09')];
  const calculation = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money(RATE), effectiveFrom: '2025-01-01' }],
    shifts,
    period,
    today: historicalToday,
    rules: resolveRules({
      bundle: BUNDLED_RULE_BUNDLE,
      job,
      date: period.payday,
      fromDate: period.start,
      toDate: period.end,
      serviceStartDate: '2020-01-01',
    }),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    now: Date.parse('2026-11-15T12:00:00Z'),
  });
  assert.equal(hours(calculation.projection.workedMinutes), 22.5);
  assert.equal(calculation.projection.scheduledMinutes, 0);
  assert.equal(calculation.projection.worked.gross, calculation.projection.projected.gross);
});

export type { PayPeriodCalculation };
export { TZ };
