// Bloodwork file storage in Cloudflare R2.
//
// Replaces Medplum Binary for NEW uploads. Old files already in Medplum
// Binary stay there — consumers should prefer `bloodworkR2Key` but fall
// back to `bloodworkBinaryId` for legacy cases.
//
// Key format: `bloodwork/YYYY/MM/{uuid}.{ext}`
// httpMetadata.contentType is preserved so readers get the right MIME
// type back without storing it on the PendingCase.

import type { Env } from "../lib/types";

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

function extFromContentType(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || "bin";
}

export async function putBloodworkObject(
  env: Env,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ key: string }> {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const ext = extFromContentType(contentType);
  const key = `bloodwork/${yyyy}/${mm}/${uuid}.${ext}`;

  await env.BLOODWORK_R2.put(key, body, {
    httpMetadata: { contentType },
  });

  return { key };
}

// Read helper for downstream consumers (patient portal preview,
// future PRX webhook upload path, lab-vendor integration).
// Returns null when the key doesn't exist so callers can fall back
// to legacy Medplum Binary reads.
export async function getBloodworkObject(
  env: Env,
  key: string,
): Promise<R2ObjectBody | null> {
  return env.BLOODWORK_R2.get(key);
}
