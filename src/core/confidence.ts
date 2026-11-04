/**
 * estimateConfidenceEngine (spec 21)
 *
 * Confidence is NOT a statistical probability and is never shown as a fake
 * percentage. It measures how complete the configuration is:
 *   basic  — standard assumptions
 *   good   — schedule, work week and tax defaults configured
 *   high   — year-to-date payroll configuration supplied as well
 */
export type ConfidenceLevel = 'basic' | 'good' | 'high';

export type ConfidenceInput = {
  /** A valid hourly rate exists for the period. */
  hasRate: boolean;
  /** Job has a pay schedule with a real anchor. */
  hasPaySchedule: boolean;
  /** User explicitly confirmed the work week start. */
  hasWorkWeek: boolean;
  /** Tax claim configuration was reviewed (not "not sure"). */
  hasTaxConfiguration: boolean;
  /** Year-to-date payroll amounts supplied. */
  hasYtd: boolean;
  /** Overtime rules come from a verified jurisdiction pack or a custom rule. */
  overtimeRuleResolved: boolean;
  /** Payroll parameters are the verified ones for the pay date. */
  payrollParametersCurrent: boolean;
  /** Vacation handling known. */
  vacationKnown: boolean;
  /** Breaks configured on the job (even if zero). */
  breaksKnown: boolean;
};

export type ConfidenceResult = {
  level: ConfidenceLevel;
  /** What we know. */
  known: string[];
  /** What we are assuming. */
  assumptions: string[];
  /** Concrete ways to improve the estimate. */
  improvements: string[];
};

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const known: string[] = [];
  const assumptions: string[] = [];
  const improvements: string[] = [];

  if (input.hasRate) known.push('Your hourly rate');
  else assumptions.push('No hourly rate is set for this job, so earnings cannot be estimated.');

  if (input.hasPaySchedule) known.push('Your pay schedule and payday');
  else assumptions.push('Pay schedule defaults are being used.');

  if (input.hasWorkWeek) known.push('Your work week start day');
  else assumptions.push("We assume the work week starts on the day you picked by default.");

  if (input.overtimeRuleResolved) known.push('Overtime rules');
  else {
    assumptions.push('Overtime is not being applied automatically because the rule for your workplace is not confirmed.');
    improvements.push('Set your workplace overtime rule in Job settings.');
  }

  if (input.hasTaxConfiguration) known.push('Tax claim information');
  else {
    assumptions.push('Basic personal claim amounts are used, with no TD1 adjustments.');
    improvements.push('Add your TD1 claim amounts in Settings → Pay estimates.');
  }

  if (input.hasYtd) known.push('Year-to-date CPP, EI and tax amounts');
  else {
    assumptions.push('Annual maximums are projected from this pay period across the year.');
    improvements.push('Enter year-to-date amounts to make annual maximums exact.');
  }

  if (!input.payrollParametersCurrent) {
    assumptions.push('The verified payroll parameters for this pay date are not available yet, so the most recent verified ones are used.');
  }

  if (input.vacationKnown) known.push('How your employer handles vacation pay');
  else {
    assumptions.push('Vacation pay is left out of the estimate.');
    improvements.push('Tell us how your employer handles vacation pay in Job settings.');
  }

  if (input.breaksKnown) known.push('Break rules for your shifts');
  else {
    assumptions.push('No unpaid breaks are deducted.');
    improvements.push('Add your normal unpaid break to shift templates.');
  }

  let score = 0;
  if (input.hasRate) score += 1;
  if (input.hasPaySchedule) score += 1;
  if (input.hasWorkWeek) score += 1;
  if (input.hasRate && input.hasTaxConfiguration) score += 1;
  if (input.hasYtd) score += 1;
  if (input.overtimeRuleResolved) score += 1;
  if (input.vacationKnown) score += 1;
  if (input.payrollParametersCurrent) score += 1;

  let level: ConfidenceLevel = 'basic';
  if (score >= 4) level = 'good';
  if (score >= 7) level = 'high';
  // Year-to-date data is what makes an estimate genuinely high confidence.
  if (!input.hasYtd && level === 'high') level = 'good';

  return { level, known, assumptions, improvements };
}

export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'High confidence';
    case 'good':
      return 'Good confidence';
    default:
      return 'Basic estimate';
  }
}
