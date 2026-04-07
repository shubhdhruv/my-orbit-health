# Next Action: Session 4 — Dual-Write Validation + Read Path

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- Phase 2 DONE: Dual-write wired into intake.ts, doctor.ts, onboard.ts
- Phase 3 DONE: Notify + admin medplum visibility + BHD backfill (all 8 questionnaires created)
- BAA: In progress (Shubh emailing hello@medplum.com)

## What Session 3 Did
1. **notify.ts + email.ts** — `medplumPatientId` passed through to all doctor notification emails (async, sync, blocked). Shows as "Medplum Patient" row in email tables.
2. **doctor.ts** — Case detail shows green SYNCED / red NOT SYNCED badge for Medplum Patient. Approved/denied views show Medplum Patient ID.
3. **admin.ts** — `POST /admin/partner/:slug/repair-medplum` endpoint (org + questionnaires).
4. **intake.ts** — `medplumPatientId` now passed to `notifyOnIntake()`.
5. **BHD Backfill** — Organization `a2b7c2c8-0092-4452-a22d-130ab6de5c14` + 8 Questionnaires created and saved on partner config.

## This Session: Validation + Read Path

### Goal
1. Submit a test intake through BHD and verify data appears in both Healthie and Medplum
2. Add Medplum read-back to doctor portal (verify data consistency)
3. Consider adding Medplum resource links to admin partner detail page

### Prerequisites
- Healthcheck: ALL PASS (verified 2026-04-07)
- BHD has medplumOrgId + 8 medplumQuestionnaireIds

### Key Rules (unchanged)
- Medplum failure must not block patient flow
- Don't remove Healthie fields — add medplum fields alongside
- Run `/admin/medplum-healthcheck` before and after changes

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
