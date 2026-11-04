/**
 * Onboarding logic (pure, testable).
 *
 * This module owns the rules that the onboarding screen used to hold inline:
 * validation, job construction, the completion sequence and the start-up route.
 * Keeping it here means the "Finish Setup" flow is verified by tests instead of
 * by tapping buttons, and the screen cannot diverge from it again.
 *
 * Completion sequence (strict order):
 *   1. validate the draft
 *   2. persist the job
 *   3. persist the generated shifts
 *   4. ONLY THEN mark onboarding complete
 *   5. optionally request notification permission — failures are swallowed and
 *      can never block completion
 *   6. the caller navigates (always, whether or not notifications were enabled)
 */
import { validateDateKeyInput, todayKey } from './dateInput.ts';
import { microFromDollars, tryParseMoney, type Micro } from './money.ts';
import { generateRotationShifts, ROTATION_PRESETS } from './rotations.ts';
import { clockToMinutes } from './shiftTime.ts';
import type { BreakRule, Job, JurisdictionCode, Shift } from './types.ts';
import type { ZoneId } from './tz.ts';

export type OnboardingGoals = {
  nextPay: boolean;
  trackShifts: boolean;
  overtime: boolean;
  checkCheque: boolean;
  extraShifts: boolean;
};

export type OnboardingDraft = {
  jobName: string;
  rateText: string;
  /** Province of residence/regulation (never 'FED'). */
  province: Exclude<JurisdictionCode, 'FED'>;
  federal: boolean;
  zone: ZoneId;
  frequency: Job['paySchedule']['frequency'];
  anchorDateText: string;
  paydayOffsetText: string;
  weekStartsOn: number;
  shiftStart: string;
  shiftEnd: string;
  breakMinutesText: string;
  rotationId: string;
  customRule: boolean;
  agreement: Job['overtime']['hasAgreement'];
  goals: OnboardingGoals;
};

export type DraftErrors = {
  anchorDate?: string;
  paydayOffset?: string;
  rate?: string;
  shiftTimes?: string;
};

export type DraftValidation = {
  valid: boolean;
  errors: DraftErrors;
  /** Normalised values, present when valid. */
  anchorDate: string;
  paydayOffsetDays: number;
  hourlyRate: Micro;
  breakMinutes: number;
};

export function validateDraft(draft: OnboardingDraft): DraftValidation {
  const errors: DraftErrors = {};

  const anchor = validateDateKeyInput(draft.anchorDateText);
  if (!anchor.ok) errors.anchorDate = anchor.message;

  const offsetText = draft.paydayOffsetText.trim();
  const offsetValue = offsetText === '' ? 0 : Number(offsetText);
  if (!Number.isFinite(offsetValue) || !Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 60) {
    errors.paydayOffset = 'Enter a whole number of days between 0 and 60.';
  }

  const rateText = draft.rateText.trim();
  const rate = rateText === '' ? 0n : tryParseMoney(rateText);
  if (rateText !== '' && (rate === null || rate < 0n)) {
    errors.rate = 'Enter an hourly rate like 24.50.';
  }
  if (rateText !== '' && rate !== null && rate > microFromDollars('10000')) {
    errors.rate = 'That rate looks too high. Check the amount.';
  }

  const breakMinutes = draft.breakMinutesText.trim() === '' ? 0 : Number(draft.breakMinutesText);
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 240) {
    errors.shiftTimes = 'Enter a break of 0 to 240 minutes.';
  }

  const startMinutes = safeClockToMinutes(draft.shiftStart);
  const endMinutes = safeClockToMinutes(draft.shiftEnd);
  if (startMinutes === null || endMinutes === null) {
    errors.shiftTimes = 'Use a time like 09:00 or 17:30.';
  } else if (startMinutes === endMinutes) {
    errors.shiftTimes = 'Start and end cannot be the same time.';
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    anchorDate: anchor.ok ? anchor.key : '',
    paydayOffsetDays: Number.isInteger(offsetValue) ? offsetValue : 0,
    hourlyRate: rate ?? 0n,
    breakMinutes: Number.isFinite(breakMinutes) ? breakMinutes : 0,
  };
}

/** Returns null instead of throwing, so validation can report the problem. */
function safeClockToMinutes(value: string): number | null {
  try {
    return clockToMinutes(value);
  } catch {
    return null;
  }
}

export type BuildJobOptions = {
  /** Stable id so a double tap upserts instead of creating a second job. */
  jobId: string;
  now?: Date;
};

export function buildJobFromDraft(draft: OnboardingDraft, validation: DraftValidation, options: BuildJobOptions): Job {
  const iso = (options.now ?? new Date()).toISOString();
  const jurisdiction: JurisdictionCode = draft.federal ? 'FED' : draft.province;
  // The zone is chosen by the screen from the province of residence and is kept
  // verbatim here; date keys are never converted, so nothing can shift a day.
  const zone = draft.zone;
  return {
    id: options.jobId,
    name: draft.jobName.trim() || 'My job',
    colour: '#D52B1E',
    icon: 'briefcase',
    jurisdiction,
    // Tax always follows the province of residence, even for federally regulated work.
    taxProvince: draft.province,
    zone,
    hourlyRate: validation.hourlyRate,
    overtime: {
      source: draft.customRule ? 'custom' : 'jurisdiction',
      tiers: draft.customRule
        ? [{ afterWeeklyHours: 44, afterDailyHours: null, multiplier: 1.5, label: 'Over 44 h' }]
        : [],
      dailyOvertimeApplies: !draft.customRule,
      weeklyOvertimeApplies: true,
      hasAgreement: draft.agreement,
    },
    premiums: [],
    vacation: { method: 'not_sure' },
    workWeek: { startsOn: draft.weekStartsOn, averagingWeeks: draft.agreement === 'yes' ? 2 : 1 },
    paySchedule: {
      frequency: draft.frequency,
      anchorStart: validation.anchorDate,
      paydayOffsetDays: validation.paydayOffsetDays,
      customPeriodDays: draft.frequency === 'custom' ? 14 : undefined,
    },
    holidayPolicy: { mode: 'jurisdiction_standard', paysHolidayPay: false },
    rounding: { step: 0, mode: 'exact' },
    dstPolicy: 'wall_clock',
    defaultBreaks:
      validation.breakMinutes > 0 ? [{ label: 'Unpaid break', minutes: validation.breakMinutes, paid: false }] : [],
    archived: false,
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Shifts created during onboarding: a rotation when chosen, otherwise one shift. */
export function buildOnboardingShifts(
  job: Job,
  draft: OnboardingDraft,
  validation: DraftValidation,
  today: string = todayKey(),
  now: Date = new Date(),
): Shift[] {
  const iso = now.toISOString();
  const preset = ROTATION_PRESETS.find((candidate) => candidate.id === draft.rotationId);
  if (preset && preset.cycle.length > 0) {
    const generated = generateRotationShifts({
      jobId: job.id,
      preset,
      anchorDate: validation.anchorDate,
      startDate: today,
      days: 28,
      breaks: job.defaultBreaks,
      times: {
        day: { startClock: draft.shiftStart, endClock: draft.shiftEnd, overnight: draft.shiftEnd <= draft.shiftStart },
      },
      now,
    });
    if (generated.length > 0) return generated;
  }

  const breaks: BreakRule[] = job.defaultBreaks;
  return [
    {
      id: `first-${job.id}`,
      jobId: job.id,
      date: today,
      scheduledStart: draft.shiftStart,
      scheduledEnd: draft.shiftEnd,
      scheduledOvernight: draft.shiftEnd <= draft.shiftStart,
      breaks,
      type: 'work',
      status: 'scheduled',
      confirmed: false,
      createdAt: iso,
      updatedAt: iso,
    },
  ];
}

export type CompleteDependencies = {
  saveJob(job: Job): Promise<void>;
  saveShifts(shifts: Shift[]): Promise<void>;
  markComplete(patch: {
    onboarded: true;
    onboardedAt: string;
    exploreMode: false;
    notificationPromptAnswered: boolean;
    notifications?: Record<string, boolean>;
  }): Promise<void>;
  /** Optional and non-blocking: failures never prevent completion. */
  requestNotifications?: () => Promise<boolean>;
};

export type CompleteResult =
  | { status: 'completed'; job: Job; notificationsGranted: boolean | null }
  | { status: 'invalid'; errors: DraftErrors }
  | { status: 'failed'; reason: string; job: Job };

/**
 * The exact sequence the "Finish Setup" button performs.
 * On persistence failure it returns 'failed' WITHOUT marking onboarding complete,
 * so the caller can restore the button, keep the user's answers and show an error.
 */
export async function completeOnboarding(
  deps: CompleteDependencies,
  draft: OnboardingDraft,
  options: BuildJobOptions & { wantNotifications?: boolean; today?: string } = { jobId: `job-${Date.now()}` },
): Promise<CompleteResult> {
  const validation = validateDraft(draft);
  if (!validation.valid) return { status: 'invalid', errors: validation.errors };

  const job = buildJobFromDraft(draft, validation, options);
  const shifts = buildOnboardingShifts(job, draft, validation, options.today ?? todayKey(), options.now ?? new Date());

  try {
    await deps.saveJob(job);
    await deps.saveShifts(shifts);
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'We could not save your setup.',
      job,
    };
  }

  // Optional notification permission: requested AFTER persistence and never
  // allowed to block or fail the completion.
  let notificationsGranted: boolean | null = null;
  if (options.wantNotifications && deps.requestNotifications) {
    try {
      notificationsGranted = await deps.requestNotifications();
    } catch {
      notificationsGranted = false;
    }
  }

  const notifications: Record<string, boolean> | undefined =
    notificationsGranted === null
      ? undefined
      : notificationsGranted
        ? {}
        : { shift_tomorrow: false, shift_soon: false, confirm_shift: false };

  try {
    await deps.markComplete({
      onboarded: true,
      onboardedAt: (options.now ?? new Date()).toISOString(),
      exploreMode: false,
      notificationPromptAnswered: true,
      notifications,
    });
  } catch (error) {
    // The job is saved but the flag is not: the caller must surface this rather
    // than leaving the user in a loop, so the next attempt simply re-runs.
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'We could not finish setting up.',
      job,
    };
  }

  return { status: 'completed', job, notificationsGranted };
}

export type StartRoute = '/(tabs)' | '/onboarding';

/**
 * Where the app starts. Explore mode opens the real app with empty/demo states
 * and never marks onboarding complete or fabricates a job.
 */
export function resolveStartRoute(settings: { onboarded: boolean; exploreMode: boolean }): StartRoute {
  if (settings.onboarded) return '/(tabs)';
  if (settings.exploreMode) return '/(tabs)';
  return '/onboarding';
}
