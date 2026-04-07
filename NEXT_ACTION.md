# Next Action: Session 3 — Notify + Admin Medplum Visibility

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- Phase 2 DONE: Dual-write wired into intake.ts, doctor.ts, onboard.ts
- BAA: In progress (Shubh emailing hello@medplum.com)

## What Session 2 Did
1. **intake.ts** — after Healthie patient + form creation, also creates Medplum Patient + QuestionnaireResponse. Saves `medplumPatientId` on PendingCase. Medplum failure is non-blocking.
2. **doctor.ts** — after SOAP note saves to Healthie, also creates Medplum Composition with same S/O/A/P. Medplum failure is non-blocking.
3. **onboard.ts** — on partner creation, also creates Medplum Organization + Questionnaires per service. Saves `medplumOrgId` and `medplumQuestionnaireIds` on PartnerConfig. Medplum failure is non-blocking.

All three files compile clean, wrangler dry-run passes.

## This Session: Notify + Admin Medplum Visibility

### Goal
1. Add Medplum IDs to notification emails (so doctor can see data landed in both systems)
2. Show Medplum status on doctor portal case detail (green/red badge per resource)
3. Add admin repair endpoint for Medplum questionnaires (parallel to Healthie repair-forms)
4. Wire existing BHD partner with Medplum org + questionnaires (one-time backfill)

### Steps
1. **`src/worker/notify.ts`** — include `medplumPatientId` in doctor notification email body (informational)
2. **`src/worker/doctor.ts`** — in `renderCaseDetail()`, show Medplum Patient ID and SOAP Composition status badges
3. **`src/worker/admin.ts`** — add `POST /admin/partner/:slug/repair-medplum` to create missing Medplum org + questionnaires for existing partners
4. **Backfill BHD** — call repair-medplum for `the-beverly-hills-drip` to populate `medplumOrgId` + `medplumQuestionnaireIds`
5. **Test end-to-end** — submit a test intake through BHD, verify data appears in both Healthie and Medplum

### Key Rules (unchanged)
- Medplum failure must not block patient flow
- Don't remove Healthie fields — add medplum fields alongside
- Run `/admin/medplum-healthcheck` before and after changes

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
