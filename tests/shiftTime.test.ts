import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeShiftTime, liveElapsedMinutes, naiveClockMinutes, resolveShiftInstants, splitAtLocalMidnight } from '../src/core/shiftTime.ts';
import { breakRule, makeShift, TZ } from './helpers.ts';

test('day shift with an unpaid break', () => {
  const shift = makeShift({ scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [breakRule(30)] });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.scheduledMinutes, 450);
  assert.equal(result.paidMinutes, 450);
  assert.equal(result.source, 'scheduled');
  assert.equal(result.unpaidBreakMinutes, 30);
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.minutes, 0), 450);
});

test('paid breaks are never deducted', () => {
  const shift = makeShift({ scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [breakRule(15, true), breakRule(30, true)] });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.paidMinutes, 480);
  assert.equal(result.paidBreakMinutes, 45);
  assert.equal(result.unpaidBreakMinutes, 0);
});

test('overnight shift crosses midnight and splits into two segments', () => {
  const shift = makeShift({ scheduledStart: '23:00', scheduledEnd: '07:00', scheduledOvernight: true, breaks: [] });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.paidMinutes, 480);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].minutes, 60);
  assert.equal(result.segments[1].minutes, 420);
  assert.ok(result.warnings.includes('crosses_midnight'));
});

test('durations survive a midnight crossing in the grid', () => {
  assert.equal(naiveClockMinutes('23:00', '07:00', true), 480);
  assert.equal(naiveClockMinutes('09:00', '17:00', false), 480);
  assert.equal(naiveClockMinutes('22:00', '02:30', true), 270);
});

test('actual times take precedence over scheduled times once confirmed', () => {
  const shift = makeShift({
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
    actualStart: '09:05',
    actualEnd: '17:35',
    confirmed: true,
    breaks: [breakRule(30)],
  });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.source, 'actual');
  assert.equal(result.actualMinutes, 480);
  assert.equal(result.paidMinutes, 480);
  // the schedule is preserved untouched
  assert.equal(result.scheduledMinutes, 450);
});

test('unconfirmed shifts keep using the schedule', () => {
  const shift = makeShift({ actualStart: '09:05', actualEnd: '17:35', confirmed: false });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.source, 'scheduled');
  assert.equal(result.paidMinutes, 450);
});

test('paid hours override wins over everything', () => {
  const shift = makeShift({
    actualStart: '09:05',
    actualEnd: '17:35',
    confirmed: true,
    paidMinutesOverride: 400,
  });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.equal(result.source, 'override');
  assert.equal(result.paidMinutes, 400);
});

test('spring-forward night shift: paying the clock vs the schedule', () => {
  const shift = makeShift({ date: '2026-03-08', scheduledStart: '00:00', scheduledEnd: '08:00', breaks: [] });
  const wallClock = computeShiftTime(shift, { zone: TZ, dstPolicy: 'wall_clock' });
  assert.equal(wallClock.scheduledMinutes, 480);
  assert.equal(wallClock.dstAnomalyMinutes, -60);
  assert.ok(wallClock.warnings.includes('dst_spring_forward'));

  const elapsed = computeShiftTime(shift, { zone: TZ, dstPolicy: 'elapsed' });
  assert.equal(elapsed.scheduledMinutes, 420);
});

test('fall-back night shift gains an hour of real time', () => {
  const shift = makeShift({ date: '2026-11-01', scheduledStart: '00:00', scheduledEnd: '08:00', breaks: [] });
  const wallClock = computeShiftTime(shift, { zone: TZ, dstPolicy: 'wall_clock' });
  assert.equal(wallClock.scheduledMinutes, 480);
  assert.equal(wallClock.dstAnomalyMinutes, 60);
  const elapsed = computeShiftTime(shift, { zone: TZ, dstPolicy: 'elapsed' });
  assert.equal(elapsed.scheduledMinutes, 540);
});

test('rounding is applied to paid minutes and reported', () => {
  const shift = makeShift({
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
    breaks: [breakRule(38)],
  });
  const result = computeShiftTime(shift, { zone: TZ, rounding: { step: 15, mode: 'nearest' } });
  assert.equal(result.paidUnroundedMinutes, 442);
  assert.equal(result.paidMinutes, 435);
  assert.equal(result.roundingDeltaMinutes, -7);
});

test('non-working shift types never pay hours', () => {
  for (const type of ['vacation', 'sick', 'off'] as const) {
    const shift = makeShift({ type });
    const result = computeShiftTime(shift, { zone: TZ });
    assert.equal(result.paidMinutes, 0, `${type} should not pay hours`);
  }
});

test('resolveShiftInstants moves the end to the next day when needed', () => {
  const resolved = resolveShiftInstants(TZ, '2026-10-05', '22:00', '06:00', false);
  assert.equal(resolved.overnight, true);
  assert.equal((resolved.endMs - resolved.startMs) / 3_600_000, 8);
});

test('splitAtLocalMidnight produces contiguous, correctly tagged segments', () => {
  const start = resolveShiftInstants(TZ, '2026-10-05', '22:00', '06:00', true);
  const segments = splitAtLocalMidnight(TZ, start.startMs, start.endMs);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].dateKey, '2026-10-05');
  assert.equal(segments[1].dateKey, '2026-10-06');
  assert.equal(segments[0].minutes + segments[1].minutes, 480);
  assert.equal(segments[1].startMs, segments[0].endMs);
});

test('paid time always equals the sum of the time segments', () => {
  const shift = makeShift({ scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [breakRule(30)] });
  const day = computeShiftTime(shift, { zone: TZ });
  assert.equal(day.segments.reduce((sum, segment) => sum + segment.minutes, 0), day.paidMinutes);

  const overnight = computeShiftTime(
    makeShift({ scheduledStart: '22:00', scheduledEnd: '06:00', scheduledOvernight: true, breaks: [breakRule(45)] }),
    { zone: TZ },
  );
  assert.equal(overnight.paidMinutes, 435);
  assert.equal(overnight.segments.reduce((sum, segment) => sum + segment.minutes, 0), 435);

  // spring-forward night: the clock pays 8 h, the segments agree
  const dst = computeShiftTime(makeShift({ date: '2026-03-08', scheduledStart: '00:00', scheduledEnd: '08:00', breaks: [] }), { zone: TZ });
  assert.equal(dst.paidMinutes, 480);
  assert.equal(dst.segments.reduce((sum, segment) => sum + segment.minutes, 0), 480);
});

test('unpaid breaks are removed without throwing the shift end away', () => {
  const shift = makeShift({ scheduledStart: '22:00', scheduledEnd: '06:00', scheduledOvernight: true, breaks: [breakRule(30)] });
  const result = computeShiftTime(shift, { zone: TZ });
  assert.ok(result.segments.length >= 2);
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.minutes, 0), 450);
  // the end of the shift is still at 06:00 local
  const last = result.segments[result.segments.length - 1];
  assert.equal(last.localEndMinute, 6 * 60);
});

test('live shift elapsed time is derived from stored timestamps', () => {
  const startedAt = Date.UTC(2026, 9, 5, 23, 0);
  const shift = makeShift({ status: 'in_progress', liveStartedAtMs: startedAt, liveAccumulatedMinutes: 0 });
  assert.equal(liveElapsedMinutes(shift, startedAt + 45 * 60_000), 45);
  // while on break the elapsed time freezes
  const onBreak = { ...shift, liveBreakStartedAtMs: startedAt + 45 * 60_000, liveAccumulatedMinutes: 45 };
  assert.equal(liveElapsedMinutes(onBreak, startedAt + 120 * 60_000), 45);
});
