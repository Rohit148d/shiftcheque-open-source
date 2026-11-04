/**
 * Insights (spec 47) — emotionally useful numbers instead of a data dump.
 * Free: recent 90 days. Pro: full history.
 */
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { addDays } from '../../core/tz.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, insightsForJob } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { BannerAdSlot } from '../../ui/AdSlot.tsx';
import { BarChart, ChartCard } from '../../ui/charts.tsx';
import { Banner, Body, Button, Caption, Card, EmptyState, Metric, Numeral, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function InsightsScreen() {
  const { t, money, hours, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);

  const freeLimitDays = state.monetization.chartHistoryFreeDays;
  const isPro = state.entitlement.isPro;

  const summary = useMemo(
    () =>
      job
        ? insightsForJob(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            job.id,
            isPro ? 26 : 8,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion, isPro],
  );

  if (!job || !summary) {
    return (
      <Screen>
        <EmptyState
          title={t('empty.payTitle')}
          body={t('empty.payBody')}
          action={{ label: t('app.addShift'), onPress: () => router.push('/shift/new') }}
        />
      </Screen>
    );
  }

  const cutoff = addDays(state.today, -freeLimitDays);
  const visiblePeriods = isPro ? summary.periods : summary.periods.filter((row) => row.period.start >= cutoff);
  const totals = visiblePeriods.reduce(
    (acc, row) => ({
      gross: acc.gross + row.gross,
      net: acc.net + row.net,
      workedMinutes: acc.workedMinutes + row.workedMinutes,
      overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
      premiumPay: acc.premiumPay + row.premiumPay,
    }),
    { gross: 0n, net: 0n, workedMinutes: 0, overtimeMinutes: 0, premiumPay: 0n },
  );
  const monthKey = state.today.slice(0, 7);
  const monthRows = visiblePeriods.filter((row) => row.period.start.startsWith(monthKey));
  const monthTotals = monthRows.reduce(
    (acc, row) => ({
      gross: acc.gross + row.gross,
      net: acc.net + row.net,
      workedMinutes: acc.workedMinutes + row.workedMinutes,
      overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
      premiumPay: acc.premiumPay + row.premiumPay,
    }),
    { gross: 0n, net: 0n, workedMinutes: 0, overtimeMinutes: 0, premiumPay: 0n },
  );

  const weekly = summary.weeklyOvertime.slice(-8);
  const takeHomeSeries = visiblePeriods.slice(-8).map((row) => ({
    label: day(row.period.start, 'short').replace(/^\w+ /, ''),
    value: Number(row.net) / 1_000_000,
  }));

  return (
    <Screen>
      <Title>{t('insights.title')}</Title>

      {monthRows.length > 0 ? (
        <Card style={{ gap: spacing.md }}>
          <SectionTitle>{t('insights.thisMonth')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Metric label={t('insights.hours')} value={`${hours(monthTotals.workedMinutes)} h`} />
            <Metric label={t('insights.gross')} value={money(monthTotals.gross)} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Metric label={t('insights.takeHome')} value={money(monthTotals.net)} tone="positive" />
            <Metric
              label={t('insights.overtime')}
              value={`${hours(monthTotals.overtimeMinutes)} h`}
              tone={monthTotals.overtimeMinutes > 0 ? 'attention' : 'default'}
            />
            <Metric label={t('insights.premiums')} value={money(monthTotals.premiumPay)} />
          </View>
          {monthRows.some((row) => row.scheduledMinutes > 0) ? <Caption>{t('home.includesScheduled')}</Caption> : null}
        </Card>
      ) : (
        <Card style={{ gap: spacing.sm }}>
          <Body muted>No shifts in this month yet — add a few and your insights will appear here.</Body>
        </Card>
      )}

      {takeHomeSeries.length > 1 ? (
        <ChartCard title={t('insights.takeHomeTrend')} footer={`Last ${takeHomeSeries.length} pay periods`}>
          <BarChart
            data={takeHomeSeries.map((datum, index) => ({ ...datum, highlight: index === takeHomeSeries.length - 1 }))}
            valueFormatter={(value) => `$${Math.round(value)}`}
            summary={`Take-home trend: ${takeHomeSeries.map((datum) => `${datum.label} $${Math.round(datum.value)}`).join(', ')}`}
          />
        </ChartCard>
      ) : null}

      {weekly.length > 1 ? (
        <ChartCard title={t('insights.overtimeTrend')} footer="Overtime hours per work week">
          <BarChart
            data={weekly.map((week) => ({ label: day(week.weekStart, 'short').replace(/^\w+ /, ''), value: week.overtimeMinutes / 60 }))}
            valueFormatter={(value) => `${value.toFixed(1)} h`}
            summary={`Overtime per week: ${weekly.map((week) => `${week.weekStart} ${(week.overtimeMinutes / 60).toFixed(1)} hours`).join(', ')}`}
          />
        </ChartCard>
      ) : null}

      {totals.workedMinutes > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>Recent total</SectionTitle>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body muted>{t('insights.gross')}</Body>
            <Numeral size="body">{money(totals.gross)}</Numeral>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body muted>{t('insights.takeHome')}</Body>
            <Numeral size="body" tone="positive">
              {money(totals.net)}
            </Numeral>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body muted>{t('insights.overtime')}</Body>
            <Numeral size="body">{hours(totals.overtimeMinutes)} h</Numeral>
          </View>
          <Caption>Estimate vs actual differences appear here once you start checking paycheques.</Caption>
        </Card>
      ) : null}

      {!isPro ? (
        <Banner
          tone="info"
          body={t('insights.freeLimit', { days: freeLimitDays })}
          action={{ label: t('paywall.cta'), onPress: () => router.push('/paywall') }}
        />
      ) : null}

      {!isPro ? <Button label={t('paywall.cta')} variant="ghost" onPress={() => router.push('/paywall')} /> : null}
      {isPro ? <Caption>Pro is active — full history and exports are included.</Caption> : null}

      <BannerAdSlot route="/insights" />
    </Screen>
  );
}
