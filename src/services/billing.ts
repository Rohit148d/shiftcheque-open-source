/**
 * Subscription / entitlement service (spec 64) — RevenueCat wiring.
 *
 * The decision logic lives in `billingCore.ts` (pure and tested). This file only
 * adapts the RevenueCat SDK and the local cache to it, and keeps working when
 * the SDK or the API key is absent:
 *
 *   - the SDK is loaded lazily, so the app runs in Expo Go, in CI and in builds
 *     without a RevenueCat key; the Google Play Billing library still ships in
 *     the Android bundle because it is a compile-time dependency of the SDK
 *   - entitlements are cached locally and survive offline launches, store
 *     errors and temporary billing failures
 *   - data is never deleted because billing could not connect
 *   - with no API key the app reports "not configured" instead of crashing, and
 *     an unpublished product reports "no offering" instead of crashing
 *
 * ENVIRONMENT: the Android key comes from EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.
 * No key is embedded in the repository and no placeholder key is ever used.
 */
import { Platform } from 'react-native';

import { BILLING_SDK_CONFIGURED, REVENUECAT_ANDROID_API_KEY, REVENUECAT_IOS_API_KEY } from '../config/flags.ts';
import { SubscriptionRepository } from '../db/repositories.ts';
import {
  entitlementFromCache,
  ENTITLEMENT_ID,
  NOT_CONFIGURED_REASON,
  proPriceFrom,
  purchaseProWith,
  refreshEntitlementWith,
  restoreProWith,
  type CachedEntitlement,
  type CustomerInfoLike,
  type EntitlementSnapshot,
  type OfferingsLike,
  type PackageLike,
  type PurchaseOutcome,
  type PurchasesPort,
} from './billingCore.ts';

export type EntitlementState = EntitlementSnapshot;
export type PurchaseResult = PurchaseOutcome;
export { ENTITLEMENT_ID, SUBSCRIPTION_PRODUCT_ID } from './billingCore.ts';

type PurchasesModule = typeof import('react-native-purchases').default;

let sdkModule: PurchasesModule | null | undefined;
let configured = false;

/** Lazily requires the native SDK. Returns null when it is not in the build. */
function loadSdk(): PurchasesModule | null {
  if (sdkModule !== undefined) return sdkModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-purchases') as { default?: PurchasesModule } & PurchasesModule;
    sdkModule = (loaded.default ?? loaded) as PurchasesModule;
  } catch {
    sdkModule = null;
  }
  return sdkModule;
}

function apiKey(): string | undefined {
  return Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
}

/** True only when an API key is configured and the native SDK is present. */
export function billingAvailable(): boolean {
  return BILLING_SDK_CONFIGURED && apiKey() !== undefined && loadSdk() !== null;
}

/** Adapter from the RevenueCat SDK to the narrow port the core uses. */
function purchasesPort(): PurchasesPort | null {
  const sdk = loadSdk();
  if (!sdk) return null;
  return {
    configure: ({ apiKey: key, appUserID }) => {
      sdk.configure({ apiKey: key, appUserID });
    },
    getOfferings: () => sdk.getOfferings() as unknown as Promise<OfferingsLike>,
    getCustomerInfo: () => sdk.getCustomerInfo() as unknown as Promise<CustomerInfoLike>,
    purchasePackage: (pkg: PackageLike) =>
      sdk.purchasePackage(pkg as never) as unknown as Promise<{ customerInfo: CustomerInfoLike }>,
    restorePurchases: () => sdk.restorePurchases() as unknown as Promise<CustomerInfoLike>,
  };
}

export async function configureBilling(appUserId?: string): Promise<boolean> {
  const key = apiKey();
  const port = purchasesPort();
  if (!port || !key) return false;
  if (configured) return true;
  try {
    port.configure({ apiKey: key, appUserID: appUserId });
    configured = true;
    return true;
  } catch {
    return false;
  }
}

async function readCached(): Promise<CachedEntitlement | null> {
  try {
    const cached = await SubscriptionRepository.get();
    if (!cached) return null;
    return { active: cached.active, expiresAt: cached.expiresAt, productId: cached.productId };
  } catch {
    return null;
  }
}

async function writeCache(snapshot: CachedEntitlement): Promise<void> {
  try {
    await SubscriptionRepository.save({
      entitlement: ENTITLEMENT_ID,
      active: snapshot.active,
      expiresAt: snapshot.expiresAt,
      productId: snapshot.productId,
      store: Platform.OS,
    });
  } catch {
    // A cache write failure must never break the purchase flow.
  }
}

/** Reads the cached entitlement first so the UI is instant and offline-safe. */
export async function cachedEntitlement(): Promise<EntitlementState> {
  return entitlementFromCache(await readCached(), Date.now(), billingAvailable());
}

export async function refreshEntitlement(): Promise<EntitlementState> {
  const port = billingAvailable() ? purchasesPort() : null;
  const outcome = await refreshEntitlementWith(port, await readCached(), billingAvailable());
  if (outcome.cacheUpdate) await writeCache(outcome.cacheUpdate);
  return outcome.entitlement;
}

export async function purchasePro(): Promise<PurchaseResult> {
  const port = purchasesPort();
  if (!port || !apiKey()) {
    return { status: 'unavailable', code: 'not_configured', reason: NOT_CONFIGURED_REASON };
  }
  await configureBilling();
  const outcome = await purchaseProWith(port);
  if (outcome.status === 'purchased') {
    await writeCache({
      active: outcome.entitlement.isPro,
      expiresAt: outcome.entitlement.expiresAt,
      productId: outcome.entitlement.productId,
    });
  }
  return outcome;
}

export async function restorePurchases(): Promise<EntitlementState> {
  const port = purchasesPort();
  if (!port || !apiKey()) {
    const cached = await cachedEntitlement();
    return { ...cached, billingAvailable: false };
  }
  await configureBilling();
  const snapshot = await restoreProWith(port, await cachedEntitlement());
  if (snapshot.source === 'store') {
    await writeCache({ active: snapshot.isPro, expiresAt: snapshot.expiresAt, productId: snapshot.productId });
  }
  return snapshot;
}

/** Localized store price. Never a hard-coded amount; null while unavailable. */
export async function localizedProPrice(): Promise<string | null> {
  const port = purchasesPort();
  if (!port || !apiKey()) return null;
  try {
    await configureBilling();
    return proPriceFrom(await port.getOfferings());
  } catch {
    return null;
  }
}

export async function manageSubscriptionUrl(): Promise<string | null> {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}
