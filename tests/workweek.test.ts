import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adjacentPeriod,
  payPeriodFor,
  payPeriodsInRange,
  periodLengthDays,
  periodsPerYear,
  shiftPeriod,
  workWeekFor,
  workWeeksInRange,
} from '../src/core/workweek.ts';
import type { PaySchedule } from '../src/core/types.ts';

const biweekly: PaySchedule = { frequency: 'biweekly', anchorStart: '2026-01-01', paydayOffsetDays: 5 };
const weekly: PaySchedule = { frequency: 'weekly', anchorStart: '2026-01-02', paydayOffsetDays: 3 };
const semimonthly: PaySchedule = { frequency: 'semimonthly', anchorStart: '2026-01-01', paydayOffsetDays: 4 };
const monthly: PaySchedule = { frequency: 'monthly', anchorStart: '2026-01-01', paydayOffsetDays: 2 };
const custom: PaySchedule = { frequency: 'custom', anchorStart: '2026-01-05', customPeriodDays: 10, paydayOffsetDays: 0 };

test('work week boundaries follow the configured start day', () => {
  const sunday = workWeekFor('2026-10-07', { startsOn: 0, averagingWeeks: 1 });
  assert.equal(sunday.start, '2026-10-04');
  assert.equal(sunday.end, '2026-10-10');

  const monday = workWeekFor('2026-10-07', { startsOn: 1, averagingWeeks: 1 });
  assert.equal(monday.start, '2026-10-05');
  assert.equal(monday.end, '2026-10-11');

  const thursday = workWeekFor('2026-10-07', { startsOn: 4, averagingWeeks: 1 });
  assert.equal(thursday.start, '2026-10-01');
  assert.equal(thursday.end, '2026-10-07');
});

test('a work week and a pay period are different things', () => {
  // Work week: Sunday–Saturday. Pay period: Thursday–Wednesday (biweekly).
  const week = workWeekFor('2026-10-05', { startsOn: 0, averagingWeeks: 1 });
  const period = payPeriodFor('2026-10-05', biweekly);
  assert.equal(week.start, '2026-10-04');
  assert.equal(period.start, '2026-09-24');
  assert.equal(period.end, '2026-10-07');
  assert.notEqual(week.start, period.start);
});

test('biweekly periods are generated from the anchor', () => {
  const period = payPeriodFor('2026-10-05', biweekly);
  assert.equal(period.start, '2026-09-24');
  assert.equal(period.end, '2026-10-07');
  assert.equal(period.days, 14);
  assert.equal(period.payday, '2026-10-12');
  const next = adjacentPeriod(period, biweekly, 1);
  assert.equal(next.start, '2026-10-08');
  assert.equal(next.end, '2026-10-21');
  assert.equal(next.index, period.index + 1);
});

test('weekly periods', () => {
  const period = payPeriodFor('2026-10-05', weekly);
  assert.equal(periodLengthDays(weekly), 7);
  assert.equal(period.start, '2026-10-02');
  assert.equal(period.end, '2026-10-08');
  assert.equal(period.payday, '2026-10-11');
});

test('semi-monthly periods always end on the 15th or the last day', () => {
  const first = payPeriodFor('2026-10-05', semimonthly);
  assert.equal(first.start, '2026-10-01');
  assert.equal(first.end, '2026-10-15');
  const second = payPeriodFor('2026-10-20', semimonthly);
  assert.equal(second.start, '2026-10-16');
  assert.equal(second.end, '2026-10-31');
  const february = payPeriodFor('2026-02-20', semimonthly);
  assert.equal(february.end, '2026-02-28');
  assert.equal(adjacentPeriod(first, semimonthly, 1).start, '2026-10-16');
  assert.equal(adjacentPeriod(first, semimonthly, -1).end, '2026-09-30');
});

test('monthly periods', () => {
  const period = payPeriodFor('2026-10-20', monthly);
  assert.equal(period.start, '2026-10-01');
  assert.equal(period.end, '2026-10-31');
  assert.equal(period.payday, '2026-11-02');
});

test('custom period lengths', () => {
  const period = payPeriodFor('2026-01-25', custom);
  assert.equal(periodLengthDays(custom), 10);
  assert.equal(period.start, '2026-01-25');
  assert.equal(period.end, '2026-02-03');
});

test('shifting periods walks forward and backward safely', () => {
  const base = payPeriodFor('2026-10-05', biweekly);
  assert.equal(shiftPeriod('2026-10-05', biweekly, 0).start, base.start);
  assert.equal(shiftPeriod('2026-10-05', biweekly, 2).start, '2026-10-22');
  assert.equal(shiftPeriod('2026-10-05', biweekly, -1).start, '2026-09-10');
});

test('periods in range are complete and ordered', () => {
  const periods = payPeriodsInRange('2026-01-01', '2026-02-28', biweekly);
  assert.ok(periods.length >= 4);
  for (let index = 1; index < periods.length; index += 1) {
    assert.ok(periods[index].start > periods[index - 1].end);
  }
});

test('periods per year match the frequency', () => {
  assert.equal(periodsPerYear(biweekly), 26);
  assert.equal(periodsPerYear(weekly), 52);
  assert.equal(periodsPerYear(semimonthly), 24);
  assert.equal(periodsPerYear(monthly), 12);
  assert.equal(periodsPerYear(custom), 37);
});

test('averaging agreements group consecutive weeks from the anchor', () => {
  const config = { startsOn: 0, averagingWeeks: 2, averagingAnchor: '2026-10-04' };
  const a = workWeekFor('2026-10-05', config);
  const b = workWeekFor('2026-10-12', config);
  assert.equal(a.key, b.key);
  assert.equal(a.start, '2026-10-04');
  assert.equal(a.end, '2026-10-17');
  const c = workWeekFor('2026-10-18', config);
  assert.notEqual(c.key, a.key);
  assert.equal(c.start, '2026-10-18');
});

test('workWeeksInRange respects the averaging window', () => {
  const weeks = workWeeksInRange('2026-10-05', '2026-10-25', { startsOn: 0, averagingWeeks: 2, averagingAnchor: '2026-10-04' });
  assert.equal(weeks.length, 2);
});
