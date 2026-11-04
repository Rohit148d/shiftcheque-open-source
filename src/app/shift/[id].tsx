/**
 * Shift editor (spec 13/14/15/16).
 *
 * Simple mode first, "More options" for everything else, live shift mode with
 * timestamp-derived elapsed time, and after-shift confirmation in one tap.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { MINUTES_PER_HOUR, parseDurationToMinutes } from '../../core/duration.ts';
import { microFromDollars, tryParseMoney, type Micro } from '../../core/money.ts';
import { clockToMinutes, computeShiftTime, formatClockTime, liveElapsedMinutes } from '../../core/shiftTime.ts';
import type { Shift, ShiftStatus, ShiftType } from '../../core/types.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, periodContaining } from '../../state/selectors.ts';
import { haptic } from '../../services/haptics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  Field,
  Input,
  MoneyInput,
  Numeral,
  Screen,
  SectionTitle,
  SegmentedControl,
  SwitchRow,
  Title,
} from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

const SHIFT_TYPES: ShiftType[] = ['work', 'vacation', 'sick', 'training', 'on_call', 'off'];

export default function ShiftEditor() {
  const params = useLocalSearchParams<{ id: string; date?: string; live?: string }>();
  const { theme, t, money, hours, day } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const existing = useMemo(
    () => (params.id && params.id !== 'new' ? state.shifts.find((shift) => shift.id === params.id) ?? null : null),
    [params.id, state.shifts],
  );

  const [date, setDate] = useState(existing?.date ?? params.date ?? state.today);
  const [start, setStart] = useState(existing?.scheduledStart ?? '09:00');
  const [end, setEnd] = useState(existing?.scheduledEnd ?? '17:00');
  const [type, setType] = useState<ShiftType>(existing?.type ?? 'work');
  const [breakText, setBreakText] = useState(String(existing?.breaks[0]?.minutes ?? job?.defaultBreaks[0]?.minutes ?? 30));
  const [breakPaid, setBreakPaid] = useState(existing?.breaks[0]?.paid ?? false);
  const [status, setStatus] = useState<ShiftStatus>(existing?.status ?? 'scheduled');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [advanced, setAdvanced] = useState(false);
  const [actualStart, setActualStart] = useState(existing?.actualStart ?? '');
  const [actualEnd, setActualEnd] = useState(existing?.actualEnd ?? '');
  const [paidOverride, setPaidOverride] = useState(existing?.paidMinutesOverride ? String(existing.paidMinutesOverride / 60) : '');
  const [rateOverride, setRateOverride] = useState(existing?.rateOverride ? String(Number(existing.rateOverride) / 1_000_000) : '');
  const [bonus, setBonus] = useState(existing?.bonus ? String(Number(existing.bonus) / 1_000_000) : '');
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  const [live, setLive] = useState(Boolean(params.live) && !existing?.liveStartedAtMs ? true : Boolean(existing?.liveStartedAtMs));

  const draft: Shift = useMemo(() => {
    const breakMinutes = parseDurationToMinutes(breakText) ?? 0;
    return {
      id: existing?.id ?? `shift-${Date.now()}`,
      jobId: job?.id ?? '',
      date,
      scheduledStart: start,
      scheduledEnd: end,
      scheduledOvernight: clockToMinutes(end) <= clockToMinutes(start),
      actualStart: actualStart || undefined,
      actualEnd: actualEnd || undefined,
      actualOvernight: actualStart && actualEnd ? clockToMinutes(actualEnd) <= clockToMinutes(actualStart) : undefined,
      breaks: breakMinutes > 0 ? [{ label: breakPaid ? 'Paid break' : 'Unpaid break', minutes: breakMinutes, paid: breakPaid }] : [],
      type,
      status,
      confirmed: Boolean(actualStart && actualEnd) || existing?.confirmed === true,
      paidMinutesOverride: paidOverride ? (parseDurationToMinutes(paidOverride) ?? undefined) : undefined,
      rateOverride: rateOverride ? (tryParseMoney(rateOverride) ?? undefined) : undefined,
      bonus: bonus ? (tryParseMoney(bonus) ?? undefined) : undefined,
      notes: notes || undefined,
      liveStartedAtMs: existing?.liveStartedAtMs ?? (live ? Date.now() : undefined),
      liveBreakStartedAtMs: existing?.liveBreakStartedAtMs,
      liveAccumulatedMinutes: existing?.liveAccumulatedMinutes ?? (live ? 0 : undefined),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [existing, job?.id, date, start, end, actualStart, actualEnd, breakText, breakPaid, type, status, paidOverride, rateOverride, bonus, notes, live]);

  const time = useMemo(
    () => (job ? computeShiftTime(draft, { zone: job.zone, dstPolicy: job.dstPolicy, rounding: job.rounding }) : null),
    [draft, job],
  );

  const liveMinutes = live && existing?.liveStartedAtMs ? liveElapsedMinutes(existing, Date.now()) : live ? 0 : 0;

  // Re-render once a minute while a shift is running (no background timers).
  React.useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [live]);
  void tick;

  if (!job) {
    return (
      <Screen>
        <Title>Add a job first</Title>
        <Button label="Set up a job" onPress={() => router.push('/onboarding')} />
      </Screen>
    );
  }

  const estimatedGross: Micro = time && job
    ? (() => {
        const rate = draft.rateOverride ?? job.hourlyRate;
        const minutes = paidOverride ? parseDurationToMinutes(paidOverride) ?? time.paidMinutes : time.paidMinutes;
        return (rate * BigInt(Math.round(minutes))) / 60n;
      })()
    : 0n;

  const save = async () => {
    setSaving(true);
    await state.saveShift({ ...draft, updatedAt: new Date().toISOString() });
    const period = periodContaining(job, draft.date);
    const calculation = state.shifts.length > 0 ? null : null;
    void calculation;
    void haptic('success');
    setSaving(false);
    if (existing) {
      router.back();
    } else {
      router.replace({ pathname: '/pay/breakdown', params: { jobId: job.id, period: period.start, highlight: draft.id } });
    }
  };

  const confirm = async (mode: 'as_scheduled' | 'did_not_work') => {
    if (mode === 'did_not_work') {
      await state.saveShift({ ...draft, status: 'missed', confirmed: true, type: 'off' });
      void haptic('confirm');
    } else {
      await state.saveShift({
        ...draft,
        status: 'completed',
        confirmed: true,
        actualStart: draft.actualStart ?? draft.scheduledStart,
        actualEnd: draft.actualEnd ?? draft.scheduledEnd,
        actualOvernight: draft.scheduledOvernight,
      });
      void haptic('success');
    }
    router.back();
  };

  const startLive = async () => {
    const now = Date.now();
    await state.saveShift({ ...draft, status: 'in_progress', liveStartedAtMs: now, liveAccumulatedMinutes: 0 });
    setLive(true);
    void haptic('confirm');
  };

  const endBreak = async () => {
    if (!existing) return;
    const now = Date.now();
    const accumulated = (existing.liveAccumulatedMinutes ?? 0) + Math.max(0, Math.round((now - (existing.liveBreakStartedAtMs ?? now)) / 60_000));
    await state.saveShift({ ...existing, liveBreakStartedAtMs: undefined, liveStartedAtMs: now, liveAccumulatedMinutes: accumulated, status: 'in_progress' });
  };

  const startBreak = async () => {
    if (!existing) return;
    const accumulated = liveElapsedMinutes(existing, Date.now());
    await state.saveShift({ ...existing, liveBreakStartedAtMs: Date.now(), liveStartedAtMs: Date.now(), liveAccumulatedMinutes: accumulated, status: 'in_progress' });
  };

  const endShift = async () => {
    if (!existing) return;
    const elapsed = liveElapsedMinutes(existing, Date.now());
    const endClock = formatClockTime(new Date().getHours(), new Date().getMinutes());
    await state.saveShift({
      ...existing,
      status: 'completed',
      confirmed: true,
      paidMinutesOverride: elapsed,
      actualStart: { ...existing }.actualStart ?? existing.scheduledStart,
      actualEnd: endClock,
      liveStartedAtMs: undefined,
      liveBreakStartedAtMs: undefined,
      liveAccumulatedMinutes: undefined,
      updatedAt: new Date().toISOString(),
    });
    void haptic('success');
    router.back();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{existing ? t('shift.edit') : t('shift.add')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {live && existing?.liveStartedAtMs ? (
        <Card style={{ gap: spacing.sm }} accent>
          <SectionTitle>{t(`shift.type.${type}` as never)}</SectionTitle>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Caption>{t('shift.live.worked')}</Caption>
              <Numeral size="hero">{hours(liveMinutes)} h {String(liveMinutes % 60).padStart(2, '0')}m</Numeral>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Caption>{t('shift.live.estimatedEarned')}</Caption>
              <Numeral size="heading" tone="positive">
                {money((job.hourlyRate * BigInt(Math.max(1, liveMinutes))) / 60n)}
              </Numeral>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {existing.liveBreakStartedAtMs ? (
              <View style={{ flex: 1 }}>
                <Button label={t('shift.live.endBreak')} onPress={() => void endBreak()} variant="secondary" />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Button label={t('shift.live.startBreak')} onPress={() => void startBreak()} variant="secondary" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Button label={t('shift.live.endShift')} onPress={() => void endShift()} />
            </View>
          </View>
          <Caption>Elapsed time is derived from timestamps, so it survives the app being closed.</Caption>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <Field label={t('shift.date')} hint={day(date, 'long')}>
          <Input value={date} onChangeText={setDate} autoCapitalize="none" placeholder="2026-10-05" />
        </Field>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label={t('shift.start')}>
              <Input value={start} onChangeText={setStart} placeholder="09:00" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('shift.end')}>
              <Input value={end} onChangeText={setEnd} placeholder="17:00" autoCapitalize="none" />
            </Field>
          </View>
        </View>
        <Field label={t('shift.break')} hint="Minutes, e.g. 30">
          <Input value={breakText} onChangeText={setBreakText} keyboardType="number-pad" />
        </Field>
        <SwitchRow label="Break is paid" value={breakPaid} onChange={setBreakPaid} />
        <Field label={t('shift.type')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {SHIFT_TYPES.map((candidate) => (
              <Chip
                key={candidate}
                label={t(`shift.type.${candidate}` as never)}
                selected={type === candidate}
                onPress={() => setType(candidate)}
              />
            ))}
          </View>
        </Field>
      </Card>

      {time ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{t('pay.breakdown')}</SectionTitle>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body muted>Paid hours</Body>
            <Numeral size="body">{hours(time.paidMinutes)} h</Numeral>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body muted>{t('app.gross')}</Body>
            <Numeral size="body">{money(estimatedGross)}</Numeral>
          </View>
          {time.dstAnomalyMinutes !== 0 ? (
            <Banner
              tone="info"
              body={`Daylight saving changes this shift by ${Math.abs(time.dstAnomalyMinutes)} minutes of clock time. ${
                job.dstPolicy === 'wall_clock' ? 'You are being paid the scheduled hours.' : 'You are being paid actual elapsed time.'
              }`}
            />
          ) : null}
          {time.roundingDeltaMinutes !== 0 ? (
            <Caption>Rounding adjusts paid time by {time.roundingDeltaMinutes} minutes.</Caption>
          ) : null}
        </Card>
      ) : null}

      <Button label={advanced ? 'Fewer options' : t('shift.more')} variant="ghost" onPress={() => setAdvanced((value) => !value)} />

      {advanced ? (
        <Card style={{ gap: spacing.md }}>
          <SectionTitle>{t('shift.more')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field label={t('shift.actualStart')}>
                <Input value={actualStart} onChangeText={setActualStart} placeholder="17:05" autoCapitalize="none" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('shift.actualEnd')}>
                <Input value={actualEnd} onChangeText={setActualEnd} placeholder="17:35" autoCapitalize="none" />
              </Field>
            </View>
          </View>
          <Field label={t('shift.paidMinutes')} hint="Hours, e.g. 7.5 — wins over everything else">
            <Input value={paidOverride} onChangeText={setPaidOverride} keyboardType="decimal-pad" />
          </Field>
          <MoneyInput label={t('shift.rateOverride')} value={rateOverride} onChangeText={setRateOverride} hint="Per hour, for this shift only" />
          <MoneyInput label={t('shift.bonus')} value={bonus} onChangeText={setBonus} />
          <Field label={t('shift.notes')}>
            <Input value={notes} onChangeText={setNotes} multiline placeholder="Optional" />
          </Field>
          <Field label={t('shift.status')}>
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'completed', label: 'Completed' },
                { value: 'missed', label: 'Missed' },
              ]}
            />
          </Field>
        </Card>
      ) : null}

      {existing && existing.date <= state.today && !existing.confirmed && existing.status !== 'in_progress' ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{t('shift.confirmWorked')}?</SectionTitle>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={t('shift.confirmWorked')} onPress={() => void confirm('as_scheduled')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('shift.didNotWork')} variant="secondary" onPress={() => void confirm('did_not_work')} />
            </View>
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={t('app.save')} onPress={() => void save()} loading={saving} />
        </View>
        {!live && type === 'work' ? (
          <View style={{ flex: 1 }}>
            <Button label={t('home.startShift')} variant="secondary" onPress={() => (existing ? void startLive() : setLive(true))} />
          </View>
        ) : null}
      </View>

      {existing ? (
        <Button
          label={t('app.delete')}
          variant="ghost"
          onPress={async () => {
            await state.deleteShift(existing.id);
            void haptic('confirm');
            router.back();
          }}
        />
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="lock-closed-outline" size={14} color={theme.colors.textFaint} />
        <Caption>Saved on your phone. No account, no upload.</Caption>
      </View>
    </Screen>
  );
}
