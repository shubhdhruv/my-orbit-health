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

1. **End-to-end testing** — run a test intake through prod, verify: Medplum Patient + QR, SOAP note generation/save, prior-use dose adjustment, order lifecycle flow (approve → mark shipped → mark delivered), patient status page
2. **Lab vendor integration** — wire up imaware API for "need-labs" path (Shubh emailing sales@poweredbyimaware.com, credentials go to /admin/vendor-setup)
3. **Pharmacy API integration** — connect pharmacy system to auto-populate tracking (credentials go to /admin/vendor-setup)
4. **Follow-up check-in system** — automated emails at 2wk/4wk milestones post-delivery
5. **Remove STRIPE_BYPASS** when Shubh pastes Stripe keys on /admin/vendor-setup
6. **Delete healthie.ts** — dead code, no longer imported
7. **Shubh: finish DocuSign setup** — set secrets, verify Resend domain, test NDA flow
