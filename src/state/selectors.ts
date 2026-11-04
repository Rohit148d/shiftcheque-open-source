/**
 * Derived, memoised selectors (spec 88).
 *
 * Everything the UI needs is computed here and cached by (job, period, data
 * version). Nothing recalculates complete pay history on a render.
 */
import { calculatePayPeriod, periodsPerYearFor, shiftWindowFor, type PayPeriodCalculation } from '../core/calculate.ts';
import { calculateExtraShift, type ExtraShiftResult } from '../core/extraShift.ts';
import type { Minutes } from '../core/duration.ts';
import type { Micro } from '../core/money.ts';
import { liveElapsedMinutes } from '../core/shiftTime.ts';
import { payPeriodFor, payPeriodsInRange, periodLabel, workWeekFor, type PayPeriod } from '../core/workweek.ts';
import { resolveRules } from '../rules/loader.ts';
import type { RuleBundle } from '../rules/types.ts';
import type { DeductionProfile, Job, RateRecord, Shift } from '../core/types.ts';
import type { ExtraEarning } from '../core/grosspay.ts';
import { shiftsInWindow, type AppState } from './store.ts';
import { calculationCacheKey, extrasKeyFor, shiftsFingerprint } from './calculationCache.ts';
import { calculationCache } from './calculationCacheStore.ts';

export type StoreSlice = Pick<AppState, 'jobs' | 'rates' | 'profiles' | 'shifts' | 'ruleBundle' | 'today'>;

export type CalculationInput = StoreSlice & {
  jobId: string;
  dateKey?: string;
  extraEarnings?: ExtraEarning[];
};

function cacheKey(job: Job, period: PayPeriod, today: string, extras: ExtraEarning[], shifts: Shift[]): string {
  return calculationCacheKey({
    jobId: job.id,
    periodStart: period.start,
    periodEnd: period.end,
    today,
    extrasKey: extrasKeyFor(extras.map((extra) => ({ id: extra.id, label: extra.label, amount: extra.amount }))),
    // The estimate is a function of these shifts and this job configuration, so
    // both are part of its identity.
    shiftsFingerprint: shiftsFingerprint(shifts),
    jobUpdatedAt: job.updatedAt,
  });
}

export function activeJob(state: Pick<AppState, 'jobs' | 'activeJobId'>): Job | null {
  return state.jobs.find((job) => job.id === state.activeJobId) ?? state.jobs.find((job) => !job.archived) ?? null;
}

export function profileFor(state: Pick<AppState, 'profiles'>, jobId: string): DeductionProfile {
  return (
    state.profiles[jobId] ?? {
      id: `profile-${jobId}`,
      jobId,
      cppExempt: false,
      eiExempt: false,
      federalClaimCode: 'default',
      provincialClaimCode: 'default',
      fixedDeductions: [],
      percentDeductions: [],
      ytd: null,
    }
  );
}

/** Resolves the period a date belongs to. */
export function periodContaining(job: Job, dateKey: string): PayPeriod {
  return payPeriodFor(dateKey, job.paySchedule);
}

export function currentPeriodFor(job: Job, today: string): PayPeriod {
  return payPeriodFor(today, job.paySchedule);
}

/** The next period whose payday has not passed yet. */
export function nextPayPeriodFor(job: Job, today: string): PayPeriod {
  let period = payPeriodFor(today, job.paySchedule);
  let guard = 0;
  while (period.payday < today && guard < 60) {
    period = payPeriodFor(addDaysKey(period.end, 1), job.paySchedule);
    guard += 1;
  }
  return period;
}

function addDaysKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Memoised pay-period calculation for a job. */
export function calculateForJob(
  state: StoreSlice,
  jobId: string,
  dateKey?: string,
  options: { extraEarnings?: ExtraEarning[]; ignoreCache?: boolean } = {},
): PayPeriodCalculation | null {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return null;
  const anchor = dateKey ?? state.today;
  const period = payPeriodFor(anchor, job.paySchedule);
  const extras = options.extraEarnings ?? [];
  const window = shiftWindowFor(period, job);
  const windowShifts = state.shifts.filter(
    (shift) => shift.jobId === jobId && shift.date >= window.from && shift.date <= window.to,
  );
  const key = cacheKey(job, period, state.today, extras, windowShifts);
  if (!options.ignoreCache) {
    const cached = calculationCache.get(key);
    if (cached) return cached;
  }

  const shifts = windowShifts;
  const rules = resolveRules({
    bundle: state.ruleBundle as RuleBundle,
    job,
    date: period.payday,
    fromDate: window.from,
    toDate: window.to,
    serviceStartDate: '2020-01-01',
  });
  const liveShift = shifts.find((shift) => shift.status === 'in_progress');
  const live = liveShift ? liveElapsedMinutes(liveShift, Date.now()) : undefined;

  const calculation = calculatePayPeriod({
    job,
    rates: state.rates[jobId] ?? [],
    shifts,
    period,
    today: state.today,
    rules,
    profile: profileFor(state, jobId),
    extraEarnings: extras,
    serviceStartDate: '2020-01-01',
    liveMinutes: live,
  });

  calculationCache.set(key, calculation);
  return calculation;
}

export function clearCalculationCache(): void {
  calculationCache.clear();
}
export function previewCalculationFor(
  state: StoreSlice,
  input: { job: Job; rates: RateRecord[]; dateKey?: string; extraEarnings?: ExtraEarning[] },
): PayPeriodCalculation | null {  const { job, rates } = input;
  const anchor = input.dateKey ?? state.today;
  const period = payPeriodFor(anchor, job.paySchedule);
  const window = shiftWindowFor(period, job);
  const shifts = state.shifts.filter(
    (shift) => shift.jobId === job.id && shift.date >= window.from && shift.date <= window.to,
  );
  const rules = resolveRules({
    bundle: state.ruleBundle as RuleBundle,
    job,
    date: period.payday,
    fromDate: window.from,
    toDate: window.to,
    serviceStartDate: '2020-01-01',
  });
  return calculatePayPeriod({
    job,
    rates,
    shifts,
    period,
    today: state.today,
    rules,
    profile: profileFor(state, job.id),
    extraEarnings: input.extraEarnings ?? [],
    serviceStartDate: '2020-01-01',
  });
}

export function periodsForJob(state: StoreSlice, jobId: string, count: number): PayPeriod[] {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return [];
  const current = payPeriodFor(state.today, job.paySchedule);
  const from = addDaysKey(current.start, -count * 40);
  const periods = payPeriodsInRange(from, state.today, job.paySchedule);
  return periods.slice(-count).reverse();
}

export type NextShiftInfo = { shift: Shift; minutes: Minutes; isToday: boolean; isTomorrow: boolean };

export function nextShiftFor(state: Pick<AppState, 'shifts' | 'today'>, jobId: string | null): NextShiftInfo | null {
  const candidates = state.shifts
    .filter((shift) => (jobId ? shift.jobId === jobId : true))
    .filter((shift) => shift.type === 'work' || shift.type === 'training' || shift.type === 'on_call')
    .filter((shift) => shift.status === 'scheduled' || shift.status === 'in_progress')
    .filter((shift) => shift.date >= state.today)
    .sort((a, b) => (a.date === b.date ? a.scheduledStart.localeCompare(b.scheduledStart) : a.date.localeCompare(b.date)));
  const shift = candidates[0];
  if (!shift) return null;
  return {
    shift,
    minutes: 0,
    isToday: shift.date === state.today,
    isTomorrow: shift.date === addDaysKey(state.today, 1),
  };
}

export function shiftsOnDate(state: Pick<AppState, 'shifts'>, dateKey: string, jobId?: string | null): Shift[] {
  return state.shifts
    .filter((shift) => shift.date === dateKey && (!jobId || shift.jobId === jobId))
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

export function shiftsInMonth(state: Pick<AppState, 'shifts'>, year: number, month: number, jobId?: string | null): Shift[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return state.shifts.filter((shift) => shift.date.startsWith(prefix) && (!jobId || shift.jobId === jobId));
}

export function runExtraShift(
  state: StoreSlice,
  input: { jobId: string; dateKey: string; startClock: string; endClock: string },
): ExtraShiftResult | null {
  const job = state.jobs.find((candidate) => candidate.id === input.jobId);
  if (!job) return null;
  const period = payPeriodFor(input.dateKey, job.paySchedule);
  const window = shiftWindowFor(period, job);
  const shifts = state.shifts.filter(
    (shift) => shift.jobId === input.jobId && shift.date >= window.from && shift.date <= window.to,
  );
  const rules = resolveRules({
    bundle: state.ruleBundle as RuleBundle,
    job,
    date: period.payday,
    fromDate: window.from,
    toDate: window.to,
    serviceStartDate: '2020-01-01',
  });
  return calculateExtraShift({
    job,
    rates: state.rates[input.jobId] ?? [],
    shifts,
    today: state.today,
    rules,
    profile: profileFor(state, input.jobId),
    extraEarnings: [],
    serviceStartDate: '2020-01-01',
    dateKey: input.dateKey,
    startClock: input.startClock,
    endClock: input.endClock,
    period,
  });
}

export type InsightsSummary = {
  periods: {
    period: PayPeriod;
    gross: Micro;
    net: Micro;
    workedMinutes: Minutes;
    scheduledMinutes: Minutes;
    overtimeMinutes: Minutes;
    premiumPay: Micro;
  }[];
  totals: { gross: Micro; net: Micro; workedMinutes: Minutes; scheduledMinutes: Minutes; overtimeMinutes: Minutes; premiumPay: Micro };
  monthly: { monthKey: string; gross: Micro; net: Micro; workedMinutes: Minutes; overtimeMinutes: Minutes }[];
  weeklyOvertime: { weekStart: string; overtimeMinutes: Minutes }[];
  difference: { periodLabel: string; estimatedNet: Micro; actualNet: Micro }[];
};

/** Aggregates the last N periods for the insights screen. */
export function insightsForJob(state: StoreSlice, jobId: string, periodCount = 12): InsightsSummary {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  const empty: InsightsSummary = {
    periods: [],
    totals: { gross: 0n, net: 0n, workedMinutes: 0, scheduledMinutes: 0, overtimeMinutes: 0, premiumPay: 0n },
    monthly: [],
    weeklyOvertime: [],
    difference: [],
  };
  if (!job) return empty;

  const periods = periodsForJob(state, jobId, periodCount);
  const rows: InsightsSummary['periods'] = [];
  const weekly = new Map<string, Minutes>();

  for (const period of periods) {
    const calculation = calculateForJob(state, jobId, period.start, { ignoreCache: true });
    if (!calculation) continue;
    rows.push({
      period,
      gross: calculation.gross.gross,
      net: calculation.deductions.net,
      workedMinutes: calculation.totalPaidMinutes,
      scheduledMinutes: calculation.projection.scheduledMinutes,
      overtimeMinutes: calculation.overtime.overtimeMinutes + calculation.overtime.doubleTimeMinutes,
      premiumPay: calculation.gross.premiumPay,
    });
    for (const week of calculation.overtime.perWeek) {
      weekly.set(week.key, (weekly.get(week.key) ?? 0) + week.overtimeMinutes + week.doubleTimeMinutes);
    }
  }

  const totals = rows.reduce(
    (acc, row) => ({
      gross: acc.gross + row.gross,
      net: acc.net + row.net,
      workedMinutes: acc.workedMinutes + row.workedMinutes,
      scheduledMinutes: acc.scheduledMinutes + row.scheduledMinutes,
      overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
      premiumPay: acc.premiumPay + row.premiumPay,
    }),
    {
      gross: 0n as Micro,
      net: 0n as Micro,
      workedMinutes: 0 as Minutes,
      scheduledMinutes: 0 as Minutes,
      overtimeMinutes: 0 as Minutes,
      premiumPay: 0n as Micro,
    },
  );

  const monthlyMap = new Map<string, { gross: Micro; net: Micro; workedMinutes: Minutes; overtimeMinutes: Minutes }>();
  for (const row of rows) {
    const key = row.period.start.slice(0, 7);
    const existing = monthlyMap.get(key) ?? { gross: 0n, net: 0n, workedMinutes: 0, overtimeMinutes: 0 };
    monthlyMap.set(key, {
      gross: existing.gross + row.gross,
      net: existing.net + row.net,
      workedMinutes: existing.workedMinutes + row.workedMinutes,
      overtimeMinutes: existing.overtimeMinutes + row.overtimeMinutes,
    });
  }

  return {
    periods: rows,
    totals,
    monthly: [...monthlyMap.entries()].map(([monthKey, value]) => ({ monthKey, ...value })).sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
    weeklyOvertime: [...weekly.entries()].map(([weekStart, overtimeMinutes]) => ({ weekStart, overtimeMinutes })).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    difference: [],
  };
}

/** Overtime radar for the current work week of a job. */
export function radarForJob(state: StoreSlice, jobId: string): PayPeriodCalculation['radar'] | null {
  const calculation = calculateForJob(state, jobId, state.today);
  return calculation?.radar ?? null;
}

export function workWeekLabelFor(job: Job, dateKey: string): string {
  return workWeekFor(dateKey, job.workWeek).label;
}

export function labelForPeriod(period: PayPeriod): string {
  return periodLabel(period.start, period.end);
}

export function periodsPerYear(job: Job): number {
  return periodsPerYearFor(job);
}

export function shiftsForWindow(state: Pick<AppState, 'shifts'>, jobId: string, from: string, to: string): Shift[] {
  return shiftsInWindow(state, jobId, from, to);
}
