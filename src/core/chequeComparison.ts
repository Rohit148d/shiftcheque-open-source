/**
 * chequeComparisonEngine (spec 22/23/24/106)
 *
 * Compares what the app estimated with what actually landed on the payslip.
 * Language rules are enforced here, in code: findings are neutral, never
 * accusatory, and always framed as things worth checking.
 */
import { abs, type Micro } from './money.ts';
import type { Minutes } from './duration.ts';

export type ExpectedSnapshot = {
  gross: Micro;
  net: Micro;
  regularMinutes: Minutes;
  overtimeMinutes: Minutes;
  doubleTimeMinutes: Minutes;
  premiumPay: Micro;
  vacationPay: Micro;
  lines: { label: string; amount: Micro }[];
  deductions: { code: string; label: string; amount: Micro }[];
  cpp: Micro;
  ei: Micro;
  tax: Micro;
};

export type ActualLine = {
  /** Matches earnings/deduction codes where possible. */
  code: string;
  label: string;
  amount: Micro;
  minutes?: Minutes;
};

export type ActualPaychequeInput = {
  actualNet: Micro;
  actualGross?: Micro;
  minutes?: { regularMinutes?: Minutes; overtimeMinutes?: Minutes; doubleTimeMinutes?: Minutes };
  lines: ActualLine[];
};

export type ComparisonStatus = 'match' | 'close' | 'differs' | 'missing_expected' | 'missing_actual' | 'not_comparable';

export type ComparisonRow = {
  id: string;
  label: string;
  expected?: Micro;
  actual?: Micro;
  expectedMinutes?: Minutes;
  actualMinutes?: Minutes;
  /** Money difference (Micro). */
  difference?: Micro;
  /** Minutes difference, for hours rows. */
  differenceMinutes?: number;
  status: ComparisonStatus;
  unit: 'money' | 'minutes';
};

export type ComparisonOutcome =
  | 'looks_close'
  | 'difference_found'
  | 'worth_reviewing'
  | 'more_information_needed'
  | 'could_not_verify';

export type ComparisonResult = {
  outcome: ComparisonOutcome;
  headline: string;
  summary: string;
  netDifference: Micro | null;
  grossDifference: Micro | null;
  rows: ComparisonRow[];
  findings: string[];
  possibleExplanations: string[];
  /** Percentage of the net estimate that the difference represents. */
  netDifferencePercent: number | null;
};

const CLOSE_NET_ABSOLUTE = 5_000_000n; // $5.00
const CLOSE_PERCENT = 0.01; // 1%

export function comparePaycheque(expected: ExpectedSnapshot, actual: ActualPaychequeInput): ComparisonResult {
  const rows: ComparisonRow[] = [];
  const findings: string[] = [];

  const hasGross = actual.actualGross !== undefined;
  const netDifference = actual.actualNet - expected.net;
  const grossDifference = hasGross ? (actual.actualGross as Micro) - expected.gross : null;

  // --- Net ----------------------------------------------------------------
  const netTolerance = maxBigint(CLOSE_NET_ABSOLUTE, mulPercent(expected.net, CLOSE_PERCENT));
  const netStatus: ComparisonStatus = abs(netDifference) <= netTolerance ? 'match' : 'differs';
  rows.push({
    id: 'net',
    label: 'Take-home pay',
    expected: expected.net,
    actual: actual.actualNet,
    difference: netDifference,
    status: netStatus,
    unit: 'money',
  });
  if (netStatus === 'differs') {
    findings.push(
      `Take-home pay differs by ${formatSigned(netDifference)}. That is the number most people notice first, so it is worth a closer look.`,
    );
  }

  // --- Gross --------------------------------------------------------------
  if (hasGross) {
    const grossTolerance = maxBigint(20_000_000n, mulPercent(expected.gross, 0.02));
    const grossStatus: ComparisonStatus = abs(grossDifference as Micro) <= grossTolerance ? 'match' : 'differs';
    rows.push({
      id: 'gross',
      label: 'Gross pay',
      expected: expected.gross,
      actual: actual.actualGross,
      difference: grossDifference as Micro,
      status: grossStatus,
      unit: 'money',
    });
    if (grossStatus === 'differs') {
      findings.push(`Gross pay differs by ${formatSigned(grossDifference as Micro)}.`);
    }
  } else {
    rows.push({
      id: 'gross',
      label: 'Gross pay',
      expected: expected.gross,
      status: 'missing_actual',
      unit: 'money',
    });
  }

  // --- Hours --------------------------------------------------------------
  if (actual.minutes) {
    pushMinutesRow(rows, 'regular', 'Regular hours', expected.regularMinutes, actual.minutes.regularMinutes);
    pushMinutesRow(rows, 'overtime', 'Overtime hours', expected.overtimeMinutes, actual.minutes.overtimeMinutes);
    pushMinutesRow(rows, 'double_time', 'Double-time hours', expected.doubleTimeMinutes, actual.minutes.doubleTimeMinutes);
  }

  // --- Lines --------------------------------------------------------------
  for (const line of actual.lines) {
    const expectedLine = expected.lines.find((candidate) => candidate.label.toLowerCase() === line.label.toLowerCase());
    if (!expectedLine) {
      rows.push({ id: `line-${line.code}`, label: line.label, actual: line.amount, status: 'missing_expected', unit: 'money' });
      continue;
    }
    const difference = line.amount - expectedLine.amount;
    const tolerance = maxBigint(1_000_000n, mulPercent(abs(expectedLine.amount), 0.02));
    rows.push({
      id: `line-${line.code}`,
      label: line.label,
      expected: expectedLine.amount,
      actual: line.amount,
      difference,
      status: abs(difference) <= tolerance ? 'match' : 'differs',
      unit: 'money',
    });
  }

  for (const line of expected.lines) {
    const found = actual.lines.some((candidate) => candidate.label.toLowerCase() === line.label.toLowerCase());
    if (!found) {
      rows.push({ id: `expected-${line.label}`, label: line.label, expected: line.amount, status: 'missing_actual', unit: 'money' });
    }
  }

  // --- Do we know enough to say anything? --------------------------------
  const overtimeMismatch = rows.find((row) => row.id === 'overtime' && row.status === 'differs');
  const comparable = hasGross || actual.lines.length > 0;
  const netPercent = expected.net !== 0n ? (Number(netDifference) / Number(expected.net)) * 100 : null;

  let outcome: ComparisonOutcome;
  let headline: string;
  let summary: string;

  if (!comparable) {
    outcome = 'more_information_needed';
    headline = 'We could not verify this yet';
    summary =
      'We have your net deposit but no payslip details, so we can only compare the bottom line. Add gross pay or a few payslip lines to see what might explain the difference.';
  } else if (netStatus === 'match' && !rows.some((row) => row.status === 'differs')) {
    outcome = 'looks_close';
    headline = 'Your cheque looks close to our estimate';
    summary = 'The numbers line up within a few dollars. Nothing stands out as needing a second look.';
  } else if (netStatus === 'match') {
    outcome = 'difference_found';
    headline = 'Take-home matches, but some lines differ';
    summary =
      'Your take-home pay is close to the estimate, yet individual lines differ. This often happens when hours are split differently between regular and overtime.';
  } else if (abs(netDifference) <= mulPercent(expected.net, 0.05)) {
    outcome = 'difference_found';
    headline = 'There is a difference worth a quick look';
    summary = `Take-home pay differs by ${formatSigned(netDifference)} (about ${netPercent === null ? 'a few percent' : `${Math.abs(netPercent).toFixed(1)}%`}). There are several ordinary reasons for this.`;
  } else {
    outcome = 'worth_reviewing';
    headline = 'Worth reviewing';
    summary = `Take-home pay differs by ${formatSigned(netDifference)}${
      netPercent === null ? '' : ` (about ${Math.abs(netPercent).toFixed(1)}%)`
    }. Start with the lines below.`;
  }

  if (overtimeMismatch) {
    findings.push(
      `Overtime hours differ: our estimate has ${formatHoursValue(overtimeMismatch.expectedMinutes)}, your payslip shows ${formatHoursValue(
        overtimeMismatch.actualMinutes,
      )}.`,
    );
  }

  const possibleExplanations = buildPossibleExplanations(rows, expected, actual);

  return {
    outcome,
    headline,
    summary,
    netDifference,
    grossDifference,
    rows,
    findings,
    possibleExplanations,
    netDifferencePercent: netPercent,
  };
}

function pushMinutesRow(
  rows: ComparisonRow[],
  id: string,
  label: string,
  expectedMinutes: Minutes,
  actualMinutes: Minutes | undefined,
): void {
  if (actualMinutes === undefined) {
    rows.push({ id, label, expectedMinutes, status: 'missing_actual', unit: 'minutes' });
    return;
  }
  const difference = actualMinutes - expectedMinutes;
  const tolerance = Math.max(30, Math.round(expectedMinutes * 0.02));
  rows.push({
    id,
    label,
    expectedMinutes,
    actualMinutes,
    differenceMinutes: difference,
    status: Math.abs(difference) <= tolerance ? 'match' : 'differs',
    unit: 'minutes',
  });
}

function buildPossibleExplanations(
  rows: ComparisonRow[],
  expected: ExpectedSnapshot,
  actual: ActualPaychequeInput,
): string[] {
  const explanations: string[] = [];
  const differs = rows.filter((row) => row.status === 'differs');

  if (differs.some((row) => row.id === 'overtime')) {
    explanations.push('different employer work-week boundaries than the ones configured in the app');
    explanations.push('an averaged or banked overtime arrangement at your workplace');
    explanations.push('a timesheet that was edited after it was submitted');
    explanations.push('an overtime record here that does not match the approved timesheet');
  }
  if (differs.some((row) => row.id === 'gross') || differs.some((row) => row.id === 'net')) {
    explanations.push('a different hourly rate, or a rate change that took effect on another date');
    explanations.push('premiums or a shift differential that was applied differently than configured');
    explanations.push('deductions such as union dues, benefits or a pension plan that are not set up here');
  }
  if (differs.some((row) => row.id.startsWith('line-')) || differs.some((row) => row.id === 'net')) {
    explanations.push('a new or changed tax claim amount on file with your employer');
    explanations.push('a deduction that appears on your payslip but is not part of the app estimate');
  }
  if (expected.vacationPay > 0n) {
    explanations.push('vacation pay paid at a different time than assumed');
  }
  if (actual.lines.length === 0) {
    explanations.push('entering your payslip lines would narrow this down quickly');
  }
  if (explanations.length === 0) {
    explanations.push('nothing obvious — the numbers are within the rounding range of the estimate');
  }
  return [...new Set(explanations)];
}

function mulPercent(value: Micro, percent: number): Micro {
  return (value * BigInt(Math.round(percent * 10_000))) / 10_000n;
}

function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function formatSigned(value: Micro): string {
  const negative = value < 0n;
  const formatted = formatMoneyAbs(negative ? -value : value);
  return `${negative ? '-' : '+'}${formatted}`;
}

function formatMoneyAbs(value: Micro): string {
  const dollars = Number(value) / 1_000_000;
  return `$${dollars.toFixed(2)}`;
}

function formatHoursValue(minutes?: Minutes): string {
  if (minutes === undefined) return 'no hours';
  const hours = minutes / 60;
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
}
