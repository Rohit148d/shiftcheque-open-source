# Privacy data map

## Stays on the device (SQLite at `shiftcheque.db`)

jobs, rates, shifts, breaks, notes, overtime rules, premiums, vacation config,
deduction profiles (including TD1 claim amounts and year-to-date figures), pay
estimates, actual paycheque entries, cheque comparisons, settings, notification
preferences, ad pacing counters, subscription cache, backups you create.

Nothing above is uploaded. There is no account and no sync.

## Leaves the device, and only when configured

| Data | Destination | When | Notes |
| --- | --- | --- | --- |
| Non-personalised ad request (app id, ad unit) | Google AdMob | Free users, after the activation gate, on allowed screens only | Never contains pay data. Pro users do not request ads at all |
| Purchase / restore / entitlement | Google Play + RevenueCat | When you buy, restore or open the app | Product id, store receipt, entitlement status |
| Anonymous event names | Your own endpoint (`EXPO_PUBLIC_ANALYTICS_ENDPOINT`) | Only if the build sets an endpoint | Allow-list only; no properties; no money values |
| Sanitised crash message | Your own endpoint (`EXPO_PUBLIC_CRASH_ENDPOINT`) | Only if configured | Numbers, emails and identifiers are stripped |
| Remote rule bundle download | Your own host (`EXPO_PUBLIC_RULE_PACK_URL`) | Only if configured | One-way download of JSON rules |

With no endpoints configured — the default, and how the app runs in development,
CI and Expo Go — nothing leaves the device at all.

## Never collected

No SIN, no bank credentials, no bank account numbers, no employer address, no
contacts, no SMS or call logs, no precise location, no microphone, no camera.

## Permissions

| Permission | Why |
| --- | --- |
| `POST_NOTIFICATIONS` (runtime) | Shift and payday reminders, only if you accept |
| Biometric / device credential (via `expo-local-authentication`) | App lock, only if you enable it |

`android.blockedPermissions` explicitly blocks location, camera, microphone,
contacts and SMS so no dependency can add them silently.

## Retention and deletion

Uninstalling removes the database. Settings → Backup lets you export first, and
import lets you move data to a new phone. Replacing data during an import takes a
safety backup first when the file system allows it.

## Hardening options (documented, not enabled by default)

- SQLCipher: add `useSQLCipher` to the `expo-sqlite` plugin config and store the
  key in `expo-secure-store`. Not enabled by default so Expo Go development
  keeps working.
- Encrypted backups: **not implemented** in V1. Rolling our own crypto would be
  worse than none, so the UI says plainly that backup files are unencrypted.
