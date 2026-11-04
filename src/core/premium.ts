/**
 * premiumEngine (spec 32)
 *
 * Splits a shift into time slices and evaluates every configured premium rule
 * against each slice: time windows (wrapping midnight), days of week, weekends,
 * statutory holidays, effective dates, stacking, priority and whether the
 * premium counts toward the overtime base.
 *
 * Premiums are workplace rules, not legal rules: they come from the job
 * configuration, so the engine never claims a statutory entitlement.
 */
import { payForMinutes, type Minutes } from './duration.ts';
import { divRoundHalfUp, mulRatio, roundToCents, type Micro } from './money.ts';
import type { ClassifiedSegment, PremiumRule } from './types.ts';

export type PremiumMatchInput = {
  shiftId: string;
  segments: ClassifiedSegment[];
  /** Base hourly rate that applies to each segment (already rate-history resolved). */
  rateForSegment: (segment: ClassifiedSegment) => Micro;
  holidayDates: Set<string>;
  /** Local date used to evaluate the rule's effective dates. */
  effectiveDate: string;
};

export type PremiumEarning = {
  ruleId: string;
  label: string;
  type: PremiumRule['type'];
  minutes: Minutes;
  amount: Micro;
  /** e.g. "18 h × $1.25/h" or "10% of $943.00" */
  detail: string;
  includedInOtBase: boolean;
};

export type PremiumResult = {
  earnings: PremiumEarning[];
  totalMinutes: Minutes;
  total: Micro;
};

type SliceMatch = {
  segment: ClassifiedSegment;
  minutes: Minutes;
};

/** Overlap in minutes between a slice's local minute range and a rule window. */
export function windowOverlapMinutes(segment: ClassifiedSegment, window: { startMinute: number; endMinute: number }): Minutes {
  const start = segment.localStartMinute;
  const end = segment.localEndMinute;
  const length = end - start;
  if (length <= 0) return 0;
  const windows: { from: number; to: number }[] = [];
  const { startMinute, endMinute } = window;
  if (startMinute < endMinute) {
    windows.push({ from: startMinute, to: endMinute });
  } else if (startMinute > endMinute) {
    // wraps midnight (e.g. 22:00 -> 06:00)
    windows.push({ from: startMinute, to: 1440 });
    windows.push({ from: 0, to: endMinute });
  } else {
    return 0;
  }
  // The slice may also wrap midnight in its local range; shift the candidate
  // windows across adjacent days to find the overlap.
  let best = 0;
  for (const shift of [0, -1440, 1440, -2880, 2880]) {
    for (const w of windows) {
      const overlap = Math.max(0, Math.min(end, w.to + shift) - Math.max(start, w.from + shift));
      best += overlap;
    }
  }
  return Math.min(best, length);
}

function dayOfWeekFromKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function ruleAppliesTo(rule: PremiumRule, segment: ClassifiedSegment, input: PremiumMatchInput): boolean {
  if (!rule.enabled) return false;
  if (rule.effectiveFrom && input.effectiveDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo && input.effectiveDate > rule.effectiveTo) return false;
  if (rule.holidayOnly && !input.holidayDates.has(segment.dateKey)) return false;
  if (rule.weekendOnly) {
    const dow = dayOfWeekFromKey(segment.dateKey);
    if (dow !== 0 && dow !== 6) return false;
  }
  if (rule.days && rule.days.length > 0 && !rule.days.includes(dayOfWeekFromKey(segment.dateKey))) return false;
  if (!rule.appliesDuringOvertime && segment.overtimeKind !== 'none') return false;
  if (rule.window) {
    const overlap = windowOverlapMinutes(segment, rule.window);
    if (overlap <= 0) return false;
  }
  return true;
}

function matchedMinutes(rule: PremiumRule, segment: ClassifiedSegment): Minutes {
  if (rule.window) return windowOverlapMinutes(segment, rule.window);
  return segment.minutes;
}

function amountFor(
  rule: PremiumRule,
  minutes: Minutes,
  segmentMultiplier: number,
  baseRate: Micro,
): { amount: Micro; detail: string } {
  const baseEarnings = payForMinutes(baseRate, minutes);
  switch (rule.type) {
    case 'per_hour': {
      const rate = typeof rule.amount === 'bigint' ? rule.amount : BigInt(Math.round(Number(rule.amount)));
      let amount = payForMinutes(rate, minutes);
      if (rule.includedInOtBase && segmentMultiplier > 1) {
        amount = mulRatio(amount, Math.round(segmentMultiplier * 1000), 1000);
      }
      return { amount: roundToCents(amount), detail: `${formatHoursShort(minutes)} × $/h premium` };
    }
    case 'per_shift': {
      const rate = typeof rule.amount === 'bigint' ? rule.amount : BigInt(Math.round(Number(rule.amount)));
      return { amount: roundToCents(rate), detail: 'per shift' };
    }
    case 'percentage': {
      const percent = typeof rule.amount === 'bigint' ? Number(rule.amount) / 1_000_000 : Number(rule.amount);
      let amount = divRoundHalfUp(baseEarnings * BigInt(Math.round(percent * 100)), 10_000n);
      if (rule.includedInOtBase && segmentMultiplier > 1) {
        amount = mulRatio(amount, Math.round(segmentMultiplier * 1000), 1000);
      }
      return { amount: roundToCents(amount), detail: `${percent}% of base pay` };
    }
    case 'multiplier':
    default: {
      const multiplier = typeof rule.amount === 'bigint' ? Number(rule.amount) / 1_000_000 : Number(rule.amount);
      const extra = Math.max(0, multiplier - segmentMultiplier);
      const amount = mulRatio(baseEarnings, Math.round(extra * 1000), 1000);
      return { amount: roundToCents(amount), detail: `${multiplier}× instead of ${segmentMultiplier}×` };
    }
  }
}

function formatHoursShort(minutes: Minutes): string {
  const hours = minutes / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 2)} h`;
}

export function computePremiums(input: PremiumMatchInput, rules: PremiumRule[]): PremiumResult {
  const earnings = new Map<string, PremiumEarning>();
  const perShiftApplied = new Set<string>();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const segment of input.segments) {
      const matches = ruleAppliesTo(rule, segment, input);
      if (!matches) continue;
      if (rule.type === 'per_shift') {
        if (perShiftApplied.has(rule.id)) continue;
        const appliesSomewhere = input.segments.some((s) => ruleAppliesTo(rule, s, input));
        if (!appliesSomewhere) continue;
        perShiftApplied.add(rule.id);
        const baseRate = input.rateForSegment(segment);
        const { amount, detail } = amountFor(rule, segment.minutes, segment.multiplier, baseRate);
        accumulate(earnings, rule, amount, 0, detail);
        continue;
      }
      const minutes = matchedMinutes(rule, segment);
      if (minutes <= 0) continue;
      const baseRate = input.rateForSegment(segment);
      const { amount, detail } = amountFor(rule, minutes, segment.multiplier, baseRate);
      accumulate(earnings, rule, amount, minutes, detail);
    }
  }

  // Non-stackable conflicts: on overlapping slices only the highest priority
  // non-stackable rule survives. Because rules are aggregated per shift we
  // apply priority at the segment level first, then rebuild totals.
  const conflicts = findNonStackableConflicts(input, rules);
  for (const conflict of conflicts) {
    const entry = earnings.get(conflict.ruleId);
    if (!entry) continue;
    earnings.set(conflict.ruleId, {
      ...entry,
      minutes: Math.max(0, entry.minutes - conflict.minutes),
      amount: entry.amount - conflict.minutesAmount,
      detail: `${entry.detail} (overlap with higher-priority rule removed)`,
    });
  }

  const list = [...earnings.values()].filter((entry) => entry.amount !== 0n || entry.minutes > 0);
  return {
    earnings: list.sort((a, b) => Number(b.amount - a.amount)),
    totalMinutes: list.reduce((sum, entry) => sum + entry.minutes, 0),
    total: list.reduce((sum, entry) => sum + entry.amount, 0n),
  };
}

function accumulate(map: Map<string, PremiumEarning>, rule: PremiumRule, amount: Micro, minutes: Minutes, detail: string): void {
  const existing = map.get(rule.id);
  if (existing) {
    map.set(rule.id, {
      ...existing,
      amount: existing.amount + amount,
      minutes: existing.minutes + minutes,
      detail: existing.detail,
    });
    return;
  }
  map.set(rule.id, {
    ruleId: rule.id,
    label: rule.label,
    type: rule.type,
    minutes,
    amount,
    detail,
    includedInOtBase: rule.includedInOtBase,
  });
}

type Conflict = { ruleId: string; minutes: number; minutesAmount: Micro };

/** Removes lower-priority non-stackable premium time. */
function findNonStackableConflicts(input: PremiumMatchInput, rules: PremiumRule[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = rules.filter((rule) => rule.enabled && !rule.stackable);
  if (active.length < 2) return conflicts;

  // For every slice, find the winning non-stackable rule, and subtract the
  // losing rules' overlap.
  for (const segment of input.segments) {
    const matching = active
      .filter((rule) => ruleAppliesTo(rule, segment, input) && rule.type !== 'per_shift')
      .sort((a, b) => b.priority - a.priority);
    if (matching.length < 2) continue;
    for (const loser of matching.slice(1)) {
      const minutes = matchedMinutes(loser, segment);
      if (minutes <= 0) continue;
      const baseRate = input.rateForSegment(segment);
      const { amount } = amountFor(loser, minutes, segment.multiplier, baseRate);
      conflicts.push({ ruleId: loser.id, minutes, minutesAmount: amount });
    }
  }
  return conflicts;
}
