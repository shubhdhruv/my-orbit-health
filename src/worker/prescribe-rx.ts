// PrescribeRx API integration (replaces medplum.ts)
// Laravel Sanctum bearer-token auth, REST JSON API

import type { Env, ServiceId } from "../lib/types";

// ============================================================
// Types
// ============================================================

/** Standard PrescribeRx response envelope */
interface PrxResponse<T> {
  success: boolean;
  data: T;
  message: string;
  meta: {
    request_id: string;
    timestamp: string;
    pagination?: {
      current_page: number;
      per_page: number;
      total: number;
      last_page: number;
    };
  };
}

interface PrxPatient {
  user_id: string;
  patient_chart_id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface PrxUnifiedIntakeResult {
  encounter_id: string;
  encounter_number: string;
  patient_chart_id: string;
  patient_number: string;
  user_id: string;
  status: string;
  completeness_score: number;
  preclusions: string[];
  workflow: Record<string, boolean>;
}

interface PrxOrder {
  id: string;
  order_number: string;
  status: string;
  total: number;
}

interface PrxOrderDetail extends PrxOrder {
  order_lines: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
  }>;
  fulfillments: Array<{
    id: string;
    tracking_number: string;
    carrier: string;
    shipped_at: string;
    delivered_at: string | null;
  }>;
  transactions: Array<{
    id: string;
    amount: number;
    type: string;
    gateway_provider: string;
  }>;
}

interface PrxEncounter {
  id: string;
  encounter_number: string;
  status: string;
  encounter_type_id: string;
}

interface PrxTransaction {
  id: string;
  amount: number;
  type: string;
  gateway_provider: string;
  gateway_transaction_id: string;
}

interface PrxSubscription {
  id: string;
  status: string;
  billing_term: string;
  base_price: number;
}

interface PrxLabOrder {
  id: string;
  status: string;
  patient_chart_id: string;
}

export interface PrxHealthCheckResult {
  ok: boolean;
  api: boolean;
  authValid: boolean;
  encounterTypesLoaded: boolean;
  productCount: number;
  errors: string[];
  latencyMs: number;
}

// ============================================================
// Service → Encounter Type Mapping
// ============================================================

interface EncounterTypeMapping {
  encounterTypeId: string;
  encounterSlug: string;
  // Product IDs will be populated after catalog discovery in prod
  productIds?: string[];
  // Lab test IDs + collection method for services that require bloodwork kits.
  // Populated after catalog discovery in prod; when absent, createLabOrder is skipped.
  labTestIds?: string[];
  labCollectionMethod?: string;
}

/** Maps each MOH ServiceId to the PrescribeRx encounter type */
const SERVICE_ENCOUNTER_MAP: Record<string, EncounterTypeMapping> = {
  // GLP-1 (weight loss)
  semaglutide: {
    encounterTypeId: "019ce396-46a1-73ab-87d6-c40310555401",
    encounterSlug: "glp-1-screening",
  },
  tirzepatide: {
    encounterTypeId: "019ce396-46a1-73ab-87d6-c40310555401",
    encounterSlug: "glp-1-screening",
  },
  retatrutide: {
    encounterTypeId: "019ce396-46a1-73ab-87d6-c40310555401",
    encounterSlug: "glp-1-screening",
  },
  // ED
  sildenafil: {
    encounterTypeId: "019cf5ff-116d-737b-91e0-7304d67ecaf7",
    encounterSlug: "mens-sexual-health-ed-assessment",
  },
  tadalafil: {
    encounterTypeId: "019cf5ff-116d-737b-91e0-7304d67ecaf7",
    encounterSlug: "mens-sexual-health-ed-assessment",
  },
  // Male HRT
  "testosterone-injectable": {
    encounterTypeId: "019d000e-a554-721d-a727-08f65de4fd0b",
    encounterSlug: "male-trt-consult",
  },
  "testosterone-oral": {
    encounterTypeId: "019d000e-a554-721d-a727-08f65de4fd0b",
    encounterSlug: "male-trt-consult",
  },
  enclomiphene: {
    encounterTypeId: "019d000e-a554-721d-a727-08f65de4fd0b",
    encounterSlug: "male-trt-consult",
  },
  // Female HRT
  "estrogen-cream-vaginal": {
    encounterTypeId: "019d0461-7ee9-7092-be92-c7fa5ae73b19",
    encounterSlug: "female-hrt",
  },
  "estrogen-cream-systemic": {
    encounterTypeId: "019d0461-7ee9-7092-be92-c7fa5ae73b19",
    encounterSlug: "female-hrt",
  },
  "estrogen-patches": {
    encounterTypeId: "019d0461-7ee9-7092-be92-c7fa5ae73b19",
    encounterSlug: "female-hrt",
  },
  progesterone: {
    encounterTypeId: "019d0461-7ee9-7092-be92-c7fa5ae73b19",
    encounterSlug: "female-hrt",
  },
  // Peptides
  "mots-c": {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  nad: {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  "bpc-157": {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  "tb-500": {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  sermorelin: {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  "cjc-ipamorelin": {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  wolverine: {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  glo: {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  klow: {
    encounterTypeId: "019d2842-2d46-723f-bba5-a0a8d36fdc0b",
    encounterSlug: "peptide-assessment",
  },
  // Hair loss — no encounter type discovered yet; placeholder
  "hair-loss": {
    encounterTypeId: "",
    encounterSlug: "pending-hair-loss",
  },
  "hair-loss-women": {
    encounterTypeId: "",
    encounterSlug: "pending-hair-loss-women",
  },
};

export function getEncounterMapping(
  serviceId: ServiceId,
): EncounterTypeMapping | null {
  return SERVICE_ENCOUNTER_MAP[serviceId] ?? null;
}

// ============================================================
// Helpers
// ============================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected UUID, got "${value}"`);
  }
}

// ============================================================
// Generic API helper
// ============================================================

async function prxFetch<T>(
  env: Env,
  path: string,
  options: RequestInit = {},
): Promise<PrxResponse<T>> {
  if (!env.PRESCRIBE_RX_BASE_URL || !env.PRESCRIBE_RX_API_TOKEN) {
    throw new Error(
      "PrescribeRx not configured: missing PRESCRIBE_RX_BASE_URL or PRESCRIBE_RX_API_TOKEN",
    );
  }
  const base = env.PRESCRIBE_RX_BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/v1${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${env.PRESCRIBE_RX_API_TOKEN}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `PrescribeRx ${options.method ?? "GET"} ${path} failed (${res.status}): ${body}`,
    );
  }

  return (await res.json()) as PrxResponse<T>;
}

// ============================================================
// Patient
// ============================================================

export async function searchPatient(
  env: Env,
  email: string,
): Promise<PrxPatient | null> {
  const resp = await prxFetch<PrxPatient[]>(
    env,
    `/patients/search?email=${encodeURIComponent(email)}`,
  );
  return resp.data.length > 0 ? resp.data[0] : null;
}

export async function getPatient(
  env: Env,
  patientChartId: string,
): Promise<PrxPatient> {
  assertUuid(patientChartId, "patientChartId");
  const resp = await prxFetch<PrxPatient>(env, `/patients/${patientChartId}`);
  return resp.data;
}

// ============================================================
// Unified Intake (THE key endpoint — creates patient + encounter + answers in one call)
// ============================================================

export interface UnifiedIntakeInput {
  serviceId: ServiceId;
  patient: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  vitals?: {
    heightInches?: number;
    weightLbs?: number;
  };
  allergies?: string;
  medications?: string;
  conditions?: string;
  answers: Record<string, string | string[] | boolean>;
  productIds?: string[];
}

export async function submitUnifiedIntake(
  env: Env,
  input: UnifiedIntakeInput,
): Promise<PrxUnifiedIntakeResult> {
  const mapping = getEncounterMapping(input.serviceId);
  if (!mapping || !mapping.encounterTypeId) {
    throw new Error(
      `No PrescribeRx encounter type mapped for service: ${input.serviceId}`,
    );
  }

  const genderMap: Record<string, string> = {
    male: "male",
    female: "female",
    m: "male",
    f: "female",
    other: "other",
  };

  if (!env.PRESCRIBE_RX_CLIENT_ID) {
    throw new Error(
      "PrescribeRx not configured: missing PRESCRIBE_RX_CLIENT_ID",
    );
  }

  const body: Record<string, unknown> = {
    encounter_type_id: mapping.encounterTypeId,
    client_id: env.PRESCRIBE_RX_CLIENT_ID,
    patient: {
      first_name: input.patient.firstName,
      last_name: input.patient.lastName,
      email: input.patient.email,
      phone: input.patient.phone,
      date_of_birth: input.patient.dateOfBirth,
      gender: genderMap[input.patient.gender.toLowerCase()] ?? "unknown",
      address: {
        street: input.patient.address.street,
        city: input.patient.address.city,
        state: input.patient.address.state,
        zip: input.patient.address.zip,
      },
    },
    answers: input.answers,
  };

  if (input.vitals) {
    body.vitals = {
      height_inches: input.vitals.heightInches,
      weight_lbs: input.vitals.weightLbs,
    };
  }

  if (input.allergies || input.medications || input.conditions) {
    body.medical_history = {
      allergies: input.allergies ?? "",
      medications: input.medications ?? "",
      conditions: input.conditions ?? "",
    };
  }

  if (input.productIds?.length) {
    body.product_ids = input.productIds;
  }

  const resp = await prxFetch<PrxUnifiedIntakeResult>(
    env,
    "/telehealth/intake/unified",
    { method: "POST", body: JSON.stringify(body) },
  );

  return resp.data;
}

// ============================================================
// Orders
// ============================================================

export async function createOrder(
  env: Env,
  params: {
    patientChartId: string;
    lines: Array<{ productId: string; quantity: number }>;
  },
): Promise<PrxOrder> {
  if (!env.PRESCRIBE_RX_CLIENT_ID) {
    throw new Error(
      "PrescribeRx not configured: missing PRESCRIBE_RX_CLIENT_ID",
    );
  }
  const resp = await prxFetch<PrxOrder>(env, "/orders/patient", {
    method: "POST",
    body: JSON.stringify({
      client_id: env.PRESCRIBE_RX_CLIENT_ID,
      patient_chart_id: params.patientChartId,
      lines: params.lines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
      })),
    }),
  });
  return resp.data;
}

export async function getOrder(
  env: Env,
  orderId: string,
): Promise<PrxOrderDetail> {
  assertUuid(orderId, "orderId");
  const resp = await prxFetch<PrxOrderDetail>(
    env,
    `/orders/${orderId}?include=orderLines,fulfillments,transactions`,
  );
  return resp.data;
}

export async function batchOrderStatus(
  env: Env,
  orderIds: string[],
): Promise<Array<{ id: string; status: string }>> {
  const resp = await prxFetch<Array<{ id: string; status: string }>>(
    env,
    "/orders/batch-status",
    { method: "POST", body: JSON.stringify({ order_ids: orderIds }) },
  );
  return resp.data;
}

export async function cancelOrder(
  env: Env,
  orderId: string,
  reason: string,
): Promise<void> {
  assertUuid(orderId, "orderId");
  await prxFetch(env, `/orders/${orderId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ============================================================
// Transactions (report Stripe payment to PrescribeRx)
// ============================================================

export async function reportTransaction(
  env: Env,
  params: {
    encounterId: string;
    orderId?: string;
    amount: number; // cents
    stripePaymentIntentId: string;
  },
): Promise<PrxTransaction> {
  const resp = await prxFetch<PrxTransaction>(env, "/transactions/external", {
    method: "POST",
    body: JSON.stringify({
      encounter_id: params.encounterId,
      order_id: params.orderId,
      amount: params.amount,
      currency: "usd",
      type: "payment",
      gateway_provider: "stripe",
      gateway_transaction_id: params.stripePaymentIntentId,
      billed_on_domain: "myorbithealth.com",
    }),
  });
  return resp.data;
}

// ============================================================
// Subscriptions
// ============================================================

export async function createSubscription(
  env: Env,
  params: {
    patientChartId: string;
    productId: string;
    billingTerm: string; // "monthly", "quarterly", etc.
    basePrice: number;
    quantity?: number;
  },
): Promise<PrxSubscription> {
  const resp = await prxFetch<PrxSubscription>(env, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      patient_chart_id: params.patientChartId,
      product_identifier: params.productId,
      billing_term: params.billingTerm,
      base_price: params.basePrice,
      quantity: params.quantity ?? 1,
    }),
  });
  return resp.data;
}

export async function pauseSubscription(
  env: Env,
  subscriptionId: string,
): Promise<void> {
  assertUuid(subscriptionId, "subscriptionId");
  await prxFetch(env, `/subscriptions/${subscriptionId}/pause`, {
    method: "POST",
  });
}

export async function cancelSubscription(
  env: Env,
  subscriptionId: string,
): Promise<void> {
  assertUuid(subscriptionId, "subscriptionId");
  await prxFetch(env, `/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
  });
}

export async function resumeSubscription(
  env: Env,
  subscriptionId: string,
): Promise<void> {
  assertUuid(subscriptionId, "subscriptionId");
  await prxFetch(env, `/subscriptions/${subscriptionId}/resume`, {
    method: "POST",
  });
}

// ============================================================
// Lab Orders
// ============================================================

export async function createLabOrder(
  env: Env,
  params: {
    patientChartId: string;
    labTestIds: string[];
    collectionMethod: string;
    encounterId: string;
  },
): Promise<PrxLabOrder> {
  const resp = await prxFetch<PrxLabOrder>(env, "/telehealth/lab-orders", {
    method: "POST",
    body: JSON.stringify({
      patient_chart_id: params.patientChartId,
      lab_test_ids: params.labTestIds,
      collection_method: params.collectionMethod,
      encounter_id: params.encounterId,
    }),
  });
  return resp.data;
}

export async function uploadLabResults(
  env: Env,
  patientChartId: string,
  file: ArrayBuffer,
  filename: string,
  contentType: string,
): Promise<{ id: string }> {
  if (!env.PRESCRIBE_RX_BASE_URL || !env.PRESCRIBE_RX_API_TOKEN) {
    throw new Error(
      "PrescribeRx not configured: missing PRESCRIBE_RX_BASE_URL or PRESCRIBE_RX_API_TOKEN",
    );
  }
  assertUuid(patientChartId, "patientChartId");
  const formData = new FormData();
  formData.append("file", new Blob([file], { type: contentType }), filename);

  const base = env.PRESCRIBE_RX_BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/v1/patients/${patientChartId}/lab-results/upload`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PRESCRIBE_RX_API_TOKEN}`,
      Accept: "application/json",
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PrescribeRx lab upload failed (${res.status}): ${body}`);
  }

  const resp = (await res.json()) as PrxResponse<{ id: string }>;
  return resp.data;
}

// ============================================================
// Encounters
// ============================================================

export async function getEncounter(
  env: Env,
  encounterId: string,
): Promise<PrxEncounter> {
  assertUuid(encounterId, "encounterId");
  const resp = await prxFetch<PrxEncounter>(
    env,
    `/encounters/${encounterId}?include=patient,prescriptions,soapNotes`,
  );
  return resp.data;
}

export async function updateEncounterStatus(
  env: Env,
  encounterId: string,
  status: string,
): Promise<void> {
  assertUuid(encounterId, "encounterId");
  await prxFetch(env, `/encounters/${encounterId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

// ============================================================
// Documents (ID upload, etc.)
// ============================================================

export async function uploadDocument(
  env: Env,
  patientChartId: string,
  file: ArrayBuffer,
  filename: string,
  contentType: string,
): Promise<{ id: string }> {
  if (!env.PRESCRIBE_RX_BASE_URL || !env.PRESCRIBE_RX_API_TOKEN) {
    throw new Error(
      "PrescribeRx not configured: missing PRESCRIBE_RX_BASE_URL or PRESCRIBE_RX_API_TOKEN",
    );
  }
  assertUuid(patientChartId, "patientChartId");
  const formData = new FormData();
  formData.append("file", new Blob([file], { type: contentType }), filename);

  const base = env.PRESCRIBE_RX_BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/v1/patients/${patientChartId}/documents`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PRESCRIBE_RX_API_TOKEN}`,
      Accept: "application/json",
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `PrescribeRx document upload failed (${res.status}): ${body}`,
    );
  }

  const resp = (await res.json()) as PrxResponse<{ id: string }>;
  return resp.data;
}

// ============================================================
// Health Check (for /admin/prescribe-rx-healthcheck)
// ============================================================

export async function healthCheck(env: Env): Promise<PrxHealthCheckResult> {
  const start = Date.now();
  const errors: string[] = [];
  let apiOk = false;
  let authValid = false;
  let encounterTypesLoaded = false;
  let productCount = 0;

  // 0. Bail cleanly if secrets aren't configured yet
  if (!env.PRESCRIBE_RX_BASE_URL || !env.PRESCRIBE_RX_API_TOKEN) {
    return {
      ok: false,
      api: false,
      authValid: false,
      encounterTypesLoaded: false,
      productCount: 0,
      errors: [
        "PrescribeRx not configured: missing PRESCRIBE_RX_BASE_URL or PRESCRIBE_RX_API_TOKEN",
      ],
      latencyMs: Date.now() - start,
    };
  }

  // 1. Auth check — hit /auth/me to validate token
  try {
    const resp = await prxFetch<{ user_type: number }>(env, "/auth/me");
    authValid = resp.success;
    apiOk = true;
  } catch (e) {
    errors.push(`Auth: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Encounter types check
  try {
    const resp = await prxFetch<Array<{ id: string; slug: string }>>(
      env,
      "/telehealth/encounter-types",
    );
    encounterTypesLoaded = resp.data.length > 0;
    if (!encounterTypesLoaded) {
      errors.push("No encounter types found");
    }
  } catch (e) {
    errors.push(
      `Encounter types: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Product catalog check
  try {
    const resp = await prxFetch<Array<{ id: string }>>(
      env,
      "/products?per_page=1",
    );
    productCount = resp.meta.pagination?.total ?? resp.data.length;
  } catch (e) {
    errors.push(`Products: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: apiOk && authValid && encounterTypesLoaded && errors.length === 0,
    api: apiOk,
    authValid,
    encounterTypesLoaded,
    productCount,
    errors,
    latencyMs: Date.now() - start,
  };
}
