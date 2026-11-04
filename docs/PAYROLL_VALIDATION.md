# Payroll validation

Validation has two parts: unit tests built from the formulas, and independent
checks against officially published figures. Both run in this repository.

## Independent reference cases (official figures)

| Reference | Official value | Engine result | Where |
| --- | --- | --- | --- |
| 2026 CPP maximum employee contribution | $4,230.45 | $4,230.45 | `tests/payroll.test.ts` |
| 2026 CPP2 maximum employee contribution | $416.00 | $416.00 | `tests/payroll.test.ts` |
| 2026 EI maximum employee premium (non-Quebec) | $1,123.07 | $1,123.07 | `tests/payroll.test.ts` |
| 2026 EI maximum employee premium (Quebec) | $895.70 | $895.70 | `tests/payroll.test.ts` |
| 2026 QPP maximum employee contribution | $4,479.30 | $4,479.30 | `tests/payroll.test.ts` |
| 2026 QPIP maximum employee premium | $442.90 | $442.90 | `tests/payroll.test.ts` |
| Biweekly CPP at $5,000 gross | $162.71 / period | $162.71 | `tests/payroll.test.ts` |
| Biweekly EI at $5,000 gross | $43.20 / period | $43.20 | `tests/payroll.test.ts` |
| CPP2 second-tier base at $5,000 biweekly | $400.00 | $400.00 | `tests/payroll.test.ts` |

These are the published annual maximums, i.e. the figures CRA prints on its CPP
and EI rate pages. Reproducing them exactly means the rate, exemption, ceiling
and contribution arithmetic all agree with the official tables.

## Formula-level checks

- Progressive brackets tax only income inside each band (unit test).
- Credits reduce tax but never below zero (unit test).
- Effective-dated mid-year rate change changes withholding (unit test).
- YTD values cap CPP/EI at the annual maximum, including partial-year cases.
- Quebec path emits QPP/QPP2/QPIP/EI and no separate federal withholding.
- A federally regulated job still uses the province of residence for tax.

## Time and overtime checks

- Day, overnight, midnight crossing, spring-forward (7 h) and fall-back (9 h).
- Paid vs unpaid breaks; breaks never deducted twice.
- Scheduled vs actual vs paid-hours override precedence.
- Weekly only (ON 44), daily+weekly (AB 8/44), double time (BC over 12).
- Greater-of daily/weekly, never both.
- Averaging agreements widen the threshold; custom two-tier rules.
- Historical periods use the rule in force at the time (PEI 48 → 44).

## Deliberate deviations

| Deviation | Reason |
| --- | --- |
| Annual amounts are rounded to the cent before dividing by pay periods | Keeps each line explainable; can differ from PDOC by ≤ $0.01 on some combinations |
| Federal BPA phase-out above $181,440 is not modelled | Outside the target user base; documented in RULE_SOURCES.md |
| Holiday pay is user-configured | Eligibility depends on qualifying days the app cannot know |
| Bulk-sum withholding for bonuses uses the regular method | Labelled in the UI as an estimate rather than a precise irregular-earning result |

## How to re-run

```bash
npm test          # 100 tests, Node's built-in runner
npm run verify    # typecheck + lint + tests
```

When new official publications appear, update the pack in
`src/rules/packs/payroll.ts` (new `effectiveFrom`), add a reference row to this
file, and re-run the suite.
