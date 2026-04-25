// $49.99 paid consultation flow.
//
// Standalone — does NOT go through the normal /form intake → PendingCase →
// doctor-portal pipeline. A consult is a paid lead, not a prescription, so
// it lives outside the services.ts / pharmacy-costs / dosing architecture.
//
// Surfaces:
//   GET  /consult/:slug                — embedded HTML form (iframed by partner site)
//   POST /consult/:slug                — creates Stripe Checkout Session, returns { url }
//   GET  /consult/:slug/success        — branded thank-you (Stripe redirects here after pay)
//   GET  /consult/:slug/cancel         — back to the form (Stripe redirects here on cancel)
//
// Webhook side (in worker/webhooks.ts): on checkout.session.completed where
// metadata.type === "consultation", we mark the KV record paid and email
// the partner's consult recipients (see CONSULT_RECIPIENTS below).
//
// Money goes to MOH's platform Stripe (not partner-connected). Partner gets
// paid out separately. Switch to direct mode later if needed.

import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import { createStripeClient } from "./stripe";
import { sendEmail } from "./email";

const consult = new Hono<{ Bindings: Env }>();

// Partner-slug → recipients for the post-pay notification email. Mirrors
// the pattern in partner-forms.ts (kept out of PartnerConfig because that's
// partner-editable; this is internal routing).
export const CONSULT_RECIPIENTS: Record<string, string[]> = {
  "kingdom-longevity-labs": [
    "zack@kingdomlongevitylabs.com",
    "kat@kingdomlongevitylabs.com",
  ],
};

const CONSULT_PRICE_CENTS = 4999; // $49.99
const CONSULT_PRODUCT_NAME = "Health Consultation";

interface CreateConsultPayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  symptoms?: string;
  topics?: string[];
  heard_about?: string;
  website?: string; // honeypot
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain-text option list. Keep IDs stable — they're stored on the case.
const TOPIC_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "weight-loss", label: "GLP-1 / weight loss medications" },
  { id: "trt", label: "Testosterone replacement / men's hormones" },
  { id: "estrogen", label: "Estrogen / women's hormones" },
  { id: "ed", label: "Erectile dysfunction (ED)" },
  { id: "peptides", label: "Peptides (BPC-157, NAD+, etc.)" },
  {
    id: "gh-peptides",
    label: "Growth hormone peptides (Sermorelin, CJC-Ipamorelin)",
  },
  { id: "hair-loss", label: "Hair loss" },
  { id: "longevity", label: "Sleep, energy, general longevity" },
  { id: "not-sure", label: "Not sure yet — want to explore options" },
];

// ─── GET /consult/:slug — embed form ──────────────────────────

consult.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) {
    return c.html(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Not found</h1><p>This consultation form isn't configured for this partner.</p></body>`,
      404,
    );
  }
  if (!CONSULT_RECIPIENTS[slug]) {
    return c.html(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Not configured</h1><p>This partner does not have consultation routing set up.</p></body>`,
      400,
    );
  }

  const url = new URL(c.req.url);
  const firstName = url.searchParams.get("first_name") || "";
  const lastName = url.searchParams.get("last_name") || "";
  const email = url.searchParams.get("email") || "";
  const phone = url.searchParams.get("phone") || "";

  const primary = partner.brandColors?.primary || "#0B1F3A";
  const businessName = partner.businessName || slug;

  const topicsHtml = TOPIC_OPTIONS.map(
    (t) => `
      <label class="check-row">
        <input type="checkbox" name="topics" value="${escapeHtml(t.id)}" />
        <span>${escapeHtml(t.label)}</span>
      </label>`,
  ).join("");

  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Book Your Consultation — ${escapeHtml(businessName)}</title>
<style>
  :root { --primary: ${primary}; --gold: #C9A96E; --body: #2a2a2a; --muted: #6B7280; --border: #e5e7eb; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--body); background: transparent; line-height: 1.55; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 8px 4px 24px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 6px; color: var(--primary); }
  .sub { color: var(--muted); font-size: 14px; margin: 0 0 20px; }
  .field { margin-bottom: 16px; }
  label.lbl { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--primary); }
  input[type=text], input[type=email], input[type=tel], textarea {
    width: 100%; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px;
    font-size: 15px; font-family: inherit; color: var(--body); background: #fff;
  }
  textarea { min-height: 88px; resize: vertical; }
  input:focus, textarea:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(201,169,110,0.18); }
  .check-grid { display: grid; gap: 8px; }
  .check-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; font-size: 14px; background: #fff; }
  .check-row:hover { border-color: var(--gold); }
  .check-row input { margin-top: 3px; }
  .check-row input:checked ~ span { font-weight: 600; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 480px) { .row { grid-template-columns: 1fr; } }
  .price-card { background: rgba(201,169,110,0.10); border: 1px solid rgba(201,169,110,0.35); border-radius: 12px; padding: 14px 16px; margin: 8px 0 18px; }
  .price-card .amt { font-size: 22px; font-weight: 700; color: var(--primary); }
  .price-card .desc { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .pay-btn { width: 100%; padding: 14px 18px; background: var(--primary); color: #fff; border: 0; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; letter-spacing: 0.01em; }
  .pay-btn:hover { opacity: 0.92; }
  .pay-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .legal { font-size: 11px; color: var(--muted); margin-top: 12px; text-align: center; line-height: 1.5; }
  .err { color: #b00020; font-size: 13px; margin-top: 8px; min-height: 18px; }
  .hp { position: absolute; left: -9999px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Tell us about you</h1>
    <p class="sub">A few quick details so your clinician can prepare for the call.</p>

    <form id="consultForm" novalidate>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" />

      <div class="row">
        <div class="field">
          <label class="lbl" for="first_name">First name</label>
          <input type="text" id="first_name" name="first_name" required value="${escapeHtml(firstName)}" />
        </div>
        <div class="field">
          <label class="lbl" for="last_name">Last name</label>
          <input type="text" id="last_name" name="last_name" required value="${escapeHtml(lastName)}" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label class="lbl" for="email">Email</label>
          <input type="email" id="email" name="email" required value="${escapeHtml(email)}" />
        </div>
        <div class="field">
          <label class="lbl" for="phone">Phone</label>
          <input type="tel" id="phone" name="phone" required value="${escapeHtml(phone)}" />
        </div>
      </div>

      <div class="field">
        <label class="lbl" for="symptoms">What symptoms or health concerns are you experiencing?</label>
        <textarea id="symptoms" name="symptoms" required placeholder="e.g. low energy, weight gain, low libido, joint pain..."></textarea>
      </div>

      <div class="field">
        <label class="lbl">What treatments are you interested in exploring?</label>
        <div class="check-grid">
          ${topicsHtml}
        </div>
      </div>

      <div class="field">
        <label class="lbl" for="heard_about">Anything specific you've heard about and want to discuss? <span style="color:var(--muted);font-weight:400">(optional)</span></label>
        <textarea id="heard_about" name="heard_about" placeholder="e.g. semaglutide, NAD+, peptides, testosterone..."></textarea>
      </div>

      <div class="price-card">
        <div class="amt">$49.99</div>
        <div class="desc">One-time consultation fee. Does not apply toward treatment and does not include a follow-up.</div>
      </div>

      <button type="submit" class="pay-btn" id="payBtn">Pay & Book Consultation →</button>
      <div class="err" id="errMsg"></div>
      <p class="legal">Payments are processed securely by Stripe. By continuing, you agree to be contacted by ${escapeHtml(businessName)} to schedule your consultation.</p>
    </form>
  </div>

<script>
(function(){
  var form = document.getElementById('consultForm');
  var btn = document.getElementById('payBtn');
  var err = document.getElementById('errMsg');

  form.addEventListener('submit', function(e){
    e.preventDefault();
    err.textContent = '';

    var fd = new FormData(form);
    var topics = fd.getAll('topics').map(String);

    var payload = {
      first_name: (fd.get('first_name')||'').toString().trim(),
      last_name: (fd.get('last_name')||'').toString().trim(),
      email: (fd.get('email')||'').toString().trim(),
      phone: (fd.get('phone')||'').toString().trim(),
      symptoms: (fd.get('symptoms')||'').toString().trim(),
      topics: topics,
      heard_about: (fd.get('heard_about')||'').toString().trim(),
      website: (fd.get('website')||'').toString()
    };

    if(!payload.first_name || !payload.last_name || !payload.email || !payload.phone || !payload.symptoms){
      err.textContent = 'Please fill in your name, contact info, and symptoms.';
      return;
    }

    btn.disabled = true; btn.textContent = 'Redirecting to checkout...';

    fetch(window.location.pathname, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, body:j}; }); })
      .then(function(res){
        if(!res.ok || !res.body || !res.body.url){
          err.textContent = (res.body && res.body.error) || 'Something went wrong. Please try again.';
          btn.disabled = false; btn.textContent = 'Pay & Book Consultation →';
          return;
        }
        // Escape iframe to load Stripe Checkout at the top level.
        try { window.top.location.href = res.body.url; }
        catch(_) { window.location.href = res.body.url; }
      })
      .catch(function(){
        err.textContent = 'Network error. Please try again.';
        btn.disabled = false; btn.textContent = 'Pay & Book Consultation →';
      });
  });
})();
</script>
</body>
</html>`);
});

// ─── POST /consult/:slug — create Stripe Checkout Session ────

consult.post("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) {
    return c.json({ error: "UNKNOWN_PARTNER" }, 404);
  }
  if (!CONSULT_RECIPIENTS[slug]) {
    return c.json({ error: "PARTNER_NOT_CONFIGURED" }, 400);
  }

  let payload: CreateConsultPayload;
  try {
    payload = (await c.req.json()) as CreateConsultPayload;
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400);
  }

  // Honeypot — silent success
  if (payload.website && payload.website.trim() !== "") {
    return c.json({
      url: `https://${new URL(c.req.url).host}/consult/${slug}/cancel`,
    });
  }

  const firstName = (payload.first_name || "").trim();
  const lastName = (payload.last_name || "").trim();
  const email = (payload.email || "").trim();
  const phone = (payload.phone || "").trim();
  const symptoms = (payload.symptoms || "").trim();
  const heardAbout = (payload.heard_about || "").trim();
  const topics = Array.isArray(payload.topics)
    ? payload.topics.filter((t) => typeof t === "string").map(String)
    : [];

  if (!firstName || !lastName) return c.json({ error: "MISSING_NAME" }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "INVALID_EMAIL" }, 400);
  if (!phone) return c.json({ error: "MISSING_PHONE" }, 400);
  if (!symptoms) return c.json({ error: "MISSING_SYMPTOMS" }, 400);

  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
  const origin = `https://${new URL(c.req.url).host}`;

  // Truncate to stay under Stripe's 500-char metadata value limit.
  const trim500 = (s: string) => (s.length > 480 ? s.slice(0, 480) + "…" : s);

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: CONSULT_PRICE_CENTS,
            product_data: {
              name: `${CONSULT_PRODUCT_NAME} — ${partner.businessName}`,
              description:
                "One-on-one consultation with a licensed clinician. Does not include treatment or follow-up.",
            },
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: `${origin}/consult/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/consult/${slug}/cancel`,
      metadata: {
        type: "consultation",
        partner_slug: slug,
        partner_name: partner.businessName,
        first_name: trim500(firstName),
        last_name: trim500(lastName),
        email: trim500(email),
        phone: trim500(phone),
        symptoms: trim500(symptoms),
        topics: trim500(topics.join(",")),
        heard_about: trim500(heardAbout),
      },
    });
  } catch (err: any) {
    console.error("consult: stripe checkout session create failed:", err);
    return c.json(
      { error: "CHECKOUT_FAILED", detail: err?.message || "stripe error" },
      500,
    );
  }

  // Persist FIRST so submission isn't lost even if email/webhook fails.
  const kvKey = `consult:${slug}:${session.id}`;
  await c.env.PARTNERS.put(
    kvKey,
    JSON.stringify({
      slug,
      sessionId: session.id,
      receivedAt: new Date().toISOString(),
      firstName,
      lastName,
      email,
      phone,
      symptoms,
      topics,
      heardAbout,
      paid: false,
      emailedAt: null,
    }),
    // 60 days — plenty of time for follow-up + audit; KV won't bloat.
    { expirationTtl: 60 * 60 * 24 * 60 },
  );

  return c.json({ url: session.url });
});

// ─── GET /consult/:slug/success — branded thank-you page ─────

consult.get("/:slug/success", async (c) => {
  const slug = c.req.param("slug");
  const sessionId = c.req.query("session_id") || "";
  const partner = await getPartner(c.env.PARTNERS, slug);
  const businessName = partner?.businessName || slug;
  const primary = partner?.brandColors?.primary || "#0B1F3A";

  // Best-effort: confirm the session is paid AND fire the partner notification
  // email here as a backup to the Stripe webhook (so Zack/Kat get notified
  // even if `checkout.session.completed` isn't enabled on the webhook). The
  // KV record's emailedAt flag is the idempotency key — webhook OR success
  // page wins, never both.
  let paid = false;
  if (sessionId) {
    try {
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paid = session.payment_status === "paid";

      if (paid) {
        const recipients = CONSULT_RECIPIENTS[slug];
        const kvKey = `consult:${slug}:${sessionId}`;
        const raw = await c.env.PARTNERS.get(kvKey);
        const record = raw ? JSON.parse(raw) : null;
        if (record && !record.emailedAt && recipients?.length) {
          const fullName =
            `${record.firstName || ""} ${record.lastName || ""}`.trim();
          const topicsList: string[] = Array.isArray(record.topics)
            ? record.topics
            : [];
          const topicsHtml = topicsList.length
            ? topicsList
                .map((t: string) => `<div>• ${escapeHtml(t)}</div>`)
                .join("")
            : "<em>(none selected)</em>";
          const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;line-height:1.55;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#10b981;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block;margin-bottom:14px">PAID — $49.99</div>
  <h2 style="color:#0B1F3A;margin:0 0 6px">New consultation booking</h2>
  <p style="color:#6B7280;font-size:13px;margin:0 0 24px">Submitted via the consultation form on ${escapeHtml(businessName)}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#6B7280;width:160px;vertical-align:top">Name</td><td style="padding:6px 0;font-weight:600">${escapeHtml(fullName) || "<em>(unknown)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Email</td><td style="padding:6px 0">${escapeHtml(record.email || "")}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Phone</td><td style="padding:6px 0">${escapeHtml(record.phone || "")}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Symptoms / concerns</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(record.symptoms || "") || "<em>(none)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Topics to explore</td><td style="padding:6px 0">${topicsHtml}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Heard about / wants to discuss</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(record.heardAbout || "") || "<em>(none)</em>"}</td></tr>
  </table>
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#6B7280;font-size:12px;margin:0">Stripe session: ${escapeHtml(sessionId)}</p>
  <p style="color:#1f2937;font-size:14px;margin:18px 0 0"><strong>Next step:</strong> reach out to ${escapeHtml(fullName) || "the patient"} within 24 hours to schedule.</p>
</body></html>`;
          try {
            await sendEmail(c.env.RESEND_API_KEY, {
              to: recipients.join(","),
              subject: `Paid consultation booking: ${fullName || record.email}`,
              html,
              replyTo: record.email || undefined,
            });
            record.paid = true;
            record.emailedAt = new Date().toISOString();
            await c.env.PARTNERS.put(kvKey, JSON.stringify(record), {
              expirationTtl: 60 * 60 * 24 * 60,
            });
          } catch (mailErr) {
            console.error(
              `consult success: email send failed for ${kvKey}:`,
              mailErr,
            );
          }
        }
      }
    } catch (err) {
      console.error("consult success: session retrieve failed:", err);
    }
  }

  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Consultation Booked — ${escapeHtml(businessName)}</title>
<style>
  :root { --primary: ${primary}; --gold: #C9A96E; --muted: #6B7280; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #2a2a2a; background: #faf7f2; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border-radius: 18px; padding: 40px 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 6px 28px rgba(0,0,0,0.08); }
  .check { width: 64px; height: 64px; border-radius: 50%; background: rgba(201,169,110,0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; font-size: 32px; color: var(--gold); }
  h1 { font-size: 24px; color: var(--primary); margin: 0 0 8px; }
  p { color: var(--muted); line-height: 1.6; margin: 8px 0; font-size: 15px; }
  .next { background: rgba(201,169,110,0.1); border: 1px solid rgba(201,169,110,0.3); border-radius: 12px; padding: 14px 16px; margin: 22px 0; text-align: left; font-size: 14px; color: #2a2a2a; }
  .next strong { color: var(--primary); }
  a.home { display: inline-block; margin-top: 14px; color: var(--primary); font-size: 14px; text-decoration: underline; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>${paid ? "You're booked!" : "Thanks for your submission"}</h1>
    <p>Your $49.99 consultation with <strong>${escapeHtml(businessName)}</strong> ${paid ? "has been confirmed." : "is being processed."}</p>
    <div class="next">
      <strong>What happens next:</strong>
      <p style="margin:6px 0 0;color:#2a2a2a">A clinician from ${escapeHtml(businessName)} will reach out within 24 hours to schedule your call. Watch your email and phone.</p>
    </div>
    ${partner?.websiteUrl ? `<a class="home" href="${escapeHtml(partner.websiteUrl)}">Return to ${escapeHtml(businessName)}</a>` : ""}
  </div>
</body>
</html>`);
});

// ─── GET /consult/:slug/cancel — back to form ────────────────

consult.get("/:slug/cancel", async (c) => {
  const slug = c.req.param("slug");
  return c.redirect(`/consult/${slug}`, 302);
});

export default consult;
