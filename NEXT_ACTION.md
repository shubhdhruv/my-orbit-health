# Next Action: Session 2 — Dual-Write Integration

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- BAA: In progress (Shubh emailing hello@medplum.com)

## What's Live
- `/admin/medplum-healthcheck` — public endpoint, creates Org → Patient → Questionnaire → QR → Composition (SOAP), all pass
- `src/worker/medplum.ts` — full FHIR client (token mgmt, all resource types)
- Dual-write types on Env, PartnerConfig, PendingCase

## This Session: Wire Medplum into the intake pipeline (dual-write)

### Goal
When a patient submits intake, write to **both** Healthie AND Medplum. This keeps Healthie as the source of truth while we validate Medplum data looks correct.

### Steps
1. **`src/worker/intake.ts`** — after Healthie patient + form creation succeeds, also call:
   - `createPatient()` → save `medplumPatientId` on PendingCase
   - `createQuestionnaireResponse()` with intake answers
   - Wrap in try/catch — Medplum failure should NOT block the intake flow

2. **`src/worker/doctor.ts`** — after SOAP note saves to Healthie, also call:
   - `createComposition()` with same S/O/A/P content
   - Again, Medplum failure = log + continue

3. **Partner onboarding** — when creating a partner via `/admin`, also:
   - `createOrganization()` → save `medplumOrgId` on PartnerConfig
   - `buildIntakeQuestionnaire()` for each service → save `medplumQuestionnaireIds`

4. **Verify** — submit a test intake through BHD, check that data appears in both Healthie and Medplum

### Key Decisions (already made)
- Plain fetch, no SDK
- SOAP = Composition with 4 sections, not Encounter+QR
- Token cache: stale-while-revalidate at 50min + KV lock (60s TTL)
- `MEDPLUM_BASE_URL` env var (not hardcoded)
- Dual fields during dual-write phase — don't rename/remove Healthie fields yet
- Medplum failure must not block patient flow

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
