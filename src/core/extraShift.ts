/**
 * extraShiftEngine (spec 25) — "What is another shift worth?"
 *
 * Adds a hypothetical shift to the real schedule and reports the INCREMENTAL
 * effect: extra hours, extra overtime, extra premiums, extra gross, estimated
 * extra take-home and the new next-pay estimate.
 *
 * The incremental take-home is computed by re-running the real deduction engine
 * on both scenarios, so CPP/EI annual maximums and marginal tax behave
 * correctly instead of being faked with an average rate.
 */
import { calculatePayPeriod, type PayPeriodCalculation, type PayPeriodCalculationInput } from './calculate.ts';
import type { Minutes } from './duration.ts';
import type { Micro } from './money.ts';
import { payPeriodFor, periodLabel, type PayPeriod } from './workweek.ts';
import { computeShiftTime } from './shiftTime.ts';
import type { Shift } from './types.ts';

export type ExtraShiftInput = Omit<PayPeriodCalculationInput, 'period'> & {
  /** Date of the hypothetical shift. */
  dateKey: string;
  startClock: string;
  endClock: string;
  /** Optional explicit period (defaults to the period containing `dateKey`). */
  period?: PayPeriod;
};

export type ExtraShiftResult = {
  shiftId: string;
  dateKey: string;
  period: PayPeriod;
  periodLabel: string;
  workedMinutes: Minutes;
  regularMinutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  premiumMinutes: Minutes;
  extraGross: Micro;
  extraTakeHome: Micro;
  previousTakeHome: Micro;
  newTakeHome: Micro;
  /** Work-week context for the explanation sheet. */
  workWeekBeforeMinutes: Minutes;
  workWeekAfterMinutes: Minutes;
  overtimeThresholdMinutes: Minutes | null;
  /** True when part of the shift lands in overtime. */
  includesOvertime: boolean;
  notes: string[];
};

export function calculateExtraShift(input: ExtraShiftInput): ExtraShiftResult {
  const { job } = input;
  const period = input.period ?? payPeriodFor(input.dateKey, job.paySchedule);
  const endOvernight = input.endClock <= input.startClock;

  const syntheticShift: Shift = {
    id: '__extra_shift__',
    jobId: job.id,
    date: input.dateKey,
    scheduledStart: input.startClock,
    scheduledEnd: input.endClock,
    scheduledOvernight: endOvernight,
    breaks: job.defaultBreaks,
    type: 'work',
    status: 'scheduled',
    confirmed: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };

  const baseInput: PayPeriodCalculationInput = { ...input, period, shifts: input.shifts };
  const withInput: PayPeriodCalculationInput = {
    ...input,
    period,
    shifts: [...input.shifts.filter((shift) => shift.id !== syntheticShift.id), syntheticShift],
  };

  const before = calculatePayPeriod(baseInput);
  const after = calculatePayPeriod(withInput);

  const time = computeShiftTime(syntheticShift, { zone: job.zone, dstPolicy: job.dstPolicy, rounding: job.rounding });
  const shiftSummary = after.gross.byShift.get(syntheticShift.id);

  const regularMinutes = shiftSummary
    ? after.overtime.segments
        .filter((segment) => segment.shiftId === syntheticShift.id && segment.overtimeKind === 'none')
        .reduce((sum, segment) => sum + segment.minutes, 0)
    : 0;
  const overtimeMinutes = shiftSummary?.overtimeMinutes ?? 0;
  const doubleTimeMinutes = shiftSummary?.doubleTimeMinutes ?? 0;
  const premiumMinutes = shiftSummary?.premiumMinutes ?? 0;

  const extraGross = after.gross.gross - before.gross.gross;
  const extraTakeHome = after.deductions.net - before.deductions.net;

  const weekBefore = weekWorkedMinutes(before);
  const weekAfter = weekWorkedMinutes(after);
  const thresholdMinutes =
    after.ruleNotes !== undefined && after.radar.thresholdMinutes !== null ? after.radar.thresholdMinutes : after.radar.thresholdMinutes;

  const notes: string[] = [
    'The extra take-home shown here is the difference between two full estimates, including CPP, EI and income tax effects.',
    'Incremental tax and deduction effects are estimates.',
  ];
  if (after.radar.thresholdMinutes === null) {
    notes.push('No verified overtime threshold is active for this job, so all hours are estimated at the regular rate.');
  }
  if (doubleTimeMinutes > 0) {
    notes.push('Part of this shift falls into the highest overtime tier for this workplace rule.');
  }

  return {
    shiftId: syntheticShift.id,
    dateKey: input.dateKey,
    period,
    periodLabel: periodLabel(period.start, period.end),
    workedMinutes: time.paidMinutes,
    regularMinutes,
    overtimeMinutes,
    doubleTimeMinutes,
    premiumMinutes,
    extraGross,
    extraTakeHome,
    previousTakeHome: before.deductions.net,
    newTakeHome: after.deductions.net,
    workWeekBeforeMinutes: weekBefore,
    workWeekAfterMinutes: weekAfter,
    overtimeThresholdMinutes: thresholdMinutes,
    includesOvertime: overtimeMinutes + doubleTimeMinutes > 0,
    notes,
  };
}

function weekWorkedMinutes(calculation: PayPeriodCalculation): Minutes {
  return calculation.radar.workedMinutes;
}
