# ShiftCheque public-source release audit — 2026-11-04

## Purpose and boundaries

This source snapshot was independently exported from a local pre-release
ShiftCheque project. It is NOT a signed Android release, app-store submission,
payroll certification or security guarantee. The original local project is
unchanged, and its Git history is not included in this public release.

## Security and privacy checks

- 135 text files in the local project scanned with common token/key patterns.
- 131 export files inspected before dependency installation; no matching
  credential, personal email, Expo project ID or local private path patterns.
- Historical local Git: 1 reachable commit and 14 blobs inspected with the
  same pattern-based audit, no matches found.
- Deliberately excluded: Android signing key/password, private credentials
  folder, private Expo/EAS project association, build logs, generated Android
  binaries, original Git history and personal contact email.
- Expo application configuration has generic development settings; each
  contributor must set their own account and package IDs.
- Public sample support email is a non-deliverable placeholder. Fork
  maintainers must replace it before publishing a mobile app.
- These scans are limited: they do not guarantee the absence of all
  vulnerabilities, unauthorized assets, security bugs, or unrecognized keys.

## Testing and quality

- Node.js tests: 194 passed, 0 failures.
- TypeScript typecheck: passed.
- ESLint: completed with 0 errors and 41 warnings (including hook-dependency
  warnings). These should be prioritized during future refactoring.
- Brand centralization check: passed.
- Full native Android device, iOS or signed store build: NOT verified in
  this open-source export.
- GitHub Actions is configured to run the repository's verify suite.

## Dependency risk disclosure

A fresh npm audit initially reported 30 advisories: 7 high, 21 moderate,
2 low, 0 critical. A compatible lockfile-only audit fix reduced the count
to **27: 6 high, 19 moderate, 2 low, 0 critical**.

Remaining advisories are associated with Expo, Expo Router and transitive
dependencies as well as lint tooling. Some npm suggested fixes require
major-version changes and can break compatibility; they were not forced.

**Security status:** this release contains known dependency vulnerabilities.
Treat it as experimental source code, not a production-hardened deployment.
Before shipping to real users, upgrade to a supported compatible SDK, rerun
tests, fix the relevant advisories and review Expo/React Native security notes.

## Financial accuracy and terms

Rule sets and their source references are documented in docs/RULE_SOURCES.md.
Rates and laws change; do not treat published project code as tax or legal
advice. Use synthetic financial data in tests, bug reports and screenshots.

Original ShiftCheque code is offered under MIT. Third-party dependencies,
logos and government documents retain separate rights and conditions.
See THIRD_PARTY_NOTICES.md.
