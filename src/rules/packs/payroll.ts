/**
 * Payroll deduction rule packs (CRA + Revenu Québec) — VERIFIED.
 *
 * Every value below was checked against the official sources listed in
 * `sourceIds` on 2026-10-05:
 *   - CRA T4127 Payroll Deductions Formulas, 122nd edition (January 2026) and
 *     123rd edition (July 2026), plus the 2025 annual tables 8.22–8.29
 *   - CRA indexation tables, CPP and EI rate pages
 *   - Revenu Québec employer's kit / principal changes for 2025 and 2026,
 *     TP-1015.F-V and TP-1015.TI-V (deduction codes)
 *   - Retraite Québec (QPP) and RQAP (QPIP) rates and maximums
 *
 * Effective dating is real, not decorative: the federal lowest rate changed on
 * 2025-07-01, so tax year 2025 is stored as two packs and a pay period from
 * June 2025 is calculated with the 15% rate while a December 2025 period uses
 * 14%. Any future formula change is added the same way.
 *
 * Known limitations (documented in docs/PAYROLL_VALIDATION.md):
 *   - The federal basic personal amount phases out above $181,440 of income;
 *     a flat amount is used, which slightly overstates the credit for very high
 *     incomes (outside the target user base).
 *   - Mid-year 2026 provincial adjustments (BC lowest rate 5.60%, NL BPA
 *     13,094, PE 20% bracket) are applied as annual values rather than prorated
 *     Jul–Dec values.
 */
import type { PayrollRulePack } from '../types.ts';

const VERIFIED_AT = '2026-10-05';
const SOURCES = ['cra-cpp-rates', 'cra-ei-rates', 'cra-t4127', 'cra-pdoc', 'cra-indexation'];
const QC_SOURCES = ['revenue-quebec-employer-guide', 'revenue-quebec-webrap', 'retraite-quebec-rates', 'rqap-rates'];

type Contribution = { rate: number; exemption: number; maximumEarnings: number; maximumContribution: number };
type Bracket = { upTo: number | null; rate: number };
type ProvinceTaxSeed = {
  brackets: Bracket[];
  bpa: number;
  creditAtLowestRate: number;
  surtax?: { threshold1: number; rate1: number; threshold2: number | null; rate2: number | null } | null;
};

const PROVINCES_2025: Record<string, ProvinceTaxSeed> = {
  AB: {
    brackets: [
      { upTo: 60_000, rate: 0.08 },
      { upTo: 151_234, rate: 0.1 },
      { upTo: 181_481, rate: 0.12 },
      { upTo: 241_974, rate: 0.13 },
      { upTo: 362_961, rate: 0.14 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: 22_323,
    creditAtLowestRate: 1_785.84,
  },
  BC: {
    brackets: [
      { upTo: 49_279, rate: 0.0506 },
      { upTo: 98_560, rate: 0.077 },
      { upTo: 113_158, rate: 0.105 },
      { upTo: 137_407, rate: 0.1229 },
      { upTo: 186_306, rate: 0.147 },
      { upTo: 259_829, rate: 0.168 },
      { upTo: null, rate: 0.205 },
    ],
    bpa: 12_932,
    creditAtLowestRate: 654.36,
  },
  MB: {
    brackets: [
      { upTo: 47_000, rate: 0.108 },
      { upTo: 100_000, rate: 0.1275 },
      { upTo: null, rate: 0.174 },
    ],
    bpa: 15_780,
    creditAtLowestRate: 1_704.24,
  },
  NB: {
    brackets: [
      { upTo: 51_306, rate: 0.094 },
      { upTo: 102_614, rate: 0.14 },
      { upTo: 190_060, rate: 0.16 },
      { upTo: null, rate: 0.195 },
    ],
    bpa: 13_396,
    creditAtLowestRate: 1_259.22,
  },
  NL: {
    brackets: [
      { upTo: 44_192, rate: 0.087 },
      { upTo: 88_382, rate: 0.145 },
      { upTo: 157_792, rate: 0.158 },
      { upTo: 220_910, rate: 0.178 },
      { upTo: 282_214, rate: 0.198 },
      { upTo: 564_429, rate: 0.208 },
      { upTo: 1_128_858, rate: 0.213 },
      { upTo: null, rate: 0.218 },
    ],
    bpa: 11_067,
    creditAtLowestRate: 962.83,
  },
  NS: {
    brackets: [
      { upTo: 30_507, rate: 0.0879 },
      { upTo: 61_015, rate: 0.1495 },
      { upTo: 95_883, rate: 0.1667 },
      { upTo: 154_650, rate: 0.175 },
      { upTo: null, rate: 0.21 },
    ],
    bpa: 11_744,
    creditAtLowestRate: 1_032.3,
  },
  NT: {
    brackets: [
      { upTo: 51_964, rate: 0.059 },
      { upTo: 103_930, rate: 0.086 },
      { upTo: 168_967, rate: 0.122 },
      { upTo: null, rate: 0.1405 },
    ],
    bpa: 17_842,
    creditAtLowestRate: 1_052.68,
  },
  NU: {
    brackets: [
      { upTo: 54_707, rate: 0.04 },
      { upTo: 109_413, rate: 0.07 },
      { upTo: 177_881, rate: 0.09 },
      { upTo: null, rate: 0.115 },
    ],
    bpa: 19_274,
    creditAtLowestRate: 770.96,
  },
  ON: {
    brackets: [
      { upTo: 52_886, rate: 0.0505 },
      { upTo: 105_775, rate: 0.0915 },
      { upTo: 150_000, rate: 0.1116 },
      { upTo: 220_000, rate: 0.1216 },
      { upTo: null, rate: 0.1316 },
    ],
    bpa: 12_747,
    creditAtLowestRate: 643.72,
    surtax: { threshold1: 5_818, rate1: 0.2, threshold2: 7_446, rate2: 0.36 },
  },
  PE: {
    brackets: [
      { upTo: 33_328, rate: 0.095 },
      { upTo: 64_656, rate: 0.1347 },
      { upTo: 105_000, rate: 0.166 },
      { upTo: 140_000, rate: 0.1762 },
      { upTo: null, rate: 0.19 },
    ],
    bpa: 14_650,
    creditAtLowestRate: 1_391.75,
  },
  SK: {
    brackets: [
      { upTo: 53_463, rate: 0.105 },
      { upTo: 152_750, rate: 0.125 },
      { upTo: null, rate: 0.145 },
    ],
    bpa: 19_491,
    creditAtLowestRate: 2_046.56,
  },
  YT: {
    brackets: [
      { upTo: 57_375, rate: 0.064 },
      { upTo: 114_750, rate: 0.09 },
      { upTo: 177_882, rate: 0.109 },
      { upTo: 500_000, rate: 0.128 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: 16_129,
    creditAtLowestRate: 1_032.26,
  },
};

const PROVINCES_2026: Record<string, ProvinceTaxSeed> = {
  AB: {
    brackets: [
      { upTo: 61_200, rate: 0.08 },
      { upTo: 154_259, rate: 0.1 },
      { upTo: 185_111, rate: 0.12 },
      { upTo: 246_813, rate: 0.13 },
      { upTo: 370_220, rate: 0.14 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: 22_769,
    creditAtLowestRate: 1_821.52,
  },
  BC: {
    brackets: [
      { upTo: 50_363, rate: 0.056 },
      { upTo: 100_728, rate: 0.077 },
      { upTo: 115_648, rate: 0.105 },
      { upTo: 140_430, rate: 0.1229 },
      { upTo: 190_405, rate: 0.147 },
      { upTo: 265_545, rate: 0.168 },
      { upTo: null, rate: 0.205 },
    ],
    bpa: 13_216,
    creditAtLowestRate: 740.1,
  },
  MB: {
    brackets: [
      { upTo: 47_000, rate: 0.108 },
      { upTo: 100_000, rate: 0.1275 },
      { upTo: null, rate: 0.174 },
    ],
    bpa: 15_780,
    creditAtLowestRate: 1_704.24,
  },
  NB: {
    brackets: [
      { upTo: 52_333, rate: 0.094 },
      { upTo: 104_666, rate: 0.14 },
      { upTo: 193_861, rate: 0.16 },
      { upTo: null, rate: 0.195 },
    ],
    bpa: 13_664,
    creditAtLowestRate: 1_284.42,
  },
  NL: {
    brackets: [
      { upTo: 44_678, rate: 0.087 },
      { upTo: 89_354, rate: 0.145 },
      { upTo: 159_528, rate: 0.158 },
      { upTo: 223_340, rate: 0.178 },
      { upTo: 285_319, rate: 0.198 },
      { upTo: 570_638, rate: 0.208 },
      { upTo: 1_141_275, rate: 0.213 },
      { upTo: null, rate: 0.218 },
    ],
    bpa: 13_094,
    creditAtLowestRate: 1_139.18,
  },
  NS: {
    brackets: [
      { upTo: 30_995, rate: 0.0879 },
      { upTo: 61_991, rate: 0.1495 },
      { upTo: 97_417, rate: 0.1667 },
      { upTo: 157_124, rate: 0.175 },
      { upTo: null, rate: 0.21 },
    ],
    bpa: 11_932,
    creditAtLowestRate: 1_048.82,
  },
  NT: {
    brackets: [
      { upTo: 53_003, rate: 0.059 },
      { upTo: 106_009, rate: 0.086 },
      { upTo: 172_346, rate: 0.122 },
      { upTo: null, rate: 0.1405 },
    ],
    bpa: 18_198,
    creditAtLowestRate: 1_073.68,
  },
  NU: {
    brackets: [
      { upTo: 55_801, rate: 0.04 },
      { upTo: 111_602, rate: 0.07 },
      { upTo: 181_439, rate: 0.09 },
      { upTo: null, rate: 0.115 },
    ],
    bpa: 19_659,
    creditAtLowestRate: 786.36,
  },
  ON: {
    brackets: [
      { upTo: 53_891, rate: 0.0505 },
      { upTo: 107_785, rate: 0.0915 },
      { upTo: 150_000, rate: 0.1116 },
      { upTo: 220_000, rate: 0.1216 },
      { upTo: null, rate: 0.1316 },
    ],
    bpa: 12_989,
    creditAtLowestRate: 655.94,
    surtax: { threshold1: 5_818, rate1: 0.2, threshold2: 7_446, rate2: 0.36 },
  },
  PE: {
    brackets: [
      { upTo: 33_928, rate: 0.095 },
      { upTo: 65_820, rate: 0.1347 },
      { upTo: 106_890, rate: 0.166 },
      { upTo: 142_520, rate: 0.1762 },
      { upTo: 200_000, rate: 0.19 },
      { upTo: null, rate: 0.2 },
    ],
    bpa: 15_000,
    creditAtLowestRate: 1_425,
  },
  SK: {
    brackets: [
      { upTo: 54_532, rate: 0.105 },
      { upTo: 155_805, rate: 0.125 },
      { upTo: null, rate: 0.145 },
    ],
    bpa: 20_381,
    creditAtLowestRate: 2_140.01,
  },
  YT: {
    brackets: [
      { upTo: 58_523, rate: 0.064 },
      { upTo: 117_045, rate: 0.09 },
      { upTo: 181_440, rate: 0.109 },
      { upTo: 500_000, rate: 0.128 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: 16_452,
    creditAtLowestRate: 1_052.93,
  },
};

const CPP_2025: Contribution = { rate: 0.0595, exemption: 3_500, maximumEarnings: 71_300, maximumContribution: 4_034.1 };
const CPP2_2025: Contribution = { rate: 0.04, exemption: 0, maximumEarnings: 81_200, maximumContribution: 396 };
const EI_2025: Contribution = { rate: 0.0164, exemption: 0, maximumEarnings: 65_700, maximumContribution: 1_077.48 };
const EI_QC_2025: Contribution = { rate: 0.0131, exemption: 0, maximumEarnings: 65_700, maximumContribution: 860.67 };

const CPP_2026: Contribution = { rate: 0.0595, exemption: 3_500, maximumEarnings: 74_600, maximumContribution: 4_230.45 };
const CPP2_2026: Contribution = { rate: 0.04, exemption: 0, maximumEarnings: 85_000, maximumContribution: 416 };
const EI_2026: Contribution = { rate: 0.0163, exemption: 0, maximumEarnings: 68_900, maximumContribution: 1_123.07 };
const EI_QC_2026: Contribution = { rate: 0.013, exemption: 0, maximumEarnings: 68_900, maximumContribution: 895.7 };

function federal(
  brackets: Bracket[],
  creditRate: number,
  basicPersonalAmount: number,
  canadaEmploymentAmount: number,
  cpp: Contribution,
  cpp2: Contribution,
  ei: Contribution,
  eiQuebec: Contribution,
) {
  return { brackets, creditRate, basicPersonalAmount, canadaEmploymentAmount, pensionIncomeAmount: 2_000, cpp, cpp2, ei, eiQuebec };
}

function provinceRecord(seed: Record<string, ProvinceTaxSeed>) {
  const record: PayrollRulePack['provinces'] = {};
  for (const [code, values] of Object.entries(seed)) {
    record[code] = {
      brackets: values.brackets,
      basicPersonalAmount: values.bpa,
      creditRate: values.brackets[0].rate,
      employmentAmount: 0,
      surtax: values.surtax ?? null,
    };
  }
  return record;
}

export const PAYROLL_PACKS: PayrollRulePack[] = [
  {
    taxYear: 2025,
    version: '2025.1',
    effectiveFrom: '2025-01-01',
    effectiveTo: '2025-06-30',
    status: 'verified',
    sourceIds: [...SOURCES, ...QC_SOURCES],
    lastVerifiedAt: VERIFIED_AT,
    federal: federal(
      [
        { upTo: 57_375, rate: 0.15 },
        { upTo: 114_750, rate: 0.205 },
        { upTo: 177_882, rate: 0.26 },
        { upTo: 253_414, rate: 0.29 },
        { upTo: null, rate: 0.33 },
      ],
      0.15,
      16_129,
      1_471,
      CPP_2025,
      CPP2_2025,
      EI_2025,
      EI_QC_2025,
    ),
    quebec: {
      brackets: [
        { upTo: 53_255, rate: 0.14 },
        { upTo: 106_495, rate: 0.19 },
        { upTo: 129_590, rate: 0.24 },
        { upTo: null, rate: 0.2575 },
      ],
      basicPersonalAmount: 18_571,
      creditRate: 0.14,
      employmentAmount: 0,
      qpp: { rate: 0.064, exemption: 3_500, maximumEarnings: 71_300, maximumContribution: 4_339.2 },
      qpp2: { rate: 0.04, exemption: 0, maximumEarnings: 81_200, maximumContribution: 396 },
      qpip: { rate: 0.00494, exemption: 0, maximumEarnings: 98_000, maximumContribution: 484.12 },
    },
    provinces: provinceRecord(PROVINCES_2025),
    notes:
      'January–June 2025. The federal lowest rate was 15% until 2025-06-30 (T4127 tables 8.22–8.29); the rate changed to 14% for the rest of the year and is stored as pack 2025.2.',
  },
  {
    taxYear: 2025,
    version: '2025.2',
    effectiveFrom: '2025-07-01',
    effectiveTo: '2025-12-31',
    status: 'verified',
    sourceIds: [...SOURCES, ...QC_SOURCES],
    lastVerifiedAt: VERIFIED_AT,
    federal: federal(
      [
        { upTo: 57_375, rate: 0.14 },
        { upTo: 114_750, rate: 0.205 },
        { upTo: 177_882, rate: 0.26 },
        { upTo: 253_414, rate: 0.29 },
        { upTo: null, rate: 0.33 },
      ],
      0.14,
      16_129,
      1_471,
      CPP_2025,
      CPP2_2025,
      EI_2025,
      EI_QC_2025,
    ),
    quebec: {
      brackets: [
        { upTo: 53_255, rate: 0.14 },
        { upTo: 106_495, rate: 0.19 },
        { upTo: 129_590, rate: 0.24 },
        { upTo: null, rate: 0.2575 },
      ],
      basicPersonalAmount: 18_571,
      creditRate: 0.14,
      employmentAmount: 0,
      qpp: { rate: 0.064, exemption: 3_500, maximumEarnings: 71_300, maximumContribution: 4_339.2 },
      qpp2: { rate: 0.04, exemption: 0, maximumEarnings: 81_200, maximumContribution: 396 },
      qpip: { rate: 0.00494, exemption: 0, maximumEarnings: 98_000, maximumContribution: 484.12 },
    },
    provinces: provinceRecord(PROVINCES_2025),
    notes: 'July–December 2025: federal lowest rate 14% (T4127 122nd edition, July 2025 tables).',
  },
  {
    taxYear: 2026,
    version: '2026.1',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'verified',
    sourceIds: [...SOURCES, ...QC_SOURCES],
    lastVerifiedAt: VERIFIED_AT,
    federal: federal(
      [
        { upTo: 58_523, rate: 0.14 },
        { upTo: 117_045, rate: 0.205 },
        { upTo: 181_440, rate: 0.26 },
        { upTo: 258_482, rate: 0.29 },
        { upTo: null, rate: 0.33 },
      ],
      0.14,
      16_452,
      1_501,
      CPP_2026,
      CPP2_2026,
      EI_2026,
      EI_QC_2026,
    ),
    quebec: {
      brackets: [
        { upTo: 54_345, rate: 0.14 },
        { upTo: 108_680, rate: 0.19 },
        { upTo: 132_245, rate: 0.24 },
        { upTo: null, rate: 0.2575 },
      ],
      basicPersonalAmount: 18_952,
      creditRate: 0.14,
      employmentAmount: 0,
      qpp: { rate: 0.063, exemption: 3_500, maximumEarnings: 74_600, maximumContribution: 4_479.3 },
      qpp2: { rate: 0.04, exemption: 0, maximumEarnings: 85_000, maximumContribution: 416 },
      qpip: { rate: 0.0043, exemption: 0, maximumEarnings: 103_000, maximumContribution: 442.9 },
    },
    provinces: provinceRecord(PROVINCES_2026),
    notes:
      'Tax year 2026 (T4127 122nd and 123rd editions; Revenu Québec 2026 employer parameters). Provincial mid-year adjustments are applied as annual values.',
  },
];

export const PAYROLL_PACKS_BY_YEAR: Record<number, PayrollRulePack[]> = PAYROLL_PACKS.reduce<Record<number, PayrollRulePack[]>>(
  (acc, pack) => {
    acc[pack.taxYear] = [...(acc[pack.taxYear] ?? []), pack];
    return acc;
  },
  {},
);
