/**
 * Remote-controllable monetization + ad policy defaults.
 *
 * These values are bundled, safe, and conservative. A remote JSON document
 * (validated with Zod, see services/remoteConfig.ts) may raise the limits later
 * without shipping an app update, but it can never turn on a placement that
 * would break the trust rules in the specification.
 */

export type MonetizationConfig = {
  adsEnabled: boolean;
  bannerEnabled: boolean;
  interstitialEnabled: boolean;
  rewardedEnabled: boolean;
  homeBannerEnabled: boolean;
  /** Placement gates (spec 66). */
  minShiftsForAds: number;
  minDaysSinceInstallForAds: number;
  /** Interstitial pacing (spec 68). */
  interstitialMinHours: number;
  interstitialMax7d: number;
  minimumSessionsBeforeInterstitial: number;
  /** Rewarded pacing (spec 69). */
  rewardedDailyCap: number;
  /** Layout. */
  chartHistoryFreeDays: number;
  advancedChequeChecksFreePerMonth: number;
};

export const DEFAULT_MONETIZATION_CONFIG: MonetizationConfig = {
  adsEnabled: true,
  bannerEnabled: true,
  interstitialEnabled: true,
  rewardedEnabled: true,
  homeBannerEnabled: false,
  minShiftsForAds: 3,
  minDaysSinceInstallForAds: 1,
  interstitialMinHours: 48,
  interstitialMax7d: 2,
  minimumSessionsBeforeInterstitial: 5,
  rewardedDailyCap: 2,
  chartHistoryFreeDays: 90,
  advancedChequeChecksFreePerMonth: 1,
};

/** Placements where advertising is never allowed (spec 67). */
export const FORBIDDEN_AD_ROUTES = [
  '/onboarding',
  '/shift/new',
  '/shift/[id]',
  '/pay/breakdown',
  '/pay/check',
  '/pay/extra',
  '/paywall',
  '/settings',
  '/legal',
] as const;

/** Where a banner may anchor. */
export const BANNER_ALLOWED_ROUTES = ['/calendar', '/insights'] as const;
