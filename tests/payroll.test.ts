import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeContribution, computeCpp, computeCpp2, computeEi, computeQpip, computeQpp, computeQpp2, secondTierEarnings } from '../src/core/payroll/contributions.ts';
import { bracketTax, computeAnnualTax } from '../src/core/payroll/tax.ts';
import { computeDeductions } from '../src/core/payroll/deductionEngine.ts';
import { microFromDollars, toFixed } from '../src/core/money.ts';
import { BUNDLED_RULE_BUNDLE } from '../src/rules/bundle.ts';
import { resolvePayrollPack } from '../src/rules/loader.ts';
import { makeJob, makeProfile, money } from './helpers.ts';

const pack2026 = resolvePayrollPack(BUNDLED_RULE_BUNDLE, '2026-10-15').pack;
const pack2025H1 = resolvePayrollPack(BUNDLED_RULE_BUNDLE, '2025-03-15').pack;
const pack2025H2 = resolvePayrollPack(BUNDLED_RULE_BUNDLE, '2025-11-15').pack;

test('the bundled bundle validates and resolves a pack for every year', () => {
  assert.equal(pack2026.taxYear, 2026);
  assert.equal(pack2025H1.taxYear, 2025);
  assert.equal(pack2025H1.version, '2025.1');
  assert.equal(pack2025H2.version, '2025.2');
  assert.equal(BUNDLED_RULE_BUNDLE.sources.length > 20, true);
  assert.equal(BUNDLED_RULE_BUNDLE.overtime.length >= 16, true);
});

test('verified 2026 parameters match the official published values', () => {
  assert.equal(pack2026.federal.cpp.maximumContribution, 4230.45);
  assert.equal(pack2026.federal.cpp2.maximumContribution, 416);
  assert.equal(pack2026.federal.ei.maximumContribution, 1123.07);
  assert.equal(pack2026.federal.eiQuebec.maximumContribution, 895.7);
  assert.equal(pack2026.quebec?.qpp.maximumContribution, 4479.3);
  assert.equal(pack2026.quebec?.qpip.maximumContribution, 442.9);
  assert.equal(pack2026.federal.cpp.maximumEarnings, 74600);
  assert.equal(pack2026.federal.ei.maximumEarnings, 68900);
});

test('CPP hits the annual maximum on a high biweekly salary of $5,000', () => {
  const result = computeCpp({
    periodEarnings: money('5000'),
    rule: pack2026.federal.cpp,
    periodsPerYear: 26,
  });
  assert.equal(result.annualAmount, money('4230.45'));
  assert.equal(toFixed(result.amount, 2), '162.71');
  assert.equal(result.capped, false);
});

test('CPP never exceeds the annual maximum once YTD is supplied', () => {
  const result = computeCpp({
    periodEarnings: money('5000'),
    rule: pack2026.federal.cpp,
    periodsPerYear: 26,
    ytd: money('4230.45'),
  });
  assert.equal(result.amount, 0n);
  assert.equal(result.capped, true);
});

test('CPP part-way through the year only deducts the remaining room', () => {
  const result = computeCpp({
    periodEarnings: money('5000'),
    rule: pack2026.federal.cpp,
    periodsPerYear: 26,
    ytd: money('4150.00'),
  });
  assert.equal(toFixed(result.amount, 2), '80.45');
  assert.equal(result.capped, true);
});

test('EI hits the annual maximum on a high biweekly salary', () => {
  const result = computeEi({
    periodEarnings: money('5000'),
    rule: pack2026.federal.ei,
    periodsPerYear: 26,
  });
  assert.equal(result.annualAmount, money('1123.07'));
  assert.equal(toFixed(result.amount, 2), '43.20');
});

test('Quebec EI uses the reduced rate', () => {
  const result = computeEi({
    periodEarnings: money('5000'),
    rule: pack2026.federal.eiQuebec,
    periodsPerYear: 26,
  });
  assert.equal(result.annualAmount, money('895.70'));
});

test('CPP2 only applies above the first ceiling', () => {
  const tier2 = secondTierEarnings(money('5000'), 74600, 85000, 26);
  assert.equal(toFixed(tier2, 2), '400.00'); // 10,400 of room / 26 periods
  const result = computeCpp2({ periodEarnings: tier2, rule: pack2026.federal.cpp2, periodsPerYear: 26 });
  assert.equal(result.annualAmount, money('416'));
  assert.equal(toFixed(result.amount, 2), '16.00');

  const lowIncome = secondTierEarnings(money('2000'), 74600, 85000, 26);
  assert.equal(lowIncome, 0n);
  const noSecondTier = computeCpp2({ periodEarnings: lowIncome, rule: pack2026.federal.cpp2, periodsPerYear: 26 });
  assert.equal(noSecondTier.amount, 0n);
});

test('the basic exemption is prorated across pay periods', () => {
  // Weekly at $700: annual 36,400; contributory = 36,400 - 3,500 = 32,900
  const result = computeContribution({
    periodEarnings: money('700'),
    rule: pack2026.federal.cpp,
    periodsPerYear: 52,
    label: 'CPP',
  });
  assert.equal(result.annualAmount, money('1957.55'));
  assert.equal(toFixed(result.amount, 2), '37.65');
});

test('Quebec programs: QPP, QPP2 and QPIP', () => {
  const qpp = computeQpp({ periodEarnings: money('5000'), rule: pack2026.quebec!.qpp, periodsPerYear: 26 });
  assert.equal(qpp.annualAmount, money('4479.30'));
  const qpp2 = computeQpp2({ periodEarnings: money('400'), rule: pack2026.quebec!.qpp2, periodsPerYear: 26 });
  assert.equal(qpp2.annualAmount, money('416'));
  const qpip = computeQpip({ periodEarnings: money('5000'), rule: pack2026.quebec!.qpip, periodsPerYear: 26 });
  assert.equal(qpip.annualAmount, money('442.90'));
});

test('progressive brackets tax only the income inside each band', () => {
  const brackets = [
    { upTo: 10_000, rate: 0.1 },
    { upTo: 20_000, rate: 0.2 },
    { upTo: null, rate: 0.3 },
  ];
  assert.equal(bracketTax(money('5000'), brackets), money('500'));
  assert.equal(bracketTax(money('15000'), brackets), money('2000'));
  assert.equal(bracketTax(money('25000'), brackets), money('4500'));
  assert.equal(bracketTax(0n, brackets), 0n);
  assert.equal(bracketTax(money('-100'), brackets), 0n);
});

test('tax credits reduce tax but never below zero', () => {
  const jurisdictionTax = {
    brackets: [{ upTo: null, rate: 0.15 }],
    basicPersonalAmount: 4_000,
    creditRate: 0.15,
    employmentAmount: 0,
  };
  const result = computeAnnualTax({
    periodTaxableIncome: money('1000'),
    periodsPerYear: 12,
    jurisdictionTax,
    annualPensionContribution: 0n,
    annualSecondTierContribution: 0n,
    annualInsurancePremium: 0n,
    label: 'test',
  });
  // annual 12,000 x 15% = 1,800 tax, less 4,000 x 15% = 600 of credits
  assert.equal(result.annualBeforeCredits, money('1800'));
  assert.equal(result.credits, money('600'));
  assert.equal(result.annualAfterCredits, money('1200'));
  assert.equal(result.amount, money('100'));

  const tiny = computeAnnualTax({
    periodTaxableIncome: money('100'),
    periodsPerYear: 12,
    jurisdictionTax: { ...jurisdictionTax, basicPersonalAmount: 20_000 },
    annualPensionContribution: 0n,
    annualSecondTierContribution: 0n,
    annualInsurancePremium: 0n,
    label: 'test',
  });
  assert.equal(tiny.annualAfterCredits, 0n);
});

test('the 2025 mid-year federal rate change is handled by effective dates', () => {
  const january = resolvePayrollPack(BUNDLED_RULE_BUNDLE, '2025-03-15').pack;
  const december = resolvePayrollPack(BUNDLED_RULE_BUNDLE, '2025-11-15').pack;
  assert.equal(january.federal.creditRate, 0.15);
  assert.equal(december.federal.creditRate, 0.14);

  const income = money('1500');
  const periods = 26;
  const januaryTax = computeAnnualTax({
    periodTaxableIncome: income,
    periodsPerYear: periods,
    jurisdictionTax: {
      brackets: january.federal.brackets,
      basicPersonalAmount: january.federal.basicPersonalAmount,
      creditRate: january.federal.creditRate,
      employmentAmount: january.federal.canadaEmploymentAmount,
    },
    annualPensionContribution: 0n,
    annualSecondTierContribution: 0n,
    annualInsurancePremium: 0n,
    label: 'Federal tax',
  });
  const decemberTax = computeAnnualTax({
    periodTaxableIncome: income,
    periodsPerYear: periods,
    jurisdictionTax: {
      brackets: december.federal.brackets,
      basicPersonalAmount: december.federal.basicPersonalAmount,
      creditRate: december.federal.creditRate,
      employmentAmount: december.federal.canadaEmploymentAmount,
    },
    annualPensionContribution: 0n,
    annualSecondTierContribution: 0n,
    annualInsurancePremium: 0n,
    label: 'Federal tax',
  });
  assert.ok(januaryTax.amount > decemberTax.amount, 'the 15% rate withheld more than the 14% rate');
});

test('deduction engine produces a full, balanced pay statement (Ontario)', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON' });
  const result = computeDeductions({
    gross: money('2400'),
    payDate: '2026-10-16',
    job,
    profile: makeProfile(),
    pack: pack2026,
    periodsPerYear: 26,
  });
  const codes = result.lines.map((line) => line.code);
  assert.ok(codes.includes('CPP'));
  assert.ok(codes.includes('CPP2'));
  assert.ok(codes.includes('EI'));
  assert.ok(codes.includes('FED_TAX'));
  assert.ok(codes.includes('PROV_TAX'));
  assert.equal(result.quebecPath, false);
  // net = gross - deductions, exactly
  assert.equal(result.net, result.gross - result.totalDeductions);
  assert.ok(result.net > 0n && result.net < result.gross);
});

test('deduction engine switches to the Quebec path for Quebec residents', () => {
  const job = makeJob({ jurisdiction: 'QC', taxProvince: 'QC' });
  const result = computeDeductions({
    gross: money('2400'),
    payDate: '2026-10-16',
    job,
    profile: makeProfile(),
    pack: pack2026,
    periodsPerYear: 26,
  });
  const codes = result.lines.map((line) => line.code);
  assert.ok(codes.includes('QPP'));
  assert.ok(codes.includes('QPP2'));
  assert.ok(codes.includes('QPIP'));
  assert.ok(codes.includes('EI'));
  assert.ok(!codes.includes('FED_TAX'), 'Quebec residents do not have federal tax withheld at source');
  assert.ok(codes.includes('PROV_TAX'));
  assert.equal(result.quebecPath, true);
});

test('a federally regulated job still uses the province of residence for tax', () => {
  const job = makeJob({ jurisdiction: 'FED', taxProvince: 'BC' });
  const result = computeDeductions({
    gross: money('2000'),
    payDate: '2026-10-16',
    job,
    profile: makeProfile(),
    pack: pack2026,
    periodsPerYear: 26,
  });
  const lines = result.lines.map((line) => line.label);
  assert.ok(lines.includes('BC tax'));
  assert.ok(lines.includes('Federal tax'));
});

test('CPP and EI exemptions are respected', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON' });
  const result = computeDeductions({
    gross: money('2000'),
    payDate: '2026-10-16',
    job,
    profile: makeProfile({ cppExempt: true, eiExempt: true }),
    pack: pack2026,
    periodsPerYear: 26,
  });
  const codes = result.lines.map((line) => line.code);
  assert.ok(!codes.includes('CPP'));
  assert.ok(!codes.includes('EI'));
  assert.ok(result.assumptions.some((assumption) => assumption.includes('CPP is turned off')));
});

test('other deductions reduce take-home without touching statutory lines', () => {
  const job = makeJob({ jurisdiction: 'ON', taxProvince: 'ON' });
  const withDeductions = computeDeductions({
    gross: money('2000'),
    payDate: '2026-10-16',
    job,
    profile: makeProfile({
      fixedDeductions: [{ id: 'union', label: 'Union dues', amount: money('25'), perPeriod: true }],
      percentDeductions: [{ id: 'rrsp', label: 'RRSP', percent: 3 }],
    }),
    pack: pack2026,
    periodsPerYear: 26,
  });
  const codes = withDeductions.lines.filter((line) => line.code === 'OTHER');
  assert.equal(codes.length, 2);
  assert.equal(withDeductions.lines.find((line) => line.label === 'Union dues')?.amount, microFromDollars('-25'));
  assert.equal(withDeductions.lines.find((line) => line.label === 'RRSP')?.amount, microFromDollars('-60'));
});
