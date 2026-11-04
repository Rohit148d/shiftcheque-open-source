/**
 * Database schema + migrations (spec 89).
 *
 * Migrations are append-only and versioned through SQLite's `user_version`.
 * Normal app upgrades never wipe data: each migration runs once, in order.
 *
 * Money is stored as TEXT in micro-dollar units (exact bigint as a string) so
 * values round-trip without floating point loss. Minutes are INTEGER.
 */
export const SCHEMA_VERSION = 2;

export const MIGRATION_2 = `
-- Effective-dated job setting changes: pay schedule, work week, jurisdiction,
-- overtime, vacation and rate corrections all record what changed, when it
-- applies, and whether it was an explicit correction of earlier setup.
CREATE TABLE IF NOT EXISTS job_setting_changes (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  setting TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT NOT NULL,
  correction INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_setting_changes_job ON job_setting_changes(job_id, created_at DESC);
`;

export const MIGRATION_1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '#0E1B2A',
  icon TEXT NOT NULL DEFAULT 'briefcase',
  jurisdiction TEXT NOT NULL,
  tax_province TEXT NOT NULL,
  zone TEXT NOT NULL,
  hourly_rate TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  work_week_starts_on INTEGER NOT NULL DEFAULT 0,
  averaging_weeks INTEGER NOT NULL DEFAULT 1,
  averaging_anchor TEXT,
  pay_frequency TEXT NOT NULL DEFAULT 'biweekly',
  pay_anchor_start TEXT NOT NULL,
  pay_custom_period_days INTEGER,
  payday_offset_days INTEGER NOT NULL DEFAULT 0,
  overtime_source TEXT NOT NULL DEFAULT 'jurisdiction',
  overtime_daily_applies INTEGER NOT NULL DEFAULT 1,
  overtime_weekly_applies INTEGER NOT NULL DEFAULT 1,
  overtime_has_agreement TEXT NOT NULL DEFAULT 'not_sure',
  overtime_note TEXT,
  vacation_method TEXT NOT NULL DEFAULT 'not_sure',
  vacation_custom_percent REAL,
  vacation_banked_balance TEXT,
  holiday_mode TEXT NOT NULL DEFAULT 'jurisdiction_standard',
  holiday_custom_multiplier REAL,
  holiday_pays_holiday_pay INTEGER NOT NULL DEFAULT 0,
  rounding_step INTEGER NOT NULL DEFAULT 0,
  rounding_mode TEXT NOT NULL DEFAULT 'exact',
  dst_policy TEXT NOT NULL DEFAULT 'wall_clock',
  service_start_date TEXT NOT NULL DEFAULT '2020-01-01',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_history (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  rate TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_rate_history_job_date ON rate_history(job_id, effective_from);

CREATE TABLE IF NOT EXISTS overtime_rules (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tiers_json TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_overtime_rules_job ON overtime_rules(job_id, effective_from);

CREATE TABLE IF NOT EXISTS premium_rules (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  amount TEXT NOT NULL,
  window_start_minute INTEGER,
  window_end_minute INTEGER,
  days TEXT,
  holiday_only INTEGER NOT NULL DEFAULT 0,
  weekend_only INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT,
  effective_to TEXT,
  stackable INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  included_in_ot_base INTEGER NOT NULL DEFAULT 0,
  applies_during_overtime INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_premium_rules_job ON premium_rules(job_id, enabled);

CREATE TABLE IF NOT EXISTS shift_templates (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_clock TEXT NOT NULL,
  end_clock TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'work',
  paid_break_minutes INTEGER NOT NULL DEFAULT 0,
  unpaid_break_minutes INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shift_templates_job ON shift_templates(job_id);

CREATE TABLE IF NOT EXISTS shift_patterns (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cycle_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  scheduled_overnight INTEGER NOT NULL DEFAULT 0,
  actual_start TEXT,
  actual_end TEXT,
  actual_overnight INTEGER,
  type TEXT NOT NULL DEFAULT 'work',
  status TEXT NOT NULL DEFAULT 'scheduled',
  confirmed INTEGER NOT NULL DEFAULT 0,
  paid_minutes_override INTEGER,
  rate_override TEXT,
  bonus TEXT,
  bonus_note TEXT,
  notes TEXT,
  rounding_step INTEGER,
  rounding_mode TEXT,
  live_started_at_ms INTEGER,
  live_break_started_at_ms INTEGER,
  live_accumulated_minutes INTEGER,
  template_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shifts_job_date ON shifts(job_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

CREATE TABLE IF NOT EXISTS shift_breaks (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shift_breaks_shift ON shift_breaks(shift_id);

CREATE TABLE IF NOT EXISTS pay_periods (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  payday TEXT NOT NULL,
  index_number INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_periods_job ON pay_periods(job_id, start_date);

CREATE TABLE IF NOT EXISTS deduction_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  cpp_exempt INTEGER NOT NULL DEFAULT 0,
  ei_exempt INTEGER NOT NULL DEFAULT 0,
  federal_claim_code TEXT NOT NULL DEFAULT 'default',
  federal_claim_amount TEXT,
  provincial_claim_code TEXT NOT NULL DEFAULT 'default',
  provincial_claim_amount TEXT,
  additional_tax_per_period TEXT,
  additional_tax_percent REAL,
  fixed_deductions_json TEXT NOT NULL DEFAULT '[]',
  percent_deductions_json TEXT NOT NULL DEFAULT '[]',
  ytd_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_estimates (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payday TEXT NOT NULL,
  gross TEXT NOT NULL,
  net TEXT NOT NULL,
  worked_minutes INTEGER NOT NULL,
  overtime_minutes INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_estimates_job_period ON pay_estimates(job_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS actual_paycheques (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  actual_net TEXT NOT NULL,
  actual_gross TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actual_paycheques_job ON actual_paycheques(job_id, period_start);

CREATE TABLE IF NOT EXISTS actual_paycheque_lines (
  id TEXT PRIMARY KEY NOT NULL,
  cheque_id TEXT NOT NULL REFERENCES actual_paycheques(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  amount TEXT NOT NULL,
  minutes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_actual_lines_cheque ON actual_paycheque_lines(cheque_id);

CREATE TABLE IF NOT EXISTS cheque_comparisons (
  id TEXT PRIMARY KEY NOT NULL,
  cheque_id TEXT NOT NULL REFERENCES actual_paycheques(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  net_difference TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_packs (
  id TEXT PRIMARY KEY NOT NULL,
  bundle_version TEXT NOT NULL,
  source TEXT NOT NULL,
  checksum TEXT,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rule_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_state (
  id TEXT PRIMARY KEY NOT NULL,
  entitlement TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  product_id TEXT,
  store TEXT,
  last_verified_at TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS ad_state (
  id TEXT PRIMARY KEY NOT NULL,
  first_use_at INTEGER,
  last_interstitial_at INTEGER,
  interstitial_timestamps_json TEXT NOT NULL DEFAULT '[]',
  rewarded_usage_json TEXT NOT NULL DEFAULT '[]',
  meaningful_sessions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shift_reminders (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  fire_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shift_reminders_fire ON shift_reminders(fire_at_ms);

CREATE TABLE IF NOT EXISTS backup_metadata (
  id TEXT PRIMARY KEY NOT NULL,
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  encrypted INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS review_prompt_state (
  id TEXT PRIMARY KEY NOT NULL,
  installed_at_ms INTEGER NOT NULL,
  last_prompted_at_ms INTEGER,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  ineligible_until_ms INTEGER
);
`;

export const MIGRATIONS: string[] = [MIGRATION_1, MIGRATION_2];

/** Tables that must exist after migration, used by the health check. */
export const EXPECTED_TABLES = [
  'jobs',
  'job_setting_changes',
  'rate_history',
  'overtime_rules',
  'premium_rules',
  'shift_templates',
  'shift_patterns',
  'shifts',
  'shift_breaks',
  'pay_periods',
  'deduction_profiles',
  'pay_estimates',
  'actual_paycheques',
  'actual_paycheque_lines',
  'cheque_comparisons',
  'rule_packs',
  'rule_overrides',
  'app_settings',
  'subscription_state',
  'ad_state',
  'notification_settings',
  'shift_reminders',
  'backup_metadata',
  'review_prompt_state',
] as const;
