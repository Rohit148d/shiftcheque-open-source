/**
 * Domain model shared by the engines, the database and the UI.
 *
 * The engines are pure: they take these plain data structures and return
 * deterministic results. No React, no SQLite, no network.
 */
import type { Micro } from './money.ts';
import type { Minutes } from './duration.ts';
import type { RoundingMode, RoundingStep } from './duration.ts';
import type { ZoneId } from './tz.ts';

export type JurisdictionCode = 'FED' | 'AB' | 'BC' | 'MB' | 'NB' | 'NL' | 'NS' | 'NT' | 'NU' | 'ON' | 'PE' | 'QC' | 'SK' | 'YT';

export const JURISDICTIONS: JurisdictionCode[] = ['FED', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

export type ShiftType = 'work' | 'vacation' | 'sick' | 'training' | 'on_call' | 'off' | 'custom';
export type ShiftStatus = 'scheduled' | 'in_progress' | 'completed' | 'missed';

/** Which shifts count toward worked hours / overtime. */
export const EARNING_SHIFT_TYPES: ShiftType[] = ['work', 'training', 'on_call'];

export type BreakRule = {
  label: string;
  minutes: number;
  paid: boolean;
};

export type Shift = {
  id: string;
  jobId: string;
  /** Local date of the shift start, "YYYY-MM-DD". */
  date: string;
  /** Local wall-clock "HH:MM". */
  scheduledStart: string;
  scheduledEnd: string;
  /** True when scheduledEnd is on the next local day. Derived, but stored for clarity. */
  scheduledOvernight: boolean;
  actualStart?: string;
  actualEnd?: string;
  actualOvernight?: boolean;
  /** Breaks belonging to the shift, in order. */
  breaks: BreakRule[];
  type: ShiftType;
  status: ShiftStatus;
  /** User confirmed the shift actually happened (spec 16). */
  confirmed: boolean;
  /** Explicit override: paid hours, in minutes. Highest precedence (spec 14). */
  paidMinutesOverride?: Minutes;
  /** Rate override for this shift only (Micro per hour). */
  rateOverride?: Micro;
  /** Extra earning attached to the shift (bonus, tip, manual adjustment). */
  bonus?: Micro;
  bonusNote?: string;
  notes?: string;
  /** Per-shift rounding override; null -> use job setting. */
  rounding?: { step: RoundingStep; mode: RoundingMode } | null;
  /** Live shift state (spec 15): epoch ms when started / break began. */
  liveStartedAtMs?: number;
  liveBreakStartedAtMs?: number;
  /** Accumulated live work minutes before the current break. */
  liveAccumulatedMinutes?: Minutes;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RateRecord = {
  id: string;
  jobId: string;
  /** Micro per hour. */
  rate: Micro;
  effectiveFrom: string; // YYYY-MM-DD
  note?: string;
};

export type Job = {
  id: string;
  name: string;
  colour: string;
  icon: string;
  /** Provincial/territorial or federal jurisdiction governing this job. */
  jurisdiction: JurisdictionCode;
  /** Province of residence used for income tax + QPP/QPIP. Never 'FED'. */
  taxProvince: Exclude<JurisdictionCode, 'FED'>;
  zone: ZoneId;
  hourlyRate: Micro;
  /** Employer-provided overtime configuration ("My workplace uses another rule"). */
  overtime: OvertimeRuleConfig;
  premiums: PremiumRule[];
  vacation: VacationConfig;
  workWeek: WorkWeekConfig;
  paySchedule: PaySchedule;
  /** Statutory holiday handling. */
  holidayPolicy: HolidayPolicy;
  rounding: { step: RoundingStep; mode: RoundingMode };
  /** How daylight-saving clock changes affect paid hours. */
  dstPolicy: 'wall_clock' | 'elapsed';
  /** Paid breaks by default for new shifts. */
  defaultBreaks: BreakRule[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkWeekConfig = {
  /** 0 = Sunday ... 6 = Saturday. */
  startsOn: number;
  /** Averaging agreement: overtime threshold spread over N weeks (1 = none). */
  averagingWeeks: number;
  /** First day of the averaging cycle (usually the agreement's start date). */
  averagingAnchor?: string;
};

export type PayScheduleFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'custom';

export type PaySchedule = {
  frequency: PayScheduleFrequency;
  /** First day of a known pay period (anchor), "YYYY-MM-DD". */
  anchorStart: string;
  /** Number of days in the pay period (derived for custom). */
  customPeriodDays?: number;
  /** Days from period end to payday (0 = same day). */
  paydayOffsetDays: number;
};

export type OvertimeRuleSource = 'jurisdiction' | 'custom';

export type OvertimeTier = {
  /** Hours in the work week after which this tier's multiplier applies. */
  afterWeeklyHours: number | null;
  /** Hours in the day after which this tier applies. */
  afterDailyHours: number | null;
  multiplier: number;
  label: string;
};

export type OvertimeRuleConfig = {
  source: OvertimeRuleSource;
  /** Custom tiers (used when source === 'custom'). */
  tiers: OvertimeTier[];
  dailyOvertimeApplies: boolean;
  weeklyOvertimeApplies: boolean;
  /** True if a collective agreement / averaging arrangement may change the rule. */
  hasAgreement: 'yes' | 'no' | 'not_sure';
  note?: string;
};

export type PremiumType = 'per_hour' | 'per_shift' | 'percentage' | 'multiplier';

export type PremiumRule = {
  id: string;
  label: string;
  type: PremiumType;
  /** Micro for per_hour/per_shift; percent (e.g. 10 = 10%) for percentage; 1.5 for multiplier. */
  amount: Micro | number;
  /** Time window in local minutes-of-day; null means "all day". Window may wrap midnight. */
  window?: { startMinute: number; endMinute: number } | null;
  /** Days of week (0=Sun..6=Sat); empty/undefined = every day. */
  days?: number[];
  /** Only apply on statutory holidays. */
  holidayOnly?: boolean;
  /** Only apply on weekends (Sat/Sun). */
  weekendOnly?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Whether this premium stacks with another premium on the same time slice. */
  stackable: boolean;
  /** Higher priority wins when non-stackable premiums overlap. */
  priority: number;
  /** Does this premium count toward the overtime rate base? */
  includedInOtBase: boolean;
  /** Applies to overtime hours too (default true). */
  appliesDuringOvertime: boolean;
  /** Optional weekday-window restriction for rules like "Sunday premium". */
  enabled: boolean;
};

export type VacationConfig = {
  /** 'each_cheque' | 'banked' | 'when_taken' | 'not_sure' | 'custom' */
  method: 'each_cheque' | 'banked' | 'when_taken' | 'not_sure' | 'custom';
  /** Percentage as a number, e.g. 4 or 6. */
  customPercent?: number;
  /** Banked balance the user has recorded (accrued but unpaid). */
  bankedBalance?: Micro;
};

export type HolidayPolicy = {
  /** 'jurisdiction_standard' | 'premium_only' | 'none' | 'custom' */
  mode: 'jurisdiction_standard' | 'premium_only' | 'none' | 'custom';
  /** Custom multiplier for hours worked on a statutory holiday. */
  customMultiplier?: number;
  /** Does the employer pay holiday pay (statutory holiday pay) separately? */
  paysHolidayPay: boolean;
};

export type DeductionProfile = {
  id: string;
  jobId: string;
  /** CPP/QPP + EI eligibility (some jobs are exempt). */
  cppExempt: boolean;
  eiExempt: boolean;
  /** Federal TD1 claim amount (Micro), null -> default claim from jurisdiction rules. */
  federalClaimCode: 'default' | 'canada_employment_amount' | 'custom';
  federalClaimAmount?: Micro;
  provincialClaimCode: 'default' | 'custom';
  provincialClaimAmount?: Micro;
  /** Additional flat tax per period (Micro). */
  additionalTaxPerPeriod?: Micro;
  /** Additional flat tax as a percentage of taxable income. */
  additionalTaxPercent?: number;
  /** Quebec-specific: reduce in employment amount? Used for QPIP? */
  quebecReducedEmploymentAmount?: boolean;
  /** Other recurring deductions. */
  fixedDeductions: { id: string; label: string; amount: Micro; perPeriod: boolean }[];
  percentDeductions: { id: string; label: string; percent: number }[];
  /** YTD values entered by the user (precision mode). */
  ytd: {
    cpp: Micro;
    cpp2: Micro;
    ei: Micro;
    qpp: Micro;
    qpp2?: Micro;
    qpip: Micro;
    /** Periods already paid this year, used to interpolate YTD across the year. */
    periodsPaid: number;
  } | null;
};

export type EstimateConfidenceLevel = 'basic' | 'good' | 'high';

export type EarningsLineKind =
  | 'regular'
  | 'overtime'
  | 'double_time'
  | 'premium'
  | 'vacation'
  | 'holiday'
  | 'bonus'
  | 'manual'
  | 'other';

export type EarningsLine = {
  kind: EarningsLineKind;
  label: string;
  minutes?: Minutes;
  rate?: Micro;
  amount: Micro;
  /** Explanation for the breakdown screen. */
  detail?: string;
  /** Rule id(s) that produced this line. */
  ruleIds?: string[];
};

export type DeductionLine = {
  code: 'CPP' | 'CPP2' | 'EI' | 'QPP' | 'QPP2' | 'QPIP' | 'FED_TAX' | 'PROV_TAX' | 'OTHER';
  label: string;
  amount: Micro;
  detail?: string;
  /** Annual maximum already reached, so the line shows as capped. */
  capped?: boolean;
  ytdToDate?: Micro;
  annualMaximum?: Micro;
};

export type TimeSegment = {
  startMs: number;
  endMs: number;
  minutes: Minutes;
  /** Local date key of the segment start. */
  dateKey: string;
  /** Local minutes-of-day range [start, end) with end possibly > 1440 for wrap. */
  localStartMinute: number;
  localEndMinute: number;
  /** Shift this segment came from (kept through overtime classification). */
  shiftId?: string;
};

export type OvertimeKind = 'none' | 'overtime' | 'double_time';

export type ClassifiedSegment = TimeSegment & {
  overtimeKind: OvertimeKind;
  multiplier: number;
  /** Which pay period this segment belongs to (its start date). */
  payPeriodIndex?: number;
  workWeekKey?: string;
};
