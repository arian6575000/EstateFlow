# EstateFlow

**Real Estate Business Management** for Pakistani property dealers. Android, offline-first, single user. Properties, owners, listings, buyers, visits, deals, commission and payments all live in a local SQLite database on the phone. No account, no server, no internet needed.

EstateFlow is an independent app built on the **RetailX CRM** foundation (copied, not modified: the original repository is untouched). See `docs/AUDIT.md` for what was inherited and what changed.

> **Status: foundation (Phases 1-2) + domain core.** The data model, business rules and repository layer for the property domain are implemented and tested. The real-estate *screens* are not built yet; the app still shows the inherited CRM screens under the new identity. See `docs/CHECKLIST.md` for exactly what is done, partial and not started.

## Stack (unchanged from RetailX CRM)

Expo SDK 58 · React Native 0.88 · React 19 · TypeScript (strict) · expo-router · expo-sqlite · tweetnacl · react-native-svg · Inter font.

## Getting started

```bash
npm install --legacy-peer-deps
npm install --no-save --legacy-peer-deps sharp && node scripts/make-icons.mjs   # app icons (CI does this too)
npm run typecheck
npm test
npm start
```

## Licensing

EstateFlow has its **own** licensing identity (`src/license/config.ts`):

| Setting | Value |
|---|---|
| `PROJECT_CODE` | `estateflow` |
| `DEVICE_PREFIX` | `EstateFlow` (Device IDs look like `EstateFlow-87A9-F285-E2DF`) |
| `PUBLIC_KEY_HEX` | **empty until you add the EstateFlow public key** |

Until a real 64-hex Ed25519 **public** key is pasted, the app shows "license not configured" and never opens. The verification algorithm (Ed25519 signature, project code, device binding, expiry, clock-rollback guard) is identical to RetailX CRM. A RetailX CRM license cannot open EstateFlow: the signing key and project code differ.

You must create the `estateflow` project and key pair in your License Generator/Hub. **Never commit the private key** (`.license/` is git-ignored).

## Build an APK

GitHub Actions (`.github/workflows/apk-build.yml`) runs on pushes to `main`: icons, typecheck, tests, `expo prebuild`, `gradle assembleRelease`, then uploads `EstateFlow-apk`. Android package id: `com.estateflow.app`.

## Project layout

```
src/app/       expo-router screens (inherited CRM screens for now)
src/domain/    pure business rules: units, availability, ownership, commission, finance
src/db/        schema + migrations (v1 RetailX, v2 property core, v3 deals/finance), repos, backup
src/license/   offline license verification and gate
src/ui/        design-system components
tests/         node:sqlite tests for repo, license, domain rules and the estate schema
docs/          AUDIT.md, BUSINESS_RULES.md, CHECKLIST.md
```

## Data and privacy

Everything stays on the device. Android auto-backup is disabled. Backups leave the phone only when the user shares them.
