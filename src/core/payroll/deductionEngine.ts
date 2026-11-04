/**
 * deductionEngine — turns gross pay into estimated statutory deductions and
 * take-home pay, choosing the Quebec path for Quebec residents and the
 * CRA path for everyone else (spec 40/41).
 *
 * Every line carries an explanation string; nothing here is a black box.
 */
import { mulRatio, percentOf, roundToCents, type Micro } from '../money.ts';
import type { DeductionLine, DeductionProfile, Job } from '../types.ts';
import type { PayrollRulePack } from '../../rules/types.ts';
import {
  computeCpp,
  computeCpp2,
  computeEi,
  computeQpp,
  computeQpp2,
  computeQpip,
  secondTierEarnings,
  type ContributionResult,
} from './contributions.ts';
import { computePayrollTax } from './tax.ts';

export type DeductionEngineResult = {
  lines: DeductionLine[];
  gross: Micro;
  totalDeductions: Micro;
  net: Micro;
  taxableIncome: Micro;
  annualTaxableIncome: Micro;
  annual: {
    cpp: Micro;
    cpp2: Micro;
    ei: Micro;
    qpp: Micro;
    qpp2: Micro;
    qpip: Micro;
    federalTax: Micro;
    provincialTax: Micro;
    quebecTax: Micro;
  };
  contributions: {
    cpp?: ContributionResult;
    cpp2?: ContributionResult;
    ei?: ContributionResult;
    qpp?: ContributionResult;
    qpp2?: ContributionResult;
    qpip?: ContributionResult;
  };
  /** Human-readable assumptions, surfaced in the "How did you calculate this?" sheet. */
  assumptions: string[];
  quebecPath: boolean;
};

export type DeductionEngineInput = {
  gross: Micro;
  payDate: string;
  job: Job;
  profile: DeductionProfile;
  pack: PayrollRulePack;
  periodsPerYear: number;
};

export function computeDeductions(input: DeductionEngineInput): DeductionEngineResult {
  const { gross, job, profile, pack, periodsPerYear } = input;
  const quebecPath = job.taxProvince === 'QC';
  const assumptions: string[] = [];
  const lines: DeductionLine[] = [];

  const periods = Math.max(1, periodsPerYear);
  const ytd = profile.ytd;

  // --- Statutory contributions -------------------------------------------
  let pensionResult: ContributionResult | undefined;
  let pension2Result: ContributionResult | undefined;
  let insuranceResult: ContributionResult | undefined;

  if (quebecPath) {
    if (profile.cppExempt) {
      assumptions.push('QPP is turned off for this job in your settings.');
    } else if (pack.quebec) {
      pensionResult = computeQpp({
        periodEarnings: gross,
        rule: pack.quebec.qpp,
        periodsPerYear: periods,
        ytd: ytd?.qpp ?? 0n,
      });
      const tier2 = secondTierEarnings(gross, pack.quebec.qpp.maximumEarnings, pack.quebec.qpp2.maximumEarnings, periods);
      pension2Result = computeQpp2({
        periodEarnings: tier2,
        rule: pack.quebec.qpp2,
        periodsPerYear: periods,
        ytd: ytd?.qpp2 ?? 0n,
      });
      if (profile.eiExempt) {
        assumptions.push('QPIP is turned off for this job in your settings.');
      } else {
        insuranceResult = computeQpip({
          periodEarnings: gross,
          rule: pack.quebec.qpip,
          periodsPerYear: periods,
          ytd: ytd?.qpip ?? 0n,
        });
      }
    }
  } else {
    if (profile.cppExempt) {
      assumptions.push('CPP is turned off for this job in your settings.');
    } else {
      pensionResult = computeCpp({
        periodEarnings: gross,
        rule: pack.federal.cpp,
        periodsPerYear: periods,
        ytd: ytd?.cpp ?? 0n,
      });
      const tier2 = secondTierEarnings(gross, pack.federal.cpp.maximumEarnings, pack.federal.cpp2.maximumEarnings, periods);
      pension2Result = computeCpp2({
        periodEarnings: tier2,
        rule: pack.federal.cpp2,
        periodsPerYear: periods,
        ytd: ytd?.cpp2 ?? 0n,
      });
    }
    if (profile.eiExempt) {
      assumptions.push('EI is turned off for this job in your settings.');
    } else {
      const eiRule = pack.federal.ei;
      insuranceResult = computeEi({
        periodEarnings: gross,
        rule: eiRule,
        periodsPerYear: periods,
        ytd: ytd?.ei ?? 0n,
      });
    }
  }

  // --- EI is always federal, even in Quebec (reduced Quebec rate) ---------
  let eiResult: ContributionResult | undefined;
  if (quebecPath) {
    if (!profile.eiExempt) {
      eiResult = computeEi({
        periodEarnings: gross,
        rule: pack.federal.eiQuebec,
        periodsPerYear: periods,
        ytd: ytd?.ei ?? 0n,
      });
    }
  } else {
    eiResult = insuranceResult;
  }

  const pushContribution = (code: DeductionLine['code'], label: string, result?: ContributionResult) => {
    if (!result) return;
    if (result.amount === 0n && result.capped) {
      lines.push({
        code,
        label,
        amount: 0n,
        detail: result.detail,
        capped: true,
        annualMaximum: result.annualMaximum,
        ytdToDate: result.ytdAfter,
      });
      return;
    }
    lines.push({
      code,
      label,
      amount: -result.amount,
      detail: result.detail,
      capped: result.capped,
      annualMaximum: result.annualMaximum,
      ytdToDate: result.ytdAfter,
    });
  };

  if (pensionResult) pushContribution(quebecPath ? 'QPP' : 'CPP', quebecPath ? 'QPP' : 'CPP', pensionResult);
  if (pension2Result) pushContribution(quebecPath ? 'QPP2' : 'CPP2', quebecPath ? 'QPP2' : 'CPP2', pension2Result);
  if (eiResult) pushContribution('EI', 'EI', eiResult);
  if (quebecPath && insuranceResult) pushContribution('QPIP', 'QPIP', insuranceResult);

  const annualCpp = pensionResult?.annualAmount ?? 0n;
  const annualCpp2 = pension2Result?.annualAmount ?? 0n;
  const annualEi = eiResult?.annualAmount ?? 0n;
  const annualQpp = quebecPath ? annualCpp : 0n;
  const annualQpp2 = quebecPath ? annualCpp2 : 0n;
  const annualQpip = quebecPath ? insuranceResult?.annualAmount ?? 0n : 0n;

  // --- Income tax ---------------------------------------------------------
  const taxableIncome = gross;
  const extraFederalCredit = profile.federalClaimCode === 'custom' ? profile.federalClaimAmount ?? 0n : 0n;
  const extraProvincialCredit =
    profile.provincialClaimCode === 'custom' ? profile.provincialClaimAmount ?? 0n : 0n;

  const tax = computePayrollTax({
    pack,
    taxProvince: job.taxProvince,
    periodTaxableIncome: taxableIncome,
    periodsPerYear: periods,
    annualCpp: quebecPath ? 0n : annualCpp,
    annualCpp2: quebecPath ? 0n : annualCpp2,
    annualEi: quebecPath ? 0n : annualEi,
    annualQpp,
    annualQpp2,
    annualQpip,
    extraCreditFederal: extraFederalCredit,
    extraCreditProvincial: extraProvincialCredit,
  });

  if (tax.federal) {
    lines.push({ code: 'FED_TAX', label: 'Federal tax', amount: -tax.federal.amount, detail: tax.federal.detail });
  }
  if (tax.provincial) {
    lines.push({
      code: 'PROV_TAX',
      label: `${job.taxProvince} tax`,
      amount: -tax.provincial.amount,
      detail: tax.provincial.detail,
    });
  }
  if (tax.quebec) {
    lines.push({ code: 'PROV_TAX', label: 'Quebec income tax', amount: -tax.quebec.amount, detail: tax.quebec.detail });
    assumptions.push('Quebec residents have Quebec income tax withheld at source (no separate federal withholding).');
  }

  if (!profile.ytd) {
    assumptions.push('Year-to-date amounts were not provided, so annual maximums are estimated by projecting this pay period across the year.');
  }
  if (profile.federalClaimCode === 'default' && !quebecPath) {
    assumptions.push('Using the basic federal claim amount (no TD1 adjustments).');
  }

  // --- Additional tax ----------------------------------------------------
  if (profile.additionalTaxPerPeriod && profile.additionalTaxPerPeriod > 0n) {
    lines.push({
      code: 'OTHER',
      label: 'Additional tax you requested',
      amount: -profile.additionalTaxPerPeriod,
      detail: 'Extra withholding you configured.',
    });
  }
  if (profile.additionalTaxPercent && profile.additionalTaxPercent > 0) {
    const extra = percentOf(taxableIncome, profile.additionalTaxPercent);
    lines.push({
      code: 'OTHER',
      label: 'Additional tax (percentage)',
      amount: -extra,
      detail: `${profile.additionalTaxPercent}% of taxable pay.`,
    });
  }

  // --- Other deductions ---------------------------------------------------
  for (const deduction of profile.fixedDeductions) {
    const amount = deduction.perPeriod ? deduction.amount : mulRatio(deduction.amount, 12, periods);
    lines.push({ code: 'OTHER', label: deduction.label, amount: -amount, detail: 'Fixed deduction you configured.' });
  }
  for (const deduction of profile.percentDeductions) {
    const amount = percentOf(taxableIncome, deduction.percent);
    lines.push({
      code: 'OTHER',
      label: deduction.label,
      amount: -amount,
      detail: `${deduction.percent}% of taxable pay.`,
    });
  }

  const totalDeductions = lines.reduce<Micro>((sum, line) => sum + line.amount, 0n) * -1n;
  const net = roundToCents(gross - totalDeductions);

  return {
    lines,
    gross,
    totalDeductions: roundToCents(totalDeductions),
    net,
    taxableIncome,
    annualTaxableIncome: taxableIncome * BigInt(periods),
    annual: {
      cpp: annualCpp,
      cpp2: annualCpp2,
      ei: annualEi,
      qpp: annualQpp,
      qpp2: annualQpp2,
      qpip: annualQpip,
      federalTax: tax.federal?.annualAfterCredits ?? 0n,
      provincialTax: tax.provincial?.annualAfterCredits ?? 0n,
      quebecTax: tax.quebec?.annualAfterCredits ?? 0n,
    },
    contributions: {
      cpp: quebecPath ? undefined : pensionResult,
      cpp2: quebecPath ? undefined : pension2Result,
      ei: eiResult,
      qpp: quebecPath ? pensionResult : undefined,
      qpp2: quebecPath ? pension2Result : undefined,
      qpip: quebecPath ? insuranceResult : undefined,
    },
    assumptions,
    quebecPath,
  };
}
