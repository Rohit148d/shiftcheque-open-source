import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeJobCount,
  activeJobs,
  applyRateChange,
  archivedJobs,
  canAddActiveJob,
  deletionConfirmationSatisfied,
  deletionSummaryRows,
  hasUnsavedChanges,
  nextActiveJobId,
  planRateChange,
  planSettingChange,
  rateChangeImpact,
  runJobDeletion,
  shouldWarnAboutUnsavedChanges,
  totalJobRows,
  type JobDataCounts,
  type JobDeletionPort,
} from '../src/core/jobChanges.ts';
import { rateForDate } from '../src/core/rate.ts';
import { EXPECTED_TABLES, MIGRATIONS, SCHEMA_VERSION } from '../src/db/schema.ts';
import { calculationCacheKey } from '../src/state/calculationCache.ts';
import { payPeriodFor } from '../src/core/workweek.ts';
import type { Job, RateRecord, Shift } from '../src/core/types.ts';
import { makeJob, makeShift, money } from './helpers.ts';

const TODAY = '2026-10-20';
const WEEK = { startsOn: 0, averagingWeeks: 1 };

function ratesFor(...entries: [string, string][]): RateRecord[] {
  return entries.map(([rate, effectiveFrom], index) => ({
    id: `rate-${index}`,
    jobId: 'job-1',
    rate: money(rate),
    effectiveFrom,
  }));
}

const PERIOD = payPeriodFor(TODAY, makeJob().paySchedule);

const COUNTS: JobDataCounts = {
  shifts: 24,
  breaks: 24,
  rateChanges: 1,
  premiums: 2,
  estimates: 3,
  cheques: 2,
  comparisons: 2,
  settingChanges: 4,
  reminders: 0,
  payPeriods: 0,
  templates: 0,
  patterns: 0,
};

// ---------------------------------------------------------------------------
// 1. Rate changes keep history
// ---------------------------------------------------------------------------

test('a raise from today adds a new rate record and keeps the old one', () => {
  const rates = ratesFor(['31.00', '2025-01-01']);
  const { ok, application } = applyRateChange(
    { mode: 'from_today', newRateText: '32.50', today: TODAY },
    { today: TODAY, rates, jobId: 'job-1', makeId: () => 'rate-new' },
  );
  assert.equal(ok, true);
  assert.equal(application?.rates.length, 2, 'history grows, nothing is overwritten');
  assert.equal(application?.rates[0].rate, money('31.00'), 'the old rate survives');
  assert.equal(application?.rates[1].rate, money('32.50'));
  assert.equal(application?.rates[1].effectiveFrom, TODAY);
  assert.equal(application?.log.correction, false);
  // Past shifts keep the old rate, current/future shifts use the new one.
  assert.equal(rateForDate(application!.rates, '2026-09-15', 0n), money('31.00'));
  assert.equal(rateForDate(application!.rates, TODAY, 0n), money('32.50'));
});

test('a raise from a chosen date applies only from that date', () => {
  const rates = ratesFor(['31.00', '2025-01-01']);
  const { ok, application } = applyRateChange(
    { mode: 'from_date', newRateText: '32.50', effectiveDateText: '2026-11-01', today: TODAY },
    { today: TODAY, rates, jobId: 'job-1', makeId: () => 'rate-new' },
  );
  assert.equal(ok, true);
  assert.equal(application?.rates[1].effectiveFrom, '2026-11-01');
  assert.equal(rateForDate(application!.rates, '2026-10-25', 0n), money('31.00'), 'shifts before the date keep the old rate');
  assert.equal(rateForDate(application!.rates, '2026-11-02', 0n), money('32.50'), 'shifts after it use the new rate');
});

test('a rate change rejects an ambiguous or invalid effective date', () => {
  for (const bad of ['10/05/2026', '2026-02-30', '']) {
    const result = planRateChange(
      { mode: 'from_date', newRateText: '32.50', effectiveDateText: bad, today: TODAY },
      { today: TODAY, rates: ratesFor(['31.00', '2025-01-01']) },
    );
    assert.equal(result.ok, false, `${bad} must be rejected`);
    assert.ok(result.errors.effectiveDate);
  }
});

test('correcting the original rate edits that record instead of adding one', () => {
  const rates = ratesFor(['31.00', '2025-01-01'], ['32.50', '2026-11-01']);
  const { ok, application } = applyRateChange(
    { mode: 'correct_original', newRateText: '30.00', today: TODAY },
    { today: TODAY, rates, jobId: 'job-1', makeId: () => 'rate-new' },
  );
  assert.equal(ok, true);
  assert.equal(application?.rates.length, 2, 'no extra record is created');
  assert.equal(application?.rates[0].rate, money('30.00'), 'the original record is corrected in place');
  assert.equal(application?.rates[0].effectiveFrom, '2025-01-01', 'its effective date does not move');
  assert.equal(application?.rates[1].rate, money('32.50'), 'later planned rates are untouched');
  assert.equal(application?.log.correction, true, 'corrections are logged as corrections');
  // History now recalculates: a past shift uses the corrected rate.
  assert.equal(rateForDate(application!.rates, '2026-05-01', 0n), money('30.00'));
});

test('correcting with no rate history yet behaves like a change from today', () => {
  const { ok, application } = applyRateChange(
    { mode: 'correct_original', newRateText: '30.00', today: TODAY },
    { today: TODAY, rates: [], jobId: 'job-1', makeId: () => 'rate-new' },
  );
  assert.equal(ok, true);
  assert.equal(application?.rates.length, 1);
  assert.equal(application?.log.correction, true);
});

test('a raise never silently rewrites historical rates', () => {
  const rates = ratesFor(['31.00', '2025-01-01']);
  const before = rateForDate(rates, '2026-08-01', 0n);
  const { application } = applyRateChange(
    { mode: 'from_today', newRateText: '40.00', today: TODAY },
    { today: TODAY, rates, jobId: 'job-1', makeId: () => 'rate-new' },
  );
  assert.equal(rateForDate(application!.rates, '2026-08-01', 0n), before, 'August pay does not change when a raise is entered in October');
});

test('the impact report counts which shifts change', () => {
  const shifts: Shift[] = [
    makeShift({ id: 'a', jobId: 'job-1', date: '2026-10-01', status: 'completed', confirmed: true }),
    makeShift({ id: 'b', jobId: 'job-1', date: '2026-10-05', status: 'completed', confirmed: true }),
    makeShift({ id: 'c', jobId: 'job-1', date: '2026-10-25', status: 'scheduled' }),
    makeShift({ id: 'd', jobId: 'job-1', date: '2026-10-26', status: 'scheduled' }),
    makeShift({ id: 'other-job', jobId: 'job-2', date: '2026-10-26', status: 'scheduled' }),
  ];
  const { impact } = rateChangeImpact(
    { mode: 'from_today', newRateText: '32.50', today: TODAY },
    { today: TODAY, rates: ratesFor(['31.00', '2025-01-01']), shifts, fallbackRate: money('31.00'), jobId: 'job-1' },
  );
  assert.equal(impact?.affectedScheduledShiftCount, 2, 'only this job\'s future shifts');
  assert.equal(impact?.affectedPastShiftCount, 0, 'a raise from today leaves past shifts alone');
  assert.equal(impact?.unaffectedShiftCount, 2);

  const correction = rateChangeImpact(
    { mode: 'correct_original', newRateText: '30.00', today: TODAY },
    { today: TODAY, rates: ratesFor(['31.00', '2025-01-01']), shifts, fallbackRate: money('31.00'), jobId: 'job-1' },
  );
  assert.equal(correction.impact?.affectedPastShiftCount, 2, 'a correction reaches historical shifts');
});

test('rate validation rejects nonsense before anything is saved', () => {
  for (const bad of ['', 'abc', '0', '-5']) {
    const result = planRateChange({ mode: 'from_today', newRateText: bad, today: TODAY }, { today: TODAY, rates: [] });
    assert.equal(result.ok, false, `${bad} must be rejected`);
    assert.ok(result.errors.rate);
  }
  assert.equal(planRateChange({ mode: 'from_today', newRateText: '99999', today: TODAY }, { today: TODAY, rates: [] }).ok, false);
});

// ---------------------------------------------------------------------------
// 2. Schedule / work week / jurisdiction changes are scoped
// ---------------------------------------------------------------------------

test('a pay-schedule change defaults to the next pay period', () => {
  const { ok, plan } = planSettingChange({ setting: 'pay_schedule', scope: 'next_period', today: TODAY, period: PERIOD });
  assert.equal(ok, true);
  assert.equal(plan?.effectiveFrom, '2026-10-22', 'the day after the current period ends');
  assert.equal(plan?.correction, false);
  assert.equal(plan?.warning, 'future_only');
});

test('a change from a chosen date warns when it reaches history', () => {
  const future = planSettingChange({ setting: 'work_week', scope: 'from_date', effectiveDateText: '2026-11-02', today: TODAY, period: PERIOD });
  assert.equal(future.plan?.warning, 'future_only');
  const past = planSettingChange({ setting: 'work_week', scope: 'from_date', effectiveDateText: '2026-09-01', today: TODAY, period: PERIOD });
  assert.equal(past.plan?.warning, 'history_may_change');
  const invalid = planSettingChange({ setting: 'work_week', scope: 'from_date', effectiveDateText: '10/05/2026', today: TODAY, period: PERIOD });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.effectiveDate);
});

test('correcting previous setup is explicit and flagged as history-changing', () => {
  const { ok, plan } = planSettingChange({ setting: 'jurisdiction', scope: 'correct_previous', today: TODAY, period: PERIOD });
  assert.equal(ok, true);
  assert.equal(plan?.correction, true);
  assert.equal(plan?.warning, 'history_may_change');
});

// ---------------------------------------------------------------------------
// 3. Archive / restore and the free-vs-Pro rule
// ---------------------------------------------------------------------------

const jobA = { ...makeJob({ id: 'job-a', name: 'Warehouse' }) };
const jobB = { ...makeJob({ id: 'job-b', name: 'Hospital' }) };

test('active and archived jobs are separated', () => {
  const jobs: Job[] = [{ ...jobA, archived: true }, jobB];
  assert.equal(activeJobs(jobs).length, 1);
  assert.equal(activeJobs(jobs)[0].id, 'job-b');
  assert.equal(archivedJobs(jobs).length, 1);
  assert.equal(activeJobCount(jobs), 1);
});

test('a free user can add a job when their old one is archived', () => {
  const archivedOnly: Job[] = [{ ...jobA, archived: true }];
  assert.deepEqual(canAddActiveJob({ isPro: false, jobs: archivedOnly }), { allowed: true, reason: 'ok', activeCount: 0 });
  const oneActive: Job[] = [jobA];
  assert.deepEqual(canAddActiveJob({ isPro: false, jobs: oneActive }), { allowed: false, reason: 'pro_required', activeCount: 1 });
  const twoActive: Job[] = [jobA, jobB];
  assert.equal(canAddActiveJob({ isPro: false, jobs: twoActive }).allowed, false);
  assert.equal(canAddActiveJob({ isPro: true, jobs: twoActive }).allowed, true, 'Pro has no limit');
  assert.equal(canAddActiveJob({ isPro: true, jobs: [] }).allowed, true);
});

test('after removing a job the next active one takes over', () => {
  const jobs: Job[] = [{ ...jobA, archived: true }, jobB];
  assert.equal(nextActiveJobId(jobs, 'job-b'), null, 'nothing else is active');
  assert.equal(nextActiveJobId([jobB, { ...jobA }], 'job-b'), 'job-a');
  assert.equal(nextActiveJobId([jobB], 'job-b'), null);
});

// ---------------------------------------------------------------------------
// 4. Unsaved changes
// ---------------------------------------------------------------------------

test('unsaved-changes warnings fire only for real, unsaved edits', () => {
  assert.equal(shouldWarnAboutUnsavedChanges({ dirty: true, saving: false, saved: false }), true);
  assert.equal(shouldWarnAboutUnsavedChanges({ dirty: false, saving: false, saved: false }), false);
  assert.equal(shouldWarnAboutUnsavedChanges({ dirty: true, saving: true, saved: false }), false, 'never interrupt a save');
  assert.equal(shouldWarnAboutUnsavedChanges({ dirty: true, saving: false, saved: true }), false, 'nothing to lose after saving');
});

test('field comparison drives the dirty flag', () => {
  const before = { name: 'Warehouse', rate: '31.00', colour: '#D52B1E' };
  assert.equal(hasUnsavedChanges(before, { ...before }), false);
  assert.equal(hasUnsavedChanges(before, { ...before, name: 'Warehouse nights' }), true);
  assert.equal(hasUnsavedChanges(before, { ...before, rate: '32.50' }), true);
  assert.equal(hasUnsavedChanges(before, { ...before, colour: '#1F5F92' }), true);
  assert.equal(hasUnsavedChanges({ name: '' }, { name: '' }), false);
});

// ---------------------------------------------------------------------------
// 5. Permanent deletion
// ---------------------------------------------------------------------------

test('the confirmation screen describes what will be deleted', () => {
  const rows = deletionSummaryRows(COUNTS);
  assert.ok(rows.some((row) => row.label === 'shifts' && row.count === 24));
  assert.ok(rows.some((row) => row.label === 'paycheque comparisons' && row.count === 2));
  assert.ok(rows.every((row) => row.count > 0), 'empty categories are hidden');
  assert.equal(totalJobRows(COUNTS), 24 + 24 + 1 + 2 + 3 + 2 + 2 + 4);
});

test('permanent deletion requires the typed confirmation word', () => {
  assert.equal(deletionConfirmationSatisfied('DELETE'), true);
  assert.equal(deletionConfirmationSatisfied('  delete '), true);
  assert.equal(deletionConfirmationSatisfied('delete it'), false);
  assert.equal(deletionConfirmationSatisfied(''), false);
});

test('deletion cancels the job\'s reminders and reports what it removed', async () => {
  const calls: string[] = [];
  const port: JobDeletionPort = {
    countData: async () => COUNTS,
    cancelReminders: async () => {
      calls.push('cancelReminders');
      return 2;
    },
    deleteJob: async () => {
      calls.push('deleteJob');
    },
  };
  const result = await runJobDeletion(port, 'job-a');
  assert.equal(result.status, 'deleted');
  if (result.status === 'deleted') {
    assert.equal(result.cancelledReminders, 2);
    assert.equal(result.counts.shifts, 24);
    assert.equal(result.remindersFailed, false);
  }
  assert.deepEqual(calls, ['cancelReminders', 'deleteJob']);
});

test('a failed delete is reported as rolled back and nothing is half-deleted', async () => {
  const port: JobDeletionPort = {
    countData: async () => COUNTS,
    cancelReminders: async () => 0,
    deleteJob: async () => {
      throw new Error('database is locked');
    },
  };
  const result = await runJobDeletion(port, 'job-a');
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.rolledBack, true);
    assert.match(result.reason, /database is locked/);
  }
});

test('a reminder failure never blocks deleting the data', async () => {
  let deleted = false;
  const port: JobDeletionPort = {
    countData: async () => COUNTS,
    cancelReminders: async () => {
      throw new Error('notification service unavailable');
    },
    deleteJob: async () => {
      deleted = true;
    },
  };
  const result = await runJobDeletion(port, 'job-a');
  assert.equal(result.status, 'deleted');
  assert.equal(deleted, true);
  if (result.status === 'deleted') assert.equal(result.remindersFailed, true);
});

test('a counting failure aborts before anything is deleted', async () => {
  let deleted = false;
  const port: JobDeletionPort = {
    countData: async () => {
      throw new Error('could not read job data');
    },
    cancelReminders: async () => 0,
    deleteJob: async () => {
      deleted = true;
    },
  };
  const result = await runJobDeletion(port, 'job-a');
  assert.equal(result.status, 'failed');
  assert.equal(deleted, false);
});

// ---------------------------------------------------------------------------
// 6. Cache invalidation: edits and deletions take effect immediately
// ---------------------------------------------------------------------------

test('editing a job changes the calculation key, so Home recalculates immediately', () => {
  const base = {
    jobId: 'job-a',
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    today: TODAY,
    shiftsFingerprint: '3.abc',
  };
  const before = calculationCacheKey({ ...base, jobUpdatedAt: '2026-10-20T10:00:00.000Z' });
  const afterRate = calculationCacheKey({ ...base, jobUpdatedAt: '2026-10-20T10:05:00.000Z' });
  const afterSchedule = calculationCacheKey({ ...base, jobUpdatedAt: '2026-10-20T10:09:00.000Z' });
  assert.notEqual(afterRate, before, 'a rate edit is a cache miss');
  assert.notEqual(afterSchedule, before, 'a schedule edit is a cache miss');
  assert.equal(calculationCacheKey({ ...base, jobUpdatedAt: '2026-10-20T10:00:00.000Z' }), before, 'an unchanged job still hits the cache');
  // Deleting the job removes its shifts too, which changes the fingerprint.
  const afterDelete = calculationCacheKey({ ...base, shiftsFingerprint: '0.', jobUpdatedAt: '2026-10-20T10:10:00.000Z' });
  assert.notEqual(afterDelete, before);
});

// ---------------------------------------------------------------------------
// 7. Schema + backup compatibility
// ---------------------------------------------------------------------------

test('the settings-change log is part of the schema and the health check', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(MIGRATIONS.length, 2, 'migration 2 is additive; nothing is dropped');
  assert.ok(MIGRATIONS[1].includes('job_setting_changes'));
  assert.ok((EXPECTED_TABLES as readonly string[]).includes('job_setting_changes'));
});
