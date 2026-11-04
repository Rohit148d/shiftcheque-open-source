# ShiftCheque

Open-source mobile app for Canadian hourly and shift workers, built with
Expo, React Native, and TypeScript.

**Status: pre-release, experimental.** Estimates are for personal planning;
this is not tax, payroll, accounting, or employment-law advice.

## Features

- Shift calendar, recurring schedules, actual and scheduled hours
- Multiple jobs, wages, premiums and overtime estimation
- CPP, EI, QPP, QPIP and income-tax estimate calculation
- Effective-dated Canadian federal, provincial and territorial rules
- Paycheque comparison, breakdown and extra-shift take-home estimates
- CSV/PDF export, local backup and restore, app lock, en-CA and fr-CA
- Optional RevenueCat billing and AdMob integration (not configured by default)

## Run locally

Install Node.js and npm. You will also need the Expo toolchain and an Android
emulator/device or compatible development environment.

~~~bash
git clone https://github.com/Rohit148d/shiftcheque-open-source.git
cd shiftcheque-open-source
npm ci
npm run verify
npm start
~~~

Expo apps run under your own development accounts. No production credentials
or Android signing material is included. Update package identifiers,
support email, branding and legal URLs before distributing your own version.
The sanitized example configuration is in `app.json`, `eas.json` and
`src/config/brand.ts`. Set any optional public RevenueCat keys locally.

### Test commands

~~~bash
npm run typecheck
npm run lint
npm run check:encoding
npm test
npm run verify
~~~

## Rules, privacy and limitations

Read [government sources](docs/RULE_SOURCES.md),
[validation examples](docs/PAYROLL_VALIDATION.md), the
[privacy data map](docs/PRIVACY_DATA_MAP.md), and
[known limitations](docs/PRODUCT_SPEC.md).

Figures are **estimates**, especially for unusual or irregular compensation,
bonuses, year-end contribution thresholds, special exemptions and agreements.
Payroll legislation and rate tables must be checked for updates.

## Licensing

Original ShiftCheque source code: [MIT license](LICENSE).
Upstream libraries and assets retain their respective licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md).

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
[Open-source audit](docs/SECURITY_AUDIT.md)

This repository has a fresh Git history and deliberately excludes signing
keys, Expo account identifiers, credentials, private build logs, original
project history and users' wage or payslip records.
