/**
 * Shift progress classification — the single place that decides whether a shift
 * counts as already worked, still running, or merely scheduled.
 *
 * The distinction is what makes "60 h worked • 15 h scheduled • 75 h projected"
 * possible without overloading one number to mean three things.
 */
import { EARNING_SHIFT_TYPES, type Shift } from './types.ts';

export type ShiftProgress =
  /** Already worked: completed/confirmed, or a past shift that was not marked otherwise. */
  | 'worked'
  /** Running right now: live elapsed counts as worked, the rest stays scheduled. */
  | 'in_progress'
  /** Upcoming scheduled work inside the pay period. */
  | 'scheduled'
  /** Cancelled, missed, or a non-earning entry (off/custom). */
  | 'excluded';

export function classifyShiftProgress(shift: Shift, today: string): ShiftProgress {
  if (!EARNING_SHIFT_TYPES.includes(shift.type)) return 'excluded';
  if (shift.status === 'missed') return 'excluded';
  if (shift.status === 'in_progress') return 'in_progress';
  if (shift.status === 'completed' || shift.confirmed) return 'worked';
  if (shift.date < today) return 'worked';
  return 'scheduled';
}

/** True when a shift contributes minutes to worked or projected totals. */
export function isEarningProgress(progress: ShiftProgress): boolean {
  return progress === 'worked' || progress === 'in_progress' || progress === 'scheduled';
}
