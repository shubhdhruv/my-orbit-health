# Orchestrator Prompt

Paste this into a fresh Claude Code session to create the master architecture document and parallel build plan.

---

## PROMPT:

You are the architect for My Orbit Health — a white-label telehealth platform. The repo is at `~/my-orbit-health` (GitHub: `shubhdhruv/my-orbit-health`).

Read the project memory at `~/.claude/projects/-Users-bryancalcott/memory/project_my_orbit_health.md` for full context including credentials, what's built, and what's deployed.

**THE MISSION:** Replace Healthie EHR ($65k/month) with Medplum (open-source, ~$200/month hosting). This saves ~$780k/year.

**WHAT EXISTS:** A Cloudflare Worker (Hono) is deployed at `onboard.myorbithealth.com` with:
- 17 service intake forms (semaglutide, testosterone, peptides, etc.)
- Influencer onboarding with branded form generation
- Stripe Connect payment flow (platform + direct mode)
- Admin panel for MOH to manage influencers and fees
- All currently wired to Healthie — needs to be rewired to Medplum

**WHAT YOU NEED TO BUILD (the orchestrator document):**

Create `ARCHITECTURE.md` in the repo root. This document will be read by multiple Claude sessions running in parallel, each building a different module. The document must define:

### 1. System Architecture
- Medplum as FHIR backend (self-hosted or Medplum cloud)
- Cloudflare Workers as API/frontend layer (keep existing)
- Stripe Connect for payments (keep existing)
- Video visit integration (Twilio, Daily.co, or Doxy.me)
- Compounding pharmacy API adapters

### 2. Module Definitions (6 modules that can be built in parallel)

**Module 1: MEDPLUM_CORE**
- Files: `src/medplum/`
- Owner: Session 1
- Scope: Medplum server setup, FHIR resource schemas (Patient, Practitioner, MedicationRequest, Questionnaire, QuestionnaireResponse, Encounter, Organization), user roles, auth
- Exports: client library, type definitions, FHIR resource helpers

**Module 2: DOCTOR_DASHBOARD**
- Files: `src/dashboard/`
- Owner: Session 2
- Scope: Doctor-facing web UI — pending review queue, patient detail (intake answers, bloodwork, history), approve/deny prescription, write prescription details, video visit launcher
- Depends on: Module 1 interfaces (not implementation)

**Module 3: PHARMACY_INTEGRATION**
- Files: `src/pharmacy/`
- Owner: Session 3
- Scope: Adapter pattern for compounding pharmacy APIs, prescription dispatch after approval, order tracking, status webhooks from pharmacies
- Depends on: Module 1 interfaces

**Module 4: VIDEO_VISITS**
- Files: `src/video/`
- Owner: Session 4
- Scope: Video call integration (Twilio/Daily.co), scheduling, waiting room, doctor/patient join flow, visit notes
- Depends on: Module 1 interfaces

**Module 5: PATIENT_PORTAL**
- Files: `src/portal/`
- Owner: Session 5
- Scope: Patient-facing web UI — appointment scheduling, visit history, subscription management (pause/cancel via Stripe), messages, bloodwork upload
- Depends on: Module 1 interfaces

**Module 6: INFLUENCER_PORTAL**
- Files: `src/influencer/`
- Owner: Session 6
- Scope: Influencer-facing web UI — password protected per influencer, change prices per service, view/copy embed codes, update brand (colors/logo/font), view patient count, view earnings
- Depends on: Module 1 interfaces, existing KV partner config

### 3. Shared Interfaces
Define TypeScript interfaces that ALL modules import from `src/shared/types.ts`:
- Patient, Practitioner, Prescription, Encounter, QuestionnaireResponse
- API response types
- Event types (prescription.approved, prescription.denied, etc.)
- Config types

### 4. File Ownership Rules
- Each module ONLY touches files in its assigned directory
- Shared types go in `src/shared/` — only the orchestrator modifies these
- Existing files (`src/worker/`, `src/templates/`, `src/lib/`) are NOT touched by any module — they keep working until migration is complete
- Each module works in its own git branch: `feature/module-1-medplum-core`, etc.

### 5. Integration Points
Define how modules communicate:
- Module 1 exposes a client library that all others import
- Webhooks between modules (prescription approved → pharmacy dispatch → patient charged)
- Event bus pattern for decoupling

### 6. Migration Plan
- Phase 1: Build all modules against Medplum (Healthie stays running)
- Phase 2: Parallel run — new patients go through Medplum, existing through Healthie
- Phase 3: Migrate existing patients from Healthie to Medplum
- Phase 4: Kill Healthie

### 7. Session Prompts
For each of the 6 modules, write the exact prompt that gets pasted into a fresh Claude session. Each prompt should:
- Reference ARCHITECTURE.md for interfaces
- Specify which files they own
- Specify which branch to work in
- List exactly what to build
- List what NOT to touch

**IMPORTANT:** Before writing the architecture, you need to ask Bryan:
1. Which compounding pharmacies and can he provide API docs?
2. Video provider preference: Twilio, Daily.co, or Doxy.me?
3. Self-host Medplum (more control, more ops) or use Medplum Cloud (managed, easier)?
4. How many sessions can realistically run at once?
5. Timeline — when does Healthie need to be off?

After getting answers, write the full ARCHITECTURE.md and the 6 session prompts. Do NOT write any code — only the architecture document and prompts.
