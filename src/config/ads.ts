import { FORBIDDEN_AD_ROUTES } from './monetization.ts';

/**
 * Pure, testable advertising eligibility rules.
 *
 * The rule of the product: advertising may fund the free tier, but it must
 * never touch onboarding, pay entry, cheque checking or any moment where the
 * user is looking at a number they care about.
 */

export type AdEligibilityInput = {
  /** Monetization config (bundled defaults, possibly refreshed remotely). */
  adsEnabled: boolean;
  bannerEnabled: boolean;
  interstitialEnabled: boolean;
  rewardedEnabled: boolean;
  /** User state. */
  onboarded: boolean;
  shiftsRecorded: number;
  payEstimateViewed: boolean;
  firstUseAt: number | null;
  now: number;
  isPro: boolean;
  /** Session accounting. */
  meaningfulSessions: number;
  interstitialCount7d: number;
  lastInterstitialAt: number | null;
  rewardedUsedToday: number;
  /** Gates. */
  minShiftsForAds: number;
  minDaysSinceInstallForAds: number;
  interstitialMinHours: number;
  interstitialMax7d: number;
  minimumSessionsBeforeInterstitial: number;
  rewardedDailyCap: number;
  /** Current route for placement rules. */
  route?: string;
};

export type AdEligibility = {
  /** Any ad at all (banners included). */
  anyAds: boolean;
  banner: boolean;
  interstitial: boolean;
  rewarded: boolean;
  /** Human-readable reason, useful for diagnostics (never financial data). */
  reason: string;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function isForbiddenAdRoute(route: string | undefined): boolean {
  if (!route) return false;
  return FORBIDDEN_AD_ROUTES.some((forbidden) => route === forbidden || route.startsWith(`${forbidden}/`));
}

/**
 * Global activation gate (spec 66). Until this passes, no ads of any kind are
 * shown, including rewarded placements the user might request.
 */
export function adsActivated(input: AdEligibilityInput): { allowed: boolean; reason: string } {
  if (input.isPro) return { allowed: false, reason: 'pro' };
  if (!input.adsEnabled) return { allowed: false, reason: 'disabled_by_config' };
  if (!input.onboarded) return { allowed: false, reason: 'onboarding_incomplete' };
  if (input.shiftsRecorded < input.minShiftsForAds) return { allowed: false, reason: 'not_enough_shifts' };
  if (!input.payEstimateViewed) return { allowed: false, reason: 'no_pay_estimate_viewed' };
  if (input.firstUseAt === null) return { allowed: false, reason: 'no_first_use' };
  const elapsed = input.now - input.firstUseAt;
  if (elapsed < input.minDaysSinceInstallForAds * DAY_MS) {
    return { allowed: false, reason: 'too_soon_after_install' };
  }
  return { allowed: true, reason: 'activated' };
}

export function canShowBanner(input: AdEligibilityInput): boolean {
  const gate = adsActivated(input);
  if (!gate.allowed) return false;
  if (!input.bannerEnabled) return false;
  if (isForbiddenAdRoute(input.route)) return false;
  return true;
}

export function canShowInterstitial(input: AdEligibilityInput): boolean {
  const gate = adsActivated(input);
  if (!gate.allowed) return false;
  if (!input.interstitialEnabled) return false;
  if (isForbiddenAdRoute(input.route)) return false;
  if (input.meaningfulSessions < input.minimumSessionsBeforeInterstitial) return false;
  if (input.interstitialCount7d >= input.interstitialMax7d) return false;
  if (input.lastInterstitialAt !== null) {
    const hours = (input.now - input.lastInterstitialAt) / HOUR_MS;
    if (hours < input.interstitialMinHours) return false;
  }
  return true;
}

export function canUseRewarded(input: AdEligibilityInput): boolean {
  const gate = adsActivated(input);
  if (!gate.allowed) return false;
  if (!input.rewardedEnabled) return false;
  if (input.rewardedUsedToday >= input.rewardedDailyCap) return false;
  return true;
}

export function evaluateAdEligibility(input: AdEligibilityInput): AdEligibility {
  const gate = adsActivated(input);
  return {
    anyAds: gate.allowed,
    banner: canShowBanner(input),
    interstitial: canShowInterstitial(input),
    rewarded: canUseRewarded(input),
    reason: gate.reason,
  };
}

/** Privacy setting for the Android home-screen widget (spec 57). */
export type WidgetPrivacy = 'show_amounts' | 'hide_amounts';
