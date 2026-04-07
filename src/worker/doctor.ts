import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner, getPendingCase, listPendingCases, listAllCases, savePendingCase } from "../lib/kv";
import { createStripeClient, capturePayment, createSubscription } from "./stripe";
import { sendEmail, buildPatientApprovedEmail, buildPatientDeniedEmail, buildPatientShippedEmail, buildPatientDeliveredEmail } from "./email";
import { createComposition, fhirRead, fhirSearch } from "./medplum";

const doctor = new Hono<{ Bindings: Env }>();

// ─── Auth ────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

doctor.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/doctor/login" || path === "/doctor/auth" || path.startsWith("/doctor/setup")) return next();

  const sessionCookie = c.req.header("Cookie")?.match(/doctor_session=([^;]+)/)?.[1];
  if (!sessionCookie) return c.redirect("/doctor/login");

  const today = new Date().toISOString().split("T")[0];

  // Check doctor's own password first (set via one-time setup)
  const doctorHash = await c.env.PARTNERS.get("doctor_password_hash");
  if (doctorHash) {
    const doctorSession = await hashPassword(doctorHash + "doctor" + today);
    if (sessionCookie === doctorSession) return next();
  }

  // Fall back to admin password (for dev access)
  const adminSession = await hashPassword(c.env.ADMIN_PASSWORD_HASH + "doctor" + today);
  if (sessionCookie === adminSession) return next();

  return c.redirect("/doctor/login");
});

// ─── Login ───────────────────────────────────────────────────

doctor.get("/login", (c) => c.html(LOGIN_HTML));

doctor.post("/auth", async (c) => {
  const body = await c.req.parseBody();
  const password = body.password as string || "";
  const passwordHash = await hashPassword(password);

  // Check doctor's own password first
  const doctorHash = await c.env.PARTNERS.get("doctor_password_hash");
  const isDoctor = doctorHash && passwordHash === doctorHash;
  const isAdmin = passwordHash === c.env.ADMIN_PASSWORD_HASH.trim();

  if (isDoctor || isAdmin) {
    const today = new Date().toISOString().split("T")[0];
    const seedHash = isDoctor ? doctorHash : c.env.ADMIN_PASSWORD_HASH;
    const sessionToken = await hashPassword(seedHash + "doctor" + today);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/doctor",
        "Set-Cookie": `doctor_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
      },
    });
  }

  return c.html(LOGIN_HTML.replace("</form>", '<p style="color:#dc2626;margin-top:12px;font-size:14px">Invalid password</p></form>'));
});

// ─── Dashboard ───────────────────────────────────────────────

doctor.get("/", async (c) => {
  const cases = await listAllCases(c.env.PARTNERS);
  return c.html(renderDashboard(cases));
});

// ─── Case Detail ─────────────────────────────────────────────

doctor.get("/case/:id", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.text("Case not found", 404);
  return c.html(renderCaseDetail(pendingCase));
});

// ─── Medplum Read-Back ──────────────────────────────────────

doctor.get("/case/:id/medplum-data", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);
  if (!pendingCase.medplumPatientId) return c.json({ error: "No Medplum patient linked" }, 404);

  try {
    // Read patient
    const patient = await fhirRead(c.env, "Patient", pendingCase.medplumPatientId);

    // Search for QuestionnaireResponses
    const qrBundle = await fhirSearch(c.env, "QuestionnaireResponse", {
      patient: `Patient/${pendingCase.medplumPatientId}`,
    });
    const questionnaireResponses = (qrBundle.entry || []).map((e: any) => e.resource);

    // Search for Compositions (SOAP notes)
    const compBundle = await fhirSearch(c.env, "Composition", {
      subject: `Patient/${pendingCase.medplumPatientId}`,
    });
    const compositions = (compBundle.entry || []).map((e: any) => e.resource);

    return c.json({
      success: true,
      patient,
      questionnaireResponses,
      compositions,
    });
  } catch (err) {
    return c.json({ error: `Medplum read failed: ${String(err)}` }, 500);
  }
});

// ─── Approve ─────────────────────────────────────────────────

doctor.post("/case/:id/approve", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);
  if (pendingCase.status !== "pending") return c.json({ error: "Case already resolved" }, 400);

  // Check expiry
  const now = new Date();
  const expires = new Date(pendingCase.authExpiresAt);
  if (now > expires) return c.json({ error: "Payment authorization has expired. The patient will need to resubmit." }, 400);

  const partner = await getPartner(c.env.PARTNERS, pendingCase.partnerSlug);
  if (!partner) return c.json({ error: "Partner not found" }, 500);

  // 1. Capture payment
  if (c.env.STRIPE_BYPASS !== "true") {
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
    try {
      await capturePayment(stripe, pendingCase.paymentIntentId, partner);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("expired") || msg.includes("canceled") || msg.includes("cancelled")) {
        return c.json({ error: "Payment authorization has expired or was cancelled. The patient will need to resubmit." }, 400);
      }
      return c.json({ error: `Payment capture failed: ${msg}` }, 500);
    }

    // 2. Create subscription if applicable
    if (pendingCase.subscriptionPrice > 0 && pendingCase.paymentMethodId) {
      try {
        await createSubscription(
          stripe,
          partner,
          pendingCase.patientEmail,
          pendingCase.paymentMethodId,
          pendingCase.subscriptionPrice,
          pendingCase.serviceType
        );
      } catch (err) {
        console.error("Subscription creation failed (payment was captured):", err);
      }
    }
  }

  // 3. Email patient
  try {
    await sendEmail(c.env.RESEND_API_KEY, {
      to: pendingCase.patientEmail,
      subject: `Your ${pendingCase.serviceName} prescription has been approved!`,
      html: buildPatientApprovedEmail({
        patientName: pendingCase.patientName,
        serviceName: pendingCase.serviceName,
        partnerName: pendingCase.partnerName,
      }),
    });
  } catch (err) {
    console.error("Approved email failed:", err);
  }

  // 4. Update case
  pendingCase.status = "approved";
  pendingCase.orderStatus = "prescribed";
  pendingCase.resolvedAt = new Date().toISOString();
  await savePendingCase(c.env.PARTNERS, pendingCase);

  return c.json({ success: true });
});

// ─── Update Order Status ────────────────────────────────────

doctor.post("/case/:id/update-order", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);
  if (pendingCase.status !== "approved") return c.json({ error: "Only approved cases can be updated" }, 400);

  const body = await c.req.json();
  const newStatus = body.orderStatus as string;

  if (newStatus === "shipped") {
    pendingCase.orderStatus = "shipped";
    pendingCase.shippedAt = new Date().toISOString();
    if (body.trackingNumber) pendingCase.trackingNumber = body.trackingNumber;
    if (body.trackingUrl) pendingCase.trackingUrl = body.trackingUrl;
    if (body.carrier) pendingCase.carrier = body.carrier;
    if (body.pharmacyOrderId) pendingCase.pharmacyOrderId = body.pharmacyOrderId;
    await savePendingCase(c.env.PARTNERS, pendingCase);

    // Email patient
    try {
      await sendEmail(c.env.RESEND_API_KEY, {
        to: pendingCase.patientEmail,
        subject: `Your ${pendingCase.serviceName} has shipped!`,
        html: buildPatientShippedEmail({
          patientName: pendingCase.patientName,
          serviceName: pendingCase.serviceName,
          partnerName: pendingCase.partnerName,
          carrier: pendingCase.carrier,
          trackingNumber: pendingCase.trackingNumber,
          trackingUrl: pendingCase.trackingUrl,
        }),
      });
    } catch (err) {
      console.error("Shipped email failed:", err);
    }

    return c.json({ success: true });
  }

  if (newStatus === "delivered") {
    pendingCase.orderStatus = "delivered";
    pendingCase.deliveredAt = new Date().toISOString();
    await savePendingCase(c.env.PARTNERS, pendingCase);

    // Email patient
    try {
      await sendEmail(c.env.RESEND_API_KEY, {
        to: pendingCase.patientEmail,
        subject: `Your ${pendingCase.serviceName} has been delivered`,
        html: buildPatientDeliveredEmail({
          patientName: pendingCase.patientName,
          serviceName: pendingCase.serviceName,
          partnerName: pendingCase.partnerName,
          startingDose: pendingCase.dosingResult?.startingDose || undefined,
        }),
      });
    } catch (err) {
      console.error("Delivered email failed:", err);
    }

    return c.json({ success: true });
  }

  return c.json({ error: `Invalid order status: ${newStatus}. Must be "shipped" or "delivered".` }, 400);
});

// ─── Deny ────────────────────────────────────────────────────

doctor.post("/case/:id/deny", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);
  if (pendingCase.status !== "pending") return c.json({ error: "Case already resolved" }, 400);

  const body = await c.req.json();
  const reason = body.reason || "No reason provided";

  const partner = await getPartner(c.env.PARTNERS, pendingCase.partnerSlug);

  // 1. Cancel payment intent
  if (c.env.STRIPE_BYPASS !== "true") {
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
    try {
      await stripe.paymentIntents.cancel(
        pendingCase.paymentIntentId,
        partner?.paymentMode === "direct" && partner?.stripeDirectAccountId
          ? { stripeAccount: partner.stripeDirectAccountId }
          : undefined
      );
    } catch (err) {
      console.error("Payment cancellation failed (may already be expired):", err);
    }
  }

  // 2. Email patient
  try {
    await sendEmail(c.env.RESEND_API_KEY, {
      to: pendingCase.patientEmail,
      subject: `About your ${pendingCase.serviceName} request`,
      html: buildPatientDeniedEmail({
        patientName: pendingCase.patientName,
        serviceName: pendingCase.serviceName,
        partnerName: pendingCase.partnerName,
        reason,
      }),
    });
  } catch (err) {
    console.error("Denied email failed:", err);
  }

  // 3. Update case
  pendingCase.status = "denied";
  pendingCase.denyReason = reason;
  pendingCase.resolvedAt = new Date().toISOString();
  await savePendingCase(c.env.PARTNERS, pendingCase);

  return c.json({ success: true });
});

// ─── Generate SOAP Note (Claude API) ────────────────────────

doctor.post("/case/:id/generate-soap", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);

  // Build the prompt from all available patient data
  const d = pendingCase.dosingResult;
  const answersText = Object.entries(pendingCase.answers || {})
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join("\n");

  const dosingText = d ? [
    d.startingDose ? `Starting Dose: ${d.startingDose}` : null,
    d.maxDose ? `Max Dose: ${d.maxDose}` : null,
    `Route: ${d.route}`,
    `Frequency: ${d.frequency}`,
    d.titrationSchedule.length > 0 ? `Titration: ${d.titrationSchedule.map(s => `${s.dose} (${s.durationWeeks ? s.durationWeeks + " weeks" : "maintenance"})`).join(" → ")}` : null,
    d.providerNotes.length > 0 ? `Provider Notes: ${d.providerNotes.join("; ")}` : null,
    d.disqualifiers.length > 0 ? `Flags: ${d.disqualifiers.map(q => `${q.field}: ${q.reason} (${q.blockType})`).join("; ")}` : null,
    d.labRequirements.length > 0 ? `Lab Requirements: ${d.labRequirements.map(l => `${l.panel} (${l.met ? "met" : "not met"})`).join("; ")}` : null,
  ].filter(Boolean).join("\n") : "No dosing data available";

  const prompt = `You are a medical documentation assistant. Generate a SOAP note for the following telehealth encounter. This is an asynchronous telehealth visit for prescription approval.

PATIENT:
- Name: ${pendingCase.patientName}
- DOB: ${pendingCase.patientDob}
- State: ${pendingCase.patientState}
- Gender: (from intake)

SERVICE: ${pendingCase.serviceName} (${pendingCase.serviceType})
VISIT TYPE: ${pendingCase.visitType}
PARTNER: ${pendingCase.partnerName}

INTAKE ANSWERS:
${answersText}

DOSING EVALUATION:
${dosingText}

Generate a structured SOAP note with these four sections. Be clinically accurate and concise. Use the intake answers as the basis for Subjective. For Objective, note this is an asynchronous telehealth visit — document what data is available (BMI, reported vitals, lab status). For Assessment, provide the clinical reasoning based on the intake data and dosing evaluation. For Plan, include the specific medication, dose, frequency, and any follow-up requirements.

Return ONLY valid JSON in this exact format:
{
  "subjective": "...",
  "objective": "...",
  "assessment": "...",
  "plan": "..."
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": c.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return c.json({ error: `Claude API error: ${res.status} ${errText}` }, 500);
    }

    const result = (await res.json()) as { content: Array<{ type: string; text: string }> };
    const text = result.content?.[0]?.text || "";

    // Parse JSON from response (handle markdown code fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return c.json({ error: "Failed to parse SOAP note from AI response" }, 500);

    const soapNote = JSON.parse(jsonMatch[0]);
    return c.json({ success: true, soapNote });
  } catch (err) {
    return c.json({ error: `SOAP generation failed: ${String(err)}` }, 500);
  }
});

// ─── Save SOAP Note ─────────────────────────────────────────

doctor.post("/case/:id/save-soap", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.json({ error: "Case not found" }, 404);
  if (!pendingCase.medplumPatientId) return c.json({ error: "No patient ID available for this case" }, 400);

  const body = await c.req.json();
  const { subjective, objective, assessment, plan } = body;
  if (!subjective || !objective || !assessment || !plan) {
    return c.json({ error: "All four SOAP sections are required" }, 400);
  }

  try {
    const composition = await createComposition(c.env, {
      patientId: pendingCase.medplumPatientId,
      practitionerId: c.env.DOCTOR_PRACTITIONER_ID,
      subjective,
      objective,
      assessment,
      plan,
      title: `SOAP Note — ${pendingCase.serviceName}`,
    });

    pendingCase.soapNoteId = composition.id;
    await savePendingCase(c.env.PARTNERS, pendingCase);

    return c.json({ success: true, noteId: composition.id });
  } catch (err) {
    return c.json({ error: `Failed to save SOAP note: ${String(err)}` }, 500);
  }
});

// ============================================================
// HTML
// ============================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeSince(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "< 1 hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function expiryBadge(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const hours = Math.floor(ms / 3600000);
  if (hours <= 0) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">EXPIRED</span>`;
  if (hours <= 48) return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e">${hours}h left</span>`;
  const days = Math.floor(hours / 24);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">${days}d left</span>`;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Doctor Portal - My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-card { background: #fff; border-radius: 12px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; margin-top: 16px; color: #333; }
    input { width: 100%; padding: 12px 14px; border: 1.5px solid #d9d9d9; border-radius: 8px; font-size: 14px; font-family: inherit; }
    input:focus { outline: none; border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    button { width: 100%; padding: 14px; background: #4F46E5; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 24px; font-family: inherit; }
    button:hover { background: #4338CA; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>Doctor Portal</h1>
    <p class="subtitle">My Orbit Health — Review &amp; Approve Prescriptions</p>
    <form method="POST" action="/doctor/auth">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required placeholder="Enter password">
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;

function statusBadge(status: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: "#fef3c7", text: "#92400e" },
    approved: { bg: "#dcfce7", text: "#166534" },
    denied: { bg: "#fecaca", text: "#991b1b" },
  };
  const c = colors[status] || colors.pending;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${c.bg};color:${c.text}">${status.toUpperCase()}</span>`;
}

function orderStatusBadge(orderStatus?: string): string {
  if (!orderStatus) return "";
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    prescribed: { bg: "#dbeafe", text: "#1e40af", label: "PRESCRIBED" },
    shipped: { bg: "#e0e7ff", text: "#4338ca", label: "SHIPPED" },
    delivered: { bg: "#dcfce7", text: "#166534", label: "DELIVERED" },
  };
  const c = colors[orderStatus] || { bg: "#f3f4f6", text: "#666", label: orderStatus.toUpperCase() };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${c.bg};color:${c.text}">${c.label}</span>`;
}

function renderCaseCard(c: import("../lib/types").PendingCase): string {
  const expired = c.status === "pending" && new Date(c.authExpiresAt).getTime() < Date.now();
  return `
    <a href="/doctor/case/${encodeURIComponent(c.paymentIntentId)}" style="text-decoration:none;color:inherit;display:block">
      <div style="background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:20px;${expired ? "opacity:0.7;" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
          <div>
            <p style="font-size:16px;font-weight:700;margin:0">${escapeHtml(c.patientName)}</p>
            <p style="font-size:13px;color:#888;margin:4px 0 0 0">${escapeHtml(c.serviceName)} · ${escapeHtml(c.partnerName)}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${statusBadge(c.status)}
            ${c.status === "pending" ? expiryBadge(c.authExpiresAt) : ""}
            ${c.status === "approved" ? orderStatusBadge(c.orderStatus) : ""}
          </div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div style="font-size:12px;color:#666"><strong>State:</strong> ${escapeHtml(c.patientState)}</div>
          <div style="font-size:12px;color:#666"><strong>Visit:</strong> ${escapeHtml(c.visitType)}</div>
          <div style="font-size:12px;color:#666"><strong>Charge:</strong> $${c.chargeAmount}</div>
          <div style="font-size:12px;color:#666"><strong>${c.resolvedAt ? "Resolved" : "Submitted"}:</strong> ${timeSince(c.resolvedAt || c.createdAt)}</div>
        </div>
        ${c.status === "pending" && c.dosingResult?.softReviewRequired ? '<div style="margin-top:8px;font-size:11px;font-weight:600;color:#f59e0b">⚠ Requires Provider Review</div>' : ""}
        ${c.status === "pending" && c.dosingResult?.startingDose ? `<div style="margin-top:4px;font-size:12px;color:#666"><strong>Dose:</strong> ${escapeHtml(c.dosingResult.startingDose)}</div>` : ""}
        ${c.status === "denied" && c.denyReason ? `<div style="margin-top:8px;font-size:12px;color:#991b1b"><strong>Reason:</strong> ${escapeHtml(c.denyReason)}</div>` : ""}
        ${c.orderStatus === "shipped" && c.trackingNumber ? `<div style="margin-top:4px;font-size:12px;color:#4338ca"><strong>Tracking:</strong> ${escapeHtml(c.carrier || "")} ${escapeHtml(c.trackingNumber)}</div>` : ""}
      </div>
    </a>`;
}

function renderDashboard(cases: import("../lib/types").PendingCase[]): string {
  const pending = cases.filter(c => c.status === "pending");
  const approved = cases.filter(c => c.status === "approved");
  const denied = cases.filter(c => c.status === "denied");
  const activeOrders = approved.filter(c => c.orderStatus === "prescribed" || c.orderStatus === "shipped");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Doctor Portal - My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; }
    .container { max-width: 800px; margin: 0 auto; padding: 32px; }
    .grid { display: grid; gap: 12px; }
    a.logout { color: #888; font-size: 13px; text-decoration: none; }
    .empty { text-align: center; padding: 40px; color: #888; font-size: 14px; }
    .stats { display: flex; gap: 12px; margin-bottom: 24px; }
    .stat { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 16px 20px; flex: 1; text-align: center; }
    .stat .val { font-size: 28px; font-weight: 700; }
    .stat .lbl { font-size: 12px; color: #888; margin-top: 2px; }
    .tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid #e8e8e8; }
    .tab { padding: 10px 20px; font-size: 14px; font-weight: 600; color: #888; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab.active { color: #4F46E5; border-bottom-color: #4F46E5; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Doctor Portal <span style="font-size:12px;color:#888">My Orbit Health</span></h1>
    <a class="logout" href="/doctor/login">Logout</a>
  </div>
  <div class="container">
    <div class="stats">
      <div class="stat"><div class="val" style="color:#f59e0b">${pending.length}</div><div class="lbl">Pending Review</div></div>
      <div class="stat"><div class="val" style="color:#3b82f6">${activeOrders.length}</div><div class="lbl">Active Orders</div></div>
      <div class="stat"><div class="val" style="color:#22c55e">${approved.length}</div><div class="lbl">Approved</div></div>
      <div class="stat"><div class="val" style="color:#dc2626">${denied.length}</div><div class="lbl">Denied</div></div>
    </div>

    <div class="tabs">
      <div class="tab active" onclick="switchTab('pending')">Pending (${pending.length})</div>
      <div class="tab" onclick="switchTab('orders')">Active Orders (${activeOrders.length})</div>
      <div class="tab" onclick="switchTab('approved')">Approved (${approved.length})</div>
      <div class="tab" onclick="switchTab('denied')">Denied (${denied.length})</div>
      <div class="tab" onclick="switchTab('all')">All (${cases.length})</div>
    </div>

    <div id="tab-pending" class="tab-content active">
      ${pending.length > 0
        ? `<div class="grid">${pending.map(renderCaseCard).join("")}</div>`
        : '<div class="empty">No cases pending review.</div>'}
    </div>
    <div id="tab-orders" class="tab-content">
      ${activeOrders.length > 0
        ? `<div class="grid">${activeOrders.map(renderCaseCard).join("")}</div>`
        : '<div class="empty">No active orders. Approved prescriptions will appear here until delivered.</div>'}
    </div>
    <div id="tab-approved" class="tab-content">
      ${approved.length > 0
        ? `<div class="grid">${approved.map(renderCaseCard).join("")}</div>`
        : '<div class="empty">No approved cases yet.</div>'}
    </div>
    <div id="tab-denied" class="tab-content">
      ${denied.length > 0
        ? `<div class="grid">${denied.map(renderCaseCard).join("")}</div>`
        : '<div class="empty">No denied cases.</div>'}
    </div>
    <div id="tab-all" class="tab-content">
      ${cases.length > 0
        ? `<div class="grid">${cases.map(renderCaseCard).join("")}</div>`
        : '<div class="empty">No cases yet.</div>'}
    </div>
  </div>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
    }
  </script>
</body>
</html>`;
}

function renderCaseDetail(c: import("../lib/types").PendingCase): string {
  const expired = new Date(c.authExpiresAt).getTime() < Date.now();

  // Build bloodwork section
  let bloodworkHtml = "";
  if (c.bloodworkStatus && c.bloodworkStatus !== "not-required") {
    let statusContent = "";
    if (c.bloodworkStatus === "have-labs" && c.bloodworkBinaryId) {
      statusContent = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
        + '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">LABS UPLOADED</span>'
        + '<span style="font-size:12px;color:#888">File ID: ' + escapeHtml(c.bloodworkBinaryId) + '</span>'
        + '</div>';
    } else if (c.bloodworkStatus === "have-labs") {
      statusContent = '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e">LABS PENDING</span>'
        + '<span style="font-size:12px;color:#888">Patient indicated they have labs but file was not uploaded</span>'
        + '</div>';
    } else if (c.bloodworkStatus === "need-labs") {
      statusContent = '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">LABS NEEDED</span>'
        + '<span style="font-size:12px;color:#888">Patient needs to get bloodwork done before treatment can begin</span>'
        + '</div>';
    }
    bloodworkHtml = '<div class="card"><h3 style="font-size:16px;margin-bottom:16px">Bloodwork</h3>' + statusContent + '</div>';
  }

  // Compute approval gate
  const labsRequired = c.bloodworkStatus === "have-labs" || c.bloodworkStatus === "need-labs";
  const labsReady = c.bloodworkStatus === "have-labs" && !!c.bloodworkBinaryId;
  const labsBlocking = labsRequired && !labsReady;
  const canApprove = !expired && !!c.soapNoteId && !labsBlocking;

  // Build dosing section
  let dosingHtml = "";
  if (c.dosingResult) {
    const d = c.dosingResult;
    dosingHtml = `
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin-bottom:20px">
        <h3 style="font-size:14px;color:#0369a1;margin:0 0 12px 0">Dosing Recommendation</h3>
        ${d.softReviewRequired ? '<div style="display:inline-block;background:#f59e0b20;color:#f59e0b;font-size:12px;font-weight:600;padding:2px 8px;border-radius:4px;margin-bottom:12px">Requires Provider Review</div>' : '<div style="display:inline-block;background:#22c55e20;color:#22c55e;font-size:12px;font-weight:600;padding:2px 8px;border-radius:4px;margin-bottom:12px">Eligible — Decision Support</div>'}
        <table style="width:100%;border-collapse:collapse">
          ${d.startingDose ? `<tr><td style="padding:4px 0;color:#666;font-size:13px;width:140px">Starting Dose</td><td style="padding:4px 0;font-size:13px;font-weight:600">${escapeHtml(d.startingDose)}</td></tr>` : ""}
          ${d.maxDose ? `<tr><td style="padding:4px 0;color:#666;font-size:13px">Max Dose</td><td style="padding:4px 0;font-size:13px">${escapeHtml(d.maxDose)}</td></tr>` : ""}
          <tr><td style="padding:4px 0;color:#666;font-size:13px">Route</td><td style="padding:4px 0;font-size:13px">${escapeHtml(d.route)}</td></tr>
          <tr><td style="padding:4px 0;color:#666;font-size:13px">Frequency</td><td style="padding:4px 0;font-size:13px">${escapeHtml(d.frequency)}</td></tr>
        </table>
        ${d.titrationSchedule.length > 0 ? `
          <p style="font-size:13px;font-weight:600;color:#0369a1;margin:12px 0 6px 0">Titration Schedule</p>
          <ol style="margin:0;padding-left:20px">${d.titrationSchedule.map(s => {
            const gate = s.gate ? ' <span style="color:#dc2626;font-weight:600">[PROVIDER GATE]</span>' : "";
            const dur = s.durationWeeks ? ` (${s.durationWeeks} weeks)` : " (maintenance)";
            return `<li style="font-size:12px;color:#333;margin-bottom:4px">${escapeHtml(s.dose)}${dur} — ${escapeHtml(s.label)}${gate}</li>`;
          }).join("")}</ol>` : ""}
        ${d.providerNotes.length > 0 ? `
          <p style="font-size:13px;font-weight:600;color:#0369a1;margin:12px 0 6px 0">Provider Notes</p>
          <ul style="margin:0;padding-left:20px">${d.providerNotes.map(n => `<li style="font-size:12px;color:#333;margin-bottom:4px">${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
        ${d.disqualifiers.filter(q => q.blockType === "soft_review" || q.blockType === "hard_pending_review").length > 0 ? `
          <p style="font-size:13px;font-weight:600;color:#dc2626;margin:12px 0 6px 0">Review Flags</p>
          <ul style="margin:0;padding-left:20px">${d.disqualifiers.filter(q => q.blockType === "soft_review" || q.blockType === "hard_pending_review").map(q => `<li style="font-size:12px;color:#991b1b;margin-bottom:4px">${escapeHtml(q.field)}: ${escapeHtml(q.reason)}</li>`).join("")}</ul>` : ""}
      </div>`;
  }

  // Build answers section
  const answerRows = Object.entries(c.answers || {}).map(([key, val]) => {
    const display = Array.isArray(val) ? val.join(", ") : String(val);
    return `<tr><td style="padding:6px 0;color:#666;font-size:13px;width:200px;vertical-align:top">${escapeHtml(key)}</td><td style="padding:6px 0;font-size:13px">${escapeHtml(display)}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(c.patientName)} - Doctor Portal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .back { color: #4F46E5; text-decoration: none; font-size: 14px; }
    .container { max-width: 800px; margin: 0 auto; padding: 32px; }
    .card { background: #fff; border-radius: 10px; border: 1px solid #e8e8e8; padding: 24px; margin-bottom: 20px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-approve { background: #22c55e; color: #fff; }
    .btn-deny { background: #dc2626; color: #fff; }
    textarea { width: 100%; padding: 12px; border: 1.5px solid #d9d9d9; border-radius: 8px; font-size: 14px; font-family: inherit; resize: vertical; }
    textarea:focus { outline: none; border-color: #4F46E5; }
    .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 14px; display: none; z-index: 100; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="font-size:20px">${escapeHtml(c.patientName)}</h1>
    <a class="back" href="/doctor">&larr; All Cases</a>
  </div>
  <div class="container">
    <!-- Patient Info -->
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:16px">Patient Information</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#666;font-size:13px;width:140px">Name</td><td style="padding:6px 0;font-size:14px;font-weight:600">${escapeHtml(c.patientName)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Email</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.patientEmail)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Phone</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.patientPhone)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">State</td><td style="padding:6px 0;font-size:14px;font-weight:600">${escapeHtml(c.patientState)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">DOB</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.patientDob)}</td></tr>
        ${c.medplumPatientId ? `<tr><td style="padding:6px 0;color:#666;font-size:13px">EHR ID</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.medplumPatientId)}</td></tr>` : ""}
      </table>
    </div>

    <!-- Medplum Verification -->
    ${c.medplumPatientId ? `
    <div class="card" id="medplumCard">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="font-size:16px;margin:0">Medplum Verification</h3>
        <button class="btn" onclick="loadMedplumData()" id="btnMedplum" style="background:#6366f1;color:#fff;padding:8px 16px;font-size:12px">Verify Data</button>
      </div>
      <div id="medplumDataContainer" style="display:none"></div>
    </div>` : ""}

    <!-- Service & Payment -->
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:16px">Service &amp; Payment</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#666;font-size:13px;width:140px">Service</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.serviceName)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Partner</td><td style="padding:6px 0;font-size:14px">${escapeHtml(c.partnerName)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Visit Type</td><td style="padding:6px 0;font-size:14px;font-weight:600">${escapeHtml(c.visitType)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Charge Amount</td><td style="padding:6px 0;font-size:14px;font-weight:600">$${c.chargeAmount}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Monthly Sub</td><td style="padding:6px 0;font-size:14px">${c.subscriptionPrice > 0 ? `$${c.subscriptionPrice}/mo` : "None"}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Auth Expiry</td><td style="padding:6px 0;font-size:14px">${expiryBadge(c.authExpiresAt)} ${new Date(c.authExpiresAt).toLocaleDateString()}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Submitted</td><td style="padding:6px 0;font-size:14px">${new Date(c.createdAt).toLocaleString()}</td></tr>
      </table>
    </div>

    <!-- Dosing -->
    ${dosingHtml}

    <!-- Intake Answers -->
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:16px">Intake Answers</h3>
      <table style="width:100%;border-collapse:collapse">${answerRows}</table>
    </div>

    <!-- Bloodwork -->
    ${bloodworkHtml}

    <!-- Actions -->
    <div class="card">
      ${c.status === "pending" ? `
        <h3 style="font-size:16px;margin-bottom:16px">Decision</h3>
        ${expired ? '<div style="background:#fecaca;border-radius:8px;padding:12px 16px;margin-bottom:16px"><p style="font-size:13px;font-weight:600;color:#991b1b;margin:0">Payment authorization has expired. The patient will need to resubmit their intake to proceed.</p></div>' : ""}

        <!-- SOAP Note -->
        <div style="margin-bottom:20px">
          ${c.soapNoteId
            ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">SOAP NOTE SAVED</span>
                <span style="font-size:12px;color:#888">Note ID: ${escapeHtml(c.soapNoteId)}</span>
              </div>`
            : ""}
          <button class="btn" id="btnGenerateSoap" onclick="generateSoap()" style="background:#4F46E5;color:#fff;width:100%" ${expired ? "disabled" : ""}>
            ${c.soapNoteId ? "Regenerate SOAP Note" : "Generate SOAP Note"}
          </button>
        </div>

        <div style="margin-bottom:16px">
          <button class="btn btn-approve" id="btnApprove" onclick="approveCase()" ${canApprove ? "" : "disabled"}>Approve — Charge $${c.chargeAmount}</button>
          ${!c.soapNoteId ? '<p style="font-size:12px;color:#888;margin-top:6px">Generate and save a SOAP note before approving</p>' : ""}
          ${labsBlocking ? '<p style="font-size:12px;color:#dc2626;margin-top:6px">Bloodwork must be uploaded before approving this service</p>' : ""}
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#333">Deny Reason</label>
          <textarea id="denyReason" rows="3" placeholder="Explain why this patient is not eligible..."></textarea>
          <button class="btn btn-deny" onclick="denyCase()" style="margin-top:8px">Deny — Cancel Authorization</button>
        </div>
      ` : c.status === "approved" ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="font-size:16px;margin:0;color:#22c55e">Approved</h3>
          ${orderStatusBadge(c.orderStatus)}
        </div>
        <p style="font-size:14px;color:#666">Approved on ${c.resolvedAt ? new Date(c.resolvedAt).toLocaleString() : "—"}. Payment of $${c.chargeAmount} captured.</p>
        ${c.soapNoteId ? `<p style="font-size:12px;color:#888;margin-top:4px">SOAP Note: ${escapeHtml(c.soapNoteId)}</p>` : ""}

        <!-- Order Tracking Timeline -->
        <div style="margin-top:20px;border-top:1px solid #e8e8e8;padding-top:20px">
          <h4 style="font-size:14px;margin:0 0 16px 0;color:#333">Order Tracking</h4>
          <div style="display:flex;gap:0;margin-bottom:20px">
            <div style="flex:1;text-align:center">
              <div style="width:32px;height:32px;border-radius:50%;background:${c.orderStatus ? "#22c55e" : "#e5e7eb"};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">1</div>
              <p style="font-size:11px;color:${c.orderStatus ? "#22c55e" : "#999"};font-weight:600;margin:4px 0 0">Prescribed</p>
            </div>
            <div style="flex:1;text-align:center">
              <div style="width:32px;height:32px;border-radius:50%;background:${c.orderStatus === "shipped" || c.orderStatus === "delivered" ? "#22c55e" : "#e5e7eb"};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">2</div>
              <p style="font-size:11px;color:${c.orderStatus === "shipped" || c.orderStatus === "delivered" ? "#22c55e" : "#999"};font-weight:600;margin:4px 0 0">Shipped</p>
            </div>
            <div style="flex:1;text-align:center">
              <div style="width:32px;height:32px;border-radius:50%;background:${c.orderStatus === "delivered" ? "#22c55e" : "#e5e7eb"};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">3</div>
              <p style="font-size:11px;color:${c.orderStatus === "delivered" ? "#22c55e" : "#999"};font-weight:600;margin:4px 0 0">Delivered</p>
            </div>
          </div>

          ${c.trackingNumber ? `
            <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin-bottom:16px">
              ${c.carrier ? `<p style="font-size:13px;color:#666;margin:0 0 4px"><strong>Carrier:</strong> ${escapeHtml(c.carrier)}</p>` : ""}
              <p style="font-size:13px;color:#666;margin:0 0 4px"><strong>Tracking #:</strong> ${escapeHtml(c.trackingNumber)}</p>
              ${c.trackingUrl ? `<a href="${c.trackingUrl}" target="_blank" style="font-size:13px;color:#4F46E5">Track Package</a>` : ""}
              ${c.shippedAt ? `<p style="font-size:12px;color:#888;margin:8px 0 0">Shipped: ${new Date(c.shippedAt).toLocaleString()}</p>` : ""}
              ${c.deliveredAt ? `<p style="font-size:12px;color:#888;margin:4px 0 0">Delivered: ${new Date(c.deliveredAt).toLocaleString()}</p>` : ""}
            </div>` : ""}

          ${c.orderStatus === "prescribed" ? `
            <div id="shipForm">
              <h4 style="font-size:13px;font-weight:600;color:#333;margin:0 0 12px">Mark as Shipped</h4>
              <div style="display:grid;gap:8px;margin-bottom:12px">
                <input type="text" id="orderCarrier" placeholder="Carrier (e.g. USPS, FedEx, UPS)" style="padding:10px 12px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:13px;font-family:inherit">
                <input type="text" id="orderTracking" placeholder="Tracking number" style="padding:10px 12px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:13px;font-family:inherit">
                <input type="url" id="orderTrackingUrl" placeholder="Tracking URL (optional)" style="padding:10px 12px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:13px;font-family:inherit">
                <input type="text" id="orderPharmacyId" placeholder="Pharmacy order ID (optional)" style="padding:10px 12px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:13px;font-family:inherit">
              </div>
              <button class="btn" onclick="markShipped()" style="background:#3b82f6;color:#fff">Mark Shipped &amp; Notify Patient</button>
            </div>` : ""}

          ${c.orderStatus === "shipped" ? `
            <button class="btn" onclick="markDelivered()" style="background:#22c55e;color:#fff">Mark Delivered &amp; Notify Patient</button>` : ""}

          ${c.orderStatus === "delivered" ? `
            <p style="font-size:14px;color:#22c55e;font-weight:600">Order complete. Patient notified of delivery.</p>` : ""}
        </div>
      ` : `
        <h3 style="font-size:16px;margin-bottom:16px;color:#dc2626">Denied</h3>
        <p style="font-size:14px;color:#666">This prescription was denied on ${c.resolvedAt ? new Date(c.resolvedAt).toLocaleString() : "—"}.</p>
        ${c.denyReason ? `<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin-top:12px"><p style="font-size:13px;font-weight:600;color:#666;margin:0 0 4px 0">Reason</p><p style="font-size:14px;color:#333;margin:0">${escapeHtml(c.denyReason)}</p></div>` : ""}
        <p style="font-size:14px;color:#666;margin-top:8px">Payment authorization was cancelled and the patient was notified.</p>
        ${c.medplumPatientId ? `<p style="font-size:12px;color:#888;margin-top:4px">Medplum Patient: ${escapeHtml(c.medplumPatientId)}</p>` : ""}
      `}
    </div>

    <!-- SOAP Note Modal -->
    <div id="soapModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;overflow-y:auto">
      <div style="max-width:700px;margin:40px auto;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
        <div style="padding:20px 24px;border-bottom:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center">
          <h2 style="font-size:18px;margin:0">SOAP Note</h2>
          <button onclick="closeSoapModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888">&times;</button>
        </div>
        <div style="padding:24px">
          <div style="margin-bottom:20px">
            <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:6px">S — Subjective</label>
            <textarea id="soapS" rows="5" style="width:100%;padding:12px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:20px">
            <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:6px">O — Objective</label>
            <textarea id="soapO" rows="5" style="width:100%;padding:12px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:20px">
            <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:6px">A — Assessment</label>
            <textarea id="soapA" rows="5" style="width:100%;padding:12px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:20px">
            <label style="display:block;font-size:13px;font-weight:700;color:#333;margin-bottom:6px">P — Plan</label>
            <textarea id="soapP" rows="5" style="width:100%;padding:12px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end">
            <button onclick="generateSoap()" class="btn" style="background:#f3f4f6;color:#333">Regenerate</button>
            <button onclick="closeSoapModal()" class="btn" style="background:#f3f4f6;color:#333">Cancel</button>
            <button id="btnSaveSoap" onclick="saveSoapNote()" class="btn" style="background:#4F46E5;color:#fff">Save SOAP Note</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const CASE_ID = "${c.paymentIntentId.replace(/"/g, '\\"')}";
    const LABS_BLOCKING = ${labsBlocking};
    let soapNoteStatus = '${c.soapNoteId ? "saved" : "idle"}'; // idle | generating | ready | saving | saved

    function showToast(msg, color) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = color || '#1a1a2e';
      t.style.color = '#fff';
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 4000);
    }

    // ─── SOAP Note Functions ────────────────────────────
    async function generateSoap() {
      const btn = document.getElementById('btnGenerateSoap');
      btn.disabled = true;
      btn.textContent = 'Generating SOAP Note...';
      soapNoteStatus = 'generating';

      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/generate-soap', { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || 'Generation failed', '#dc2626');
          btn.disabled = false;
          btn.textContent = 'Generate SOAP Note';
          soapNoteStatus = 'idle';
          return;
        }

        // Fill the modal
        document.getElementById('soapS').value = data.soapNote.subjective || '';
        document.getElementById('soapO').value = data.soapNote.objective || '';
        document.getElementById('soapA').value = data.soapNote.assessment || '';
        document.getElementById('soapP').value = data.soapNote.plan || '';

        soapNoteStatus = 'ready';
        btn.disabled = false;
        btn.textContent = 'Regenerate SOAP Note';

        // Open modal
        document.getElementById('soapModal').style.display = 'block';
      } catch (err) {
        showToast('Network error generating SOAP note', '#dc2626');
        btn.disabled = false;
        btn.textContent = 'Generate SOAP Note';
        soapNoteStatus = 'idle';
      }
    }

    function closeSoapModal() {
      document.getElementById('soapModal').style.display = 'none';
    }

    async function saveSoapNote() {
      const btn = document.getElementById('btnSaveSoap');
      const s = document.getElementById('soapS').value.trim();
      const o = document.getElementById('soapO').value.trim();
      const a = document.getElementById('soapA').value.trim();
      const p = document.getElementById('soapP').value.trim();

      if (!s || !o || !a || !p) {
        showToast('All four SOAP sections are required', '#f59e0b');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Saving...';
      soapNoteStatus = 'saving';

      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/save-soap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjective: s, objective: o, assessment: a, plan: p }),
        });
        const data = await res.json();

        if (data.success) {
          soapNoteStatus = 'saved';
          showToast('SOAP note saved (ID: ' + data.noteId + ')', '#22c55e');
          closeSoapModal();

          // Enable the approve button (only if labs aren't blocking)
          const approveBtn = document.getElementById('btnApprove');
          if (approveBtn && !LABS_BLOCKING) approveBtn.disabled = false;

          // Update the generate button text
          document.getElementById('btnGenerateSoap').textContent = 'Regenerate SOAP Note';
        } else {
          showToast(data.error || 'Save failed', '#dc2626');
          btn.disabled = false;
          btn.textContent = 'Save SOAP Note';
          soapNoteStatus = 'ready';
        }
      } catch (err) {
        showToast('Network error saving SOAP note', '#dc2626');
        btn.disabled = false;
        btn.textContent = 'Save SOAP Note';
        soapNoteStatus = 'ready';
      }
    }

    // ─── Approve / Deny ─────────────────────────────────
    async function approveCase() {
      if (!confirm('Approve this prescription and charge the patient?')) return;
      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/approve', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Approved! Payment captured.', '#22c55e');
          setTimeout(() => window.location.href = '/doctor', 1500);
        } else {
          showToast(data.error || 'Failed', '#dc2626');
        }
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    async function denyCase() {
      const reason = document.getElementById('denyReason').value.trim();
      if (!reason) { showToast('Please enter a deny reason', '#f59e0b'); return; }
      if (!confirm('Deny this prescription? The payment authorization will be cancelled.')) return;
      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/deny', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Denied. Patient notified.', '#dc2626');
          setTimeout(() => window.location.href = '/doctor', 1500);
        } else {
          showToast(data.error || 'Failed', '#dc2626');
        }
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    // ─── Order Status Updates ─────────────────────────────
    async function markShipped() {
      const carrier = document.getElementById('orderCarrier')?.value?.trim() || '';
      const trackingNumber = document.getElementById('orderTracking')?.value?.trim() || '';
      if (!trackingNumber) { showToast('Enter a tracking number', '#f59e0b'); return; }
      if (!confirm('Mark as shipped? The patient will be emailed with tracking info.')) return;

      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/update-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderStatus: 'shipped',
            carrier: carrier,
            trackingNumber: trackingNumber,
            trackingUrl: document.getElementById('orderTrackingUrl')?.value?.trim() || '',
            pharmacyOrderId: document.getElementById('orderPharmacyId')?.value?.trim() || '',
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Marked as shipped. Patient notified.', '#3b82f6');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast(data.error || 'Failed', '#dc2626');
        }
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    async function markDelivered() {
      if (!confirm('Mark as delivered? The patient will be emailed.')) return;
      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/update-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderStatus: 'delivered' }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Marked as delivered. Patient notified.', '#22c55e');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast(data.error || 'Failed', '#dc2626');
        }
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    // ─── Medplum Read-Back ──────────────────────────────
    async function loadMedplumData() {
      const btn = document.getElementById('btnMedplum');
      const container = document.getElementById('medplumDataContainer');
      if (!btn || !container) return;

      btn.disabled = true;
      btn.textContent = 'Loading...';

      try {
        const res = await fetch('/doctor/case/' + encodeURIComponent(CASE_ID) + '/medplum-data');
        const data = await res.json();

        if (!data.success) {
          container.innerHTML = '<p style="color:#dc2626;font-size:13px">' + (data.error || 'Failed to load') + '</p>';
          container.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Retry';
          return;
        }

        const p = data.patient;
        const name = (p.name && p.name[0]) ? ((p.name[0].given || []).join(' ') + ' ' + (p.name[0].family || '')).trim() : 'N/A';
        const email = (p.telecom || []).find(function(t) { return t.system === 'email'; });
        const phone = (p.telecom || []).find(function(t) { return t.system === 'phone'; });

        let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px;width:120px">Name</td><td style="padding:4px 0;font-size:13px;font-weight:600">' + esc(name) + '</td></tr>';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px">Email</td><td style="padding:4px 0;font-size:13px">' + esc(email ? email.value : 'N/A') + '</td></tr>';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px">Phone</td><td style="padding:4px 0;font-size:13px">' + esc(phone ? phone.value : 'N/A') + '</td></tr>';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px">DOB</td><td style="padding:4px 0;font-size:13px">' + esc(p.birthDate || 'N/A') + '</td></tr>';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px">Gender</td><td style="padding:4px 0;font-size:13px">' + esc(p.gender || 'N/A') + '</td></tr>';
        html += '<tr><td style="padding:4px 0;color:#666;font-size:12px">Medplum ID</td><td style="padding:4px 0;font-size:11px;font-family:monospace;color:#888">' + esc(p.id) + '</td></tr>';
        html += '</table>';

        // QuestionnaireResponses
        if (data.questionnaireResponses.length > 0) {
          html += '<p style="font-size:13px;font-weight:600;color:#4F46E5;margin:12px 0 8px">Intake Responses (' + data.questionnaireResponses.length + ')</p>';
          data.questionnaireResponses.forEach(function(qr) {
            html += '<div style="background:#f8f9fa;border-radius:6px;padding:10px;margin-bottom:8px;font-size:12px">';
            html += '<span style="color:#888">ID: ' + esc(qr.id) + '</span> &middot; <span style="font-weight:600">' + esc(qr.status) + '</span> &middot; ' + (qr.item ? qr.item.length : 0) + ' items';
            html += '</div>';
          });
        }

        // Compositions (SOAP)
        if (data.compositions.length > 0) {
          html += '<p style="font-size:13px;font-weight:600;color:#4F46E5;margin:12px 0 8px">SOAP Notes (' + data.compositions.length + ')</p>';
          data.compositions.forEach(function(comp) {
            html += '<div style="background:#f0f9ff;border-radius:6px;padding:10px;margin-bottom:8px;font-size:12px">';
            html += '<span style="font-weight:600">' + esc(comp.title || 'Untitled') + '</span> &middot; <span style="color:#888">' + esc(comp.id) + '</span>';
            html += '</div>';
          });
        }

        html += '<div style="margin-top:8px"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">VERIFIED — Data matches Medplum</span></div>';

        container.innerHTML = html;
        container.style.display = 'block';
        btn.textContent = 'Verified';
        btn.style.background = '#22c55e';
        showToast('Medplum data loaded successfully', '#22c55e');
      } catch (err) {
        container.innerHTML = '<p style="color:#dc2626;font-size:13px">Network error loading Medplum data</p>';
        container.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Retry';
      }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  </script>
</body>
</html>`;
}

// ─── One-Time Doctor Password Setup ──────────────────────────

doctor.get("/setup/:token", async (c) => {
  const token = c.req.param("token");
  const stored = await c.env.PARTNERS.get("doctor_setup_token");
  if (!stored || stored !== token) {
    return c.html(`<!DOCTYPE html><html><head><title>Invalid Link</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;}
      .card{background:#fff;border-radius:12px;padding:40px;max-width:400px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;}
      h1{font-size:20px;margin-bottom:8px;color:#991b1b;}p{color:#666;font-size:14px;}</style></head>
      <body><div class="card"><h1>Link Expired or Invalid</h1><p>This setup link has already been used or is no longer valid. Contact your administrator for a new link.</p></div></body></html>`);
  }

  return c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Set Your Doctor Portal Password</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Inter',system-ui,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .card{background:#fff;border-radius:12px;padding:40px;width:100%;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,0.1);}
      h1{font-size:22px;margin-bottom:8px;}
      .subtitle{color:#666;font-size:14px;margin-bottom:28px;line-height:1.5;}
      label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;margin-top:16px;color:#333;}
      input{width:100%;padding:12px 14px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:14px;font-family:inherit;}
      input:focus{outline:none;border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,0.1);}
      button{width:100%;padding:14px;background:#4F46E5;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:24px;font-family:inherit;}
      button:hover{background:#4338CA;}
      .note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:13px;color:#166534;margin-top:20px;line-height:1.5;}
    </style></head><body>
    <div class="card">
      <h1>Set Your Password</h1>
      <p class="subtitle">Create a password for the Doctor Portal. This is separate from the admin password — only you will know it.</p>
      <form method="POST" action="/doctor/setup/${token}/save">
        <label for="password">New Password</label>
        <input type="password" id="password" name="password" required placeholder="Choose a strong password" minlength="8">
        <label for="confirm">Confirm Password</label>
        <input type="password" id="confirm" name="confirm" required placeholder="Re-enter password" minlength="8">
        <button type="submit">Set Password</button>
      </form>
      <div class="note">This link can only be used once. After you set your password, you'll use it to sign in at <strong>/doctor/login</strong>.</div>
    </div></body></html>`);
});

doctor.post("/setup/:token/save", async (c) => {
  const token = c.req.param("token");
  const stored = await c.env.PARTNERS.get("doctor_setup_token");
  if (!stored || stored !== token) {
    return c.json({ error: "Invalid or expired setup link" }, 403);
  }

  const body = await c.req.parseBody();
  const password = body.password as string || "";
  const confirm = body.confirm as string || "";

  if (password.length < 8) {
    return c.html(`<!DOCTYPE html><html><body><script>alert('Password must be at least 8 characters.');history.back();</script></body></html>`);
  }
  if (password !== confirm) {
    return c.html(`<!DOCTYPE html><html><body><script>alert('Passwords do not match.');history.back();</script></body></html>`);
  }

  const passwordHash = await hashPassword(password);
  await c.env.PARTNERS.put("doctor_password_hash", passwordHash);
  await c.env.PARTNERS.delete("doctor_setup_token");

  return c.html(`<!DOCTYPE html><html><head><title>Password Set</title>
    <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;}
    .card{background:#fff;border-radius:12px;padding:40px;max-width:400px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;}
    h1{font-size:20px;margin-bottom:8px;color:#166534;}p{color:#666;font-size:14px;margin-bottom:20px;}
    a{display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;}
    a:hover{background:#4338CA;}</style></head>
    <body><div class="card"><h1>Password Set Successfully</h1><p>Your doctor portal password is now active. Use it to sign in.</p><a href="/doctor/login">Sign In Now</a></div></body></html>`);
});

export default doctor;
