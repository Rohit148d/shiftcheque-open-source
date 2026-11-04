/**
 * Canadian statutory contribution engines: CPP, CPP2, EI, QPP, QPP2, QPIP.
 *
 * One generic, auditable function powers all six programs. Each program is a
 * thin, named wrapper so call sites read like payroll language and each one can
 * be tested against its own official maximum.
 *
 * Method (matches the CRA/Revenu Québec annualised approach used for regular
 * pay periods):
 *   1. annualise the period's pensionable/insurable earnings
 *   2. apply the exemption, the maximum ceiling and the rate
 *   3. divide back to the period
 *   4. respect year-to-date values so annual maximums are never exceeded
 * Mid-year rule changes are handled by choosing the rule pack that is effective
 * on the pay date (see rules/loader.ts), not by hard-coding a tax year.
 */
import { divRoundHalfUp, mulRatio, roundToCents, type Micro } from '../money.ts';
import type { ContributionRule } from '../../rules/types.ts';

export type ContributionResult = {
  /** Contribution for this pay period. */
  amount: Micro;
  /** Annualised contribution before the period split (for explanations). */
  annualAmount: Micro;
  /** Annual maximum for this program. */
  annualMaximum: Micro;
  /** Year-to-date including this period. */
  ytdAfter: Micro;
  /** True when the annual maximum is reached (or was already reached). */
  capped: boolean;
  /** Portion of the period's earnings used for this program. */
  contributoryEarnings: Micro;
  /** Explanation shown in the breakdown sheet. */
  detail: string;
};

export type ContributionInput = {
  periodEarnings: Micro;
  rule: ContributionRule;
  periodsPerYear: number;
  /** Year-to-date contribution already deducted (0 when unknown). */
  ytd?: Micro;
  /** Year-to-date pensionable/insurable earnings when the user supplied them. */
  ytdEarnings?: Micro;
  label: string;
};

const ZERO = 0n;

export function computeContribution(input: ContributionInput): ContributionResult {
  const { rule, periodsPerYear, label } = input;
  const ytd = input.ytd ?? ZERO;
  const periods = Math.max(1, periodsPerYear);

  const maximumEarnings = cents(rule.maximumEarnings);
  const exemption = cents(rule.exemption);
  const annualMaximum = cents(rule.maximumContribution);

  const annualEarnings = input.periodEarnings * BigInt(periods);
  const contributoryAnnual = clampMin(annualEarnings - exemption, ZERO);
  const cappedAnnualBase = min(contributoryAnnual, clampMin(maximumEarnings - exemption, ZERO));

  const annualAmountRaw = mulRatio(cappedAnnualBase, Math.round(rule.rate * 100_000), 100_000);
  const annualAmount = roundToCents(min(annualAmountRaw, annualMaximum));

  const remaining = clampMin(annualMaximum - ytd, ZERO);
  const periodAmount = min(divRoundHalfUp(annualAmount, BigInt(periods)), remaining);
  const amount = roundToCents(periodAmount);
  const ytdAfter = ytd + amount;
  const capped = ytdAfter >= annualMaximum || remaining === ZERO;

  const ceilingText = formatDollars(maximumEarnings);
  const detail = capped
    ? `${label}: annual maximum of ${formatDollars(annualMaximum)} reached for this year.`
    : `${label}: ${(rule.rate * 100).toFixed(2)}% on earnings up to ${ceilingText}` +
      (exemption > ZERO ? ` after the ${formatDollars(exemption)} basic exemption.` : '.');

  return {
    amount,
    annualAmount,
    annualMaximum,
    ytdAfter,
    capped,
    contributoryEarnings: min(input.periodEarnings, clampMin(maximumEarnings, ZERO)),
    detail,
  };
}

// --- Named program engines -------------------------------------------------

export function computeCpp(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'CPP' });
}

export function computeCpp2(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'CPP2' });
}

export function computeEi(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'EI' });
}

export function computeQpp(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'QPP' });
}

export function computeQpp2(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'QPP2' });
}

export function computeQpip(input: Omit<ContributionInput, 'label'>): ContributionResult {
  return computeContribution({ ...input, label: 'QPIP' });
}

/**
 * CPP2/QPP2 apply only to earnings ABOVE the first ceiling (YMPE/MQY).
 * This helper computes that second-tier base so the two tiers never overlap.
 */
export function secondTierEarnings(periodEarnings: Micro, firstCeiling: number, secondCeiling: number, periodsPerYear: number): Micro {
  const periods = BigInt(Math.max(1, periodsPerYear));
  const first = cents(firstCeiling);
  const second = cents(secondCeiling);
  const annualEarnings = periodEarnings * periods;
  const inSecondTierAnnual = clampMin(min(annualEarnings, second) - first, ZERO);
  return divRoundHalfUp(inSecondTierAnnual, periods);
}

function clampMin(value: bigint, minimum: bigint): bigint {
  return value < minimum ? minimum : value;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function cents(dollars: number): Micro {
  return BigInt(Math.round(dollars * 100)) * 10_000n;
}

function formatDollars(value: Micro): string {
  return `$${(Number(value) / 1_000_000).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
