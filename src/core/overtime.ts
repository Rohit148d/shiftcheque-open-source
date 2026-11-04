/**
 * overtimeEngine (spec 10, 33, 37, 104)
 *
 * Works exclusively on WORK WEEKS. Daily and weekly thresholds are both
 * supported, and when both produce overtime the engine pays the GREATER
 * amount (the standard Canadian "greater of daily or weekly" rule) instead of
 * stacking them.
 *
 * Averaging agreements widen the work week (WorkWeekConfig.averagingWeeks),
 * which scales the weekly threshold accordingly.
 */
import type { Minutes } from './duration.ts';
import type { ClassifiedSegment, OvertimeKind, OvertimeRuleConfig, TimeSegment, WorkWeekConfig } from './types.ts';
import { workWeekFor } from './workweek.ts';

export type ResolvedOvertimeRule = {
  source: 'jurisdiction' | 'custom';
  dailyOvertimeApplies: boolean;
  weeklyOvertimeApplies: boolean;
  dailyThresholdHours: number | null;
  weeklyThresholdHours: number | null;
  overtimeMultiplier: number;
  doubleTimeDailyThresholdHours: number | null;
  doubleTimeWeeklyThresholdHours: number | null;
  doubleTimeMultiplier: number | null;
  /** Label shown in the UI ("Standard Ontario rules", "Custom workplace rule"). */
  label: string;
  averagingWeeks: number;
  note?: string;
};

export type OvertimeSummary = {
  segments: ClassifiedSegment[];
  totalMinutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  regularMinutes: Minutes;
  perWeek: {
    key: string;
    label: string;
    totalMinutes: Minutes;
    overtimeMinutes: Minutes;
    doubleTimeMinutes: Minutes;
  }[];
  perDay: {
    dateKey: string;
    totalMinutes: Minutes;
    overtimeMinutes: Minutes;
    doubleTimeMinutes: Minutes;
  }[];
  rule: ResolvedOvertimeRule;
};

/** Converts a job's OT config into an effective rule (custom tiers win). */
export function resolveOvertimeRule(config: OvertimeRuleConfig, fallbackDaily: number | null, fallbackWeekly: number | null, fallbackMultiplier: number, averagingWeeks: number, label: string): ResolvedOvertimeRule {
  if (config.source === 'custom' && config.tiers.length > 0) {
    const sorted = [...config.tiers].sort((a, b) => a.multiplier - b.multiplier);
    const first = sorted[0];
    const double = sorted.find((tier) => tier.multiplier >= 2) ?? null;
    const anyDaily = sorted.some((tier) => tier.afterDailyHours !== null);
    const anyWeekly = sorted.some((tier) => tier.afterWeeklyHours !== null);
    return {
      source: 'custom',
      dailyOvertimeApplies: anyDaily,
      weeklyOvertimeApplies: anyWeekly,
      dailyThresholdHours: sorted.find((t) => t.afterDailyHours !== null)?.afterDailyHours ?? null,
      weeklyThresholdHours: sorted.find((t) => t.afterWeeklyHours !== null)?.afterWeeklyHours ?? null,
      overtimeMultiplier: first.multiplier,
      doubleTimeDailyThresholdHours: double?.afterDailyHours ?? null,
      doubleTimeWeeklyThresholdHours: double?.afterWeeklyHours ?? null,
      doubleTimeMultiplier: double ? double.multiplier : null,
      label: config.note ? `Custom rule — ${config.note}` : 'Custom workplace rule',
      averagingWeeks,
    };
  }
  return {
    source: 'jurisdiction',
    dailyOvertimeApplies: config.dailyOvertimeApplies,
    weeklyOvertimeApplies: config.weeklyOvertimeApplies,
    dailyThresholdHours: fallbackDaily,
    weeklyThresholdHours: fallbackWeekly,
    overtimeMultiplier: fallbackMultiplier,
    doubleTimeDailyThresholdHours: null,
    doubleTimeWeeklyThresholdHours: null,
    doubleTimeMultiplier: null,
    label,
    averagingWeeks,
  };
}

/**
 * Classifies segments into regular / overtime / double time.
 * `segments` must already be sorted chronologically.
 */
export function classifyOvertime(
  segments: TimeSegment[],
  rule: ResolvedOvertimeRule,
  workWeek: WorkWeekConfig,
): OvertimeSummary {
  const averagingWeeks = Math.max(1, rule.averagingWeeks);
  const withWeeks = segments.map((segment) => {
    const week = workWeekFor(segment.dateKey, { startsOn: workWeek.startsOn, averagingWeeks });
    return { segment, weekKey: week.key, weekLabel: week.label };
  });

  const dailyThresholdMinutes = rule.dailyOvertimeApplies && rule.dailyThresholdHours !== null
    ? Math.round(rule.dailyThresholdHours * 60)
    : null;
  const doubleDailyMinutes = rule.doubleTimeDailyThresholdHours !== null
    ? Math.round(rule.doubleTimeDailyThresholdHours * 60)
    : null;
  const weeklyThresholdMinutes = rule.weeklyOvertimeApplies && rule.weeklyThresholdHours !== null
    ? Math.round(rule.weeklyThresholdHours * 60 * averagingWeeks)
    : null;
  const doubleWeeklyMinutes = rule.doubleTimeWeeklyThresholdHours !== null
    ? Math.round(rule.doubleTimeWeeklyThresholdHours * 60 * averagingWeeks)
    : null;

  // --- Weekly totals -------------------------------------------------------
  const weekTotals = new Map<string, number>();
  for (const item of withWeeks) {
    weekTotals.set(item.weekKey, (weekTotals.get(item.weekKey) ?? 0) + item.segment.minutes);
  }

  // Weekly overtime is assigned from the END of the week backwards.
  const weekRemainingOt = new Map<string, number>();
  const weekRemainingDouble = new Map<string, number>();
  for (const [weekKey, total] of weekTotals) {
    if (weeklyThresholdMinutes !== null) {
      const candidate = Math.max(0, total - Math.max(weeklyThresholdMinutes, dailyThresholdMinutes ?? 0));
      // "Greater of daily or weekly": weekly adds overtime only beyond what the
      // daily rules already produce; computed per week after daily assignment
      // below, so we only pre-compute the raw candidate here.
      weekRemainingOt.set(weekKey, candidate);
    } else {
      weekRemainingOt.set(weekKey, 0);
    }
    weekRemainingDouble.set(weekKey, doubleWeeklyMinutes !== null ? Math.max(0, total - doubleWeeklyMinutes) : 0);
  }

  // --- Daily assignment ----------------------------------------------------
  const classified: ClassifiedSegment[] = [];
  const dayCumulative = new Map<string, number>();
  const weekAssignedOt = new Map<string, number>();
  const weekAssignedDouble = new Map<string, number>();

  for (const item of withWeeks) {
    const { segment, weekKey } = item;
    const dayKey = `${segment.dateKey}`;
    let cursorMinute = 0;
    const slices: ClassifiedSegment[] = [];
    while (cursorMinute < segment.minutes) {
      const remaining = segment.minutes - cursorMinute;
      const chunkStart = cursorMinute;
      const dayCum = dayCumulative.get(dayKey) ?? 0;
      const cumulativeAfter = dayCum + remaining;

      let kind: OvertimeKind = 'none';
      let multiplier = 1;

      // Daily tier for the whole remaining chunk depends on where the chunk
      // ends; we split at each threshold crossing instead.
      const boundaries: number[] = [];
      if (dailyThresholdMinutes !== null && dayCum < dailyThresholdMinutes) {
        boundaries.push(dailyThresholdMinutes - dayCum);
      }
      if (doubleDailyMinutes !== null && dayCum < doubleDailyMinutes) {
        boundaries.push(doubleDailyMinutes - dayCum);
      }
      let chunkMinutes = remaining;
      for (const boundary of boundaries) {
        if (boundary > 0 && boundary < chunkMinutes) chunkMinutes = boundary;
      }
      const cumulativeEnd = dayCum + chunkMinutes;
      if (doubleDailyMinutes !== null && cumulativeEnd > doubleDailyMinutes) {
        kind = 'double_time';
        multiplier = rule.doubleTimeMultiplier ?? 2;
      } else if (dailyThresholdMinutes !== null && cumulativeEnd > dailyThresholdMinutes) {
        kind = 'overtime';
        multiplier = rule.overtimeMultiplier;
      }
      dayCumulative.set(dayKey, cumulativeEnd);
      void cumulativeAfter;

      const startRatio = chunkStart / segment.minutes;
      const endRatio = (chunkStart + chunkMinutes) / segment.minutes;
      const startMs = Math.round(segment.startMs + (segment.endMs - segment.startMs) * startRatio);
      const endMs = Math.round(segment.startMs + (segment.endMs - segment.startMs) * endRatio);
      const sliceLocalStart = segment.localStartMinute + chunkStart;
      slices.push({
        ...segment,
        startMs,
        endMs,
        minutes: chunkMinutes,
        localStartMinute: sliceLocalStart,
        localEndMinute: sliceLocalStart + chunkMinutes,
        overtimeKind: kind,
        multiplier,
        workWeekKey: weekKey,
      });
      weekAssignedOt.set(weekKey, (weekAssignedOt.get(weekKey) ?? 0) + (kind !== 'none' ? chunkMinutes : 0));
      weekAssignedDouble.set(weekKey, (weekAssignedDouble.get(weekKey) ?? 0) + (kind === 'double_time' ? chunkMinutes : 0));
      cursorMinute += chunkMinutes;
    }
    classified.push(...slices);
  }

  // --- Weekly top-up (only when weekly OT produces MORE than daily) --------
  for (const [weekKey, candidateWeekly] of weekRemainingOt) {
    const alreadyAssigned = weekAssignedOt.get(weekKey) ?? 0;
    let toConvert = candidateWeekly - alreadyAssigned;
    if (toConvert <= 0) continue;
    // Convert the LAST regular minutes of the week into overtime.
    const weekSegments = classified
      .filter((s) => s.workWeekKey === weekKey && s.overtimeKind === 'none')
      .sort((a, b) => a.startMs - b.startMs);
    for (let i = weekSegments.length - 1; i >= 0 && toConvert > 0; i -= 1) {
      const slice = weekSegments[i];
      const take = Math.min(slice.minutes, toConvert);
      toConvert -= take;
      convertSlice(slice, take, 'overtime', rule.overtimeMultiplier, classified);
    }
  }

  // --- Weekly double-time top-up ------------------------------------------
  if (doubleWeeklyMinutes !== null) {
    for (const [weekKey, candidateDouble] of weekRemainingDouble) {
      const alreadyDouble = weekAssignedDouble.get(weekKey) ?? 0;
      let toConvert = candidateDouble - alreadyDouble;
      if (toConvert <= 0) continue;
      const weekSegments = classified
        .filter((s) => s.workWeekKey === weekKey && s.overtimeKind !== 'double_time')
        .sort((a, b) => a.startMs - b.startMs);
      for (let i = weekSegments.length - 1; i >= 0 && toConvert > 0; i -= 1) {
        const slice = weekSegments[i];
        const take = Math.min(slice.minutes, toConvert);
        toConvert -= take;
        convertSlice(slice, take, 'double_time', rule.doubleTimeMultiplier ?? 2, classified);
      }
    }
  }

  // --- Summaries -----------------------------------------------------------
  const perWeek = [...weekTotals.entries()].map(([key, total]) => {
    const weekSegments = classified.filter((s) => s.workWeekKey === key);
    const week = workWeekFor(weekSegments[0]?.dateKey ?? key, { startsOn: workWeek.startsOn, averagingWeeks: Math.max(1, rule.averagingWeeks) });
    return {
      key,
      label: week.label,
      totalMinutes: total,
      overtimeMinutes: weekSegments.filter((s) => s.overtimeKind === 'overtime').reduce((sum, s) => sum + s.minutes, 0),
      doubleTimeMinutes: weekSegments.filter((s) => s.overtimeKind === 'double_time').reduce((sum, s) => sum + s.minutes, 0),
    };
  });

  const dayKeys = [...new Set(classified.map((s) => s.dateKey))].sort();
  const perDay = dayKeys.map((dateKey) => {
    const daySegments = classified.filter((s) => s.dateKey === dateKey);
    return {
      dateKey,
      totalMinutes: daySegments.reduce((sum, s) => sum + s.minutes, 0),
      overtimeMinutes: daySegments.filter((s) => s.overtimeKind === 'overtime').reduce((sum, s) => sum + s.minutes, 0),
      doubleTimeMinutes: daySegments.filter((s) => s.overtimeKind === 'double_time').reduce((sum, s) => sum + s.minutes, 0),
    };
  });

  const totalMinutes = classified.reduce((sum, s) => sum + s.minutes, 0);
  const overtimeMinutes = classified.filter((s) => s.overtimeKind === 'overtime').reduce((sum, s) => sum + s.minutes, 0);
  const doubleTimeMinutes = classified.filter((s) => s.overtimeKind === 'double_time').reduce((sum, s) => sum + s.minutes, 0);

  return {
    segments: classified.sort((a, b) => a.startMs - b.startMs),
    totalMinutes,
    overtimeMinutes,
    doubleTimeMinutes,
    regularMinutes: totalMinutes - overtimeMinutes - doubleTimeMinutes,
    perWeek: perWeek.sort((a, b) => a.key.localeCompare(b.key)),
    perDay,
    rule,
  };
}

/** Minutes remaining before the weekly overtime threshold is reached. */
export function minutesUntilOvertime(workedMinutes: Minutes, rule: ResolvedOvertimeRule): Minutes | null {
  if (!rule.weeklyOvertimeApplies || rule.weeklyThresholdHours === null) return null;
  const threshold = Math.round(rule.weeklyThresholdHours * 60);
  return Math.max(0, threshold - workedMinutes);
}

/**
 * Converts the trailing `take` minutes of a slice into an overtime tier,
 * splitting the slice when only part of it converts. The untouched remainder is
 * pushed back into the working pool so later passes can still see it.
 */
function convertSlice(
  slice: ClassifiedSegment,
  take: number,
  kind: OvertimeKind,
  multiplier: number,
  pool: ClassifiedSegment[],
): void {
  if (take <= 0) return;
  const originalMinutes = slice.minutes;
  const previousKind = slice.overtimeKind;
  const previousMultiplier = slice.multiplier;
  const splitMs =
    take >= originalMinutes
      ? slice.endMs
      : Math.round(slice.startMs + (slice.endMs - slice.startMs) * (take / originalMinutes));
  if (take < originalMinutes) {
    const remainingMinutes = originalMinutes - take;
    const rest: ClassifiedSegment = {
      ...slice,
      startMs: splitMs,
      minutes: remainingMinutes,
      localStartMinute: slice.localStartMinute + take,
      localEndMinute: slice.localStartMinute + take + remainingMinutes,
      // The untouched remainder keeps whatever classification it already had
      // (a double-time upgrade must not demote the rest back to regular time).
      overtimeKind: previousKind,
      multiplier: previousMultiplier,
    };
    pool.push(rest);
    slice.endMs = splitMs;
    slice.minutes = take;
    slice.localEndMinute = slice.localStartMinute + take;
  }
  slice.overtimeKind = kind;
  slice.multiplier = multiplier;
}
