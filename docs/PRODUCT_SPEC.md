# ShiftCheque — Product Spec

> Working title for the Play listing: `ShiftCheque: Shift & Pay`.
> Developed under the retired working name "PayMate" (see
> `docs/BRAND_RENAME_CHECKLIST.md`). Pre-release: no production upload yet.
> Every brand value comes from `src/config/brand.ts`.

## Mission

Shift → hours → Canadian pay rules → deductions → next take-home pay → actual
paycheque check. Built for hourly and shift workers in Canada.

Not a shift calendar clone, not payroll software, not a bank, not a lender.

## What ships

| Area | Status |
| --- | --- |
| Onboarding (10 steps, no account) | implemented |
| Home: next pay, overtime radar, next shift | implemented |
| Calendar: month/week/agenda, paint mode | implemented |
| Shift editor: simple + advanced + live shift | implemented |
| Scheduled vs actual time, paid-hours override | implemented |
| Pay breakdown + "How did you calculate this?" | implemented |
| Check My Pay (quick + payslip detail) | implemented |
| What is another shift worth? | implemented |
| Insights (hours, gross, take-home, overtime trends) | implemented |
| Multiple jobs (Pro) | implemented |
| Rate history, premiums, vacation, rounding, DST | implemented |
| CPP/CPP2/EI/QPP/QPP2/QPIP + federal/provincial/Quebec tax | implemented |
| Backup export/import, app lock, notifications | implemented |
| Pro subscription (RevenueCat) + ads (AdMob) | wired, credentials required |
| Home-screen widget | not implemented (documented limitation) |

## Principles that are enforced in code

1. **Explainability** — every estimate carries the rules, boundaries, rate
   history and official sources that produced it (`calculatePayPeriod`).
2. **No guessing** — only *verified* rules calculate automatically
   (`src/rules/loader.ts`). Anything else becomes a manual/custom rule.
3. **Honest confidence** — Basic / Good / High from configuration completeness,
   never a fake percentage (`src/core/confidence.ts`).
4. **Neutral language** — cheque comparisons never accuse an employer
   (`src/core/chequeComparison.ts` + tests that assert forbidden phrasing).
5. **Local-first** — no account, no bank link, no SIN, no cloud payroll.
6. **No unhealthy gamification** — no streaks, badges or pressure to work more.

## Language

User-facing copy avoids accounting jargon: *Next Pay*, *Pay Difference*,
*Add Shift*, *Estimated take-home*, *How your pay adds up*.
