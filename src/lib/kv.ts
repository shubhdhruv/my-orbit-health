import { PartnerConfig } from "./types";

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
