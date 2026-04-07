# Next Action: Session 6 — Cutover (Healthie → Medplum)

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- Phase 2 DONE: Dual-write wired into intake.ts, doctor.ts, onboard.ts
- Phase 3 DONE: Notify + admin medplum visibility + BHD backfill (all 8 questionnaires created)
- Phase 4 DONE: E2E validated (test intake lands in both systems), read-back endpoint live, admin Medplum card added
- Phase 5 DONE: UI switchover — all user-facing "Healthie" labels renamed, fixed duplicate medplum imports in admin.ts
- BAA: In progress (Shubh emailing hello@medplum.com)

## What Session 5 Did
1. **doctor.ts** — "Save to Healthie" button → "Save SOAP Note", "Healthie ID" → "EHR ID", "Healthie Note ID" → "Note ID", `saveSoapToHealthie()` → `saveSoapNote()`, toast/error messages de-branded
2. **email.ts** — Removed "Healthie" from appointment status messages in sync visit doctor email (3 strings)
3. **admin.ts** — Task description de-branded ("Save SOAP Note" instead of "Save to Healthie"), fixed duplicate medplum imports (consolidated to single import at top)
4. **Sweep** — Verified all remaining "Healthie" references are code-internal only (imports, variable names, module comments) — correct to keep during dual-write phase

## This Session: Cutover

### Goal
Stop dual-writing and make Medplum the primary data store. Remove Healthie writes from the hot path. Keep healthie.ts as a module for reference/fallback but stop calling it from intake, doctor, and notify flows.

### Prerequisites (must be true before starting)
- [ ] BAA signed with Medplum (real patient data requires it)
- [ ] At least one real approved case has gone through Medplum in prod
- [ ] Healthcheck passes on production (`/admin/medplum-healthcheck`)

### What to change
1. **intake.ts** — Remove Healthie patient creation + form completion from submit flow. Medplum becomes primary.
2. **doctor.ts** — SOAP save goes to Medplum only. Remove Healthie saveSoapNote call.
3. **notify.ts** — Remove Healthie appointment creation. Replace with Medplum Encounter.
4. **onboard.ts** — Partner onboarding creates Medplum Organization + Questionnaires only. Remove Healthie user group + form creation.
5. **types.ts** — Can rename `healthiePatientId` → `legacyPatientId` or remove. Add `medplumPatientId` as primary.
6. **admin.ts** — Remove repair-forms (Healthie) endpoint. Keep repair-medplum.

### Key Rules
- DO NOT delete healthie.ts — keep for reference and potential fallback
- Verify healthcheck passes after every file change
- Deploy incrementally — one file at a time, test between each

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
