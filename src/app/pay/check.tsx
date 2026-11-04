/**
 * Check My Pay (spec 22/23/24) — quick mode (what hit the bank) and detailed
 * mode (payslip lines), with neutral, non-accusatory language.
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { comparePaycheque, type ActualPaychequeInput } from '../../core/chequeComparison.ts';
import { microFromDollars, tryParseMoney, type Micro } from '../../core/money.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, calculateForJob } from '../../state/selectors.ts';
import { ChequeRepository } from '../../db/repositories.ts';
import { maybeShowInterstitial } from '../../services/ads.ts';
import { track } from '../../services/analytics.ts';
import { haptic } from '../../services/haptics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  ComparisonRow,
  EmptyState,
  MoneyInput,
  Numeral,
  Screen,
  SectionTitle,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function CheckPayScreen() {
  const { t, money } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [net, setNet] = useState('');
  const [gross, setGross] = useState('');
  const [regularHours, setRegularHours] = useState('');
  const [overtimeHours, setOvertimeHours] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const comparison = useMemo(() => {
    const actualNet = tryParseMoney(net);
    if (!calculation || actualNet === null) return null;
    const actualGross = tryParseMoney(gross);
    const actual: ActualPaychequeInput = {
      actualNet,
      actualGross: actualGross ?? undefined,
      minutes:
        regularHours || overtimeHours
          ? {
              regularMinutes: Math.round((Number(regularHours) || 0) * 60),
              overtimeMinutes: Math.round((Number(overtimeHours) || 0) * 60),
            }
          : undefined,
      lines: [],
    };
    return comparePaycheque(
      {
        gross: calculation.gross.gross,
        net: calculation.deductions.net,
        regularMinutes: calculation.gross.regularMinutes,
        overtimeMinutes: calculation.gross.overtimeMinutes,
        doubleTimeMinutes: calculation.gross.doubleTimeMinutes,
        premiumPay: calculation.gross.premiumPay,
        vacationPay: calculation.gross.vacationPay,
        lines: calculation.gross.lines.map((line) => ({ label: line.label, amount: line.amount })),
        deductions: calculation.deductions.lines.map((line) => ({ code: line.code, label: line.label, amount: line.amount })),
        cpp: calculation.deductions.contributions.cpp?.amount ?? calculation.deductions.contributions.qpp?.amount ?? 0n,
        ei: calculation.deductions.contributions.ei?.amount ?? 0n,
        tax:
          calculation.deductions.lines
            .filter((line) => line.code === 'FED_TAX' || line.code === 'PROV_TAX')
            .reduce<Micro>((sum, line) => sum + line.amount, 0n) * -1n,
      },
      actual,
    );
  }, [calculation, net, gross, regularHours, overtimeHours]);

  if (!job || !calculation) {
    return (
      <Screen>
        <EmptyState title={t('empty.payTitle')} body={t('empty.payBody')} action={{ label: t('app.addShift'), onPress: () => router.push('/shift/new') }} />
      </Screen>
    );
  }

  const saveCheque = async () => {
    const actualNet = tryParseMoney(net);
    if (actualNet === null || !comparison) return;
    const nowIso = new Date().toISOString();
    const id = `cheque-${job.id}-${calculation.period.start}`;
    await ChequeRepository.save({
      id,
      jobId: job.id,
      periodStart: calculation.period.start,
      periodEnd: calculation.period.end,
      payDate: calculation.period.payday,
      actualNet: actualNet.toString(),
      actualGross: tryParseMoney(gross)?.toString() ?? null,
      notes: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lines: [],
    });
    await ChequeRepository.saveComparison(id, comparison.outcome, comparison.netDifference?.toString() ?? null, JSON.stringify(comparison.rows));
    setSaved(true);
    void haptic('success');
    track('cheque_check_completed');
    if (comparison.outcome === 'looks_close') {
      await state.updateSettings({ lastDiscrepancyAt: null });
    } else {
      await state.updateSettings({ lastDiscrepancyAt: Date.now() });
    }
    // Interstitial is considered only after the user is finished and never on a
    // payday result screen: we stay on the result and let the ad system decide.
    void maybeShowInterstitial(
      {
        onboarded: state.settings.onboarded,
        shiftsRecorded: state.shifts.length,
        payEstimateViewed: true,
        isPro: state.entitlement.isPro,
        meaningfulSessions: 0,
        route: '/pay/check',
      },
      state.monetization,
    );
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('check.title')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('check.quick')}</SectionTitle>
        <MoneyInput label={t('check.actualNet')} value={net} onChangeText={setNet} autoFocus />
        <MoneyInput label={t('check.actualGross')} value={gross} onChangeText={setGross} />
        <Button label={detailed ? 'Hide payslip details' : t('check.compareDetailed')} variant="ghost" onPress={() => setDetailed((value) => !value)} />
        {detailed ? (
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <MoneyInput label="Regular hours" value={regularHours} onChangeText={setRegularHours} />
            </View>
            <View style={{ flex: 1 }}>
              <MoneyInput label="Overtime hours" value={overtimeHours} onChangeText={setOvertimeHours} />
            </View>
          </View>
        ) : null}
      </Card>

      {comparison ? (
        <Card style={{ gap: spacing.md }}>
          <SectionTitle>
            {comparison.outcome === 'looks_close'
              ? t('check.looksClose')
              : comparison.outcome === 'more_information_needed'
                ? t('check.moreInfo')
                : comparison.outcome === 'worth_reviewing'
                  ? t('check.worthReviewing')
                  : t('check.differenceFound')}
          </SectionTitle>
          <Body>{comparison.summary}</Body>

          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Caption>{t('check.ourEstimate')}</Caption>
              <Numeral size="heading">{money(calculation.deductions.net)}</Numeral>
            </View>
            <View style={{ flex: 1 }}>
              <Caption>{t('check.actual')}</Caption>
              <Numeral size="heading">{money(tryParseMoney(net) ?? 0n)}</Numeral>
            </View>
            <View style={{ flex: 1 }}>
              <Caption>{t('check.difference')}</Caption>
              <Numeral size="heading" tone={comparison.netDifference && comparison.netDifference < 0n ? 'attention' : 'default'}>
                {money(comparison.netDifference ?? 0n)}
              </Numeral>
            </View>
          </View>

          <View style={{ gap: 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Caption>{t('check.yourRecords')}</Caption>
              <Caption>{t('check.payslip')}</Caption>
            </View>
            {comparison.rows.map((row) => (
              <ComparisonRow
                key={row.id}
                label={row.label}
                status={row.status}
                unit={row.unit}
                expected={
                  row.unit === 'money'
                    ? row.expected !== undefined
                      ? money(row.expected)
                      : '—'
                    : row.expectedMinutes !== undefined
                      ? `${(row.expectedMinutes / 60).toFixed(1)} h`
                      : '—'
                }
                actual={
                  row.unit === 'money'
                    ? row.actual !== undefined
                      ? money(row.actual)
                      : '—'
                    : row.actualMinutes !== undefined
                      ? `${(row.actualMinutes / 60).toFixed(1)} h`
                      : '—'
                }
              />
            ))}
          </View>

          <SectionTitle>{t('check.possibleExplanations')}</SectionTitle>
          {comparison.possibleExplanations.map((explanation) => (
            <Caption key={explanation}>• {explanation}</Caption>
          ))}

          <Banner
            tone="info"
            body="We never contact your employer. This is a personal record to help you ask the right question if something looks off."
          />

          <Button label={saved ? 'Saved ✓' : 'Save this check'} onPress={() => void saveCheque()} disabled={saved} />
        </Card>
      ) : (
        <Card style={{ gap: spacing.sm }}>
          <Body muted>Enter the amount that landed in your bank account to compare it with our estimate.</Body>
        </Card>
      )}

      <Caption>Your payslip is the official record. This check only compares numbers you entered.</Caption>
    </Screen>
  );
}
