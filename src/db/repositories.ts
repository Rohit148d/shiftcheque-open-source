/**
 * Repositories: the complete persistence API used by the app.
 *
 * Everything is parameterised SQL; no string interpolation of user input ever
 * reaches the database.
 */
import type { SQLiteDatabase, SQLiteBindParams } from 'expo-sqlite';

import type { DeductionProfile, Job, PremiumRule, RateRecord, Shift } from '../core/types.ts';
import { EMPTY_JOB_COUNTS, type JobDataCounts } from '../core/jobChanges.ts';
import { allSql, db, firstSql, runSql, transaction } from './database.ts';
import {
  breakRowsFor,
  breaksFromRows,
  deserializeFixedDeductions,
  deserializeYtd,
  jobFromRow,
  money,
  parseMoney,
  premiumFromRow,
  premiumToRow,
  profileFromRow,
  rateFromRow,
  serializeFixedDeductions,
  serializePercentDeductions,
  serializeYtd,
  shiftFromRow,
  type BreakRow,
  type JobRow,
  type PremiumRuleRow,
  type ProfileRow,
  type ShiftRow,
} from './mappers.ts';

export type SettingsMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Jobs, rates, premiums
// ---------------------------------------------------------------------------

export const JobRepository = {
  async list(includeArchived = false): Promise<Job[]> {
    const rows = await allSql<JobRow>(
      `SELECT * FROM jobs ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY created_at ASC`,
    );
    const jobs: Job[] = [];
    for (const row of rows) {
      const premiums = await allSql<PremiumRuleRow>('SELECT * FROM premium_rules WHERE job_id = ? ORDER BY priority DESC', [row.id]);
      const overtimeRow = await firstSql<{ tiers_json: string }>(
        'SELECT tiers_json FROM overtime_rules WHERE job_id = ? ORDER BY effective_from DESC LIMIT 1',
        [row.id],
      );
      const tiers = overtimeRow ? (JSON.parse(overtimeRow.tiers_json) as Job['overtime']['tiers']) : [];
      jobs.push(jobFromRow(row, premiums.map(premiumFromRow), tiers));
    }
    return jobs;
  },

  async get(id: string): Promise<Job | null> {
    const row = await firstSql<JobRow>('SELECT * FROM jobs WHERE id = ?', [id]);
    if (!row) return null;
    const premiums = await allSql<PremiumRuleRow>('SELECT * FROM premium_rules WHERE job_id = ? ORDER BY priority DESC', [id]);
    const overtimeRow = await firstSql<{ tiers_json: string }>(
      'SELECT tiers_json FROM overtime_rules WHERE job_id = ? ORDER BY effective_from DESC LIMIT 1',
      [id],
    );
    const tiers = overtimeRow ? (JSON.parse(overtimeRow.tiers_json) as Job['overtime']['tiers']) : [];
    return jobFromRow(row, premiums.map(premiumFromRow), tiers);
  },

  async save(job: Job): Promise<void> {
    await transaction(async (txn) => {
      await txn.runAsync(
        `INSERT INTO jobs (
          id, name, colour, icon, jurisdiction, tax_province, zone, hourly_rate, archived,
          work_week_starts_on, averaging_weeks, averaging_anchor,
          pay_frequency, pay_anchor_start, pay_custom_period_days, payday_offset_days,
          overtime_source, overtime_daily_applies, overtime_weekly_applies, overtime_has_agreement, overtime_note,
          vacation_method, vacation_custom_percent, vacation_banked_balance,
          holiday_mode, holiday_custom_multiplier, holiday_pays_holiday_pay,
          rounding_step, rounding_mode, dst_policy, service_start_date, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, colour = excluded.colour, icon = excluded.icon,
          jurisdiction = excluded.jurisdiction, tax_province = excluded.tax_province, zone = excluded.zone,
          hourly_rate = excluded.hourly_rate, archived = excluded.archived,
          work_week_starts_on = excluded.work_week_starts_on, averaging_weeks = excluded.averaging_weeks,
          averaging_anchor = excluded.averaging_anchor,
          pay_frequency = excluded.pay_frequency, pay_anchor_start = excluded.pay_anchor_start,
          pay_custom_period_days = excluded.pay_custom_period_days, payday_offset_days = excluded.payday_offset_days,
          overtime_source = excluded.overtime_source, overtime_daily_applies = excluded.overtime_daily_applies,
          overtime_weekly_applies = excluded.overtime_weekly_applies, overtime_has_agreement = excluded.overtime_has_agreement,
          overtime_note = excluded.overtime_note,
          vacation_method = excluded.vacation_method, vacation_custom_percent = excluded.vacation_custom_percent,
          vacation_banked_balance = excluded.vacation_banked_balance,
          holiday_mode = excluded.holiday_mode, holiday_custom_multiplier = excluded.holiday_custom_multiplier,
          holiday_pays_holiday_pay = excluded.holiday_pays_holiday_pay,
          rounding_step = excluded.rounding_step, rounding_mode = excluded.rounding_mode,
          dst_policy = excluded.dst_policy, service_start_date = excluded.service_start_date,
          updated_at = excluded.updated_at`,
        [
          job.id,
          job.name,
          job.colour,
          job.icon,
          job.jurisdiction,
          job.taxProvince,
          job.zone,
          money(job.hourlyRate),
          job.archived ? 1 : 0,
          job.workWeek.startsOn,
          job.workWeek.averagingWeeks,
          job.workWeek.averagingAnchor ?? null,
          job.paySchedule.frequency,
          job.paySchedule.anchorStart,
          job.paySchedule.customPeriodDays ?? null,
          job.paySchedule.paydayOffsetDays,
          job.overtime.source,
          job.overtime.dailyOvertimeApplies ? 1 : 0,
          job.overtime.weeklyOvertimeApplies ? 1 : 0,
          job.overtime.hasAgreement,
          job.overtime.note ?? null,
          job.vacation.method,
          job.vacation.customPercent ?? null,
          job.vacation.bankedBalance ? money(job.vacation.bankedBalance) : null,
          job.holidayPolicy.mode,
          job.holidayPolicy.customMultiplier ?? null,
          job.holidayPolicy.paysHolidayPay ? 1 : 0,
          job.rounding.step,
          job.rounding.mode,
          job.dstPolicy,
          '2020-01-01',
          job.createdAt,
          job.updatedAt,
        ],
      );

      await txn.runAsync('DELETE FROM premium_rules WHERE job_id = ?', [job.id]);
      for (const rule of job.premiums) {
        const row = premiumToRow(job.id, rule);
        await txn.runAsync(
          `INSERT INTO premium_rules (
            id, job_id, label, type, amount, window_start_minute, window_end_minute, days, holiday_only,
            weekend_only, effective_from, effective_to, stackable, priority, included_in_ot_base,
            applies_during_overtime, enabled
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.id,
            row.job_id,
            row.label,
            row.type,
            row.amount,
            row.window_start_minute,
            row.window_end_minute,
            row.days,
            row.holiday_only,
            row.weekend_only,
            row.effective_from,
            row.effective_to,
            row.stackable,
            row.priority,
            row.included_in_ot_base,
            row.applies_during_overtime,
            row.enabled,
          ],
        );
      }

      await txn.runAsync('DELETE FROM overtime_rules WHERE job_id = ?', [job.id]);
      await txn.runAsync(
        'INSERT INTO overtime_rules (id, job_id, tiers_json, effective_from, effective_to, note) VALUES (?,?,?,?,?,?)',
        [`${job.id}-ot`, job.id, JSON.stringify(job.overtime.tiers), '2020-01-01', null, job.overtime.note ?? null],
      );
    });
  },

  async remove(id: string): Promise<void> {
    await runSql('DELETE FROM jobs WHERE id = ?', [id]);
  },

  async listRates(jobId: string): Promise<RateRecord[]> {    const rows = await allSql<{ id: string; job_id: string; rate: string; effective_from: string; note: string | null }>(
      'SELECT * FROM rate_history WHERE job_id = ? ORDER BY effective_from ASC',
      [jobId],
    );
    return rows.map(rateFromRow);
  },

  async addRate(rate: RateRecord): Promise<void> {
    await runSql(
      'INSERT INTO rate_history (id, job_id, rate, effective_from, note) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rate = excluded.rate, effective_from = excluded.effective_from, note = excluded.note',
      [rate.id, rate.jobId, money(rate.rate), rate.effectiveFrom, rate.note ?? null],
    );
  },

  async removeRate(id: string): Promise<void> {
    await runSql('DELETE FROM rate_history WHERE id = ?', [id]);
  },

  /**
   * Replaces the whole rate history in one transaction. Used by effective-dated
   * rate changes and corrections so a partially written history is impossible.
   */
  async replaceRates(jobId: string, rates: RateRecord[]): Promise<void> {
    await transaction(async (txn) => {
      await txn.runAsync('DELETE FROM rate_history WHERE job_id = ?', [jobId]);
      for (const rate of rates) {
        await txn.runAsync(
          'INSERT INTO rate_history (id, job_id, rate, effective_from, note) VALUES (?,?,?,?,?)',
          [rate.id, jobId, money(rate.rate), rate.effectiveFrom, rate.note ?? null],
        );
      }
    });
  },

  /** Archive or restore a job. Archived jobs keep every record they ever had. */
  async setArchived(id: string, archived: boolean): Promise<void> {
    await runSql('UPDATE jobs SET archived = ?, updated_at = ? WHERE id = ?', [
      archived ? 1 : 0,
      new Date().toISOString(),
      id,
    ]);
  },

  /** What a permanent delete would remove, for the confirmation screen. */
  async countData(jobId: string): Promise<JobDataCounts> {
    const counts = { ...EMPTY_JOB_COUNTS };
    for (const [key, sql] of Object.entries(JOB_SCOPED_QUERIES) as [keyof JobDataCounts, string][]) {
      const row = await firstSql<{ n: number }>(sql, [jobId]);
      counts[key] = row?.n ?? 0;
    }
    return counts;
  },

  /**
   * Permanently deletes a job and every record scoped to it, inside one
   * exclusive transaction. After the delete it verifies that no orphan rows
   * remain for that job; if anything is left the transaction throws and the
   * whole operation is rolled back, so a half-deleted job is impossible.
   */
  async deleteJob(jobId: string): Promise<void> {
    await transaction(async (txn) => {
      // Reminders reference shifts; clear them explicitly before the cascade so
      // a foreign-key quirk can never leave notification rows behind.
      await txn.runAsync(
        'DELETE FROM shift_reminders WHERE shift_id IN (SELECT id FROM shifts WHERE job_id = ?)',
        [jobId],
      );
      await txn.runAsync('DELETE FROM jobs WHERE id = ?', [jobId]);

      const orphans: Record<string, number> = {};
      for (const [label, sql] of Object.entries(JOB_SCOPED_QUERIES)) {
        const row = await txn.getFirstAsync<{ n: number }>(sql, [jobId]);
        const count = row?.n ?? 0;
        if (count > 0) orphans[label] = count;
      }
      if (Object.keys(orphans).length > 0) {
        throw new Error(`Deletion left related records behind: ${JSON.stringify(orphans)}`);
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

function shiftRowValues(shift: Shift): SQLiteBindParams {
  return [
    shift.id,
    shift.jobId,
    shift.date,
    shift.scheduledStart,
    shift.scheduledEnd,
    shift.scheduledOvernight ? 1 : 0,
    shift.actualStart ?? null,
    shift.actualEnd ?? null,
    shift.actualOvernight === undefined ? null : shift.actualOvernight ? 1 : 0,
    shift.type,
    shift.status,
    shift.confirmed ? 1 : 0,
    shift.paidMinutesOverride ?? null,
    shift.rateOverride !== undefined ? money(shift.rateOverride) : null,
    shift.bonus !== undefined ? money(shift.bonus) : null,
    shift.bonusNote ?? null,
    shift.notes ?? null,
    shift.rounding ? shift.rounding.step : null,
    shift.rounding ? shift.rounding.mode : null,
    shift.liveStartedAtMs ?? null,
    shift.liveBreakStartedAtMs ?? null,
    shift.liveAccumulatedMinutes ?? null,
    shift.templateId ?? null,
    shift.createdAt,
    shift.updatedAt,
  ];
}

export const ShiftRepository = {
  async listInRange(jobId: string, from: string, to: string): Promise<Shift[]> {
    const rows = await allSql<ShiftRow>(
      'SELECT * FROM shifts WHERE job_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, scheduled_start ASC',
      [jobId, from, to],
    );
    return this.attachBreaks(rows);
  },

  async listAll(): Promise<Shift[]> {
    const rows = await allSql<ShiftRow>('SELECT * FROM shifts ORDER BY date DESC, scheduled_start ASC');
    return this.attachBreaks(rows);
  },

  async attachBreaks(rows: ShiftRow[]): Promise<Shift[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const breakRows = await allSql<BreakRow>(
      `SELECT * FROM shift_breaks WHERE shift_id IN (${placeholders}) ORDER BY sort_order ASC`,
      ids,
    );
    const byShift = new Map<string, BreakRow[]>();
    for (const row of breakRows) {
      byShift.set(row.shift_id, [...(byShift.get(row.shift_id) ?? []), row]);
    }
    return rows.map((row) => shiftFromRow(row, breaksFromRows(byShift.get(row.id) ?? [])));
  },

  async get(id: string): Promise<Shift | null> {
    const row = await firstSql<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [id]);
    if (!row) return null;
    const breaks = await allSql<BreakRow>('SELECT * FROM shift_breaks WHERE shift_id = ? ORDER BY sort_order ASC', [id]);
    return shiftFromRow(row, breaksFromRows(breaks));
  },

  async count(): Promise<number> {
    const row = await firstSql<{ count: number }>('SELECT COUNT(*) as count FROM shifts');
    return row?.count ?? 0;
  },

  async save(shift: Shift): Promise<void> {
    await transaction(async (txn) => {
      await txn.runAsync(
        `INSERT INTO shifts (
          id, job_id, date, scheduled_start, scheduled_end, scheduled_overnight, actual_start, actual_end,
          actual_overnight, type, status, confirmed, paid_minutes_override, rate_override, bonus, bonus_note,
          notes, rounding_step, rounding_mode, live_started_at_ms, live_break_started_at_ms,
          live_accumulated_minutes, template_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id, date = excluded.date, scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end, scheduled_overnight = excluded.scheduled_overnight,
          actual_start = excluded.actual_start, actual_end = excluded.actual_end,
          actual_overnight = excluded.actual_overnight, type = excluded.type, status = excluded.status,
          confirmed = excluded.confirmed, paid_minutes_override = excluded.paid_minutes_override,
          rate_override = excluded.rate_override, bonus = excluded.bonus, bonus_note = excluded.bonus_note,
          notes = excluded.notes, rounding_step = excluded.rounding_step, rounding_mode = excluded.rounding_mode,
          live_started_at_ms = excluded.live_started_at_ms,
          live_break_started_at_ms = excluded.live_break_started_at_ms,
          live_accumulated_minutes = excluded.live_accumulated_minutes,
          template_id = excluded.template_id, updated_at = excluded.updated_at`,
        shiftRowValues(shift),
      );
      await txn.runAsync('DELETE FROM shift_breaks WHERE shift_id = ?', [shift.id]);
      for (const row of breakRowsFor(shift.id, shift.breaks)) {
        await txn.runAsync(
          'INSERT INTO shift_breaks (id, shift_id, label, minutes, paid, sort_order) VALUES (?,?,?,?,?,?)',
          [row.id, row.shift_id, row.label, row.minutes, row.paid, row.sort_order],
        );
      }
    });
  },

  async saveMany(shifts: Shift[]): Promise<void> {
    for (const shift of shifts) {
      await this.save(shift);
    }
  },

  async remove(id: string): Promise<void> {
    await runSql('DELETE FROM shifts WHERE id = ?', [id]);
  },

  async removeByJob(jobId: string): Promise<void> {
    await runSql('DELETE FROM shifts WHERE job_id = ?', [jobId]);
  },

  async inProgress(): Promise<Shift | null> {
    const row = await firstSql<ShiftRow>("SELECT * FROM shifts WHERE status = 'in_progress' ORDER BY live_started_at_ms DESC LIMIT 1");
    if (!row) return null;
    const breaks = await allSql<BreakRow>('SELECT * FROM shift_breaks WHERE shift_id = ? ORDER BY sort_order ASC', [row.id]);
    return shiftFromRow(row, breaksFromRows(breaks));
  },
};

// ---------------------------------------------------------------------------
// Deduction profiles
// ---------------------------------------------------------------------------

export const ProfileRepository = {
  async get(jobId: string): Promise<DeductionProfile | null> {
    const row = await firstSql<ProfileRow>('SELECT * FROM deduction_profiles WHERE job_id = ?', [jobId]);
    if (!row) return null;
    return {
      ...profileFromRow(row),
      fixedDeductions: deserializeFixedDeductions(row.fixed_deductions_json),
      ytd: deserializeYtd(row.ytd_json),
    };
  },

  async save(profile: DeductionProfile): Promise<void> {
    await runSql(
      `INSERT INTO deduction_profiles (
        id, job_id, cpp_exempt, ei_exempt, federal_claim_code, federal_claim_amount,
        provincial_claim_code, provincial_claim_amount, additional_tax_per_period, additional_tax_percent,
        fixed_deductions_json, percent_deductions_json, ytd_json, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET
        cpp_exempt = excluded.cpp_exempt, ei_exempt = excluded.ei_exempt,
        federal_claim_code = excluded.federal_claim_code, federal_claim_amount = excluded.federal_claim_amount,
        provincial_claim_code = excluded.provincial_claim_code, provincial_claim_amount = excluded.provincial_claim_amount,
        additional_tax_per_period = excluded.additional_tax_per_period, additional_tax_percent = excluded.additional_tax_percent,
        fixed_deductions_json = excluded.fixed_deductions_json,
        percent_deductions_json = excluded.percent_deductions_json,
        ytd_json = excluded.ytd_json, updated_at = excluded.updated_at`,
      [
        profile.id,
        profile.jobId,
        profile.cppExempt ? 1 : 0,
        profile.eiExempt ? 1 : 0,
        profile.federalClaimCode,
        profile.federalClaimAmount !== undefined ? money(profile.federalClaimAmount) : null,
        profile.provincialClaimCode,
        profile.provincialClaimAmount !== undefined ? money(profile.provincialClaimAmount) : null,
        profile.additionalTaxPerPeriod !== undefined ? money(profile.additionalTaxPerPeriod) : null,
        profile.additionalTaxPercent ?? null,
        serializeFixedDeductions(profile.fixedDeductions),
        serializePercentDeductions(profile.percentDeductions),
        serializeYtd(profile.ytd),
        new Date().toISOString(),
      ],
    );
  },
};

// ---------------------------------------------------------------------------
// Pay estimate cache (spec 88: never recompute history on every render)
// ---------------------------------------------------------------------------

export type CachedEstimate = {
  jobId: string;
  periodStart: string;
  periodEnd: string;
  payday: string;
  gross: string;
  net: string;
  workedMinutes: number;
  overtimeMinutes: number;
  confidence: string;
  engineVersion: string;
  ruleVersion: string;
  breakdownJson: string;
  computedAt: string;
};

export const EstimateRepository = {
  async get(jobId: string, periodStart: string, periodEnd: string): Promise<CachedEstimate | null> {
    return firstSql<CachedEstimate>(
      'SELECT * FROM pay_estimates WHERE job_id = ? AND period_start = ? AND period_end = ?',
      [jobId, periodStart, periodEnd],
    );
  },

  async save(estimate: CachedEstimate): Promise<void> {
    await runSql(
      `INSERT INTO pay_estimates (
        id, job_id, period_start, period_end, payday, gross, net, worked_minutes, overtime_minutes,
        confidence, engine_version, rule_version, breakdown_json, computed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        gross = excluded.gross, net = excluded.net, worked_minutes = excluded.worked_minutes,
        overtime_minutes = excluded.overtime_minutes, confidence = excluded.confidence,
        engine_version = excluded.engine_version, rule_version = excluded.rule_version,
        breakdown_json = excluded.breakdown_json, computed_at = excluded.computed_at`,
      [
        `est-${estimate.jobId}-${estimate.periodStart}-${estimate.periodEnd}`,
        estimate.jobId,
        estimate.periodStart,
        estimate.periodEnd,
        estimate.payday,
        estimate.gross,
        estimate.net,
        estimate.workedMinutes,
        estimate.overtimeMinutes,
        estimate.confidence,
        estimate.engineVersion,
        estimate.ruleVersion,
        estimate.breakdownJson,
        estimate.computedAt,
      ],
    );
  },

  async clear(jobId: string): Promise<void> {
    await runSql('DELETE FROM pay_estimates WHERE job_id = ?', [jobId]);
  },
};

// ---------------------------------------------------------------------------
// Actual paycheques
// ---------------------------------------------------------------------------

export type ActualCheque = {
  id: string;
  jobId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  actualNet: string;
  actualGross: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lines: { id: string; code: string; label: string; amount: string; minutes: number | null }[];
};

export const ChequeRepository = {
  async list(jobId: string | null, limit = 40): Promise<ActualCheque[]> {
    const rows = await allSql<{
      id: string;
      job_id: string;
      period_start: string;
      period_end: string;
      pay_date: string;
      actual_net: string;
      actual_gross: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM actual_paycheques ${jobId ? 'WHERE job_id = ?' : ''} ORDER BY pay_date DESC LIMIT ?`,
      jobId ? [jobId, limit] : [limit],
    );
    const cheques: ActualCheque[] = [];
    for (const row of rows) {
      const lines = await allSql<{ id: string; code: string; label: string; amount: string; minutes: number | null }>(
        'SELECT id, code, label, amount, minutes FROM actual_paycheque_lines WHERE cheque_id = ?',
        [row.id],
      );
      cheques.push({
        id: row.id,
        jobId: row.job_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        payDate: row.pay_date,
        actualNet: row.actual_net,
        actualGross: row.actual_gross,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lines,
      });
    }
    return cheques;
  },

  async save(cheque: ActualCheque): Promise<void> {
    await transaction(async (txn) => {
      await txn.runAsync(
        `INSERT INTO actual_paycheques (id, job_id, period_start, period_end, pay_date, actual_net, actual_gross, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           actual_net = excluded.actual_net, actual_gross = excluded.actual_gross,
           notes = excluded.notes, updated_at = excluded.updated_at`,
        [
          cheque.id,
          cheque.jobId,
          cheque.periodStart,
          cheque.periodEnd,
          cheque.payDate,
          cheque.actualNet,
          cheque.actualGross,
          cheque.notes,
          cheque.createdAt,
          cheque.updatedAt,
        ],
      );
      await txn.runAsync('DELETE FROM actual_paycheque_lines WHERE cheque_id = ?', [cheque.id]);
      for (const line of cheque.lines) {
        await txn.runAsync(
          'INSERT INTO actual_paycheque_lines (id, cheque_id, code, label, amount, minutes) VALUES (?,?,?,?,?,?)',
          [line.id, cheque.id, line.code, line.label, line.amount, line.minutes],
        );
      }
    });
  },

  async remove(id: string): Promise<void> {
    await runSql('DELETE FROM actual_paycheques WHERE id = ?', [id]);
  },

  async saveComparison(chequeId: string, outcome: string, netDifference: string | null, payloadJson: string): Promise<void> {
    await runSql(
      'INSERT INTO cheque_comparisons (id, cheque_id, outcome, net_difference, payload_json, created_at) VALUES (?,?,?,?,?,?)',
      [`cmp-${chequeId}`, chequeId, outcome, netDifference, payloadJson, new Date().toISOString()],
    );
  },
};

// ---------------------------------------------------------------------------
// Settings + monetization state
// ---------------------------------------------------------------------------

export const SettingsRepository = {
  async all(): Promise<SettingsMap> {
    const rows = await allSql<{ key: string; value: string }>('SELECT key, value FROM app_settings');
    const map: SettingsMap = {};
    for (const row of rows) map[row.key] = row.value;
    return map;
  },

  async get(key: string): Promise<string | null> {
    const row = await firstSql<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await runSql(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, value, new Date().toISOString()],
    );
  },

  async setMany(values: SettingsMap): Promise<void> {
    await transaction(async (txn) => {
      for (const [key, value] of Object.entries(values)) {
        await txn.runAsync(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          [key, value, new Date().toISOString()],
        );
      }
    });
  },

  async notificationSettings(): Promise<Record<string, boolean>> {
    const rows = await allSql<{ category: string; enabled: number }>('SELECT category, enabled FROM notification_settings');
    const map: Record<string, boolean> = {};
    for (const row of rows) map[row.category] = row.enabled === 1;
    return map;
  },

  async setNotificationSetting(category: string, enabled: boolean): Promise<void> {
    await runSql(
      'INSERT INTO notification_settings (id, category, enabled) VALUES (?,?,?) ON CONFLICT(category) DO UPDATE SET enabled = excluded.enabled',
      [`ns-${category}`, category, enabled ? 1 : 0],
    );
  },
};

export const SubscriptionRepository = {
  async get(): Promise<{ active: boolean; expiresAt: string | null; productId: string | null; store: string | null } | null> {
    const row = await firstSql<{ active: number; expires_at: string | null; product_id: string | null; store: string | null }>(
      'SELECT active, expires_at, product_id, store FROM subscription_state LIMIT 1',
    );
    if (!row) return null;
    return { active: row.active === 1, expiresAt: row.expires_at, productId: row.product_id, store: row.store };
  },

  async save(state: {
    entitlement: string;
    active: boolean;
    expiresAt: string | null;
    productId: string | null;
    store: string | null;
    raw?: string | null;
  }): Promise<void> {
    await runSql(
      `INSERT INTO subscription_state (id, entitlement, active, expires_at, product_id, store, last_verified_at, raw_json)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET active = excluded.active, expires_at = excluded.expires_at,
         product_id = excluded.product_id, store = excluded.store, last_verified_at = excluded.last_verified_at,
         raw_json = excluded.raw_json`,
      [
        'current',
        state.entitlement,
        state.active ? 1 : 0,
        state.expiresAt,
        state.productId,
        state.store,
        new Date().toISOString(),
        state.raw ?? null,
      ],
    );
  },
};

export const AdStateRepository = {
  async get(): Promise<{
    firstUseAt: number | null;
    lastInterstitialAt: number | null;
    interstitialTimestamps: number[];
    rewardedUsage: { day: string; count: number }[];
    meaningfulSessions: number;
  }> {
    const row = await firstSql<{
      first_use_at: number | null;
      last_interstitial_at: number | null;
      interstitial_timestamps_json: string;
      rewarded_usage_json: string;
      meaningful_sessions: number;
    }>('SELECT * FROM ad_state WHERE id = ?', ['current']);
    if (!row) {
      return { firstUseAt: null, lastInterstitialAt: null, interstitialTimestamps: [], rewardedUsage: [], meaningfulSessions: 0 };
    }
    return {
      firstUseAt: row.first_use_at,
      lastInterstitialAt: row.last_interstitial_at,
      interstitialTimestamps: JSON.parse(row.interstitial_timestamps_json || '[]') as number[],
      rewardedUsage: JSON.parse(row.rewarded_usage_json || '[]') as { day: string; count: number }[],
      meaningfulSessions: row.meaningful_sessions,
    };
  },

  async save(state: {
    firstUseAt: number | null;
    lastInterstitialAt: number | null;
    interstitialTimestamps: number[];
    rewardedUsage: { day: string; count: number }[];
    meaningfulSessions: number;
  }): Promise<void> {
    await runSql(
      `INSERT INTO ad_state (id, first_use_at, last_interstitial_at, interstitial_timestamps_json, rewarded_usage_json, meaningful_sessions, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET first_use_at = excluded.first_use_at,
         last_interstitial_at = excluded.last_interstitial_at,
         interstitial_timestamps_json = excluded.interstitial_timestamps_json,
         rewarded_usage_json = excluded.rewarded_usage_json,
         meaningful_sessions = excluded.meaningful_sessions, updated_at = excluded.updated_at`,
      [
        'current',
        state.firstUseAt,
        state.lastInterstitialAt,
        JSON.stringify(state.interstitialTimestamps),
        JSON.stringify(state.rewardedUsage),
        state.meaningfulSessions,
        new Date().toISOString(),
      ],
    );
  },
};

export const RulePackRepository = {
  async active(): Promise<{ bundleVersion: string; payloadJson: string; fetchedAt: string; checksum: string | null } | null> {
    const row = await firstSql<{ bundle_version: string; payload_json: string; fetched_at: string; checksum: string | null }>(
      'SELECT bundle_version, payload_json, fetched_at, checksum FROM rule_packs WHERE active = 1 ORDER BY fetched_at DESC LIMIT 1',
    );
    if (!row) return null;
    return { bundleVersion: row.bundle_version, payloadJson: row.payload_json, fetchedAt: row.fetched_at, checksum: row.checksum };
  },

  async saveRemote(bundleVersion: string, payloadJson: string, checksum: string | null): Promise<void> {
    await transaction(async (txn) => {
      await txn.runAsync('UPDATE rule_packs SET active = 0');
      await txn.runAsync(
        `INSERT INTO rule_packs (id, bundle_version, source, checksum, payload_json, fetched_at, active)
         VALUES (?,?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, checksum = excluded.checksum,
           fetched_at = excluded.fetched_at, active = 1`,
        [`remote-${bundleVersion}`, bundleVersion, 'remote', checksum, payloadJson, new Date().toISOString()],
      );
    });
  },
};

export const BackupRepository = {
  async record(entry: {
    fileName: string;
    sizeBytes: number;
    encrypted: boolean;
    schemaVersion: number;
    summaryJson: string;
  }): Promise<void> {
    await runSql(
      `INSERT INTO backup_metadata (id, file_name, created_at, size_bytes, encrypted, schema_version, summary_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        `backup-${Date.now()}`,
        entry.fileName,
        new Date().toISOString(),
        entry.sizeBytes,
        entry.encrypted ? 1 : 0,
        entry.schemaVersion,
        entry.summaryJson,
      ],
    );
  },

  async recent(limit = 5): Promise<{ fileName: string; createdAt: string; sizeBytes: number }[]> {
    const rows = await allSql<{ file_name: string; created_at: string; size_bytes: number }>(
      'SELECT file_name, created_at, size_bytes FROM backup_metadata ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map((row) => ({ fileName: row.file_name, createdAt: row.created_at, sizeBytes: row.size_bytes }));
  },
};

/** Wipes user data (used by "replace" import and a confirmed reset). */
export async function wipeAllData(txn?: SQLiteDatabase): Promise<void> {  const handle = txn ?? (await db());
  const tables = [
    'cheque_comparisons',
    'actual_paycheque_lines',
    'actual_paycheques',
    'pay_estimates',
    'shift_reminders',
    'shift_breaks',
    'shifts',
    'shift_templates',
    'shift_patterns',
    'pay_periods',
    'premium_rules',
    'overtime_rules',
    'rate_history',
    'deduction_profiles',
    'jobs',
    'rule_overrides',
    'job_setting_changes',
    'backup_metadata',
    'review_prompt_state',
    'ad_state',
    'subscription_state',
    'notification_settings',
    'app_settings',
  ];
  for (const table of tables) {
    await handle.runAsync(`DELETE FROM ${table}`);
  }
}

/**
 * Every table that holds rows scoped to one job. Used both to describe a
 * permanent deletion to the user and to prove, inside the transaction, that
 * nothing was left behind.
 */
export const JOB_SCOPED_QUERIES: Record<string, string> = {
  shifts: 'SELECT COUNT(*) AS n FROM shifts WHERE job_id = ?',
  breaks: 'SELECT COUNT(*) AS n FROM shift_breaks WHERE shift_id IN (SELECT id FROM shifts WHERE job_id = ?)',
  rateChanges: 'SELECT COUNT(*) AS n FROM rate_history WHERE job_id = ?',
  premiums: 'SELECT COUNT(*) AS n FROM premium_rules WHERE job_id = ?',
  estimates: 'SELECT COUNT(*) AS n FROM pay_estimates WHERE job_id = ?',
  cheques: 'SELECT COUNT(*) AS n FROM actual_paycheques WHERE job_id = ?',
  comparisons:
    'SELECT COUNT(*) AS n FROM cheque_comparisons WHERE cheque_id IN (SELECT id FROM actual_paycheques WHERE job_id = ?)',
  settingChanges: 'SELECT COUNT(*) AS n FROM job_setting_changes WHERE job_id = ?',
  reminders: 'SELECT COUNT(*) AS n FROM shift_reminders WHERE shift_id IN (SELECT id FROM shifts WHERE job_id = ?)',
  payPeriods: 'SELECT COUNT(*) AS n FROM pay_periods WHERE job_id = ?',
  templates: 'SELECT COUNT(*) AS n FROM shift_templates WHERE job_id = ?',
  patterns: 'SELECT COUNT(*) AS n FROM shift_patterns WHERE job_id = ?',
};

export type JobSettingChangeRecord = {
  id: string;
  jobId: string;
  setting: string;
  effectiveFrom: string;
  previousValueJson: string | null;
  newValueJson: string;
  correction: boolean;
  note: string | null;
  createdAt: string;
};

/** The plain-language log of setup changes shown on the job screen. */
export const JobSettingChangeRepository = {
  async list(jobId: string, limit = 20): Promise<JobSettingChangeRecord[]> {
    const rows = await allSql<{
      id: string;
      job_id: string;
      setting: string;
      effective_from: string;
      previous_value_json: string | null;
      new_value_json: string;
      correction: number;
      note: string | null;
      created_at: string;
    }>('SELECT * FROM job_setting_changes WHERE job_id = ? ORDER BY created_at DESC LIMIT ?', [jobId, limit]);
    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      setting: row.setting,
      effectiveFrom: row.effective_from,
      previousValueJson: row.previous_value_json,
      newValueJson: row.new_value_json,
      correction: row.correction === 1,
      note: row.note,
      createdAt: row.created_at,
    }));
  },

  async add(change: Omit<JobSettingChangeRecord, 'createdAt'> & { createdAt?: string }): Promise<void> {
    await runSql(
      `INSERT INTO job_setting_changes (
        id, job_id, setting, effective_from, previous_value_json, new_value_json, correction, note, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        change.id,
        change.jobId,
        change.setting,
        change.effectiveFrom,
        change.previousValueJson,
        change.newValueJson,
        change.correction ? 1 : 0,
        change.note,
        change.createdAt ?? new Date().toISOString(),
      ],
    );
  },
};
