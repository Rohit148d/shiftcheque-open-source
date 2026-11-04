/**
 * Pay breakdown (spec 19/20/21): every line is expandable and every number can
 * be traced back to the rule that produced it.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { jurisdictionLabel } from '../../rules/loader.ts';
import { sourceById } from '../../rules/sources.ts';
import type { EarningsLine } from '../../core/types.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob, profileFor, type StoreSlice } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { StackedBar, Legend } from '../../ui/charts.tsx';
import {
  Banner,
  Body,
  BottomSheet,
  BreakdownRow,
  Button,
  Caption,
  Card,
  ConfidenceBadge,
  EmptyState,
  Numeral,
  RuleSourceCard,
  Screen,
  SectionTitle,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function PayBreakdownScreen() {
  const params = useLocalSearchParams<{ period?: string; jobId?: string; highlight?: string }>();
  const { t, money, hours, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const input: StoreSlice = {
    jobs: state.jobs,
    rates: state.rates,
    profiles: state.profiles,
    shifts: state.shifts,
    ruleBundle: state.ruleBundle,
    today: state.today,
  };

  const jobId = params.jobId ?? job?.id;
  const calculation = useMemo(
    () => (jobId ? calculateForJob(input, jobId, params.period) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId, params.period, state.dataVersion, state.today],
  );

  const highlighted = params.highlight ? calculation?.gross.byShift.get(params.highlight) : null;
  const profile = jobId ? profileFor(state, jobId) : null;

  /** Worked vs scheduled amounts per earnings line, for the transparent breakdown. */
  const splitByLabel = useMemo(() => {
    const map = new Map<string, { worked?: EarningsLine; scheduled?: EarningsLine }>();
    if (!calculation) return map;
    for (const line of calculation.projection.worked.lines) {
      map.set(line.label, { ...(map.get(line.label) ?? {}), worked: line });
    }
    for (const line of calculation.projection.scheduled.lines) {
      map.set(line.label, { ...(map.get(line.label) ?? {}), scheduled: line });
    }
    return map;
  }, [calculation]);

  if (!calculation || !job) {
    return (
      <Screen>
        <EmptyState title={t('empty.payTitle')} body={t('empty.payBody')} action={{ label: t('app.addShift'), onPress: () => router.push('/shift/new') }} />
      </Screen>
    );
  }

  const gross = calculation.gross;
  const deductions = calculation.deductions;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Caption>{job.name}</Caption>
          <Title>{t('pay.breakdown')}</Title>
        </View>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {highlighted ? (
        <Banner
          tone="positive"
          icon="checkmark-circle-outline"
          title={t('shift.added')}
          body={`${hours(highlighted.workedMinutes)} h • ${money(highlighted.total)} gross • Next pay estimate: ${money(deductions.net)}`}
        />
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <Caption>
          {day(calculation.period.start, 'long')} → {day(calculation.period.end, 'long')}
        </Caption>
        <View style={{ gap: spacing.xs }}>
          <Caption>{t('pay.estimatedTakeHome')}</Caption>
          <Numeral size="hero" tone="positive">
            {money(deductions.net)}
          </Numeral>
        </View>
        <StackedBar
          segments={[
            { label: 'Take-home', value: Number(deductions.net), colour: '#1B7F4B' },
            { label: 'Deductions', value: Number(deductions.totalDeductions), colour: '#D52B1E' },
          ]}
        />
        <Legend
          items={[
            { label: 'Take-home', colour: '#1B7F4B', value: money(deductions.net) },
            { label: 'Deductions', colour: '#D52B1E', value: money(deductions.totalDeductions) },
          ]}
        />
        <ConfidenceBadge level={calculation.confidence.level} onPress={() => setShowExplanation(true)} />
      </Card>

      {calculation.projection.scheduledMinutes > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{t('pay.projectionSummary')}</SectionTitle>
          <BreakdownRow
            label={t('pay.worked')}
            minutes={`${hours(calculation.projection.workedMinutes)} h`}
            value={money(calculation.projection.worked.gross)}
            detail="Already worked in this pay period"
          />
          <BreakdownRow
            label={t('pay.scheduled')}
            minutes={`${hours(calculation.projection.scheduledMinutes)} h`}
            value={money(calculation.projection.scheduled.gross)}
            detail="Scheduled shifts still to come"
          />
          <BreakdownRow
            label={t('pay.projected')}
            minutes={`${hours(calculation.projection.projectedMinutes)} h`}
            value={money(calculation.projection.projected.gross)}
            emphasis="total"
          />
          <Caption>{t('home.includesScheduled')}</Caption>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('home.breakdown')}</SectionTitle>
        {gross.lines.length === 0 ? <Body muted>No earnings recorded for this period yet.</Body> : null}
        {gross.lines.map((line) => (
          <BreakdownRow
            key={`${line.kind}-${line.label}`}
            label={line.label}
            minutes={line.minutes ? `${hours(line.minutes)} h${line.rate ? ` × ${money(line.rate)}` : ''}` : undefined}
            value={money(line.amount)}
            detail={line.detail}
            expanded={expanded === `e-${line.label}`}
            onPress={() => setExpanded(expanded === `e-${line.label}` ? null : `e-${line.label}`)}
          >
            {(() => {
              const split = splitByLabel.get(line.label);
              if (!split?.scheduled) {
                return (
                  <Caption>
                    {line.kind === 'premium'
                      ? 'Premium rules come from your job settings. Non-stackable premiums keep the highest priority one.'
                      : 'Calculated from your shifts, rate history and the rules shown in "How did you calculate this?".'}
                  </Caption>
                );
              }
              return (
                <>
                  {split.worked && split.worked.amount !== 0n ? (
                    <BreakdownRow
                      label={`${t('pay.worked')} — ${line.label}`}
                      minutes={split.worked.minutes ? `${hours(split.worked.minutes)} h${split.worked.rate ? ` × ${money(split.worked.rate)}` : ''}` : undefined}
                      value={money(split.worked.amount)}
                    />
                  ) : null}
                  <BreakdownRow
                    label={`${t('pay.scheduled')} — ${line.label}`}
                    minutes={split.scheduled.minutes ? `${hours(split.scheduled.minutes)} h${split.scheduled.rate ? ` × ${money(split.scheduled.rate)}` : ''}` : undefined}
                    value={money(split.scheduled.amount)}
                  />
                </>
              );
            })()}
          </BreakdownRow>
        ))}
        <BreakdownRow label={t('pay.gross')} value={money(gross.gross)} emphasis="total" />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('pay.estimatedDeductions')}</SectionTitle>
        {deductions.lines.map((line) => (
          <BreakdownRow
            key={`${line.code}-${line.label}`}
            label={line.label}
            value={money(line.amount)}
            detail={expanded === `d-${line.label}` ? line.detail : undefined}
            expanded={expanded === `d-${line.label}`}
            onPress={() => setExpanded(expanded === `d-${line.label}` ? null : `d-${line.label}`)}
          >
            {line.capped ? <Caption>The annual maximum is reached{line.annualMaximum ? ` (${money(line.annualMaximum)})` : ''}.</Caption> : null}
          </BreakdownRow>
        ))}
        <BreakdownRow label={t('pay.estimatedTakeHome')} value={money(deductions.net)} emphasis="total" tone="positive" />
      </Card>

      {gross.vacation.accrualOnly ? (
        <Banner tone="info" body={gross.vacation.explanation} icon="umbrella-outline" />
      ) : null}

      <Button label={t('pay.howCalculated')} variant="secondary" onPress={() => setShowExplanation(true)} />

      {calculation.ruleNotes.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>Worth knowing</SectionTitle>
          {calculation.ruleNotes.map((note) => (
            <View key={note} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Ionicons name="information-circle-outline" size={16} color={'#B26A00'} style={{ marginTop: 2 }} />
              <Caption style={{ flex: 1 }}>{note}</Caption>
            </View>
          ))}
        </Card>
      ) : null}

      <BottomSheet visible={showExplanation} onClose={() => setShowExplanation(false)} title={t('pay.howCalculated')} primaryAction={{ label: t('app.close'), onPress: () => setShowExplanation(false) }}>
        <View style={{ gap: spacing.md }}>
          <Card style={{ gap: spacing.sm }}>
            <SectionTitle>{t('pay.rulesUsed')}</SectionTitle>
            <BreakdownRow label={t('pay.workWeek')} value={weekStartName(calculation.explanation.workWeekStart)} />
            <BreakdownRow label={t('pay.payPeriod')} value={`${day(calculation.period.start)} – ${day(calculation.period.end)}`} />
            <BreakdownRow label={t('pay.payday')} value={day(calculation.period.payday, 'long')} />
            <BreakdownRow label="Jurisdiction" value={jurisdictionLabel(job.jurisdiction)} />
            <BreakdownRow label="Tax province" value={job.taxProvince} />
            <BreakdownRow label={t('pay.overtimeRule')} value={calculation.explanation.overtimeRuleLabel} />
            <BreakdownRow label={t('pay.ruleVersion')} value={`${calculation.explanation.payrollRuleVersion} (${calculation.explanation.payrollRuleYear})`} />
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <SectionTitle>{t('pay.rateUsed')}</SectionTitle>
            {calculation.explanation.rateSummary.map((rate) => (
              <BreakdownRow
                key={rate.date}
                label={money(rate.rate)}
                detail={`effective ${day(rate.date, 'long')}`}
              />
            ))}
          </Card>

          {calculation.explanation.payrollFallbackReason ? (
            <Banner tone="attention" body={calculation.explanation.payrollFallbackReason} />
          ) : null}

          <Card style={{ gap: spacing.sm }}>
            <SectionTitle>{t('confidence.whatWeKnow')}</SectionTitle>
            {calculation.confidence.known.map((item) => (
              <Caption key={item}>• {item}</Caption>
            ))}
            <SectionTitle>{t('confidence.whatWeAssume')}</SectionTitle>
            {calculation.confidence.assumptions.map((item) => (
              <Caption key={item}>• {item}</Caption>
            ))}
            {calculation.confidence.improvements.length > 0 ? (
              <>
                <SectionTitle>{t('confidence.improve')}</SectionTitle>
                {calculation.confidence.improvements.map((item) => (
                  <Caption key={item}>• {item}</Caption>
                ))}
              </>
            ) : null}
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <SectionTitle>{t('pay.sources')}</SectionTitle>
            {calculation.explanation.sourceUrls
              .map((id) => sourceById(id))
              .filter((source): source is NonNullable<ReturnType<typeof sourceById>> => Boolean(source))
              .map((source) => (
                <RuleSourceCard
                  key={source.id}
                  title={source.title}
                  publisher={source.publisher}
                  url={source.url}
                  lastVerified={source.lastVerifiedAt}
                  status="verified"
                />
              ))}
          </Card>

          {profile?.ytd ? <Caption>Year-to-date amounts were applied to annual maximums.</Caption> : null}
        </View>
      </BottomSheet>
    </Screen>
  );
}

function weekStartName(startsOn: number): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[startsOn] ?? 'Sunday'} – Saturday`;
}
