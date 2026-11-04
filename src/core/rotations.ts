/**
 * Rotation presets (spec 7, step 8).
 *
 * A rotation is a repeating cycle of day types. Generating real shifts from it
 * is what makes onboarding pay off immediately: the user picks "2 days /
 * 2 nights / 4 off" and their calendar is populated for the next month.
 */
import { addDays } from './tz.ts';
import type { BreakRule, Shift } from './types.ts';

export type RotationDayType = 'day' | 'evening' | 'night' | 'off';

export type RotationPreset = {
  id: string;
  labelKey: string;
  /** Repeating cycle of day types. */
  cycle: RotationDayType[];
  description: string;
};

export const ROTATION_PRESETS: RotationPreset[] = [
  { id: 'none', labelKey: 'onboarding.rotation.none', cycle: [], description: 'You add shifts yourself.' },
  { id: 'monday_friday', labelKey: 'onboarding.rotation.mondayFriday', cycle: ['off', 'day', 'day', 'day', 'day', 'day', 'off'], description: 'Monday to Friday days.' },
  { id: 'four_on_four_off', labelKey: 'onboarding.rotation.fourOnFourOff', cycle: ['day', 'day', 'day', 'day', 'off', 'off', 'off', 'off'], description: '4 days on, 4 days off.' },
  { id: 'two_day_two_night_four_off', labelKey: 'onboarding.rotation.twoDayTwoNight', cycle: ['day', 'day', 'night', 'night', 'off', 'off', 'off', 'off'], description: '2 days, 2 nights, 4 off.' },
  { id: 'two_two_three', labelKey: 'onboarding.rotation.223', cycle: ['day', 'day', 'day', 'off', 'off', 'day', 'day', 'off', 'off', 'off', 'day', 'day', 'day'], description: '2-2-3 pattern over two weeks.' },
  { id: 'pitman', labelKey: 'onboarding.rotation.pitman', cycle: ['day', 'day', 'day', 'day', 'day', 'day', 'day', 'off', 'off', 'day', 'day', 'day', 'day', 'day', 'off'], description: 'Pitman schedule.' },
  { id: 'dupont', labelKey: 'onboarding.rotation.dupont', cycle: ['day', 'day', 'day', 'day', 'off', 'off', 'off', 'night', 'night', 'night', 'night', 'off', 'off', 'off'], description: 'DuPont schedule.' },
  { id: 'custom', labelKey: 'onboarding.rotation.custom', cycle: [], description: 'You describe it and we keep it for later.' },
];

export function rotationById(id: string): RotationPreset | undefined {
  return ROTATION_PRESETS.find((preset) => preset.id === id);
}

export type RotationShiftTemplate = {
  startClock: string;
  endClock: string;
  overnight: boolean;
};

export const DEFAULT_ROTATION_TIMES: Record<Exclude<RotationDayType, 'off'>, RotationShiftTemplate> = {
  day: { startClock: '07:00', endClock: '15:00', overnight: false },
  evening: { startClock: '15:00', endClock: '23:00', overnight: false },
  night: { startClock: '23:00', endClock: '07:00', overnight: true },
};

/**
 * Generates shifts from a rotation for `days` ahead of `startDate`.
 * `anchorDate` is the first day of the cycle.
 */
export function generateRotationShifts(input: {
  jobId: string;
  preset: RotationPreset;
  anchorDate: string;
  startDate: string;
  days: number;
  breaks: BreakRule[];
  times?: Partial<Record<Exclude<RotationDayType, 'off'>, RotationShiftTemplate>>;
  now?: Date;
}): Shift[] {
  const { jobId, preset, anchorDate, startDate, days, breaks } = input;
  if (preset.cycle.length === 0) return [];
  const shifts: Shift[] = [];
  const iso = (input.now ?? new Date()).toISOString();
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(startDate, offset);
    const diff = daysBetween(anchorDate, date);
    const cycleIndex = ((diff % preset.cycle.length) + preset.cycle.length) % preset.cycle.length;
    const dayType = preset.cycle[cycleIndex];
    if (dayType === 'off') continue;
    const template = { ...DEFAULT_ROTATION_TIMES[dayType], ...(input.times?.[dayType] ?? {}) };
    shifts.push({
      id: `rot-${jobId}-${date}-${template.startClock.replace(':', '')}`,
      jobId,
      date,
      scheduledStart: template.startClock,
      scheduledEnd: template.endClock,
      scheduledOvernight: template.overnight,
      breaks: [...breaks],
      type: 'work',
      status: 'scheduled',
      confirmed: false,
      createdAt: iso,
      updatedAt: iso,
    });
  }
  return shifts;
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
