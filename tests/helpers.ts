/**
 * Test fixtures shared by the engine test suites.
 * Not a test file itself: `node --test` runs only *.test.ts.
 */
import { microFromDollars, type Micro } from '../src/core/money.ts';
import type { BreakRule, DeductionProfile, Job, PremiumRule, RateRecord, Shift, ShiftType } from '../src/core/types.ts';

export const TZ = 'America/Toronto' as const;

export function money(value: string | number): Micro {
  return microFromDollars(value);
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  const base: Job = {
    id: 'job-1',
    name: 'Warehouse',
    colour: '#D52B1E',
    icon: 'package',
    jurisdiction: 'ON',
    taxProvince: 'ON',
    zone: TZ,
    hourlyRate: money('24.50'),
    overtime: {
      source: 'jurisdiction',
      tiers: [],
      dailyOvertimeApplies: true,
      weeklyOvertimeApplies: true,
      hasAgreement: 'no',
    },
    premiums: [],
    vacation: { method: 'each_cheque' },
    workWeek: { startsOn: 0, averagingWeeks: 1 },
    paySchedule: { frequency: 'biweekly', anchorStart: '2026-01-01', paydayOffsetDays: 5 },
    holidayPolicy: { mode: 'jurisdiction_standard', paysHolidayPay: false },
    rounding: { step: 0, mode: 'exact' },
    dstPolicy: 'wall_clock',
    defaultBreaks: [{ label: 'Unpaid break', minutes: 30, paid: false }],
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

let shiftCounter = 0;

export function makeShift(overrides: Partial<Shift> = {}): Shift {
  shiftCounter += 1;
  const base: Shift = {
    id: `shift-${shiftCounter}`,
    jobId: 'job-1',
    date: '2026-10-05',
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
    scheduledOvernight: false,
    breaks: [{ label: 'Unpaid break', minutes: 30, paid: false }],
    type: 'work' as ShiftType,
    status: 'scheduled',
    confirmed: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

export function makeProfile(overrides: Partial<DeductionProfile> = {}): DeductionProfile {
  const base: DeductionProfile = {
    id: 'profile-1',
    jobId: 'job-1',
    cppExempt: false,
    eiExempt: false,
    federalClaimCode: 'default',
    provincialClaimCode: 'default',
    fixedDeductions: [],
    percentDeductions: [],
    ytd: null,
  };
  return { ...base, ...overrides };
}

export function makeRates(...values: [string, string][]): RateRecord[] {
  return values.map(([amount, effectiveFrom], index) => ({
    id: `rate-${index}`,
    jobId: 'job-1',
    rate: money(amount),
    effectiveFrom,
  }));
}

export function premium(overrides: Partial<PremiumRule> = {}): PremiumRule {
  const base: PremiumRule = {
    id: 'premium-1',
    label: 'Night premium',
    type: 'per_hour',
    amount: money('1.25'),
    window: { startMinute: 23 * 60, endMinute: 7 * 60 },
    stackable: true,
    priority: 10,
    includedInOtBase: false,
    appliesDuringOvertime: true,
    enabled: true,
  };
  return { ...base, ...overrides };
}

export const breakRule = (minutes: number, paid = false): BreakRule => ({ label: 'Break', minutes, paid });
