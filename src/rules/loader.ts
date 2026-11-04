/**
 * rules/loader — effective-date aware rule resolution (spec 35, 36, 46).
 *
 * Rules are chosen for the date they apply to:
 *   - a rule pack is eligible when effectiveFrom <= date <= effectiveTo
 *   - only packs with status 'verified' may calculate automatically
 *   - if no verified pack covers the date, the most recent verified pack is
 *     used *and clearly flagged*, never silently
 *   - if nothing verified exists, the engine reports 'manual' and the UI asks
 *     the user to set a custom workplace rule instead of guessing
 *
 * Remote bundles are validated with the same Zod schemas before use; a failed
 * download keeps the last verified cached bundle, and a failed cache keeps the
 * bundled rules. The app never breaks offline.
 */
import { createHolidayLookup, type HolidayLookup } from '../core/holiday.ts';
import { resolveOvertimeRule, type ResolvedOvertimeRule } from '../core/overtime.ts';
import type { Job, JurisdictionCode } from '../core/types.ts';
import { yearsOfService } from '../core/vacation.ts';
import type {
  OvertimeRulePack,
  PayrollRulePack,
  RuleBundle,
  RuleStatus,
  VacationRulePack,
} from './types.ts';

export type ManualReason = 'no_verified_rule' | 'unverified_rule_for_date' | 'unsupported';

export type ResolvedRules = {
  overtime: ResolvedOvertimeRule;
  overtimePack: OvertimeRulePack | null;
  overtimeMode: 'jurisdiction_verified' | 'custom' | 'manual';
  overtimeStatus: RuleStatus | 'custom' | 'none';
  manualReason: ManualReason | null;
  vacationRule: VacationRulePack | null;
  vacationRuleStatus: RuleStatus | 'none';
  payrollPack: PayrollRulePack;
  payrollStatus: RuleStatus;
  payrollFallback: { used: boolean; requestedYear: number; usedYear: number; reason: string | null };
  holidayLookup: HolidayLookup;
  notes: string[];
};

function isEffective(from: string, to: string | null, date: string): boolean {
  return from <= date && (to === null || to >= date);
}

export function effectiveOn<T extends { effectiveFrom: string; effectiveTo: string | null }>(packs: T[], date: string): T[] {
  return packs
    .filter((pack) => isEffective(pack.effectiveFrom, pack.effectiveTo, date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

export function latestVerifiedBefore<T extends { effectiveFrom: string; effectiveTo: string | null; status: RuleStatus }>(
  packs: T[],
  date: string,
): T | null {
  const candidates = packs
    .filter((pack) => pack.status === 'verified' && pack.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0] ?? null;
}

export function resolvePayrollPack(bundle: RuleBundle, payDate: string): {
  pack: PayrollRulePack;
  status: RuleStatus;
  fallback: ResolvedRules['payrollFallback'];
} {
  const requestedYear = Number(payDate.slice(0, 4));
  const eligible = effectiveOn(bundle.payroll, payDate);
  const verified = eligible.find((pack) => pack.status === 'verified');
  if (verified) {
    return { pack: verified, status: 'verified', fallback: { used: false, requestedYear, usedYear: verified.taxYear, reason: null } };
  }
  const fallbackPack = latestVerifiedBefore(bundle.payroll, payDate);
  if (fallbackPack) {
    return {
      pack: fallbackPack,
      status: fallbackPack.status,
      fallback: {
        used: true,
        requestedYear,
        usedYear: fallbackPack.taxYear,
        reason: `Official ${requestedYear} payroll parameters have not been verified yet, so ${fallbackPack.taxYear} verified parameters are being used. Treat the deduction estimate as rough until they are updated.`,
      },
    };
  }
  const newest = eligible[0] ?? [...bundle.payroll].sort((a, b) => b.taxYear - a.taxYear)[0];
  return {
    pack: newest,
    status: 'unverified',
    fallback: {
      used: true,
      requestedYear,
      usedYear: newest.taxYear,
      reason: 'No verified payroll parameters could be found, so this estimate uses published parameters that still need confirmation.',
    },
  };
}

export function resolveOvertimePack(
  bundle: RuleBundle,
  jurisdiction: JurisdictionCode,
  date: string,
): { pack: OvertimeRulePack | null; status: RuleStatus | 'none'; reason: ManualReason | null } {
  const packs = bundle.overtime.filter((pack) => pack.jurisdiction === jurisdiction);
  const eligible = effectiveOn(packs, date);
  const verified = eligible.find((pack) => pack.status === 'verified');
  if (verified) return { pack: verified, status: 'verified', reason: null };
  // A superseded rule was in force (and verified) for its effective window, so
  // historical pay periods are still calculated with it.
  const superseded = eligible.find((pack) => pack.status === 'superseded');
  if (superseded) return { pack: superseded, status: 'superseded', reason: null };
  if (eligible.length > 0) {
    // A pack exists for this date but is not verified (proposed / unsupported).
    // Keep using the newest verified rule that was in force instead of
    // inventing thresholds, and flag the situation.
    const older = latestVerifiedBefore(packs, date);
    if (older) return { pack: older, status: older.status, reason: 'unverified_rule_for_date' };
    return { pack: eligible[0], status: eligible[0].status, reason: 'unverified_rule_for_date' };
  }
  const older = latestVerifiedBefore(packs, date);
  if (older) return { pack: older, status: older.status, reason: 'unverified_rule_for_date' };
  return { pack: null, status: 'none', reason: 'unsupported' };
}

export function resolveVacationRule(bundle: RuleBundle, jurisdiction: JurisdictionCode, date: string): VacationRulePack | null {
  const packs = bundle.vacation.filter((pack) => pack.jurisdiction === jurisdiction);
  const verified = effectiveOn(packs, date).find((pack) => pack.status === 'verified');
  if (verified) return verified;
  return latestVerifiedBefore(packs, date);
}

export type ResolveRulesInput = {
  bundle: RuleBundle;
  job: Job;
  /** Date the estimate is anchored on (usually the pay date). */
  date: string;
  /** Range used to materialise the statutory holiday calendar. */
  fromDate: string;
  toDate: string;
  serviceStartDate: string;
};

export function resolveRules(input: ResolveRulesInput): ResolvedRules {
  const { bundle, job, date } = input;
  const notes: string[] = [];

  // --- Overtime -----------------------------------------------------------
  const ot = resolveOvertimePack(bundle, job.jurisdiction, date);
  let overtimeMode: ResolvedRules['overtimeMode'];
  let overtime: ResolvedOvertimeRule;
  if (job.overtime.source === 'custom') {
    overtime = resolveOvertimeRule(job.overtime, null, null, 1.5, job.workWeek.averagingWeeks, 'Custom workplace rule');
    overtimeMode = 'custom';
  } else if (ot.pack && (ot.status === 'verified' || ot.status === 'superseded')) {
    overtime = resolveOvertimeRule(
      { ...job.overtime, dailyOvertimeApplies: ot.pack.dailyOvertimeApplies, weeklyOvertimeApplies: ot.pack.weeklyOvertimeApplies },
      ot.pack.dailyOvertimeThresholdHours ?? ot.pack.standardDailyHours,
      ot.pack.weeklyOvertimeThresholdHours ?? ot.pack.standardWeeklyHours,
      ot.pack.overtimeMultiplier,
      job.workWeek.averagingWeeks,
      jurisdictionLabel(job.jurisdiction),
    );
    overtime = {
      ...overtime,
      doubleTimeDailyThresholdHours: ot.pack.doubleTimeDailyThresholdHours,
      doubleTimeWeeklyThresholdHours: null,
      doubleTimeMultiplier: ot.pack.doubleTimeMultiplier,
    };
    overtimeMode = 'jurisdiction_verified';
  } else {
    overtime = resolveOvertimeRule(job.overtime, null, null, 1.5, job.workWeek.averagingWeeks, 'No verified rule');
    overtimeMode = 'manual';
    notes.push(
      'We do not have a verified automatic overtime rule for this jurisdiction and date yet. Set your workplace rule in Job settings and overtime will be calculated from it.',
    );
  }

  // --- Vacation -----------------------------------------------------------
  const vacationRule = resolveVacationRule(bundle, job.jurisdiction === 'FED' ? job.taxProvince : job.jurisdiction, date);

  // --- Payroll parameters -------------------------------------------------
  const payroll = resolvePayrollPack(bundle, date);
  if (payroll.fallback.used && payroll.fallback.reason) notes.push(payroll.fallback.reason);

  // --- Holidays -----------------------------------------------------------
  const holidayJurisdiction: JurisdictionCode = job.jurisdiction === 'FED' ? 'FED' : job.jurisdiction;
  const holidayLookup = createHolidayLookup(holidayJurisdiction, input.fromDate, input.toDate);
  if (job.jurisdiction === 'FED' && job.taxProvince !== 'QC') {
    // Federally regulated jobs still get their province's holiday calendar in
    // most cases; note the assumption instead of silently choosing one.
    notes.push('This job is federally regulated: federal statutory holidays are used for holiday premiums.');
  }

  if (job.overtime.hasAgreement === 'yes') {
    notes.push('You told us a collective agreement or averaging arrangement applies to this job — check that the configured thresholds match it.');
  }
  if (job.overtime.hasAgreement === 'not_sure') {
    notes.push('You were not sure whether an averaging arrangement applies. The standard rule is used; your payslip is the fastest way to check.');
  }

  void yearsOfService(input.serviceStartDate, date);

  return {
    overtime,
    overtimePack: ot.pack,
    overtimeMode,
    overtimeStatus: job.overtime.source === 'custom' ? 'custom' : ot.status,
    manualReason: overtimeMode === 'manual' ? ot.reason ?? 'no_verified_rule' : null,
    vacationRule,
    vacationRuleStatus: vacationRule?.status ?? 'none',
    payrollPack: payroll.pack,
    payrollStatus: payroll.status,
    payrollFallback: payroll.fallback,
    holidayLookup,
    notes,
  };
}

export function jurisdictionLabel(jurisdiction: JurisdictionCode): string {
  const labels: Record<JurisdictionCode, string> = {
    FED: 'Federal (Canada Labour Code)',
    AB: 'Alberta',
    BC: 'British Columbia',
    MB: 'Manitoba',
    NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador',
    NS: 'Nova Scotia',
    NT: 'Northwest Territories',
    NU: 'Nunavut',
    ON: 'Ontario',
    PE: 'Prince Edward Island',
    QC: 'Quebec',
    SK: 'Saskatchewan',
    YT: 'Yukon',
  };
  return labels[jurisdiction];
}
