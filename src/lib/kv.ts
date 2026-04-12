import { PartnerConfig, PendingCase } from "./types";

export async function getPartner(
  kv: KVNamespace,
  slug: string
): Promise<PartnerConfig | null> {
  const data = await kv.get(slug, "json");
  return data as PartnerConfig | null;
}

export async function savePartner(
  kv: KVNamespace,
  partner: PartnerConfig
): Promise<void> {
  await kv.put(partner.slug, JSON.stringify(partner));
}

export async function listPartners(
  kv: KVNamespace
): Promise<string[]> {
  const list = await kv.list();
  return list.keys.map((k) => k.name);
}

// ─── Pending Case helpers ────────────────────────────────────

export async function savePendingCase(
  kv: KVNamespace,
  pendingCase: PendingCase
): Promise<void> {
  await kv.put(`case:${pendingCase.paymentIntentId}`, JSON.stringify(pendingCase));
}

export async function getPendingCase(
  kv: KVNamespace,
  paymentIntentId: string
): Promise<PendingCase | null> {
  const data = await kv.get(`case:${paymentIntentId}`, "json");
  return data as PendingCase | null;
}

export async function listPendingCases(
  kv: KVNamespace
): Promise<PendingCase[]> {
  const list = await kv.list({ prefix: "case:" });
  const cases: PendingCase[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, "json") as PendingCase | null;
    if (data && data.status === "pending") {
      cases.push(data);
    }
  }
  cases.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return cases;
}

export async function listAllCases(
  kv: KVNamespace
): Promise<PendingCase[]> {
  const list = await kv.list({ prefix: "case:" });
  const cases: PendingCase[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, "json") as PendingCase | null;
    if (data) cases.push(data);
  }
  cases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return cases;
}

// ─── Portal: Host → Partner lookup ────────────────────────────
//
// Patient portal uses Host-based tenant routing. Each partner can set a
// `portalDomain` (e.g. "portal.kingdomlongevitylabs.com") that CNAMEs to
// this Worker. We maintain a reverse index so the lookup is O(1) per
// request instead of scanning every partner in KV.
//
// Index key format: `portal_host:${domain}` → `${partnerSlug}`

export async function savePortalDomainIndex(
  kv: KVNamespace,
  domain: string,
  partnerSlug: string,
): Promise<void> {
  await kv.put(`portal_host:${domain.toLowerCase()}`, partnerSlug);
}

export async function deletePortalDomainIndex(
  kv: KVNamespace,
  domain: string,
): Promise<void> {
  await kv.delete(`portal_host:${domain.toLowerCase()}`);
}

export async function getPartnerSlugByDomain(
  kv: KVNamespace,
  domain: string,
): Promise<string | null> {
  return kv.get(`portal_host:${domain.toLowerCase()}`);
}

export async function getPartnerByHost(
  kv: KVNamespace,
  host: string,
): Promise<PartnerConfig | null> {
  // Strip port if any
  const hostname = host.split(":")[0].toLowerCase();
  const slug = await getPartnerSlugByDomain(kv, hostname);
  if (!slug) return null;
  return getPartner(kv, slug);
}

// ─── Portal: Patient → Cases index ────────────────────────────
//
// KV is keyed by paymentIntentId, so "list all cases for patient X" would
// require scanning every case. Instead we maintain a per-patient index
// updated on case creation.
//
// Index key format: `patient_cases:${medplumPatientId}` → `string[]` (paymentIntentIds)

export async function addCaseToPatientIndex(
  kv: KVNamespace,
  medplumPatientId: string,
  paymentIntentId: string,
): Promise<void> {
  const key = `patient_cases:${medplumPatientId}`;
  const existing = (await kv.get(key, "json")) as string[] | null;
  const list = existing || [];
  if (!list.includes(paymentIntentId)) {
    list.push(paymentIntentId);
    await kv.put(key, JSON.stringify(list));
  }
}

export async function getPatientCaseIds(
  kv: KVNamespace,
  medplumPatientId: string,
): Promise<string[]> {
  const data = (await kv.get(`patient_cases:${medplumPatientId}`, "json")) as string[] | null;
  return data || [];
}

export async function getPatientCases(
  kv: KVNamespace,
  medplumPatientId: string,
): Promise<PendingCase[]> {
  const ids = await getPatientCaseIds(kv, medplumPatientId);
  const cases: PendingCase[] = [];
  for (const id of ids) {
    const c = await getPendingCase(kv, id);
    if (c) cases.push(c);
  }
  cases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return cases;
}

// ─── Portal: Email → Patient lookup (tenant-scoped) ───────────
//
// On login, patient enters email. We look up their Medplum Patient ID
// scoped to the current tenant (partnerSlug) so a patient who exists on
// multiple brands keeps separate sessions per brand.
//
// Index key format: `patient_email:${partnerSlug}:${lowercased-email}` → `${medplumPatientId}`

export async function savePatientEmailIndex(
  kv: KVNamespace,
  partnerSlug: string,
  email: string,
  medplumPatientId: string,
): Promise<void> {
  await kv.put(
    `patient_email:${partnerSlug}:${email.toLowerCase()}`,
    medplumPatientId,
  );
}

export async function getPatientIdByEmail(
  kv: KVNamespace,
  partnerSlug: string,
  email: string,
): Promise<string | null> {
  return kv.get(`patient_email:${partnerSlug}:${email.toLowerCase()}`);
}

// ─── Portal: Magic link tokens ────────────────────────────────
//
// Magic link = opaque random token stored in KV with 15-min TTL.
// Single-use: consumed (deleted) when redeemed.
//
// Index key format: `magic:${token}` → `{ medplumPatientId, partnerSlug, createdAt }`

export interface MagicLinkPayload {
  medplumPatientId: string;
  partnerSlug: string;
  createdAt: string;
}

export async function saveMagicToken(
  kv: KVNamespace,
  token: string,
  payload: MagicLinkPayload,
  ttlSeconds = 15 * 60,
): Promise<void> {
  await kv.put(`magic:${token}`, JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });
}

export async function consumeMagicToken(
  kv: KVNamespace,
  token: string,
): Promise<MagicLinkPayload | null> {
  const data = (await kv.get(`magic:${token}`, "json")) as MagicLinkPayload | null;
  if (!data) return null;
  // Delete to ensure single-use
  await kv.delete(`magic:${token}`);
  return data;
}

// Peek at a magic token without consuming it. Used so the caller can
// validate tenant boundaries before burning the token on the wrong brand.
export async function peekMagicToken(
  kv: KVNamespace,
  token: string,
): Promise<MagicLinkPayload | null> {
  return (await kv.get(`magic:${token}`, "json")) as MagicLinkPayload | null;
}

export async function deleteMagicToken(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(`magic:${token}`);
}
