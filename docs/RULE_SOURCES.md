# Rule sources

Every automatic rule in the app is verified against an official source and
stored with `lastVerifiedAt`. The machine-readable mirror of this file is
`docs/rules/sources.json` (generated from `src/rules/sources.ts`).

Verification date for the current bundle (`2026.10.1`): **2026-10-05**.

## Payroll (deductions)

| Program | Source |
| --- | --- |
| CPP / CPP2 rates, YMPE, YAMPE, maximums | CRA — CPP contribution rates, maximums and exemptions |
| EI rates, MIE, maximums (incl. Quebec reduced rate) | CRA — EI premium rates and maximums |
| Federal + provincial/territorial tax formulas | CRA T4127 Payroll Deductions Formulas (122nd ed. Jan 2026, 123rd ed. Jul 2026) |
| Federal/provincial brackets, BPA, claim codes | CRA T4127 chapter 8 tables + CRA indexation chart |
| Quebec income tax, QPP, QPP2, QPIP | Revenu Québec employer kit / principal changes 2025 & 2026, TP-1015.F-V, TP-1015.TI-V; Retraite Québec; RQAP |

## Employment standards (overtime / vacation)

| Jurisdiction | Source |
| --- | --- |
| FED | Canada Labour Code — hours of work (canada.ca) |
| AB | alberta.ca — overtime hours and overtime pay |
| BC | gov.bc.ca — overtime pay |
| MB | gov.mb.ca — overtime fact sheet |
| NB | gnb.ca — minimum pay, overtime and reporting for work |
| NL | gov.nl.ca — Your Rights At Work (Labour Standards) |
| NS | novascotia.ca — overtime pay |
| NT | ece.gov.nt.ca — employment standards FAQ |
| NU | gov.nu.ca — labour and employment standards |
| ON | ontario.ca — overtime pay (ESA guide) |
| PE | PEI Employment Standards Act (E-6.3), in force 2026-06-30 |
| QC | CNESST — overtime |
| SK | saskatchewan.ca — overtime in a day vs in a week |
| YT | yukon.ca — Employment Standards general fact sheet |

## Effective dating in practice

- Federal lowest rate changed **2025-07-01** (15% → 14%): tax year 2025 is two
  packs and historical periods pick the right one.
- Nova Scotia weekly threshold drops 48 → 44 hours on **2027-04-01**: stored as
  `proposed` and never used for calculation until verified as in force.
- Prince Edward Island's new Act (**2026-06-30**) is effective and used for
  current periods; the previous 48-hour rule remains for older periods as
  `superseded`.

## Known gaps (documented, not guessed)

- The federal basic personal amount phases out above $181,440 of income; a flat
  amount is used (overstates the credit slightly at very high incomes).
- Mid-2026 provincial adjustments (BC 5.60% lowest rate, NL BPA 13,094, PE 20%
  bracket) are applied as annual values rather than prorated Jul–Dec values.
- Statutory holiday **eligibility** is never assumed. Holiday pay appears only
  when the user says their employer pays it; holiday *dates* drive premiums.
- Quebec holiday/premium treatment follows the configured workplace rules.
