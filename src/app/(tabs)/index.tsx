/**
 * Home (spec 8/9/10/11) — the heart of the app.
 *
 * Within three seconds the user should know: what they will be paid, when, and
 * how close they are to overtime.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { APP_NAME } from '../../config/brand.ts';
import { confidenceLabel } from '../../core/confidence.ts';
import { microFromDollars, type Micro } from '../../core/money.ts';
import { payPeriodFor } from '../../core/workweek.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob, nextShiftFor, type StoreSlice } from '../../state/selectors.ts';
import { track } from '../../services/analytics.ts';
import { haptic } from '../../services/haptics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { ProgressBar } from '../../ui/charts.tsx';
import {
  AddShiftButton,
  Banner,
  Body,
  Button,
  Caption,
  Card,
  ConfidenceBadge,
  EmptyState,
  Metric,
  Numeral,
  Screen,
  SectionTitle,
  Skeleton,
  Title,
} from '../../ui/components.tsx';
import { fontSizes, radius, spacing, tabularNums } from '../../ui/theme.ts';

export default function HomeScreen() {
  const { theme, t, money, hours, day, clock, signedMoney } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);

  const calculationInput: StoreSlice = {
    jobs: state.jobs,
    rates: state.rates,
    profiles: state.profiles,
    shifts: state.shifts,
    ruleBundle: state.ruleBundle,
    today: state.today,
  };

  const calculation = useMemo(
    () => (job ? calculateForJob(calculationInput, job.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion, state.today, state.ruleBundle],
  );

  const nextShift = useMemo(() => nextShiftFor(state, job?.id ?? null), [state.shifts, job?.id, state.today]);
  const paydayPeriod = job ? payPeriodFor(state.today, job.paySchedule) : null;

  useEffect(() => {
    if (calculation) track('pay_estimate_viewed');
  }, [calculation?.period.payday]);

  if (!state.ready) return <Screen><Skeleton height={120} /></Screen>;

  if (!job) {
    return (
      <Screen>
        {!state.settings.onboarded ? (
          <Banner
            tone="info"
            icon="eye-outline"
            title={t('home.exploreTitle', { app: APP_NAME })}
            body={t('home.exploreBody')}
          />
        ) : null}
        <EmptyState
          icon="briefcase-outline"
          title={t('home.setupCta')}
          body="Tell us your province, rate and pay frequency and we will estimate your take-home pay."
          action={{ label: t('home.setupCta'), onPress: () => router.push('/onboarding') }}
        />
        <AddShiftButton onPress={() => router.push('/onboarding')} />
      </Screen>
    );
  }

  const greeting = greetingFor(state.today, nextShift?.shift.scheduledOvernight ?? false);
  const daysToPayday = calculation ? daysBetween(state.today, calculation.period.payday) : null;
  const confidence = calculation?.confidence;

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Title style={{ fontSize: fontSizes.heading }}>{greeting}</Title>
        {daysToPayday !== null && daysToPayday >= 0 && daysToPayday <= 3 ? (
          <Caption>
            {daysToPayday === 0
              ? t('home.paydayToday')
              : daysToPayday === 1
                ? t('home.paydayTomorrow')
                : t('home.paydayIn', { days: daysToPayday })}
          </Caption>
        ) : (
          <Caption>
            {job.name} • {calculation ? day(calculation.period.end) : ''}
          </Caption>
        )}
      </View>

      {calculation ? (
        <Card style={{ gap: spacing.md, paddingVertical: spacing.xl }}>
          <View style={{ gap: 2 }}>
            <Caption>{t('app.nextPay')}</Caption>
            <Title style={{ fontSize: fontSizes.title }}>
              {day(calculation.period.payday, 'long')}
            </Title>
          </View>
          <View style={{ gap: spacing.xs }}>
            <Caption>{t('app.estimatedTakeHome')}</Caption>
            <Numeral size="hero" accessibilityLabel={`${t('app.estimatedTakeHome')} ${money(calculation.deductions.net)}`}>
              {money(calculation.deductions.net)}
            </Numeral>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Metric label={t('app.gross')} value={money(calculation.gross.gross)} />
            <Metric label={t('home.projectedHours')} value={`${hours(calculation.projection.projectedMinutes)} h`} />
            <Metric
              label={t('app.overtime')}
              value={`${hours(calculation.projection.projected.overtimeMinutes + calculation.projection.projected.doubleTimeMinutes)} h`}
              tone={calculation.projection.projected.overtimeMinutes > 0 ? 'attention' : 'default'}
            />
          </View>
          <Body muted style={{ fontSize: 13 }}>
            {t('home.workedScheduled', {
              worked: hours(calculation.projection.workedMinutes),
              scheduled: hours(calculation.projection.scheduledMinutes),
            })}
          </Body>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ConfidenceBadge level={calculation.confidence.level} onPress={() => router.push('/pay/breakdown')} />
            <Pressable
              onPress={() => {
                void haptic('light');
                track('pay_breakdown_viewed');
                router.push('/pay/breakdown');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('app.seeBreakdown')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Body style={{ color: theme.colors.accent, fontWeight: '600' }}>{t('app.seeBreakdown')}</Body>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
            </Pressable>
          </View>
        </Card>
      ) : (
        <Skeleton height={160} />
      )}

      {calculation && calculation.ruleNotes.length > 0 ? (
        <Banner
          body={calculation.ruleNotes[0]}
          tone="attention"
          icon="alert-circle-outline"
          action={{ label: t('settings.rules'), onPress: () => router.push('/settings/rules') }}
        />
      ) : null}

      {job.hourlyRate === 0n ? (
        <Banner
          body={t('error.addRate')}
          tone="attention"
          action={{ label: t('settings.job'), onPress: () => router.push(`/job/${job.id}`) }}
        />
      ) : null}

      {calculation ? <RadarCard calculation={calculation} /> : null}

      {nextShift ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{t('home.nextShift')}</SectionTitle>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ gap: 2 }}>
              <Title style={{ fontSize: fontSizes.title }}>
                {nextShift.isToday ? t('app.today') : nextShift.isTomorrow ? t('app.tomorrow') : day(nextShift.shift.date, 'weekday')}
              </Title>
              <Body muted>
                {clock(nextShift.shift.scheduledStart)} – {clock(nextShift.shift.scheduledEnd)}
              </Body>
              <Caption>{nextShift.shift.breaks.length > 0 ? `${nextShift.shift.breaks.map((b) => `${b.minutes} min`).join(' + ')} break` : 'No break set'}</Caption>
            </View>
            {calculation ? (
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Caption>{t('app.gross')}</Caption>
                <Numeral size="heading">
                  {money(shiftGross(calculation, nextShift.shift.id))}
                </Numeral>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={t('app.edit')} variant="secondary" onPress={() => router.push(`/shift/${nextShift.shift.id}`)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('home.startShift')} onPress={() => router.push(`/shift/${nextShift.shift.id}?live=1`)} />
            </View>
          </View>
        </Card>
      ) : (
        <EmptyState
          title={t('home.noShifts')}
          body={t('home.noShiftsBody')}
          action={{ label: t('app.addShift'), onPress: () => router.push('/shift/new') }}
        />
      )}

      {calculation && calculation.warnings.length > 0 ? (
        <Banner body={calculation.warnings[0]} tone="info" icon="information-circle-outline" />
      ) : null}

      {confidence && (confidence.assumptions.length > 0 || confidence.improvements.length > 0) ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{confidenceLabel(confidence.level)}</SectionTitle>
          {confidence.assumptions.slice(0, 2).map((assumption) => (
            <View key={assumption} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
              <Body muted style={{ flex: 1 }}>
                {assumption}
              </Body>
            </View>
          ))}
          {confidence.improvements.slice(0, 2).map((improvement) => (
            <View key={improvement} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Ionicons name="arrow-up-circle-outline" size={16} color={theme.colors.accent} style={{ marginTop: 2 }} />
              <Body style={{ flex: 1, color: theme.colors.accent }}>
                {improvement}
              </Body>
            </View>
          ))}
        </Card>
      ) : null}

      <AddShiftButton />
    </Screen>
  );
}

function RadarCard({ calculation }: { calculation: NonNullable<ReturnType<typeof calculateForJob>> }) {
  const { theme, t, hours } = useAppUi();
  const radar = calculation.radar;
  useEffect(() => {
    track('overtime_radar_viewed');
  }, []);

  const threshold = radar.thresholdMinutes;
  // The gauge is forward-looking: it shows the week as it will look if the
  // schedule holds, while the numbers underneath keep worked and scheduled apart.
  const progress = threshold ? Math.min(1, radar.projectedMinutes / threshold) : 0;
  const before = radar.remainingMinutes;
  const hasScheduled = radar.scheduledRemainingMinutes > 0;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>{t('home.overtimeRadar')}</SectionTitle>
        <Caption>{radar.workWeek.label}</Caption>
      </View>
      {threshold !== null ? (
        <>
          <ProgressBar
            progress={progress}
            tone={progress >= 1 ? 'attention' : 'accent'}
            label={t('home.projectedWeek', { hours: hours(radar.projectedMinutes) })}
            caption={
              before !== null && before > 0
                ? t('home.beforeOvertime', { hours: hours(before) })
                : t('home.projectedOvertime', { hours: hours(radar.projectedOvertimeMinutes) })
            }
          />
          <Body muted style={{ fontSize: 13 }}>
            {t('home.workedScheduled', {
              worked: hours(radar.workedMinutes),
              scheduled: hours(radar.scheduledRemainingMinutes),
            })}
          </Body>
          <Caption>{t('home.threshold', { hours: hours(threshold) })}</Caption>
        </>
      ) : (
        <Body muted>
          {t('error.noVerifiedRule')}
        </Body>
      )}
      {radar.dailyThresholdMinutes !== null ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Caption>{t('app.today')}</Caption>
          <Caption>
            {hours(radar.todayMinutes)} h / {hours(radar.dailyThresholdMinutes)} h
            {radar.dailyOvertimeMinutes > 0 ? ` • ${hours(radar.dailyOvertimeMinutes)} h OT` : ''}
          </Caption>
        </View>
      ) : null}
      {radar.projectedOvertimeMinutes > 0 ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Ionicons name="flash-outline" size={16} color={theme.colors.attention} />
          <Body style={{ color: theme.colors.attention, flexShrink: 1 }}>
            {t('home.projectedOvertime', { hours: hours(radar.projectedOvertimeMinutes) })}
            {hasScheduled && radar.overtimeMinutes === 0 ? ` — ${t('home.includesScheduled')}` : ''}
          </Body>
        </View>
      ) : null}
    </Card>
  );
}

function shiftGross(calculation: NonNullable<ReturnType<typeof calculateForJob>>, shiftId: string): Micro {
  const bucket = calculation.gross.byShift.get(shiftId);
  if (!bucket) return microFromDollars('0');
  return bucket.total;
}

function greetingFor(today: string, nightShiftTonight: boolean): string {
  const hour = new Date().getHours();
  if (nightShiftTonight) return 'Night shift tonight';
  if (hour < 12) return 'Morning 👋';
  if (hour < 18) return 'Afternoon 👋';
  return 'Evening 👋';
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export const HOME_METRICS_STYLE = { tabularNums, radius, gap: spacing.md };
