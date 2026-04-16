// Medplum FHIR R4 API integration
// Plain fetch, no SDK — mirrors healthie.ts structure

import type { Env } from "../lib/types";
import type { ServiceDefinition, FormStep } from "../lib/services";

// ============================================================
// Token Management (OAuth2 client credentials, KV-cached)
// ============================================================

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export async function getMedplumToken(env: Env): Promise<string> {
  // Check KV cache first
  const cached = (await env.PARTNERS.get(
    "medplum_token",
    "json",
  )) as CachedToken | null;
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    // Still valid with 1min buffer
    return cached.accessToken;
  }

  // Stale-while-revalidate: use stale token if someone else is refreshing
  const lockKey = "medplum_token_refreshing";
  const lock = await env.PARTNERS.get(lockKey);
  if (lock && cached) {
    return cached.accessToken;
  }

  // Acquire refresh lock (30s TTL)
  await env.PARTNERS.put(lockKey, "1", { expirationTtl: 60 });

  try {
    const res = await fetch(`${env.MEDPLUM_BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.MEDPLUM_CLIENT_ID,
        client_secret: env.MEDPLUM_CLIENT_SECRET,
      }),
    });

    if (!res.ok) {
      throw new Error(`Medplum token error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as TokenResponse;
    const token: CachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    // Cache for 50min (tokens last 60min)
    await env.PARTNERS.put("medplum_token", JSON.stringify(token), {
      expirationTtl: 3000,
    });
    return token.accessToken;
  } finally {
    await env.PARTNERS.delete(lockKey);
  }
}

// ============================================================
// Generic FHIR helpers
// ============================================================

async function fhirFetch(
  env: Env,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getMedplumToken(env);
  const url = `${env.MEDPLUM_BASE_URL}/fhir/R4/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/fhir+json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export async function fhirCreate<T = Record<string, unknown>>(
  env: Env,
  resource: Record<string, unknown>,
): Promise<T> {
  const resourceType = resource.resourceType as string;
  if (!resourceType) throw new Error("Missing resourceType on FHIR resource");

  const res = await fhirFetch(env, resourceType, {
    method: "POST",
    body: JSON.stringify(resource),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Medplum create ${resourceType} failed (${res.status}): ${err}`,
    );
  }
  return (await res.json()) as T;
}

export async function fhirRead<T = Record<string, unknown>>(
  env: Env,
  resourceType: string,
  id: string,
): Promise<T> {
  const res = await fhirFetch(env, `${resourceType}/${id}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Medplum read ${resourceType}/${id} failed (${res.status}): ${err}`,
    );
  }
  return (await res.json()) as T;
}

export async function fhirSearch<T = Record<string, unknown>>(
  env: Env,
  resourceType: string,
  params: Record<string, string>,
): Promise<{ entry?: Array<{ resource: T }> }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fhirFetch(env, `${resourceType}?${qs}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Medplum search ${resourceType} failed (${res.status}): ${err}`,
    );
  }
  return (await res.json()) as { entry?: Array<{ resource: T }> };
}

// ============================================================
// Organization (replaces createUserGroup)
// ============================================================

interface FhirOrganization {
  resourceType: "Organization";
  id: string;
  name: string;
  identifier: Array<{ system: string; value: string }>;
}

export async function createOrganization(
  env: Env,
  name: string,
  slug: string,
): Promise<FhirOrganization> {
  return fhirCreate<FhirOrganization>(env, {
    resourceType: "Organization",
    name,
    identifier: [{ system: "https://myorbithealth.com/partner", value: slug }],
    active: true,
  });
}

// ============================================================
// Patient (replaces createClient)
// ============================================================

interface FhirPatient {
  resourceType: "Patient";
  id: string;
  name: Array<{ given: string[]; family: string }>;
}

export async function createPatient(
  env: Env,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: string;
    organizationId: string;
  },
): Promise<FhirPatient> {
  const genderMap: Record<string, string> = {
    male: "male",
    female: "female",
    other: "other",
    m: "male",
    f: "female",
  };

  return fhirCreate<FhirPatient>(env, {
    resourceType: "Patient",
    name: [{ given: [input.firstName], family: input.lastName }],
    telecom: [
      { system: "email", value: input.email },
      { system: "phone", value: input.phone },
    ],
    birthDate: input.dateOfBirth,
    gender: genderMap[input.gender.toLowerCase()] || "unknown",
    managingOrganization: { reference: `Organization/${input.organizationId}` },
  });
}

// ============================================================
// Questionnaire (replaces buildIntakeFormInHealthie)
// ============================================================

interface FhirQuestionnaire {
  resourceType: "Questionnaire";
  id: string;
  title: string;
  status: string;
}

function stepToFhirType(step: FormStep): string {
  switch (step.type) {
    case "radio":
    case "select":
      return "choice";
    case "checkbox":
      return "choice"; // repeats = true for multi-select
    case "number":
    case "bmi":
      return "decimal";
    case "text":
    case "file-upload":
      return "string";
    case "textarea":
      return "text";
    case "date":
      return "date";
    default:
      return "string";
  }
}

function buildAnswerOption(options: Array<{ label: string; value: string }>) {
  return options.map((o) => ({
    valueCoding: {
      code: o.value,
      display: o.label,
    },
  }));
}

export async function buildIntakeQuestionnaire(
  env: Env,
  service: ServiceDefinition,
  influencerName: string,
): Promise<FhirQuestionnaire> {
  const items: Record<string, unknown>[] = [];
  let linkId = 1;

  for (const step of service.intakeSteps) {
    if (step.type === "bmi") {
      // Two separate decimal items for weight and height
      items.push({
        linkId: String(linkId++),
        text: "Weight (pounds)",
        type: "decimal",
        required: true,
      });
      items.push({
        linkId: String(linkId++),
        text: "Height (total inches)",
        type: "decimal",
        required: true,
      });
    } else {
      const item: Record<string, unknown> = {
        linkId: String(linkId++),
        text: step.question,
        type: stepToFhirType(step),
        required: step.required !== false,
      };

      if (step.options && step.options.length > 0) {
        item.answerOption = buildAnswerOption(step.options);
        if (step.type === "checkbox") {
          item.repeats = true;
        }
      }

      if (step.conditionalOn) {
        item.enableWhen = [
          {
            question: step.conditionalOn.stepId,
            operator: "=",
            answerCoding: { code: step.conditionalOn.value },
          },
        ];
      }

      items.push(item);
    }
  }

  return fhirCreate<FhirQuestionnaire>(env, {
    resourceType: "Questionnaire",
    title: `${influencerName} — ${service.label} Intake`,
    status: "active",
    subjectType: ["Patient"],
    item: items,
  });
}

// ============================================================
// QuestionnaireResponse (replaces createFormCompletion)
// ============================================================

interface FhirQuestionnaireResponse {
  resourceType: "QuestionnaireResponse";
  id: string;
  status: string;
}

export async function createQuestionnaireResponse(
  env: Env,
  patientId: string,
  questionnaireId: string,
  answers: Record<string, string | number | boolean>,
): Promise<FhirQuestionnaireResponse> {
  const items = Object.entries(answers).map(([linkId, value]) => {
    const answer: Record<string, unknown>[] = [];
    if (typeof value === "number") {
      answer.push({ valueDecimal: value });
    } else if (typeof value === "boolean") {
      answer.push({ valueBoolean: value });
    } else {
      answer.push({ valueString: value });
    }
    return { linkId, answer };
  });

  return fhirCreate<FhirQuestionnaireResponse>(env, {
    resourceType: "QuestionnaireResponse",
    questionnaire: `Questionnaire/${questionnaireId}`,
    subject: { reference: `Patient/${patientId}` },
    status: "completed",
    item: items,
  });
}

// ============================================================
// Composition — SOAP Note (replaces saveSoapNote)
// ============================================================

interface FhirComposition {
  resourceType: "Composition";
  id: string;
  status: string;
}

export async function createComposition(
  env: Env,
  params: {
    patientId: string;
    practitionerId: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    title?: string;
  },
): Promise<FhirComposition> {
  return fhirCreate<FhirComposition>(env, {
    resourceType: "Composition",
    status: "final",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11488-4",
          display: "Consult note",
        },
      ],
    },
    subject: { reference: `Patient/${params.patientId}` },
    author: [{ reference: `Practitioner/${params.practitionerId}` }],
    date: new Date().toISOString(),
    title: params.title || "SOAP Note",
    section: [
      {
        title: "Subjective",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "61150-9",
              display: "Subjective",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(params.subjective)}</div>`,
        },
      },
      {
        title: "Objective",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "61149-1",
              display: "Objective",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(params.objective)}</div>`,
        },
      },
      {
        title: "Assessment",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "51848-0",
              display: "Assessment",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(params.assessment)}</div>`,
        },
      },
      {
        title: "Plan",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "18776-5",
              display: "Plan of care",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(params.plan)}</div>`,
        },
      },
    ],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// Encounter (replaces createAppointment)
// ============================================================

interface FhirEncounter {
  resourceType: "Encounter";
  id: string;
  status: string;
}

export async function createEncounter(
  env: Env,
  params: {
    patientId: string;
    practitionerId: string;
    notes?: string;
  },
): Promise<FhirEncounter> {
  return fhirCreate<FhirEncounter>(env, {
    resourceType: "Encounter",
    status: "planned",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "VR",
      display: "virtual",
    },
    subject: { reference: `Patient/${params.patientId}` },
    participant: [
      {
        individual: { reference: `Practitioner/${params.practitionerId}` },
      },
    ],
    reasonCode: params.notes ? [{ text: params.notes }] : undefined,
  });
}

// ============================================================
// Practitioner lookup (replaces getProviders)
// ============================================================

interface FhirPractitioner {
  resourceType: "Practitioner";
  id: string;
  name: Array<{ given?: string[]; family?: string; text?: string }>;
}

export async function getPractitioners(
  env: Env,
): Promise<Array<{ id: string; name: string }>> {
  const bundle = await fhirSearch<FhirPractitioner>(env, "Practitioner", {
    _count: "50",
  });
  return (bundle.entry || []).map((e) => {
    const p = e.resource;
    const n = p.name?.[0];
    const name =
      n?.text ||
      [n?.given?.join(" "), n?.family].filter(Boolean).join(" ") ||
      "Unknown";
    return { id: p.id, name };
  });
}

// ============================================================
// Binary upload (NEW — for bloodwork file upload)
// ============================================================

interface FhirBinary {
  resourceType: "Binary";
  id: string;
  contentType: string;
}

export async function uploadBinary(
  env: Env,
  data: ArrayBuffer,
  contentType: string,
): Promise<FhirBinary> {
  const token = await getMedplumToken(env);
  const res = await fetch(`${env.MEDPLUM_BASE_URL}/fhir/R4/Binary`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${token}`,
    },
    body: data,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Medplum Binary upload failed (${res.status}): ${err}`);
  }
  return (await res.json()) as FhirBinary;
}

// ============================================================
// DocumentReference (NEW — link Binary to Patient)
// ============================================================

interface FhirDocumentReference {
  resourceType: "DocumentReference";
  id: string;
  status: string;
}

export async function createDocumentReference(
  env: Env,
  params: {
    patientId: string;
    binaryId: string;
    contentType: string;
    description: string;
  },
): Promise<FhirDocumentReference> {
  return fhirCreate<FhirDocumentReference>(env, {
    resourceType: "DocumentReference",
    status: "current",
    subject: { reference: `Patient/${params.patientId}` },
    description: params.description,
    content: [
      {
        attachment: {
          contentType: params.contentType,
          url: `Binary/${params.binaryId}`,
        },
      },
    ],
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11502-2",
          display: "Laboratory report",
        },
      ],
    },
  });
}
