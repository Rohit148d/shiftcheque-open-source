/** Rule sources + verification status (spec 20/35/45): nothing hidden, nothing guessed. */
import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { jurisdictionLabel } from '../../rules/loader.ts';
import { RULE_SOURCES } from '../../rules/sources.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, RuleSourceCard, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function RulesSettings() {
  const { t, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const calculation = job
    ? calculateForJob(
        { jobs: state.jobs, rates: state.rates, profiles: state.profiles, shifts: state.shifts, ruleBundle: state.ruleBundle, today: state.today },
        job.id,
      )
    : null;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('settings.rules')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Current bundle</SectionTitle>
        <Body>Version {state.ruleBundle.bundleVersion}</Body>
        <Caption>Source: {state.ruleSource === 'bundled' ? 'bundled with the app' : state.ruleSource === 'cache' ? 'last verified update on this device' : 'remote update'}</Caption>
        <Caption>Generated {day(state.ruleBundle.generatedAt)}</Caption>
        {calculation ? (
          <>
            <Caption>Overtime rule in use: {calculation.explanation.overtimeRuleLabel}</Caption>
            <Caption>Payroll parameters: {calculation.explanation.payrollRuleVersion}</Caption>
          </>
        ) : null}
      </Card>

      {job ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>This job</SectionTitle>
          <Body>{jurisdictionLabel(job.jurisdiction)}</Body>
          <Caption>Work week starts {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][job.workWeek.startsOn]}</Caption>
          <Caption>
            Overtime source: {job.overtime.source === 'custom' ? 'custom workplace rule' : 'verified jurisdiction rule'}
          </Caption>
          {job.overtime.hasAgreement === 'yes' ? (
            <Banner tone="attention" body="You told us a collective agreement or averaging arrangement applies. Check that the configured thresholds match it." />
          ) : null}
        </Card>
      ) : null}

      <Banner
        tone="info"
        body="Rules that are not verified never calculate automatically. When we cannot confirm a rule, the app asks you for a custom workplace rule instead of guessing."
      />

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Official sources</SectionTitle>
        {RULE_SOURCES.filter((source) => !job || source.jurisdiction === job.jurisdiction || source.jurisdiction === 'FED')
          .slice(0, 12)
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

      <Caption>Rules are stored with effective dates, so a historical pay period always uses the rule that applied at the time.</Caption>
    </Screen>
  );
}
