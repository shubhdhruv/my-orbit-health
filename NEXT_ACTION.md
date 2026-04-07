# Next Action: Session 1 — Build medplum.ts + Smoke Test

## Status
- Phase 0 DONE: Medplum account created, credentials verified, secrets set
- BAA: In progress (Shubh emailing hello@medplum.com)
- Plan tier: Developer (upgrade to Production before real patients)

## This Session
Build `src/worker/medplum.ts` and `/admin/medplum-healthcheck` smoke test endpoint.

### medplum.ts Functions to Build
Reference `src/worker/healthie.ts` for what each replaces.

1. `getMedplumToken(env)` — OAuth2 client credentials + KV cache (50min TTL) + lock key to prevent parallel refresh
2. `fhirCreate(env, resource)` — generic POST to `{MEDPLUM_BASE_URL}/fhir/R4/{resourceType}`
3. `fhirRead(env, resourceType, id)` — generic GET
4. `createOrganization(env, name, slug)` — replaces createUserGroup
5. `createPatient(env, input)` — POST Patient with managingOrganization ref
6. `buildIntakeQuestionnaire(env, service, influencerName)` — replaces buildIntakeFormInHealthie. **TEST THIS FIRST** — biggest risk.
7. `createQuestionnaireResponse(env, patientId, questionnaireId, answers)` — replaces createFormCompletion
8. `createComposition(env, params)` — SOAP note as Composition with 4 sections (S/O/A/P). LOINC 11488-4. NOT Encounter+QR.
9. `createEncounterOrAppointment(env, params)` — replaces createAppointment
10. `getPractitioners(env)` — replaces getProviders
11. `uploadBinary(env, data, contentType)` — NEW: raw file upload
12. `createDocumentReference(env, params)` — NEW: link Binary to Patient

### Smoke Test: `/admin/medplum-healthcheck`
Add to `src/worker/admin.ts`. Runs 5 ops in sequence, returns JSON pass/fail:
1. Create Organization
2. Create Patient scoped to org
3. Submit QuestionnaireResponse
4. Save Composition (SOAP)
5. Retrieve Patient by org

### Types to Add (DO NOT remove Healthie types yet)
In `src/lib/types.ts` Env interface, ADD:
- `MEDPLUM_CLIENT_ID: string`
- `MEDPLUM_CLIENT_SECRET: string`
- `MEDPLUM_BASE_URL: string`
- `DOCTOR_PRACTITIONER_ID: string`

On PartnerConfig, ADD alongside existing:
- `medplumOrgId?: string`
- `medplumQuestionnaireIds?: Record<string, string>`

On PendingCase, ADD alongside existing:
- `medplumPatientId?: string`

### Key Decisions (already made)
- Plain fetch, no SDK
- SOAP = Composition with 4 sections, not Encounter+QR
- Token cache: stale-while-revalidate at 50min + KV lock `medplum_token_refreshing` (30s TTL)
- `MEDPLUM_BASE_URL` env var (not hardcoded)
- Dual fields during dual-write phase — don't rename/remove Healthie fields yet

### Credentials (already set as Cloudflare secrets + in ~/.zshrc)
- Client ID: fffb526e-400e-4b5b-b7e5-f2c270d526dc
- Base URL: https://api.medplum.com
- Practitioner ID: 52efdd34-ff41-4b72-82a6-e0aaaebbf4a4
