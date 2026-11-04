/**
 * "What is another shift worth?" (spec 25) — the incremental take-home value of
 * a hypothetical shift, including overtime and deduction effects.
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { microFromDollars } from '../../core/money.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, runExtraShift } from '../../state/selectors.ts';
import { haptic } from '../../services/haptics.ts';
import { track } from '../../services/analytics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Metric,
  Numeral,
  Screen,
  SectionTitle,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function ExtraShiftScreen() {
  const { t, money, hours, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);

  const [date, setDate] = useState(state.today);
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('07:00');
  const [showResult, setShowResult] = useState(false);

  const result = useMemo(
    () =>
      showResult && job
        ? runExtraShift(
            { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
            { jobId: job.id, dateKey: date, startClock: start, endClock: end },
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showResult, job?.id, date, start, end, state.dataVersion],
  );

  if (!job) {
    return (
      <Screen>
        <EmptyState title={t('empty.payTitle')} body={t('empty.payBody')} action={{ label: 'Set up a job', onPress: () => router.push('/onboarding') }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('extra.title')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.md }}>
        <Field label={t('extra.date')} hint={day(date, 'long')}>
          <Input value={date} onChangeText={setDate} autoCapitalize="none" placeholder={state.today} />
        </Field>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label={t('extra.start')}>
              <Input value={start} onChangeText={setStart} autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('extra.end')}>
              <Input value={end} onChangeText={setEnd} autoCapitalize="none" />
            </Field>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {(
            [
              ['07:00', '15:00', 'Day'],
              ['15:00', '23:00', 'Evening'],
              ['23:00', '07:00', 'Night'],
              ['07:00', '19:00', '12h day'],
              ['19:00', '07:00', '12h night'],
            ] as const
          ).map(([startClock, endClock, label]) => (
            <Chip
              key={label}
              label={label}
              selected={start === startClock && end === endClock}
              onPress={() => {
                setStart(startClock);
                setEnd(endClock);
              }}
            />
          ))}
        </View>
        <Button
          label={t('extra.calculate')}
          onPress={() => {
            setShowResult(true);
            track('extra_shift_used');
            void haptic('light');
          }}
        />
      </Card>

      {result ? (
        <Card style={{ gap: spacing.md }}>
          <SectionTitle>
            {day(result.dateKey, 'weekday')} • {start} – {end}
          </SectionTitle>
          <View style={{ gap: spacing.xs }}>
            <Caption>{t('extra.extraTakeHome')}</Caption>
            <Numeral size="hero" tone={result.extraTakeHome > 0n ? 'positive' : 'default'}>
              {money(result.extraTakeHome)}
            </Numeral>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Metric label={t('extra.extraGross')} value={money(result.extraGross)} />
            <Metric label="Regular" value={`${hours(result.regularMinutes)} h`} />
            <Metric
              label="Overtime"
              value={`${hours(result.overtimeMinutes + result.doubleTimeMinutes)} h`}
              tone={result.overtimeMinutes + result.doubleTimeMinutes > 0 ? 'attention' : 'default'}
            />
          </View>
          {result.includesOvertime ? (
            <Banner tone="positive" icon="flash-outline" body={t('extra.includesOt')} />
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Caption>{t('extra.newNextPay')}</Caption>
            <Numeral size="body">{money(result.newTakeHome)}</Numeral>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Caption>Before this shift</Caption>
            <Numeral size="body" tone="muted">
              {money(result.previousTakeHome)}
            </Numeral>
          </View>
          {result.overtimeThresholdMinutes !== null ? (
            <Caption>
              Work week: {hours(result.workWeekBeforeMinutes)} h → {hours(result.workWeekAfterMinutes)} h of a {hours(result.overtimeThresholdMinutes)} h threshold
            </Caption>
          ) : null}
          <Caption>{t('extra.disclaimer')}</Caption>
          <Caption>We never suggest that you work more — this is information, not advice.</Caption>
        </Card>
      ) : null}

      {!result ? (
        <Card style={{ gap: spacing.sm }}>
          <Body muted>
            The estimate includes extra overtime, premiums, CPP, CPP2, EI and income tax effects, then shows the difference in take-home pay.
          </Body>
        </Card>
      ) : null}

      <Caption>Estimates use the same verified rules as your regular pay estimate.</Caption>
      <View style={{ height: spacing.xl }} />
      <Button label={t('app.addShift')} variant="secondary" onPress={() => router.push(`/shift/new?date=${date}`)} />
    </Screen>
  );
}
