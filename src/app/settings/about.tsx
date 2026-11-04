/** About: what the app is, legal, diagnostics and support (spec 99/112). */
import * as Application from 'expo-application';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Share, View } from 'react-native';

import { brandCopy, BRAND } from '../../config/brand.ts';
import { databaseHealth } from '../../db/database.ts';
import { RUNTIME } from '../../config/env.ts';
import { requestInAppReview, reviewEligibility } from '../../services/review.ts';
import { useAppStore } from '../../state/store.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, ListRow, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function AboutSettings() {
  const { t } = useAppUi();
  const state = useAppStore();
  const [health, setHealth] = useState<{ version: number; tables: string[] } | null>(null);
  const [reviewNote, setReviewNote] = useState<string | null>(null);

  useEffect(() => {
    void databaseHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const decision = reviewEligibility({
    installedAtMs: state.settings.installedAt,
    now: Date.now(),
    shiftsSaved: state.shifts.length,
    completedPositiveAction: state.shifts.some((shift) => shift.confirmed),
    daysSinceCrash: state.settings.crashFreeStreakDays,
    daysSinceDiscrepancy:
      state.settings.lastDiscrepancyAt === null ? null : (Date.now() - state.settings.lastDiscrepancyAt) / 86_400_000,
    daysSincePurchaseFailure:
      state.settings.lastPurchaseFailureAt === null ? null : (Date.now() - state.settings.lastPurchaseFailureAt) / 86_400_000,
    lastPromptedAtMs: state.settings.lastReviewPromptAt,
    promptCount: state.settings.reviewPromptCount,
  });

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('settings.about')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{BRAND.APP_NAME}</SectionTitle>
        <Body>{BRAND.TAGLINE}</Body>
        <Body muted>{BRAND.ALT_TAGLINE}</Body>
        <Caption>
          Version {Application.nativeApplicationVersion ?? RUNTIME.appVersion} • {RUNTIME.packageName}
        </Caption>
        <Caption>Rules bundle {state.ruleBundle.bundleVersion}</Caption>
      </Card>

      <Banner tone="info" body={brandCopy(BRAND.DISCLAIMER_TEXT)} />

      <Card style={{ gap: 0 }}>
        <ListRow icon="lock-closed-outline" title={t('settings.privacy')} onPress={() => router.push('/legal/privacy')} />
        <ListRow icon="document-text-outline" title={t('settings.terms')} onPress={() => router.push('/legal/terms')} />
        <ListRow
          icon="help-buoy-outline"
          title="Contact support"
          subtitle={BRAND.SUPPORT_EMAIL}
          onPress={() => void openUrl(BRAND.SUPPORT_URL)}
        />
        <ListRow icon="paper-plane-outline" title={t('settings.shareApp')} onPress={() => void Share.share({ message: `${BRAND.SHARE_FOOTER_TEXT} ${BRAND.WEBSITE_URL}` })} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('settings.diagnostics')}</SectionTitle>
        <Caption>Environment: {RUNTIME.environment}</Caption>
        <Caption>Expo Go: {RUNTIME.isExpoGo ? 'yes' : 'no'}</Caption>
        <Caption>Database schema: v{health?.version ?? '—'} • {health?.tables.length ?? 0} tables</Caption>
        <Caption>Billing available: {state.entitlement.billingAvailable ? 'yes' : 'no'}</Caption>
        <Caption>Rule source: {state.ruleSource}</Caption>
        <Caption>Shifts stored: {state.shifts.length}</Caption>
        <Caption>Jobs stored: {state.jobs.length}</Caption>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Enjoying {BRAND.APP_NAME}?</SectionTitle>
        {decision.eligible ? (
          <Button
            label="Rate the app"
            variant="secondary"
            onPress={async () => {
              const opened = await requestInAppReview();
              setReviewNote(opened ? 'Thanks for the support.' : 'Rating is not available right now.');
              await state.updateSettings({ reviewPromptCount: state.settings.reviewPromptCount + 1, lastReviewPromptAt: Date.now() });
            }}
          />
        ) : (
          <Caption>We only ask for a rating after you have been using the app for a while and things are going well.</Caption>
        )}
        {reviewNote ? <Caption>{reviewNote}</Caption> : null}
      </Card>

      <Caption>
        {BRAND.APP_NAME} is an independent app. It is not affiliated with the Canada Revenue Agency, Revenu Québec or any government body.
      </Caption>
    </Screen>
  );
}

/** Opens a public page; failures are silent because the app must work offline. */
async function openUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // No browser available: the address stays documented in-app.
  }
}
