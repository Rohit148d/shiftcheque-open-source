/**
 * Paywall (spec 62/63).
 *
 * Rules baked into this screen: it is never shown during onboarding or on first
 * launch, it always shows the store's localized price when available, it never
 * fakes a discount or a timer, and it lets people keep using the free app.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { BRAND } from '../config/brand.ts';
import { localizedProPrice, manageSubscriptionUrl, purchasePro, restorePurchases, SUBSCRIPTION_PRODUCT_ID, type PurchaseResult } from '../services/billing.ts';
import { track } from '../services/analytics.ts';
import { useAppStore } from '../state/store.ts';
import { useAppUi } from '../ui/AppUi.tsx';
import { Banner, Button, Caption, PaywallCard, Screen, Title } from '../ui/components.tsx';
import { spacing } from '../ui/theme.ts';

export default function Paywall() {
  const { t } = useAppUi();
  const state = useAppStore();
  const [price, setPrice] = useState<string | null>(null);
  const [priceChecked, setPriceChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    track('paywall_viewed');
    void localizedProPrice()
      .then(setPrice)
      .finally(() => setPriceChecked(true));
    void state.updateSettings({ paywallSeenCount: state.settings.paywallSeenCount + 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchase = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    track('purchase_started');
    const result = await purchasePro();
    setBusy(false);
    if (result.status === 'purchased') {
      track('purchase_completed');
      await state.updateSettings({ lastPurchaseFailureAt: null });
      await state.refreshEntitlementState();
      router.back();
      return;
    }
    if (result.status === 'cancelled') {
      setNotice('Purchase cancelled — nothing was charged.');
      return;
    }
    track('purchase_failed');
    await state.updateSettings({ lastPurchaseFailureAt: Date.now() });
    setNotice(purchaseNoticeFor(result));
  };

  const restore = async () => {
    setBusy(true);
    const entitlement = await restorePurchases();
    setBusy(false);
    await state.refreshEntitlementState();
    track('restore_completed');
    setNotice(
      entitlement.isPro
        ? `${BRAND.PRO_PRODUCT_NAME} restored. Thank you!`
        : 'No active subscription was found for this store account.',
    );
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('paywall.title', { pro: BRAND.PRO_PRODUCT_NAME })}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {!state.entitlement.billingAvailable ? (
        <Banner
          tone="attention"
          body={`Subscriptions are not on sale yet: the Google Play product for ${BRAND.PRO_PRODUCT_NAME} has not been published, so nothing can be purchased today. Planned Canadian launch price: CA$${BRAND.PRO_TARGET_PRICE_CA.toFixed(2)}/month. The free experience keeps working normally.`}
        />
      ) : null}

      <PaywallCard
        title={BRAND.PRO_PRODUCT_NAME}
        tagline={t('paywall.tagline')}
        features={[t('paywall.noAds'), t('paywall.multiJob'), t('paywall.advancedChecks'), t('paywall.history'), t('paywall.exports'), t('paywall.moreRules')]}
        priceLabel={price}
        onPurchase={() => void purchase()}
        onContinueFree={() => router.back()}
        onRestore={() => void restore()}
        onManage={() =>
          void manageSubscriptionUrl().then((url) => {
            if (url) void Linking.openURL(url);
          })
        }
        busy={busy}
        notice={notice ?? undefined}
      />

      <Caption>
        Billing renews automatically through Google Play until cancelled. Cancel any time in your Play account. Your existing data is never deleted if a
        subscription ends — you keep everything you created.
      </Caption>
      <Caption>
        Price shown is the localized store price when available. Working target price: {BRAND.PRO_TARGET_PRICE_CA.toFixed(2)} CAD per month.
      </Caption>
      {state.entitlement.billingAvailable && priceChecked && price === null ? (
        <Caption>Google Play will show the exact price at checkout once the subscription is published.</Caption>
      ) : null}
      {!priceChecked && state.entitlement.billingAvailable ? <Caption>Checking Google Play…</Caption> : null}
      <Button label={t('settings.privacy')} variant="ghost" onPress={() => router.push('/legal/privacy')} />
      <Button label={t('settings.terms')} variant="ghost" onPress={() => router.push('/legal/terms')} />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/**
 * Turns a purchase outcome into copy a worker can act on. Nothing here throws
 * or apologises vaguely: each state says what happened and what still works.
 */
function purchaseNoticeFor(result: PurchaseResult): string {
  if (result.status === 'unavailable') {
    if (result.code === 'no_offering') {
      return `Nothing can be purchased yet: the ${SUBSCRIPTION_PRODUCT_ID} subscription has not been published in Google Play. Your free experience continues to work normally.`;
    }
    return result.reason;
  }
  if (result.status === 'failed') {
    return `The purchase could not be completed and nothing was charged. (${result.reason})`;
  }
  return 'Nothing was changed.';
}
