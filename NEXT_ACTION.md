# Next Action: Session 7 — Post-Cutover

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- Phase 1 DONE: `medplum.ts` built (12 functions), healthcheck ALL PASS
- Phase 2 DONE: Dual-write wired into intake.ts, doctor.ts, onboard.ts
- Phase 3 DONE: Notify + admin medplum visibility + BHD backfill (all 8 questionnaires created)
- Phase 4 DONE: E2E validated (test intake lands in both systems), read-back endpoint live, admin Medplum card added
- Phase 5 DONE: UI switchover — all user-facing "Healthie" labels renamed
- Phase 6 DONE: Cutover — Healthie removed from hot path. Medplum is primary.

## What Session 6 Did (Cutover)
1. **intake.ts** — Removed Healthie patient creation + form completion. Medplum `createPatient` + `createQuestionnaireResponse` is now the only EHR write. Removed `healthiePatientId` from PendingCase assignment.
2. **doctor.ts** — SOAP save now goes to Medplum only (`createComposition`). Removed `getSoapTemplate`, Healthie SOAP template, and all Healthie imports. Case detail shows `medplumPatientId` as "EHR ID" (no more SYNCED/NOT SYNCED badge).
3. **notify.ts** — Removed Healthie appointment creation from sync visit flow. Removed `patientId` (Healthie) from `NotifyParams`. Doctor email now says "Please schedule a video visit via the Doctor Portal."
4. **onboard.ts** — Partner onboarding creates Medplum Organization + Questionnaires only. Removed Healthie user group, intake forms, and onboarding flow creation.
5. **admin.ts** — Removed `repair-forms` (Healthie) endpoint. `repair-medplum` remains.
6. **email.ts** — Removed `healthiePatientId` and `appointmentCreated`/`appointmentError` params from sync visit email. Simplified appointment status message.
7. **types.ts** — Updated comments from "dual-write phase" to "primary". `healthiePatientId` kept as optional legacy field on `PendingCase`.
8. **healthie.ts** — NOT deleted. Kept as reference/fallback module (no longer imported by any active code path).

## What's Next (Priority Order)
1. **Deploy + test** — deploy to prod, run a test intake, verify patient + QuestionnaireResponse land in Medplum
2. **Test SOAP note end-to-end** — verify generate + edit + save works (now saves as Medplum Composition)
3. **Fix bloodwork pipeline** — file upload to R2, lab gate on doctor approval, dosing engine lab validation
4. **Lab vendor integration** — wire up chosen vendor API (pending Shubh's vendor decision)
5. **Prior medication history → dosing adjustment** — weight-loss-history answer should affect starting dose
6. **Full order lifecycle** in doctor portal (prescribed, shipped, delivered — needs pharmacy API)
7. **Remove STRIPE_BYPASS** when Shubh sets up new Stripe account
8. **Shubh: finish DocuSign setup** — set secrets, verify Resend domain, test NDA flow
