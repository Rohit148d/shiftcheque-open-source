/**
 * Notification service (spec 58/59).
 *
 * Categories are individually configurable, permission is only ever requested
 * AFTER the user has seen value, and every call is defensive: if permissions
 * are denied the app keeps working and simply stops scheduling.
 */
import { Platform } from 'react-native';

import { NOTIFICATION_CHANNEL_PREFIX } from '../../src/config/brand.ts';
import type { PayPeriod } from '../core/workweek.ts';
import type { Shift } from '../core/types.ts';

export type NotificationCategory =
  | 'shift_tomorrow'
  | 'shift_soon'
  | 'confirm_shift'
  | 'payday_tomorrow'
  | 'payday_today'
  | 'overtime_approaching'
  | 'weekly_summary';

export const NOTIFICATION_CATEGORIES: { id: NotificationCategory; defaultEnabled: boolean }[] = [
  { id: 'shift_tomorrow', defaultEnabled: true },
  { id: 'shift_soon', defaultEnabled: true },
  { id: 'confirm_shift', defaultEnabled: true },
  { id: 'payday_tomorrow', defaultEnabled: true },
  { id: 'payday_today', defaultEnabled: true },
  { id: 'overtime_approaching', defaultEnabled: true },
  { id: 'weekly_summary', defaultEnabled: false },
];

type NotificationsModule = typeof import('expo-notifications');

let module: NotificationsModule | null = null;
let handlerInstalled = false;

function load(): NotificationsModule | null {
  if (module) return module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-notifications') as NotificationsModule;
    module = loaded;
    return loaded;
  } catch {
    return null;
  }
}

export function notificationsSupported(): boolean {
  return load() !== null;
}

/** Installs the foreground handler exactly once. */
export function installNotificationHandler(): void {
  const notifications = load();
  if (!notifications || handlerInstalled) return;
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerInstalled = true;
  } catch {
    handlerInstalled = false;
  }
}

export async function ensureAndroidChannel(): Promise<void> {
  const notifications = load();
  if (!notifications || Platform.OS !== 'android') return;
  try {
    await notifications.setNotificationChannelAsync(`${NOTIFICATION_CHANNEL_PREFIX}-default`, {
      name: 'Pay shift reminders',
      importance: notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 120],
      lightColor: '#D52B1E',
    });
  } catch {
    // channel setup is best effort
  }
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  const notifications = load();
  if (!notifications) return 'unsupported';
  try {
    const settings = await notifications.getPermissionsAsync();
    if (settings.granted) return 'granted';
    return settings.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestPermission(): Promise<boolean> {
  const notifications = load();
  if (!notifications) return false;
  try {
    await ensureAndroidChannel();
    const result = await notifications.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

export type ReminderPlan = {
  category: NotificationCategory;
  title: string;
  body: string;
  fireAtMs: number;
  data?: Record<string, string>;
};

/** Computes the reminders a shift deserves (pure, testable). */
export function planShiftReminders(shift: Shift, options: { enabled: Record<string, boolean>; now: number }): ReminderPlan[] {
  const { enabled, now } = options;
  const plans: ReminderPlan[] = [];
  if (shift.type !== 'work' && shift.type !== 'training') return plans;
  const [year, month, day] = shift.date.split('-').map(Number);
  const [hour, minute] = shift.scheduledStart.split(':').map(Number);
  const startMs = Date.UTC(year, month - 1, day, hour, minute);
  // The engine stores wall-clock local times; reminders are relative to the
  // start instant in UTC terms which is accurate enough for scheduling.
  const tomorrow = startMs - 86_400_000;
    if (enabled.shift_tomorrow !== false && tomorrow > now) {
    plans.push({
      category: 'shift_tomorrow',
      title: 'Shift tomorrow',
      body: `${shift.scheduledStart} – ${shift.scheduledEnd}`,
      fireAtMs: tomorrow,
      data: { shiftId: shift.id, jobId: shift.jobId },
    });
  }
  const soon = startMs - 3_600_000;
  if (enabled.shift_soon !== false && soon > now) {
    plans.push({
      category: 'shift_soon',
      title: 'Shift in an hour',
      body: `${shift.scheduledStart} – ${shift.scheduledEnd}`,
      fireAtMs: soon,
      data: { shiftId: shift.id, jobId: shift.jobId },
    });
  }
  const confirm = startMs + (shift.scheduledOvernight ? 8 : 9) * 3_600_000;
  if (enabled.confirm_shift !== false && confirm > now) {
    plans.push({
      category: 'confirm_shift',
      title: 'How did your shift go?',
      body: 'Confirm it in one tap so your pay estimate stays accurate.',
      fireAtMs: confirm,
      data: { shiftId: shift.id, jobId: shift.jobId },
    });
  }
  return plans;
}

export interface ScheduledReminder {
  id: string;
  category: NotificationCategory;
}

export async function scheduleReminders(plans: ReminderPlan[]): Promise<ScheduledReminder[]> {
  const notifications = load();
  if (!notifications) return [];
  const scheduled: ScheduledReminder[] = [];
  for (const plan of plans) {
    try {
      const id = await notifications.scheduleNotificationAsync({
        content: {
          title: plan.title,
          body: plan.body,
          data: plan.data ?? {},
          sound: false,
        },
        trigger: {
          type: 'date',
          date: plan.fireAtMs,
          channelId: `${NOTIFICATION_CHANNEL_PREFIX}-default`,
        } as never,
      });
      scheduled.push({ id, category: plan.category });
    } catch {
      // ignore individual scheduling failures
    }
  }
  return scheduled;
}

export async function cancelAll(): Promise<void> {
  const notifications = load();
  if (!notifications) return;
  try {
    await notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}

/**
 * Cancels scheduled reminders that belong to one job (matched on the job id
 * carried in the notification data). Deletion and archiving use this so a
 * removed employer cannot keep nudging the user.
 */
export async function cancelJobReminders(jobId: string): Promise<number> {
  const notifications = load();
  if (!notifications) return 0;
  let cancelled = 0;
  try {
    const scheduled = await notifications.getAllScheduledNotificationsAsync();
    for (const entry of scheduled) {
      const data = (entry.content?.data ?? {}) as { jobId?: string };
      if (data.jobId !== jobId) continue;
      await notifications.cancelScheduledNotificationAsync(entry.identifier);
      cancelled += 1;
    }
  } catch {
    // A notification failure must never block deleting the underlying data.
  }
  return cancelled;
}

export function planPaydayReminders(period: PayPeriod, enabled: Record<string, boolean>): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  const [year, month, day] = period.payday.split('-').map(Number);
  const paydayMs = Date.UTC(year, month - 1, day, 9, 0);
  if (enabled.payday_tomorrow !== false) {
    plans.push({
      category: 'payday_tomorrow',
      title: 'Payday tomorrow',
      body: 'Your next pay lands tomorrow. Your estimate is ready to check.',
      fireAtMs: paydayMs - 86_400_000,
      data: { payday: period.payday },
    });
  }
  if (enabled.payday_today !== false) {
    plans.push({
      category: 'payday_today',
      title: 'Payday today',
      body: 'Check whether your pay matched the estimate.',
      fireAtMs: paydayMs,
      data: { payday: period.payday },
    });
  }
  return plans;
}

export function planOvertimeReminder(input: {
  remainingMinutes: number;
  thresholdMinutes: number;
  workWeekKey: string;
  enabled: boolean;
}): ReminderPlan | null {
  if (!input.enabled) return null;
  if (input.remainingMinutes <= 0 || input.remainingMinutes > 60) return null;
  return {
    category: 'overtime_approaching',
    title: 'You are close to your overtime threshold',
    body: `About ${Math.round(input.remainingMinutes / 60)} h before overtime this work week.`,
    fireAtMs: Date.now() + 30 * 60_000,
    data: { workWeek: input.workWeekKey },
  };
}
