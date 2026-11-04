import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adsActivated,
  canShowBanner,
  canShowInterstitial,
  canUseRewarded,
  evaluateAdEligibility,
  isForbiddenAdRoute,
  type AdEligibilityInput,
} from '../src/config/ads.ts';
import { DEFAULT_MONETIZATION_CONFIG } from '../src/config/monetization.ts';
import { RemoteMonetizationSchema } from '../src/rules/types.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function input(overrides: Partial<AdEligibilityInput> = {}): AdEligibilityInput {
  return {
    ...DEFAULT_MONETIZATION_CONFIG,
    onboarded: true,
    shiftsRecorded: 10,
    payEstimateViewed: true,
    firstUseAt: Date.now() - 5 * DAY,
    now: Date.now(),
    isPro: false,
    meaningfulSessions: 10,
    interstitialCount7d: 0,
    lastInterstitialAt: null,
    rewardedUsedToday: 0,
    route: '/calendar',
    ...overrides,
  };
}

test('ads stay off until every activation gate passes', () => {
  assert.equal(adsActivated(input({ onboarded: false })).allowed, false);
  assert.equal(adsActivated(input({ shiftsRecorded: 2 })).reason, 'not_enough_shifts');
  assert.equal(adsActivated(input({ payEstimateViewed: false })).reason, 'no_pay_estimate_viewed');
  assert.equal(adsActivated(input({ firstUseAt: Date.now() - 2 * HOUR })).reason, 'too_soon_after_install');
  assert.equal(adsActivated(input()).allowed, true);
});

test('pro users never see advertising, and nothing is even requested', () => {
  const eligibility = evaluateAdEligibility(input({ isPro: true }));
  assert.equal(eligibility.anyAds, false);
  assert.equal(eligibility.banner, false);
  assert.equal(eligibility.interstitial, false);
  assert.equal(eligibility.rewarded, false);
  assert.equal(eligibility.reason, 'pro');
});

test('banners are blocked on sensitive routes', () => {
  for (const route of ['/onboarding', '/pay/check', '/pay/breakdown', '/shift/new', '/paywall', '/settings']) {
    assert.equal(canShowBanner(input({ route })), false, `${route} must never show a banner`);
    assert.equal(isForbiddenAdRoute(route), true);
  }
  assert.equal(canShowBanner(input({ route: '/calendar' })), true);
  assert.equal(canShowBanner(input({ route: '/insights' })), true);
});

test('interstitials respect the 48 hour and 2-per-7-days caps', () => {
  const now = Date.now();
  assert.equal(canShowInterstitial(input({ now, lastInterstitialAt: now - 47 * HOUR })), false);
  assert.equal(canShowInterstitial(input({ now, lastInterstitialAt: now - 49 * HOUR })), true);
  assert.equal(canShowInterstitial(input({ now, interstitialCount7d: 2 })), false);
  assert.equal(canShowInterstitial(input({ meaningfulSessions: 4 })), false);
  assert.equal(canShowInterstitial(input({ meaningfulSessions: 5 })), true);
});

test('rewarded ads are capped per day and never required for accuracy', () => {
  assert.equal(canUseRewarded(input({ rewardedUsedToday: 1 })), true);
  assert.equal(canUseRewarded(input({ rewardedUsedToday: 2 })), false);
  assert.equal(canUseRewarded(input({ adsEnabled: false })), false);
});

test('any ads being off disables each placement', () => {
  const off = evaluateAdEligibility(input({ adsEnabled: false }));
  assert.equal(off.anyAds, false);
  assert.equal(off.banner, false);
  assert.equal(off.interstitial, false);
  assert.equal(off.rewarded, false);
});

test('the remote monetization document is validated and can only relax or tighten safely', () => {
  const valid = RemoteMonetizationSchema.safeParse(DEFAULT_MONETIZATION_CONFIG);
  assert.equal(valid.success, true);

  const hostile = RemoteMonetizationSchema.safeParse({
    ...DEFAULT_MONETIZATION_CONFIG,
    interstitialMax7d: 500,
    rewardedDailyCap: -1,
  });
  assert.equal(hostile.success, false, 'out-of-range remote values are rejected');

  const missing = RemoteMonetizationSchema.safeParse({ adsEnabled: true });
  assert.equal(missing.success, false, 'a partial remote document is rejected instead of partially applied');
});
