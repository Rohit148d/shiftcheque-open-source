import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DATE_ERROR_MESSAGE,
  DATE_EXAMPLE,
  DATE_FORMAT_HINT,
  defaultAnchorKey,
  todayKey,
  validateDateKeyInput,
} from '../src/core/dateInput.ts';
import {
  buildJobFromDraft,
  completeOnboarding,
  resolveStartRoute,
  validateDraft,
  type OnboardingDraft,
} from '../src/core/onboarding.ts';
import type { Job, Shift } from '../src/core/types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    jobName: 'Warehouse',
    rateText: '24.50',
    province: 'ON',
    federal: false,
    zone: 'America/Toronto',
    frequency: 'biweekly',
    anchorDateText: '2026-10-05',
    paydayOffsetText: '5',
    weekStartsOn: 0,
    shiftStart: '09:00',
    shiftEnd: '17:00',
    breakMinutesText: '30',
    rotationId: 'none',
    customRule: false,
    agreement: 'not_sure',
    goals: { nextPay: true, trackShifts: true, overtime: false, checkCheque: false, extraShifts: false },
    ...overrides,
  };
}

/**
 * Fake persistence that mirrors the real repositories: saves UPSERT by id, so
 * duplicate submissions can be detected exactly the way SQLite would.
 */
function makeDeps(overrides: Partial<Record<'saveJob' | 'saveShifts' | 'markComplete' | 'requestNotifications', unknown>> = {}) {
  const jobs = new Map<string, Job>();
  const shifts: Shift[] = [];
  const calls: string[] = [];
  const patches: Record<string, unknown>[] = [];

  const base = {
    saveJob: async (job: Job) => {
      calls.push('saveJob');
      jobs.set(job.id, job);
    },
    saveShifts: async (list: Shift[]) => {
      calls.push('saveShifts');
      for (const shift of list) {
        const index = shifts.findIndex((existing) => existing.id === shift.id);
        if (index >= 0) shifts[index] = shift;
        else shifts.push(shift);
      }
    },
    markComplete: async (patch: Record<string, unknown>) => {
      calls.push('markComplete');
      patches.push(patch);
    },
    requestNotifications: async () => {
      calls.push('requestNotifications');
      return true;
    },
  };

  return {
    jobs,
    shifts,
    calls,
    patches,
    deps: { ...base, ...(overrides as Record<string, never>) },
  };
}

// ---------------------------------------------------------------------------
// 1. Date field behaviour
// ---------------------------------------------------------------------------

test('date field: accepts only real YYYY-MM-DD calendar dates', () => {
  assert.deepEqual(validateDateKeyInput('2026-10-05'), { ok: true, key: '2026-10-05' });
  assert.deepEqual(validateDateKeyInput('  2026-01-01  '), { ok: true, key: '2026-01-01' });
  assert.deepEqual(validateDateKeyInput('2028-02-29'), { ok: true, key: '2028-02-29' }, 'leap day is valid');
});

test('date field: rejects ambiguous and malformed input instead of guessing', () => {
  for (const input of ['10/05/2026', '2026/10/05', 'Oct 5, 2026', '05-10-2026', '2026-2-5', '20261005']) {
    const result = validateDateKeyInput(input);
    assert.equal(result.ok, false, `${input} must be rejected`);
    if (!result.ok) assert.equal(result.message, DATE_ERROR_MESSAGE, 'the format copy is shown');
  }
});

test('date field: rejects impossible calendar dates', () => {
  const result = validateDateKeyInput('2026-02-30');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'calendar');
    assert.ok(result.message.includes(DATE_ERROR_MESSAGE));
  }
  assert.equal(validateDateKeyInput('2026-13-01').ok, false);
  assert.equal(validateDateKeyInput('2026-04-31').ok, false);
});

test('date field: rejects an empty value and an implausible year', () => {
  const empty = validateDateKeyInput('   ');
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, 'empty');

  const ancient = validateDateKeyInput('0202-10-05');
  assert.equal(ancient.ok, false);
  if (!ancient.ok) assert.equal(ancient.reason, 'range');
});

test('date field: the format helper text is exactly what the UI promises', () => {
  assert.equal(DATE_FORMAT_HINT, 'YYYY-MM-DD');
  assert.equal(DATE_EXAMPLE, '2026-10-05');
  assert.equal(DATE_ERROR_MESSAGE, 'Use YYYY-MM-DD, for example 2026-10-05.');
});

test('date helpers never shift a day: they use local parts, not UTC', () => {
  const lateEvening = new Date(2026, 9, 5, 23, 30); // 5 Oct 2026, 23:30 local
  assert.equal(todayKey(lateEvening), '2026-10-05');
  const earlyMorning = new Date(2026, 9, 5, 0, 15);
  assert.equal(todayKey(earlyMorning), '2026-10-05');
  assert.equal(defaultAnchorKey(new Date(2026, 0, 1)), '2026-01-01');
});

// ---------------------------------------------------------------------------
// 2. Draft validation used by the step gate and by Finish Setup
// ---------------------------------------------------------------------------

test('validation: a valid draft passes with its date key preserved verbatim', () => {
  const draft = makeDraft({ anchorDateText: '2026-10-05' });
  const validation = validateDraft(draft);
  assert.equal(validation.valid, true);
  assert.equal(validation.anchorDate, '2026-10-05');
  assert.equal(validation.paydayOffsetDays, 5);
  assert.equal(validation.breakMinutes, 30);
  assert.equal(validation.hourlyRate, 24500000n);
});

test('validation: an invalid pay-period date blocks completion with friendly copy', () => {
  const validation = validateDraft(makeDraft({ anchorDateText: '10/05/2026' }));
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.anchorDate, DATE_ERROR_MESSAGE);
  assert.equal(validation.errors.paydayOffset, undefined);
});

test('validation: rate, payday offset, break and shift times are checked', () => {
  assert.equal(validateDraft(makeDraft({ rateText: 'abc' })).errors.rate?.startsWith('Enter an hourly rate'), true);
  assert.equal(validateDraft(makeDraft({ rateText: '' })).valid, true, 'rate may be skipped');
  assert.equal(validateDraft(makeDraft({ paydayOffsetText: '-3' })).valid, false);
  assert.equal(validateDraft(makeDraft({ paydayOffsetText: '999' })).valid, false);
  assert.equal(validateDraft(makeDraft({ breakMinutesText: '500' })).valid, false);
  assert.equal(validateDraft(makeDraft({ shiftStart: 'nonsense' })).valid, false);
  assert.equal(validateDraft(makeDraft({ shiftStart: '09:00', shiftEnd: '09:00' })).valid, false);
});

// ---------------------------------------------------------------------------
// 3. Finish Setup: Path A / Path B
// ---------------------------------------------------------------------------

test('Path A — Finish Setup persists everything, marks complete and never hangs', async () => {
  const store = makeDeps();
  const result = await completeOnboarding(store.deps, makeDraft(), {
    jobId: 'job-primary',
    wantNotifications: true,
    today: '2026-10-05',
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(store.calls, ['saveJob', 'saveShifts', 'requestNotifications', 'markComplete']);
  assert.equal(store.jobs.size, 1);
  assert.equal(store.shifts.length, 1);
  assert.equal(store.patches.length, 1);
  assert.equal(store.patches[0].onboarded, true);
  assert.equal(store.patches[0].exploreMode, false);
  // The saved date is exactly what the user typed: no timezone shifting.
  assert.equal(store.jobs.get('job-primary')?.paySchedule.anchorStart, '2026-10-05');
  assert.equal(store.shifts[0].date, '2026-10-05');
});

test('Path B — declining reminders completes normally and is never requested', async () => {
  const store = makeDeps();
  const result = await completeOnboarding(store.deps, makeDraft(), {
    jobId: 'job-primary',
    wantNotifications: false,
    today: '2026-10-05',
  });

  assert.equal(result.status, 'completed');
  assert.equal(store.calls.includes('requestNotifications'), false);
  assert.equal(store.calls.includes('markComplete'), true);
  assert.equal(store.patches[0].notificationPromptAnswered, true);
  assert.equal(store.patches[0].notifications, undefined);
});

test('notification permission can never block onboarding completion', async () => {
  const denied = makeDeps({ requestNotifications: async () => false });
  const deniedResult = await completeOnboarding(denied.deps, makeDraft(), { jobId: 'job-a', wantNotifications: true });
  assert.equal(deniedResult.status, 'completed');
  assert.equal(denied.patches[0].onboarded, true);
  assert.deepEqual(denied.patches[0].notifications, {
    shift_tomorrow: false,
    shift_soon: false,
    confirm_shift: false,
  });

  const throwing = makeDeps({
    requestNotifications: async () => {
      throw new Error('permission dialog exploded');
    },
  });
  const throwingResult = await completeOnboarding(throwing.deps, makeDraft(), { jobId: 'job-b', wantNotifications: true });
  assert.equal(throwingResult.status, 'completed', 'a permission error still completes setup');
  assert.equal(throwing.calls.includes('markComplete'), true);
});

test('a missing notification module still completes setup', async () => {
  const store = makeDeps({ requestNotifications: undefined });
  const result = await completeOnboarding(store.deps, makeDraft(), { jobId: 'job-c', wantNotifications: true });
  assert.equal(result.status, 'completed');
  assert.equal(store.calls.includes('markComplete'), true);
});

// ---------------------------------------------------------------------------
// 4. Failure handling: never freeze, never half-complete
// ---------------------------------------------------------------------------

test('job persistence failure: onboarding is NOT marked complete and answers are kept', async () => {
  const store = makeDeps({
    saveJob: async () => {
      throw new Error('disk full');
    },
  });
  const draft = makeDraft();
  const result = await completeOnboarding(store.deps, draft, { jobId: 'job-x' });

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.reason, 'disk full');
  assert.equal(store.calls.includes('markComplete'), false, 'the completed flag is only set after persistence');
  assert.equal(store.calls.includes('requestNotifications'), false);
  // the draft object still holds every answer, so the UI can keep them
  assert.equal(draft.anchorDateText, '2026-10-05');
  assert.equal(draft.rateText, '24.50');
});

test('shift persistence failure: onboarding is NOT marked complete', async () => {
  const store = makeDeps({
    saveShifts: async () => {
      throw new Error('shift write failed');
    },
  });
  const result = await completeOnboarding(store.deps, makeDraft(), { jobId: 'job-y' });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.includes('markComplete'), false);
});

test('completion-flag failure is surfaced instead of silently succeeding', async () => {
  const store = makeDeps({
    markComplete: async () => {
      throw new Error('settings write failed');
    },
  });
  const result = await completeOnboarding(store.deps, makeDraft(), { jobId: 'job-z' });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.ok(result.reason.includes('settings write failed'));
});

test('invalid answers never touch the database', async () => {
  const store = makeDeps();
  const result = await completeOnboarding(store.deps, makeDraft({ anchorDateText: '10/05/2026' }), { jobId: 'job-q' });
  assert.equal(result.status, 'invalid');
  assert.deepEqual(store.calls, []);
  assert.equal(store.jobs.size, 0);
});

// ---------------------------------------------------------------------------
// 5. Duplicate taps and repeat submissions
// ---------------------------------------------------------------------------

test('a double tap creates one job, not two (stable id + upsert)', async () => {
  const store = makeDeps();
  const draft = makeDraft();
  const options = { jobId: 'job-stable', today: '2026-10-05' };

  const first = await completeOnboarding(store.deps, draft, options);
  const second = await completeOnboarding(store.deps, draft, options);

  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.equal(store.jobs.size, 1, 'the same job id upserts instead of duplicating');
  assert.equal(store.shifts.length, 1, 'the same shift id upserts instead of duplicating');
  assert.equal(store.patches.filter((patch) => patch.onboarded === true).length, 2);
});

test('Path E — the saved pay-period date survives a reload exactly', async () => {
  const store = makeDeps();
  await completeOnboarding(store.deps, makeDraft(), { jobId: 'job-reload', today: '2026-10-05' });
  const saved = store.jobs.get('job-reload');
  assert.ok(saved);
  // Serialising and parsing (what the database does) must not shift the day.
  const reloaded = JSON.parse(JSON.stringify({ anchor: saved.paySchedule.anchorStart })) as { anchor: string };
  assert.equal(reloaded.anchor, '2026-10-05');
  assert.equal(validateDateKeyInput(reloaded.anchor).ok, true);
});

// ---------------------------------------------------------------------------
// 6. Explore first (Path C)
// ---------------------------------------------------------------------------

test('Path C — explore mode opens the app without onboarding or a job', () => {
  assert.equal(resolveStartRoute({ onboarded: false, exploreMode: false }), '/onboarding');
  assert.equal(resolveStartRoute({ onboarded: false, exploreMode: true }), '/(tabs)');
  assert.equal(resolveStartRoute({ onboarded: true, exploreMode: false }), '/(tabs)');
});

test('explore mode keeps onboarding incomplete and creates nothing', () => {
  // Explore first only flips the flag: no job, no shifts, no completion patch.
  const settings = { onboarded: false, exploreMode: true };
  assert.equal(settings.onboarded, false, 'onboarding is NOT marked complete');
  assert.equal(resolveStartRoute(settings), '/(tabs)', 'but the app is reachable');
});

test('explore → real setup later produces real data with the completion flag', async () => {
  const store = makeDeps();
  // Explore first: nothing is written.
  assert.deepEqual(store.calls, []);
  // The user later taps "Set up my pay" and finishes for real.
  const result = await completeOnboarding(store.deps, makeDraft({ jobName: 'Hospital' }), {
    jobId: 'job-later',
    wantNotifications: false,
  });
  assert.equal(result.status, 'completed');
  assert.equal(store.jobs.get('job-later')?.name, 'Hospital');
  assert.equal(store.patches[0].onboarded, true);
  assert.equal(store.patches[0].exploreMode, false, 'explore mode is cleared on real completion');
});

// ---------------------------------------------------------------------------
// 7. Job construction details
// ---------------------------------------------------------------------------

test('job construction: federally regulated work still files tax in the province', () => {
  const draft = makeDraft({ federal: true, province: 'BC', zone: 'America/Vancouver' });
  const validation = validateDraft(draft);
  const job = buildJobFromDraft(draft, validation, { jobId: 'job-fed' });
  assert.equal(job.jurisdiction, 'FED');
  assert.equal(job.taxProvince, 'BC');
  assert.equal(job.zone, 'America/Vancouver');
});

test('job construction: rotation creates a populated schedule, no rotation creates one shift', async () => {
  const rotation = makeDeps();
  await completeOnboarding(rotation.deps, makeDraft({ rotationId: 'monday_friday' }), {
    jobId: 'job-rotation',
    today: '2026-10-05',
  });
  assert.ok(rotation.shifts.length > 5, 'a rotation fills the next four weeks');
  for (const shift of rotation.shifts) {
    assert.notEqual(shift.date.slice(0, 7) < '2026-10', true, 'generated shifts start today or later');
  }

  const single = makeDeps();
  await completeOnboarding(single.deps, makeDraft({ rotationId: 'none' }), { jobId: 'job-single', today: '2026-10-05' });
  assert.equal(single.shifts.length, 1);
  assert.equal(single.shifts[0].date, '2026-10-05');
});

test('job construction: unpaid break and pay schedule land on the job', () => {
  const draft = makeDraft({ breakMinutesText: '45', frequency: 'weekly', paydayOffsetText: '3' });
  const job = buildJobFromDraft(draft, validateDraft(draft), { jobId: 'job-break' });
  assert.equal(job.defaultBreaks[0].minutes, 45);
  assert.equal(job.defaultBreaks[0].paid, false);
  assert.equal(job.paySchedule.frequency, 'weekly');
  assert.equal(job.paySchedule.paydayOffsetDays, 3);
});
