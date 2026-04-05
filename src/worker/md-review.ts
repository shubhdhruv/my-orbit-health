import { Hono } from "hono";
import { Env } from "../lib/types";

const mdReview = new Hono<{ Bindings: Env }>();

const KV_KEY = "md_review_v3";

// Simple password gate — Shubh uses admin password
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

mdReview.use("*", async (c, next) => {
  const path = c.req.path;
  if (path.endsWith("/login") || path.endsWith("/auth")) return next();

  const sessionCookie = c.req.header("Cookie")?.match(/md_session=([^;]+)/)?.[1];
  if (!sessionCookie) return c.redirect("/md-review/login");

  const today = new Date().toISOString().split("T")[0];
  const expected = await hashPassword(c.env.ADMIN_PASSWORD_HASH + "md" + today);
  if (sessionCookie !== expected) return c.redirect("/md-review/login");

  return next();
});

// Login
mdReview.get("/login", (c) => {
  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MD Protocol Review — My Orbit Health</title>
<style>${CSS}</style></head><body>
<div class="container" style="max-width:400px;margin-top:80px">
<h1>MD Protocol Review</h1>
<p>Enter your admin password to access the dosing protocol sign-off form.</p>
<form method="POST" action="/md-review/auth">
<input type="password" name="password" placeholder="Password" required style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px;margin:12px 0">
<button type="submit" class="btn">Sign In</button>
</form></div></body></html>`);
});

mdReview.post("/auth", async (c) => {
  const body = await c.req.parseBody();
  const password = body["password"] as string;
  const hash = await hashPassword(password);

  if (hash !== c.env.ADMIN_PASSWORD_HASH) {
    return c.html(`<script>alert('Wrong password');window.location='/md-review/login'</script>`);
  }

  const today = new Date().toISOString().split("T")[0];
  const session = await hashPassword(c.env.ADMIN_PASSWORD_HASH + "md" + today);
  return new Response("", {
    status: 302,
    headers: {
      Location: "/md-review",
      "Set-Cookie": `md_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    },
  });
});

// Main review form
mdReview.get("/", async (c) => {
  const existing = await c.env.PARTNERS.get(KV_KEY);
  const saved = existing ? JSON.parse(existing) : null;

  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MD Protocol Sign-Off — My Orbit Health</title>
<style>${CSS}</style></head><body>
<div class="container">
<h1>Dosing Protocol Sign-Off</h1>
<p class="subtitle">Review each protocol and approve. Fill in any pending dose confirmations. Your responses are saved automatically and Bryan will be notified.</p>

${saved ? `<div class="saved-banner">Last saved: ${saved.submitted_at || "unknown"}</div>` : ""}

<form method="POST" action="/md-review/submit" id="reviewForm">

<!-- ═══════════════════════════════════════════════ -->
<h2>Section 1: Signature Only — No Open Questions</h2>
<p>These protocols are fully written. Review and check to approve.</p>

${signoffService("semaglutide", "Semaglutide", "0.25→2.4mg weekly SC. Gallbladder workflow. Dose reduction protocol.", saved)}
${signoffService("tirzepatide", "Tirzepatide", "2.5→15mg weekly SC. 10mg pause: &lt;0.5 lbs/wk x4wks = escalate. Provider task required at 10mg gate.", saved)}
${signoffService("sildenafil", "Sildenafil", "50mg PRN start. Renal &lt;30: 25mg max. Hepatic any: 25mg max. Age ≥65: 25mg start.", saved)}
${signoffService("tadalafil", "Tadalafil", "PRN 10→20mg. Daily 2.5→5mg. CrCl &lt;30: no daily, PRN max 5mg q72hr. Child-Pugh C: absolute CI.", saved)}
${signoffService("testosterone-injectable", "Testosterone Injectable", "100mg/week SC. Prostate Ca + male breast Ca: hard disqualifiers. DEA continuity flag.", saved)}
${signoffService("estrogen-patches", "Estrogen Patches", "0.025-0.05mg/day patch. Progesterone auto-triggered (intact uterus). Mammogram ack at annual refill.", saved)}
${signoffService("testosterone-oral", "Testosterone Oral (Jatenzo)", "158mg BID with food. T check at 3-5hr post-dose (not trough). Max 237mg BID. BP black box — hold if &gt;160/100.", saved)}
${signoffService("enclomiphene", "Enclomiphene", "12.5mg daily start → 25mg if T &lt;400 at 6wks. Target 400-700 ng/dL. LH/FSH required. Visual disturbance = hard block. Off-label consent.", saved)}
${signoffService("estrogen-cream-vaginal", "Estrogen Cream (Vaginal/GSM)", "0.5g daily x14 days → 2x/week maintenance. No FSH/E2 labs. No progesterone at standard doses. Routes systemic patients to patches.", saved)}
${signoffService("estrogen-cream-systemic", "Estrogen Cream (Systemic/Topical)", "0.5mg/day topical. Titrate q4-6wks. Same labs (FSH+E2) and progesterone rules as patches.", saved)}
${signoffService("nad-plus", "NAD+ SQ", "100mg SQ daily or 3x/week → 250mg if tolerated. Off-label consent. Injection training on video.", saved)}

<!-- ═══════════════════════════════════════════════ -->
<h2>Section 2: Dose Confirmations Needed</h2>
<p>Fill in the blanks to finalize these protocols.</p>

<!-- Retatrutide -->
<div class="service-card pending">
<h3>Retatrutide</h3>
<p class="detail">Based on TRIUMPH Phase 3: 2mg → 4mg → 8mg → 12mg weekly SC (4 weeks per step)</p>
<div class="field-group">
  <label>Max dose ceiling:</label>
  <input type="text" name="retatrutide_max_dose" placeholder="12mg or modify" value="${val(saved, "retatrutide_max_dose")}">
</div>
<div class="field-group">
  <label>Titration pace (weeks per step):</label>
  <input type="text" name="retatrutide_titration_weeks" placeholder="4 weeks or modify" value="${val(saved, "retatrutide_titration_weeks")}">
</div>
<div class="field-group">
  <label>Additional CIs beyond standard GLP-1 class:</label>
  <input type="text" name="retatrutide_additional_ci" placeholder="None, or specify" value="${val(saved, "retatrutide_additional_ci")}">
</div>
<label class="check"><input type="checkbox" name="retatrutide_offlabel_consent" ${chk(saved, "retatrutide_offlabel_consent")}> Off-label consent language approved</label>
<label class="check"><input type="checkbox" name="retatrutide_approved" ${chk(saved, "retatrutide_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="retatrutide_notes" rows="2">${val(saved, "retatrutide_notes")}</textarea></div>
</div>

<!-- MOTS-c -->
<div class="service-card pending">
<h3>MOTS-c</h3>
<p class="detail">Draft: 5mg SQ 3x/week → 10mg 3x/week after 4-week tolerance</p>
<div class="field-group">
  <label>Starting dose:</label>
  <input type="text" name="motsc_starting_dose" placeholder="5mg 3x/week or modify" value="${val(saved, "motsc_starting_dose")}">
</div>
<div class="field-group">
  <label>Max dose:</label>
  <input type="text" name="motsc_max_dose" placeholder="10mg 3x/week or modify" value="${val(saved, "motsc_max_dose")}">
</div>
<div class="field-group">
  <label>Dosing cycle:</label>
  <input type="text" name="motsc_cycle" placeholder="Continuous or specify on/off" value="${val(saved, "motsc_cycle")}">
</div>
<div class="field-group">
  <label>Additional CIs beyond pregnancy and active cancer:</label>
  <input type="text" name="motsc_additional_ci" placeholder="None, or specify" value="${val(saved, "motsc_additional_ci")}">
</div>
<label class="check"><input type="checkbox" name="motsc_approved" ${chk(saved, "motsc_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="motsc_notes" rows="2">${val(saved, "motsc_notes")}</textarea></div>
</div>

<!-- BPC-157 -->
<div class="service-card pending">
<h3>BPC-157</h3>
<p class="detail">Draft: 250mcg SQ daily (systemic/MSK) OR 500mcg oral daily (GI). Cycle: 4-12 weeks on, 4-week break.</p>
<div class="field-group">
  <label>SQ dose:</label>
  <input type="text" name="bpc157_sq_dose" placeholder="250mcg daily or modify" value="${val(saved, "bpc157_sq_dose")}">
</div>
<div class="field-group">
  <label>Oral dose (GI indication):</label>
  <input type="text" name="bpc157_oral_dose" placeholder="500mcg daily or modify" value="${val(saved, "bpc157_oral_dose")}">
</div>
<div class="field-group">
  <label>Cycle:</label>
  <input type="text" name="bpc157_cycle" placeholder="4-12 weeks on / 4 off or modify" value="${val(saved, "bpc157_cycle")}">
</div>
<div class="field-group">
  <label>Additional CIs:</label>
  <input type="text" name="bpc157_additional_ci" placeholder="None, or specify" value="${val(saved, "bpc157_additional_ci")}">
</div>
<label class="check"><input type="checkbox" name="bpc157_approved" ${chk(saved, "bpc157_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="bpc157_notes" rows="2">${val(saved, "bpc157_notes")}</textarea></div>
</div>

<!-- TB-500 -->
<div class="service-card pending">
<h3>TB-500</h3>
<p class="detail">Draft: 2-2.5mg SQ 2x/week x4-6 weeks loading → 1-2mg monthly maintenance</p>
<div class="field-group">
  <label>Loading dose:</label>
  <input type="text" name="tb500_loading_dose" placeholder="2mg or 2.5mg 2x/week" value="${val(saved, "tb500_loading_dose")}">
</div>
<div class="field-group">
  <label>Loading duration:</label>
  <input type="text" name="tb500_loading_duration" placeholder="4 weeks or 6 weeks" value="${val(saved, "tb500_loading_duration")}">
</div>
<div class="field-group">
  <label>Maintenance dose:</label>
  <input type="text" name="tb500_maintenance" placeholder="1mg or 2mg monthly" value="${val(saved, "tb500_maintenance")}">
</div>
<div class="field-group">
  <label>Additional CIs:</label>
  <input type="text" name="tb500_additional_ci" placeholder="None, or specify" value="${val(saved, "tb500_additional_ci")}">
</div>
<label class="check"><input type="checkbox" name="tb500_approved" ${chk(saved, "tb500_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="tb500_notes" rows="2">${val(saved, "tb500_notes")}</textarea></div>
</div>

<!-- Wolverine -->
<div class="service-card pending">
<h3>Wolverine (BPC-157 + TB-500)</h3>
<p class="detail">Both components 503B confirmed. Need blend ratio.</p>
<div class="field-group">
  <label>BPC-157 per dose (mcg):</label>
  <input type="text" name="wolverine_bpc157" placeholder="e.g. 250mcg" value="${val(saved, "wolverine_bpc157")}">
</div>
<div class="field-group">
  <label>TB-500 per dose (mg):</label>
  <input type="text" name="wolverine_tb500" placeholder="e.g. 2mg" value="${val(saved, "wolverine_tb500")}">
</div>
<div class="field-group">
  <label>Frequency:</label>
  <input type="text" name="wolverine_frequency" placeholder="2x/week loading or modify" value="${val(saved, "wolverine_frequency")}">
</div>
<div class="field-group">
  <label>Loading duration (weeks):</label>
  <input type="text" name="wolverine_loading_weeks" placeholder="e.g. 4-6" value="${val(saved, "wolverine_loading_weeks")}">
</div>
<div class="field-group">
  <label>Maintenance (dose + frequency):</label>
  <input type="text" name="wolverine_maintenance" placeholder="e.g. 1 injection monthly" value="${val(saved, "wolverine_maintenance")}">
</div>
<label class="check"><input type="checkbox" name="wolverine_approved" ${chk(saved, "wolverine_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="wolverine_notes" rows="2">${val(saved, "wolverine_notes")}</textarea></div>
</div>

<!-- GLO -->
<div class="service-card pending">
<h3>GLO (GHK-Cu + BPC-157 + TB-500)</h3>
<p class="detail">All 3 components 503B confirmed. Wilson's disease = hard disqualifier.</p>
<div class="field-group">
  <label>GHK-Cu per dose (mg):</label>
  <input type="text" name="glo_ghkcu" placeholder="e.g. 1-2mg" value="${val(saved, "glo_ghkcu")}">
</div>
<div class="field-group">
  <label>BPC-157 per dose (mcg):</label>
  <input type="text" name="glo_bpc157" placeholder="e.g. 250mcg" value="${val(saved, "glo_bpc157")}">
</div>
<div class="field-group">
  <label>TB-500 per dose (mg):</label>
  <input type="text" name="glo_tb500" placeholder="e.g. 2mg" value="${val(saved, "glo_tb500")}">
</div>
<div class="field-group">
  <label>Frequency:</label>
  <input type="text" name="glo_frequency" placeholder="2x/week loading or modify" value="${val(saved, "glo_frequency")}">
</div>
<div class="field-group">
  <label>Loading duration (weeks):</label>
  <input type="text" name="glo_loading_weeks" placeholder="e.g. 4-6" value="${val(saved, "glo_loading_weeks")}">
</div>
<div class="field-group">
  <label>Maintenance (dose + frequency):</label>
  <input type="text" name="glo_maintenance" placeholder="e.g. monthly" value="${val(saved, "glo_maintenance")}">
</div>
<label class="check"><input type="checkbox" name="glo_wilson_confirmed" ${chk(saved, "glo_wilson_confirmed")}> Wilson's disease as hard disqualifier confirmed</label>
<label class="check"><input type="checkbox" name="glo_approved" ${chk(saved, "glo_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="glo_notes" rows="2">${val(saved, "glo_notes")}</textarea></div>
</div>

<!-- KLOW -->
<div class="service-card pending">
<h3>KLOW (GHK-Cu + BPC-157 + TB-500 + KPV)</h3>
<p class="detail">All 4 components 503B confirmed. Wilson's disease + immunosuppressant flag.</p>
<div class="field-group">
  <label>GHK-Cu per dose (mg):</label>
  <input type="text" name="klow_ghkcu" placeholder="e.g. 1-2mg" value="${val(saved, "klow_ghkcu")}">
</div>
<div class="field-group">
  <label>BPC-157 per dose (mcg):</label>
  <input type="text" name="klow_bpc157" placeholder="e.g. 250mcg" value="${val(saved, "klow_bpc157")}">
</div>
<div class="field-group">
  <label>TB-500 per dose (mg):</label>
  <input type="text" name="klow_tb500" placeholder="e.g. 2mg" value="${val(saved, "klow_tb500")}">
</div>
<div class="field-group">
  <label>KPV per dose (mcg or mg):</label>
  <input type="text" name="klow_kpv" placeholder="e.g. 500mcg-1mg" value="${val(saved, "klow_kpv")}">
</div>
<div class="field-group">
  <label>Frequency:</label>
  <input type="text" name="klow_frequency" placeholder="2x/week loading or modify" value="${val(saved, "klow_frequency")}">
</div>
<div class="field-group">
  <label>Loading duration (weeks):</label>
  <input type="text" name="klow_loading_weeks" placeholder="e.g. 4-6" value="${val(saved, "klow_loading_weeks")}">
</div>
<div class="field-group">
  <label>Maintenance (dose + frequency):</label>
  <input type="text" name="klow_maintenance" placeholder="e.g. monthly" value="${val(saved, "klow_maintenance")}">
</div>
<label class="check"><input type="checkbox" name="klow_wilson_confirmed" ${chk(saved, "klow_wilson_confirmed")}> Wilson's disease as hard disqualifier confirmed</label>
<label class="check"><input type="checkbox" name="klow_immunosuppressant_soft" ${chk(saved, "klow_immunosuppressant_soft")}> Immunosuppressant flag = soft review (not hard block)</label>
<label class="check"><input type="checkbox" name="klow_gi_routing" ${chk(saved, "klow_gi_routing")}> KLOW preferred over GLO for GI/gut inflammatory indication</label>
<label class="check"><input type="checkbox" name="klow_approved" ${chk(saved, "klow_approved")}> <strong>Approved</strong></label>
<div class="field-group"><label>Notes:</label><textarea name="klow_notes" rows="2">${val(saved, "klow_notes")}</textarea></div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<h2>Signature</h2>
<div class="service-card">
<div class="field-group">
  <label>Medical Director Name:</label>
  <input type="text" name="md_name" placeholder="Full legal name" value="${val(saved, "md_name")}" required>
</div>
<div class="field-group">
  <label>Date:</label>
  <input type="date" name="md_date" value="${val(saved, "md_date") || new Date().toISOString().split("T")[0]}" required>
</div>
<label class="check"><input type="checkbox" name="md_signature_confirmed" required ${chk(saved, "md_signature_confirmed")}> <strong>I confirm that I have reviewed all protocols above and my approvals constitute clinical authorization for the dosing engine build.</strong></label>
</div>

<button type="submit" class="btn submit-btn">Submit Sign-Off</button>
</form>
</div>
</body></html>`);
});

// Submit handler
mdReview.post("/submit", async (c) => {
  const body = await c.req.parseBody();
  const data: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      data[key] = value;
    } else {
      data[key] = "on"; // checkboxes
    }
  }

  data.submitted_at = new Date().toISOString();

  await c.env.PARTNERS.put(KV_KEY, JSON.stringify(data));

  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Submitted — My Orbit Health</title>
<style>${CSS}</style></head><body>
<div class="container" style="text-align:center;margin-top:80px">
<h1>Sign-Off Submitted</h1>
<p style="font-size:18px;color:#059669">Your protocol approvals have been saved. Bryan will be notified.</p>
<p style="margin-top:24px"><a href="/md-review" class="btn" style="display:inline-block;text-decoration:none">Review / Edit Responses</a></p>
</div></body></html>`);
});

// API endpoint for Bryan/Claude to pull results
mdReview.get("/results", async (c) => {
  const data = await c.env.PARTNERS.get(KV_KEY);
  if (!data) return c.json({ status: "not_submitted" });
  return c.json(JSON.parse(data));
});

// ─── Helpers ─────────────────────────────────────────────────

function val(saved: any, key: string): string {
  return saved?.[key] || "";
}

function chk(saved: any, key: string): string {
  return saved?.[key] ? "checked" : "";
}

function signoffService(id: string, name: string, detail: string, saved: any): string {
  return `<div class="service-card">
<label class="check service-check">
  <input type="checkbox" name="${id}_approved" ${chk(saved, id + "_approved")}>
  <div>
    <strong>${name}</strong>
    <span class="detail">${detail}</span>
  </div>
</label>
</div>`;
}

// ─── CSS ─────────────────────────────────────────────────────

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a1a; line-height: 1.6; }
.container { max-width: 720px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
h2 { font-size: 18px; font-weight: 600; margin-top: 40px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.subtitle { color: #6b7280; margin-bottom: 24px; }
.saved-banner { background: #d1fae5; color: #065f46; padding: 8px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
.service-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; }
.service-card.pending { border-left: 4px solid #f59e0b; }
.service-check { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
.service-check input { margin-top: 4px; width: 20px; height: 20px; accent-color: #059669; }
.detail { display: block; color: #6b7280; font-size: 13px; margin-top: 2px; }
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 8px 0; font-size: 14px; }
.check input { width: 18px; height: 18px; accent-color: #059669; }
.field-group { margin: 10px 0; }
.field-group label { display: block; font-size: 13px; font-weight: 500; color: #374151; margin-bottom: 4px; }
.field-group input, .field-group textarea { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; }
.field-group textarea { resize: vertical; }
.btn { display: block; width: 100%; padding: 14px; background: #059669; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; }
.btn:hover { background: #047857; }
.submit-btn { margin-top: 32px; font-size: 18px; padding: 16px; }
`;

export default mdReview;
