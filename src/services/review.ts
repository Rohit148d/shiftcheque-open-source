/**
 * In-app review prompt (spec 81).
 *
 * The app only ever asks after a genuinely good moment, and never after ads,
 * errors, a pay discrepancy or a billing problem. The decision is a pure
 * function so it can be tested, and the native Play review API is used when the
 * module is present.
 */
export type ReviewEligibilityInput = {
  installedAtMs: number;
  now: number;
  shiftsSaved: number;
  completedPositiveAction: boolean;
  daysSinceCrash: number | null;
  daysSinceDiscrepancy: number | null;
  daysSincePurchaseFailure: number | null;
  lastPromptedAtMs: number | null;
  promptCount: number;
};

export type ReviewDecision = { eligible: boolean; reason: string };

export function reviewEligibility(input: ReviewEligibilityInput): ReviewDecision {
  const daysInstalled = (input.now - input.installedAtMs) / 86_400_000;
  if (daysInstalled < 7) return { eligible: false, reason: 'too_new' };
  if (input.shiftsSaved < 10) return { eligible: false, reason: 'not_enough_shifts' };
  if (!input.completedPositiveAction) return { eligible: false, reason: 'no_positive_action' };
  if (input.promptCount >= 3) return { eligible: false, reason: 'already_asked' };
  if (input.lastPromptedAtMs !== null && input.now - input.lastPromptedAtMs < 120 * 86_400_000) {
    return { eligible: false, reason: 'asked_recently' };
  }
  if (input.daysSinceCrash !== null && input.daysSinceCrash < 7) return { eligible: false, reason: 'recent_crash' };
  if (input.daysSinceDiscrepancy !== null && input.daysSinceDiscrepancy < 14) {
    return { eligible: false, reason: 'recent_discrepancy' };
  }
  if (input.daysSincePurchaseFailure !== null && input.daysSincePurchaseFailure < 14) {
    return { eligible: false, reason: 'recent_purchase_failure' };
  }
  return { eligible: true, reason: 'eligible' };
}

/** Opens the native in-app review flow; silently does nothing if unavailable. */
export async function requestInAppReview(): Promise<boolean> {
  try {
    // Lazily required so the app runs even when the module is not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storeReview = require('expo-store-review') as {
      hasAction?: () => Promise<boolean>;
      requestReview?: () => Promise<void>;
    };
    if (typeof storeReview?.hasAction !== 'function' || typeof storeReview?.requestReview !== 'function') return false;
    if (!(await storeReview.hasAction())) return false;
    await storeReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
