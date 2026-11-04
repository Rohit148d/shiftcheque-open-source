/**
 * incomeTaxEngine — annualised bracket tax with credits, used for both federal
 * and provincial/territorial tax (and, through the Quebec layer, for Revenu
 * Québec source deductions).
 *
 * Structure (equivalent to CRA's T4127 "Option 1" claim-amount method):
 *   annual taxable income
 *   -> bracket tax (progressive)
 *   -> minus credit rate x (basic personal amount + employment amount
 *      + CPP/QPP + CPP2/QPP2 + EI/QPIP contributions)
 *   -> divide by pay periods
 *
 * Quebec uses a deduction for the basic personal amount plus credits at the
 * Quebec credit rate, which matches Revenu Québec's source-deduction structure
 * (see RULE_SOURCES.md for the exact documents used).
 */
import { divRoundHalfUp, roundToCents, type Micro } from '../money.ts';
import type { JurisdictionTax, PayrollRulePack, TaxBracket } from '../../rules/types.ts';

export type TaxResult = {
  amount: Micro;
  annualBeforeCredits: Micro;
  credits: Micro;
  annualAfterCredits: Micro;
  detail: string;
  /** Effective marginal rate label for the explanation sheet. */
  marginalRate: number;
};

export function sortBrackets(brackets: TaxBracket[]): TaxBracket[] {
  return [...brackets].sort((a, b) => {
    if (a.upTo === null) return 1;
    if (b.upTo === null) return -1;
    return a.upTo - b.upTo;
  });
}

/** Progressive tax on an annual amount. */
export function bracketTax(annualIncome: Micro, brackets: TaxBracket[]): Micro {
  if (annualIncome <= 0n) return 0n;
  const sorted = sortBrackets(brackets);
  let remaining = annualIncome;
  let lastCeiling = 0n;
  let tax = 0n;
  for (const bracket of sorted) {
    const ceiling = bracket.upTo === null ? null : BigInt(Math.round(bracket.upTo * 100)) * 10_000n;
    const span = ceiling === null ? remaining : min(remaining, max(0n, ceiling - lastCeiling));
    if (span > 0n) {
      tax += mulRate(span, bracket.rate);
      remaining -= span;
    }
    if (ceiling !== null) lastCeiling = ceiling;
    if (remaining <= 0n) break;
  }
  return roundToCents(tax);
}

export function marginalRate(annualIncome: Micro, brackets: TaxBracket[]): number {
  const sorted = sortBrackets(brackets);
  let lastCeiling = 0n;
  let rate = sorted[0]?.rate ?? 0;
  for (const bracket of sorted) {
    const ceiling = bracket.upTo === null ? null : BigInt(Math.round(bracket.upTo * 100)) * 10_000n;
    const upper = ceiling ?? annualIncome;
    if (annualIncome > lastCeiling || ceiling === null) rate = bracket.rate;
    if (annualIncome <= upper && ceiling !== null) break;
    if (ceiling !== null) lastCeiling = ceiling;
  }
  return rate;
}

function mulRate(value: Micro, rate: number): Micro {
  const scaled = BigInt(Math.round(rate * 1_000_000));
  return divRoundHalfUp(value * scaled, 1_000_000n);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function cents(dollars: number): Micro {
  return BigInt(Math.round(dollars * 100)) * 10_000n;
}

export type AnnualTaxInput = {
  /** Taxable income for the period (gross, less any non-taxable items). */
  periodTaxableIncome: Micro;
  periodsPerYear: number;
  jurisdictionTax: JurisdictionTax;
  /** Annual CPP/QPP (tier 1) contributions used for the credit. */
  annualPensionContribution: Micro;
  /** Annual CPP2/QPP2 contributions used for the credit. */
  annualSecondTierContribution: Micro;
  /** Annual EI/QPIP premiums used for the credit. */
  annualInsurancePremium: Micro;
  /** Extra annual credit (custom claim amounts from TD1). */
  extraAnnualCredit?: Micro;
  /** Quebec path: the basic personal amount is a deduction, not a credit. */
  personalAmountAsDeduction?: boolean;
  /** Quebec path: contributions reduce tax at the credit rate. */
  contributionsAreCredits?: boolean;
  includeEmploymentAmount?: boolean;
  label: string;
};

export function computeAnnualTax(input: AnnualTaxInput): TaxResult {
  const periods = BigInt(Math.max(1, input.periodsPerYear));
  const annualIncome = input.periodTaxableIncome * periods;
  const personalAmount = cents(input.jurisdictionTax.basicPersonalAmount);
  const creditRate = input.jurisdictionTax.creditRate;

  let taxableBase = annualIncome;
  if (input.personalAmountAsDeduction) {
    taxableBase = max(0n, annualIncome - personalAmount);
  }

  const beforeCredits = bracketTax(taxableBase, input.jurisdictionTax.brackets);

  const creditParts: Micro[] = [];
  if (!input.personalAmountAsDeduction) creditParts.push(personalAmount);
  if (input.includeEmploymentAmount !== false && input.jurisdictionTax.employmentAmount) {
    creditParts.push(cents(input.jurisdictionTax.employmentAmount));
  }
  if (input.contributionsAreCredits !== false) {
    creditParts.push(input.annualPensionContribution, input.annualSecondTierContribution, input.annualInsurancePremium);
  }
  if (input.extraAnnualCredit) creditParts.push(input.extraAnnualCredit);

  const creditBase = creditParts.reduce<bigint>((sum, part) => sum + part, 0n);
  const credits = mulRate(creditBase, creditRate);
  let afterCredits = max(0n, beforeCredits - credits);

  // Surtax (Ontario, Prince Edward Island)
  const surtax = input.jurisdictionTax.surtax;
  if (surtax) {
    const t1 = cents(surtax.threshold1);
    if (afterCredits > t1) {
      afterCredits += mulRate(afterCredits - t1, surtax.rate1);
    }
    if (surtax.threshold2 !== null && surtax.threshold2 !== undefined && surtax.rate2) {
      const t2 = cents(surtax.threshold2);
      if (afterCredits > t2) {
        afterCredits += mulRate(afterCredits - t2, surtax.rate2);
      }
    }
  }

  const annualAfterCredits = roundToCents(afterCredits);
  const periodAmount = roundToCents(divRoundHalfUp(annualAfterCredits, periods));

  return {
    amount: periodAmount,
    annualBeforeCredits: beforeCredits,
    credits,
    annualAfterCredits,
    marginalRate: marginalRate(taxableBase, input.jurisdictionTax.brackets),
    detail: `${input.label}: $${(annualIncome / 1_000_000n).toString()} annualised income, bracket tax of ${formatMoneyMicro(
      beforeCredits,
    )} less ${formatMoneyMicro(credits)} of credits.`,
  };
}

export type PayrollTaxInput = {
  pack: PayrollRulePack;
  /** Tax province of residence (Quebec residents use the Quebec path). */
  taxProvince: Exclude<keyof PayrollRulePack['provinces'], never> | string;
  periodTaxableIncome: Micro;
  periodsPerYear: number;
  annualCpp: Micro;
  annualCpp2: Micro;
  annualEi: Micro;
  annualQpp: Micro;
  annualQpp2: Micro;
  annualQpip: Micro;
  extraCreditFederal?: Micro;
  extraCreditProvincial?: Micro;
  /** When true, nothing is withheld federally (Quebec source deductions). */
  suppressFederalTax?: boolean;
};

export type PayrollTaxResult = {
  federal: TaxResult | null;
  provincial: TaxResult | null;
  quebec: TaxResult | null;
}

export function computePayrollTax(input: PayrollTaxInput): PayrollTaxResult {
  const { pack } = input;
  const isQuebec = input.taxProvince === 'QC';

  if (isQuebec) {
    if (!pack.quebec) {
      return { federal: null, provincial: null, quebec: null };
    }
    const quebec = computeAnnualTax({
      periodTaxableIncome: input.periodTaxableIncome,
      periodsPerYear: input.periodsPerYear,
      jurisdictionTax: {
        brackets: pack.quebec.brackets,
        basicPersonalAmount: pack.quebec.basicPersonalAmount,
        creditRate: pack.quebec.creditRate,
        employmentAmount: pack.quebec.employmentAmount,
      },
      annualPensionContribution: input.annualQpp,
      annualSecondTierContribution: input.annualQpp2,
      annualInsurancePremium: input.annualQpip,
      extraAnnualCredit: input.extraCreditProvincial,
      personalAmountAsDeduction: true,
      contributionsAreCredits: true,
      includeEmploymentAmount: true,
      label: 'Quebec income tax',
    });
    return { federal: null, provincial: null, quebec };
  }

  const federal = computeAnnualTax({
    periodTaxableIncome: input.periodTaxableIncome,
    periodsPerYear: input.periodsPerYear,
    jurisdictionTax: {
      brackets: pack.federal.brackets,
      basicPersonalAmount: pack.federal.basicPersonalAmount,
      creditRate: pack.federal.creditRate,
      employmentAmount: pack.federal.canadaEmploymentAmount,
    },
    annualPensionContribution: input.annualCpp,
    annualSecondTierContribution: input.annualCpp2,
    annualInsurancePremium: input.annualEi,
    extraAnnualCredit: input.extraCreditFederal,
    includeEmploymentAmount: true,
    label: 'Federal tax',
  });

  const provinceTax = pack.provinces[input.taxProvince as keyof PayrollRulePack['provinces']];
  const provincial = provinceTax
    ? computeAnnualTax({
        periodTaxableIncome: input.periodTaxableIncome,
        periodsPerYear: input.periodsPerYear,
        jurisdictionTax: provinceTax,
        annualPensionContribution: input.annualCpp,
        annualSecondTierContribution: input.annualCpp2,
        annualInsurancePremium: input.annualEi,
        extraAnnualCredit: input.extraCreditProvincial,
        includeEmploymentAmount: true,
        label: `${input.taxProvince} tax`,
      })
    : null;

  return {
    federal: input.suppressFederalTax ? null : federal,
    provincial,
    quebec: null,
  };
}

function formatMoneyMicro(value: Micro): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const centsPart = (abs % 1_000_000n) / 10_000n;
  return `${negative ? '-' : ''}$${whole.toLocaleString('en-CA')}.${centsPart.toString().padStart(2, '0')}`;
}
