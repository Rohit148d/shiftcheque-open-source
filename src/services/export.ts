/**
 * Exports (spec 78): CSV for spreadsheets, PDF for a personal pay report.
 *
 * Both are generated on the device. A report is explicitly labelled a personal
 * estimate, never an official payslip.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { BRAND } from '../config/brand.ts';
import { toFixed } from '../core/money.ts';
import { payPeriodFor, type PayPeriod } from '../core/workweek.ts';
import type { PayPeriodCalculation } from '../core/calculate.ts';
import { calculateForJob, periodsForJob, type StoreSlice } from '../state/selectors.ts';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export type ExportResult = { status: 'exported'; fileName: string; uri: string } | { status: 'failed'; reason: string };

async function writeAndShare(fileName: string, contents: string, mimeType: string): Promise<ExportResult> {
  try {
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(contents);
    if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Share ${fileName}` });
    }
    return { status: 'exported', fileName, uri: file.uri };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Shifts + hours + earnings, one row per shift, ready for a spreadsheet. */
export async function exportShiftsCsv(state: StoreSlice, jobId: string): Promise<ExportResult> {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return { status: 'failed', reason: 'No job selected.' };
  const periods = periodsForJob(state, jobId, 26);
  const rows: (string | number)[][] = [
    ['Period start', 'Period end', 'Payday', 'Date', 'Shift type', 'Scheduled start', 'Scheduled end', 'Paid hours', 'Overtime hours', 'Estimated gross (CAD)', 'Estimated net (CAD)'],
  ];
  for (const period of periods) {
    const calculation = calculateForJob(state, jobId, period.start);
    if (!calculation) continue;
    for (const shift of calculation.periodShifts) {
      const bucket = calculation.gross.byShift.get(shift.id);
      const time = calculation.shiftTimes.get(shift.id);
      rows.push([
        period.start,
        period.end,
        period.payday,
        shift.date,
        shift.type,
        shift.scheduledStart,
        shift.scheduledEnd,
        ((time?.paidMinutes ?? 0) / 60).toFixed(2),
        ((bucket?.overtimeMinutes ?? 0) / 60).toFixed(2),
        toFixed(bucket?.total ?? 0n, 2),
        '',
      ]);
    }
  }
  const fileName = `${BRAND.SHORT_NAME.toLowerCase()}-shifts-${state.today}.csv`;
  return writeAndShare(fileName, csvRows(rows), 'text/csv');
}

/** Pay-period summary CSV (one row per period, including deductions). */
export async function exportPeriodsCsv(state: StoreSlice, jobId: string): Promise<ExportResult> {
  const periods = periodsForJob(state, jobId, 26);
  const rows: (string | number)[][] = [
    ['Period start', 'Period end', 'Payday', 'Paid hours', 'Overtime hours', 'Gross', 'CPP', 'CPP2', 'EI', 'QPP', 'QPP2', 'QPIP', 'Federal tax', 'Provincial tax', 'Other deductions', 'Estimated net'],
  ];
  for (const period of periods) {
    const calculation = calculateForJob(state, jobId, period.start);
    if (!calculation) continue;
    const line = (code: string) =>
      calculation.deductions.lines.filter((entry) => entry.code === code).reduce((sum, entry) => sum + entry.amount, 0n);
    rows.push([
      period.start,
      period.end,
      period.payday,
      (calculation.totalPaidMinutes / 60).toFixed(2),
      (calculation.overtime.overtimeMinutes / 60).toFixed(2),
      toFixed(calculation.gross.gross, 2),
      toFixed(-line('CPP'), 2),
      toFixed(-line('CPP2'), 2),
      toFixed(-line('EI'), 2),
      toFixed(-line('QPP'), 2),
      toFixed(-line('QPP2'), 2),
      toFixed(-line('QPIP'), 2),
      toFixed(-line('FED_TAX'), 2),
      toFixed(-line('PROV_TAX'), 2),
      toFixed(-line('OTHER'), 2),
      toFixed(calculation.deductions.net, 2),
    ]);
  }
  return writeAndShare(`${BRAND.SHORT_NAME.toLowerCase()}-periods-${state.today}.csv`, csvRows(rows), 'text/csv');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function reportHtml(state: StoreSlice, jobId: string, period: PayPeriod, calculation: PayPeriodCalculation): string {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  const money = (value: bigint) => `$${toFixed(value, 2)}`;
  const rows = (items: { label: string; amount: string }[]) =>
    items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td class="right">${item.amount}</td></tr>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #0E1B2A; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #5A6472; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 0; border-bottom: 1px solid #E2E5EB; }
  td.right { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; border-bottom: none; }
  .note { font-size: 11px; color: #5A6472; margin-top: 24px; line-height: 1.5; }
  .hero { font-size: 30px; font-weight: 700; }
</style></head>
<body>
  <h1>${BRAND.APP_NAME} — personal pay estimate</h1>
  <div>${escapeHtml(job?.name ?? '')} · ${escapeHtml(job?.jurisdiction ?? '')}</div>
  <div>${escapeHtml(calculation.period.start)} → ${escapeHtml(calculation.period.end)} · payday ${escapeHtml(calculation.period.payday)}</div>
  <h2>Estimated take-home</h2>
  <div class="hero">${money(calculation.deductions.net)}</div>
  <h2>How your pay adds up</h2>
  <table>${rows(calculation.gross.lines.map((line) => ({ label: line.label, amount: money(line.amount) })))}
    <tr class="total"><td>Gross</td><td class="right">${money(calculation.gross.gross)}</td></tr>
  </table>
  <h2>Estimated deductions</h2>
  <table>${rows(calculation.deductions.lines.map((line) => ({ label: line.label, amount: money(line.amount) })))}
    <tr class="total"><td>Estimated take-home</td><td class="right">${money(calculation.deductions.net)}</td></tr>
  </table>
  <h2>Rules used</h2>
  <table>
    <tr><td>Work week starts</td><td class="right">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][calculation.explanation.workWeekStart]}</td></tr>
    <tr><td>Overtime rule</td><td class="right">${escapeHtml(calculation.explanation.overtimeRuleLabel)}</td></tr>
    <tr><td>Payroll parameters</td><td class="right">${escapeHtml(calculation.explanation.payrollRuleVersion)} (${calculation.explanation.payrollRuleYear})</td></tr>
    <tr><td>Estimate confidence</td><td class="right">${escapeHtml(calculation.confidence.level)}</td></tr>
  </table>
  <p class="note">${escapeHtml(BRAND.DISCLAIMER_TEXT.replace(/\{app\}/g, BRAND.APP_NAME))}<br/>
  This document is a personal estimate generated on your device. It is not a payslip, not a payroll record and not tax advice.</p>
</body></html>`;
}

export async function exportPeriodPdf(state: StoreSlice, jobId: string, periodStart?: string): Promise<ExportResult> {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return { status: 'failed', reason: 'No job selected.' };
  const period = periodStart ? payPeriodFor(periodStart, job.paySchedule) : payPeriodFor(state.today, job.paySchedule);
  const calculation = calculateForJob(state, jobId, period.start);
  if (!calculation) return { status: 'failed', reason: 'Nothing to report for that period yet.' };
  try {
    const { uri } = await Print.printToFileAsync({ html: reportHtml(state, jobId, period, calculation) });
    if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share pay report' });
    }
    return { status: 'exported', fileName: `${BRAND.SHORT_NAME.toLowerCase()}-report-${period.start}.pdf`, uri };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
