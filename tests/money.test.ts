import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  add,
  divRoundHalfUp,
  microFromCents,
  microFromDollars,
  mul,
  mulRatio,
  parseDecimalString,
  percentOf,
  roundToCents,
  roundToDollars,
  toCents,
  toDecimalString,
  toDollarsNumber,
  tryParseMoney,
} from '../src/core/money.ts';
import { applyRounding, formatHours, formatHoursMinutes, formatTimer, parseDurationToMinutes, payForMinutes } from '../src/core/duration.ts';

test('parses decimal strings exactly', () => {
  assert.equal(microFromDollars('24.50'), 24_500_000n);
  assert.equal(microFromDollars('0.1'), 100_000n);
  assert.equal(microFromDollars('0.000001'), 1n);
  assert.equal(microFromDollars('1,234.56'), 1_234_560_000n);
  assert.equal(microFromDollars('$18.05'), 18_050_000n);
  assert.equal(microFromDollars('-3.5'), -3_500_000n);
  // more precision than 1e-6 rounds half away from zero
  assert.equal(parseDecimalString('0.0000005'), 1n);
});

test('rejects nonsense input without throwing at call sites', () => {
  assert.equal(tryParseMoney('abc'), null);
  assert.equal(tryParseMoney(''), null);
  assert.equal(tryParseMoney('12.34'), 12_340_000n);
});

test('multiplies rate by hours exactly', () => {
  const rate = microFromDollars('24.50');
  const eightHours = microFromDollars('8');
  assert.equal(mul(rate, eightHours), 196_000_000n);
  assert.equal(toDollarsNumber(mul(rate, eightHours)), 196);
  assert.equal(payForMinutes(rate, 480), 196_000_000n);
  assert.equal(payForMinutes(rate, 450), 183_750_000n);
});

test('never loses a cent to floating point', () => {
  // 0.1 + 0.2 === 0.3 exactly
  const sum = add(microFromDollars('0.1'), microFromDollars('0.2'));
  assert.equal(sum, microFromDollars('0.3'));
  // 3 x $0.333 = $0.99 + rounding at the cent level only when asked
  const third = microFromDollars('0.333');
  assert.equal(mul(third, microFromDollars('3')), 999_000n);
});

test('rounding helpers are explicit and half away from zero', () => {
  assert.equal(roundToCents(1_235_000n), 1_240_000n);
  assert.equal(roundToCents(1_234_999n), 1_230_000n);
  assert.equal(roundToCents(-1_235_000n), -1_240_000n);
  assert.equal(roundToDollars(1_500_000n), 2_000_000n);
  assert.equal(divRoundHalfUp(5n, 2n), 3n);
  assert.equal(divRoundHalfUp(-5n, 2n), -3n);
});

test('percentage maths matches CRA style contributions', () => {
  // 5.95% of $71,100 = $4,230.45 (2026 CPP maximum on the ceiling band)
  assert.equal(percentOf(microFromDollars('71100'), 5.95), microFromDollars('4230.45'));
  // 1.63% of $68,900 = $1,123.07 (2026 EI maximum)
  assert.equal(percentOf(microFromDollars('68900'), 1.63), microFromDollars('1123.07'));
});

test('converts to and from cents and strings', () => {
  assert.equal(microFromCents(1234), 12_340_000n);
  assert.equal(toCents(microFromDollars('12.345')), 1235);
  assert.equal(toDecimalString(microFromDollars('12.34')), '12.34');
  assert.equal(toDecimalString(microFromDollars('-0.5')), '-0.5');
  assert.equal(toDecimalString(1n), '0.000001');
});

test('ratio maths keeps integer precision', () => {
  assert.equal(mulRatio(microFromDollars('100'), 1n, 3n), 33_333_333n);
  assert.equal(mulRatio(microFromDollars('30'), 60n, 60n), microFromDollars('30'));
});

test('duration formatting is human readable', () => {
  assert.equal(formatHours(480), '8');
  assert.equal(formatHours(90), '1.5');
  assert.equal(formatHours(472), '7.87');
  assert.equal(formatHoursMinutes(90), '1h 30m');
  assert.equal(formatHoursMinutes(45), '45m');
  assert.equal(formatTimer(257), '04:17');
});

test('duration parsing accepts the formats people actually type', () => {
  assert.equal(parseDurationToMinutes('8'), 480);
  assert.equal(parseDurationToMinutes('7.5'), 450);
  assert.equal(parseDurationToMinutes('8:30'), 510);
  assert.equal(parseDurationToMinutes('8h30'), 510);
  assert.equal(parseDurationToMinutes('8h'), 480);
  assert.equal(parseDurationToMinutes('nope'), null);
});

test('time rounding supports every documented mode', () => {
  assert.equal(applyRounding(472, 15, 'nearest'), 465);
  assert.equal(applyRounding(473, 15, 'nearest'), 480);
  assert.equal(applyRounding(472, 15, 'up'), 480);
  assert.equal(applyRounding(472, 15, 'down'), 465);
  assert.equal(applyRounding(472, 0, 'nearest'), 472);
  assert.equal(applyRounding(472, 10, 'exact'), 472);
  assert.equal(applyRounding(249, 6, 'nearest'), 252);
});
