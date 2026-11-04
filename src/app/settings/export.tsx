/**
 * Export & reports (spec 78). Pro feature; the free tier can still export the
 * backup file, and CSV/PDF exports are unlocked by a rewarded ad when ads are
 * available.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { BRAND } from '../../config/brand.ts';
import { exportPeriodPdf, exportPeriodsCsv, exportShiftsCsv } from '../../services/export.ts';
import { showRewarded } from '../../services/ads.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, EmptyState, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function ExportSettings() {
  const { t } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!job) {
    return (
      <Screen>
        <EmptyState title="No job yet" body="Add a job and some shifts first." />
      </Screen>
    );
  }

  const slice = {
    jobs: state.jobs,
    rates: state.rates,
    profiles: state.profiles,
    shifts: state.shifts,
    ruleBundle: state.ruleBundle,
    today: state.today,
  };

  const run = async (label: string, task: () => Promise<{ status: string; fileName?: string; reason?: string }>) => {
    setBusy(true);
    const result = await task();
    setBusy(false);
    if (result.status === 'exported') setStatus(`${label}: ${result.fileName ?? 'ready'}`);
    else setStatus(`${label} failed: ${result.reason ?? 'unknown error'}`);
  };

  const unlockLabel = state.entitlement.isPro ? null : t('check.rewardedUnlock');

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('settings.export')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {status ? <Banner tone="info" body={status} onDismiss={() => setStatus(null)} /> : null}

      {unlockLabel ? (
        <Banner
          tone="attention"
          body={`Exports are part of ${BRAND.PRO_PRODUCT_NAME}. You can also try one now.`}
          action={{
            label: 'Try an export',
            onPress: () =>
              void showRewarded(
                {
                  onboarded: state.settings.onboarded,
                  shiftsRecorded: state.shifts.length,
                  payEstimateViewed: true,
                  isPro: state.entitlement.isPro,
                  meaningfulSessions: 0,
                  route: '/settings/export',
                },
                () => setStatus('Unlocked for this session. Choose an export.'),
                state.monetization,
              ),
          }}
        />
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>CSV</SectionTitle>
        <Caption>Shift rows with hours, overtime and estimated earnings — opens in Excel, Numbers or Sheets.</Caption>
        <Button label="Export shifts (CSV)" variant="secondary" loading={busy} onPress={() => void run('Shifts CSV', () => exportShiftsCsv(slice, job.id))} />
        <Button label="Export pay periods (CSV)" variant="secondary" loading={busy} onPress={() => void run('Periods CSV', () => exportPeriodsCsv(slice, job.id))} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>PDF</SectionTitle>
        <Caption>A one-page personal pay estimate with the rules and assumptions used.</Caption>
        <Button label="Export this period (PDF)" loading={busy} onPress={() => void run('Pay report', () => exportPeriodPdf(slice, job.id))} />
      </Card>

      <Body muted>
        Reports are labelled “personal pay estimate”. They are not payslips and carry no employer or government authority.
      </Body>
      {state.entitlement.isPro ? <Caption>Pro is active — exports are unlimited.</Caption> : null}
    </Screen>
  );
}
