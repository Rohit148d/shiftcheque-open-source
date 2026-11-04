# Monetization

## Plans

| | Free | Pro |
| --- | --- | --- |
| Shifts, calendar, hours | unlimited | unlimited |
| Take-home estimate (CPP/CPP2/EI/QPP/QPIP + tax) | yes | yes |
| Verified Canadian rules | yes | yes |
| Basic overtime, basic premiums, radar | yes | yes |
| Basic Cheque Check | yes | yes |
| Multiple jobs | 1 | unlimited |
| Full history | 90 days | everything |
| Advanced Cheque Check | 1 / month, or a rewarded unlock | unlimited |
| Exports (CSV/PDF) | rewarded unlock, once | unlimited |
| Custom overtime rules, unlimited premiums | no | yes |
| Themes | Maple, System Light, System Dark | + Midnight, Ocean, Forest, Lavender, Sunset |
| Ads | yes (after the gate) | none |

Working target price: **CA$0.99 / month**, no annual plan, no lifetime plan, no
trial — the free app is the trial.

## Paywall rules (enforced by placement, not by hope)

- Never during onboarding, never on first launch, never on a pay-estimate result.
- Contextual triggers only: second job, older history, second advanced check,
  export, custom rules, premium theme.
- The CTA shows the store's localized price when available; the working target
  price is only a fallback label.
- No fake discounts, no timers, no "only today".
- Expired subscriptions never delete data; Pro-created data stays and only
  editing/export is gated.

## Advertising policy (spec 65–73)

Activation gate — all four must be true before any ad is considered:

1. onboarding complete
2. at least 3 shifts recorded
3. at least one pay estimate viewed
4. at least 24 hours since first use

Placements:

- Banner: calendar and insights only (anchored adaptive). Not on Home.
- Interstitial: minimum 48 h apart, maximum 2 per rolling 7 days, at least 5
  meaningful sessions, never during shift entry, cheque check, extra-shift
  results, onboarding, purchase or error states.
- Rewarded: opt-in only, maximum 2 per day, never required for core accuracy.
- No app-open ads.

Remote control: `RemoteMonetizationSchema` (Zod) may only *tighten* these caps,
never loosen them beyond the bundled safety defaults.

Development uses Google test ad unit ids; live ids come from
`EXPO_PUBLIC_ADMOB_*` environment variables.

## Current build state (internal testing)

The ad **runtime** is not present in the billing-enabled internal build because the only
published version of the ads module cannot be evaluated by Expo SDK 57's Gradle/AGP
toolchain. The policy above is unchanged, fully unit-tested, and the ad slots render
nothing. See `docs/BILLING_AND_INTERNAL_TESTING.md` → “What is deliberately NOT in this
build (AdMob)” for the one-file re-introduction steps.

Before the public release that includes the free tier as designed, ads must be
re-introduced and verified, and the Play Console ads declaration must match reality.
