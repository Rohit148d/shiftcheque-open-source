/**
 * vacationEngine (spec 38)
 *
 * Vacation pay depends on the employer's method AND on service length. The
 * jurisdiction rule only supplies the *default percentage*; the user tells us
 * how their employer handles it. We never assume a method.
 */
import { percentOf, roundToCents, type Micro } from './money.ts';
import type { VacationConfig } from './types.ts';
import type { VacationRulePack } from '../rules/types.ts';

export type VacationMethod = VacationConfig['method'];

export type VacationResult = {
  /** Percent applied to gross for this period (0 when nothing is added to this cheque). */
  percent: number;
  /** Vacation pay added to this period's pay. */
  paidThisPeriod: Micro;
  /** Vacation pay accrued but not paid this period. */
  accruedThisPeriod: Micro;
  /** True when the amount is informational only. */
  accrualOnly: boolean;
  method: VacationMethod;
  explanation: string;
};

export function yearsOfService(startDate: string, asOfDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = asOfDate.split('-').map(Number);
  let years = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) years -= 1;
  return Math.max(0, years);
}

/** Default vacation percentage from the verified jurisdiction rule. */
export function defaultVacationPercent(rule: VacationRulePack | null, serviceYears: number): number {
  if (!rule) return 0.04;
  if (rule.yearsThreshold2 != null && rule.rateAfterThreshold2 != null && serviceYears >= rule.yearsThreshold2) {
    return rule.rateAfterThreshold2;
  }
  return serviceYears >= rule.yearsThreshold ? rule.rateAtThreshold : rule.rateUnderThreshold;
}

export function computeVacationPay(input: {
  config: VacationConfig;
  gross: Micro;
  rule: VacationRulePack | null;
  serviceYears: number;
}): VacationResult {
  const { config, gross, rule, serviceYears } = input;
  const rulePercent = defaultVacationPercent(rule, serviceYears);

  switch (config.method) {
    case 'each_cheque': {
      const percent = config.customPercent ?? rulePercent * 100;
      const paid = percentOf(gross, percent);
      return {
        percent,
        paidThisPeriod: roundToCents(paid),
        accruedThisPeriod: 0n,
        accrualOnly: false,
        method: config.method,
        explanation: `You told us vacation pay is paid on every cheque, so ${formatPercent(percent)} is added to this pay.`,
      };
    }
    case 'banked': {
      const percent = config.customPercent ?? rulePercent * 100;
      const accrued = percentOf(gross, percent);
      return {
        percent,
        paidThisPeriod: 0n,
        accruedThisPeriod: roundToCents(accrued),
        accrualOnly: true,
        method: config.method,
        explanation: `Vacation pay is banked with your employer. About ${formatPercent(percent)} accrues this period and is not part of take-home pay yet.`,
      };
    }
    case 'when_taken': {
      const percent = config.customPercent ?? rulePercent * 100;
      const accrued = percentOf(gross, percent);
      return {
        percent,
        paidThisPeriod: 0n,
        accruedThisPeriod: roundToCents(accrued),
        accrualOnly: true,
        method: config.method,
        explanation: `You told us vacation pay is paid when you take vacation, so it is shown as accruing, not as take-home pay.`,
      };
    }
    case 'custom': {
      const percent = config.customPercent ?? 0;
      const paid = percentOf(gross, percent);
      return {
        percent,
        paidThisPeriod: roundToCents(paid),
        accruedThisPeriod: 0n,
        accrualOnly: false,
        method: config.method,
        explanation: `Using your custom vacation rate of ${formatPercent(percent)}.`,
      };
    }
    case 'not_sure':
    default:
      return {
        percent: 0,
        paidThisPeriod: 0n,
        accruedThisPeriod: 0n,
        accrualOnly: false,
        method: config.method,
        explanation: 'Vacation pay is left out of the estimate because we do not know how your employer handles it. You can set it in Job settings.',
      };
  }
}

function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
