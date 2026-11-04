/**
 * Repositories: the only place SQL meets domain objects.
 *
 * Every monetary value is stored as an exact decimal string of micro-dollars,
 * and every date is a local `YYYY-MM-DD` key, so nothing depends on the device
 * timezone at read time.
 */
import { microFromDollars, toDecimalString, type Micro } from '../core/money.ts';
import { type RoundingMode, type RoundingStep } from '../core/duration.ts';
import type {
  BreakRule,
  DeductionProfile,
  HolidayPolicy,
  Job,
  OvertimeRuleConfig,
  PaySchedule,
  PremiumRule,
  RateRecord,
  Shift,
  ShiftStatus,
  ShiftType,
  VacationConfig,
  WorkWeekConfig,
} from '../core/types.ts';

/** Minimal row shapes (SQLite returns primitives). */
export type JobRow = {
  id: string;
  name: string;
  colour: string;
  icon: string;
  jurisdiction: string;
  tax_province: string;
  zone: string;
  hourly_rate: string;
  archived: number;
  work_week_starts_on: number;
  averaging_weeks: number;
  averaging_anchor: string | null;
  pay_frequency: string;
  pay_anchor_start: string;
  pay_custom_period_days: number | null;
  payday_offset_days: number;
  overtime_source: string;
  overtime_daily_applies: number;
  overtime_weekly_applies: number;
  overtime_has_agreement: string;
  overtime_note: string | null;
  vacation_method: string;
  vacation_custom_percent: number | null;
  vacation_banked_balance: string | null;
  holiday_mode: string;
  holiday_custom_multiplier: number | null;
  holiday_pays_holiday_pay: number;
  rounding_step: number;
  rounding_mode: string;
  dst_policy: string;
  service_start_date: string;
  created_at: string;
  updated_at: string;
};

export type ShiftRow = {
  id: string;
  job_id: string;
  date: string;
  scheduled_start: string;
  scheduled_end: string;
  scheduled_overnight: number;
  actual_start: string | null;
  actual_end: string | null;
  actual_overnight: number | null;
  type: string;
  status: string;
  confirmed: number;
  paid_minutes_override: number | null;
  rate_override: string | null;
  bonus: string | null;
  bonus_note: string | null;
  notes: string | null;
  rounding_step: number | null;
  rounding_mode: string | null;
  live_started_at_ms: number | null;
  live_break_started_at_ms: number | null;
  live_accumulated_minutes: number | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BreakRow = {
  id: string;
  shift_id: string;
  label: string;
  minutes: number;
  paid: number;
  sort_order: number;
};

export type PremiumRuleRow = {
  id: string;
  job_id: string;
  label: string;
  type: string;
  amount: string;
  window_start_minute: number | null;
  window_end_minute: number | null;
  days: string | null;
  holiday_only: number;
  weekend_only: number;
  effective_from: string | null;
  effective_to: string | null;
  stackable: number;
  priority: number;
  included_in_ot_base: number;
  applies_during_overtime: number;
  enabled: number;
};

export type ProfileRow = {
  id: string;
  job_id: string;
  cpp_exempt: number;
  ei_exempt: number;
  federal_claim_code: string;
  federal_claim_amount: string | null;
  provincial_claim_code: string;
  provincial_claim_amount: string | null;
  additional_tax_per_period: string | null;
  additional_tax_percent: number | null;
  fixed_deductions_json: string;
  percent_deductions_json: string;
  ytd_json: string | null;
  updated_at: string;
};

export function money(value: Micro): string {
  return toDecimalString(value);
}

export function parseMoney(value: string | null | undefined, fallback: Micro = 0n): Micro {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return microFromDollars(value);
  } catch {
    return fallback;
  }
}

export function jobFromRow(row: JobRow, premiums: PremiumRule[], overtimeTiers: OvertimeRuleConfig['tiers']): Job {
  const workWeek: WorkWeekConfig = {
    startsOn: row.work_week_starts_on,
    averagingWeeks: row.averaging_weeks,
    averagingAnchor: row.averaging_anchor ?? undefined,
  };
  const paySchedule: PaySchedule = {
    frequency: row.pay_frequency as PaySchedule['frequency'],
    anchorStart: row.pay_anchor_start,
    customPeriodDays: row.pay_custom_period_days ?? undefined,
    paydayOffsetDays: row.payday_offset_days,
  };
  const overtime: OvertimeRuleConfig = {
    source: row.overtime_source as OvertimeRuleConfig['source'],
    tiers: overtimeTiers,
    dailyOvertimeApplies: row.overtime_daily_applies === 1,
    weeklyOvertimeApplies: row.overtime_weekly_applies === 1,
    hasAgreement: row.overtime_has_agreement as OvertimeRuleConfig['hasAgreement'],
    note: row.overtime_note ?? undefined,
  };
  const vacation: VacationConfig = {
    method: row.vacation_method as VacationConfig['method'],
    customPercent: row.vacation_custom_percent ?? undefined,
    bankedBalance: row.vacation_banked_balance ? parseMoney(row.vacation_banked_balance) : undefined,
  };
  const holidayPolicy: HolidayPolicy = {
    mode: row.holiday_mode as HolidayPolicy['mode'],
    customMultiplier: row.holiday_custom_multiplier ?? undefined,
    paysHolidayPay: row.holiday_pays_holiday_pay === 1,
  };
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    icon: row.icon,
    jurisdiction: row.jurisdiction as Job['jurisdiction'],
    taxProvince: row.tax_province as Job['taxProvince'],
    zone: row.zone as Job['zone'],
    hourlyRate: parseMoney(row.hourly_rate),
    archived: row.archived === 1,
    workWeek,
    paySchedule,
    overtime,
    premiums,
    vacation,
    holidayPolicy,
    rounding: { step: row.rounding_step as RoundingStep, mode: row.rounding_mode as RoundingMode },
    dstPolicy: row.dst_policy as Job['dstPolicy'],
    defaultBreaks: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function premiumFromRow(row: PremiumRuleRow): PremiumRule {
  const type = row.type as PremiumRule['type'];
  const amount: Micro | number = type === 'percentage' || type === 'multiplier' ? Number(row.amount) : parseMoney(row.amount);
  return {
    id: row.id,
    label: row.label,
    type,
    amount,
    window:
      row.window_start_minute !== null && row.window_end_minute !== null
        ? { startMinute: row.window_start_minute, endMinute: row.window_end_minute }
        : null,
    days: row.days ? (JSON.parse(row.days) as number[]) : undefined,
    holidayOnly: row.holiday_only === 1,
    weekendOnly: row.weekend_only === 1,
    effectiveFrom: row.effective_from ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    stackable: row.stackable === 1,
    priority: row.priority,
    includedInOtBase: row.included_in_ot_base === 1,
    appliesDuringOvertime: row.applies_during_overtime === 1,
    enabled: row.enabled === 1,
  };
}

export function shiftFromRow(row: ShiftRow, breaks: BreakRule[]): Shift {
  return {
    id: row.id,
    jobId: row.job_id,
    date: row.date,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    scheduledOvernight: row.scheduled_overnight === 1,
    actualStart: row.actual_start ?? undefined,
    actualEnd: row.actual_end ?? undefined,
    actualOvernight: row.actual_overnight === null ? undefined : row.actual_overnight === 1,
    breaks,
    type: row.type as ShiftType,
    status: row.status as ShiftStatus,
    confirmed: row.confirmed === 1,
    paidMinutesOverride: row.paid_minutes_override ?? undefined,
    rateOverride: row.rate_override ? parseMoney(row.rate_override) : undefined,
    bonus: row.bonus ? parseMoney(row.bonus) : undefined,
    bonusNote: row.bonus_note ?? undefined,
    notes: row.notes ?? undefined,
    rounding:
      row.rounding_step === null || row.rounding_mode === null
        ? null
        : { step: row.rounding_step as RoundingStep, mode: row.rounding_mode as RoundingMode },
    liveStartedAtMs: row.live_started_at_ms ?? undefined,
    liveBreakStartedAtMs: row.live_break_started_at_ms ?? undefined,
    liveAccumulatedMinutes: row.live_accumulated_minutes ?? undefined,
    templateId: row.template_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function profileFromRow(row: ProfileRow): DeductionProfile {
  return {
    id: row.id,
    jobId: row.job_id,
    cppExempt: row.cpp_exempt === 1,
    eiExempt: row.ei_exempt === 1,
    federalClaimCode: row.federal_claim_code as DeductionProfile['federalClaimCode'],
    federalClaimAmount: row.federal_claim_amount ? parseMoney(row.federal_claim_amount) : undefined,
    provincialClaimCode: row.provincial_claim_code as DeductionProfile['provincialClaimCode'],
    provincialClaimAmount: row.provincial_claim_amount ? parseMoney(row.provincial_claim_amount) : undefined,
    additionalTaxPerPeriod: row.additional_tax_per_period ? parseMoney(row.additional_tax_per_period) : undefined,
    additionalTaxPercent: row.additional_tax_percent ?? undefined,
    fixedDeductions: JSON.parse(row.fixed_deductions_json || '[]') as DeductionProfile['fixedDeductions'],
    percentDeductions: JSON.parse(row.percent_deductions_json || '[]') as DeductionProfile['percentDeductions'],
    ytd: row.ytd_json ? (JSON.parse(row.ytd_json) as DeductionProfile['ytd']) : null,
  };
}

// ---------------------------------------------------------------------------
// Serialisers (domain -> row). BigInt values become exact decimal strings.
// ---------------------------------------------------------------------------

type WireDeduction = { id: string; label: string; amount: string; perPeriod: boolean };
type WirePercent = { id: string; label: string; percent: number };
type WireYtd = {
  cpp: string;
  cpp2: string;
  ei: string;
  qpp: string;
  qpp2: string;
  qpip: string;
  periodsPaid: number;
};

export function serializeFixedDeductions(deductions: DeductionProfile['fixedDeductions']): string {
  return JSON.stringify(
    deductions.map<WireDeduction>((deduction) => ({
      id: deduction.id,
      label: deduction.label,
      amount: money(deduction.amount),
      perPeriod: deduction.perPeriod,
    })),
  );
}

export function deserializeFixedDeductions(json: string | null): DeductionProfile['fixedDeductions'] {
  if (!json) return [];
  const parsed = JSON.parse(json) as WireDeduction[];
  return parsed.map((entry) => ({ ...entry, amount: parseMoney(entry.amount) }));
}

export function serializePercentDeductions(deductions: DeductionProfile['percentDeductions']): string {
  return JSON.stringify(deductions);
}

export function serializeYtd(ytd: DeductionProfile['ytd']): string | null {
  if (!ytd) return null;
  const wire: WireYtd = {
    cpp: money(ytd.cpp),
    cpp2: money(ytd.cpp2),
    ei: money(ytd.ei),
    qpp: money(ytd.qpp),
    qpp2: money(ytd.qpp2 ?? 0n),
    qpip: money(ytd.qpip),
    periodsPaid: ytd.periodsPaid,
  };
  return JSON.stringify(wire);
}

export function deserializeYtd(json: string | null): DeductionProfile['ytd'] {
  if (!json) return null;
  const wire = JSON.parse(json) as WireYtd;
  return {
    cpp: parseMoney(wire.cpp),
    cpp2: parseMoney(wire.cpp2),
    ei: parseMoney(wire.ei),
    qpp: parseMoney(wire.qpp),
    qpp2: parseMoney(wire.qpp2),
    qpip: parseMoney(wire.qpip),
    periodsPaid: wire.periodsPaid,
  };
}

export function jobRatesToRows(jobId: string, rates: RateRecord[]) {
  return rates.map((rate) => ({
    id: rate.id,
    job_id: jobId,
    rate: money(rate.rate),
    effective_from: rate.effectiveFrom,
    note: rate.note ?? null,
  }));
}

export function rateFromRow(row: { id: string; job_id: string; rate: string; effective_from: string; note: string | null }): RateRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    rate: parseMoney(row.rate),
    effectiveFrom: row.effective_from,
    note: row.note ?? undefined,
  };
}

export function breakRowsFor(shiftId: string, breaks: BreakRule[]) {
  return breaks.map((entry, index) => ({
    id: `${shiftId}-break-${index}`,
    shift_id: shiftId,
    label: entry.label,
    minutes: Math.max(0, Math.round(entry.minutes)),
    paid: entry.paid ? 1 : 0,
    sort_order: index,
  }));
}

export function breaksFromRows(rows: BreakRow[]): BreakRule[] {
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => ({ label: row.label, minutes: row.minutes, paid: row.paid === 1 }));
}

export function premiumToRow(jobId: string, rule: PremiumRule) {
  return {
    id: rule.id,
    job_id: jobId,
    label: rule.label,
    type: rule.type,
    amount: rule.type === 'percentage' || rule.type === 'multiplier' ? String(rule.amount) : money(rule.amount as Micro),
    window_start_minute: rule.window ? rule.window.startMinute : null,
    window_end_minute: rule.window ? rule.window.endMinute : null,
    days: rule.days && rule.days.length > 0 ? JSON.stringify(rule.days) : null,
    holiday_only: rule.holidayOnly ? 1 : 0,
    weekend_only: rule.weekendOnly ? 1 : 0,
    effective_from: rule.effectiveFrom ?? null,
    effective_to: rule.effectiveTo ?? null,
    stackable: rule.stackable ? 1 : 0,
    priority: rule.priority,
    included_in_ot_base: rule.includedInOtBase ? 1 : 0,
    applies_during_overtime: rule.appliesDuringOvertime ? 1 : 0,
    enabled: rule.enabled ? 1 : 0,
  };
}

