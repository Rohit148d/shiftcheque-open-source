/**
 * Calendar (spec 12): month grid with readable shift chips, quick add on tap,
 * full editor on long press, month/week/agenda views and "paint shifts" for
 * rotating schedules.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addDays, dayOfWeek, daysInMonthFor, startOfWeek, toDateKey, WEEKDAY_SHORT_EN } from '../../core/tz.ts';
import type { Shift, ShiftType } from '../../core/types.ts';
import { useAppStore } from '../../state/store.ts';
import { activeJob, shiftsInMonth } from '../../state/selectors.ts';
import { haptic } from '../../services/haptics.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { BannerAdSlot } from '../../ui/AdSlot.tsx';
import {
  AddShiftButton,
  Body,
  BottomSheet,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ListRow,
  Numeral,
  Screen,
  SegmentedControl,
  Title,
} from '../../ui/components.tsx';
import { radius, spacing, tabularNums } from '../../ui/theme.ts';

const SHIFT_COLOURS: Record<ShiftType, string> = {
  work: '#D52B1E',
  vacation: '#1B7F4B',
  sick: '#B26A00',
  training: '#1F5F92',
  on_call: '#6D4BB5',
  off: '#8B95A3',
  custom: '#0E1B2A',
};

export default function CalendarScreen() {
  const { theme, t, day, clock, money } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [view, setView] = useState<'month' | 'week' | 'agenda'>('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [paintMode, setPaintMode] = useState(false);
  const [paintType, setPaintType] = useState<ShiftType>('work');

  const today = state.today;
  const [year, month] = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    const total = y * 12 + (m - 1) + monthOffset;
    return [Math.floor(total / 12), (total % 12) + 1];
  }, [today, monthOffset]);

  const monthShifts = useMemo(
    () => (job ? shiftsInMonth(state, year, month, job.id) : []),
    [state.shifts, job?.id, year, month],
  );

  const grid = useMemo(() => buildMonthGrid(year, month, job?.workWeek.startsOn ?? 0), [year, month, job?.workWeek.startsOn]);
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of monthShifts) {
      map.set(shift.date, [...(map.get(shift.date) ?? []), shift]);
    }
    return map;
  }, [monthShifts]);

  if (!job) {
    return (
      <Screen>
        <EmptyState
          title="No job yet"
          body="Add a job to start tracking shifts."
          action={{ label: 'Set up a job', onPress: () => router.push('/onboarding') }}
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Screen contentStyle={{ paddingBottom: 160 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>{t('nav.calendar')}</Title>
          <Chip
            label={t('shift.paintMode')}
            icon="brush-outline"
            selected={paintMode}
            onPress={() => {
              void haptic('toggle');
              setPaintMode((current) => !current);
            }}
          />
        </View>

        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: t('calendar.month') },
            { value: 'week', label: t('calendar.week') },
            { value: 'agenda', label: t('calendar.agenda') },
          ]}
        />

        {view === 'month' ? (
          <Card style={{ gap: spacing.sm, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable onPress={() => setMonthOffset((value) => value - 1)} accessibilityLabel="Previous month" hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
              </Pressable>
              <Title style={{ fontSize: 17 }}>
                {monthTitle(year, month)}
              </Title>
              <Pressable onPress={() => setMonthOffset((value) => value + 1)} accessibilityLabel="Next month" hitSlop={8}>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {rotateWeekdays(job.workWeek.startsOn).map((label) => (
                <View key={label} style={styles.weekdayCell}>
                  <Caption>{label}</Caption>
                </View>
              ))}
            </View>
            {chunk(grid, 7).map((week, weekIndex) => (
              <View key={`week-${weekIndex}`} style={{ flexDirection: 'row' }}>
                {week.map((cell) => {
                  const shifts = cell.inMonth ? shiftsByDate.get(cell.date) ?? [] : [];
                  const isToday = cell.date === today;
                  return (
                    <Pressable
                      key={cell.date}
                      onPress={() => {
                        if (paintMode) {
                          void paintDay(cell.date);
                        } else {
                          setSelectedDate(cell.date);
                        }
                      }}
                      onLongPress={() => {
                        if (paintMode) return;
                        router.push(`/shift/new?date=${cell.date}`);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${day(cell.date, 'weekday')}, ${shifts.length} shifts`}
                      style={[
                        styles.dayCell,
                        {
                          borderColor: theme.colors.border,
                          backgroundColor: isToday ? theme.colors.accentSoft : 'transparent',
                          opacity: cell.inMonth ? 1 : 0.35,
                        },
                      ]}
                    >
                        <Caption style={tabularNums}>{String(cell.dayNumber)}</Caption>
                      <View style={{ gap: 2, flex: 1, justifyContent: 'flex-end' }}>
                        {shifts.slice(0, 2).map((shift) => (
                          <View
                            key={shift.id}
                            style={[styles.chipDot, { backgroundColor: SHIFT_COLOURS[shift.type] }]}
                          />
                        ))}
                        {shifts.length > 2 ? <Caption>{`+${shifts.length - 2}`}</Caption> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Card>
        ) : null}

        {view === 'week' ? <WeekView /> : null}
        {view === 'agenda' ? <AgendaView /> : null}

        {paintMode ? (
          <Card style={{ gap: spacing.sm }}>
            <Caption>Tap as many days as you like, then save.</Caption>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              {(['work', 'vacation', 'sick', 'training', 'off'] as ShiftType[]).map((type) => (
                <Chip
                  key={type}
                  label={t(`shift.type.${type}` as never)}
                  selected={paintType === type}
                  onPress={() => setPaintType(type)}
                />
              ))}
            </View>
          </Card>
        ) : null}

        <BannerAdSlot route="/calendar" />
      </Screen>

      <BottomSheet
        visible={selectedDate !== null}
        onClose={() => setSelectedDate(null)}
        title={selectedDate ? day(selectedDate, 'weekday') : ''}
        primaryAction={
          selectedDate
            ? {
                label: t('app.addShift'),
                onPress: () => {
                  const date = selectedDate;
                  setSelectedDate(null);
                  router.push(`/shift/new?date=${date}`);
                },
              }
            : undefined
        }
      >
        {selectedDate
          ? (shiftsByDate.get(selectedDate) ?? []).length === 0
            ? <Body muted>No shifts on this day.</Body>
            : (shiftsByDate.get(selectedDate) ?? []).map((shift) => (
                <ListRow
                  key={shift.id}
                  icon="time-outline"
                  title={`${t(`shift.type.${shift.type}` as never)} • ${clock(shift.scheduledStart)} – ${clock(shift.scheduledEnd)}`}
                  subtitle={`${shift.status}${shift.confirmed ? ' • confirmed' : ''}`}
                  onPress={() => {
                    setSelectedDate(null);
                    router.push(`/shift/${shift.id}`);
                  }}
                />
              ))
          : null}
      </BottomSheet>

      <AddShiftButton onPress={() => router.push('/shift/new')} />
    </View>
  );

  async function paintDay(dateKey: string) {
    const existing = shiftsByDate.get(dateKey) ?? [];
    if (existing.some((shift) => shift.type === paintType)) return;
    const [yearNumber, monthNumber, dayNumber] = dateKey.split('-').map(Number);
    void yearNumber;
    void monthNumber;
    void dayNumber;
    const defaults = job?.defaultBreaks ?? [];
    await state.saveShift({
      id: `paint-${job?.id}-${dateKey}-${paintType}`,
      jobId: job?.id ?? '',
      date: dateKey,
      scheduledStart: paintType === 'work' ? '09:00' : '00:00',
      scheduledEnd: paintType === 'work' ? '17:00' : '00:00',
      scheduledOvernight: false,
      breaks: paintType === 'work' ? defaults : [],
      type: paintType,
      status: 'scheduled',
      confirmed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    void haptic('toggle');
  }
}

function WeekView() {
  const { theme, t, clock } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = addDays(startOfWeek(state.today, job?.workWeek.startsOn ?? 0), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const shifts = state.shifts.filter((shift) => shift.jobId === job?.id && shift.date >= weekStart && shift.date <= addDays(weekStart, 6));
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={() => setWeekOffset((value) => value - 1)} accessibilityLabel="Previous week" hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </Pressable>
        <Caption>{`${weekStart} → ${addDays(weekStart, 6)}`}</Caption>
        <Pressable onPress={() => setWeekOffset((value) => value + 1)} accessibilityLabel="Next week" hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
        </Pressable>
      </View>
      {days.map((date) => {
        const dayShifts = shifts.filter((shift) => shift.date === date);
        return (
          <View key={date} style={{ gap: spacing.xs }}>
            <Caption>{date}</Caption>
            {dayShifts.length === 0 ? (
              <Body muted style={{ fontSize: 13 }}>
                {t('shift.type.off')}
              </Body>
            ) : (
              dayShifts.map((shift) => (
                <Pressable
                  key={shift.id}
                  onPress={() => router.push(`/shift/${shift.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`shift.type.${shift.type}` as never)} ${clock(shift.scheduledStart)}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                >
                  <View style={[styles.chipDot, { backgroundColor: SHIFT_COLOURS[shift.type] }]} />
                  <Body style={{ fontSize: 14 }}>
                    {clock(shift.scheduledStart)} – {clock(shift.scheduledEnd)}
                  </Body>
                </Pressable>
              ))
            )}
          </View>
        );
      })}
    </Card>
  );
}

function AgendaView() {
  const { t, day, clock, money } = useAppUi();
  const state = useAppStore();
  const job = activeJob(state);
  const upcoming = useMemo(
    () =>
      state.shifts
        .filter((shift) => shift.jobId === job?.id && shift.date >= state.today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 25),
    [state.shifts, job?.id, state.today],
  );
  if (upcoming.length === 0) {
    return <EmptyState title={t('empty.calendarTitle')} body={t('empty.calendarBody')} />;
  }
  return (
    <Card style={{ gap: 0 }}>
      {upcoming.map((shift) => (
        <ListRow
          key={shift.id}
          icon="time-outline"
          title={`${day(shift.date, 'weekday')} • ${clock(shift.scheduledStart)} – ${clock(shift.scheduledEnd)}`}
          subtitle={t(`shift.type.${shift.type}` as never)}
          onPress={() => router.push(`/shift/${shift.id}`)}
        />
      ))}
    </Card>
  );
}

function buildMonthGrid(year: number, month: number, weekStartsOn: number) {
  const first = toDateKey(year, month, 1);
  const gridStart = startOfWeek(first, weekStartsOn);
  const total = 42;
  return Array.from({ length: total }, (_, index) => {
    const date = addDays(gridStart, index);
    const [y, m, d] = date.split('-').map(Number);
    return { date, dayNumber: d, inMonth: y === year && m === month };
  });
}

function rotateWeekdays(weekStartsOn: number): string[] {
  const labels: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    labels.push(WEEKDAY_SHORT_EN[(weekStartsOn + index) % 7]);
  }
  return labels;
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function monthTitle(year: number, month: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month - 1]} ${year}`;
}

const styles = StyleSheet.create({
  weekdayCell: { flex: 1, alignItems: 'center' },
  dayCell: {
    flex: 1,
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    margin: 1,
    padding: 3,
    gap: 2,
  },
  chipDot: { height: 4, borderRadius: 2, width: '100%' },
});
