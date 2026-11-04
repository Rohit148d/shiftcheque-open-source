/** Privacy policy + terms, rendered in-app (spec 99/100/112). */
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Linking, View } from 'react-native';

import { BRAND, brandCopy, isPlaceholderUrl } from '../../config/brand.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

const PRIVACY_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'What we collect',
    body: 'Nothing about you leaves your phone unless you ask it to. Your jobs, hourly rates, shifts, notes, pay estimates, paycheque checks and settings are stored in a local database on this device.',
  },
  {
    title: 'What we never ask for',
    body: 'No social insurance number, no bank login, no bank account numbers, no employer address, no contacts, no SMS, no call logs, no precise location, no microphone and no camera.',
  },
  {
    title: 'Accounts',
    body: 'There is no account and no mandatory sign-in. You can use every calculation feature without giving us any information at all.',
  },
  {
    title: 'Advertising',
    body: 'The free version may show a banner on the calendar or insights screen and, very rarely, a full-screen ad after you finish browsing. Ads never appear while you add shifts, look at your pay breakdown, check a paycheque or complete a purchase. Pro subscribers never see ads. Ad requests are non-personalised.',
  },
  {
    title: 'Purchases',
    body: 'Subscriptions are processed by Google Play and validated by RevenueCat. We never see your card details.',
  },
  {
    title: 'Optional diagnostics',
    body: 'Anonymous product analytics and crash reports are off unless the app is built with an endpoint configured. When enabled, only the event names listed in the technical documentation are sent, and money values are stripped from crash logs.',
  },
  {
    title: 'Backups',
    body: 'Backups are files you create and share yourself. They are not uploaded by the app. Backups are not encrypted in this version, so store them somewhere private.',
  },
  {
    title: 'Deleting your data',
    body: 'Use Settings → Backup to export first if you want a copy, then remove the app from your device to delete the local database.',
  },
];

const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Estimates, not advice',
    body: brandCopy(BRAND.DISCLAIMER_TEXT),
  },
  {
    title: 'Your responsibilities',
    body: 'You are responsible for the accuracy of what you enter: hours, rates, breaks, premiums and payslip amounts. The app cannot see your employer’s payroll system.',
  },
  {
    title: 'No employment relationship',
    body: 'We are not your employer, payroll provider, accountant, bank or lender. We do not move money and we do not offer loans, cash advances or earned-wage access.',
  },
  {
    title: 'Subscriptions',
    body: `Optional subscriptions are billed through Google Play at the price shown in the store at the time of purchase, renew automatically until cancelled, and can be managed or cancelled in your store account.`,
  },
  {
    title: 'Rule data',
    body: 'Payroll and employment-standards rules are verified against official sources and stored with effective dates. Laws change; if a rule looks out of date, tell us and we will re-verify it.',
  },
  {
    title: 'Support',
    body: `Support, privacy requests and corrections: ${BRAND.SUPPORT_URL}`,
  },
];

export default function LegalScreen() {  const params = useLocalSearchParams<{ doc?: string }>();
  const { t } = useAppUi();
  const doc = params.doc === 'terms' ? 'terms' : 'privacy';
  const sections = doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{doc === 'terms' ? t('settings.terms') : t('settings.privacy')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.xs }}>
        <Caption>Last updated 2026-10-05</Caption>
        <Body>
          {doc === 'terms'
            ? `The terms that apply when you use ${BRAND.APP_NAME}.`
            : `How ${BRAND.APP_NAME} handles your information — in plain language.`}
        </Body>
      </Card>

      {sections.map((section) => (
        <Card key={section.title} style={{ gap: spacing.xs }}>
          <SectionTitle>{section.title}</SectionTitle>
          <Body muted>{section.body}</Body>
        </Card>
      ))}

      {doc === 'privacy' ? (
        <Banner tone="positive" icon="shield-checkmark-outline" body="Short version: your pay data stays on your phone, and we do not want your SIN or your bank login." />
      ) : null}

      <Caption>
        Full copies are published online:
      </Caption>
      <View style={{ gap: spacing.xs }}>
        <Button
          label={BRAND.PRIVACY_URL}
          variant="ghost"
          fullWidth={false}
          onPress={() => void openUrl(BRAND.PRIVACY_URL)}
        />
        <Button
          label={BRAND.TERMS_URL}
          variant="ghost"
          fullWidth={false}
          onPress={() => void openUrl(BRAND.TERMS_URL)}
        />
        <Button
          label={BRAND.SUPPORT_URL}
          variant="ghost"
          fullWidth={false}
          onPress={() => void openUrl(BRAND.SUPPORT_URL)}
        />
      </View>
      {isPlaceholderUrl(BRAND.PRIVACY_URL) || isPlaceholderUrl(BRAND.TERMS_URL) ? (
        <Caption>These addresses are documented placeholders and do not open a page yet.</Caption>
      ) : (
        <Caption>{brandCopy('These pages open in your browser. {app} itself never loads a web page.')}</Caption>
      )}
    </Screen>
  );
}

/** Opens a public page; failures are silent because the app must work offline. */
async function openUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // No browser available: nothing to do, the address is documented in-app.
  }
}
