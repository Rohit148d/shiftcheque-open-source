/** Precision mode (spec 43): improve the estimate with TD1 claims and YTD data. */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { tryParseMoney } from '../../core/money.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, profileFor } from '../../state/selectors.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, EmptyState, MoneyInput, Screen, SectionTitle, SwitchRow, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function EstimatesSettings() {
  const { t } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const profile = job ? profileFor(state, job.id) : null;
  const [cppExempt, setCppExempt] = useState(profile?.cppExempt ?? false);
  const [eiExempt, setEiExempt] = useState(profile?.eiExempt ?? false);
  const [federalClaim, setFederalClaim] = useState(profile?.federalClaimAmount ? String(Number(profile.federalClaimAmount) / 1_000_000) : '');
  const [ytdCpp, setYtdCpp] = useState(profile?.ytd ? String(Number(profile.ytd.cpp) / 1_000_000) : '');
  const [ytdEi, setYtdEi] = useState(profile?.ytd ? String(Number(profile.ytd.ei) / 1_000_000) : '');
  const [ytdPeriods, setYtdPeriods] = useState(profile?.ytd ? String(profile.ytd.periodsPaid) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!job || !profile) {
    return (
      <Screen>
        <EmptyState title="No job yet" body="Add a job first." />
      </Screen>
    );
  }

  const save = async () => {
    setSaving(true);
    const cpp = tryParseMoney(ytdCpp);
    const ei = tryParseMoney(ytdEi);
    const periods = Number(ytdPeriods) || 0;
    await state.saveProfile({
      ...profile,
      cppExempt,
      eiExempt,
      federalClaimCode: federalClaim ? 'custom' : profile.federalClaimCode,
      federalClaimAmount: tryParseMoney(federalClaim) ?? undefined,
      ytd:
        cpp !== null && ei !== null && periods > 0
          ? { cpp, cpp2: 0n, ei, qpp: 0n, qpip: 0n, periodsPaid: periods }
          : profile.ytd,
    });
    setSaving(false);
    setSaved(true);
  };

  const isQuebec = job.taxProvince === 'QC';

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('pay.improve')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Banner tone="info" body="Everything here is optional. Without it we use standard assumptions and your estimate is labelled a basic one." />

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Payroll programs</SectionTitle>
        <SwitchRow label={isQuebec ? 'QPP/QPIP do not apply' : 'CPP does not apply'} description="Some jobs are exempt (for example certain student or pension arrangements)" value={cppExempt} onChange={setCppExempt} />
        <SwitchRow label="EI does not apply" description="Only a few employment types are EI-exempt" value={eiExempt} onChange={setEiExempt} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Claim amounts</SectionTitle>
        <MoneyInput label="Federal claim amount (TD1)" value={federalClaim} onChangeText={setFederalClaim} hint="Leave blank to use the basic personal amount" />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Year to date</SectionTitle>
        <Caption>Enter what your payslip shows so far this year. This makes CPP and EI maximums exact instead of projected.</Caption>
        <MoneyInput label="CPP or QPP paid so far" value={ytdCpp} onChangeText={setYtdCpp} />
        <MoneyInput label="EI paid so far" value={ytdEi} onChangeText={setYtdEi} />
        <MoneyInput label="Pay periods already paid this year" value={ytdPeriods} onChangeText={setYtdPeriods} />
      </Card>

      <Button label={saved ? 'Saved ✓' : t('app.save')} onPress={() => void save()} loading={saving} />
      <Caption>We never ask for your SIN, bank details or CRA login. This is all local to your phone.</Caption>
      <Body muted style={{ fontSize: 13 }}>
        Using the same claim amounts as your employer keeps the estimate aligned with your actual deductions.
      </Body>
    </Screen>
  );
}
