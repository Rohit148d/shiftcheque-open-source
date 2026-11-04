/**
 * Onboarding (spec 6/7) — ten short steps, skippable where possible, and the
 * first useful pay estimate is produced before any account, permission or
 * configuration wall.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_NAME, BRAND, brandCopy } from '../config/brand.ts';
import { defaultAnchorKey, validateDateKeyInput } from '../core/dateInput.ts';
import { microFromDollars } from '../core/money.ts';
import { completeOnboarding, validateDraft, type OnboardingDraft } from '../core/onboarding.ts';
import { ROTATION_PRESETS } from '../core/rotations.ts';
import { JURISDICTIONS, type Job, type JurisdictionCode } from '../core/types.ts';
import type { ZoneId } from '../core/tz.ts';
import { jurisdictionLabel } from '../rules/loader.ts';
import { useAppStore } from '../state/store.ts';
import { haptic } from '../services/haptics.ts';
import { requestPermission } from '../services/notifications.ts';
import { useAppUi } from '../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, Chip, DateInput, Field, Input, MoneyInput, Numeral, Screen, SegmentedControl, Title } from '../ui/components.tsx';
import { fontSizes, spacing } from '../ui/theme.ts';

type Goals = {
  nextPay: boolean;
  trackShifts: boolean;
  overtime: boolean;
  checkCheque: boolean;
  extraShifts: boolean;
};

const PROVINCE_ZONE: Record<Exclude<JurisdictionCode, 'FED'>, ZoneId> = {
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

export default function Onboarding() {
  const { theme, t, money } = useAppUi();
  const insets = useSafeAreaInsets();
  const saveJob = useAppStore((state) => state.saveJob);
  const saveShifts = useAppStore((state) => state.saveShifts);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<Goals>({ nextPay: true, trackShifts: true, overtime: false, checkCheque: false, extraShifts: false });
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>('ON');
  const [federal, setFederal] = useState(false);
  const [notSureJurisdiction, setNotSureJurisdiction] = useState(false);
  const [jobName, setJobName] = useState('');
  const [rate, setRate] = useState('');
  const [frequency, setFrequency] = useState<Job['paySchedule']['frequency']>('biweekly');
  const [anchor, setAnchor] = useState(defaultAnchorKey());
  const [paydayOffset, setPaydayOffset] = useState('5');
  const [weekStartsOn, setWeekStartsOn] = useState(0);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [rotationId, setRotationId] = useState('none');
  const [customRule, setCustomRule] = useState(false);
  const [agreement, setAgreement] = useState<'yes' | 'no' | 'not_sure'>('not_sure');
  const [saving, setSaving] = useState(false);
  /** True only after the setup was persisted and the completion flag was set. */
  const [completed, setCompleted] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [anchorError, setAnchorError] = useState<string | undefined>();
  const [paydayError, setPaydayError] = useState<string | undefined>();
  const [wantReminders, setWantReminders] = useState(true);

  /**
   * Guards against duplicate submissions and keeps the job id stable, so a
   * double tap upserts the same job instead of creating two.
   */
  const submittingRef = useRef(false);
  const jobIdRef = useRef(`job-${Date.now()}`);
  const navigationFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (navigationFallbackRef.current) clearTimeout(navigationFallbackRef.current);
  }, []);

  const fade = useMemo(() => new Animated.Value(1), []);

  const goNext = () => {
    void haptic('light');
    Animated.timing(fade, { toValue: 0.6, duration: 120, useNativeDriver: true }).start(() => {
      setStep((current) => Math.min(current + 1, 9));
      Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    });
  };

  const goBack = () => setStep((current) => Math.max(0, current - 1));

  /** Everything the user answered, in the shape the pure validator expects. */
  const buildDraft = (): OnboardingDraft => ({
    jobName,
    rateText: rate,
    province: (jurisdiction === 'FED' ? 'ON' : jurisdiction) as Exclude<JurisdictionCode, 'FED'>,
    federal,
    zone: PROVINCE_ZONE[(jurisdiction === 'FED' ? 'ON' : jurisdiction) as Exclude<JurisdictionCode, 'FED'>],
    frequency,
    anchorDateText: anchor,
    paydayOffsetText: paydayOffset,
    weekStartsOn,
    shiftStart,
    shiftEnd,
    breakMinutesText: breakMinutes,
    rotationId,
    customRule,
    agreement,
    goals,
  });

  /** Step 4 gate: the pay-period date must be a real, unambiguous date. */
  const nextFromPaymentStep = () => {
    const dateResult = validateDateKeyInput(anchor);
    const offsetValue = Number(paydayOffset.trim() === '' ? '0' : paydayOffset.trim());
    const offsetValid = Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 60;
    setAnchorError(dateResult.ok ? undefined : dateResult.message);
    setPaydayError(offsetValid ? undefined : 'Enter a whole number of days between 0 and 60.');
    if (!dateResult.ok || !offsetValid) return;
    goNext();
  };

  /**
   * Finish Setup.
   *
   * Order matters and is enforced by `completeOnboarding`: validate -> save job
   * -> save shifts -> mark complete -> optional notifications -> navigate. The
   * notification answer can never block or fail this flow, and a failure at any
   * persistence step restores the button while keeping every answer.
   */
  const finishSetup = async () => {
    if (submittingRef.current) return;
    const draft = buildDraft();
    const validation = validateDraft(draft);
    if (!validation.valid) {
      const firstError =
        validation.errors.anchorDate ??
        validation.errors.paydayOffset ??
        validation.errors.rate ??
        validation.errors.shiftTimes ??
        t('onboarding.invalidAnswers');
      setAnchorError(validation.errors.anchorDate);
      setPaydayError(validation.errors.paydayOffset);
      setFinishError(firstError);
      setStep(4);
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setFinishError(null);

    const result = await completeOnboarding(
      {
        saveJob: (job) => saveJob(job, { makeActive: true }),
        saveShifts: (shifts) => saveShifts(shifts),
        markComplete: (patch) => updateSettings(patch),
        requestNotifications: wantReminders ? () => requestPermission() : undefined,
      },
      draft,
      { jobId: jobIdRef.current, wantNotifications: wantReminders },
    );

    if (result.status === 'completed') {
      void haptic('success');
      setCompleted(true);
      // Escape hatch: if navigation does not take effect, never leave the user
      // staring at a spinner — offer an explicit button instead.
      navigationFallbackRef.current = setTimeout(() => {
        setSaving(false);
        setFinishError(t('onboarding.stillHere', { app: APP_NAME }));
      }, 4000);
      router.replace('/(tabs)');
      return;
    }

    submittingRef.current = false;
    setSaving(false);
    setFinishError(
      result.status === 'invalid'
        ? (Object.values(result.errors)[0] ?? t('onboarding.invalidAnswers'))
        : t('onboarding.saveFailed', { reason: result.reason }),
    );
  };

  /**
   * Explore first: opens the real app in explore mode. No job is created, no
   * payroll is calculated and onboarding stays incomplete, so the user can set
   * up for real whenever they want.
   */
  const exploreFirst = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await updateSettings({ exploreMode: true });
      router.replace('/(tabs)');
    } catch {
      submittingRef.current = false;
      setSaving(false);
      setFinishError('We could not open the explore view. Please try again.');
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.lg }}>
      <Animated.View style={{ opacity: fade, gap: spacing.lg }}>
        {step === 0 ? (
          <View style={{ gap: spacing.lg, alignItems: 'center', paddingTop: spacing.xl }}>
            <View style={[styles.logo, { backgroundColor: theme.colors.text }]}>
              <Ionicons name="time-outline" size={34} color={theme.colors.surface} />
              <View style={[styles.logoDot, { backgroundColor: theme.colors.accent }]}>
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              </View>
            </View>
            <Title style={{ fontSize: fontSizes.display, textAlign: 'center' }}>{APP_NAME}</Title>
            <Title style={{ fontSize: fontSizes.title, textAlign: 'center' }}>{BRAND.TAGLINE}</Title>
            <Body muted style={{ textAlign: 'center' }}>
              Track your shifts, predict your take-home pay and check your paycheque — built for Canadian workers.
            </Body>
            <Card style={{ width: '100%', gap: spacing.sm }}>
              <Caption>Next Pay — example preview</Caption>
              <Numeral size="display" tone="positive">
                {money(microFromDollars('1636.83'))}
              </Numeral>
              <View style={{ flexDirection: 'row', gap: spacing.lg }}>
                <View>
                  <Caption>Gross</Caption>
                  <Numeral size="small">{money(microFromDollars('2148.26'))}</Numeral>
                </View>
                <View>
                  <Caption>Worked</Caption>
                  <Numeral size="small">72 h</Numeral>
                </View>
                <View>
                  <Caption>OT</Caption>
                  <Numeral size="small">6.5 h</Numeral>
                </View>
              </View>
            </Card>
            <Button label={t('onboarding.s1Cta')} onPress={goNext} />
            <Button
              label={t('onboarding.s1Secondary')}
              variant="ghost"
              onPress={() => void exploreFirst()}
              loading={saving}
              accessibilityHint="Opens the app without setup so you can look around first"
            />
            <Caption>No account needed. Your data stays on your phone.</Caption>
            {finishError ? <Banner tone="attention" body={finishError} /> : null}
          </View>
        ) : null}

        {step === 1 ? (
          <Step
            title={t('onboarding.s2Title')}
            body={t('onboarding.s2Body')}
            onNext={goNext}
            nextLabel={t('app.next')}
          >
            <View style={{ gap: spacing.sm }}>
              {(
                [
                  ['nextPay', 'onboarding.goal.nextPay', 'cash-outline'],
                  ['trackShifts', 'onboarding.goal.trackShifts', 'calendar-outline'],
                  ['overtime', 'onboarding.goal.overtime', 'speedometer-outline'],
                  ['checkCheque', 'onboarding.goal.checkCheque', 'checkmark-done-outline'],
                  ['extraShifts', 'onboarding.goal.extraShifts', 'add-circle-outline'],
                ] as const
              ).map(([key, label, icon]) => (
                <Chip
                  key={key}
                  label={t(label)}
                  icon={icon}
                  selected={goals[key]}
                  onPress={() => setGoals((current) => ({ ...current, [key]: !current[key] }))}
                />
              ))}
            </View>
          </Step>
        ) : null}

        {step === 2 ? (
          <Step
            title={t('onboarding.s3Title')}
            body={t('onboarding.s3Body')}
            onNext={goNext}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <Body>{t('onboarding.province')}</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {JURISDICTIONS.filter((code) => code !== 'FED').map((code) => (
                <Chip
                  key={code}
                  label={code}
                  selected={!federal && !notSureJurisdiction && jurisdiction === code}
                  onPress={() => {
                    setNotSureJurisdiction(false);
                    setFederal(false);
                    setJurisdiction(code);
                  }}
                />
              ))}
            </View>
            <Chip label={t('onboarding.s3Federal')} selected={federal} onPress={() => { setFederal(true); setNotSureJurisdiction(false); }} />
            <Chip label={t('onboarding.s3NotSure')} selected={notSureJurisdiction} onPress={() => { setNotSureJurisdiction(true); setFederal(false); }} />
            {notSureJurisdiction ? <Caption>{t('onboarding.s3NotSureHelp')}</Caption> : null}
            <Caption>
              {federal
                ? 'Federal labour standards apply to jobs like interprovincial trucking, banks and airlines. We still use your province for income tax.'
                : `Standard ${jurisdictionLabel(jurisdiction)} employment rules will be used for overtime and vacation.`}
            </Caption>
          </Step>
        ) : null}

        {step === 3 ? (
          <Step title={t('onboarding.s4Title')} body="You can change this at any time." onNext={goNext} onBack={goBack} nextLabel={t('app.next')}>
            <Field label={t('onboarding.s4Title')}>
              <Input value={jobName} onChangeText={setJobName} placeholder={t('onboarding.s4Placeholder')} autoFocus />
            </Field>
            <MoneyInput label={t('onboarding.s4Rate')} value={rate} onChangeText={setRate} hint="Before deductions, per hour" />
            <Button label="Skip for now" variant="ghost" onPress={goNext} />
          </Step>
        ) : null}

        {step === 4 ? (
          <Step
            title={t('onboarding.s5Title')}
            body={t('onboarding.s5Body')}
            onNext={nextFromPaymentStep}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <SegmentedControl
              value={frequency}
              onChange={setFrequency}
              label={t('onboarding.s5Title')}
              options={[
                { value: 'weekly', label: t('onboarding.freq.weekly') },
                { value: 'biweekly', label: t('onboarding.freq.biweekly') },
                { value: 'semimonthly', label: t('onboarding.freq.semimonthly') },
                { value: 'monthly', label: t('onboarding.freq.monthly') },
              ]}
            />
            <DateInput
              label={t('onboarding.s5Anchor')}
              help={t('onboarding.s5AnchorHelp')}
              value={anchor}
              onChangeText={(value) => {
                setAnchor(value);
                if (anchorError) setAnchorError(validateDateKeyInput(value).ok ? undefined : anchorError);
              }}
              error={anchorError}
              testID="onboarding-anchor-date"
            />
            <Field
              label={t('onboarding.s5Payday')}
              hint="0 means payday is the last day of the period"
              error={paydayError}
            >
              <Input
                value={paydayOffset}
                onChangeText={(value) => {
                  setPaydayOffset(value);
                  if (paydayError) setPaydayError(undefined);
                }}
                keyboardType="number-pad"
              />
            </Field>
          </Step>
        ) : null}

        {step === 5 ? (
          <Step
            title={t('onboarding.s6Title')}
            body={t('onboarding.s6Body')}
            onNext={goNext}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <SegmentedControl
              value={String(weekStartsOn)}
              onChange={(value) => setWeekStartsOn(Number(value))}
              label={t('onboarding.s6Title')}
              options={[
                { value: '0', label: 'Sunday' },
                { value: '1', label: 'Monday' },
                { value: '6', label: 'Saturday' },
              ]}
            />
          </Step>
        ) : null}

        {step === 6 ? (
          <Step
            title={t('onboarding.s7Title')}
            body="Pick a template or set your own times. Breaks are remembered for new shifts."
            onNext={goNext}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {(
                [
                  ['08:00', '16:00', '8h Day'],
                  ['16:00', '00:00', '8h Evening'],
                  ['00:00', '08:00', '8h Night'],
                  ['07:00', '17:00', '10h Shift'],
                  ['07:00', '19:00', '12h Day'],
                  ['19:00', '07:00', '12h Night'],
                ] as const
              ).map(([start, end, label]) => (
                <Chip
                  key={label}
                  label={label}
                  selected={shiftStart === start && shiftEnd === end}
                  onPress={() => {
                    setShiftStart(start);
                    setShiftEnd(end);
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field label={t('shift.start')}>
                  <Input value={shiftStart} onChangeText={setShiftStart} placeholder="09:00" autoCapitalize="none" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('shift.end')}>
                  <Input value={shiftEnd} onChangeText={setShiftEnd} placeholder="17:00" autoCapitalize="none" />
                </Field>
              </View>
            </View>
            <Field label={t('onboarding.s7Break')} hint="Leave 0 if your breaks are paid">
              <Input value={breakMinutes} onChangeText={setBreakMinutes} keyboardType="number-pad" />
            </Field>
          </Step>
        ) : null}

        {step === 7 ? (
          <Step
            title={t('onboarding.s8Title')}
            body={t('onboarding.s8Body')}
            onNext={goNext}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {ROTATION_PRESETS.map((preset) => (
                <Chip
                  key={preset.id}
                  label={t(preset.labelKey as never)}
                  selected={rotationId === preset.id}
                  onPress={() => setRotationId(preset.id)}
                />
              ))}
            </View>
            {rotationId !== 'none' && rotationId !== 'custom' ? (
              <Caption>We will add your next four weeks of shifts from this pattern, and you can edit any of them.</Caption>
            ) : null}
          </Step>
        ) : null}

        {step === 8 ? (
          <Step
            title={t('onboarding.s9Title')}
            body="We use the verified standard rules by default. You can always change this."
            onNext={goNext}
            onBack={goBack}
            nextLabel={t('app.next')}
          >
            <Chip
              label={t('onboarding.s9Standard', { jurisdiction: jurisdictionLabel(federal ? 'FED' : jurisdiction) })}
              selected={!customRule}
              onPress={() => setCustomRule(false)}
            />
            <Chip label={t('onboarding.s9Custom')} selected={customRule} onPress={() => setCustomRule(true)} />
            {customRule ? (
              <Caption>We will start with 1.5x after 44 hours and you can fine-tune it in Job settings.</Caption>
            ) : null}
            <Body>{t('onboarding.s9Agreement')}</Body>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(
                [
                  ['yes', t('onboarding.s9AgreementYes')],
                  ['no', t('onboarding.s9AgreementNo')],
                  ['not_sure', t('onboarding.s9AgreementUnsure')],
                ] as const
              ).map(([value, label]) => (
                <Chip key={value} label={label} selected={agreement === value} onPress={() => setAgreement(value)} />
              ))}
            </View>
          </Step>
        ) : null}

        {step === 9 ? (
          <View style={{ gap: spacing.lg }}>
            <View style={{ alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg }}>
              <Ionicons name="sparkles-outline" size={32} color={theme.colors.accent} />
              <Title style={{ textAlign: 'center' }}>{t('onboarding.s10Title')}</Title>
              <Body muted style={{ textAlign: 'center' }}>
                {t('onboarding.s10Body')}
              </Body>
            </View>

            <Card style={{ gap: spacing.sm }}>
              <Body>{t('onboarding.notificationsTitle')}</Body>
              <Caption>{t('onboarding.notificationsBody')}</Caption>
              <SegmentedControl
                value={wantReminders ? 'yes' : 'no'}
                onChange={(value) => setWantReminders(value === 'yes')}
                label={t('onboarding.notificationsTitle')}
                options={[
                  { value: 'yes', label: t('onboarding.notificationsYes') },
                  { value: 'no', label: t('app.notNow') },
                ]}
              />
              {notSureJurisdiction ? (
                <Caption>You chose “I'm not sure” for the jurisdiction, so standard provincial rules are used.</Caption>
              ) : null}
              <Caption>{t('onboarding.remindersOptional', { app: APP_NAME })}</Caption>
            </Card>

            {finishError ? <Banner tone={completed ? 'info' : 'attention'} body={finishError} /> : null}

            {completed ? (
              <Button label={t('onboarding.openApp', { app: APP_NAME })} onPress={() => router.replace('/(tabs)')} />
            ) : (
              <Button
                label={saving ? t('onboarding.finishingSetup') : t('onboarding.finishSetup')}
                onPress={() => void finishSetup()}
                loading={saving}
                disabled={saving}
                accessibilityHint="Saves your job and opens the home screen"
              />
            )}
            <Button label={t('app.back')} variant="ghost" onPress={goBack} disabled={saving} />
            <Caption>{brandCopy('You can change any of this later in Settings.')}</Caption>
          </View>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

function Step({
  title,
  body,
  children,
  onNext,
  onBack,
  nextLabel,
  nextDisabled,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
  onNext: () => void;
  onBack?: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
}) {
  const { t } = useAppUi();
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Title>{title}</Title>
        {body ? <Body muted>{body}</Body> : null}
      </View>
      {children}
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        {onBack ? <Button label={t('app.back')} variant="ghost" onPress={onBack} fullWidth={false} /> : null}
        <View style={{ flex: 1 }}>
          <Button label={nextLabel} onPress={onNext} disabled={nextDisabled} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDot: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
