# Next Action: Session 5 — UI Switchover (Healthie → Medplum)

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- Phase 2 DONE: Dual-write wired into intake.ts, doctor.ts, onboard.ts
- Phase 3 DONE: Notify + admin medplum visibility + BHD backfill (all 8 questionnaires created)
- Phase 4 DONE: E2E validated (test intake lands in both systems), read-back endpoint live, admin Medplum card added
- BAA: In progress (Shubh emailing hello@medplum.com)

## What Session 4 Did
1. **admin.ts** — Fixed missing medplum imports (repair-medplum endpoint was broken at runtime)
2. **medplum.ts** — Exported `fhirSearch` for read-back queries
3. **doctor.ts** — Added `GET /doctor/case/:id/medplum-data` endpoint that reads Patient, QuestionnaireResponses, and Compositions from Medplum. Added "Verify Data" button + Medplum Verification card to case detail UI.
4. **admin.ts** — Added Medplum Integration card to partner detail showing org ID + all questionnaire IDs with LINKED/NOT SET badges
5. **E2E Test** — Submitted test intake through BHD semaglutide. Verified: Patient in Healthie (5807348) + Medplum (e8d055d3-...), QuestionnaireResponse with 15 items, read-back returns correctly on both workers.dev and custom domain.

## This Session: UI Switchover

### Goal
Replace Healthie-specific UI labels and references with Medplum (or dual-display) across the doctor portal and admin pages. This is cosmetic + functional — the data flow stays dual-write but the UI should reflect the migration.

### What to change
1. **Doctor portal SOAP modal** — "Save to Healthie" button → "Save SOAP Note" (saves to both)
2. **Doctor portal case detail** — Remove/rename Healthie-specific labels, keep both IDs visible
3. **Email templates** — Update any "Healthie" references in doctor notification emails
4. **Admin partner detail** — Healthie form IDs section should show alongside Medplum questionnaire IDs (both still needed during migration)
5. **Sweep** — `grep -r "Healthie" src/` for any user-facing strings that should be renamed

### Key Rules (unchanged)
- Medplum failure must not block patient flow
- Don't remove Healthie functionality — only rename UI labels
- Keep dual-write intact
- Run `/admin/medplum-healthcheck` before and after changes

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
