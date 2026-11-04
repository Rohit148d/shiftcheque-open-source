/**
 * Rule schemas. Every automatic legal/payroll rule in the app is data that
 * validates against these schemas. Remote rule packs are validated with the
 * same schemas before they are allowed anywhere near a calculation, and can
 * never contain executable code (spec 46).
 */
import { z } from 'zod';

export const JurisdictionSchema = z.enum(['FED', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);

/**
 * verified    — confirmed against an official government source (may calculate)
 * proposed    — announced/legislated but not yet in force (never calculates)
 * superseded  — replaced by a newer rule (kept for historical periods)
 * custom      — supplied by the user for their workplace
 * unverified  — we could not confirm it; the app will NOT calculate with it
 * unsupported — no reliable rule exists; manual entry only
 */
export const RuleStatusSchema = z.enum(['verified', 'proposed', 'superseded', 'custom', 'unverified', 'unsupported']);

export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const RuleSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  jurisdiction: JurisdictionSchema,
  topic: z.enum(['overtime', 'hours', 'vacation', 'holiday', 'payroll', 'tax', 'leave']),
  lastVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

export type RuleSource = z.infer<typeof RuleSourceSchema>;

export const OvertimeRulePackSchema = z.object({
  jurisdiction: JurisdictionSchema,
  ruleType: z.literal('overtime'),
  version: z.string().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  status: RuleStatusSchema,
  sourceIds: z.array(z.string()),
  lastVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  standardDailyHours: z.number().positive().nullable(),
  standardWeeklyHours: z.number().positive().nullable(),
  dailyOvertimeApplies: z.boolean(),
  weeklyOvertimeApplies: z.boolean(),
  overtimeMultiplier: z.number().positive(),
  doubleTimeDailyThresholdHours: z.number().positive().nullable(),
  doubleTimeMultiplier: z.number().positive().nullable(),
  /** Daily OT threshold when it differs from standard daily hours. */
  dailyOvertimeThresholdHours: z.number().positive().nullable(),
  weeklyOvertimeThresholdHours: z.number().positive().nullable(),
  notes: z.string().optional(),
});

export type OvertimeRulePack = z.infer<typeof OvertimeRulePackSchema>;

export const VacationRulePackSchema = z.object({
  jurisdiction: JurisdictionSchema,
  ruleType: z.literal('vacation'),
  version: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  status: RuleStatusSchema,
  sourceIds: z.array(z.string()),
  lastVerifiedAt: z.string(),
  /** Vacation pay percentage under the service threshold (e.g. 0.04). */
  rateUnderThreshold: z.number().nonnegative(),
  /** Vacation pay percentage at/after the threshold (e.g. 0.06). */
  rateAtThreshold: z.number().nonnegative(),
  yearsThreshold: z.number().nonnegative(),
  /** Max years after which the rate rises again, if any. */
  yearsThreshold2: z.number().nullable().optional(),
  rateAfterThreshold2: z.number().nullable().optional(),
  notes: z.string().optional(),
});

export type VacationRulePack = z.infer<typeof VacationRulePackSchema>;

export const StatutoryHolidayRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  jurisdictions: z.array(JurisdictionSchema),
  /** 'fixed' | 'nth_weekday' | 'easter' */
  kind: z.enum(['fixed', 'nth_weekday', 'easter']),
  month: z.number().min(1).max(12).nullable(),
  day: z.number().min(1).max(31).nullable(),
  nth: z.number().min(1).max(5).nullable(),
  weekday: z.number().min(0).max(6).nullable(),
  /** Days after Easter Sunday (0 = Easter Sunday). */
  easterOffset: z.number().nullable(),
  /** Substituting rule when the holiday falls on a weekend. */
  observedRule: z.enum(['next_weekday', 'previous_weekday', 'none', 'monday_after']),
  sourceIds: z.array(z.string()),
});

export type StatutoryHolidayRule = z.infer<typeof StatutoryHolidayRuleSchema>;

// ---------------------------------------------------------------------------
// Payroll (CRA / Revenu Québec) rule packs
// ---------------------------------------------------------------------------

export const TaxBracketSchema = z.object({
  /** Annual income up to this amount, or null for the top bracket. */
  upTo: z.number().nullable(),
  rate: z.number().positive(),
});

export type TaxBracket = z.infer<typeof TaxBracketSchema>;

export const ContributionRuleSchema = z.object({
  rate: z.number().nonnegative(),
  /** Annual exemption (CPP/QPP basic exemption). */
  exemption: z.number().nonnegative(),
  /** Maximum pensionable/insurable earnings. */
  maximumEarnings: z.number().nonnegative(),
  /** Published maximum employee contribution for the year. */
  maximumContribution: z.number().nonnegative(),
});

export type ContributionRule = z.infer<typeof ContributionRuleSchema>;

export const JurisdictionTaxSchema = z.object({
  brackets: z.array(TaxBracketSchema).min(1),
  /** Basic personal amount (annual). */
  basicPersonalAmount: z.number().nonnegative(),
  /** Rate used to convert credits into a tax reduction (lowest rate of the bracket table). */
  creditRate: z.number().positive(),
  /** Optional surtax configuration (ON, PE). */
  surtax: z
    .object({
      threshold1: z.number(),
      rate1: z.number(),
      threshold2: z.number().nullable(),
      rate2: z.number().nullable(),
    })
    .nullable()
    .optional(),
  /** Additional credits applied at the credit rate (e.g. Canada employment amount). */
  employmentAmount: z.number().nonnegative().optional(),
});

export type JurisdictionTax = z.infer<typeof JurisdictionTaxSchema>;

export const PayrollRulePackSchema = z.object({
  taxYear: z.number().int().min(2020).max(2100),
  version: z.string().min(1),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  status: RuleStatusSchema,
  sourceIds: z.array(z.string()),
  lastVerifiedAt: z.string(),
  federal: z.object({
    brackets: z.array(TaxBracketSchema).min(1),
    basicPersonalAmount: z.number().nonnegative(),
    creditRate: z.number().positive(),
    canadaEmploymentAmount: z.number().nonnegative(),
    pensionIncomeAmount: z.number().nonnegative(),
    cpp: ContributionRuleSchema,
    cpp2: ContributionRuleSchema,
    ei: ContributionRuleSchema,
    eiQuebec: ContributionRuleSchema,
  }),
  quebec: z
    .object({
      brackets: z.array(TaxBracketSchema).min(1),
      basicPersonalAmount: z.number().nonnegative(),
      creditRate: z.number().positive(),
      employmentAmount: z.number().nonnegative(),
      qpp: ContributionRuleSchema,
      qpp2: ContributionRuleSchema,
      qpip: ContributionRuleSchema,
    })
    .nullable(),
  provinces: z.record(z.string(), JurisdictionTaxSchema),
  notes: z.string().optional(),
});

export type PayrollRulePack = z.infer<typeof PayrollRulePackSchema>;

/** A complete rule bundle shared with the app (bundled or downloaded). */
export const RuleBundleSchema = z.object({
  bundleVersion: z.string().min(1),
  generatedAt: z.string(),
  sources: z.array(RuleSourceSchema),
  overtime: z.array(OvertimeRulePackSchema),
  vacation: z.array(VacationRulePackSchema),
  holidays: z.array(StatutoryHolidayRuleSchema),
  payroll: z.array(PayrollRulePackSchema),
  checksum: z.string().optional(),
});

export type RuleBundle = z.infer<typeof RuleBundleSchema>;

// ---------------------------------------------------------------------------
// Remote monetization config (spec 73)
// ---------------------------------------------------------------------------

export const RemoteMonetizationSchema = z.object({
  adsEnabled: z.boolean(),
  bannerEnabled: z.boolean(),
  interstitialEnabled: z.boolean(),
  rewardedEnabled: z.boolean(),
  homeBannerEnabled: z.boolean(),
  minShiftsForAds: z.number().int().min(0).max(100),
  minDaysSinceInstallForAds: z.number().min(0).max(30),
  interstitialMinHours: z.number().min(0).max(24 * 30),
  interstitialMax7d: z.number().int().min(0).max(20),
  minimumSessionsBeforeInterstitial: z.number().int().min(0).max(100),
  rewardedDailyCap: z.number().int().min(0).max(20),
  chartHistoryFreeDays: z.number().int().min(7).max(3650),
  advancedChequeChecksFreePerMonth: z.number().int().min(0).max(50),
});

export type RemoteMonetization = z.infer<typeof RemoteMonetizationSchema>;
