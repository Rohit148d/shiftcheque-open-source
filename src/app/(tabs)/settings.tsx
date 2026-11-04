/**
 * Settings hub (spec 48/56/60/76/77/82).
 * Everything a free user needs is here; Pro entries explain why they are useful.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';

import { BRAND } from '../../config/brand.ts';
import { SettingsRepository } from '../../db/repositories.ts';
import { THEMES } from '../../ui/theme.ts';
import { LANGUAGES } from '../../i18n/index.ts';
import { activeJobs, archivedJobs, canAddActiveJob } from '../../core/jobChanges.ts';
import { jurisdictionLabel } from '../../rules/loader.ts';
import { NOTIFICATION_CATEGORIES } from '../../services/notifications.ts';
import { lockAvailability } from '../../services/applock.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  ListRow,
  Numeral,
  Screen,
  SectionTitle,
  SegmentedControl,
  SwitchRow,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function SettingsScreen() {
  const { t, theme, money } = useAppUi();
  const state = useAppStore();
  const settings = state.settings;
  const job = activeJob(state);
  const [lockSupported, setLockSupported] = useState(true);

  useEffect(() => {
    void lockAvailability().then((availability) => setLockSupported(availability.supported && availability.enrolled));
  }, []);

  const update = (patch: Parameters<typeof state.updateSettings>[0]) => void state.updateSettings(patch);

  return (
    <Screen>
      <Title>{t('settings.title')}</Title>

      {!state.entitlement.isPro ? (
        <Card accent style={{ gap: spacing.sm }}>
          <SectionTitle>{t('settings.pro')}</SectionTitle>
          <Body>No ads, multiple jobs, full history and exports.</Body>
          <Button label={t('paywall.cta')} onPress={() => router.push('/paywall')} />
        </Card>
      ) : (
        <Card style={{ gap: spacing.xs }}>
          <SectionTitle>{BRAND.PRO_PRODUCT_NAME}</SectionTitle>
          <Body muted>Active — ads are off and every feature is unlocked.</Body>
          <ListRow title={t('paywall.manage')} onPress={() => router.push('/paywall')} />
        </Card>
      )}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('jobs.section')}</SectionTitle>
        {activeJobs(state.jobs).map((job) => (
          <Card key={job.id} style={{ gap: spacing.sm, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Title style={{ fontSize: 17 }}>{job.name}</Title>
                <Numeral size="small" tone="muted">
                  {money(job.hourlyRate)}/hour
                </Numeral>
              </View>
              <View
                style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: job.colour }}
                accessibilityLabel={`${job.name} colour`}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
              <Caption>{t(`onboarding.freq.${job.paySchedule.frequency}` as never)}</Caption>
              <Caption>{jurisdictionLabel(job.jurisdiction)}</Caption>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={t('jobs.editJob')} variant="secondary" onPress={() => router.push(`/job/${job.id}`)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t('jobs.archive')}
                  variant="ghost"
                  onPress={() => void state.archiveJob(job.id)}
                  accessibilityHint="Keeps all history and stops new shifts being added"
                />
              </View>
            </View>
          </Card>
        ))}
        {activeJobs(state.jobs).length === 0 ? (
          <Body muted>{t('jobs.noneActive')}</Body>
        ) : null}
        {archivedJobs(state.jobs).length > 0 ? (
          <ListRow
            icon="archive-outline"
            title={t('jobs.archived')}
            subtitle={t('jobs.archivedCount', { count: archivedJobs(state.jobs).length })}
            onPress={() => router.push('/jobs/archived')}
          />
        ) : null}
        {canAddActiveJob({ isPro: state.entitlement.isPro, jobs: state.jobs }).allowed ? (
          <ListRow
            icon="add-circle-outline"
            title={t('jobs.addJob')}
            subtitle={t('jobs.addJobBody')}
            onPress={() => router.push('/job/new')}
          />
        ) : (
          <ListRow
            icon="star-outline"
            title={t('jobs.addJob')}
            subtitle={t('jobs.addJobPro')}
            onPress={() => router.push('/paywall')}
          />
        )}
      </Card>

      <Card style={{ gap: 0 }}>
        <SectionTitle>{t('settings.payEstimates')}</SectionTitle>
        <ListRow title={t('settings.payEstimates')} subtitle="TD1 claims, year-to-date amounts, extra deductions" icon="calculator-outline" onPress={() => router.push('/settings/estimates')} />
        <ListRow title={t('settings.rules')} subtitle="Which rules and sources are in use" icon="shield-checkmark-outline" onPress={() => router.push('/settings/rules')} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('settings.appearance')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {THEMES.map((candidate) => {
            const locked = candidate.pro && !state.entitlement.isPro;
            return (
              <Chip
                key={candidate.id}
                label={`${candidate.name}${locked ? ' 🔒' : ''}`}
                selected={settings.themeId === candidate.id && !settings.followSystemTheme}
                onPress={() => {
                  if (locked) {
                    router.push('/paywall');
                    return;
                  }
                  update({ themeId: candidate.id, followSystemTheme: false });
                }}
              />
            );
          })}
        </View>
        <SwitchRow label="Follow system dark mode" value={settings.followSystemTheme} onChange={(value) => update({ followSystemTheme: value })} />
        <View style={{ gap: spacing.sm }}>
          <Caption>{t('settings.language')}</Caption>
          <SegmentedControl
            value={settings.language}
            onChange={(value) => update({ language: value })}
            options={[
              { value: 'en-CA', label: 'English' },
              { value: 'fr-CA', label: 'Français' },
            ]}
          />
        </View>
        {LANGUAGES.length < 2 ? <Caption>More languages coming soon.</Caption> : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('settings.notifications')}</SectionTitle>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <SwitchRow
            key={category.id}
            label={notificationLabel(category.id)}
            value={settings.notifications[category.id] ?? category.defaultEnabled}
            onChange={(value) => {
              update({ notifications: { ...settings.notifications, [category.id]: value } });
              void SettingsRepository.setNotificationSetting(category.id, value);
            }}
          />
        ))}
        <ListRow title={t('settings.notifications')} subtitle="Permission and channel details" onPress={() => router.push('/settings/notifications')} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('settings.security')}</SectionTitle>
        {lockSupported ? (
          <>
            <SwitchRow label="Lock the app" description="Uses your device biometrics or PIN" value={settings.appLockEnabled} onChange={(value) => update({ appLockEnabled: value })} />
            {settings.appLockEnabled ? (
              <SegmentedControl
                value={settings.appLockTimeout}
                onChange={(value) => update({ appLockTimeout: value })}
                options={[
                  { value: 'immediately', label: 'Now' },
                  { value: '1_minute', label: '1 min' },
                  { value: '5_minutes', label: '5 min' },
                ]}
              />
            ) : null}
          </>
        ) : (
          <Caption>This device has no screen lock set up, so the app lock is unavailable.</Caption>
        )}
      </Card>

      <Card style={{ gap: 0 }}>
        <SectionTitle>{t('settings.backup')}</SectionTitle>
        <ListRow title={t('settings.backup')} subtitle="Export or import your data" icon="cloud-upload-outline" onPress={() => router.push('/settings/backup')} />
        <ListRow title={t('settings.export')} subtitle="CSV spreadsheets and a PDF pay report" icon="document-outline" onPress={() => router.push('/settings/export')} />
        <ListRow
          title={t('settings.shareSchedule')}
          subtitle="Share an image of your schedule — no wages included"
          icon="share-social-outline"
          onPress={() =>
            void Share.share({
              message: `${BRAND.SHARE_FOOTER_TEXT} ${job ? `(${job.name})` : ''}`,
            })
          }
        />
        <ListRow
          title={t('settings.shareApp')}
          subtitle={BRAND.TAGLINE}
          icon="paper-plane-outline"
          onPress={() => void Share.share({ message: `${BRAND.SHARE_FOOTER_TEXT} ${BRAND.WEBSITE_URL}` })}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('settings.widget')}</SectionTitle>
        <Caption>Home-screen widget privacy</Caption>
        <SegmentedControl
          value={settings.widgetPrivacy}
          onChange={(value) => update({ widgetPrivacy: value })}
          options={[
            { value: 'hide_amounts', label: 'Hide amounts' },
            { value: 'show_amounts', label: 'Show amounts' },
          ]}
        />
        <Caption>The widget shows your next payday and work-week hours, and never shows amounts unless you allow it.</Caption>
      </Card>

      <Card style={{ gap: 0 }}>
        <ListRow icon="information-circle-outline" title={t('settings.about')} onPress={() => router.push('/settings/about')} />
        <ListRow icon="lock-closed-outline" title={t('settings.privacy')} onPress={() => router.push('/legal/privacy')} />
        <ListRow icon="document-text-outline" title={t('settings.terms')} onPress={() => router.push('/legal/terms')} />
      </Card>

      <Banner
        tone="info"
        icon="phone-portrait-outline"
        body={`${BRAND.APP_NAME} keeps your jobs, shifts and pay estimates on this device. No account, no bank connection, no SIN.`}
      />

      <Caption>
        {BRAND.APP_NAME} {state.entitlement.isPro ? 'Pro' : 'Free'} • rules {state.ruleBundle.bundleVersion} ({state.ruleSource})
      </Caption>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

function notificationLabel(id: string): string {
  switch (id) {
    case 'shift_tomorrow':
      return 'Shift tomorrow';
    case 'shift_soon':
      return 'Shift in an hour';
    case 'confirm_shift':
      return 'Confirm a finished shift';
    case 'payday_tomorrow':
      return 'Payday tomorrow';
    case 'payday_today':
      return 'Payday today';
    case 'overtime_approaching':
      return 'Close to overtime';
    case 'weekly_summary':
      return 'Weekly summary';
    default:
      return id;
  }
}

export const SETTINGS_THEME_IDS = THEMES.map((theme) => theme.id);
export const SETTINGS_ACCENT = spacing.md;
