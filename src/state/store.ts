/**
 * Application state (spec 90).
 *
 * The store is a thin, predictable layer over the repositories. Heavy pay
 * calculations live in `state/selectors.ts` behind a memo cache so the Home
 * screen never recomputes payroll on every render (spec 88).
 */
import { create } from 'zustand';

import { BRAND } from '../config/brand.ts';
import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from '../config/monetization.ts';
import type { DeductionProfile, Job, RateRecord, Shift } from '../core/types.ts';
import { addDays, startOfWeek } from '../core/tz.ts';
import {
  AdStateRepository,
  JobRepository,
  JobSettingChangeRepository,
  ProfileRepository,
  SettingsRepository,
  ShiftRepository,
} from '../db/repositories.ts';
import { nextActiveJobId, runJobDeletion, type JobDeletionResult } from '../core/jobChanges.ts';
import { cancelJobReminders } from '../services/notifications.ts';
import { clearCalculationCache } from './calculationCacheStore.ts';
import { cachedEntitlement, refreshEntitlement, type EntitlementState } from '../services/billing.ts';
import { loadMonetizationConfig, loadRuleBundle } from '../services/ruleUpdates.ts';
import { BUNDLED_RULE_BUNDLE } from '../rules/bundle.ts';
import type { RuleBundle } from '../rules/types.ts';
import type { LockTimeout } from '../services/applock.ts';
import type { WidgetPrivacy } from '../config/ads.ts';
import type { NotificationCategory } from '../services/notifications.ts';

export type AppSettings = {
  onboarded: boolean;
  onboardedAt: string | null;
  /**
   * Explore mode: the user chose "Explore first" on the welcome screen. The real
   * app opens with empty states, no job exists, no payroll is calculated, ads
   * stay off (the activation gate requires `onboarded`) and onboarding can still
   * be completed later.
   */
  exploreMode: boolean;
  installedAt: number;
  language: 'en-CA' | 'fr-CA' | 'system';
  themeId: string;
  followSystemTheme: boolean;
  appLockEnabled: boolean;
  appLockTimeout: LockTimeout;
  notifications: Partial<Record<NotificationCategory, boolean>>;
  notificationPromptAnswered: boolean;
  widgetPrivacy: WidgetPrivacy;
  reviewPromptCount: number;
  lastReviewPromptAt: number | null;
  paywallSeenCount: number;
  lastActiveAt: number;
  crashFreeStreakDays: number | null;
  lastDiscrepancyAt: number | null;
  lastPurchaseFailureAt: number | null;
  tipsTrackingEnabled: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  onboardedAt: null,
  exploreMode: false,
  installedAt: 0,
  language: 'en-CA',
  themeId: BRAND.ACCENT_THEME,
  followSystemTheme: true,
  appLockEnabled: false,
  appLockTimeout: '1_minute',
  notifications: {},
  notificationPromptAnswered: false,
  widgetPrivacy: 'hide_amounts',
  reviewPromptCount: 0,
  lastReviewPromptAt: null,
  paywallSeenCount: 0,
  lastActiveAt: 0,
  crashFreeStreakDays: null,
  lastDiscrepancyAt: null,
  lastPurchaseFailureAt: null,
  tipsTrackingEnabled: false,
};

const SETTINGS_KEY = 'settings';

export type DataSnapshot = {
  jobs: Job[];
  rates: Record<string, RateRecord[]>;
  profiles: Record<string, DeductionProfile>;
};

export type SettingChangeLogInput = {
  setting: string;
  effectiveFrom: string;
  previousValueJson: string | null;
  newValueJson: string;
  correction: boolean;
  note?: string;
};

export type AppState = {
  ready: boolean;
  loadError: string | null;
  settings: AppSettings;
  jobs: Job[];
  rates: Record<string, RateRecord[]>;
  profiles: Record<string, DeductionProfile>;
  shifts: Shift[];
  activeJobId: string | null;
  entitlement: EntitlementState;
  monetization: MonetizationConfig;
  ruleBundle: RuleBundle;
  ruleSource: 'bundled' | 'cache' | 'remote';
  /** Bumped whenever data changes so memoised calculations invalidate. */
  dataVersion: number;
  /** The local date the UI treats as "today" (kept in state for testability). */
  today: string;

  initialize(): Promise<void>;
  reload(): Promise<void>;
  setToday(date: string): void;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  setActiveJob(jobId: string | null): Promise<void>;
  saveJob(job: Job, options?: { makeActive?: boolean }): Promise<void>;
  removeJob(jobId: string): Promise<void>;
  /** Hides a job from shift creation while keeping every record it has. */
  archiveJob(jobId: string): Promise<void>;
  /** Brings an archived job back, making it active if nothing else is. */
  restoreArchivedJob(jobId: string): Promise<void>;
  /** Permanent, transactional deletion of a job and everything scoped to it. */
  deleteJobPermanently(jobId: string): Promise<JobDeletionResult>;
  /** Replaces the whole rate history in one transaction (used by rate changes). */
  replaceJobRates(jobId: string, rates: RateRecord[], log?: SettingChangeLogInput): Promise<void>;
  recordSettingChange(change: SettingChangeLogInput & { jobId: string }): Promise<void>;
  addRate(rate: RateRecord): Promise<void>;
  saveProfile(profile: DeductionProfile): Promise<void>;
  saveShift(shift: Shift): Promise<void>;
  saveShifts(shifts: Shift[]): Promise<void>;
  deleteShift(shiftId: string): Promise<void>;
  refreshEntitlementState(): Promise<void>;
  bumpSessions(): Promise<void>;
};

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function loadSettings(): Promise<AppSettings> {
  const raw = await SettingsRepository.get(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS, installedAt: Date.now() };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS, installedAt: Date.now() };
  }
}

export const useAppStore = create<AppState>()((set, get) => ({
  ready: false,
  loadError: null,
  settings: DEFAULT_SETTINGS,
  jobs: [],
  rates: {},
  profiles: {},
  shifts: [],
  activeJobId: null,
  entitlement: { isPro: false, source: 'fallback', expiresAt: null, productId: null, billingAvailable: false },
  monetization: DEFAULT_MONETIZATION_CONFIG,
  ruleBundle: BUNDLED_RULE_BUNDLE,
  ruleSource: 'bundled',
  dataVersion: 0,
  today: todayKey(),

  async initialize() {
    try {
      const settings = await loadSettings();
      const jobs = await JobRepository.list();
      const rates: Record<string, RateRecord[]> = {};
      const profiles: Record<string, DeductionProfile> = {};
      for (const job of jobs) {
        rates[job.id] = await JobRepository.listRates(job.id);
        const profile = await ProfileRepository.get(job.id);
        if (profile) profiles[job.id] = profile;
      }
      const shifts = await ShiftRepository.listAll();
      const entitlement = await cachedEntitlement();
      let monetization = DEFAULT_MONETIZATION_CONFIG;
      let ruleBundle = BUNDLED_RULE_BUNDLE;
      let ruleSource: AppState['ruleSource'] = 'bundled';
      try {
        const rules = await loadRuleBundle();
        ruleBundle = rules.bundle;
        ruleSource = rules.source;
      } catch {
        // bundled rules are always available
      }
      try {
        const loaded = await loadMonetizationConfig();
        monetization = loaded.config;
      } catch {
        monetization = DEFAULT_MONETIZATION_CONFIG;
      }
      const activeJobId = jobs.find((job) => !job.archived)?.id ?? null;
      set({
        ready: true,
        settings,
        jobs,
        rates,
        profiles,
        shifts,
        activeJobId,
        entitlement,
        monetization,
        ruleBundle,
        ruleSource,
        dataVersion: get().dataVersion + 1,
      });
    } catch (error) {
      set({
        ready: true,
        loadError: error instanceof Error ? error.message : 'Could not open your data.',
      });
    }
  },

  async reload() {
    const jobs = await JobRepository.list();
    const rates: Record<string, RateRecord[]> = {};
    const profiles: Record<string, DeductionProfile> = {};
    for (const job of jobs) {
      rates[job.id] = await JobRepository.listRates(job.id);
      const profile = await ProfileRepository.get(job.id);
      if (profile) profiles[job.id] = profile;
    }
    const shifts = await ShiftRepository.listAll();
    set({ jobs, rates, profiles, shifts, dataVersion: get().dataVersion + 1 });
  },

  setToday(date) {
    if (date !== get().today) set({ today: date, dataVersion: get().dataVersion + 1 });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch, lastActiveAt: Date.now() };
    set({ settings: next });
    await SettingsRepository.set(SETTINGS_KEY, JSON.stringify(next));
  },

  async setActiveJob(jobId) {
    set({ activeJobId: jobId });
    await SettingsRepository.set('activeJobId', jobId ?? '');
  },

  async saveJob(job, options) {
    await JobRepository.save(job);
    if (options?.makeActive !== false && !get().activeJobId) {
      await get().setActiveJob(job.id);
    }
    await get().reload();
  },

  async removeJob(jobId) {
    await JobRepository.remove(jobId);
    const remaining = get().jobs.filter((job) => job.id !== jobId);
    if (get().activeJobId === jobId) {
      await get().setActiveJob(nextActiveJobId(remaining, jobId));
    }
    clearCalculationCache();
    await get().reload();
  },

  async archiveJob(jobId) {
    await JobRepository.setArchived(jobId, true);
    await cancelJobReminders(jobId);
    const remaining = get().jobs.map((job) => (job.id === jobId ? { ...job, archived: true } : job));
    if (get().activeJobId === jobId) {
      await get().setActiveJob(nextActiveJobId(remaining, jobId));
    }
    clearCalculationCache();
    await get().reload();
  },

  async restoreArchivedJob(jobId) {
    await JobRepository.setArchived(jobId, false);
    if (!get().activeJobId) await get().setActiveJob(jobId);
    clearCalculationCache();
    await get().reload();
  },

  async deleteJobPermanently(jobId) {
    const result = await runJobDeletion(
      {
        countData: (id) => JobRepository.countData(id),
        cancelReminders: (id) => cancelJobReminders(id),
        deleteJob: (id) => JobRepository.deleteJob(id),
      },
      jobId,
    );
    if (result.status === 'deleted') {
      const remaining = get().jobs.filter((job) => job.id !== jobId);
      if (get().activeJobId === jobId) {
        await get().setActiveJob(nextActiveJobId(remaining, jobId));
      }
      clearCalculationCache();
      await get().reload();
    }
    return result;
  },

  async replaceJobRates(jobId, rates, log) {
    await JobRepository.replaceRates(jobId, rates);
    if (log) await get().recordSettingChange({ ...log, jobId });
    clearCalculationCache();
    await get().reload();
  },

  async recordSettingChange(change) {
    await JobSettingChangeRepository.add({
      id: `change-${change.jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      jobId: change.jobId,
      setting: change.setting,
      effectiveFrom: change.effectiveFrom,
      previousValueJson: change.previousValueJson,
      newValueJson: change.newValueJson,
      correction: change.correction,
      note: change.note ?? null,
    });
  },

  async addRate(rate) {
    await JobRepository.addRate(rate);
    await get().reload();
  },

  async saveProfile(profile) {
    await ProfileRepository.save(profile);
    await get().reload();
  },

  async saveShift(shift) {
    await ShiftRepository.save(shift);
    set({ shifts: [shift, ...get().shifts.filter((existing) => existing.id !== shift.id)], dataVersion: get().dataVersion + 1 });
  },

  async saveShifts(shifts) {
    await ShiftRepository.saveMany(shifts);
    await get().reload();
  },

  async deleteShift(shiftId) {
    await ShiftRepository.remove(shiftId);
    set({ shifts: get().shifts.filter((shift) => shift.id !== shiftId), dataVersion: get().dataVersion + 1 });
  },

  async refreshEntitlementState() {
    const entitlement = await refreshEntitlement();
    set({ entitlement });
  },

  async bumpSessions() {
    const state = await AdStateRepository.get();
    await AdStateRepository.save({ ...state, meaningfulSessions: state.meaningfulSessions + 1 });
  },
}));

/** Shifts for a job inside a window, from the in-memory snapshot. */
export function shiftsInWindow(state: Pick<AppState, 'shifts'>, jobId: string, from: string, to: string): Shift[] {
  return state.shifts.filter((shift) => shift.jobId === jobId && shift.date >= from && shift.date <= to);
}

/** Convenience: the pay-period window plus the work-week buffer. */
export function shiftLoadWindow(state: Pick<AppState, 'shifts' | 'jobs'>, jobId: string, date: string): { from: string; to: string } {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  const weekStart = job ? startOfWeek(date, job.workWeek.startsOn) : date;
  return { from: addDays(weekStart, -21), to: addDays(weekStart, 42) };
}
