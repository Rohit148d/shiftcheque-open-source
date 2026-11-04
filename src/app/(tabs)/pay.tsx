/**
 * Pay tab (spec 18): current pay, breakdown, cheque check, extra shift value and
 * previous pay periods — all in one place.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob, periodsForJob, profileFor } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  ConfidenceBadge,
  EmptyState,
  ListRow,
  Metric,
  Numeral,
  Screen,
  SectionTitle,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function PayTab() {
  const { t, money, hours, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);

  const calculation = useMemo(
    () =>
      job
        ? calculateForJob(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            job.id,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion, state.today],
  );

  const history = useMemo(
    () =>
      job
        ? periodsForJob(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            job.id,
            6,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion],
  );

  if (!job) {
    return (
      <Screen>
        <EmptyState title={t('empty.payTitle')} body={t('empty.payBody')} action={{ label: 'Add your first job', onPress: () => router.push('/onboarding') }} />
      </Screen>
    );
  }

  const profile = profileFor(state, job.id);

  return (
    <Screen>
      <Title>{t('nav.pay')}</Title>

      {calculation ? (
        <Card style={{ gap: spacing.md }}>
          <SectionTitle>{t('pay.current')}</SectionTitle>
          <Caption>{day(calculation.period.start)} – {day(calculation.period.end)} • {t('pay.payday')} {day(calculation.period.payday)}</Caption>
          <View style={{ gap: spacing.xs }}>
            <Caption>{t('pay.estimatedTakeHome')}</Caption>
            <Numeral size="hero">{money(calculation.deductions.net)}</Numeral>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Metric label={t('app.gross')} value={money(calculation.gross.gross)} />
            <Metric label="Deductions" value={money(calculation.deductions.totalDeductions)} />
            <Metric label={t('app.worked')} value={`${hours(calculation.totalPaidMinutes)} h`} />
          </View>
          <ConfidenceBadge level={calculation.confidence.level} />
          <Button label={t('app.seeBreakdown')} onPress={() => router.push('/pay/breakdown')} />
        </Card>
      ) : null}

      {!profile.ytd ? (
        <Banner
          body="Adding your year-to-date CPP and EI makes annual maximums exact."
          tone="info"
          action={{ label: t('pay.improve'), onPress: () => router.push('/settings/estimates') }}
        />
      ) : null}

      <Card style={{ gap: 0 }}>
        <ListRow icon="receipt-outline" title={t('pay.breakdown')} subtitle={t('home.breakdown')} onPress={() => router.push('/pay/breakdown')} />
        <ListRow icon="checkmark-done-outline" title={t('pay.check')} subtitle="Compare the deposit with our estimate" onPress={() => router.push('/pay/check')} />
        <ListRow icon="add-circle-outline" title={t('pay.extra')} subtitle="See the take-home a new shift would add" onPress={() => router.push('/pay/extra')} />
        <ListRow icon="time-outline" title={t('pay.previous')} subtitle="Past estimates and actual deposits" onPress={() => router.push('/pay/history')} />
      </Card>

      {history.length > 1 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{t('pay.previous')}</SectionTitle>
          {history.slice(0, 3).map((period) => {
            const cached = period.index === calculation?.period.index ? calculation : null;
            return (
              <ListRow
                key={period.start}
                title={`${day(period.start)} – ${day(period.end)}`}
                subtitle={`${t('pay.payday')} ${day(period.payday)}`}
                value={cached ? money(cached.deductions.net) : undefined}
                onPress={() => router.push({ pathname: '/pay/breakdown', params: { period: period.start } })}
              />
            );
          })}
        </Card>
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('settings.pro')}</SectionTitle>
        {state.entitlement.isPro ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={18} color={'#1B7F4B'} />
            <Body>Pro is active — thanks for supporting the app.</Body>
          </View>
        ) : (
          <>
            <Body muted>{'Make every paycheque make more sense — no ads, multiple jobs, full history and exports.'}</Body>
            <Button label={t('paywall.cta')} variant="secondary" onPress={() => router.push('/paywall')} />
          </>
        )}
      </Card>
    </Screen>
  );
}
