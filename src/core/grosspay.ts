/**
 * grossPayEngine — assembles the earnings side of a pay period.
 *
 * Produces itemised, explainable lines (spec 19/20):
 *   regular · overtime · double time · premiums · vacation · holiday · extras
 *
 * Rate history is applied per segment date, so historical shifts keep their
 * historical rate (spec 27).
 */
import { payForMinutes, type Minutes } from './duration.ts';
import { mulRatio, roundToCents, type Micro } from './money.ts';
import { computePremiums, type PremiumEarning } from './premium.ts';
import { rateForDate } from './rate.ts';
import { computeVacationPay, type VacationResult } from './vacation.ts';
import type { ClassifiedSegment, EarningsLine, Job, RateRecord, Shift } from './types.ts';
import type { HolidayLookup } from './holiday.ts';
import type { VacationRulePack } from '../rules/types.ts';

export type ExtraEarning = {
  id: string;
  label: string;
  amount: Micro;
  kind: 'bonus' | 'commission' | 'tips' | 'retro' | 'manual';
};

export type GrossPayInput = {
  job: Job;
  rates: RateRecord[];
  shifts: Shift[];
  /** OT-classified segments for the whole period (may include context weeks). */
  segments: ClassifiedSegment[];
  holidayLookup: HolidayLookup;
  servicesYears: number;
  vacationRule: VacationRulePack | null;
  extraEarnings: ExtraEarning[];
  /** Manual holiday pay the user entered, when applicable. */
  manualHolidayPay?: Micro;
};

export type ShiftEarnings = {
  shiftId: string;
  regular: Micro;
  overtime: Micro;
  doubleTime: Micro;
  premiums: Micro;
  total: Micro;
  workedMinutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  premiumMinutes: Minutes;
  premiumDetail: PremiumEarning[];
};

export type GrossPayResult = {
  lines: EarningsLine[];
  premiumEarnings: PremiumEarning[];
  regularMinutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  premiumMinutes: Minutes;
  /** Highest hourly rate seen in the period (for the "rate used" explanation). */
  regularPay: Micro;
  overtimePay: Micro;
  doubleTimePay: Micro;
  premiumPay: Micro;
  extraPay: Micro;
  holidayPay: Micro;
  vacation: VacationResult;
  vacationPay: Micro;
  gross: Micro;
  byShift: Map<string, ShiftEarnings>;
};

export function computeGrossPay(input: GrossPayInput): GrossPayResult {
  const { job, rates, holidayLookup, segments, extraEarnings } = input;

  const rateFor = (dateKey: string, shift?: Shift): Micro => {
    if (shift?.rateOverride !== undefined) return shift.rateOverride;
    return rateForDate(rates, dateKey, job.hourlyRate);
  };

  const shiftById = new Map(input.shifts.map((shift) => [shift.id, shift]));

  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let doubleTimeMinutes = 0;
  let regularPay = 0n;
  let overtimePay = 0n;
  let doubleTimePay = 0n;

  const byShift = new Map<string, ShiftEarnings>();
  const ensureShift = (shiftId: string): ShiftEarnings => {
    const existing = byShift.get(shiftId);
    if (existing) return existing;
    const created: ShiftEarnings = {
      shiftId,
      regular: 0n,
      overtime: 0n,
      doubleTime: 0n,
      premiums: 0n,
      total: 0n,
      workedMinutes: 0,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      premiumMinutes: 0,
      premiumDetail: [],
    };
    byShift.set(shiftId, created);
    return created;
  };

  // Money is rounded ONCE per shift per category: rounding every underlying
  // segment independently would double-round (225 min + 225 min at $24.50 is
  // $183.75, not 2 x $91.88).
  type RawShift = { regular: Micro; overtime: Micro; doubleTime: Micro };
  const rawByShift = new Map<string, RawShift>();
  const rawFor = (shiftId: string): RawShift => {
    const existing = rawByShift.get(shiftId);
    if (existing) return existing;
    const created: RawShift = { regular: 0n, overtime: 0n, doubleTime: 0n };
    rawByShift.set(shiftId, created);
    return created;
  };

  for (const segment of segments) {
    const shift = shiftById.get(segment.shiftId ?? '');
    const rate = rateFor(segment.dateKey, shift);
    const raw = rawFor(segment.shiftId ?? 'unknown');
    if (segment.overtimeKind === 'double_time') {
      raw.doubleTime += payForMinutes(rate * 2n, segment.minutes);
    } else if (segment.overtimeKind === 'overtime') {
      raw.overtime += payForMinutes(mulRate(rate, segment.multiplier), segment.minutes);
    } else {
      raw.regular += payForMinutes(rate, segment.minutes);
    }
  }

  for (const [shiftId, raw] of rawByShift) {
    const bucket = ensureShift(shiftId);
    const regular = roundToCents(raw.regular);
    const overtime = roundToCents(raw.overtime);
    const doubleTime = roundToCents(raw.doubleTime);
    bucket.regular += regular;
    bucket.overtime += overtime;
    bucket.doubleTime += doubleTime;
    regularPay += regular;
    overtimePay += overtime;
    doubleTimePay += doubleTime;
    bucket.total += regular + overtime + doubleTime;
  }
  for (const segment of segments) {
    const bucket = ensureShift(segment.shiftId ?? 'unknown');
    if (segment.overtimeKind === 'double_time') {
      doubleTimeMinutes += segment.minutes;
      bucket.doubleTimeMinutes += segment.minutes;
    } else if (segment.overtimeKind === 'overtime') {
      overtimeMinutes += segment.minutes;
      bucket.overtimeMinutes += segment.minutes;
    } else {
      regularMinutes += segment.minutes;
    }
    bucket.workedMinutes += segment.minutes;
  }

  // --- Premiums (per shift, so per-shift rules behave correctly) -----------
  const premiumEarnings: PremiumEarning[] = [];
  let premiumPay = 0n;
  let premiumMinutes = 0;
  const shiftIds = [...new Set(segments.map((segment) => segment.shiftId ?? 'unknown'))];
  for (const shiftId of shiftIds) {
    const shiftSegments = segments.filter((segment) => (segment.shiftId ?? 'unknown') === shiftId);
    if (shiftSegments.length === 0) continue;
    const shift = shiftById.get(shiftId);
    const effectiveDate = shiftSegments[0].dateKey;
    const result = computePremiums(
      {
        shiftId,
        segments: shiftSegments,
        rateForSegment: (segment) => rateFor(segment.dateKey, shift),
        holidayDates: new Set(holidayLookup.all.map((holiday) => holiday.date)),
        effectiveDate,
      },
      job.premiums,
    );
    if (result.earnings.length > 0) {
      premiumEarnings.push(...result.earnings);
      premiumPay += result.total;
      premiumMinutes += result.totalMinutes;
      const bucket = ensureShift(shiftId);
      bucket.premiums += result.total;
      bucket.premiumMinutes += result.totalMinutes;
      bucket.premiumDetail = result.earnings;
      bucket.total += result.total;
    }
  }

  // --- Shift-attached bonuses ---------------------------------------------
  for (const shift of input.shifts) {
    if (!shift.bonus || shift.bonus === 0n) continue;
    ensureShift(shift.id).total += shift.bonus;
  }
  const shiftBonuses = input.shifts.reduce<Micro>((sum, shift) => sum + (shift.bonus ?? 0n), 0n);

  // --- Extras --------------------------------------------------------------
  const extraPay = extraEarnings.reduce<Micro>((sum, extra) => sum + extra.amount, 0n);

  // --- Vacation -----------------------------------------------------------
  const subtotalBeforeVacation =
    regularPay + overtimePay + doubleTimePay + premiumPay + extraPay + shiftBonuses;
  const vacation = computeVacationPay({
    config: job.vacation,
    gross: subtotalBeforeVacation,
    rule: input.vacationRule,
    serviceYears: input.servicesYears,
  });
  const vacationPay = roundToCents(vacation.paidThisPeriod);

  const holidayPay = roundToCents(input.manualHolidayPay ?? 0n);
  const gross = roundToCents(subtotalBeforeVacation + vacationPay + holidayPay);

  // --- Lines --------------------------------------------------------------
  const lines: EarningsLine[] = [];
  if (regularMinutes > 0) {
    const averageRate = regularMinutes > 0 ? mulRatio(regularPay, 60, regularMinutes) : job.hourlyRate;
    lines.push({
      kind: 'regular',
      label: 'Regular pay',
      minutes: regularMinutes,
      rate: averageRate,
      amount: regularPay,
      detail: `${formatHours(regularMinutes)} h at your rate${rateChangesInPeriod(rates) > 1 ? ' (rate changes applied by date)' : ''}`,
    });
  }
  if (overtimeMinutes > 0) {
    const averageRate = mulRatio(overtimePay, 60, overtimeMinutes);
    lines.push({
      kind: 'overtime',
      label: 'Overtime',
      minutes: overtimeMinutes,
      rate: averageRate,
      amount: overtimePay,
      detail: 'Hours above the overtime threshold for the work week, at the overtime rate',
    });
  }
  if (doubleTimeMinutes > 0) {
    const averageRate = mulRatio(doubleTimePay, 60, doubleTimeMinutes);
    lines.push({
      kind: 'double_time',
      label: 'Double time',
      minutes: doubleTimeMinutes,
      rate: averageRate,
      amount: doubleTimePay,
      detail: 'Hours in the highest overtime tier',
    });
  }
  for (const premium of premiumEarnings) {
    lines.push({
      kind: 'premium',
      label: premium.label,
      minutes: premium.minutes || undefined,
      amount: premium.amount,
      detail: premium.detail,
      ruleIds: [premium.ruleId],
    });
  }
  if (shiftBonuses > 0n) {
    lines.push({ kind: 'bonus', label: 'Shift bonuses', amount: shiftBonuses, detail: 'Added to individual shifts' });
  }
  for (const extra of extraEarnings) {
    lines.push({
      kind: extra.kind === 'bonus' ? 'bonus' : extra.kind === 'manual' ? 'manual' : 'other',
      label: extra.label,
      amount: extra.amount,
      detail: 'Entered by you for this period',
      ruleIds: [extra.id],
    });
  }
  if (vacationPay > 0n) {
    lines.push({
      kind: 'vacation',
      label: 'Vacation pay',
      amount: vacationPay,
      detail: vacation.explanation,
    });
  }
  if (holidayPay > 0n) {
    lines.push({ kind: 'holiday', label: 'Holiday pay', amount: holidayPay, detail: 'Entered by you for this period' });
  }

  return {
    lines,
    premiumEarnings,
    regularMinutes,
    overtimeMinutes,
    doubleTimeMinutes,
    premiumMinutes,
    regularPay,
    overtimePay,
    doubleTimePay,
    premiumPay,
    extraPay: extraPay + shiftBonuses,
    holidayPay,
    vacation,
    vacationPay,
    gross,
    byShift,
  };
}

function rateChangesInPeriod(rates: RateRecord[]): number {
  return rates.length;
}

/** rate x OT multiplier, rounded to cents when the money is created. */
function mulRate(rate: Micro, multiplier: number): Micro {
  return (rate * BigInt(Math.round(multiplier * 1000))) / 1000n;
}

function formatHours(minutes: Minutes): string {
  const hours = minutes / 60;
  return hours % 1 === 0 ? String(hours) : hours.toFixed(2);
}
