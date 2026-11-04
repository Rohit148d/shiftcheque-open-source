/**
 * Job management logic (pure and testable).
 *
 * Everything a worker can change about their employment setup goes through here
 * first: rate changes with effective dates, schedule/work-week/jurisdiction
 * changes scoped to a pay period or an explicit correction, archive/restore, and
 * permanent deletion with its confirmation requirements.
 *
 * Keeping it pure means the risky parts — recalculating history, deleting a job
 * and everything attached to it, deciding when a free user may add another job —
 * are covered by tests instead of by tapping buttons.
 */
import { validateDateKeyInput } from './dateInput.ts';
import { microFromDollars, tryParseMoney, type Micro } from './money.ts';
import { rateForDate, sortRates } from './rate.ts';
import { addDays } from './tz.ts';
import type { Job, RateRecord, Shift } from './types.ts';
import type { PayPeriod } from './workweek.ts';

// ---------------------------------------------------------------------------
// Job collections (active vs archived)
// ---------------------------------------------------------------------------

export function activeJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => !job.archived);
}

export function archivedJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => job.archived);
}

export function activeJobCount(jobs: Job[]): number {
  return activeJobs(jobs).length;
}

/**
 * Free covers one ACTIVE job. Archived jobs never block a new one: a free user
 * who archived their old employer can add the next one.
 */
export function canAddActiveJob(input: { isPro: boolean; jobs: Job[] }): {
  allowed: boolean;
  reason: 'ok' | 'pro_required';
  activeCount: number;
} {
  const activeCount = activeJobCount(input.jobs);
  if (input.isPro) return { allowed: true, reason: 'ok', activeCount };
  return { allowed: activeCount === 0, reason: activeCount === 0 ? 'ok' : 'pro_required', activeCount };
}

/** Which job should become active after one is deleted or archived. */
export function nextActiveJobId(jobs: Job[], removedId: string): string | null {
  return activeJobs(jobs).find((job) => job.id !== removedId)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Hourly rate changes (history is never silently overwritten)
// ---------------------------------------------------------------------------

export type RateChangeMode =
  /** A raise from today: adds a new rate record. */
  | 'from_today'
  /** A raise from a chosen date: adds a new rate record. */
  | 'from_date'
  /** The original rate was typed wrong: edits the existing record. */
  | 'correct_original';

export type RateChangeRequest = {
  mode: RateChangeMode;
  newRateText: string;
  /** Required for 'from_date'. */
  effectiveDateText?: string;
  today: string;
};

export type RateChangeErrors = { rate?: string; effectiveDate?: string };

export type RateChangePlan = {
  mode: RateChangeMode;
  newRate: Micro;
  effectiveFrom: string;
  /** False only for a correction, which rewrites the record it replaces. */
  createsHistoryEntry: boolean;
  /** How many rate records exist afterwards. */
  resultingRateCount: number;
  /** The record that a correction replaces (undefined for a new entry). */
  replacedRateId?: string;
};

export function planRateChange(
  request: RateChangeRequest,
  context: { today: string; rates: RateRecord[] },
): { ok: boolean; plan?: RateChangePlan; errors: RateChangeErrors } {
  const errors: RateChangeErrors = {};
  const newRate = tryParseMoney(request.newRateText.trim());
  if (newRate === null || newRate <= 0n) errors.rate = 'Enter an hourly rate like 31.00.';
  if (newRate !== null && newRate > microFromDollars('10000')) errors.rate = 'That rate looks too high. Check the amount.';

  let effectiveFrom: string;
  let replacedRateId: string | undefined;

  if (request.mode === 'correct_original') {
    const original = sortRates(context.rates)[0];
    effectiveFrom = original?.effectiveFrom ?? context.today;
    replacedRateId = original?.id;
    if (!original) {
      // Nothing to correct yet: behave like "from today" rather than failing.
      effectiveFrom = context.today;
    }
  } else if (request.mode === 'from_today') {
    effectiveFrom = context.today;
  } else {
    const result = validateDateKeyInput(request.effectiveDateText ?? '');
    if (!result.ok) {
      errors.effectiveDate = result.message;
      effectiveFrom = context.today;
    } else {
      effectiveFrom = result.key;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const createsHistoryEntry = request.mode !== 'correct_original' || replacedRateId === undefined;
  return {
    ok: true,
    errors,
    plan: {
      mode: request.mode,
      newRate: newRate as Micro,
      effectiveFrom,
      createsHistoryEntry,
      resultingRateCount: createsHistoryEntry ? context.rates.length + 1 : context.rates.length,
      replacedRateId,
    },
  };
}

/**
 * What a rate change actually touches, so the user can see the impact before
 * saving: which shifts change, which keep the old rate, and how the pay period
 * estimate moves.
 */
export type RateChangeImpact = {
  /** Shifts whose pay changes because of this edit. */
  affectedShiftCount: number;
  affectedPastShiftCount: number;
  affectedScheduledShiftCount: number;
  /** Shifts that keep using the rate already stored for their date. */
  unaffectedShiftCount: number;
  previousRate: Micro;
  currentRateToday: Micro;
};

export function rateChangeImpact(
  request: RateChangeRequest,
  context: { today: string; rates: RateRecord[]; shifts: Shift[]; fallbackRate: Micro; jobId: string },
): { plan?: RateChangePlan; impact?: RateChangeImpact; errors: RateChangeErrors } {
  const planned = planRateChange(request, { today: context.today, rates: context.rates });
  if (!planned.ok || !planned.plan) return { errors: planned.errors };
  const plan = planned.plan;

  const jobShifts = context.shifts.filter((shift) => shift.jobId === context.jobId);
  let affectedPast = 0;
  let affectedScheduled = 0;
  let unaffected = 0;

  for (const shift of jobShifts) {
    // After the change, what rate would this shift resolve to?
    const rateAfter = plan.createsHistoryEntry
      ? resolveRateWithChange(context.rates, shift.date, context.fallbackRate, plan)
      : plan.newRate;

    if (rateAfter === context.fallbackRate && context.rates.length === 0) {
      unaffected += 1;
      continue;
    }
    const changed =
      plan.mode === 'correct_original'
        ? shift.date < plan.effectiveFrom || plan.replacedRateId !== undefined
        : shift.date >= plan.effectiveFrom;
    if (changed) {
      if (shift.date < context.today) affectedPast += 1;
      else affectedScheduled += 1;
    } else {
      unaffected += 1;
    }
  }

  return {
    plan,
    impact: {
      affectedShiftCount: affectedPast + affectedScheduled,
      affectedPastShiftCount: affectedPast,
      affectedScheduledShiftCount: affectedScheduled,
      unaffectedShiftCount: unaffected,
      previousRate: rateForDate(context.rates, context.today, context.fallbackRate),
      currentRateToday: rateForDate(context.rates, context.today, context.fallbackRate),
    },
    errors: {},
  };
}

function resolveRateWithChange(rates: RateRecord[], dateKey: string, fallback: Micro, plan: RateChangePlan): Micro {
  const candidate: RateRecord = {
    id: plan.replacedRateId ? `${plan.replacedRateId}-preview` : '__preview__',
    jobId: '',
    rate: plan.newRate,
    effectiveFrom: plan.effectiveFrom,
  };
  const next = plan.replacedRateId
    ? rates.map((rate) => (rate.id === plan.replacedRateId ? { ...rate, rate: plan.newRate } : rate))
    : [...rates, candidate];
  return rateForDate(next, dateKey, fallback);
}

export type RateChangeApplication = {
  /** The complete rate list after applying the change (ready to persist). */
  rates: RateRecord[];
  /** The change-log entry to store alongside it. */
  log: {
    setting: 'hourly_rate';
    effectiveFrom: string;
    previousValueJson: string;
    newValueJson: string;
    correction: boolean;
  };
};

export function applyRateChange(
  request: RateChangeRequest,
  context: { today: string; rates: RateRecord[]; jobId: string; makeId: () => string },
): { ok: boolean; errors: RateChangeErrors; application?: RateChangeApplication } {
  const planned = planRateChange(request, { today: context.today, rates: context.rates });
  if (!planned.ok || !planned.plan) return { ok: false, errors: planned.errors };
  const plan = planned.plan;
  const previousRate = rateForDate(context.rates, context.today, 0n);

  let rates: RateRecord[];
  if (plan.createsHistoryEntry) {
    rates = [
      ...context.rates,
      { id: context.makeId(), jobId: context.jobId, rate: plan.newRate, effectiveFrom: plan.effectiveFrom },
    ];
  } else {
    rates = context.rates.map((rate) =>
      rate.id === plan.replacedRateId ? { ...rate, rate: plan.newRate } : rate,
    );
  }

  return {
    ok: true,
    errors: {},
    application: {
      rates: sortRates(rates),
      log: {
        setting: 'hourly_rate',
        effectiveFrom: plan.effectiveFrom,
        previousValueJson: JSON.stringify({ rate: previousRate.toString() }),
        newValueJson: JSON.stringify({ rate: plan.newRate.toString(), mode: plan.mode }),
        correction: plan.mode === 'correct_original',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setting changes with an effective date
// ---------------------------------------------------------------------------

export type SettingKey = 'pay_schedule' | 'work_week' | 'jurisdiction' | 'overtime' | 'vacation' | 'premiums';

/**
 * next_period    applies from the first day after the current pay period
 * from_date      applies from a date the user picks
 * correct_previous  the earlier setup was wrong; earlier estimates change too
 */
export type SettingScope = 'next_period' | 'from_date' | 'correct_previous';

export type SettingWarning = 'future_only' | 'history_may_change';

export type SettingChangePlan = {
  setting: SettingKey;
  scope: SettingScope;
  effectiveFrom: string;
  correction: boolean;
  warning: SettingWarning;
};

export function planSettingChange(input: {
  setting: SettingKey;
  scope: SettingScope;
  effectiveDateText?: string;
  today: string;
  period: PayPeriod;
}): { ok: boolean; plan?: SettingChangePlan; errors: { effectiveDate?: string } } {
  if (input.scope === 'next_period') {
    return {
      ok: true,
      errors: {},
      plan: {
        setting: input.setting,
        scope: input.scope,
        effectiveFrom: addDays(input.period.end, 1),
        correction: false,
        warning: 'future_only',
      },
    };
  }

  if (input.scope === 'correct_previous') {
    return {
      ok: true,
      errors: {},
      plan: {
        setting: input.setting,
        scope: input.scope,
        effectiveFrom: addDays(input.period.start, -400),
        correction: true,
        warning: 'history_may_change',
      },
    };
  }

  const parsed = validateDateKeyInput(input.effectiveDateText ?? '');
  if (!parsed.ok) return { ok: false, errors: { effectiveDate: parsed.message } };
  return {
    ok: true,
    errors: {},
    plan: {
      setting: input.setting,
      scope: input.scope,
      effectiveFrom: parsed.key,
      correction: false,
      warning: parsed.key <= input.today ? 'history_may_change' : 'future_only',
    },
  };
}

export const SETTING_WARNING_COPY: Record<SettingWarning, string> = {
  future_only: 'This applies from the effective date onwards. Completed pay periods keep the setup that applied to them.',
  history_may_change:
    'This can change historical overtime, holiday, vacation, pay-period grouping and deduction estimates. Check a past pay period after saving.',
};

// ---------------------------------------------------------------------------
// Unsaved changes
// ---------------------------------------------------------------------------

/** True when leaving the screen would lose edits. */
export function shouldWarnAboutUnsavedChanges(input: { dirty: boolean; saving: boolean; saved: boolean }): boolean {
  if (input.saving || input.saved) return false;
  return input.dirty;
}

/** Field-by-field comparison used to decide whether anything changed. */
export function hasUnsavedChanges(before: Record<string, string | number>, after: Record<string, string | number>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

export type JobDataCounts = {
  shifts: number;
  breaks: number;
  rateChanges: number;
  premiums: number;
  estimates: number;
  cheques: number;
  comparisons: number;
  settingChanges: number;
  reminders: number;
  payPeriods: number;
  templates: number;
  patterns: number;
};

export const EMPTY_JOB_COUNTS: JobDataCounts = {
  shifts: 0,
  breaks: 0,
  rateChanges: 0,
  premiums: 0,
  estimates: 0,
  cheques: 0,
  comparisons: 0,
  settingChanges: 0,
  reminders: 0,
  payPeriods: 0,
  templates: 0,
  patterns: 0,
};

/** Rows the confirm screen shows, in plain language. */
export function deletionSummaryRows(counts: JobDataCounts): { label: string; count: number }[] {
  return [
    { label: 'shifts', count: counts.shifts },
    { label: 'rate changes', count: counts.rateChanges },
    { label: 'pay estimates', count: counts.estimates },
    { label: 'paycheque comparisons', count: counts.comparisons },
    { label: 'premium rules', count: counts.premiums },
    { label: 'setting changes', count: counts.settingChanges },
  ].filter((row) => row.count > 0);
}

export function totalJobRows(counts: JobDataCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/** The typed confirmation that guards permanent deletion. */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

export function deletionConfirmationSatisfied(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION_WORD;
}

export type JobDeletionPort = {
  countData(jobId: string): Promise<JobDataCounts>;
  /** Best effort: cancelling reminders must never block deleting the data. */
  cancelReminders(jobId: string): Promise<number>;
  /** Must be atomic: either the job and all of its rows are gone, or nothing is. */
  deleteJob(jobId: string): Promise<void>;
};

export type JobDeletionResult =
  | { status: 'deleted'; counts: JobDataCounts; cancelledReminders: number; remindersFailed: boolean }
  | { status: 'failed'; reason: string; rolledBack: true };

/**
 * Deletes a job and everything scoped to it.
 *
 * The database layer performs the delete inside an exclusive transaction and
 * verifies that no orphan rows remain, so a failure leaves the previous state
 * untouched (which is what `rolledBack` reports).
 */
export async function runJobDeletion(port: JobDeletionPort, jobId: string): Promise<JobDeletionResult> {
  let counts: JobDataCounts;
  try {
    counts = await port.countData(jobId);
  } catch (error) {
    return { status: 'failed', reason: describe(error), rolledBack: true };
  }

  let cancelledReminders = 0;
  let remindersFailed = false;
  try {
    cancelledReminders = await port.cancelReminders(jobId);
  } catch {
    // Notifications are not worth blocking a data deletion for.
    remindersFailed = true;
  }

  try {
    await port.deleteJob(jobId);
  } catch (error) {
    return { status: 'failed', reason: describe(error), rolledBack: true };
  }

  return { status: 'deleted', counts, cancelledReminders, remindersFailed };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
