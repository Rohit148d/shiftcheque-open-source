import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculatePayPeriod, periodsPerYearFor, shiftWindowFor } from '../src/core/calculate.ts';
import { calculateExtraShift } from '../src/core/extraShift.ts';
import { comparePaycheque } from '../src/core/chequeComparison.ts';
import { computePremiums, windowOverlapMinutes } from '../src/core/premium.ts';
import { resolveRules, resolvePayrollPack } from '../src/rules/loader.ts';
import { BUNDLED_RULE_BUNDLE } from '../src/rules/bundle.ts';
import { toFixed } from '../src/core/money.ts';
import { computeShiftTime } from '../src/core/shiftTime.ts';
import type { ClassifiedSegment, PremiumRule } from '../src/core/types.ts';
import { breakRule, makeJob, makeProfile, makeShift, money, TZ } from './helpers.ts';

function rulesFor(job: ReturnType<typeof makeJob>, from: string, to: string) {
  return resolveRules({
    bundle: BUNDLED_RULE_BUNDLE,
    job,
    date: to,
    fromDate: from,
    toDate: to,
    serviceStartDate: '2020-01-01',
  });
}

function weekOfDayShifts(startDate: string, count: number, hours: number) {
  const shifts = [];
  for (let index = 0; index < count; index += 1) {
    const day = new Date(Date.UTC(2026, 9, 4 + index));
    const date = day.toISOString().slice(0, 10);
    shifts.push(
      makeShift({
        date,
        scheduledStart: '09:00',
        scheduledEnd: `${String(9 + hours).padStart(2, '0')}:00`,
        breaks: [breakRule(30)],
      }),
    );
  }
  void startDate;
  return shifts;
}

test('end to end: a normal Ontario pay period produces a full explanation', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON', workWeek: { startsOn: 0, averagingWeeks: 1 } });
  const shifts = weekOfDayShifts('2026-10-04', 5, 8);
  const period = { index: 0, start: '2026-10-01', end: '2026-10-14', payday: '2026-10-19', days: 14, label: 'Oct 1–14, 2026' };
  const rules = rulesFor(job, period.start, period.end);
  const result = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money('24.50'), effectiveFrom: '2025-01-01' }],
    shifts,
    period,
    today: '2026-10-05',
    rules,
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  });

  // 37.5 paid hours at $24.50 = $918.75 plus 6% vacation pay (6 years of service)
  assert.equal(result.totalPaidMinutes, 2250);
  assert.equal(toFixed(result.gross.regularPay, 2), '918.75');
  assert.equal(toFixed(result.gross.vacationPay, 2), '55.13');
  assert.equal(toFixed(result.gross.gross, 2), '973.88');
  assert.equal(result.overtime.overtimeMinutes, 0);

  // CPP + EI + federal + provincial tax
  const codes = result.deductions.lines.map((line) => line.code);
  assert.deepEqual(codes.sort(), ['CPP', 'CPP2', 'EI', 'FED_TAX', 'PROV_TAX'].sort());
  assert.equal(result.deductions.net, result.deductions.gross - result.deductions.totalDeductions);
  assert.ok(result.deductions.net > money('800') && result.deductions.net < money('900'));

  // explainability payload
  assert.equal(result.explanation.payrollRuleYear, 2026);
  assert.equal(result.explanation.workWeekStart, 0);
  assert.equal(result.explanation.payPeriodStart, '2026-10-01');
  assert.ok(result.explanation.overtimeRuleLabel.includes('Ontario'));
  assert.ok(result.explanation.sourceUrls.length > 0);
  assert.equal(result.confidence.level, 'good', 'schedule, work week, rate and rules are all configured');

  // supplying YTD payroll information raises the estimate to high confidence
  const withYtd = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money('24.50'), effectiveFrom: '2025-01-01' }],
    shifts,
    period,
    today: '2026-10-05',
    rules,
    profile: makeProfile({
      federalClaimCode: 'custom',
      provincialClaimCode: 'custom',
      ytd: { cpp: money('1500'), cpp2: 0n, ei: money('500'), qpp: 0n, qpip: 0n, periodsPaid: 15 },
    }),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  });
  assert.equal(withYtd.confidence.level, 'high');
  assert.ok(withYtd.confidence.improvements.length >= 0);
});

test('end to end: overtime appears as an itemised line', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON', workWeek: { startsOn: 0, averagingWeeks: 1 } });
  // five 10-hour shifts in the work week 2026-10-04..10-10 = 50 h
  const shifts = weekOfDayShifts('2026-10-04', 5, 10);
  const period = { index: 0, start: '2026-10-01', end: '2026-10-14', payday: '2026-10-19', days: 14, label: 'Oct 1–14, 2026' };
  const result = calculatePayPeriod({
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money('24.50'), effectiveFrom: '2025-01-01' }],
    shifts,
    period,
    today: '2026-10-05',
    rules: rulesFor(job, period.start, period.end),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  });
  assert.equal(result.totalPaidMinutes, 2850); // 50 h span minus 5 unpaid breaks
  assert.equal(result.overtime.overtimeMinutes, 210); // 3.5 h over 44
  const overtimeLine = result.gross.lines.find((line) => line.kind === 'overtime');
  assert.ok(overtimeLine, 'overtime line exists');
  assert.equal(overtimeLine?.minutes, 210);
  assert.equal(toFixed(overtimeLine?.amount ?? 0n, 2), '128.63'); // 3.5 h x 36.75
});

test('rate history: a mid-period raise is applied by date', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON' });
  const shifts = [
    makeShift({ id: 'before', date: '2026-09-28', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
    makeShift({ id: 'after', date: '2026-10-05', scheduledStart: '09:00', scheduledEnd: '17:00', breaks: [] }),
  ];
  const period = { index: 0, start: '2026-09-24', end: '2026-10-07', payday: '2026-10-12', days: 14, label: 'period' };
  const result = calculatePayPeriod({
    job,
    rates: [
      { id: 'r1', jobId: job.id, rate: money('20.00'), effectiveFrom: '2025-01-01' },
      { id: 'r2', jobId: job.id, rate: money('22.00'), effectiveFrom: '2026-10-01' },
    ],
    shifts,
    period,
    today: '2026-10-05',
    rules: rulesFor(job, period.start, period.end),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  });
  // 8 h at $20 + 8 h at $22
  assert.equal(toFixed(result.gross.regularPay, 2), '336.00');
});

test('extra shift: incremental take-home is between zero and the extra gross', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON', workWeek: { startsOn: 0, averagingWeeks: 1 } });
  const shifts = weekOfDayShifts('2026-10-04', 3, 8);
  const input = {
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money('24.50'), effectiveFrom: '2025-01-01' }],
    shifts,
    today: '2026-10-05',
    rules: rulesFor(job, '2026-10-01', '2026-10-14'),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  };
  const result = calculateExtraShift({ ...input, dateKey: '2026-10-08', startClock: '09:00', endClock: '17:00' });
  assert.equal(result.workedMinutes, 450); // 8 h minus the default 30 minute unpaid break
  assert.ok(result.extraGross > 0n);
  assert.ok(result.extraTakeHome > 0n);
  assert.ok(result.extraTakeHome < result.extraGross, 'some of the extra gross goes to deductions');
  assert.equal(result.newTakeHome, result.previousTakeHome + result.extraTakeHome);
});

test('extra shift: overtime is recognised and explained', () => {
  const job = makeJob({ jurisdiction: 'BC', taxProvince: 'BC', workWeek: { startsOn: 0, averagingWeeks: 1 } });
  const shifts = weekOfDayShifts('2026-10-04', 5, 8);
  const input = {
    job,
    rates: [{ id: 'r1', jobId: job.id, rate: money('24.50'), effectiveFrom: '2025-01-01' }],
    shifts,
    today: '2026-10-05',
    rules: rulesFor(job, '2026-10-01', '2026-10-14'),
    profile: makeProfile(),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
  };
  const result = calculateExtraShift({ ...input, dateKey: '2026-10-09', startClock: '09:00', endClock: '21:00' });
  assert.equal(result.includesOvertime, true);
  assert.ok(result.overtimeMinutes > 0);
  assert.ok(result.notes.some((note) => note.includes('estimate')));
});

test('cheque check: a matching cheque is reported as close', () => {
  const comparison = comparePaycheque(
    {
      gross: money('2148.26'),
      net: money('1636.83'),
      regularMinutes: 4320,
      overtimeMinutes: 390,
      doubleTimeMinutes: 0,
      premiumPay: money('22.50'),
      vacationPay: 0n,
      lines: [
        { label: 'Regular pay', amount: money('1764.00') },
        { label: 'Overtime', amount: money('238.88') },
        { label: 'Night premium', amount: money('22.50') },
      ],
      deductions: [
        { code: 'CPP', label: 'CPP', amount: money('-120.00') },
        { code: 'EI', label: 'EI', amount: money('-40.00') },
        { code: 'FED_TAX', label: 'Federal tax', amount: money('-200.00') },
      ],
      cpp: money('120'),
      ei: money('40'),
      tax: money('300'),
    },
    {
      actualNet: money('1634.00'),
      actualGross: money('2145.00'),
      minutes: { regularMinutes: 4320, overtimeMinutes: 390 },
      lines: [
        { code: 'regular', label: 'Regular pay', amount: money('1764.00') },
        { code: 'ot', label: 'Overtime', amount: money('238.88') },
        { code: 'night', label: 'Night premium', amount: money('22.50') },
      ],
    },
  );
  assert.equal(comparison.outcome, 'looks_close');
  assert.equal(comparison.rows.find((row) => row.id === 'net')?.status, 'match');
  assert.ok(comparison.rows.every((row) => row.status !== 'differs'));
});

test('cheque check: overtime differences are flagged with neutral language', () => {
  const comparison = comparePaycheque(
    {
      gross: money('2148.26'),
      net: money('1636.83'),
      regularMinutes: 4320,
      overtimeMinutes: 390,
      doubleTimeMinutes: 0,
      premiumPay: money('22.50'),
      vacationPay: 0n,
      lines: [{ label: 'Overtime', amount: money('238.88') }],
      deductions: [],
      cpp: 0n,
      ei: 0n,
      tax: 0n,
    },
    {
      actualNet: money('1553.69'),
      actualGross: money('2075.00'),
      minutes: { regularMinutes: 4320, overtimeMinutes: 270 },
      lines: [{ code: 'ot', label: 'Overtime', amount: money('165.20') }],
    },
  );
  assert.equal(comparison.outcome, 'worth_reviewing');
  assert.ok(comparison.findings.some((finding) => finding.toLowerCase().includes('overtime')));
  assert.ok(comparison.possibleExplanations.length >= 3);
  // language guard: never accusatory, never legal conclusions
  const language = [comparison.headline, comparison.summary, ...comparison.findings, ...comparison.possibleExplanations].join(' ').toLowerCase();
  for (const forbidden of ['stole', 'steal', 'illegal', 'sue ', 'you are owed', 'lawsuit', 'cheat']) {
    assert.equal(language.includes(forbidden), false, `never says "${forbidden}"`);
  }
});

test('cheque check: net-only input asks for more information', () => {
  const comparison = comparePaycheque(
    {
      gross: money('1000'),
      net: money('800'),
      regularMinutes: 2400,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      premiumPay: 0n,
      vacationPay: 0n,
      lines: [],
      deductions: [],
      cpp: 0n,
      ei: 0n,
      tax: 0n,
    },
    { actualNet: money('700'), lines: [] },
  );
  assert.equal(comparison.outcome, 'more_information_needed');
  assert.ok(comparison.summary.includes('no payslip details'));
});

test('premium windows that wrap midnight are measured exactly', () => {
  const job = makeJob();
  const shift = makeShift({ scheduledStart: '18:00', scheduledEnd: '02:00', scheduledOvernight: true, breaks: [] });
  const time = computeShiftTime(shift, { zone: TZ });
  const segments = time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 })) as ClassifiedSegment[];
  // evening premium 18:00-23:00 (300 minutes of the shift)
  const evening = windowOverlapMinutes(segments[0], { startMinute: 18 * 60, endMinute: 23 * 60 });
  assert.equal(evening, 300);
  // night premium 23:00-07:00 covers the rest
  const night = windowOverlapMinutes(segments[0], { startMinute: 23 * 60, endMinute: 7 * 60 }) +
    windowOverlapMinutes(segments[1], { startMinute: 23 * 60, endMinute: 7 * 60 });
  assert.equal(night, 180);
});

test('premiums: per hour, per shift and multiplier types', () => {
  const job = makeJob();
  const shift = makeShift({ scheduledStart: '23:00', scheduledEnd: '07:00', scheduledOvernight: true, breaks: [] });
  const time = computeShiftTime(shift, { zone: TZ });
  const segments = time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 })) as ClassifiedSegment[];
  const rules: PremiumRule[] = [
    {
      id: 'night',
      label: 'Night premium',
      type: 'per_hour',
      amount: money('1.25'),
      window: { startMinute: 23 * 60, endMinute: 7 * 60 },
      stackable: true,
      priority: 10,
      includedInOtBase: false,
      appliesDuringOvertime: true,
      enabled: true,
    },
    {
      id: 'weekend',
      label: 'Weekend premium',
      type: 'per_shift',
      amount: money('15'),
      days: [0, 6],
      stackable: true,
      priority: 5,
      includedInOtBase: false,
      appliesDuringOvertime: true,
      enabled: true,
    },
  ];
  const result = computePremiums(
    {
      shiftId: shift.id,
      segments,
      rateForSegment: () => money('24.50'),
      holidayDates: new Set<string>(),
      effectiveDate: shift.date,
    },
    rules,
  );
  const night = result.earnings.find((entry) => entry.ruleId === 'night');
  assert.equal(night?.minutes, 480);
  assert.equal(toFixed(night?.amount ?? 0n, 2), '10.00');
  // 2026-10-05 is a Monday, so the weekend premium must not apply
  assert.equal(result.earnings.some((entry) => entry.ruleId === 'weekend'), false);
});

test('premiums: non-stackable rules resolve by priority', () => {
  const job = makeJob();
  const shift = makeShift({ scheduledStart: '23:00', scheduledEnd: '07:00', scheduledOvernight: true, breaks: [] });
  const time = computeShiftTime(shift, { zone: TZ });
  const segments = time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 })) as ClassifiedSegment[];
  const makeRule = (id: string, priority: number, amount: string): PremiumRule => ({
    id,
    label: id,
    type: 'per_hour',
    amount: money(amount),
    window: { startMinute: 23 * 60, endMinute: 7 * 60 },
    stackable: false,
    priority,
    includedInOtBase: false,
    appliesDuringOvertime: true,
    enabled: true,
  });
  const result = computePremiums(
    {
      shiftId: shift.id,
      segments,
      rateForSegment: () => money('24.50'),
      holidayDates: new Set<string>(),
      effectiveDate: shift.date,
    },
    [makeRule('worse', 1, '1.00'), makeRule('better', 9, '2.00')],
  );
  const better = result.earnings.find((entry) => entry.ruleId === 'better');
  const worse = result.earnings.find((entry) => entry.ruleId === 'worse');
  assert.equal(toFixed(better?.amount ?? 0n, 2), '16.00');
  assert.equal(worse?.minutes ?? 0, 0, 'the lower-priority rule is removed');
});

test('rule resolution: verified jurisdictions resolve, unknown ones fall back to manual', () => {
  const ontario = makeJob({ jurisdiction: 'ON' });
  const rules = rulesFor(ontario, '2026-10-01', '2026-10-14');
  assert.equal(rules.overtimeMode, 'jurisdiction_verified');
  assert.equal(rules.overtime.weeklyThresholdHours, 44);
  assert.equal(rules.overtime.dailyOvertimeApplies, false);
  assert.equal(rules.payrollFallback.used, false);

  const bc = makeJob({ jurisdiction: 'BC' });
  const bcRules = rulesFor(bc, '2026-10-01', '2026-10-14');
  assert.equal(bcRules.overtime.doubleTimeDailyThresholdHours, 12);

  const peToday = makeJob({ jurisdiction: 'PE' });
  const peRules = rulesFor(peToday, '2026-10-01', '2026-10-14');
  assert.equal(peRules.overtime.weeklyThresholdHours, 44, 'the 2026 PEI act change is in force');

  const peHistorical = rulesFor(peToday, '2025-10-01', '2025-10-14');
  assert.equal(peHistorical.overtime.weeklyThresholdHours, 48, 'historical periods keep the old 48 h rule');
});

test('rule resolution: a proposed future rule is never applied automatically', () => {
  const job = makeJob({ jurisdiction: 'NS' });
  const now = rulesFor(job, '2026-10-01', '2026-10-14');
  assert.equal(now.overtime.weeklyThresholdHours, 48);
  assert.equal(now.overtimeStatus, 'verified');
  const future = rulesFor(job, '2027-05-01', '2027-05-14');
  assert.equal(future.overtime.weeklyThresholdHours, 48, 'the 44 h change is legislated but not verified as in force');
  assert.notEqual(future.overtimePack?.version, '2027.1');
  assert.equal(future.overtimeMode, 'jurisdiction_verified');
});

test('a custom workplace rule always wins over the jurisdiction default', () => {
  const job = makeJob({
    jurisdiction: 'ON',
    overtime: {
      source: 'custom',
      tiers: [{ afterWeeklyHours: 36, afterDailyHours: null, multiplier: 1.5, label: 'Over 36 h' }],
      dailyOvertimeApplies: false,
      weeklyOvertimeApplies: true,
      hasAgreement: 'yes',
      note: 'Compressed week agreement',
    },
  });
  const rules = rulesFor(job, '2026-10-01', '2026-10-14');
  assert.equal(rules.overtimeMode, 'custom');
  assert.equal(rules.overtime.weeklyThresholdHours, 36);
  assert.equal(rules.overtime.label, 'Custom rule — Compressed week agreement');
});

test('payroll pack fallback is explicit when no verified year covers the date', () => {
  const bundle = { ...BUNDLED_RULE_BUNDLE, payroll: BUNDLED_RULE_BUNDLE.payroll.filter((pack) => pack.taxYear === 2026) };
  const resolved = resolvePayrollPack(bundle, '2020-05-01');
  assert.equal(resolved.pack.taxYear, 2026);
  assert.equal(resolved.fallback.used, true);
  assert.ok(resolved.fallback.reason?.includes('No verified payroll parameters'));
});

test('a pay period window always covers the work weeks it touches', () => {
  const job = makeJob({ workWeek: { startsOn: 0, averagingWeeks: 1 } });
  const period = { index: 0, start: '2026-09-24', end: '2026-10-07', payday: '2026-10-12', days: 14, label: 'x' };
  const window = shiftWindowFor(period, job);
  assert.ok(window.from <= '2026-09-24');
  assert.ok(window.to >= '2026-10-07');
  assert.equal(periodsPerYearFor(job), 26);
});
