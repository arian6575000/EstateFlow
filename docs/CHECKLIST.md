# Implementation checklist (honest status)

Legend: ✅ done and tested · 🟡 partial · ⬜ not started

## Phase 1 — audit and duplication
- ✅ Full source audit (`docs/AUDIT.md`)
- ✅ Independent project identity (package id, DB, storage keys, backup marker, theme, icons)
- ✅ Licensing identity separated; algorithm unchanged; **public key still to be supplied**
- ✅ Original RetailX repo untouched; baseline tests/typecheck green before changes
- 🟡 APK build: CI workflow ready and now runs tests; **not run yet** (needs the repo on GitHub `main` + a public key)

## Phase 2 — foundation
- ✅ Branding and navy/teal theme tokens (contrast test passing)
- ✅ Migrations v2/v3 (additive, v1 data survives, idempotent)
- ⬜ Navigation (Home / Explore / Contacts / Deals / Insights), reusable real-estate UI components, global search UI

## Phase 3 — property management
- ✅ Property repo: create/edit/archive, unit normalisation, search + filters + pagination, duplicate suggestions
- ✅ Ownership with history, listings with history, availability engine with audit trail
- ⬜ All screens (registry, explorer grid/list/map, details, gallery, photos)

## Phases 4-8
- ✅ Domain rules only: commission engine, finance (payments/reversals/refunds/installments), deal-related tables, triggers
- ⬜ Matching engine, dealer directory/collaboration workflow, visits UI, deal workspace, deal repo/stage transitions, payments UI, reports, dashboard, documents UI, saved searches, activity center, notifications for visits/listings/payments
- ⬜ Deal/finance/collaboration/requirement/visit **repositories** (tables exist, no repo code yet)

## Phase 9 — security and backup
- ✅ Inherited PIN, biometrics, auto-lock, screen-capture blocking, encrypted backup (with EstateFlow marker)
- ⬜ **Backup does not include the new EstateFlow tables or property photos yet.** `eraseAll`/replace-restore refuses to run when EstateFlow data exists so nothing is destroyed silently.
- ⬜ RetailX to EstateFlow backup migration (intentionally rejected for now: different backup marker)

## Phase 10 — QA/release
- ✅ 7 test suites, `tsc --noEmit` clean
- ⬜ Device testing, Airplane-mode pass, large-dataset performance test, release signing
