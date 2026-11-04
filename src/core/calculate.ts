/**
 * calculatePayPeriod — the single top-level entry point for pay estimation.
 *
 * SHIFT -> HOURS -> CANADIAN PAY RULES -> DEDUCTIONS -> NEXT TAKE-HOME PAY
 *
 * Everything is derived from pure functions; the result is fully structured so
 * the UI can explain every number without recomputing anything.
 */
import { computeConfidence, type ConfidenceResult } from './confidence.ts';
import type { Minutes } from './duration.ts';
import { computeGrossPay, type ExtraEarning, type GrossPayResult } from './grosspay.ts';
import type { Micro } from './money.ts';
import { classifyOvertime, minutesUntilOvertime, type OvertimeSummary } from './overtime.ts';
import { computeDeductions, type DeductionEngineResult } from './payroll/deductionEngine.ts';
import { classifyShiftProgress, type ShiftProgress } from './shiftProgress.ts';
import { computeShiftTime, liveElapsedMinutes, type ShiftTimeResult } from './shiftTime.ts';
import { addDays, type ZoneId } from './tz.ts';
import type { ClassifiedSegment, DeductionProfile, EarningsLine, Job, RateRecord, Shift } from './types.ts';
import { workWeekFor, type PayPeriod, type WorkWeek } from './workweek.ts';
import type { ResolvedRules } from '../rules/loader.ts';

export type RadarInfo = {
  workWeek: WorkWeek;
  /** Minutes already worked in this work week. Never includes upcoming shifts. */
  workedMinutes: Minutes;
  /** Scheduled minutes still to come inside this work week. */
  scheduledRemainingMinutes: Minutes;
  /** worked + scheduled: how the week will look if the schedule holds. */
  projectedMinutes: Minutes;
  /** Overtime already locked in by worked minutes. */
  overtimeMinutes: Minutes;
  /** Overtime the week is heading for, including scheduled shifts. */
  projectedOvertimeMinutes: Minutes;
  thresholdMinutes: Minutes | null;
  /** Minutes left before the threshold, measured against the projection. */
  remainingMinutes: Minutes | null;
  todayMinutes: Minutes;
  dailyThresholdMinutes: Minutes | null;
  dailyOvertimeMinutes: Minutes;
  /** Premium minutes in the current week, for the "what's adding up" line. */
  premiumMinutes: Minutes;
};

/** One side of the worked / scheduled split. */
export type ProjectedSplit = {
  minutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  gross: Micro;
  shiftCount: number;
  lines: EarningsLine[];
};

/**
 * The projection basis for a pay period.
 *
 *   workedMinutes    already worked (actual/confirmed, or past scheduled shifts)
 *   scheduledMinutes upcoming scheduled paid hours inside this pay period
 *   projectedMinutes worked + scheduled — what the Next Pay estimate uses
 *
 * `projected.gross` is the full expected pay for the period; `worked.gross` is
 * only what has already been earned, which is what historical reporting uses.
 */
export type ProjectionSummary = {
  workedMinutes: Minutes;
  scheduledMinutes: Minutes;
  projectedMinutes: Minutes;
  worked: ProjectedSplit;
  scheduled: ProjectedSplit;
  projected: ProjectedSplit;
};

export type PayPeriodCalculationInput = {
  job: Job;
  rates: RateRecord[];
  /** Every shift that can influence this period (include a work-week buffer). */
  shifts: Shift[];
  period: PayPeriod;
  today: string;
  rules: ResolvedRules;
  profile: DeductionProfile;
  extraEarnings: ExtraEarning[];
  serviceStartDate: string;
  /** Minutes of a live shift in progress, when one is running. */
  liveMinutes?: Minutes;
  /** Injectable clock for deterministic tests (defaults to Date.now()). */
  now?: number;
};

export type PayPeriodCalculation = {
  period: PayPeriod;
  jobId: string;
  shiftTimes: Map<string, ShiftTimeResult>;
  overtime: OvertimeSummary;
  gross: GrossPayResult;
  deductions: DeductionEngineResult;
  confidence: ConfidenceResult;
  radar: RadarInfo;
  /** Shifts that belong to this period, in date order. */
  periodShifts: Shift[];
  /**
   * Eligible segments in the period (worked + scheduled). Cancelled and
   * non-earning entries are excluded from pay maths entirely.
   */
  periodSegments: ClassifiedSegment[];
  /**
   * Projected paid minutes for the period (worked + scheduled). This is the
   * figure the Next Pay card shows; `projection.workedMinutes` is what has
   * actually been worked so far.
   */
  totalPaidMinutes: Minutes;
  /** Worked / scheduled / projected split, including overtime and gross for each. */
  projection: ProjectionSummary;
  warnings: string[];
  ruleNotes: string[];
  /** Structured explanation data for the "How did you calculate this?" sheet. */
  explanation: {
    workWeekStart: number;
    payPeriodStart: string;
    payPeriodEnd: string;
    payday: string;
    jurisdiction: string;
    overtimeRuleLabel: string;
    overtimeMode: ResolvedRules['overtimeMode'];
    payrollRuleVersion: string;
    payrollRuleYear: number;
    payrollFallbackReason: string | null;
    rateSummary: { date: string; rate: bigint }[];
    holidayDates: string[];
    sourceUrls: string[];
  };
};

export function calculatePayPeriod(input: PayPeriodCalculationInput): PayPeriodCalculation {
  const { job, rates, period, rules } = input;
  const zone: ZoneId = job.zone;

  // 1. Wall-clock -> paid minutes for every relevant shift.
  const shiftTimes = new Map<string, ShiftTimeResult>();
  for (const shift of input.shifts) {
    shiftTimes.set(
      shift.id,
      computeShiftTime(shift, { zone, dstPolicy: job.dstPolicy, rounding: job.rounding }),
    );
  }

  // 2. Live shift minutes (a shift in progress counts toward the radar and the
  //    estimate while it is running).
  //
  //    Cancelled ("missed") and non-earning entries are dropped here, before
  //    overtime is classified, so they can neither consume the overtime
  //    threshold nor contribute to the projection.
  const progressByShift = new Map<string, ShiftProgress>();
  for (const shift of input.shifts) {
    progressByShift.set(shift.id, classifyShiftProgress(shift, input.today));
  }

  const segments: ClassifiedSegment[] = [];
  for (const shift of input.shifts) {
    const time = shiftTimes.get(shift.id);
    if (!time) continue;
    if (progressByShift.get(shift.id) === 'excluded') continue;
    if (shift.status === 'in_progress' && input.liveMinutes !== undefined) {
      const live = mergeLiveMinutes(time, input.liveMinutes, shift);
      segments.push(...live);
    } else {
      segments.push(...time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 })));
    }
  }
  segments.sort((a, b) => a.startMs - b.startMs);

  // 3. Overtime classification (work-week based).
  const overtime = classifyOvertime(
    segments,
    rules.overtimeMode === 'manual'
      ? { ...rules.overtime, dailyOvertimeApplies: false, weeklyOvertimeApplies: false, label: 'Not applied (no verified rule)' }
      : rules.overtime,
    job.workWeek,
  );

  const periodShifts = input.shifts
    .filter((shift) => shift.date >= period.start && shift.date <= period.end)
    .sort((a, b) => (a.date === b.date ? a.scheduledStart.localeCompare(b.scheduledStart) : a.date.localeCompare(b.date)));
  const periodShiftIds = new Set(periodShifts.map((shift) => shift.id));
  const periodSegments = overtime.segments.filter((segment) => periodShiftIds.has(segment.shiftId ?? ''));

  // 4. Worked vs scheduled vs projected.
  //
  //    Only shifts inside this pay period contribute, so next-period work is
  //    never pulled into this forecast and overtime still follows the work week.
  const nowMs = input.now ?? Date.now();

  // Share of an in-progress shift that is already earned (0..1). A live shift
  // contributes its elapsed minutes to "worked" and the remainder to
  // "scheduled", so worked + scheduled always equals the projection.
  const workedShare = new Map<string, number>();
  for (const shift of input.shifts) {
    if (progressByShift.get(shift.id) !== 'in_progress') continue;
    const time = shiftTimes.get(shift.id);
    const paid = time?.paidMinutes ?? 0;
    if (paid <= 0) {
      workedShare.set(shift.id, 0);
      continue;
    }
    const live = input.liveMinutes ?? (shift.liveStartedAtMs !== undefined ? liveElapsedMinutes(shift, nowMs) : 0);
    workedShare.set(shift.id, Math.max(0, Math.min(1, live / paid)));
  }

  const segmentsByShift = new Map<string, ClassifiedSegment[]>();
  for (const segment of periodSegments) {
    const key = segment.shiftId ?? '';
    segmentsByShift.set(key, [...(segmentsByShift.get(key) ?? []), segment]);
  }

  const workedSegments: ClassifiedSegment[] = [];
  const scheduledSegments: ClassifiedSegment[] = [];
  for (const [shiftId, shiftSegments] of segmentsByShift) {
    const progress = progressByShift.get(shiftId) ?? 'scheduled';
    if (progress === 'excluded') continue;
    if (progress === 'worked') {
      workedSegments.push(...shiftSegments);
      continue;
    }
    if (progress === 'scheduled') {
      scheduledSegments.push(...shiftSegments);
      continue;
    }
    const split = splitSegmentsByWorkedShare(shiftSegments, workedShare.get(shiftId) ?? 0);
    workedSegments.push(...split.worked);
    scheduledSegments.push(...split.remaining);
  }
  workedSegments.sort((a, b) => a.startMs - b.startMs);
  scheduledSegments.sort((a, b) => a.startMs - b.startMs);

  const servicesYears = serviceYears(input.serviceStartDate, period.end);
  const grossCommon = {
    job,
    rates,
    holidayLookup: rules.holidayLookup,
    servicesYears,
    vacationRule: rules.vacationRule,
  };

  // Earnings for the full period (the Next Pay basis), and for each side of the
  // split. Extra earnings are period-level, so they belong only to the projection.
  const gross = computeGrossPay({
    ...grossCommon,
    shifts: periodShifts,
    segments: periodSegments,
    extraEarnings: input.extraEarnings,
  });
  const workedShiftIds = new Set(workedSegments.map((segment) => segment.shiftId ?? ''));
  const scheduledShiftIds = new Set(scheduledSegments.map((segment) => segment.shiftId ?? ''));
  const grossWorked = computeGrossPay({
    ...grossCommon,
    shifts: periodShifts.filter((shift) => workedShiftIds.has(shift.id)),
    segments: workedSegments,
    extraEarnings: [],
  });
  const grossScheduled = computeGrossPay({
    ...grossCommon,
    shifts: periodShifts.filter((shift) => scheduledShiftIds.has(shift.id)),
    segments: scheduledSegments,
    extraEarnings: [],
  });

  const projection: ProjectionSummary = {
    workedMinutes: sumMinutes(workedSegments),
    scheduledMinutes: sumMinutes(scheduledSegments),
    projectedMinutes: sumMinutes(periodSegments),
    worked: toProjectedSplit(grossWorked, workedSegments, workedShiftIds.size),
    scheduled: toProjectedSplit(grossScheduled, scheduledSegments, scheduledShiftIds.size),
    projected: toProjectedSplit(gross, periodSegments, periodShifts.length),
  };

  // 5. Deductions + take-home.
  const deductions = computeDeductions({
    gross: gross.gross,
    payDate: period.payday,
    job,
    profile: input.profile,
    pack: rules.payrollPack,
    periodsPerYear: periodsPerYearFor(job),
  });

  // 6. Confidence.
  const confidence = computeConfidence({
    hasRate: job.hourlyRate > 0n || rates.length > 0,
    hasPaySchedule: Boolean(job.paySchedule.anchorStart),
    hasWorkWeek: job.workWeek.startsOn >= 0,
    hasTaxConfiguration: input.profile.federalClaimCode !== 'default' || input.profile.provincialClaimCode !== 'default',
    hasYtd: input.profile.ytd !== null,
    overtimeRuleResolved: rules.overtimeMode !== 'manual',
    payrollParametersCurrent: !rules.payrollFallback.used,
    vacationKnown: job.vacation.method !== 'not_sure',
    breaksKnown: job.defaultBreaks.length > 0,
  });

  // 7. Overtime radar for the current week + today.
  const radar = buildRadar(job, overtime.segments, progressByShift, workedShare, input.today, rules);

  const totalPaidMinutes = projection.projectedMinutes;
  const warnings: string[] = [];
  if (rules.overtimeMode === 'manual') {
    warnings.push('Overtime is not being applied automatically for this job because we do not have a verified rule for it.');
  }
  for (const salaryWarning of collectShiftWarnings(periodShifts, shiftTimes)) warnings.push(salaryWarning);

  return {
    period,
    jobId: job.id,
    shiftTimes,
    overtime,
    gross,
    deductions,
    confidence,
    radar,
    periodShifts,
    periodSegments,
    totalPaidMinutes,
    projection,
    warnings,
    ruleNotes: rules.notes,
    explanation: {
      workWeekStart: job.workWeek.startsOn,
      payPeriodStart: period.start,
      payPeriodEnd: period.end,
      payday: period.payday,
      jurisdiction: job.jurisdiction,
      overtimeRuleLabel: rules.overtime.label,
      overtimeMode: rules.overtimeMode,
      payrollRuleVersion: rules.payrollPack.version,
      payrollRuleYear: rules.payrollPack.taxYear,
      payrollFallbackReason: rules.payrollFallback.reason,
      rateSummary: rates
        .slice()
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
        .map((rate) => ({ date: rate.effectiveFrom, rate: rate.rate })),
      holidayDates: rules.holidayLookup.all.map((holiday) => holiday.date),
      sourceUrls: rules.payrollPack.sourceIds,
    },
  };
}

function mergeLiveMinutes(time: ShiftTimeResult, liveMinutes: Minutes, shift: Shift): ClassifiedSegment[] {
  const extra = Math.max(0, liveMinutes - time.paidMinutes);
  if (extra <= 0) return time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 }));
  const last = time.segments[time.segments.length - 1];
  if (!last) return [];
  return [
    ...time.segments.map((segment) => ({ ...segment, overtimeKind: 'none' as const, multiplier: 1 })),
    {
      ...last,
      startMs: last.endMs,
      endMs: last.endMs + extra * 60_000,
      minutes: extra,
      localStartMinute: last.localEndMinute,
      localEndMinute: last.localEndMinute + extra,
      overtimeKind: 'none' as const,
      multiplier: 1,
      shiftId: shift.id,
    },
  ];
}

function buildRadar(
  job: Job,
  segments: ClassifiedSegment[],
  progressByShift: Map<string, ShiftProgress>,
  workedShare: Map<string, number>,
  today: string,
  rules: ResolvedRules,
): RadarInfo {
  const week = workWeekFor(today, job.workWeek);
  const weekSegments = segments.filter((segment) => segment.dateKey >= week.start && segment.dateKey <= week.end);

  // Worked vs scheduled inside this work week. An in-progress shift contributes
  // its elapsed share to "worked" and the rest to "scheduled", so upcoming work
  // is never presented as already completed.
  let workedMinutes = 0;
  let scheduledRemainingMinutes = 0;
  let overtimeMinutes = 0;
  let projectedOvertimeMinutes = 0;
  for (const segment of weekSegments) {
    const shiftId = segment.shiftId ?? '';
    const progress = progressByShift.get(shiftId) ?? 'scheduled';
    if (progress === 'excluded') continue;
    const share = progress === 'in_progress' ? (workedShare.get(shiftId) ?? 0) : progress === 'worked' ? 1 : 0;
    const isOvertime = segment.overtimeKind !== 'none';
    workedMinutes += segment.minutes * share;
    scheduledRemainingMinutes += segment.minutes * (1 - share);
    if (isOvertime) {
      overtimeMinutes += segment.minutes * share;
      projectedOvertimeMinutes += segment.minutes;
    }
  }
  workedMinutes = Math.round(workedMinutes);
  scheduledRemainingMinutes = Math.round(scheduledRemainingMinutes);
  overtimeMinutes = Math.round(overtimeMinutes);
  projectedOvertimeMinutes = Math.round(projectedOvertimeMinutes);
  const projectedMinutes = workedMinutes + scheduledRemainingMinutes;

  const thresholdMinutes =
    rules.overtimeMode !== 'manual' && rules.overtime.weeklyOvertimeApplies && rules.overtime.weeklyThresholdHours !== null
      ? Math.round(rules.overtime.weeklyThresholdHours * 60)
      : null;
  // Measured against the projection: what the week is heading for, not just what
  // has already happened.
  const remainingMinutes = thresholdMinutes === null ? null : Math.max(0, thresholdMinutes - projectedMinutes);

  const todaySegments = segments.filter((segment) => segment.dateKey === today);
  const dailyThresholdMinutes =
    rules.overtimeMode !== 'manual' && rules.overtime.dailyOvertimeApplies && rules.overtime.dailyThresholdHours !== null
      ? Math.round(rules.overtime.dailyThresholdHours * 60)
      : null;

  return {
    workWeek: week,
    workedMinutes,
    scheduledRemainingMinutes,
    projectedMinutes,
    overtimeMinutes,
    projectedOvertimeMinutes,
    thresholdMinutes,
    remainingMinutes,
    todayMinutes: todaySegments.reduce((sum, segment) => sum + segment.minutes, 0),
    dailyThresholdMinutes,
    dailyOvertimeMinutes: todaySegments
      .filter((segment) => segment.overtimeKind !== 'none')
      .reduce((sum, segment) => sum + segment.minutes, 0),
    premiumMinutes: 0,
  };
}

function sumMinutes(segments: ClassifiedSegment[]): Minutes {
  return segments.reduce((sum, segment) => sum + segment.minutes, 0);
}

function toProjectedSplit(gross: GrossPayResult, segments: ClassifiedSegment[], shiftCount: number): ProjectedSplit {
  return {
    minutes: sumMinutes(segments),
    overtimeMinutes: segments
      .filter((segment) => segment.overtimeKind === 'overtime')
      .reduce((sum, segment) => sum + segment.minutes, 0),
    doubleTimeMinutes: segments
      .filter((segment) => segment.overtimeKind === 'double_time')
      .reduce((sum, segment) => sum + segment.minutes, 0),
    gross: gross.gross,
    shiftCount,
    lines: gross.lines,
  };
}

/**
 * Splits a shift's slices into the part already earned and the part still to come,
 * by taking the first `share` of the shift. The boundary slice keeps its overtime
 * classification in both halves rather than being reassigned.
 */
export function splitSegmentsByWorkedShare(
  segments: ClassifiedSegment[],
  share: number,
): { worked: ClassifiedSegment[]; remaining: ClassifiedSegment[] } {
  const clamped = Math.max(0, Math.min(1, share));
  const total = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  if (clamped <= 0) return { worked: [], remaining: segments };
  if (clamped >= 1) return { worked: segments, remaining: [] };
  const target = total * clamped;

  const worked: ClassifiedSegment[] = [];
  const remaining: ClassifiedSegment[] = [];
  let consumed = 0;
  for (const segment of segments) {
    if (consumed >= target) {
      remaining.push(segment);
      continue;
    }
    const available = segment.minutes;
    const take = Math.min(available, target - consumed);
    if (take >= available) {
      worked.push(segment);
      consumed += available;
      continue;
    }
    const ratio = available > 0 ? take / available : 0;
    const splitMs = Math.round(segment.startMs + (segment.endMs - segment.startMs) * ratio);
    const workedMinutes = Math.round(take);
    const restMinutes = available - workedMinutes;
    worked.push({
      ...segment,
      endMs: splitMs,
      minutes: workedMinutes,
      localEndMinute: segment.localStartMinute + workedMinutes,
    });
    remaining.push({
      ...segment,
      startMs: splitMs,
      minutes: restMinutes,
      localStartMinute: segment.localStartMinute + workedMinutes,
      localEndMinute: segment.localEndMinute,
    });
    consumed += take;
  }
  return { worked, remaining };
}

function collectShiftWarnings(shifts: Shift[], times: Map<string, ShiftTimeResult>): string[] {
  const warnings: string[] = [];
  for (const shift of shifts) {
    const time = times.get(shift.id);
    if (!time) continue;
    if (time.warnings.includes('dst_spring_forward')) {
      warnings.push('A shift crosses the spring daylight-saving change, so the clock moves forward by an hour.');
    }
    if (time.warnings.includes('unpaid_break_exceeds_shift')) {
      warnings.push('An unpaid break is longer than the shift itself — check the break entry.');
    }
  }
  return [...new Set(warnings)];
}

function serviceYears(startDate: string, asOf: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = asOf.split('-').map(Number);
  let years = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) years -= 1;
  return Math.max(0, years);
}

export function periodsPerYearFor(job: Job): number {
  switch (job.paySchedule.frequency) {
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'semimonthly':
      return 24;
    case 'monthly':
      return 12;
    default:
      return Math.max(1, Math.round(365 / (job.paySchedule.customPeriodDays ?? 14)));
  }
}

/** Window of shifts that must be loaded to calculate a period correctly. */
export function shiftWindowFor(period: PayPeriod, job: Job): { from: string; to: string } {
  const from = addDays(workWeekFor(period.start, job.workWeek).start, -7);
  const to = addDays(workWeekFor(period.end, job.workWeek).end, 7);
  return { from, to };
}

export { liveElapsedMinutes, minutesUntilOvertime };
