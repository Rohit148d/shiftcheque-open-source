/**
 * Previous pay periods (spec 18) — estimates and the actual deposits saved from
 * cheque checks. Free plan shows recent history; Pro unlocks everything.
 */
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { parseMoney } from '../../db/mappers.ts';
import { ChequeRepository, type ActualCheque } from '../../db/repositories.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob, periodsForJob } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, EmptyState, ListRow, Numeral, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function PayHistoryScreen() {
  const { t, money, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [cheques, setCheques] = useState<ActualCheque[]>([]);

  useEffect(() => {
    void ChequeRepository.list(job?.id ?? null, 40).then(setCheques);
  }, [job?.id, state.dataVersion]);

  const periods = useMemo(
    () =>
      job
        ? periodsForJob(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            job.id,
            12,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion],
  );

  const freeLimitDays = state.monetization.chartHistoryFreeDays;

  if (!job) {
    return (
      <Screen>
        <EmptyState title={t('empty.payTitle')} body={t('empty.payBody')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('pay.previous')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {!state.entitlement.isPro ? (
        <Banner
          tone="info"
          body={`Free history covers the last ${freeLimitDays} days. Pro keeps every period and unlocks exports.`}
          action={{ label: t('paywall.cta'), onPress: () => router.push('/paywall') }}
        />
      ) : null}

      <Card style={{ gap: 0 }}>
        {periods.map((period, index) => {
          const calculation = calculateForJob(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            job.id,
            period.start,
          );
          if (!calculation) return null;
          const cheque = cheques.find((candidate) => candidate.periodStart === period.start);
          const locked = !state.entitlement.isPro && index >= 3;
          return (
            <ListRow
              key={period.start}
              icon="calendar-outline"
              title={`${day(period.start)} – ${day(period.end)}`}
              subtitle={locked ? 'Pro history' : `${t('pay.payday')} ${day(period.payday)}`}
              value={locked ? '•••' : money(calculation.deductions.net)}
              onPress={() => (locked ? router.push('/paywall') : router.push({ pathname: '/pay/breakdown', params: { period: period.start } }))}
            />
          );
        })}
        {periods.length === 0 ? <Body muted>No pay periods yet.</Body> : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('check.title')}</SectionTitle>
        {cheques.length === 0 ? (
          <EmptyState title={t('empty.checkTitle')} body={t('empty.checkBody')} action={{ label: t('check.title'), onPress: () => router.push('/pay/check') }} />
        ) : (
          cheques.map((cheque) => {
            const period = periods.find((candidate) => candidate.start === cheque.periodStart);
            const calculation = period
              ? calculateForJob(
                  { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
                  job.id,
                  period.start,
                )
              : null;
            const actual = parseMoney(cheque.actualNet);
            const difference = calculation ? actual - calculation.deductions.net : 0n;
            return (
              <View key={cheque.id} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
                <Caption>{day(cheque.payDate, 'long')}</Caption>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body muted>{t('check.ourEstimate')}</Body>
                  <Numeral size="body">{calculation ? money(calculation.deductions.net) : '—'}</Numeral>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body muted>{t('check.actual')}</Body>
                  <Numeral size="body">{money(actual)}</Numeral>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body muted>{t('check.difference')}</Body>
                  <Numeral size="body" tone={difference < 0n ? 'attention' : 'positive'}>
                    {money(difference)}
                  </Numeral>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}
