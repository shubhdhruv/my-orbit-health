/**
 * Patient Portal — authenticated, white-labeled per tenant.
 *
 * Routing: Host-based. The `index.ts` entry point detects when the
 * incoming request hostname matches a partner's `portalDomain` and
 * dispatches here. Every route in this file assumes `c.get("partner")`
 * is populated with the resolved PartnerConfig.
 *
 * Auth: magic link. Patient enters email → we look up the Medplum
 * Patient ID scoped to this tenant → email a short-lived single-use
 * token → click sets a stateless daily-rotation session cookie, same
 * pattern as admin/doctor (SHA-256 of patientId + date + scope).
 *
 * Data: patient dashboard aggregates all PendingCases for the patient
 * via the `patient_cases:${medplumPatientId}` KV index maintained by
 * intake.ts. Order detail reuses (and extends) the existing renderStatusPage
 * logic, adding a blood work lane and more granular status messaging.
 */

import { Hono } from "hono";
import { Env, PartnerConfig, PendingCase } from "../lib/types";
import {
  getPatientCases,
  getPatientIdByEmail,
  getPendingCase,
  saveMagicToken,
  consumeMagicToken,
} from "../lib/kv";
import { sendEmail, getPartnerEmailConfig, buildPortalMagicLinkEmail } from "./email";

type Vars = { partner: PartnerConfig; patientId: string };

const portal = new Hono<{ Bindings: Env; Variables: Vars }>();

// ─── Helpers ──────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterdayKey(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

async function sha256(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Session cookie = base64(patientId).signature where signature is a
 * HMAC-ish hash over patientId + date + partnerSlug + scope. Daily
 * rotation like admin/doctor. We accept yesterday's signature as a
 * grace window so patients who leave the tab open past midnight
 * don't get logged out mid-session.
 */
async function buildSessionToken(
  env: Env,
  patientId: string,
  partnerSlug: string,
  dateKey: string,
): Promise<string> {
  const secret = env.MEDPLUM_CLIENT_SECRET || env.ADMIN_PASSWORD_HASH || "portal-fallback";
  return sha256(`${patientId}|${partnerSlug}|${dateKey}|patient|${secret}`);
}

async function signSession(env: Env, patientId: string, partnerSlug: string): Promise<string> {
  const sig = await buildSessionToken(env, patientId, partnerSlug, todayKey());
  const b64 = btoa(patientId);
  return `${b64}.${sig}`;
}

async function verifySession(
  env: Env,
  cookieValue: string,
  partnerSlug: string,
): Promise<string | null> {
  if (!cookieValue || !cookieValue.includes(".")) return null;
  const [b64, sig] = cookieValue.split(".");
  let patientId: string;
  try {
    patientId = atob(b64);
  } catch {
    return null;
  }
  if (!patientId) return null;
  const sigToday = await buildSessionToken(env, patientId, partnerSlug, todayKey());
  if (sig === sigToday) return patientId;
  const sigYesterday = await buildSessionToken(env, patientId, partnerSlug, yesterdayKey());
  if (sig === sigYesterday) return patientId;
  return null;
}

function getCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Auth middleware ──────────────────────────────────────────

portal.use("*", async (c, next) => {
  const partner = c.get("partner");
  if (!partner) return c.text("Portal not configured for this domain", 404);

  const path = c.req.path;
  // Public routes — no session required
  const publicRoutes = ["/portal/login", "/portal/auth", "/portal/magic", "/portal/logout"];
  if (publicRoutes.some((p) => path === p || path === p + "/")) return next();

  const sessionCookie = getCookie(c.req.header("Cookie"), "portal_session");
  const patientId = sessionCookie ? await verifySession(c.env, sessionCookie, partner.slug) : null;
  if (!patientId) return c.redirect("/portal/login");

  c.set("patientId", patientId);
  return next();
});

// ─── GET /portal — redirect to dashboard or login ────────────

portal.get("/", (c) => c.redirect("/portal/dashboard"));

// ─── GET /portal/login ───────────────────────────────────────

portal.get("/login", (c) => {
  const partner = c.get("partner");
  const error = c.req.query("error");
  const sent = c.req.query("sent");
  return c.html(renderLoginPage(partner, { error, sent }));
});

// ─── POST /portal/auth — issue magic link ────────────────────

portal.post("/auth", async (c) => {
  const partner = c.get("partner");
  const body = await c.req.parseBody();
  const email = ((body.email as string) || "").trim().toLowerCase();

  if (!email) {
    return c.redirect("/portal/login?error=missing");
  }

  // Look up patient by tenant-scoped email index
  const patientId = await getPatientIdByEmail(c.env.PARTNERS, partner.slug, email);

  if (patientId) {
    // Create magic token, 15min TTL
    const token = randomToken(32);
    await saveMagicToken(c.env.PARTNERS, token, {
      medplumPatientId: patientId,
      partnerSlug: partner.slug,
      createdAt: new Date().toISOString(),
    });

    // Send magic link email via partner-branded sender
    const { apiKey, from } = getPartnerEmailConfig(partner, c.env.RESEND_API_KEY);
    const portalBaseUrl = `https://${partner.portalDomain || new URL(c.req.url).host}`;
    const magicUrl = `${portalBaseUrl}/portal/magic?token=${token}`;
    const emailHtml = buildPortalMagicLinkEmail({
      brandName: partner.businessName,
      logoUrl: partner.logoUrl,
      primaryColor: partner.brandColors.primary,
      magicUrl,
    });
    try {
      await sendEmail(apiKey, {
        to: email,
        subject: `Sign in to your ${partner.businessName} account`,
        html: emailHtml,
      }, from);
    } catch (err) {
      console.error("Portal magic-link send failed:", err);
      // Still show generic confirmation to avoid user enumeration
    }
  }
  // Always show generic "check email" screen whether or not the patient exists.
  // This prevents user enumeration via the login form.
  return c.redirect("/portal/login?sent=1");
});

// ─── GET /portal/magic?token=xxx — consume token, set session ─

portal.get("/magic", async (c) => {
  const partner = c.get("partner");
  const token = c.req.query("token");
  if (!token) return c.redirect("/portal/login?error=invalid");

  const payload = await consumeMagicToken(c.env.PARTNERS, token);
  if (!payload) return c.redirect("/portal/login?error=expired");
  if (payload.partnerSlug !== partner.slug) return c.redirect("/portal/login?error=wrong_tenant");

  const sessionValue = await signSession(c.env, payload.medplumPatientId, partner.slug);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/portal/dashboard",
      "Set-Cookie": `portal_session=${encodeURIComponent(sessionValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
});

// ─── GET /portal/logout ──────────────────────────────────────

portal.get("/logout", (c) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/portal/login",
      "Set-Cookie": `portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
});

// ─── GET /portal/dashboard — list all cases for patient ──────

portal.get("/dashboard", async (c) => {
  const partner = c.get("partner");
  const patientId = c.get("patientId");
  const cases = await getPatientCases(c.env.PARTNERS, patientId);
  return c.html(renderDashboard(partner, cases));
});

// ─── GET /portal/orders/:id — detailed status view ───────────

portal.get("/orders/:id", async (c) => {
  const partner = c.get("partner");
  const patientId = c.get("patientId");
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.html(renderNotFound(partner), 404);
  // Tenant + patient ownership check (prevents IDOR)
  if (pendingCase.partnerSlug !== partner.slug || pendingCase.medplumPatientId !== patientId) {
    return c.html(renderNotFound(partner), 404);
  }
  return c.html(renderOrderDetail(partner, pendingCase));
});

// ============================================================
// Templates (server-rendered HTML, branded per partner)
// ============================================================

function baseStyles(partner: PartnerConfig): string {
  const primary = partner.brandColors.primary || "#0B1F3A";
  const font = partner.font || "Inter";
  return `
    :root { --primary: ${primary}; --primary-dim: ${primary}20; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: '${font}', system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #1a1a2e; min-height: 100vh; -webkit-font-smoothing: antialiased; }
    a { color: var(--primary); }
    .container { max-width: 720px; margin: 0 auto; padding: 24px 20px; }
    .nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; max-width: 720px; margin: 0 auto; }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; color: #1a1a2e; text-decoration: none; }
    .brand img { max-height: 28px; }
    .nav-link { font-size: 13px; color: #666; text-decoration: none; font-weight: 500; }
    .nav-link:hover { color: var(--primary); }
    .card { background: #fff; border-radius: 16px; padding: 28px 24px; box-shadow: 0 1px 3px rgba(11,31,58,0.06), 0 1px 2px rgba(11,31,58,0.04); margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
    .muted { color: #6b7280; font-size: 14px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 12px 24px; border-radius: 10px; background: var(--primary); color: #fff; font-weight: 600; font-size: 15px; border: none; cursor: pointer; text-decoration: none; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.92; }
    .btn-ghost { background: transparent; color: var(--primary); border: 1px solid #e5e7eb; }
    .input { width: 100%; padding: 14px 16px; border-radius: 10px; border: 1px solid #d1d5db; font-size: 15px; font-family: inherit; outline: none; transition: border 0.2s; }
    .input:focus { border-color: var(--primary); }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-approved { background: #dcfce7; color: #166534; }
    .badge-denied { background: #fecaca; color: #991b1b; }
    .badge-shipped { background: #dbeafe; color: #1e40af; }
    .badge-delivered { background: #dcfce7; color: #166534; }
    .footer { text-align: center; padding: 32px 0 20px; font-size: 12px; color: #9ca3af; }
    .err { background: #fef2f2; color: #991b1b; padding: 12px 16px; border-radius: 10px; font-size: 14px; margin-bottom: 16px; }
    .ok { background: #ecfdf5; color: #065f46; padding: 12px 16px; border-radius: 10px; font-size: 14px; margin-bottom: 16px; }
  `;
}

function brandHeader(partner: PartnerConfig, loggedIn: boolean): string {
  const name = esc(partner.businessName);
  const logo = partner.logoUrl
    ? `<img src="${esc(partner.logoUrl)}" alt="${name}" onerror="this.style.display='none'">`
    : "";
  return `
  <div class="nav">
    <a class="brand" href="/portal/dashboard">${logo || name}</a>
    ${loggedIn ? `<a class="nav-link" href="/portal/logout">Sign out</a>` : ""}
  </div>`;
}

function htmlShell(partner: PartnerConfig, title: string, body: string, loggedIn = true): string {
  const font = partner.font || "Inter";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)} — ${esc(partner.businessName)}</title>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${baseStyles(partner)}</style>
</head>
<body>
${brandHeader(partner, loggedIn)}
<div class="container">
${body}
</div>
<div class="footer">&copy; ${new Date().getFullYear()} ${esc(partner.businessName)}. All rights reserved.</div>
</body>
</html>`;
}

function renderLoginPage(
  partner: PartnerConfig,
  opts: { error?: string | null; sent?: string | null },
): string {
  const errorMsg =
    opts.error === "expired" ? "That sign-in link has expired. Request a new one below."
    : opts.error === "invalid" ? "That sign-in link is invalid. Request a new one below."
    : opts.error === "wrong_tenant" ? "That sign-in link was for a different account."
    : opts.error === "missing" ? "Please enter your email address."
    : null;

  const sentMsg = opts.sent
    ? `If an account exists for that email, we just sent a sign-in link. It expires in 15 minutes.`
    : null;

  const body = `
<div class="card" style="max-width:420px;margin:48px auto 0;">
  <h1>Sign in</h1>
  <p class="muted" style="margin-bottom:20px">Enter the email you used at checkout and we'll send you a sign-in link.</p>
  ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ""}
  ${sentMsg ? `<div class="ok">${esc(sentMsg)}</div>` : ""}
  <form method="POST" action="/portal/auth">
    <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Email address</label>
    <input class="input" name="email" type="email" required autocomplete="email" placeholder="you@example.com" style="margin-bottom:16px">
    <button class="btn" type="submit" style="width:100%">Send sign-in link</button>
  </form>
</div>
  `;
  return htmlShell(partner, "Sign in", body, false);
}

function renderDashboard(partner: PartnerConfig, cases: PendingCase[]): string {
  const firstName = cases[0]?.patientName?.split(" ")[0] || "there";

  const orderCards = cases.length === 0
    ? `<div class="card"><p class="muted">You don't have any orders yet. If you just submitted an intake, refresh in a minute.</p></div>`
    : cases.map((c) => {
        const status = summarizeStatus(c);
        return `
<a href="/portal/orders/${esc(c.paymentIntentId)}" style="text-decoration:none;color:inherit">
  <div class="card" style="cursor:pointer;transition:transform 0.15s">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
      <div style="font-size:16px;font-weight:600;color:#1a1a2e">${esc(c.serviceName)}</div>
      <span class="badge ${status.badgeClass}">${esc(status.badgeLabel)}</span>
    </div>
    <div class="muted" style="font-size:13px;margin-bottom:8px">Ordered ${new Date(c.createdAt).toLocaleDateString()}</div>
    <div style="font-size:14px;color:#374151">${esc(status.message)}</div>
    <div style="margin-top:12px;font-size:13px;color:var(--primary);font-weight:600">View details →</div>
  </div>
</a>`;
      }).join("");

  const body = `
<div style="margin-bottom:16px">
  <h1>Welcome back, ${esc(firstName)}</h1>
  <p class="muted">${cases.length === 1 ? "Your order and its current status." : cases.length > 1 ? `Your ${cases.length} orders and their current status.` : "Once you place an order you'll see it here."}</p>
</div>
${orderCards}
`;
  return htmlShell(partner, "Dashboard", body);
}

interface StatusSummary {
  badgeClass: string;
  badgeLabel: string;
  message: string;
}

function summarizeStatus(c: PendingCase): StatusSummary {
  if (c.status === "denied") {
    return {
      badgeClass: "badge-denied",
      badgeLabel: "Not Approved",
      message: "Your provider was unable to approve this prescription. See details for more.",
    };
  }
  if (c.status === "pending") {
    return {
      badgeClass: "badge-pending",
      badgeLabel: "Under Review",
      message: "Your intake is being reviewed by your provider. This typically takes 1–2 business days.",
    };
  }
  // Approved
  if (c.orderStatus === "delivered") {
    return {
      badgeClass: "badge-delivered",
      badgeLabel: "Delivered",
      message: "Delivered. Follow the dosing instructions included with your shipment.",
    };
  }
  if (c.orderStatus === "shipped") {
    return {
      badgeClass: "badge-shipped",
      badgeLabel: "Shipped",
      message: c.trackingNumber
        ? `On the way — tracking ${c.trackingNumber}`
        : "On the way!",
    };
  }
  if (c.orderStatus === "prescribed") {
    return {
      badgeClass: "badge-approved",
      badgeLabel: "Sent to Pharmacy",
      message: "Your prescription has been approved and is being prepared by the pharmacy.",
    };
  }
  return {
    badgeClass: "badge-approved",
    badgeLabel: "Approved",
    message: "Your prescription has been approved.",
  };
}

function renderOrderDetail(partner: PartnerConfig, c: PendingCase): string {
  const summary = summarizeStatus(c);
  const primary = partner.brandColors.primary || "#0B1F3A";

  // Main timeline steps
  const isPending = c.status === "pending";
  const isDenied = c.status === "denied";
  const isApproved = c.status === "approved";
  const step1Done = true;
  const step2Done = isApproved || isDenied;
  const step3Done = isApproved && (c.orderStatus === "prescribed" || c.orderStatus === "shipped" || c.orderStatus === "delivered");
  const step4Done = isApproved && (c.orderStatus === "shipped" || c.orderStatus === "delivered");
  const step5Done = isApproved && c.orderStatus === "delivered";

  const stepDot = (done: boolean, active: boolean, n: number) => {
    const style = done
      ? `background:${primary};color:#fff;`
      : active
        ? `background:${primary}20;color:${primary};border:2px solid ${primary};`
        : `background:#e5e7eb;color:#9ca3af;`;
    return `<div style="position:absolute;left:-48px;top:0;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;${style}">${done ? "✓" : n}</div>`;
  };

  const stepLabel = (done: boolean, text: string) =>
    `<div style="font-size:15px;font-weight:${done ? "600" : "500"};color:${done ? "#1a1a2e" : "#9ca3af"}">${esc(text)}</div>`;

  const timestamp = (iso?: string) =>
    iso ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px">${new Date(iso).toLocaleDateString()}</div>` : "";

  // Blood work lane (only shown when relevant)
  const showBloodwork = c.bloodworkStatus === "buy-kit" || c.bloodworkStatus === "have-labs";
  let bloodworkHtml = "";
  if (showBloodwork) {
    const kitShipped = !!c.bloodworkKitShipped || !!c.bloodworkKitShippedAt;
    const received = !!c.bloodworkReceivedAt;
    const reviewed = !!c.bloodworkReviewedAt;

    if (c.bloodworkStatus === "buy-kit") {
      bloodworkHtml = `
<div class="card">
  <h2>Blood Work</h2>
  <p class="muted" style="font-size:13px;margin-bottom:20px">Your blood work kit and provider review.</p>
  <div style="position:relative;padding-left:48px">
    <div style="position:absolute;left:19px;top:8px;bottom:8px;width:2px;background:#e5e7eb"></div>
    <div style="position:relative;padding-bottom:20px">
      ${stepDot(true, false, 1)}
      ${stepLabel(true, "Kit ordered")}
      ${timestamp(c.createdAt)}
    </div>
    <div style="position:relative;padding-bottom:20px">
      ${stepDot(kitShipped, !kitShipped, 2)}
      ${stepLabel(kitShipped, "Kit shipped to you")}
      ${timestamp(c.bloodworkKitShippedAt)}
    </div>
    <div style="position:relative;padding-bottom:20px">
      ${stepDot(received, kitShipped && !received, 3)}
      ${stepLabel(received, "Sample received by lab")}
      ${timestamp(c.bloodworkReceivedAt)}
    </div>
    <div style="position:relative">
      ${stepDot(reviewed, received && !reviewed, 4)}
      ${stepLabel(reviewed, "Results reviewed by provider")}
      ${timestamp(c.bloodworkReviewedAt)}
    </div>
  </div>
</div>`;
    } else {
      // have-labs — patient uploaded file
      bloodworkHtml = `
<div class="card">
  <h2>Blood Work</h2>
  <p class="muted" style="font-size:13px;margin-bottom:20px">Lab file you uploaded at intake.</p>
  <div style="position:relative;padding-left:48px">
    <div style="position:absolute;left:19px;top:8px;bottom:8px;width:2px;background:#e5e7eb"></div>
    <div style="position:relative;padding-bottom:20px">
      ${stepDot(true, false, 1)}
      ${stepLabel(true, "Lab file uploaded")}
      ${timestamp(c.createdAt)}
    </div>
    <div style="position:relative">
      ${stepDot(!!c.bloodworkReviewedAt, !c.bloodworkReviewedAt, 2)}
      ${stepLabel(!!c.bloodworkReviewedAt, "Reviewed by provider")}
      ${timestamp(c.bloodworkReviewedAt)}
    </div>
  </div>
</div>`;
    }
  }

  // Tracking card
  const trackingHtml = c.trackingNumber ? `
<div class="card">
  <h2>Shipping</h2>
  ${c.carrier ? `<div style="font-size:14px;margin-bottom:4px"><strong>Carrier:</strong> ${esc(c.carrier)}</div>` : ""}
  <div style="font-size:14px;margin-bottom:12px"><strong>Tracking:</strong> ${esc(c.trackingNumber)}</div>
  ${c.trackingUrl ? `<a class="btn" href="${esc(c.trackingUrl)}" target="_blank" rel="noopener">Track package</a>` : ""}
</div>` : "";

  // Dosing card
  const dosingHtml = c.orderStatus === "delivered" && c.dosingResult?.startingDose ? `
<div class="card">
  <h2>Your starting dose</h2>
  <p style="font-size:22px;font-weight:700;color:var(--primary);margin:8px 0">${esc(c.dosingResult.startingDose)}</p>
  <p class="muted" style="font-size:13px">Follow the instructions included with your medication. Contact your provider with any questions.</p>
</div>` : "";

  // Denied card
  const deniedHtml = isDenied ? `
<div class="card">
  <h2>Provider's note</h2>
  ${c.denyReason ? `<p style="font-size:14px;color:#374151;margin-bottom:12px">${esc(c.denyReason)}</p>` : `<p class="muted">No additional notes from the provider.</p>`}
  <p class="muted" style="font-size:13px">Your card was <strong>not</strong> charged. Reply to any email from ${esc(partner.businessName)} if you have questions.</p>
</div>` : "";

  const body = `
<div style="margin-bottom:16px">
  <a href="/portal/dashboard" class="nav-link" style="display:inline-block;margin-bottom:12px">← Back to dashboard</a>
  <h1>${esc(c.serviceName)}</h1>
  <p class="muted">Ordered ${new Date(c.createdAt).toLocaleDateString()}</p>
</div>

<div class="card">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px">
    <div style="font-size:15px;color:#374151">${esc(summary.message)}</div>
    <span class="badge ${summary.badgeClass}">${esc(summary.badgeLabel)}</span>
  </div>

  ${isDenied ? "" : `
  <div style="position:relative;padding-left:48px">
    <div style="position:absolute;left:19px;top:8px;bottom:8px;width:2px;background:#e5e7eb"></div>
    <div style="position:relative;padding-bottom:24px">
      ${stepDot(step1Done, false, 1)}
      ${stepLabel(step1Done, "Intake submitted")}
      ${timestamp(c.createdAt)}
    </div>
    <div style="position:relative;padding-bottom:24px">
      ${stepDot(step2Done, isPending, 2)}
      ${stepLabel(step2Done, isPending ? "Awaiting physician approval" : "Provider reviewed")}
      ${timestamp(c.resolvedAt)}
    </div>
    <div style="position:relative;padding-bottom:24px">
      ${stepDot(step3Done, step2Done && !step3Done, 3)}
      ${stepLabel(step3Done, "Sent to pharmacy")}
    </div>
    <div style="position:relative;padding-bottom:24px">
      ${stepDot(step4Done, step3Done && !step4Done, 4)}
      ${stepLabel(step4Done, "Shipped")}
      ${timestamp(c.shippedAt)}
    </div>
    <div style="position:relative">
      ${stepDot(step5Done, step4Done && !step5Done, 5)}
      ${stepLabel(step5Done, "Delivered")}
      ${timestamp(c.deliveredAt)}
    </div>
  </div>
  `}
</div>

${deniedHtml}
${bloodworkHtml}
${trackingHtml}
${dosingHtml}
`;
  return htmlShell(partner, c.serviceName, body);
}

function renderNotFound(partner: PartnerConfig): string {
  const body = `
<div class="card" style="text-align:center;margin-top:48px">
  <h1>Order not found</h1>
  <p class="muted" style="margin:12px 0 24px">We couldn't find that order under your account.</p>
  <a class="btn" href="/portal/dashboard">Back to dashboard</a>
</div>`;
  return htmlShell(partner, "Not found", body);
}

export default portal;
