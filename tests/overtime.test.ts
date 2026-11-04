import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeShiftTime } from '../src/core/shiftTime.ts';
import { classifyOvertime, minutesUntilOvertime, resolveOvertimeRule, type ResolvedOvertimeRule } from '../src/core/overtime.ts';
import type { ClassifiedSegment, Job, OvertimeRuleConfig, Shift, TimeSegment, WorkWeekConfig } from '../src/core/types.ts';
import { makeJob, makeShift, TZ } from './helpers.ts';

const WEEK: WorkWeekConfig = { startsOn: 0, averagingWeeks: 1 };

/** Sunday-start week, Monday-Friday shifts of `hoursPerDay` hours, no breaks. */
function weekdayShifts(hoursPerDay: number, days = 5, start = '09:00'): Shift[] {
  const endHour = 9 + hoursPerDay;
  const end = `${String(endHour).padStart(2, '0')}:00`;
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  return dates.slice(0, days).map((date) => makeShift({ date, scheduledStart: start, scheduledEnd: end, breaks: [] }));
}

function segmentsFor(job: Job, shifts: Shift[]): TimeSegment[] {
  const segments: TimeSegment[] = [];
  for (const shift of shifts) {
    const time = computeShiftTime(shift, { zone: job.zone ?? TZ, dstPolicy: job.dstPolicy });
    segments.push(...time.segments);
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

/** Builds a jurisdiction-style rule exactly like the verified packs do. */
function ruleFor(
  dailyThresholdHours: number | null,
  weeklyThresholdHours: number | null,
  multiplier = 1.5,
  averagingWeeks = 1,
): ResolvedOvertimeRule {
  const config: OvertimeRuleConfig = {
    source: 'jurisdiction',
    tiers: [],
    dailyOvertimeApplies: dailyThresholdHours !== null,
    weeklyOvertimeApplies: weeklyThresholdHours !== null,
    hasAgreement: 'no',
  };
  return resolveOvertimeRule(config, dailyThresholdHours, weeklyThresholdHours, multiplier, averagingWeeks, 'Test rule');
}

function classify(job: Job, shifts: Shift[], rule: ResolvedOvertimeRule) {
  return classifyOvertime(segmentsFor(job, shifts) as ClassifiedSegment[], rule, job.workWeek ?? WEEK);
}

test('no overtime below the weekly threshold (Ontario, 44 h)', () => {
  const job = makeJob({ jurisdiction: 'ON' });
  const summary = classify(job, weekdayShifts(8), ruleFor(null, 44));
  assert.equal(summary.totalMinutes, 2400);
  assert.equal(summary.overtimeMinutes, 0);
  assert.equal(summary.regularMinutes, 2400);
});

test('weekly overtime only (Ontario: a 45 h week pays 1 h of overtime)', () => {
  const job = makeJob({ jurisdiction: 'ON' });
  const summary = classify(job, weekdayShifts(9), ruleFor(null, 44));
  assert.equal(summary.totalMinutes, 2700);
  assert.equal(summary.overtimeMinutes, 60);
  assert.equal(summary.regularMinutes, 2640);
  const otSegments = summary.segments.filter((segment) => segment.overtimeKind !== 'none');
  assert.equal(otSegments.length, 1);
  assert.equal(otSegments[0].dateKey, '2026-10-09');
  assert.equal(otSegments[0].multiplier, 1.5);
});

test('daily overtime (Alberta: 8 h/day, 44 h/week)', () => {
  const job = makeJob({ jurisdiction: 'AB' });
  const summary = classify(job, weekdayShifts(10, 3), ruleFor(8, 44));
  assert.equal(summary.totalMinutes, 1800);
  assert.equal(summary.overtimeMinutes, 360);
  assert.equal(summary.perDay.filter((day) => day.overtimeMinutes > 0).length, 3);
});

test('daily and weekly together: the greater amount is paid, never both', () => {
  const job = makeJob({ jurisdiction: 'BC' });
  const fiveNines = classify(job, weekdayShifts(9), ruleFor(8, 40));
  assert.equal(fiveNines.totalMinutes, 2700);
  assert.equal(fiveNines.overtimeMinutes, 300); // equal to the 45-40 weekly result

  const sixNines = classify(job, weekdayShifts(9, 6), ruleFor(8, 40));
  assert.equal(sixNines.totalMinutes, 3240);
  assert.equal(sixNines.overtimeMinutes, 840); // 14 h over 40 h, more than the 6 h of daily overtime
});

test('double time above the daily tier (BC: over 12 h)', () => {
  const job = makeJob({ jurisdiction: 'BC' });
  const shifts = [makeShift({ date: '2026-10-05', scheduledStart: '07:00', scheduledEnd: '20:00', breaks: [] })];
  const rule: ResolvedOvertimeRule = {
    ...ruleFor(8, 40, 1.5),
    doubleTimeDailyThresholdHours: 12,
    doubleTimeMultiplier: 2,
  };
  const summary = classify(job, shifts, rule);
  assert.equal(summary.totalMinutes, 780);
  assert.equal(summary.regularMinutes, 480);
  assert.equal(summary.overtimeMinutes, 240);
  assert.equal(summary.doubleTimeMinutes, 60);
  const doubleSegment = summary.segments.find((segment) => segment.overtimeKind === 'double_time');
  assert.equal(doubleSegment?.multiplier, 2);
});

test('custom workplace rule with two tiers', () => {
  const job = makeJob({ jurisdiction: 'ON' });
  const custom: OvertimeRuleConfig = {
    source: 'custom',
    tiers: [
      { afterWeeklyHours: 40, afterDailyHours: null, multiplier: 1.5, label: 'Over 40 h' },
      { afterWeeklyHours: 48, afterDailyHours: null, multiplier: 2, label: 'Over 48 h' },
    ],
    dailyOvertimeApplies: false,
    weeklyOvertimeApplies: true,
    hasAgreement: 'yes',
  };
  const rule = resolveOvertimeRule(custom, null, null, 1.5, 1, 'Custom workplace rule');
  const summary = classifyOvertime(segmentsFor(job, weekdayShifts(10, 5)) as ClassifiedSegment[], rule, WEEK);
  assert.equal(summary.totalMinutes, 3000);
  assert.equal(summary.overtimeMinutes, 480);
  assert.equal(summary.doubleTimeMinutes, 120);
  assert.ok(summary.rule.label.startsWith('Custom'));
  assert.equal(summary.rule.source, 'custom');
});

test('overtime can be disabled entirely (custom rule)', () => {
  const job = makeJob({ jurisdiction: 'ON' });
  const disabled: OvertimeRuleConfig = {
    source: 'custom',
    tiers: [{ afterWeeklyHours: null, afterDailyHours: null, multiplier: 1.5, label: 'none' }],
    dailyOvertimeApplies: false,
    weeklyOvertimeApplies: false,
    hasAgreement: 'no',
    note: 'Overtime not payable',
  };
  const rule = resolveOvertimeRule(disabled, null, null, 1.5, 1, 'Custom workplace rule');
  const summary = classifyOvertime(segmentsFor(job, weekdayShifts(12, 5)) as ClassifiedSegment[], rule, WEEK);
  assert.equal(summary.totalMinutes, 3600);
  assert.equal(summary.overtimeMinutes, 0);
  assert.equal(summary.doubleTimeMinutes, 0);
});

test('hours are never counted twice across work weeks', () => {
  const job = makeJob({ jurisdiction: 'ON' });
  const shifts = [
    makeShift({ id: 'sat', date: '2026-10-10', scheduledStart: '09:00', scheduledEnd: '22:00', breaks: [] }),
    makeShift({ id: 'sun', date: '2026-10-11', scheduledStart: '09:00', scheduledEnd: '22:00', breaks: [] }),
  ];
  const summary = classify(job, shifts, ruleFor(null, 44));
  assert.equal(summary.perWeek.length, 2);
  for (const week of summary.perWeek) {
    assert.equal(week.totalMinutes, 780);
    assert.equal(week.overtimeMinutes, 0, 'a single 13 h day does not create weekly overtime in Ontario');
  }
});

test('averaging agreements widen the weekly threshold', () => {
  const job = makeJob({
    jurisdiction: 'ON',
    workWeek: { startsOn: 0, averagingWeeks: 2, averagingAnchor: '2026-10-04' },
  });
  const shifts = [
    ...weekdayShifts(8, 5),
    makeShift({ id: 'w2-mon', date: '2026-10-12', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
    makeShift({ id: 'w2-tue', date: '2026-10-13', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
    makeShift({ id: 'w2-wed', date: '2026-10-14', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
    makeShift({ id: 'w2-thu', date: '2026-10-15', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
    makeShift({ id: 'w2-fri', date: '2026-10-16', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
  ];
  const atThreshold = classify(job, shifts, ruleFor(null, 40, 1.5, 2));
  assert.equal(atThreshold.totalMinutes, 4800, '80 h across the two-week cycle');
  assert.equal(atThreshold.overtimeMinutes, 0, 'exactly at the averaged threshold (40 x 2)');

  const over = classify(
    job,
    [...shifts, makeShift({ id: 'w2-sat', date: '2026-10-17', scheduledStart: '09:00', scheduledEnd: '10:00', breaks: [] })],
    ruleFor(null, 40, 1.5, 2),
  );
  assert.equal(over.totalMinutes, 4860);
  assert.equal(over.overtimeMinutes, 60);
});

test('minutes until overtime drives the radar', () => {
  const rule = ruleFor(null, 44);
  assert.equal(minutesUntilOvertime(39.5 * 60, rule), 4.5 * 60);
  assert.equal(minutesUntilOvertime(50 * 60, rule), 0);
  const noWeekly = ruleFor(null, null);
  assert.equal(minutesUntilOvertime(600, noWeekly), null);
});
