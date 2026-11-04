/**
 * Add Job — a focused flow for a new employer, reusing the onboarding engine
 * (validation, job construction, first-shift defaults) instead of duplicating it.
 *
 * Free users reach this only when they have no active job (for example after
 * archiving their old one); the Settings entry point routes Pro users here too.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { defaultAnchorKey } from '../../core/dateInput.ts';
import { validateDraft, buildJobFromDraft, buildOnboardingShifts } from '../../core/onboarding.ts';
import { JURISDICTIONS, type Job, type JurisdictionCode } from '../../core/types.ts';
import { jurisdictionLabel } from '../../rules/loader.ts';
import { useAppStore } from '../../state/store.ts';
import { haptic } from '../../services/haptics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  DateInput,
  Field,
  Input,
  MoneyInput,
  Screen,
  SectionTitle,
  SegmentedControl,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

const PROVINCE_ZONE: Record<Exclude<JurisdictionCode, 'FED'>, Job['zone']> = {
  AB: 'America/Edmonton',
  BC: 'America/Vancouver',
  MB: 'America/Winnipeg',
  NB: 'America/Halifax',
  NL: 'America/St_Johns',
  NS: 'America/Halifax',
  NT: 'America/Edmonton',
  NU: 'America/Iqaluit',
  ON: 'America/Toronto',
  PE: 'America/Halifax',
  QC: 'America/Toronto',
  SK: 'America/Regina',
  YT: 'America/Whitehorse',
};

const COLOURS = ['#D52B1E', '#1F5F92', '#1B7F4B', '#B26A00', '#6D4BB5', '#0E1B2A'];

export default function NewJobScreen() {
  const { theme, t } = useAppUi();
  const state = useAppStore();
  const [name, setName] = useState('');
  const [colour, setColour] = useState(COLOURS[0]);
  const [province, setProvince] = useState<Exclude<JurisdictionCode, 'FED'>>('ON');
  const [federal, setFederal] = useState(false);
  const [rate, setRate] = useState('');
  const [frequency, setFrequency] = useState<Job['paySchedule']['frequency']>('biweekly');
  const [anchor, setAnchor] = useState(defaultAnchorKey());
  const [paydayOffset, setPaydayOffset] = useState('5');
  const [weekStartsOn, setWeekStartsOn] = useState(0);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const draft = {
      jobName: name,
      rateText: rate,
      province,
      federal,
      zone: PROVINCE_ZONE[province],
      frequency,
      anchorDateText: anchor,
      paydayOffsetText: paydayOffset,
      weekStartsOn,
      shiftStart,
      shiftEnd,
      breakMinutesText: breakMinutes,
      rotationId: 'none',
      customRule: false,
      agreement: 'not_sure' as const,
      goals: { nextPay: true, trackShifts: true, overtime: false, checkCheque: false, extraShifts: false },
    };
    const validation = validateDraft(draft);
    if (!validation.valid) {
      setError(
        validation.errors.anchorDate ??
          validation.errors.rate ??
          validation.errors.paydayOffset ??
          validation.errors.shiftTimes ??
          t('jobs.checkFields'),
      );
      return;
    }
    setSaving(true);
    setError(null);
    const jobId = `job-${Date.now()}`;
    const job = buildJobFromDraft(draft, validation, { jobId });
    job.colour = colour;
    try {
      await state.saveJob(job, { makeActive: true });
      await state.saveShifts(buildOnboardingShifts(job, draft, validation, state.today));
      void haptic('success');
      router.replace('/(tabs)');
    } catch (cause) {
      setSaving(false);
      setError(t('jobs.saveFailed', { reason: cause instanceof Error ? cause.message : 'unknown error' }));
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('jobs.addJob')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {error ? <Banner tone="attention" body={error} /> : null}

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('jobs.basicDetails')}</SectionTitle>
        <Field label={t('jobs.jobName')}>
          <Input value={name} onChangeText={setName} placeholder={t('onboarding.s4Placeholder')} autoFocus />
        </Field>
        <Field label={t('jobs.colour')}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {COLOURS.map((candidate) => (
              <Chip key={candidate} label={candidate === colour ? '● selected' : '●'} selected={candidate === colour} onPress={() => setColour(candidate)} />
            ))}
          </View>
        </Field>
        <MoneyInput label={t('onboarding.s4Rate')} value={rate} onChangeText={setRate} hint="Before deductions, per hour" />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('jobs.jurisdiction')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {JURISDICTIONS.filter((code) => code !== 'FED').map((code) => (
            <Chip
              key={code}
              label={code}
              selected={!federal && province === code}
              onPress={() => {
                setFederal(false);
                setProvince(code);
              }}
            />
          ))}
          <Chip label={t('onboarding.s3Federal')} selected={federal} onPress={() => setFederal(true)} />
        </View>
        <Caption>{jurisdictionLabel(federal ? 'FED' : province)}</Caption>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('jobs.paySchedule')}</SectionTitle>
        <SegmentedControl
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: 'weekly', label: t('onboarding.freq.weekly') },
            { value: 'biweekly', label: t('onboarding.freq.biweekly') },
            { value: 'semimonthly', label: t('onboarding.freq.semimonthly') },
            { value: 'monthly', label: t('onboarding.freq.monthly') },
          ]}
        />
        <DateInput label={t('onboarding.s5Anchor')} help={t('onboarding.s5AnchorHelp')} value={anchor} onChangeText={setAnchor} />
        <Field label={t('onboarding.s5Payday')} hint="0 means payday is the last day of the period">
          <Input value={paydayOffset} onChangeText={setPaydayOffset} keyboardType="number-pad" />
        </Field>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('jobs.workWeek')}</SectionTitle>
        <SegmentedControl
          value={String(weekStartsOn)}
          onChange={(value) => setWeekStartsOn(Number(value))}
          options={[
            { value: '0', label: 'Sunday' },
            { value: '1', label: 'Monday' },
            { value: '6', label: 'Saturday' },
          ]}
        />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('jobs.shiftDefaults')}</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label={t('shift.start')}>
              <Input value={shiftStart} onChangeText={setShiftStart} autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('shift.end')}>
              <Input value={shiftEnd} onChangeText={setShiftEnd} autoCapitalize="none" />
            </Field>
          </View>
        </View>
        <Field label={t('onboarding.s7Break')} hint="Leave 0 if your breaks are paid">
          <Input value={breakMinutes} onChangeText={setBreakMinutes} keyboardType="number-pad" />
        </Field>
      </Card>

      <Body muted>{t('jobs.rulesNote')}</Body>

      <Button label={t('jobs.addJob')} onPress={() => void save()} loading={saving} disabled={saving} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="lock-closed-outline" size={14} color={theme.colors.textFaint} />
        <Caption>{t('jobs.localOnly')}</Caption>
      </View>
    </Screen>
  );
}
