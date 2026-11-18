# RetailX CRM source audit (basis for EstateFlow)

Audited from the actual source (commit `d785b6d` of `arian6575000/RetailX-crm`), not the README. Baseline before any change: `npm test` (5 suites) and `tsc --noEmit` both passed.

## Stack
Expo ~58.0.14, React Native 0.88.0, React 19.3.0, TypeScript ~6.0.3 (strict), expo-router ~58 (file-based, `src/app`), expo-sqlite ~58, tweetnacl + tweetnacl-util, react-native-svg, expo-secure-store, expo-local-authentication, expo-notifications, expo-print, expo-sharing, expo-file-system, Inter. State: React context (`src/ctx`), no Redux. Tests: plain `tsx` scripts using `node:assert` and `node:sqlite` (no Jest). EAS profile + a GitHub Actions workflow build the APK.

## Architecture
- `src/db/schema.ts`: migrations as an ordered array of SQL strings, versioned with `PRAGMA user_version`, each applied in a transaction. The `Db` interface lets the same code run on expo-sqlite (app) and node:sqlite (tests).
- `src/db/repo.ts`: one `Repo` object, row mappers, parameterised SQL, LIKE-escaping.
- `src/db/backupCore.ts` + `src/lib/backupCrypto.ts`: one JSON document (all tables + attachment files as data URLs), optional XSalsa20-Poly1305 encryption with a salted, iterated SHA-512 key; merge or replace restore with id remapping.
- Security: PIN (salted hash) + biometrics + auto-lock (`src/lib/lock.ts`), screen-capture blocking, Android auto-backup disabled.
- Licensing (`src/license/`): `MPOS-LIC-<base64url payload>.<base64url Ed25519 signature>`. `verifyLicense` checks prefix, signature, `project_code`, device binding (`machine_id`), expiry (end of day UTC) and a clock-rollback guard (`lastSeen`). License and last-seen time are stored in Android Keystore via expo-secure-store. Device ID = SHA-256 over app prefix + Android ID + hardware traits, so the same phone gets a different ID in each app. Feature flags come from the license payload with defaults in `permissions.json`.

## Inherited modules (kept)
Dashboard, customers (= central person record), leads/pipeline, follow-ups with local notifications, activity timeline, notes, groups and tags, attachments, analytics, CSV/contacts import-export, backup/restore, PIN/biometrics, settings, PDF export, themes.

## What EstateFlow changed
| Area | Change |
|---|---|
| Identity | name, slug, scheme, Android package `com.estateflow.app`, DB file `estateflow.db`, secure-store keys `ef_*`, PIN hash salt, backup marker (`app: "EstateFlow"`, `estateflow_enc`), file names, CI artifact |
| Licensing | new `PROJECT_CODE`/`DEVICE_PREFIX`, **no key committed** (public key empty), algorithm untouched |
| Theme | navy `#0B2A4A` / teal `#0F766E`; WCAG AA contrast test kept and passing in both themes |
| Database | additive migrations v2 + v3 (no change to v1 tables except 3 `ALTER TABLE ... ADD COLUMN` on `customers`) |
| Backup | `eraseAll` now refuses to wipe while EstateFlow data exists (see limitations) |

The original RetailX repository was cloned read-only and never pushed to.

## Findings that shaped decisions
1. `customers` already works as the central Person: extended with `whatsapp`, `cnic`, `profile_image` and a `person_roles` table instead of a second people table.
2. `followups`/`activities` are reused for visits and the deal timeline; `property_visits.followup_id` links to follow-ups.
3. The RetailX backup is table-whitelisted (`TABLES`/`COLS` in `backupCore.ts`); new tables are **not yet** included. This is the main data-safety gap (Phase 9).
4. The license `ACCEPTED_PREFIXES` list still contains `RETAILX-LIC-`/`DPOS-LIC-`. That is only a text label; trust comes from the signature + project code, so it was left as is.
5. `LICENSE` and `brand.ts` credit line still carry the RetailX Solution phone number; confirm the publisher credit you want.
