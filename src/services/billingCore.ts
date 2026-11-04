/**
 * Billing core — the pure, testable half of the subscription layer.
 *
 * Nothing here imports React Native or SQLite, so every branch that matters
 * (empty offering, store unreachable, cancellation, restore, offline cache,
 * expired entitlement) can be tested without a device or a store account.
 * `src/services/billing.ts` wires this to RevenueCat and the local cache.
 *
 * Constants come from the centralized brand config (entitlement id and the
 * monthly product identifier), so a rename never has to touch billing logic.
 */
import { BRAND, PRO_ENTITLEMENT_ID } from '../config/brand.ts';

/** Entitlement id the app checks. Isolated in brand config. */
export const ENTITLEMENT_ID = PRO_ENTITLEMENT_ID;
/** Google Play / RevenueCat product identifier for the monthly plan. */
export const SUBSCRIPTION_PRODUCT_ID = BRAND.PRO_PRODUCT_IDS.monthly;

export type CustomerInfoLike = {
  entitlements?: {
    active?: Record<string, { expirationDate?: string | null; productIdentifier?: string | null } | undefined>;
  };
};

export type ProductLike = { identifier: string; priceString?: string | null };
export type PackageLike = { product: ProductLike };
export type OfferingLike = { availablePackages?: PackageLike[] | null };
export type OfferingsLike = { current?: OfferingLike | null } | null;

/** The narrow RevenueCat surface the app actually uses. */
export type PurchasesPort = {
  configure(options: { apiKey: string; appUserID?: string }): void;
  getOfferings(): Promise<OfferingsLike>;
  getCustomerInfo(): Promise<CustomerInfoLike>;
  purchasePackage(pkg: PackageLike): Promise<{ customerInfo: CustomerInfoLike }>;
  restorePurchases(): Promise<CustomerInfoLike>;
};

export type EntitlementSource = 'store' | 'cache' | 'fallback';

export type EntitlementSnapshot = {
  isPro: boolean;
  source: EntitlementSource;
  expiresAt: string | null;
  productId: string | null;
  /** True only when a real store SDK is present AND an API key is configured. */
  billingAvailable: boolean;
};

export const FREE_SNAPSHOT: EntitlementSnapshot = {
  isPro: false,
  source: 'fallback',
  expiresAt: null,
  productId: null,
  billingAvailable: false,
};

export type PurchaseCode =
  /** No RevenueCat API key / SDK in this build. */
  | 'not_configured'
  /** Store reachable but the subscription product is not published yet. */
  | 'no_offering'
  /** Store or network unreachable. */
  | 'store_unreachable'
  | 'cancelled'
  | 'failed';

export type PurchaseOutcome =
  | { status: 'purchased'; entitlement: EntitlementSnapshot }
  | { status: 'cancelled'; code: 'cancelled' }
  | { status: 'unavailable'; code: PurchaseCode; reason: string }
  | { status: 'failed'; code: PurchaseCode; reason: string };

export type CachedEntitlement = {
  active: boolean;
  expiresAt: string | null;
  productId: string | null;
};

// ---------------------------------------------------------------------------
// Pure readers
// ---------------------------------------------------------------------------

export function isExpired(expiresAt: string | null, now: number): boolean {
  if (expiresAt === null) return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false; // unparseable date: treat as non-expiring
  return parsed <= now;
}

/** Maps a RevenueCat customer info object to the app's entitlement snapshot. */
export function entitlementFromCustomerInfo(info: CustomerInfoLike, billingAvailable = true): EntitlementSnapshot {
  const entitlement = info.entitlements?.active?.[ENTITLEMENT_ID];
  return {
    isPro: Boolean(entitlement),
    source: 'store',
    expiresAt: entitlement?.expirationDate ?? null,
    productId: entitlement?.productIdentifier ?? null,
    billingAvailable,
  };
}

/**
 * Maps the locally cached entitlement. An expired subscription is reported as
 * not-Pro but the caller keeps the cached record: expiry is not a downgrade
 * error, it is simply no longer active.
 */
export function entitlementFromCache(
  cached: CachedEntitlement | null,
  now: number,
  billingAvailable: boolean,
): EntitlementSnapshot {
  if (!cached) return { ...FREE_SNAPSHOT, billingAvailable };
  const expired = isExpired(cached.expiresAt, now);
  return {
    isPro: cached.active && !expired,
    source: 'cache',
    expiresAt: cached.expiresAt,
    productId: cached.productId,
    billingAvailable,
  };
}

/** The configured monthly package, matched on the exact product identifier. */
export function proPackageFor(offerings: OfferingsLike, productId: string = SUBSCRIPTION_PRODUCT_ID): PackageLike | null {
  const packages = offerings?.current?.availablePackages ?? [];
  return packages.find((candidate) => candidate?.product?.identifier === productId) ?? null;
}

/** Localized store price string, or null when the product is not available. */
export function proPriceFrom(offerings: OfferingsLike, productId: string = SUBSCRIPTION_PRODUCT_ID): string | null {
  const pkg = proPackageFor(offerings, productId);
  const price = pkg?.product?.priceString;
  return typeof price === 'string' && price.length > 0 ? price : null;
}

/** RevenueCat/user-cancelled purchases arrive as errors with these markers. */
export function isCancellationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message) && !/cancellation_date/i.test(message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Flows (async, but dependency-injected and therefore testable)
// ---------------------------------------------------------------------------

export const NO_OFFERING_REASON = `The ${SUBSCRIPTION_PRODUCT_ID} subscription is not on sale in Google Play yet, so there is nothing to purchase right now.`;
export const NOT_CONFIGURED_REASON = `Subscriptions are not connected in this build yet. ${BRAND.PRO_PRODUCT_NAME} can be purchased once the store products are live.`;
export const STORE_UNREACHABLE_REASON =
  'Google Play could not be reached. Check your connection and try again — nothing was charged.';

/**
 * Purchase flow. Never throws: every failure becomes a typed outcome the UI can
 * explain, which is what keeps an unpublished product from crashing the app.
 */
export async function purchaseProWith(port: PurchasesPort | null, options: { productId?: string } = {}): Promise<PurchaseOutcome> {
  const productId = options.productId ?? SUBSCRIPTION_PRODUCT_ID;
  if (!port) {
    return { status: 'unavailable', code: 'not_configured', reason: NOT_CONFIGURED_REASON };
  }

  let offerings: OfferingsLike;
  try {
    offerings = await port.getOfferings();
  } catch (error) {
    return { status: 'unavailable', code: 'store_unreachable', reason: `${STORE_UNREACHABLE_REASON} (${describeError(error)})` };
  }

  const pkg = proPackageFor(offerings, productId);
  if (!pkg) {
    const anyPackage = (offerings?.current?.availablePackages ?? []).length > 0;
    return {
      status: 'unavailable',
      code: 'no_offering',
      reason: anyPackage
        ? `${NO_OFFERING_REASON} (the store offered a different product id than ${productId})`
        : NO_OFFERING_REASON,
    };
  }

  try {
    const result = await port.purchasePackage(pkg);
    return { status: 'purchased', entitlement: entitlementFromCustomerInfo(result.customerInfo, true) };
  } catch (error) {
    if (isCancellationError(error)) return { status: 'cancelled', code: 'cancelled' };
    return { status: 'failed', code: 'failed', reason: describeError(error) };
  }
}

/**
 * Restore flow. A store failure always falls back to the cached entitlement
 * instead of downgrading a paying user.
 */
export async function restoreProWith(
  port: PurchasesPort | null,
  cached: EntitlementSnapshot,
  now: number = Date.now(),
): Promise<EntitlementSnapshot> {
  if (!port) return { ...cached, billingAvailable: false };
  try {
    const info = await port.restorePurchases();
    return entitlementFromCustomerInfo(info, true);
  } catch {
    return { ...cached, source: cached.isPro ? 'cache' : cached.source, billingAvailable: true };
  }
}

/**
 * Entitlement refresh. Reads the cache first (instant, offline-safe) and only
 * touches the store when one is configured; any store failure keeps the cached
 * answer as-is.
 */
export type RefreshOutcome = {
  entitlement: EntitlementSnapshot;
  /** Present only when the store answered and the cache should be updated. */
  cacheUpdate: CachedEntitlement | null;
};

export async function refreshEntitlementWith(
  port: PurchasesPort | null,
  cached: CachedEntitlement | null,
  billingAvailable: boolean,
  now: number = Date.now(),
): Promise<RefreshOutcome> {
  const cachedSnapshot = entitlementFromCache(cached, now, billingAvailable);
  if (!port || !billingAvailable) return { entitlement: cachedSnapshot, cacheUpdate: null };
  try {
    const info = await port.getCustomerInfo();
    const snapshot = entitlementFromCustomerInfo(info, true);
    return {
      entitlement: snapshot,
      cacheUpdate: { active: snapshot.isPro, expiresAt: snapshot.expiresAt, productId: snapshot.productId },
    };
  } catch {
    return { entitlement: cachedSnapshot, cacheUpdate: null };
  }
}

/** Pro subscribers never see ads: the ad layer is told through this predicate. */
export function adsSuppressedBySubscription(entitlement: EntitlementSnapshot): boolean {
  return entitlement.isPro;
}
