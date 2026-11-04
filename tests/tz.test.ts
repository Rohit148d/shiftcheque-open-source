import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addDays,
  diffDays,
  endOfWeek,
  isDstAt,
  localDateKey,
  offsetMinutesAt,
  parseDateKey,
  startOfWeek,
  toDateKey,
  utcToZoned,
  zonedToUtc,
  dstTransitions,
} from '../src/core/tz.ts';

test('converts wall-clock to UTC for standard and daylight time', () => {
  // 2026-01-15 12:00 EST = 17:00 UTC
  const winter = zonedToUtc('America/Toronto', { year: 2026, month: 1, day: 15, hour: 12, minute: 0 });
  assert.equal(new Date(winter).toISOString(), '2026-01-15T17:00:00.000Z');
  // 2026-07-15 12:00 EDT = 16:00 UTC
  const summer = zonedToUtc('America/Toronto', { year: 2026, month: 7, day: 15, hour: 12, minute: 0 });
  assert.equal(new Date(summer).toISOString(), '2026-07-15T16:00:00.000Z');
});

test('handles the spring-forward gap deterministically', () => {
  // 2026-03-08 02:30 does not exist in Toronto: it maps forward to 03:30 EDT
  const missing = zonedToUtc('America/Toronto', { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  const civil = utcToZoned('America/Toronto', missing);
  assert.equal(civil.hour, 3);
  assert.equal(civil.minute, 30);
  assert.equal(new Date(missing).toISOString(), '2026-03-08T07:30:00.000Z');
});

test('handles the fall-back repeated hour by taking the first occurrence', () => {
  // 2026-11-01 01:30 happens twice; the earlier (EDT) instant is used
  const ambiguous = zonedToUtc('America/Toronto', { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  assert.equal(new Date(ambiguous).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(isDstAt('America/Toronto', ambiguous), true);
});

test('a night shift across the fall-back transition is one hour longer', () => {
  const start = zonedToUtc('America/Toronto', { year: 2026, month: 11, day: 1, hour: 0, minute: 0 });
  const end = zonedToUtc('America/Toronto', { year: 2026, month: 11, day: 1, hour: 8, minute: 0 });
  assert.equal((end - start) / 3_600_000, 9);
});

test('a night shift across the spring-forward transition is one hour shorter', () => {
  const start = zonedToUtc('America/Toronto', { year: 2026, month: 3, day: 8, hour: 0, minute: 0 });
  const end = zonedToUtc('America/Toronto', { year: 2026, month: 3, day: 8, hour: 8, minute: 0 });
  assert.equal((end - start) / 3_600_000, 7);
});

test('Saskatchewan and Yukon never observe daylight saving', () => {
  assert.equal(isDstAt('America/Regina', Date.UTC(2026, 6, 1)), false);
  assert.equal(isDstAt('America/Whitehorse', Date.UTC(2026, 6, 1)), false);
  assert.equal(offsetMinutesAt('America/Regina', Date.UTC(2026, 6, 1)), -360);
  assert.equal(offsetMinutesAt('America/Whitehorse', Date.UTC(2026, 6, 1)), -420);
});

test('Newfoundland uses the half-hour offset', () => {
  assert.equal(offsetMinutesAt('America/St_Johns', Date.UTC(2026, 0, 15)), -210);
  const noon = zonedToUtc('America/St_Johns', { year: 2026, month: 1, day: 15, hour: 12, minute: 0 });
  assert.equal(new Date(noon).toISOString(), '2026-01-15T15:30:00.000Z');
});

test('DST transitions are computed, not hard-coded', () => {
  const t = dstTransitions(2026, 'America/Toronto');
  assert.ok(t);
  assert.equal(new Date(t.startUtc).toISOString(), '2026-03-08T07:00:00.000Z');
  assert.equal(new Date(t.endUtc).toISOString(), '2026-11-01T06:00:00.000Z');
});

test('local date keys never shift with UTC', () => {
  // 23:30 in Toronto on Oct 5 is already Oct 6 in UTC; the local key stays Oct 5
  const instant = zonedToUtc('America/Toronto', { year: 2026, month: 10, day: 5, hour: 23, minute: 30 });
  assert.equal(localDateKey('America/Toronto', instant), '2026-10-05');
  assert.equal(localDateKey('America/Vancouver', instant), '2026-10-05');
  // ... and 20:30 in Vancouver on Oct 5 is Oct 6 in Toronto
  const vancouver = zonedToUtc('America/Vancouver', { year: 2026, month: 10, day: 5, hour: 20, minute: 30 });
  assert.equal(localDateKey('America/Vancouver', vancouver), '2026-10-05');
  assert.equal(localDateKey('America/Toronto', vancouver), '2026-10-05');
});

test('calendar helpers', () => {
  assert.deepEqual(parseDateKey('2026-02-28'), { year: 2026, month: 2, day: 28 });
  assert.throws(() => parseDateKey('2026-02-30'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-08', -1), '2026-03-07');
  assert.equal(diffDays('2026-10-01', '2026-10-05'), 4);
  assert.equal(startOfWeek('2026-10-07', 0), '2026-10-04');
  assert.equal(endOfWeek('2026-10-07', 0), '2026-10-10');
  assert.equal(startOfWeek('2026-10-07', 1), '2026-10-05');
  assert.equal(toDateKey(2026, 3, 7), '2026-03-07');
});
