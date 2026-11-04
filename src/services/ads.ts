/**
 * Advertising service (spec 65–73).
 *
 * ADMOB STATUS IN THIS BUILD: the Google Mobile Ads native module is **not**
 * installed in the billing-enabled internal-testing build. Version 17.2.0 (the
 * newest release) cannot be evaluated by Expo SDK 57's Gradle/AGP toolchain, and
 * fixing that is AdMob work that is intentionally not started yet. With no runtime
 * registered:
 *   - `adsRuntimeAvailable()` returns false
 *   - every eligibility check still runs (policy is unchanged and unit-tested)
 *   - no banner, interstitial or rewarded ad is ever requested
 *   - the UI renders nothing where an ad would go, and never blocks
 * Registering the runtime again (see `registerAdsRuntime` below) re-enables the
 * whole ad layer with no other code changes.
 *
 * With the module present, the policy below governs: ads never gate an estimate,
 * never appear during pay entry, cheque checks or purchases, and Pro users are
 * suppressed entirely.
 */
import { Platform } from 'react-native';
import type { ComponentType } from 'react';

import {
  adsActivated,
  canShowBanner,
  canShowInterstitial,
  canUseRewarded,
  type AdEligibility,
  type AdEligibilityInput,
} from '../config/ads.ts';
import { ADMOB_APP_ID, AD_UNIT_IDS, ADS_SDK_CONFIGURED, ENVIRONMENT, HAS_LIVE_AD_IDS } from '../config/flags.ts';
import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from '../config/monetization.ts';
import { AdStateRepository } from '../db/repositories.ts';

/** Structural types, so this file does not depend on the package being installed. */
export type BannerAdProps = {
  unitId: string;
  size: string;
  requestOptions?: Record<string, unknown>;
  onAdFailedToLoad?: (error: unknown) => void;
  onAdLoaded?: () => void;
};

type AdListener = () => void;
type LoadableAd = {
  addAdEventListener: (event: string, listener: AdListener) => (() => void) | undefined;
  load: () => void;
  show: () => void;
};
type MobileAdsSdk = {
  initialize: () => Promise<unknown>;
  setRequestConfiguration: (config: Record<string, unknown>) => Promise<void>;
};
type AdsSdk = {
  default: () => MobileAdsSdk;
  BannerAd: unknown;
  InterstitialAd: { createForAdRequest: (unitId: string, options?: Record<string, unknown>) => LoadableAd };
  RewardedAd: { createForAdRequest: (unitId: string, options?: Record<string, unknown>) => LoadableAd };
  AdEventType: { LOADED: string; ERROR: string; CLOSED: string };
  RewardedAdEventType: { EARNED_REWARD: string };
  TestIds: { BANNER: string; INTERSTITIAL: string; REWARDED: string };
  MaxAdContentRating: { PG: string };
};

let adsModule: AdsSdk | null = null;
let initialised = false;
let interstitial: LoadableAd | null = null;
let rewarded: LoadableAd | null = null;

/**
 * Registers the optional Google Mobile Ads runtime.
 *
 * The dependency is intentionally absent from the billing-enabled internal build
 * (see the file header). When AdMob work starts, create
 * `src/services/adsRuntime.ts` containing:
 *
 *   import { registerAdsRuntime } from './ads';
 *   registerAdsRuntime(require('react-native-google-mobile-ads'));
 *
 * and import that module once from the root layout. Nothing else changes: the
 * policy gates, the banner slot and the rewarded/interstitial flows all switch
 * on as soon as a runtime is registered.
 *
 * This indirection exists because Metro resolves `require()` at bundle time, so a
 * missing package must never be imported from code that ships.
 */
export function registerAdsRuntime(sdk: unknown): void {
  adsModule = (sdk ?? null) as AdsSdk | null;
}

function loadAds(): AdsSdk | null {
  return adsModule;
}

/** True only when the native ads module is actually part of the build. */
export function adsRuntimeAvailable(): boolean {
  return loadAds() !== null;
}

/** Initialises the SDK once. Safe to call on every launch, no-op when absent. */
export async function initializeAds(): Promise<boolean> {
  const module = loadAds();
  if (!module || initialised) return initialised;
  try {
    await module.default().initialize();
    await module.default().setRequestConfiguration({
      // Development builds use Google's test units; adult content is never requested.
      testDeviceIdentifiers: ENVIRONMENT === 'development' ? ['EMULATOR'] : [],
      maxAdContentRating: module.MaxAdContentRating.PG,
    });
    initialised = true;
    return true;
  } catch {
    return false;
  }
}

export function BannerAdComponent(): ComponentType<BannerAdProps> | null {
  const module = loadAds();
  if (!module) return null;
  return module.BannerAd as unknown as ComponentType<BannerAdProps>;
}

export function bannerUnitId(): string {
  return AD_UNIT_IDS.banner;
}

export function adUnitIdFor(kind: 'banner' | 'interstitial' | 'rewarded'): string {
  if (ENVIRONMENT === 'production' && HAS_LIVE_AD_IDS) return AD_UNIT_IDS[kind];
  const module = loadAds();
  if (module) {
    if (kind === 'banner') return module.TestIds.BANNER;
    if (kind === 'interstitial') return module.TestIds.INTERSTITIAL;
    return module.TestIds.REWARDED;
  }
  return AD_UNIT_IDS[kind];
}

// ---------------------------------------------------------------------------
// Eligibility inputs
// ---------------------------------------------------------------------------

export type AdContext = {
  onboarded: boolean;
  shiftsRecorded: number;
  payEstimateViewed: boolean;
  isPro: boolean;
  meaningfulSessions: number;
  route?: string;
};

const DAY_MS = 86_400_000;

export async function eligibilityFor(context: AdContext, config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG): Promise<AdEligibility> {
  const state = await AdStateRepository.get();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * DAY_MS;
  const today = new Date(now).toISOString().slice(0, 10);
  const recent = state.interstitialTimestamps.filter((timestamp) => timestamp >= sevenDaysAgo);
  const rewardedToday = state.rewardedUsage.find((entry) => entry.day === today)?.count ?? 0;

  const input: AdEligibilityInput = {
    ...config,
    onboarded: context.onboarded,
    shiftsRecorded: context.shiftsRecorded,
    payEstimateViewed: context.payEstimateViewed,
    isPro: context.isPro,
    meaningfulSessions: context.meaningfulSessions ?? state.meaningfulSessions,
    interstitialCount7d: recent.length,
    lastInterstitialAt: state.lastInterstitialAt,
    rewardedUsedToday: rewardedToday,
    firstUseAt: state.firstUseAt,
    now,
    route: context.route,
  };
  const activated = adsActivated(input);
  return {
    anyAds: activated.allowed,
    banner: canShowBanner(input),
    interstitial: canShowInterstitial(input),
    rewarded: canUseRewarded(input),
    reason: activated.reason,
  };
}

/** Records the first launch so the 24-hour activation gate can work. */
export async function recordFirstUse(now = Date.now()): Promise<void> {
  const state = await AdStateRepository.get();
  if (state.firstUseAt !== null) return;
  await AdStateRepository.save({ ...state, firstUseAt: now });
}

export async function recordMeaningfulSession(): Promise<void> {
  const state = await AdStateRepository.get();
  await AdStateRepository.save({ ...state, meaningfulSessions: state.meaningfulSessions + 1 });
}

export async function recordInterstitialShown(now = Date.now()): Promise<void> {
  const state = await AdStateRepository.get();
  await AdStateRepository.save({
    ...state,
    lastInterstitialAt: now,
    interstitialTimestamps: [...state.interstitialTimestamps, now],
  });
}

export async function recordRewardedShown(now = Date.now()): Promise<void> {
  const state = await AdStateRepository.get();
  const today = new Date(now).toISOString().slice(0, 10);
  const usage = [...state.rewardedUsage];
  const index = usage.findIndex((entry) => entry.day === today);
  if (index >= 0) usage[index] = { day: today, count: usage[index].count + 1 };
  else usage.push({ day: today, count: 1 });
  await AdStateRepository.save({ ...state, rewardedUsage: usage.slice(-30) });
}

// ---------------------------------------------------------------------------
// Interstitials + rewarded
// ---------------------------------------------------------------------------

export type AdOutcome = 'shown' | 'not_ready' | 'failed' | 'not_eligible';

/** Waits for a load event with a timeout; resolves false instead of hanging. */
function loadWithTimeout(ad: LoadableAd, module: AdsSdk, timeoutMs = 8000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const onLoaded = ad.addAdEventListener(module.AdEventType.LOADED, () => {
      onLoaded?.();
      finish(true);
    });
    const onError = ad.addAdEventListener(module.AdEventType.ERROR, () => {
      onError?.();
      finish(false);
    });
    ad.load();
    setTimeout(() => finish(false), timeoutMs);
  });
}

export async function maybeShowInterstitial(context: AdContext, config = DEFAULT_MONETIZATION_CONFIG): Promise<AdOutcome> {
  const module = loadAds();
  if (!module) return 'not_eligible';
  const eligibility = await eligibilityFor(context, config);
  if (!eligibility.interstitial) return 'not_eligible';
  try {
    interstitial = module.InterstitialAd.createForAdRequest(adUnitIdFor('interstitial'), {
      requestNonPersonalizedAdsOnly: true,
    });
    if (!(await loadWithTimeout(interstitial, module))) {
      interstitial = null;
      return 'failed';
    }
    const shown = interstitial;
    const closed = new Promise<void>((resolve) => {
      const unsubscribe = shown.addAdEventListener(module.AdEventType.CLOSED, () => {
        unsubscribe?.();
        resolve();
      });
    });
    shown.show();
    await closed;
    interstitial = null;
    await recordInterstitialShown();
    return 'shown';
  } catch {
    interstitial = null;
    return 'failed';
  }
}

export async function showRewarded(
  context: AdContext,
  onEarned: () => Promise<void> | void,
  config = DEFAULT_MONETIZATION_CONFIG,
): Promise<AdOutcome> {
  const module = loadAds();
  if (!module) return 'not_eligible';
  const eligibility = await eligibilityFor(context, config);
  if (!eligibility.rewarded) return 'not_eligible';
  try {
    rewarded = module.RewardedAd.createForAdRequest(adUnitIdFor('rewarded'), { requestNonPersonalizedAdsOnly: true });
    if (!(await loadWithTimeout(rewarded, module))) {
      rewarded = null;
      return 'failed';
    }
    const shown = rewarded;
    let earned = false;
    const closed = new Promise<void>((resolve) => {
      const unsubscribeClosed = shown.addAdEventListener(module.AdEventType.CLOSED, () => {
        unsubscribeClosed?.();
        resolve();
      });
      const unsubscribeEarned = shown.addAdEventListener(module.RewardedAdEventType.EARNED_REWARD, () => {
        unsubscribeEarned?.();
        earned = true;
      });
    });
    shown.show();
    await closed;
    rewarded = null;
    if (!earned) return 'failed';
    await recordRewardedShown();
    await onEarned();
    return 'shown';
  } catch {
    rewarded = null;
    return 'failed';
  }
}

export type { MonetizationConfig };
export { DEFAULT_MONETIZATION_CONFIG };
export const ADMOB_APPLICATION_ID = ADMOB_APP_ID;
export const ADS_SUPPORTED_PLATFORM = Platform.OS === 'android' || Platform.OS === 'ios';
