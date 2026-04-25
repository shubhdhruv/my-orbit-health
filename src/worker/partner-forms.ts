import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import { sendEmail } from "./email";

// Partner-public form endpoints. These are called from the public-facing
// partner sites (e.g. kingdomlongevitylabs.com) by unauthenticated visitors,
// so each route validates the partner slug + honeypots + required fields,
// and persists to KV before sending email so submissions are never lost.
//
// CORS is handled by the wide-open CORS middleware in worker/index.ts.

const partnerForms = new Hono<{ Bindings: Env }>();

// Notification recipients per partner. Keeps the routing decision out of
// PartnerConfig (which is bigger and partner-editable). Add a new key here
// when onboarding another partner that wants product-request emails.
const PRODUCT_REQUEST_RECIPIENTS: Record<string, string[]> = {
  "kingdom-longevity-labs": [
    "zack@kingdomlongevitylabs.com",
    "kat@kingdomlongevitylabs.com",
  ],
};

interface ProductRequestPayload {
  product_name?: string;
  short_description?: string;
  pages?: string[];
  category_group?: string;
  recommended_for?: string;
  details?: string;
  requester_name?: string;
  requester_email?: string;
  website?: string; // honeypot — must be empty
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

partnerForms.post("/:slug/product-request", async (c) => {
  const slug = c.req.param("slug");

  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) {
    return c.json({ success: false, error: "UNKNOWN_PARTNER" }, 404);
  }

  const recipients = PRODUCT_REQUEST_RECIPIENTS[slug];
  if (!recipients || recipients.length === 0) {
    return c.json(
      { success: false, error: "PARTNER_NOT_CONFIGURED" },
      400,
    );
  }

  let payload: ProductRequestPayload;
  try {
    payload = (await c.req.json()) as ProductRequestPayload;
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  // Honeypot: silently 200 so bots think they succeeded but no email is sent.
  if (payload.website && payload.website.trim() !== "") {
    return c.json({ success: true });
  }

  const productName = (payload.product_name || "").trim();
  const shortDesc = (payload.short_description || "").trim();

  if (!productName) {
    return c.json({ success: false, error: "MISSING_PRODUCT_NAME" }, 400);
  }
  if (!shortDesc) {
    return c.json({ success: false, error: "MISSING_DESCRIPTION" }, 400);
  }

  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const categoryGroup = (payload.category_group || "").trim();
  const recommendedFor = (payload.recommended_for || "").trim();
  const details = (payload.details || "").trim();
  const requesterName = (payload.requester_name || "").trim();
  const requesterEmail = (payload.requester_email || "").trim();

  const timestamp = new Date().toISOString();

  // Persist FIRST so data is never lost even if email send fails.
  const kvKey = `product_request:${slug}:${timestamp}`;
  await c.env.PARTNERS.put(
    kvKey,
    JSON.stringify({
      slug,
      receivedAt: timestamp,
      productName,
      shortDescription: shortDesc,
      pages,
      categoryGroup,
      recommendedFor,
      details,
      requesterName,
      requesterEmail,
    }),
  );

  const subject = `New product request: ${productName}`;
  const pagesHtml = pages.length
    ? pages
        .map(escapeHtml)
        .map((p) => `<div>• ${p}</div>`)
        .join("")
    : "<em>(none specified)</em>";

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;line-height:1.55;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#0B1F3A;margin:0 0 16px">New product request</h2>
  <p style="color:#6B7280;font-size:13px;margin:0 0 24px">Submitted via the product-request form on ${escapeHtml(partner.businessName)}.</p>

  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#6B7280;width:160px;vertical-align:top">Product name</td><td style="padding:6px 0;font-weight:600">${escapeHtml(productName)}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Pages to add to</td><td style="padding:6px 0">${pagesHtml}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Category group</td><td style="padding:6px 0">${escapeHtml(categoryGroup) || "<em>(not specified)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Short description</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(shortDesc)}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Recommended for</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(recommendedFor) || "<em>(not specified)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Additional details</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(details) || "<em>(none)</em>"}</td></tr>
  </table>

  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">

  <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6B7280">
    <tr><td style="padding:4px 0;width:160px">Requested by</td><td style="padding:4px 0">${escapeHtml(requesterName) || "<em>(anonymous)</em>"}</td></tr>
    <tr><td style="padding:4px 0">Contact</td><td style="padding:4px 0">${escapeHtml(requesterEmail) || "<em>(none)</em>"}</td></tr>
    <tr><td style="padding:4px 0">Received</td><td style="padding:4px 0">${escapeHtml(timestamp)}</td></tr>
  </table>
</body></html>`;

  // Email is best-effort: KV write already succeeded so the request is
  // preserved in storage even if Resend hiccups.
  let emailSent = false;
  try {
    await sendEmail(
      c.env.RESEND_API_KEY,
      {
        to: recipients,
        subject,
        html,
        replyTo: requesterEmail || undefined,
      },
    );
    emailSent = true;
  } catch (err) {
    console.error("product-request email send failed:", err);
  }

  return c.json({ success: true, emailSent });
});

export default partnerForms;
