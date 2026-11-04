import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRAND, PRO_ENTITLEMENT_ID } from '../src/config/brand.ts';
import {
  ENTITLEMENT_ID,
  FREE_SNAPSHOT,
  NO_OFFERING_REASON,
  SUBSCRIPTION_PRODUCT_ID,
  entitlementFromCache,
  entitlementFromCustomerInfo,
  isCancellationError,
  isExpired,
  proPackageFor,
  proPriceFrom,
  purchaseProWith,
  refreshEntitlementWith,
  restoreProWith,
  type CustomerInfoLike,
  type OfferingsLike,
  type PurchasesPort,
} from '../src/services/billingCore.ts';
import { evaluateAdEligibility } from '../src/config/ads.ts';
import { DEFAULT_MONETIZATION_CONFIG } from '../src/config/monetization.ts';

const MONTHLY = 'shiftcheque_pro_monthly';

function monthlyOffering(priceString = 'CA$0.99'): OfferingsLike {
  return { current: { availablePackages: [{ product: { identifier: MONTHLY, priceString } }] } };
}

function activeInfo(expiresAt = '2027-01-01T00:00:00.000Z'): CustomerInfoLike {
  return {
    entitlements: {
      active: { [PRO_ENTITLEMENT_ID]: { expirationDate: expiresAt, productIdentifier: MONTHLY } },
    },
  };
}

const inactiveInfo: CustomerInfoLike = { entitlements: { active: {} } };

type PortOptions = {
  offerings?: OfferingsLike | (() => Promise<OfferingsLike>);
  customerInfo?: CustomerInfoLike;
  purchase?: () => Promise<{ customerInfo: CustomerInfoLike }>;
  restore?: () => Promise<CustomerInfoLike>;
};

function makePort(options: PortOptions = {}) {
  const calls: string[] = [];
  const port: PurchasesPort = {
    configure: () => calls.push('configure'),
    getOfferings: async () => {
      calls.push('getOfferings');
      const value = options.offerings ?? monthlyOffering();
      return typeof value === 'function' ? value() : value;
    },
    getCustomerInfo: async () => {
      calls.push('getCustomerInfo');
      return options.customerInfo ?? inactiveInfo;
    },
    purchasePackage: async (pkg) => {
      calls.push(`purchasePackage:${pkg.product.identifier}`);
      if (options.purchase) return options.purchase();
      return { customerInfo: activeInfo() };
    },
    restorePurchases: async () => {
      calls.push('restorePurchases');
      if (options.restore) return options.restore();
      return activeInfo();
    },
  };
  return { port, calls };
}

// ---------------------------------------------------------------------------
// Centralized constants
// ---------------------------------------------------------------------------

test('entitlement and product identifiers stay centralized in brand config', () => {
  assert.equal(ENTITLEMENT_ID, 'shiftcheque_pro');
  assert.equal(PRO_ENTITLEMENT_ID, 'shiftcheque_pro');
  assert.equal(SUBSCRIPTION_PRODUCT_ID, 'shiftcheque_pro_monthly');
  assert.equal(BRAND.PRO_PRODUCT_IDS.monthly, SUBSCRIPTION_PRODUCT_ID);
});

// ---------------------------------------------------------------------------
// Entitlement reading
// ---------------------------------------------------------------------------

test('entitlement is read from the shiftcheque_pro entitlement only', () => {
  const active = entitlementFromCustomerInfo(activeInfo());
  assert.equal(active.isPro, true);
  assert.equal(active.source, 'store');
  assert.equal(active.productId, MONTHLY);

  const otherEntitlement: CustomerInfoLike = {
    entitlements: { active: { some_other_entitlement: { expirationDate: null, productIdentifier: 'x' } } },
  };
  assert.equal(entitlementFromCustomerInfo(otherEntitlement).isPro, false);
  assert.equal(entitlementFromCustomerInfo(inactiveInfo).isPro, false);
});

test('cached entitlement is honoured offline and expiry is respected', () => {
  const cached = { active: true, expiresAt: '2027-01-01T00:00:00.000Z', productId: MONTHLY };
  const live = entitlementFromCache(cached, Date.parse('2026-10-05T00:00:00Z'), true);
  assert.equal(live.isPro, true);
  assert.equal(live.source, 'cache');
  assert.equal(live.billingAvailable, true);

  const expired = entitlementFromCache(cached, Date.parse('2027-02-01T00:00:00Z'), true);
  assert.equal(expired.isPro, false, 'an expired subscription is not Pro');
  assert.equal(expired.expiresAt, cached.expiresAt, 'the cached record is kept for history');

  const noCache = entitlementFromCache(null, Date.now(), false);
  assert.deepEqual(noCache, { ...FREE_SNAPSHOT, billingAvailable: false });
  assert.equal(isExpired(null, Date.now()), false, 'no expiry date never expires');
});

// ---------------------------------------------------------------------------
// Offerings: the product does not exist yet
// ---------------------------------------------------------------------------

test('an empty offering is reported as unavailable, never a crash', async () => {
  const { port } = makePort({ offerings: { current: null } });
  const result = await purchaseProWith(port);
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') {
    assert.equal(result.code, 'no_offering');
    assert.equal(result.reason, NO_OFFERING_REASON);
  }
});

test('an offering with a different product id is not purchased silently', async () => {
  const { port, calls } = makePort({ offerings: { current: { availablePackages: [{ product: { identifier: 'shiftcheque_pro_yearly' } }] } } });
  const result = await purchaseProWith(port);
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.equal(result.code, 'no_offering');
  assert.equal(calls.some((call) => call.startsWith('purchasePackage')), false, 'no unexpected product is bought');
});

test('a store that cannot be reached reports store_unreachable', async () => {
  const { port } = makePort({
    offerings: async () => {
      throw new Error('network is down');
    },
  });
  const result = await purchaseProWith(port);
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') {
    assert.equal(result.code, 'store_unreachable');
    assert.ok(result.reason.includes('nothing was charged') || result.reason.includes('nothing was charged'));
  }
});

test('no SDK at all (no RevenueCat key in the build) reports not_configured', async () => {
  const result = await purchaseProWith(null);
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.equal(result.code, 'not_configured');
});

// ---------------------------------------------------------------------------
// Purchase paths
// ---------------------------------------------------------------------------

test('purchase success returns a Pro entitlement for the configured product', async () => {
  const { port, calls } = makePort();
  const result = await purchaseProWith(port);
  assert.equal(result.status, 'purchased');
  if (result.status === 'purchased') {
    assert.equal(result.entitlement.isPro, true);
    assert.equal(result.entitlement.expiresAt, '2027-01-01T00:00:00.000Z');
  }
  assert.ok(calls.includes(`purchasePackage:${MONTHLY}`), 'the configured monthly product is the one purchased');
});

test('a cancelled purchase is a normal outcome, not an error', async () => {
  const { port } = makePort({
    purchase: async () => {
      throw new Error('Purchase was cancelled by the user');
    },
  });
  const result = await purchaseProWith(port);
  assert.deepEqual(result, { status: 'cancelled', code: 'cancelled' });
});

test('a failed purchase surfaces the reason without throwing', async () => {
  const { port } = makePort({
    purchase: async () => {
      throw new Error('BILLING_UNAVAILABLE: Play Store not installed');
    },
  });
  const result = await purchaseProWith(port);
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.code, 'failed');
    assert.ok(result.reason.includes('BILLING_UNAVAILABLE'));
  }
});

test('cancellation detection is specific: "cancel" yes, unrelated errors no', () => {
  assert.equal(isCancellationError(new Error('User cancelled')), true);
  assert.equal(isCancellationError(new Error('PURCHASE_CANCELLED')), true);
  assert.equal(isCancellationError(new Error('BILLING_UNAVAILABLE')), false);
  assert.equal(isCancellationError(new Error('cancellation_date mismatch')), false);
  assert.equal(isCancellationError('plain string cancel'), true);
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

test('restore recovers an active entitlement', async () => {
  const { port, calls } = makePort();
  const snapshot = await restoreProWith(port, FREE_SNAPSHOT);
  assert.equal(snapshot.isPro, true);
  assert.equal(snapshot.source, 'store');
  assert.ok(calls.includes('restorePurchases'));
});

test('restore without a store keeps the cached entitlement (no downgrade)', async () => {
  const cachedPro = entitlementFromCache({ active: true, expiresAt: null, productId: MONTHLY }, Date.now(), false);
  const snapshot = await restoreProWith(null, { ...cachedPro, billingAvailable: false });
  assert.equal(snapshot.isPro, true, 'a paying user is never downgraded');
  assert.equal(snapshot.billingAvailable, false);
});

test('a failing restore does not revoke an active cached entitlement', async () => {
  const { port } = makePort({
    restore: async () => {
      throw new Error('offline');
    },
  });
  const cachedPro = entitlementFromCache({ active: true, expiresAt: null, productId: MONTHLY }, Date.now(), true);
  const snapshot = await restoreProWith(port, cachedPro);
  assert.equal(snapshot.isPro, true);
});

// ---------------------------------------------------------------------------
// Refresh / offline behaviour
// ---------------------------------------------------------------------------

test('refresh reads the store and reports what to cache', async () => {
  const { port } = makePort({ customerInfo: activeInfo() });
  const outcome = await refreshEntitlementWith(port, null, true);
  assert.equal(outcome.entitlement.isPro, true);
  assert.deepEqual(outcome.cacheUpdate, { active: true, expiresAt: '2027-01-01T00:00:00.000Z', productId: MONTHLY });
});

test('refresh while offline keeps the cached entitlement and writes no cache', async () => {
  const { port } = makePort({
    customerInfo: undefined,
    offerings: monthlyOffering(),
  });
  const offlinePort: PurchasesPort = {
    ...port,
    getCustomerInfo: async () => {
      throw new Error('Network request failed');
    },
  };
  const cached = { active: true, expiresAt: null, productId: MONTHLY };
  const outcome = await refreshEntitlementWith(offlinePort, cached, true);
  assert.equal(outcome.entitlement.isPro, true, 'offline never downgrades');
  assert.equal(outcome.entitlement.source, 'cache');
  assert.equal(outcome.cacheUpdate, null, 'nothing to write when the store did not answer');
});

test('refresh without a store configured falls back to the cache silently', async () => {
  const outcome = await refreshEntitlementWith(null, null, false);
  assert.equal(outcome.entitlement.isPro, false);
  assert.equal(outcome.entitlement.source, 'fallback');
});

// ---------------------------------------------------------------------------
// Price + helpers
// ---------------------------------------------------------------------------

test('price comes from the store offering, never a hard-coded string', () => {
  assert.equal(proPriceFrom(monthlyOffering('CA$0.99')), 'CA$0.99');
  assert.equal(proPriceFrom(monthlyOffering('€0,99')), '€0,99');
  assert.equal(proPriceFrom({ current: null }), null);
  assert.equal(proPriceFrom({ current: { availablePackages: [{ product: { identifier: 'other', priceString: 'CA$9.99' } }] } }), null);
});

test('package selection is exact-match and order independent', () => {
  const offerings: OfferingsLike = {
    current: {
      availablePackages: [
        { product: { identifier: 'shiftcheque_pro_yearly' } },
        { product: { identifier: MONTHLY } },
      ],
    },
  };
  assert.equal(proPackageFor(offerings)?.product.identifier, MONTHLY);
  assert.equal(proPackageFor({ current: { availablePackages: null } }), null);
  assert.equal(proPackageFor(null), null);
});

// ---------------------------------------------------------------------------
// Pro suppresses ads
// ---------------------------------------------------------------------------

test('an active Pro entitlement suppresses every ad placement', () => {
  const base = {
    ...DEFAULT_MONETIZATION_CONFIG,
    onboarded: true,
    shiftsRecorded: 50,
    payEstimateViewed: true,
    firstUseAt: Date.now() - 30 * 86_400_000,
    now: Date.now(),
    meaningfulSessions: 20,
    interstitialCount7d: 0,
    lastInterstitialAt: null,
    rewardedUsedToday: 0,
    route: '/calendar',
  };
  const free = evaluateAdEligibility({ ...base, isPro: false });
  const pro = evaluateAdEligibility({ ...base, isPro: true });
  assert.equal(free.banner, true, 'free users can see a banner on allowed screens');
  assert.deepEqual(
    { banner: pro.banner, interstitial: pro.interstitial, rewarded: pro.rewarded, anyAds: pro.anyAds },
    { banner: false, interstitial: false, rewarded: false, anyAds: false },
    'Pro users get no ads anywhere',
  );
});
