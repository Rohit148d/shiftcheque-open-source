/**
 * Privacy-conscious analytics + crash reporting (spec 79/80).
 *
 * Design rules enforced in code:
 *   - the allow-list below is the ONLY set of events that can be sent
 *   - event properties are never accepted, so a wage cannot leak by accident
 *   - nothing is sent unless an endpoint is configured
 *   - the queue is bounded, local and cleared on demand
 */
import { ANALYTICS_APP_TAG, BRAND } from '../config/brand.ts';
import { ANALYTICS_ENDPOINT, CRASH_REPORTING_ENDPOINT } from '../config/flags.ts';

export const ANALYTICS_EVENTS = [
  'onboarding_started',
  'onboarding_completed',
  'goal_selected',
  'job_created',
  'shift_added',
  'shift_confirmed',
  'pay_estimate_viewed',
  'pay_breakdown_viewed',
  'overtime_radar_viewed',
  'extra_shift_used',
  'cheque_check_started',
  'cheque_check_completed',
  'paywall_viewed',
  'purchase_started',
  'purchase_completed',
  'purchase_failed',
  'restore_completed',
  'rewarded_ad_requested',
  'rewarded_ad_completed',
  'banner_impression_state',
  'interstitial_state',
  'backup_created',
  'review_prompt_eligible',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type QueuedEvent = {
  event: AnalyticsEvent;
  /** Coarse platform bucket only — never anything about pay. */
  platform: 'android' | 'ios' | 'other';
  at: string;
};

const MAX_QUEUE = 200;
let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function platformBucket(): QueuedEvent['platform'] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS === 'android') return 'android';
    if (Platform.OS === 'ios') return 'ios';
    return 'other';
  } catch {
    return 'other';
  }
}

export function track(event: AnalyticsEvent): void {
  if (!ANALYTICS_EVENTS.includes(event)) return;
  if (!ANALYTICS_ENDPOINT) return;
  queue.push({ event, platform: platformBucket(), at: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 10_000);
}

export async function flush(): Promise<void> {
  if (!ANALYTICS_ENDPOINT || queue.length === 0) return;
  const batch = queue.slice();
  queue = [];
  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: ANALYTICS_APP_TAG, version: BRAND.SHORT_NAME, events: batch }),
    });
  } catch {
    // Keep the events for the next attempt, newest first.
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  }
}

export function pendingEventCount(): number {
  return queue.length;
}

export function clearQueue(): void {
  queue = [];
}

/**
 * Crash reporting. Only a sanitised message reaches the endpoint: numbers that
 * look like money are stripped, because a crash log must never contain pay.
 */
export function reportError(error: unknown, context: string): void {
  if (!CRASH_REPORTING_ENDPOINT) return;
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const sanitized = raw
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, 'email')
    .slice(0, 400);
  void fetch(CRASH_REPORTING_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app: ANALYTICS_APP_TAG, context, message: sanitized, at: new Date().toISOString() }),
  }).catch(() => undefined);
}
