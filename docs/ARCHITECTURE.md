# Architecture

## Layers

```
src/app/**         Expo Router screens (no business logic)
src/ui/**          Design system: theme tokens, components, charts, ad slot
src/state/**       Zustand store + memoised selectors (invalidation by dataVersion)
src/services/**    Device + account integrations (billing, ads, notifications,
                   backup, app lock, analytics, rule updates, haptics, review)
src/db/**          Schema, migrations, repositories, row <-> domain mappers
src/rules/**       Verified rule packs, Zod schemas, effective-date loader
src/core/**        PURE engines (no React, no SQLite, no network)
src/config/**      Brand, flags, monetization defaults, ad policy, runtime env
src/i18n/**        en-CA / fr-CA strings + locale formatting
tests/**           Node test runner suites (no transpiler, no Jest)
docs/**            This documentation set
```

## Pure payroll pipeline

```
shiftTimeEngine      wall clock -> paid minutes (breaks, DST, rounding, overrides)
workWeekEngine       work week grouping + averaging agreements
payPeriodEngine      pay periods, paydays, period membership
rateEngine           effective-dated wage history
overtimeEngine       daily/weekly/double-time classification (greater-of rule)
premiumEngine        time-sliced premiums with stacking/priority rules
holidayEngine        statutory holidays per jurisdiction (observed dates)
vacationEngine       vacation pay by employer method + tenure
grossPayEngine       itemised earnings lines + per-shift attribution
cpp/cpp2/ei/qpp/qpp2/qpip engines   annualised contributions with YTD caps
incomeTaxEngine      federal / provincial / Quebec bracket tax with credits
deductionEngine      statutory + custom deductions -> net pay
confidenceEngine     Basic / Good / High + known/assumed/improve lists
chequeComparison     expected vs actual with neutral language
extraShiftEngine     incremental take-home of a hypothetical shift
calculatePayPeriod   the single top-level entry point
```

## Rules

- Every rule is data validated by Zod (`src/rules/types.ts`).
- Rules are effective-dated. A pay period always uses the rule in force on its
  pay date; superseded rules calculate historical periods; proposed rules never
  calculate.
- Remote rule bundles are optional, JSON-only, schema-validated, and fall back to
  the last verified cache, then to the bundled bundle.
- Sources live in `src/rules/sources.ts` and mirror to `docs/rules/sources.json`.

## Money and time

- Money is `bigint` micro-dollars (1e-6 CAD). Rounding happens once per line via
  `src/core/money.ts`. JavaScript floats are never authoritative.
- Durations are integer minutes.
- Timezones and DST are computed deterministically in `src/core/tz.ts`
  (no native tz database, identical results on every device).

## Performance

- `calculateForJob()` memoises by job + period + data version (bounded cache).
- SQLite indexes cover job, shift date, shift status, rate history and pay
  estimates.
- Home never recomputes historical payroll on render.
