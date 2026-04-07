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
