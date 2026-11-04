/**
 * Job settings (spec 26/27/30/31/32/37/38/39): separate rates, work week, pay
 * schedule, overtime, premiums, vacation and rounding for every job.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BRAND } from '../../config/brand.ts';
import {
  applyRateChange,
  deletionConfirmationSatisfied,
  deletionSummaryRows,
  rateChangeImpact,
  type JobDataCounts,
  type RateChangeMode,
} from '../../core/jobChanges.ts';
import { microFromDollars, tryParseMoney } from '../../core/money.ts';
import { JURISDICTIONS, type Job, type PremiumRule } from '../../core/types.ts';
import { JobRepository } from '../../db/repositories.ts';
import { themeById } from '../../ui/theme.ts';
import { useAppStore } from '../../state/store.ts';
import { calculateForJob, previewCalculationFor } from '../../state/selectors.ts';
import { haptic } from '../../services/haptics.ts';
import { jurisdictionLabel } from '../../rules/loader.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  BottomSheet,
  Button,
  Caption,
  Card,
  Chip,
  DateInput,
  Field,
  Input,
  ListRow,
  MoneyInput,
  Numeral,
  Screen,
  SectionTitle,
  SegmentedControl,
  SwitchRow,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function JobSettings() {
  const params = useLocalSearchParams<{ id: string }>();
  const { t, money, day } = useAppUi();
  const state = useAppStore();
  const job = state.jobs.find((candidate) => candidate.id === params.id) ?? state.jobs[0];
  const rates = job ? state.rates[job.id] ?? [] : [];

  const [name, setName] = useState(job?.name ?? '');
  const [rate, setRate] = useState(job ? String(Number(job.hourlyRate) / 1_000_000) : '');
  const [newRate, setNewRate] = useState('');
  const [newRateDate, setNewRateDate] = useState(state.today);
  const [overtimeMode, setOvertimeMode] = useState<Job['overtime']['source']>(job?.overtime.source ?? 'jurisdiction');
  const [dailyHours, setDailyHours] = useState(String(job?.overtime.tiers[0]?.afterDailyHours ?? 8));
  const [weeklyHours, setWeeklyHours] = useState(String(job?.overtime.tiers[0]?.afterWeeklyHours ?? 44));
  const [multiplier, setMultiplier] = useState(String(job?.overtime.tiers[0]?.multiplier ?? 1.5));
  const [agreement, setAgreement] = useState<Job['overtime']['hasAgreement']>(job?.overtime.hasAgreement ?? 'not_sure');
  const [vacationMethod, setVacationMethod] = useState<Job['vacation']['method']>(job?.vacation.method ?? 'not_sure');
  const [vacationPercent, setVacationPercent] = useState(job?.vacation.customPercent ? String(job.vacation.customPercent) : '');
  const [roundingStep, setRoundingStep] = useState(String(job?.rounding.step ?? 0));
  const [roundingMode, setRoundingMode] = useState<Job['rounding']['mode']>(job?.rounding.mode ?? 'exact');
  const [dstPolicy, setDstPolicy] = useState<Job['dstPolicy']>(job?.dstPolicy ?? 'wall_clock');
  const [premiumLabel, setPremiumLabel] = useState('Night premium');
  const [premiumAmount, setPremiumAmount] = useState('1.25');
  const [premiumStart, setPremiumStart] = useState('23:00');
  const [premiumEnd, setPremiumEnd] = useState('07:00');
  const [saved, setSaved] = useState(false);

  // Rate change flow (effective-dated, never silently overwritten).
  const [rateSheetOpen, setRateSheetOpen] = useState(false);
  const [rateMode, setRateMode] = useState<RateChangeMode>('from_today');
  const [rateEffectiveDate, setRateEffectiveDate] = useState(state.today);
  const [rateError, setRateError] = useState<string | null>(null);
  // Scoped change flow for schedule / work week / jurisdiction is planned to
  // reuse planSettingChange(); the value pickers land with that UI.
  // Destructive flow.
  const [deleteStep, setDeleteStep] = useState<'none' | 'explain' | 'confirm'>('none');
  const [deleteCounts, setDeleteCounts] = useState<JobDataCounts | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [archivedNotice, setArchivedNotice] = useState(false);

  const premiums = useMemo(() => job?.premiums ?? [], [job?.premiums]);

  /** Impact preview for a pending rate change, computed with the real engine. */
  const ratePreview = useMemo(() => {
    if (!job) return null;
    const result = rateChangeImpact(
      { mode: rateMode, newRateText: newRate, effectiveDateText: rateEffectiveDate, today: state.today },
      { today: state.today, rates, shifts: state.shifts, fallbackRate: job.hourlyRate, jobId: job.id },
    );
    return result.impact ? { impact: result.impact } : null;
  }, [job, rates, rateMode, newRate, rateEffectiveDate, state.today, state.shifts]);

  const currentNextPay = useMemo(
    () => (job ? calculateForJob(state, job.id)?.deductions.net ?? 0n : 0n),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.id, state.dataVersion, state.today],
  );

  const ratePreviewAfter = useMemo(() => {
    if (!job || !ratePreview) return currentNextPay;
    const applied = applyRateChange(
      { mode: rateMode, newRateText: newRate, effectiveDateText: rateEffectiveDate, today: state.today },
      { today: state.today, rates, jobId: job.id, makeId: () => 'preview' },
    );
    if (!applied.ok || !applied.application) return currentNextPay;
    const latest = applied.application.rates[applied.application.rates.length - 1];
    const calculation = previewCalculationFor(state, { job: { ...job, hourlyRate: latest.rate }, rates: applied.application.rates });
    return calculation?.deductions.net ?? currentNextPay;
  }, [job, rates, rateMode, newRate, rateEffectiveDate, ratePreview, currentNextPay, state]);

  if (!job) {
    return (
      <Screen>
        <Title>No job found</Title>
        <Button label={t('app.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const save = async () => {
    const daily = Number(dailyHours) || null;
    const weekly = Number(weeklyHours) || null;
    const nextJob: Job = {
      ...job,
      name: name.trim() || job.name,
      hourlyRate: tryParseMoney(rate) ?? job.hourlyRate,
      overtime: {
        ...job.overtime,
        source: overtimeMode,
        hasAgreement: agreement,
        dailyOvertimeApplies: overtimeMode === 'jurisdiction' ? job.overtime.dailyOvertimeApplies : daily !== null,
        weeklyOvertimeApplies: weekly !== null,
        tiers:
          overtimeMode === 'custom'
            ? [{ afterDailyHours: daily, afterWeeklyHours: weekly, multiplier: Number(multiplier) || 1.5, label: 'Custom rule' }]
            : [],
      },
      vacation: { method: vacationMethod, customPercent: vacationPercent ? Number(vacationPercent) : undefined },
      rounding: { step: Number(roundingStep) as Job['rounding']['step'], mode: roundingMode },
      dstPolicy,
      updatedAt: new Date().toISOString(),
    };
    await state.saveJob(nextJob);
    setSaved(true);
  };

  const addPremium = async () => {
    const amount = tryParseMoney(premiumAmount) ?? microFromDollars('1.25');
    const rule: PremiumRule = {
      id: `premium-${job.id}-${premiumLabel.toLowerCase().replace(/\s+/g, '-')}`,
      label: premiumLabel,
      type: 'per_hour',
      amount,
      window: { startMinute: toMinutes(premiumStart), endMinute: toMinutes(premiumEnd) },
      stackable: true,
      priority: 10,
      includedInOtBase: false,
      appliesDuringOvertime: true,
      enabled: true,
    };
    await state.saveJob({ ...job, premiums: [...premiums, rule], updatedAt: new Date().toISOString() });
  };

  const removePremium = async (id: string) => {
    await state.saveJob({ ...job, premiums: premiums.filter((rule) => rule.id !== id), updatedAt: new Date().toISOString() });
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{job.name}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {saved ? <Banner tone="positive" body="Job settings saved." onDismiss={() => setSaved(false)} /> : null}

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Basics</SectionTitle>
        <Field label="Job name">
          <Input value={name} onChangeText={setName} />
        </Field>
        <MoneyInput label="Current hourly rate" value={rate} onChangeText={setRate} />
        <Caption>{jurisdictionLabel(job.jurisdiction)} • tax province {job.taxProvince}</Caption>
        <Field label="Regulated by">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {JURISDICTIONS.filter((code) => code !== 'FED').map((code) => (
              <Chip
                key={code}
                label={code}
                selected={job.jurisdiction === code}
                onPress={() => void state.saveJob({ ...job, jurisdiction: code, taxProvince: code as Job['taxProvince'], updatedAt: new Date().toISOString() })}
              />
            ))}
            <Chip label="Federal" selected={job.jurisdiction === 'FED'} onPress={() => void state.saveJob({ ...job, jurisdiction: 'FED', updatedAt: new Date().toISOString() })} />
          </View>
        </Field>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('pay.rateUsed')} history</SectionTitle>
        {rates.length === 0 ? <Caption>No rate history yet — the current rate is used for every shift.</Caption> : null}
        {rates.map((entry) => (
          <View key={entry.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Numeral size="body">{money(entry.rate)}</Numeral>
              <Caption>effective {day(entry.effectiveFrom, 'long')}</Caption>
            </View>
            <Button label="Remove" variant="ghost" fullWidth={false} onPress={() => void state.saveJob({ ...job, updatedAt: new Date().toISOString() }).then(() => import('../../db/repositories.ts').then((repos) => repos.JobRepository.removeRate(entry.id)))} />
          </View>
        ))}
        <Button
          label="Change hourly rate"
          onPress={() => {
            setRateMode('from_today');
            setRateEffectiveDate(state.today);
            setRateError(null);
            setRateSheetOpen(true);
          }}
        />
        <Caption>
          Adds a new rate that applies from the date you choose. Historical shifts keep the rate that was in force on the day they were worked.
        </Caption>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('onboarding.s9Title')}</SectionTitle>
        <SegmentedControl
          value={overtimeMode}
          onChange={setOvertimeMode}
          options={[
            { value: 'jurisdiction', label: 'Standard rule' },
            { value: 'custom', label: 'Custom rule' },
          ]}
        />
        {overtimeMode === 'custom' ? (
          <>
            <Field label="Daily threshold (hours, blank = none)">
              <Input value={dailyHours} onChangeText={setDailyHours} keyboardType="decimal-pad" />
            </Field>
            <Field label="Weekly threshold (hours)">
              <Input value={weeklyHours} onChangeText={setWeeklyHours} keyboardType="decimal-pad" />
            </Field>
            <Field label="Multiplier">
              <Input value={multiplier} onChangeText={setMultiplier} keyboardType="decimal-pad" />
            </Field>
          </>
        ) : (
          <Caption>Standard {jurisdictionLabel(job.jurisdiction)} thresholds are used, with double time where the law provides it.</Caption>
        )}
        <Field label={t('onboarding.s9Agreement')}>
          <SegmentedControl
            value={agreement}
            onChange={setAgreement}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
              { value: 'not_sure', label: 'Not sure' },
            ]}
          />
        </Field>
        {agreement === 'yes' ? (
          <Field label="Averaging period (weeks)">
            <Input
              value={String(job.workWeek.averagingWeeks)}
              onChangeText={(value) => void state.saveJob({ ...job, workWeek: { ...job.workWeek, averagingWeeks: Number(value) || 1 }, updatedAt: new Date().toISOString() })}
              keyboardType="number-pad"
            />
          </Field>
        ) : null}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('pay.premiums')}</SectionTitle>
        {premiums.length === 0 ? <Caption>No premiums yet. Night, evening, weekend and holiday premiums are all supported.</Caption> : null}
        {premiums.map((rule) => (
          <View key={rule.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Body>{rule.label}</Body>
              <Caption>
                {rule.type === 'per_hour' ? `${money(rule.amount as bigint)}/h` : String(rule.amount)}
                {rule.window ? ` • ${minutesToClock(rule.window.startMinute)}–${minutesToClock(rule.window.endMinute)}` : ''}
              </Caption>
            </View>
            <Button label="Remove" variant="ghost" fullWidth={false} onPress={() => void removePremium(rule.id)} />
          </View>
        ))}
        <Field label="Premium label">
          <Input value={premiumLabel} onChangeText={setPremiumLabel} />
        </Field>
        <MoneyInput label="Amount per hour" value={premiumAmount} onChangeText={setPremiumAmount} />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="From">
              <Input value={premiumStart} onChangeText={setPremiumStart} autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="To">
              <Input value={premiumEnd} onChangeText={setPremiumEnd} autoCapitalize="none" />
            </Field>
          </View>
        </View>
        <Button label="Add premium" variant="secondary" onPress={() => void addPremium()} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>{t('pay.vacation')}</SectionTitle>
        <SegmentedControl
          value={vacationMethod}
          onChange={setVacationMethod}
          options={[
            { value: 'each_cheque', label: 'Each cheque' },
            { value: 'banked', label: 'Banked' },
            { value: 'when_taken', label: 'When taken' },
            { value: 'not_sure', label: 'Not sure' },
          ]}
        />
        <Caption>
          {vacationMethod === 'not_sure'
            ? 'Vacation pay stays out of the estimate until you tell us how your employer handles it.'
            : 'We use the verified percentage for your jurisdiction and service length.'}
        </Caption>
        <Field label="Custom vacation % (optional)">
          <Input value={vacationPercent} onChangeText={setVacationPercent} keyboardType="decimal-pad" />
        </Field>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle>Time rules</SectionTitle>
        <Field label="Time rounding">
          <SegmentedControl
            value={roundingStep}
            onChange={setRoundingStep}
            options={[
              { value: '0', label: 'Exact' },
              { value: '6', label: '6 min' },
              { value: '15', label: '15 min' },
            ]}
          />
        </Field>
        {Number(roundingStep) > 0 ? (
          <SegmentedControl
            value={roundingMode}
            onChange={setRoundingMode}
            options={[
              { value: 'nearest', label: 'Nearest' },
              { value: 'up', label: 'Up' },
              { value: 'down', label: 'Down' },
            ]}
          />
        ) : null}
        <Field label="Daylight saving nights">
          <SegmentedControl
            value={dstPolicy}
            onChange={setDstPolicy}
            options={[
              { value: 'wall_clock', label: 'Pay schedule' },
              { value: 'elapsed', label: 'Pay actual' },
            ]}
          />
        </Field>
        <Caption>
          When the clocks change, a night shift is 7 or 9 real hours. Choose how your employer pays it; you can override any single shift.
        </Caption>
        <SwitchRow
          label="Employer pays statutory holiday pay"
          description="We only estimate holiday pay when you tell us it applies"
          value={job.holidayPolicy.paysHolidayPay}
          onChange={(value) => void state.saveJob({ ...job, holidayPolicy: { ...job.holidayPolicy, paysHolidayPay: value }, updatedAt: new Date().toISOString() })}
        />
      </Card>

      <Button label={t('app.save')} onPress={() => void save()} />

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Stop working here</SectionTitle>
        <Body muted>
          Archiving keeps every shift, rate and paycheque record for this job but removes it from normal shift creation. Restore it any time from
          Settings → Jobs & Pay Setup → Archived Jobs.
        </Body>
        <Button
          label="Archive job"
          variant="secondary"
          onPress={async () => {
            await state.archiveJob(job.id);
            void haptic('confirm');
            setArchivedNotice(true);
            router.replace('/(tabs)');
          }}
        />
        {archivedNotice ? <Banner tone="info" body="Job archived. You can restore it from Archived Jobs." /> : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Delete permanently</SectionTitle>
        <Body muted>
          Deleting removes this job and everything attached to it from this device. This cannot be undone unless you exported a backup.
        </Body>
        <Button
          label="Delete job permanently"
          variant="danger"
          onPress={async () => {
            const counts = await JobRepository.countData(job.id);
            setDeleteCounts(counts);
            setDeleteTyped('');
            setDeleteError(null);
            setDeleteStep('explain');
          }}
        />
      </Card>

      <Caption>Job theme accent: {themeById(state.settings.themeId, false).name}</Caption>
      <ListRow title="Privacy" subtitle="What leaves this device" onPress={() => router.push('/legal/privacy')} />

      <BottomSheet
        visible={rateSheetOpen}
        onClose={() => setRateSheetOpen(false)}
        title="Change hourly rate"
        primaryAction={{
          label: 'Save rate change',
          onPress: () => {
            const result = applyRateChange(
              { mode: rateMode, newRateText: newRate, effectiveDateText: rateEffectiveDate, today: state.today },
              { today: state.today, rates, jobId: job.id, makeId: () => `rate-${Date.now()}` },
            );
            if (!result.ok || !result.application) {
              setRateError(result.errors.rate ?? result.errors.effectiveDate ?? 'Check the rate and date.');
              return;
            }
            void state
              .replaceJobRates(job.id, result.application.rates, {
                setting: 'hourly_rate',
                effectiveFrom: result.application.log.effectiveFrom,
                previousValueJson: result.application.log.previousValueJson,
                newValueJson: result.application.log.newValueJson,
                correction: result.application.log.correction,
              })
              .then(() => {
                setRateSheetOpen(false);
                void haptic('success');
              });
          },
        }}
      >
        <View style={{ gap: spacing.md }}>
          <Body muted>Current rate: {money(job.hourlyRate)}/hour</Body>
          <MoneyInput label="New rate" value={newRate} onChangeText={setNewRate} autoFocus />
          <Field label="When should this apply?">
            <SegmentedControl
              value={rateMode}
              onChange={(value) => setRateMode(value)}
              options={[
                { value: 'from_today', label: 'From today' },
                { value: 'from_date', label: 'Choose date' },
                { value: 'correct_original', label: 'Correct original' },
              ]}
            />
          </Field>
          {rateMode === 'from_date' ? (
            <DateInput label="Effective from" value={rateEffectiveDate} onChangeText={setRateEffectiveDate} />
          ) : null}
          {rateMode === 'correct_original' ? (
            <Banner
              tone="attention"
              body="This updates the rate used for existing shifts that currently use it, so past estimates for this job may change. Use it when the original rate was typed wrong — not for a raise."
            />
          ) : null}
          {ratePreview && ratePreview.impact.affectedShiftCount > 0 ? (
            <Card style={{ gap: spacing.xs, backgroundColor: undefined }}>
              <SectionTitle>This will affect</SectionTitle>
              <Caption>
                {ratePreview.impact.affectedPastShiftCount} past shifts and {ratePreview.impact.affectedScheduledShiftCount} upcoming shifts
              </Caption>
              <Caption>
                Estimated next pay: {money(currentNextPay)} → {money(ratePreviewAfter)}
              </Caption>
              <Caption>{ratePreview.impact.unaffectedShiftCount} shifts keep their existing rate.</Caption>
            </Card>
          ) : null}
          {rateError ? <Banner tone="attention" body={rateError} /> : null}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={deleteStep !== 'none'}
        onClose={() => setDeleteStep('none')}
        title={deleteStep === 'confirm' ? `Permanently delete ${job.name}?` : `Delete ${job.name}?`}
        primaryAction={
          deleteStep === 'explain'
            ? { label: 'Continue to delete', onPress: () => setDeleteStep('confirm') }
            : {
                label: 'Delete permanently',
                onPress: async () => {
                  if (!deletionConfirmationSatisfied(deleteTyped)) {
                    setDeleteError('Type DELETE to confirm.');
                    return;
                  }
                  const result = await state.deleteJobPermanently(job.id);
                  if (result.status === 'failed') {
                    setDeleteError(`Nothing was deleted: ${result.reason}`);
                    return;
                  }
                  void haptic('confirm');
                  setDeleteStep('none');
                  router.replace('/(tabs)');
                },
              }
        }
        secondaryAction={
          deleteStep === 'explain'
            ? { label: 'Archive job instead', onPress: () => setDeleteStep('none') }
            : { label: 'Cancel', onPress: () => setDeleteStep('none') }
        }
      >
        {deleteStep === 'explain' ? (
          <View style={{ gap: spacing.sm }}>
            <Body>
              This will permanently delete this job and its {BRAND.APP_NAME} data. This cannot be undone unless you have a backup.
            </Body>
            {deleteCounts
              ? deletionSummaryRows(deleteCounts).map((row) => (
                  <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Caption>{row.label}</Caption>
                    <Numeral size="small">{String(row.count)}</Numeral>
                  </View>
                ))
              : null}
            <Banner tone="info" body="Archiving is usually the better choice: it hides the job but keeps your pay history." />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Body muted>To confirm, type DELETE below. This cannot be undone.</Body>
            <Input value={deleteTyped} onChangeText={setDeleteTyped} autoCapitalize="characters" placeholder="DELETE" />
            {deleteError ? <Banner tone="attention" body={deleteError} /> : null}
          </View>
        )}
      </BottomSheet>
    </Screen>
  );
}

function toMinutes(clock: string): number {
  const [hour, minute] = clock.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function minutesToClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export const JOB_SETTINGS_SPACING = spacing.md;
