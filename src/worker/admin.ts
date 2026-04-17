import { Hono } from "hono";
import { Env, PartnerConfig, ServiceId } from "../lib/types";
import {
  getPartner,
  savePartner,
  listPartners,
  savePortalDomainIndex,
  deletePortalDomainIndex,
} from "../lib/kv";
import { getServiceById } from "../lib/services";
import {
  createOrganization,
  buildIntakeQuestionnaire,
  createPatient as createMedplumPatient,
  createQuestionnaireResponse,
  createComposition,
} from "./medplum";
import { healthCheck as prescribeRxHealthCheck } from "./prescribe-rx";

const admin = new Hono<{ Bindings: Env }>();

// Auth middleware — check session cookie
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

admin.use("*", async (c, next) => {
  const path = c.req.path;

  // Allow login page and login POST without auth
  if (
    path === "/admin/login" ||
    path === "/admin/auth" ||
    path === "/admin/medplum-healthcheck"
  ) {
    return next();
  }

  // Check session cookie
  const sessionCookie = c.req
    .header("Cookie")
    ?.match(/admin_session=([^;]+)/)?.[1];
  if (!sessionCookie) {
    return c.redirect("/admin/login");
  }

  // Verify session (simple: cookie = hash of password hash + date)
  const today = new Date().toISOString().split("T")[0];
  const expectedSession = await hashPassword(c.env.ADMIN_PASSWORD_HASH + today);
  if (sessionCookie !== expectedSession) {
    return c.redirect("/admin/login");
  }

  return next();
});

// Login page
admin.get("/login", (c) => {
  return c.html(LOGIN_HTML);
});

// Login handler
admin.post("/auth", async (c) => {
  const body = await c.req.parseBody();
  const email = ((body.email as string) || "").toLowerCase().trim();
  const password = (body.password as string) || "";

  const passwordHash = await hashPassword(password);
  const storedHash = c.env.ADMIN_PASSWORD_HASH.trim();
  const storedEmail = c.env.ADMIN_EMAIL.trim();

  console.log("Login attempt:", {
    email,
    storedEmail,
    emailMatch: email === storedEmail,
    hashMatch: passwordHash === storedHash,
    passwordHash,
    storedHash,
  });

  if (email === storedEmail && passwordHash === storedHash) {
    const today = new Date().toISOString().split("T")[0];
    const sessionToken = await hashPassword(c.env.ADMIN_PASSWORD_HASH + today);

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/admin",
        "Set-Cookie": `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
      },
    });
  }

  return c.html(
    LOGIN_HTML.replace(
      "</form>",
      '<p style="color:#dc2626;margin-top:12px;font-size:14px">Invalid email or password</p></form>',
    ),
  );
});

// Dashboard — list all partners
admin.get("/", async (c) => {
  const slugs = await listPartners(c.env.PARTNERS);
  const partners = (
    await Promise.all(slugs.map((s) => getPartner(c.env.PARTNERS, s)))
  ).filter(Boolean) as PartnerConfig[];

  return c.html(renderDashboard(partners));
});

// Partner detail / edit
admin.get("/partner/:slug", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);

  const hasDashboardPassword = !!(await c.env.PARTNERS.get(
    `partner_password_hash:${partner.slug}`,
  ));
  return c.html(renderPartnerDetail(partner, hasDashboardPassword));
});

// Update partner config
admin.post("/partner/:slug", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);

  const body = await c.req.json();

  // Update fields
  if (body.enabled !== undefined) partner.enabled = body.enabled;
  if (body.businessName) partner.businessName = body.businessName;
  if (body.contactEmail) partner.contactEmail = body.contactEmail;
  if (body.websiteUrl) partner.websiteUrl = body.websiteUrl;
  if (body.logoUrl) partner.logoUrl = body.logoUrl;
  if (body.primaryColor) partner.brandColors.primary = body.primaryColor;
  if (body.secondaryColor) partner.brandColors.secondary = body.secondaryColor;
  if (body.font) partner.font = body.font;
  // Branded email sender config
  if (body.senderEmail !== undefined)
    partner.senderEmail = body.senderEmail || undefined;
  if (body.senderName !== undefined)
    partner.senderName = body.senderName || undefined;
  if (body.resendApiKey !== undefined)
    partner.resendApiKey = body.resendApiKey || undefined;
  // Patient portal subdomain — keep the portal_host reverse index in sync
  // so the Host-based router can resolve tenant in O(1) per request.
  if (body.portalDomain !== undefined) {
    const normalized =
      (body.portalDomain as string)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "") || undefined;
    const old = partner.portalDomain;
    if (old && old !== normalized) {
      await deletePortalDomainIndex(c.env.PARTNERS, old);
    }
    partner.portalDomain = normalized;
    if (normalized) {
      await savePortalDomainIndex(c.env.PARTNERS, normalized, partner.slug);
    }
  }

  // Update platform fees
  if (body.platformFees) {
    partner.platformFees = body.platformFees;
  }

  // Update service prices
  if (body.services) {
    for (const update of body.services) {
      const service = partner.services.find((s) => s.type === update.type);
      if (service) {
        if (update.initialPrice !== undefined)
          service.initialPrice = update.initialPrice;
        if (update.subscriptionPrice !== undefined)
          service.subscriptionPrice = update.subscriptionPrice;
      }
    }
  }

  await savePartner(c.env.PARTNERS, partner);
  return c.json({ success: true });
});

// Toggle partner enabled/disabled
admin.post("/partner/:slug/toggle", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  partner.enabled = !partner.enabled;
  await savePartner(c.env.PARTNERS, partner);
  return c.json({ success: true, enabled: partner.enabled });
});

// Backfill patient portal indexes for a partner. Walks every PendingCase,
// rebuilds `patient_cases:*` and `patient_email:*:*` so the portal can
// immediately serve orders placed before the portal existed. Safe to run
// multiple times — adds are idempotent. Only touches the given partner.
admin.post("/partner/:slug/backfill-portal-index", async (c) => {
  const slug = c.req.param("slug");
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) return c.json({ error: "Not found" }, 404);

  // Lazy imports to keep admin module lean at boot
  const { listAllCases, addCaseToPatientIndex, savePatientEmailIndex } =
    await import("../lib/kv");
  const cases = await listAllCases(c.env.PARTNERS);

  let indexed = 0;
  let skipped = 0;
  for (const pc of cases) {
    if (pc.partnerSlug !== slug) continue;
    if (!pc.medplumPatientId || !pc.patientEmail) {
      skipped++;
      continue;
    }
    await addCaseToPatientIndex(
      c.env.PARTNERS,
      pc.medplumPatientId,
      pc.paymentIntentId,
    );
    await savePatientEmailIndex(
      c.env.PARTNERS,
      slug,
      pc.patientEmail,
      pc.medplumPatientId,
    );
    indexed++;
  }

  return c.json({ success: true, indexed, skipped, partner: slug });
});

// Set partner dashboard password (for influencer login)
admin.post("/partner/:slug/set-dashboard-password", async (c) => {
  const slug = c.req.param("slug");
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const password = ((body.password as string) || "").trim();
  if (!password || password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  const hash = await hashPassword(password);
  await c.env.PARTNERS.put(`partner_password_hash:${slug}`, hash);
  return c.json({ success: true });
});

// Backfill partner case index — walks every PendingCase, rebuilds
// `partner_cases:${slug}` so the partner dashboard can list orders
// placed before the dashboard existed. Safe to run multiple times.
admin.post("/partner/:slug/backfill-partner-cases", async (c) => {
  const slug = c.req.param("slug");
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) return c.json({ error: "Not found" }, 404);

  const { listAllCases, addCaseToPartnerIndex } = await import("../lib/kv");
  const cases = await listAllCases(c.env.PARTNERS);

  let indexed = 0;
  for (const pc of cases) {
    if (pc.partnerSlug !== slug) continue;
    await addCaseToPartnerIndex(c.env.PARTNERS, slug, pc.paymentIntentId);
    indexed++;
  }

  return c.json({ success: true, indexed, partner: slug });
});

// Cancel (void) a pending payment authorization
admin.post("/case/:id/cancel-auth", async (c) => {
  const id = c.req.param("id");
  const { getPendingCase, savePendingCase } = await import("../lib/kv");
  const pc = await getPendingCase(c.env.PARTNERS, id);
  if (!pc) return c.json({ error: "Case not found" }, 404);
  if (pc.status !== "pending")
    return c.json({ error: "Case is not pending" }, 400);

  // Cancel the Stripe auth hold
  if (!id.startsWith("bypass_")) {
    const { createStripeClient } = await import("./stripe");
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
    try {
      await stripe.paymentIntents.cancel(id);
    } catch (err: any) {
      return c.json(
        { error: "Stripe cancel failed: " + (err?.message || err) },
        500,
      );
    }
  }

  pc.status = "denied";
  pc.denyReason = "Duplicate order — authorization voided";
  pc.resolvedAt = new Date().toISOString();
  await savePendingCase(c.env.PARTNERS, pc);
  return c.json({ success: true, cancelled: id });
});

// Update platform fees for a partner
admin.post("/partner/:slug/fees", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  partner.platformFees = body.fees || {};
  await savePartner(c.env.PARTNERS, partner);
  return c.json({ success: true });
});

// Repair missing Medplum org + questionnaires for a partner
// Use ?service=org to create the Organization first
// Use ?service=semaglutide to create one questionnaire at a time
// Without ?service, lists what's missing
admin.post("/partner/:slug/repair-medplum", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  const targetService = c.req.query("service");
  const existingQIds = partner.medplumQuestionnaireIds || {};

  // List what's missing
  if (!targetService) {
    const missing = partner.services
      .filter((s) => !existingQIds[s.type])
      .map((s) => s.type);
    return c.json({
      needsOrg: !partner.medplumOrgId,
      medplumOrgId: partner.medplumOrgId || null,
      missingQuestionnaires: missing,
      existingQuestionnaires: Object.keys(existingQIds),
    });
  }

  // Create Organization
  if (targetService === "org") {
    if (partner.medplumOrgId) {
      return c.json(
        {
          error: "Organization already exists",
          medplumOrgId: partner.medplumOrgId,
        },
        400,
      );
    }
    try {
      const org = await createOrganization(
        c.env,
        partner.businessName,
        partner.slug,
      );
      partner.medplumOrgId = org.id;
      await savePartner(c.env.PARTNERS, partner);
      return c.json({ success: true, medplumOrgId: org.id });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  }

  // Create Questionnaire for a specific service
  if (!partner.medplumOrgId) {
    return c.json(
      { error: "Create Organization first: POST ?service=org" },
      400,
    );
  }

  const serviceDef = getServiceById(targetService);
  if (!serviceDef)
    return c.json({ error: `Unknown service: ${targetService}` }, 400);
  if (existingQIds[targetService]) {
    return c.json(
      {
        error: `Questionnaire already exists for ${targetService}`,
        questionnaireId: existingQIds[targetService],
      },
      400,
    );
  }

  try {
    const q = await buildIntakeQuestionnaire(
      c.env,
      serviceDef,
      partner.businessName,
    );
    existingQIds[targetService] = q.id;
    partner.medplumQuestionnaireIds = existingQIds;
    await savePartner(c.env.PARTNERS, partner);
    return c.json({
      success: true,
      service: targetService,
      questionnaireId: q.id,
      allQuestionnaireIds: existingQIds,
    });
  } catch (err) {
    return c.json({ error: String(err), service: targetService }, 500);
  }
});

// ─── Partner Email Domain Setup ─────────────────────────────

// Step 1: Add domain to MOH's Resend account → returns DNS records
admin.post("/partner/:slug/setup-email", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const domain = body.domain as string;
  if (!domain || !domain.includes("."))
    return c.json(
      { error: "Provide a valid domain (e.g. beverlyhillsdrip.com)" },
      400,
    );

  // Create domain in Resend
  try {
    const res = await fetch("https://api.resend.com/domains", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ name: domain }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return c.json(
        { error: `Resend API error: ${res.status} ${errText}` },
        500,
      );
    }

    const data = (await res.json()) as {
      id: string;
      name: string;
      status: string;
      records: Array<{
        record: string;
        name: string;
        type: string;
        value: string;
        ttl: number;
        status: string;
        priority?: number | null;
      }>;
    };

    // Save domain info on partner
    partner.resendDomainId = data.id;
    partner.resendDomainStatus = "not_started";
    partner.resendDnsRecords = data.records;
    partner.senderEmail = `noreply@${domain}`;
    partner.senderName = partner.senderName || partner.businessName;
    await savePartner(c.env.PARTNERS, partner);

    return c.json({
      success: true,
      domainId: data.id,
      domain: data.name,
      senderEmail: partner.senderEmail,
      dnsRecords: data.records,
      message:
        "Domain created. Add these DNS records to your registrar, then call /verify-email.",
    });
  } catch (err) {
    return c.json({ error: `Failed to create domain: ${String(err)}` }, 500);
  }
});

// Step 2: Trigger verification + check status
admin.post("/partner/:slug/verify-email", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);
  if (!partner.resendDomainId)
    return c.json(
      { error: "No domain configured. Call /setup-email first." },
      400,
    );

  try {
    // Trigger verification
    await fetch(
      `https://api.resend.com/domains/${partner.resendDomainId}/verify`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      },
    );

    // Check current status
    const res = await fetch(
      `https://api.resend.com/domains/${partner.resendDomainId}`,
      {
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      },
    );

    if (!res.ok) {
      return c.json({ error: `Resend API error: ${res.status}` }, 500);
    }

    const data = (await res.json()) as {
      id: string;
      name: string;
      status: string;
      records: Array<{
        record: string;
        name: string;
        type: string;
        value: string;
        ttl: number;
        status: string;
        priority?: number | null;
      }>;
    };

    // Update partner with latest status
    const status =
      data.status === "verified"
        ? "verified"
        : data.status === "pending"
          ? "pending"
          : data.status === "failure" || data.status === "temporary_failure"
            ? "failed"
            : "not_started";
    partner.resendDomainStatus = status as any;
    partner.resendDnsRecords = data.records;
    await savePartner(c.env.PARTNERS, partner);

    return c.json({
      success: true,
      domainId: data.id,
      domain: data.name,
      status: data.status,
      verified: data.status === "verified",
      records: data.records.map((r) => ({
        record: r.record,
        name: r.name,
        type: r.type,
        status: r.status,
      })),
      message:
        data.status === "verified"
          ? "Domain verified! Emails will now send from " + partner.senderEmail
          : "Verification in progress. Check that all DNS records are added correctly.",
    });
  } catch (err) {
    return c.json({ error: `Verification failed: ${String(err)}` }, 500);
  }
});

// Step 3: Get current email setup status + DNS records
admin.get("/partner/:slug/email-status", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  if (!partner.resendDomainId) {
    return c.json({
      configured: false,
      message:
        "No email domain set up. POST /admin/partner/" +
        partner.slug +
        "/setup-email with { domain: 'yourdomain.com' }",
    });
  }

  return c.json({
    configured: true,
    senderEmail: partner.senderEmail,
    senderName: partner.senderName,
    domainId: partner.resendDomainId,
    status: partner.resendDomainStatus,
    verified: partner.resendDomainStatus === "verified",
    dnsRecords: partner.resendDnsRecords,
  });
});

// ============================================================
// HTML Templates
// ============================================================

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - My Orbit Health</title>
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
    <h1>Admin Login</h1>
    <p class="subtitle">My Orbit Health Admin Panel</p>
    <form method="POST" action="/admin/auth">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required placeholder="admin@myorbithealth.com">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required placeholder="Enter password">
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;

function renderDashboard(partners: PartnerConfig[]): string {
  const serviceLabels: Record<string, string> = {
    semaglutide: "Semaglutide",
    tirzepatide: "Tirzepatide",
    retatrutide: "Retatrutide",
    sildenafil: "Sildenafil",
    tadalafil: "Tadalafil",
    "testosterone-injectable": "TRT Injectable",
    "testosterone-oral": "TRT Oral",
    enclomiphene: "Enclomiphene",
    "estrogen-cream-vaginal": "Estrogen Cream (Vaginal)",
    "estrogen-cream-systemic": "Estrogen Cream (Systemic)",
    "estrogen-patches": "Estrogen Patches",
    "mots-c": "MOTS-c",
    nad: "NAD+",
    "bpc-157": "BPC-157",
    "tb-500": "TB-500",
    wolverine: "Wolverine",
    glo: "GLO",
    klow: "KLOW",
  };

  const partnerRows = partners
    .map((p) => {
      const services = (p.services || [])
        .map((s) => serviceLabels[s.type] || s.type)
        .join(", ");
      const statusColor = p.enabled !== false ? "#22c55e" : "#dc2626";
      const statusText = p.enabled !== false ? "Active" : "Disabled";
      return `<tr onclick="window.location='/admin/partner/${p.slug}'" style="cursor:pointer">
      <td><strong>${p.businessName}</strong><br><span style="color:#888;font-size:12px">${p.slug}</span></td>
      <td>${services}</td>
      <td>${p.paymentMode === "platform" ? "Platform" : "Direct"}</td>
      <td><span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${statusColor}20;color:${statusColor}">${statusText}</span></td>
      <td style="color:#888;font-size:13px">${new Date(p.createdAt).toLocaleDateString()}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin - My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; }
    .header .badge { font-size: 12px; color: #888; }
    .container { max-width: 1200px; margin: 0 auto; padding: 32px; }
    h2 { font-size: 18px; margin-bottom: 16px; }
    .stats { display: flex; gap: 16px; margin-bottom: 32px; }
    .stat-card { background: #fff; border-radius: 10px; padding: 20px; flex: 1; border: 1px solid #e8e8e8; }
    .stat-card .value { font-size: 28px; font-weight: 700; }
    .stat-card .label { font-size: 13px; color: #888; margin-top: 4px; }
    table { width: 100%; background: #fff; border-radius: 10px; border: 1px solid #e8e8e8; border-collapse: collapse; }
    th { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e8e8e8; }
    td { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    tr:hover { background: #fafafa; }
    tr:last-child td { border-bottom: none; }
    .empty { text-align: center; padding: 60px; color: #888; }
    a.logout { color: #888; font-size: 13px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>My Orbit Health <span class="badge">Admin</span></h1>
    <a class="logout" href="/admin/login">Logout</a>
  </div>
  <div class="container">
    <div class="stats">
      <div class="stat-card"><div class="value">${partners.length}</div><div class="label">Total Partners</div></div>
      <div class="stat-card"><div class="value">${partners.filter((p) => p.enabled !== false).length}</div><div class="label">Active</div></div>
      <div class="stat-card"><div class="value">${partners.reduce((sum, p) => sum + (p.services?.length || 0), 0)}</div><div class="label">Total Services</div></div>
      <div class="stat-card"><div class="value">${partners.filter((p) => p.paymentMode === "platform").length}</div><div class="label">Platform Mode</div></div>
    </div>

    <h2>Partners</h2>
    ${
      partners.length > 0
        ? `
    <table>
      <thead><tr><th>Partner</th><th>Services</th><th>Payment</th><th>Status</th><th>Joined</th></tr></thead>
      <tbody>${partnerRows}</tbody>
    </table>`
        : '<div class="empty">No partners yet. Partners will appear here after they complete the onboarding form.</div>'
    }
  </div>
</body>
</html>`;
}

function renderPartnerDetail(
  partner: PartnerConfig,
  hasDashboardPassword = false,
): string {
  const serviceLabels: Record<string, string> = {
    semaglutide: "Semaglutide",
    tirzepatide: "Tirzepatide",
    retatrutide: "Retatrutide",
    sildenafil: "Sildenafil",
    tadalafil: "Tadalafil",
    "testosterone-injectable": "TRT Injectable",
    "testosterone-oral": "TRT Oral",
    enclomiphene: "Enclomiphene",
    "estrogen-cream-vaginal": "Estrogen Cream (Vaginal)",
    "estrogen-cream-systemic": "Estrogen Cream (Systemic)",
    "estrogen-patches": "Estrogen Patches",
    "mots-c": "MOTS-c",
    nad: "NAD+",
    "bpc-157": "BPC-157",
    "tb-500": "TB-500",
    wolverine: "Wolverine",
    glo: "GLO",
    klow: "KLOW",
  };

  const feeRows = (partner.services || [])
    .map((s) => {
      const label = serviceLabels[s.type] || s.type;
      const fee = partner.platformFees?.[s.type] || 0;
      const influencerGets = s.initialPrice - fee;
      return `<tr>
      <td>${label}</td>
      <td>$${s.initialPrice}</td>
      <td>$${s.subscriptionPrice}/mo</td>
      <td><input type="number" class="fee-input" data-service="${s.type}" value="${fee}" min="0" style="width:80px;padding:6px 8px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:14px;text-align:center"></td>
      <td class="influencer-gets" data-service="${s.type}">$${influencerGets}</td>
    </tr>`;
    })
    .join("");

  const statusColor = partner.enabled !== false ? "#22c55e" : "#dc2626";
  const statusText = partner.enabled !== false ? "Active" : "Disabled";
  const toggleText = partner.enabled !== false ? "Disable" : "Enable";
  const toggleColor = partner.enabled !== false ? "#dc2626" : "#22c55e";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${partner.businessName} - Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; }
    .back { color: #4F46E5; text-decoration: none; font-size: 14px; }
    .container { max-width: 900px; margin: 0 auto; padding: 32px; }
    .card { background: #fff; border-radius: 10px; border: 1px solid #e8e8e8; padding: 24px; margin-bottom: 20px; }
    .card h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${statusColor}20; color: ${statusColor}; }
    .field-row { display: flex; gap: 16px; margin-bottom: 12px; }
    .field-row > div { flex: 1; }
    .field-label { font-size: 12px; font-weight: 600; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .field-value { font-size: 14px; }
    .color-swatch { display: inline-block; width: 20px; height: 20px; border-radius: 4px; vertical-align: middle; margin-right: 6px; border: 1px solid #e0e0e0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e8e8e8; }
    td { padding: 12px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: #4F46E5; color: #fff; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-success { background: #22c55e; color: #fff; }
    .btn-outline { background: #fff; color: #333; border: 1.5px solid #d9d9d9; }
    .btn-row { display: flex; gap: 8px; margin-top: 16px; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #1a1a2e; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 14px; display: none; z-index: 100; }
    .toast.visible { display: block; }
    input.edit-input { padding: 8px 10px; border: 1.5px solid #d9d9d9; border-radius: 6px; font-size: 14px; font-family: inherit; width: 100%; }
    input.edit-input:focus { outline: none; border-color: #4F46E5; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${partner.businessName}</h1>
    <a class="back" href="/admin">&larr; All Partners</a>
  </div>
  <div class="container">
    <!-- Status -->
    <div class="card">
      <h3>Status <span class="status-badge">${statusText}</span></h3>
      <p style="font-size:14px;color:#666;margin-bottom:12px">Partner slug: <code>${partner.slug}</code></p>
      <button class="btn" style="background:${toggleColor};color:#fff" onclick="togglePartner()">${toggleText} Partner</button>
    </div>

    <!-- Brand Config -->
    <div class="card">
      <h3>Brand Configuration</h3>
      <div class="field-row">
        <div><div class="field-label">Business Name</div><input class="edit-input" id="businessName" value="${partner.businessName}"></div>
        <div><div class="field-label">Contact Email</div><input class="edit-input" id="contactEmail" value="${partner.contactEmail}"></div>
      </div>
      <div class="field-row">
        <div><div class="field-label">Website</div><input class="edit-input" id="websiteUrl" value="${partner.websiteUrl}"></div>
        <div><div class="field-label">Logo URL</div><input class="edit-input" id="logoUrl" value="${partner.logoUrl}"></div>
      </div>
      <div class="field-row">
        <div><div class="field-label">Primary Color</div><div class="field-value"><span class="color-swatch" style="background:${partner.brandColors.primary}"></span><input class="edit-input" id="primaryColor" value="${partner.brandColors.primary}" style="width:120px;display:inline-block"></div></div>
        <div><div class="field-label">Secondary Color</div><div class="field-value"><span class="color-swatch" style="background:${partner.brandColors.secondary}"></span><input class="edit-input" id="secondaryColor" value="${partner.brandColors.secondary}" style="width:120px;display:inline-block"></div></div>
        <div><div class="field-label">Font</div><div class="field-value">${partner.font}</div></div>
      </div>
      <div class="field-row">
        <div><div class="field-label">Payment Mode</div><div class="field-value">${partner.paymentMode === "platform" ? "Platform (MOH collects)" : "Direct (Own Stripe)"}</div></div>
        <div><div class="field-label">Joined</div><div class="field-value">${new Date(partner.createdAt).toLocaleDateString()}</div></div>
      </div>
      <div class="field-row">
        <div style="grid-column: 1 / -1">
          <div class="field-label">Patient Portal Domain</div>
          <input class="edit-input" id="portalDomain" value="${partner.portalDomain || ""}" placeholder="portal.kingdomlongevitylabs.com">
          <p style="font-size:11px;color:#888;margin-top:6px">Subdomain CNAMEd to the MOH worker. Leave blank if this partner doesn't have a patient portal yet. Must match the DNS CNAME you set up for the patient login URL.</p>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="saveBrand()">Save Changes</button>
      </div>
    </div>

    <!-- Pricing & Fees -->
    <div class="card">
      <h3>Services, Pricing & Platform Fees</h3>
      <p style="font-size:13px;color:#888;margin-bottom:16px">Set the flat dollar amount MOH keeps per service. The influencer receives the difference.</p>
      <table>
        <thead><tr><th>Service</th><th>Initial Price</th><th>Monthly</th><th>MOH Keeps</th><th>Influencer Gets</th></tr></thead>
        <tbody>${feeRows}</tbody>
      </table>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="saveFees()">Save Fees</button>
      </div>
    </div>

    <!-- Medplum Integration -->
    <div class="card">
      <h3>Medplum Integration</h3>
      <table>
        <tr><td style="padding:6px 0;color:#666;font-size:13px;width:180px">Organization ID</td><td style="padding:6px 0;font-size:13px;font-family:monospace">${partner.medplumOrgId ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534;margin-right:6px">LINKED</span>${partner.medplumOrgId}` : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">NOT SET</span>'}</td></tr>
        ${(partner.services || [])
          .map((s) => {
            const label = serviceLabels[s.type] || s.type;
            const qId = partner.medplumQuestionnaireIds?.[s.type];
            return `<tr><td style="padding:6px 0;color:#666;font-size:13px">${label} Questionnaire</td><td style="padding:6px 0;font-size:11px;font-family:monospace">${qId ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534;margin-right:6px">LINKED</span>${qId}` : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">NOT SET</span>'}</td></tr>`;
          })
          .join("")}
      </table>
    </div>

    <!-- Email Domain -->
    <div class="card">
      <h3>Email Sending Domain</h3>
      ${
        partner.resendDomainId
          ? `
        <table style="margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;width:180px">Sender</td><td style="padding:6px 0;font-size:14px;font-weight:600">${partner.senderName || partner.businessName} &lt;${partner.senderEmail || "not set"}&gt;</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px">Status</td><td style="padding:6px 0;font-size:13px">${
            partner.resendDomainStatus === "verified"
              ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">VERIFIED</span>'
              : partner.resendDomainStatus === "pending"
                ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e">PENDING</span>'
                : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">NOT VERIFIED</span>'
          }</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px">Domain ID</td><td style="padding:6px 0;font-size:11px;font-family:monospace;color:#888">${partner.resendDomainId}</td></tr>
        </table>
        ${
          partner.resendDnsRecords && partner.resendDnsRecords.length > 0
            ? `
          <div style="margin-bottom:16px">
            <p style="font-size:13px;font-weight:600;color:#333;margin-bottom:8px">DNS Records (add these to your registrar)</p>
            <table style="font-size:12px">
              <thead><tr><th style="text-align:left;padding:6px 8px;font-size:11px;color:#888">Type</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:#888">Name</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:#888">Value</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:#888">Status</th></tr></thead>
              <tbody>${partner.resendDnsRecords
                .map(
                  (r) => `
                <tr>
                  <td style="padding:6px 8px;font-weight:600">${r.record} (${r.type})</td>
                  <td style="padding:6px 8px;font-family:monospace;font-size:11px;word-break:break-all;max-width:200px">${r.name}</td>
                  <td style="padding:6px 8px;font-family:monospace;font-size:10px;word-break:break-all;max-width:300px">${r.value.length > 60 ? r.value.substring(0, 60) + "..." : r.value}</td>
                  <td style="padding:6px 8px">${
                    r.status === "verified"
                      ? '<span style="color:#22c55e;font-weight:600">Verified</span>'
                      : r.status === "pending"
                        ? '<span style="color:#f59e0b;font-weight:600">Pending</span>'
                        : '<span style="color:#dc2626;font-weight:600">Not Set</span>'
                  }</td>
                </tr>`,
                )
                .join("")}
              </tbody>
            </table>
          </div>`
            : ""
        }
        <button class="btn btn-primary" onclick="verifyEmail()">Check Verification</button>
      `
          : `
        <p style="font-size:14px;color:#666;margin-bottom:16px">No email domain configured. Patient emails are sent from <code>noreply@myorbithealth.com</code>.</p>
        <div style="display:flex;gap:8px;align-items:end">
          <div style="flex:1">
            <div class="field-label">Domain</div>
            <input class="edit-input" id="emailDomain" placeholder="e.g. beverlyhillsdrip.com">
          </div>
          <button class="btn btn-primary" onclick="setupEmail()">Set Up Domain</button>
        </div>
      `
      }
    </div>

    <!-- Patient Portal -->
    <div class="card">
      <h3>Patient Portal</h3>
      ${
        partner.portalDomain
          ? `
        <table style="margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;width:180px">Login URL</td><td style="padding:6px 0;font-size:14px;font-weight:600"><a href="https://${partner.portalDomain}/portal/login" target="_blank" style="color:#3b82f6">https://${partner.portalDomain}/portal/login</a></td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px">DNS</td><td style="padding:6px 0;font-size:12px;color:#666">Ensure a CNAME record for <code>${partner.portalDomain.replace(/^portal\./, "portal.")}</code> points to the MOH worker.</td></tr>
        </table>
        <p style="font-size:12px;color:#888;margin-bottom:12px">New orders placed after portal was configured automatically send a magic sign-in link. To populate the portal with previous orders, run the index backfill below.</p>
        <button class="btn btn-primary" onclick="backfillPortal()">Backfill Portal Index</button>
      `
          : `
        <p style="font-size:14px;color:#666;margin-bottom:8px">No portal domain configured. Set one under <strong>Brand Configuration</strong> above, then add a CNAME record pointing that subdomain at the MOH worker.</p>
      `
      }
    </div>

    <!-- Partner Dashboard -->
    <div class="card">
      <h3>Partner Dashboard</h3>
      ${
        partner.portalDomain
          ? `
        <table style="margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;font-size:13px;width:180px">Dashboard URL</td><td style="padding:6px 0;font-size:14px;font-weight:600"><a href="https://${partner.portalDomain}/partner/login" target="_blank" style="color:#3b82f6">https://${partner.portalDomain}/partner/login</a></td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:13px">Password</td><td style="padding:6px 0;font-size:13px">${
            hasDashboardPassword
              ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534">SET</span>'
              : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fecaca;color:#991b1b">NOT SET</span>'
          }</td></tr>
        </table>
        <div style="display:flex;gap:8px;align-items:end;margin-bottom:12px">
          <div style="flex:1">
            <div class="field-label">Set Dashboard Password</div>
            <input class="edit-input" id="dashboardPassword" type="password" placeholder="Min 6 characters">
          </div>
          <button class="btn btn-primary" onclick="setDashboardPassword()">Set Password</button>
        </div>
        <button class="btn btn-outline" onclick="backfillPartnerCases()">Backfill Case Index</button>
        <p style="font-size:11px;color:#888;margin-top:8px">Backfill populates the partner dashboard with orders placed before it was set up. Safe to run multiple times.</p>
      `
          : `
        <p style="font-size:14px;color:#666;margin-bottom:8px">Set a portal domain under <strong>Brand Configuration</strong> first. The partner dashboard lives at the same subdomain under <code>/partner/login</code>.</p>
      `
      }
    </div>

    <!-- Embed Codes -->
    <div class="card">
      <h3>Embed Codes</h3>
      ${(partner.services || [])
        .map((s) => {
          const label = serviceLabels[s.type] || s.type;
          return `<div style="margin-bottom:12px">
          <div class="field-label">${label}</div>
          <code style="font-size:12px;background:#f0f0f0;padding:8px 12px;border-radius:6px;display:block;word-break:break-all">&lt;iframe src="https://onboard.myorbithealth.com/form/${partner.slug}/${s.type}" style="width:100%;min-height:800px;border:none;"&gt;&lt;/iframe&gt;</code>
        </div>`;
        })
        .join("")}
    </div>
  </div>

  <div class="toast" id="toast">Saved!</div>

  <script>
    const SLUG = "${partner.slug}";

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg || 'Saved!';
      t.classList.add('visible');
      setTimeout(() => t.classList.remove('visible'), 2000);
    }

    async function togglePartner() {
      const res = await fetch('/admin/partner/' + SLUG + '/toggle', { method: 'POST' });
      const data = await res.json();
      if (data.success) location.reload();
    }

    async function saveBrand() {
      const payload = {
        businessName: document.getElementById('businessName').value,
        contactEmail: document.getElementById('contactEmail').value,
        websiteUrl: document.getElementById('websiteUrl').value,
        logoUrl: document.getElementById('logoUrl').value,
        primaryColor: document.getElementById('primaryColor').value,
        secondaryColor: document.getElementById('secondaryColor').value,
        portalDomain: document.getElementById('portalDomain').value,
      };
      const res = await fetch('/admin/partner/' + SLUG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) showToast('Brand updated!');
    }

    async function saveFees() {
      const fees = {};
      document.querySelectorAll('.fee-input').forEach(input => {
        fees[input.dataset.service] = parseInt(input.value) || 0;
      });
      const res = await fetch('/admin/partner/' + SLUG + '/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fees }),
      });
      const data = await res.json();
      if (data.success) showToast('Fees updated!');
    }

    async function setupEmail() {
      const domain = document.getElementById('emailDomain')?.value?.trim();
      if (!domain || !domain.includes('.')) { showToast('Enter a valid domain'); return; }
      if (!confirm('Set up email sending from ' + domain + '? This will add the domain to our Resend account.')) return;
      try {
        const res = await fetch('/admin/partner/' + SLUG + '/setup-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Domain created! DNS records shown below.');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Failed');
        }
      } catch (err) {
        showToast('Network error');
      }
    }

    async function verifyEmail() {
      try {
        const res = await fetch('/admin/partner/' + SLUG + '/verify-email', { method: 'POST' });
        const data = await res.json();
        if (data.verified) {
          showToast('Domain verified! Emails will now send from partner domain.');
        } else {
          showToast('Status: ' + (data.status || 'not verified') + '. Check DNS records.');
        }
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        showToast('Network error');
      }
    }

    async function backfillPortal() {
      try {
        const res = await fetch('/admin/partner/' + SLUG + '/backfill-portal-index', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Backfilled ' + data.indexed + ' cases (' + data.skipped + ' skipped)');
        } else {
          showToast(data.error || 'Backfill failed');
        }
      } catch (err) {
        showToast('Network error');
      }
    }

    async function setDashboardPassword() {
      const pw = document.getElementById('dashboardPassword')?.value?.trim();
      if (!pw || pw.length < 6) { showToast('Password must be at least 6 characters'); return; }
      try {
        const res = await fetch('/admin/partner/' + SLUG + '/set-dashboard-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Dashboard password set!');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Failed');
        }
      } catch (err) {
        showToast('Network error');
      }
    }

    async function backfillPartnerCases() {
      try {
        const res = await fetch('/admin/partner/' + SLUG + '/backfill-partner-cases', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Backfilled ' + data.indexed + ' cases');
        } else {
          showToast(data.error || 'Backfill failed');
        }
      } catch (err) {
        showToast('Network error');
      }
    }

    // Live update "Influencer Gets" column when fee changes
    document.querySelectorAll('.fee-input').forEach(input => {
      input.addEventListener('input', () => {
        const service = input.dataset.service;
        const fee = parseInt(input.value) || 0;
        const row = input.closest('tr');
        const initialPrice = parseInt(row.children[1].textContent.replace('$', ''));
        const getsEl = row.querySelector('.influencer-gets');
        getsEl.textContent = '$' + (initialPrice - fee);
      });
    });
  </script>
</body>
</html>`;
}

// ============================================================
// Task Board — Shubh's action items
// ============================================================

interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "done";
  completedAt?: string;
  notes?: string;
}

const SHUBH_TASKS: Omit<TaskItem, "status" | "completedAt" | "notes">[] = [
  {
    id: "lab-vendor",
    title: "Pick a lab vendor for at-home blood test kits",
    description:
      "Contact these companies for B2B pricing quotes, then mark done and paste the best option:\n\n• imaware: sales@poweredbyimaware.com\n• Choose Health: assist@choosehealth.io / 202-505-6974\n• SiPhox Health: siphoxhealth.com/partner\n\nWe need an API to programmatically order at-home blood test kits when you approve a prescription. Tell them: ~18 services, hormone + metabolic panels, need API access and webhook for results.",
  },
  {
    id: "stripe-account",
    title: "Set up new Stripe account",
    description:
      "Your previous Stripe account was closed. We need a new one so we can actually charge patients. Once you have it, paste the Secret Key, Publishable Key, and Webhook Secret here. We'll remove STRIPE_BYPASS and go live with real payments.",
  },
  {
    id: "pharmacy-api",
    title: "Get pharmacy API documentation",
    description:
      "We need API docs from whichever pharmacy you're using for fulfillment so we can build the order lifecycle (prescribed → shipped → delivered). Paste a link to their docs or the contact info for their integration team.",
  },
  {
    id: "test-soap-note",
    title: "Test SOAP note on a real case",
    description:
      "Go to /doctor, open a pending case, click 'Generate SOAP Note', review the note, edit if needed, then click 'Save SOAP Note'. Verify the note appears on the patient's chart. Report any issues here.",
  },
  {
    id: "bloodwork-pricing",
    title: "Decide on bloodwork pricing model",
    description:
      "For services that require bloodwork (testosterone, estrogen systemic, etc.), should the blood test be:\n\n• Included in the service price (you absorb the cost)\n• A separate add-on charge to the patient\n• Required but patient arranges their own labs\n\nLet us know so we can build the checkout flow accordingly.",
  },
];

admin.get("/tasks", async (c) => {
  const stored = (await c.env.PARTNERS.get("shubh-tasks", "json")) as Record<
    string,
    { status: string; completedAt?: string; notes?: string }
  > | null;
  const taskData = stored || {};

  const tasks: TaskItem[] = SHUBH_TASKS.map((t) => ({
    ...t,
    status: (taskData[t.id]?.status as "pending" | "done") || "pending",
    completedAt: taskData[t.id]?.completedAt,
    notes: taskData[t.id]?.notes,
  }));

  return c.html(renderTaskBoard(tasks));
});

admin.post("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const stored =
    ((await c.env.PARTNERS.get("shubh-tasks", "json")) as Record<
      string,
      { status: string; completedAt?: string; notes?: string }
    > | null) || {};

  stored[id] = {
    status: body.status || "done",
    completedAt: new Date().toISOString(),
    notes: body.notes || "",
  };

  await c.env.PARTNERS.put("shubh-tasks", JSON.stringify(stored));
  return c.json({ success: true });
});

// API endpoint so Bryan's Claude can check task status
admin.get("/tasks/status", async (c) => {
  const stored = (await c.env.PARTNERS.get("shubh-tasks", "json")) as Record<
    string,
    { status: string; completedAt?: string; notes?: string }
  > | null;
  return c.json({ tasks: stored || {} });
});

function renderTaskBoard(tasks: TaskItem[]): string {
  const pending = tasks.filter((t) => t.status === "pending");
  const done = tasks.filter((t) => t.status === "done");

  const taskCard = (t: TaskItem) => `
    <div class="task-card ${t.status}" id="task-${t.id}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <h3 style="font-size:16px;margin:0;flex:1">${t.title}</h3>
        ${
          t.status === "done"
            ? '<span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600">DONE</span>'
            : '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600">NEEDS YOU</span>'
        }
      </div>
      <p style="font-size:14px;color:#555;white-space:pre-line;margin:0 0 16px 0">${t.description}</p>
      ${
        t.status === "pending"
          ? `
        <div style="margin-top:12px">
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#333">Notes / API keys / links (optional)</label>
          <textarea id="notes-${t.id}" rows="3" style="width:100%;padding:10px;border:1.5px solid #d9d9d9;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical" placeholder="Paste API keys, links, pricing info, or any notes here..."></textarea>
          <button onclick="markDone('${t.id}')" style="margin-top:8px;padding:10px 24px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Mark as Done</button>
        </div>
      `
          : `
        ${t.notes ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-top:8px"><p style="font-size:12px;font-weight:600;color:#166534;margin:0 0 4px 0">Your notes:</p><p style="font-size:13px;color:#333;margin:0;white-space:pre-line">${t.notes}</p></div>` : ""}
        ${t.completedAt ? `<p style="font-size:12px;color:#888;margin-top:8px">Completed ${new Date(t.completedAt).toLocaleDateString()}</p>` : ""}
        <button onclick="markUndone('${t.id}')" style="margin-top:8px;padding:6px 16px;background:#f3f4f6;color:#666;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">Undo</button>
      `
      }
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Items - My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; }
    .container { max-width: 700px; margin: 0 auto; padding: 32px; }
    .task-card { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 24px; margin-bottom: 16px; }
    .task-card.pending { border-left: 4px solid #f59e0b; }
    .task-card.done { border-left: 4px solid #22c55e; opacity: 0.8; }
    .section-title { font-size: 14px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 12px 0; }
    .progress { background: #e5e7eb; border-radius: 999px; height: 8px; margin-bottom: 24px; overflow: hidden; }
    .progress-bar { background: #22c55e; height: 100%; border-radius: 999px; transition: width 0.3s; }
    .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 14px; display: none; z-index: 100; color: #fff; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Action Items <span style="font-size:12px;color:#888">My Orbit Health</span></h1>
    <a href="/admin" style="color:#4F46E5;text-decoration:none;font-size:14px">&larr; Admin Panel</a>
  </div>
  <div class="container">
    <p style="color:#555;font-size:15px;margin-bottom:8px">Hey Shubh — these are the items we need from you before we can keep building. Mark each one done when you have it and paste any relevant info in the notes.</p>
    <div class="progress"><div class="progress-bar" style="width:${Math.round((done.length / tasks.length) * 100)}%"></div></div>
    <p style="font-size:13px;color:#888;margin-bottom:24px">${done.length} of ${tasks.length} complete</p>

    ${pending.length > 0 ? `<div class="section-title">Needs Your Attention</div>${pending.map(taskCard).join("")}` : ""}
    ${done.length > 0 ? `<div class="section-title">Completed</div>${done.map(taskCard).join("")}` : ""}
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function showToast(msg, color) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = color || '#1a1a2e';
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 3000);
    }

    async function markDone(id) {
      const notes = document.getElementById('notes-' + id)?.value || '';
      try {
        const res = await fetch('/admin/tasks/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'done', notes }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Marked as done!', '#22c55e');
          setTimeout(() => location.reload(), 800);
        }
      } catch (err) {
        showToast('Failed to save', '#dc2626');
      }
    }

    async function markUndone(id) {
      try {
        const res = await fetch('/admin/tasks/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending', notes: '' }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Reopened', '#f59e0b');
          setTimeout(() => location.reload(), 800);
        }
      } catch (err) {
        showToast('Failed to save', '#dc2626');
      }
    }
  </script>
</body>
</html>`;
}

// ─── Medplum Setup Form ─────────────────────────────────────

admin.get("/medplum-setup", async (c) => {
  // Check if already submitted
  const existing = (await c.env.PARTNERS.get(
    "medplum-setup",
    "json",
  )) as Record<string, string> | null;

  return c.html(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Medplum Setup — My Orbit Health</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
  .card { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p.sub { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
  label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px; margin-top: 20px; }
  label:first-of-type { margin-top: 0; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }
  input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .hint { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  button { margin-top: 28px; width: 100%; padding: 12px; background: #0f172a; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:hover { background: #1e293b; }
  .success { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 20px; color: #166534; font-size: 14px; }
  .existing { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin-bottom: 20px; color: #1e40af; font-size: 14px; }
</style>
</head><body>
<div class="card">
  <h1>Medplum Setup</h1>
  <p class="sub">Enter your Medplum credentials below. These will be saved securely and used to connect My Orbit Health to your Medplum project.</p>

  ${existing ? `<div class="existing">Credentials already submitted on ${existing.submittedAt?.split("T")[0] || "unknown date"}. Submitting again will overwrite.</div>` : ""}

  <div id="success" style="display:none" class="success">Saved! Bryan will set these as Cloudflare secrets.</div>

  <form id="form">
    <label>Client ID</label>
    <input name="clientId" required placeholder="From Admin > ClientApplication" value="${existing?.clientId || ""}">
    <div class="hint">Found at app.medplum.com → Admin → Client Applications</div>

    <label>Client Secret</label>
    <input name="clientSecret" required placeholder="The secret for your ClientApplication" type="password">
    <div class="hint">Only shown once when created — paste it here. Never pre-filled for security.</div>

    <label>Base URL</label>
    <input name="baseUrl" required placeholder="https://api.medplum.com" value="${existing?.baseUrl || "https://api.medplum.com"}">
    <div class="hint">Default is https://api.medplum.com unless you have a custom domain</div>

    <label>Practitioner ID (Shubh)</label>
    <input name="practitionerId" placeholder="e.g. abc-123-def-456" value="${existing?.practitionerId || ""}">
    <div class="hint">If you created a Practitioner resource for yourself, paste its ID here. If not, leave blank and we'll create one.</div>

    <label>BAA Status</label>
    <input name="baaStatus" placeholder="e.g. Signed, In progress, Not yet" value="${existing?.baaStatus || ""}">
    <div class="hint">Have you confirmed/signed a BAA with Medplum? This is a legal requirement for HIPAA.</div>

    <label>Medplum Plan Tier</label>
    <input name="planTier" placeholder="e.g. Free, Developer, Production" value="${existing?.planTier || ""}">
    <div class="hint">Which Medplum hosted plan are you on?</div>

    <button type="submit">Save Credentials</button>
  </form>
</div>
<script>
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const res = await fetch('/admin/medplum-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      document.getElementById('success').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      alert('Failed to save — ' + await res.text());
    }
  });
</script>
</body></html>`);
});

admin.post("/medplum-setup", async (c) => {
  const body = await c.req.json();
  const setup = {
    clientId: body.clientId || "",
    clientSecret: body.clientSecret || "",
    baseUrl: body.baseUrl || "https://api.medplum.com",
    practitionerId: body.practitionerId || "",
    baaStatus: body.baaStatus || "",
    planTier: body.planTier || "",
    submittedAt: new Date().toISOString(),
  };
  await c.env.PARTNERS.put("medplum-setup", JSON.stringify(setup));
  return c.json({ success: true });
});

// ============================================================
// Medplum Healthcheck — smoke test all FHIR ops
// ============================================================

admin.get("/medplum-healthcheck", async (c) => {
  const results: Array<{
    step: string;
    status: "pass" | "fail";
    id?: string;
    error?: string;
  }> = [];
  const ts = Date.now().toString(36);

  try {
    // 1. Create Organization
    const org = await createOrganization(
      c.env,
      `Smoke Test ${ts}`,
      `smoke-${ts}`,
    );
    results.push({ step: "Create Organization", status: "pass", id: org.id });

    // 2. Create Patient scoped to org
    const patient = await createMedplumPatient(c.env, {
      firstName: "Smoke",
      lastName: "Test",
      email: `smoke-${ts}@test.myorbithealth.com`,
      phone: "5555550000",
      dateOfBirth: "1990-01-01",
      gender: "male",
      organizationId: org.id,
    });
    results.push({ step: "Create Patient", status: "pass", id: patient.id });

    // 3. Build Questionnaire + submit QuestionnaireResponse
    const semaService = getServiceById("semaglutide");
    if (!semaService) throw new Error("semaglutide service not found");

    const questionnaire = await buildIntakeQuestionnaire(
      c.env,
      semaService,
      "Smoke Test",
    );
    results.push({
      step: "Create Questionnaire",
      status: "pass",
      id: questionnaire.id,
    });

    const qr = await createQuestionnaireResponse(
      c.env,
      patient.id,
      questionnaire.id,
      {
        "1": 185, // weight
        "2": 70, // height
        "3": "21-50",
      },
    );
    results.push({
      step: "Submit QuestionnaireResponse",
      status: "pass",
      id: qr.id,
    });

    // 4. Save Composition (SOAP note)
    const composition = await createComposition(c.env, {
      patientId: patient.id,
      practitionerId: c.env.DOCTOR_PRACTITIONER_ID,
      subjective: "Smoke test — patient reports wanting weight loss.",
      objective: "BMI 26.5, vitals WNL.",
      assessment: "Eligible for GLP-1 therapy.",
      plan: "Start semaglutide 0.25mg weekly x4 weeks.",
    });
    results.push({
      step: "Save Composition (SOAP)",
      status: "pass",
      id: composition.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      step:
        results.length < 5
          ? [
              "Create Organization",
              "Create Patient",
              "Create Questionnaire",
              "Submit QuestionnaireResponse",
              "Save Composition (SOAP)",
            ][results.length]
          : "Unknown",
      status: "fail",
      error: message,
    });
  }

  const allPassed = results.every((r) => r.status === "pass");
  return c.json(
    {
      status: allPassed ? "ALL PASS" : "FAIL",
      timestamp: new Date().toISOString(),
      results,
    },
    allPassed ? 200 : 500,
  );
});

// ─── PrescribeRx Health Check ────────────────────────────────

admin.get("/prescribe-rx-healthcheck", async (c) => {
  const result = await prescribeRxHealthCheck(c.env);
  return c.json(result, result.ok ? 200 : 500);
});

// ─── Doctor Setup Token ──────────────────────────────────────

admin.post("/doctor-setup", async (c) => {
  const token = crypto.randomUUID();
  await c.env.PARTNERS.put("doctor_setup_token", token, {
    expirationTtl: 86400,
  }); // 24hr expiry

  const setupUrl = `https://onboard.myorbithealth.com/doctor/setup/${token}`;

  // Send email to Shubh
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "My Orbit Health <noreply@myorbithealth.com>",
        to: "shubh@myorbithealth.com",
        subject: "Set Your Doctor Portal Password",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">
            <h1 style="font-size:22px;margin-bottom:12px;">Set Your Doctor Portal Password</h1>
            <p style="color:#555;font-size:15px;line-height:1.6;margin-bottom:24px;">
              Click the link below to create your own password for the prescription approval portal.
              This password will be separate from the admin password — only you will know it.
            </p>
            <a href="${setupUrl}" style="display:inline-block;padding:14px 28px;background:#4F46E5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Set My Password</a>
            <p style="color:#999;font-size:13px;margin-top:24px;">This link expires in 24 hours and can only be used once.</p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error("Failed to send doctor setup email:", err);
  }

  return c.json({
    ok: true,
    setupUrl,
    note: "Email sent to shubh@myorbithealth.com. Link expires in 24 hours.",
  });
});

// ─── Vendor Setup Page ──────────────────────────────────────

admin.get("/vendor-setup", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vendor Setup — My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }
    .header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
    .back { color: #4F46E5; text-decoration: none; font-size: 14px; }
    .container { max-width: 800px; margin: 0 auto; padding: 32px; }
    .card { background: #fff; border-radius: 10px; border: 1px solid #e8e8e8; padding: 24px; margin-bottom: 20px; }
    .card h3 { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
    .card h4 { font-size: 15px; font-weight: 600; margin: 20px 0 8px; color: #333; }
    .card p, .card li { font-size: 14px; color: #555; line-height: 1.6; }
    .card ul, .card ol { padding-left: 20px; margin-bottom: 12px; }
    .card li { margin-bottom: 4px; }
    .email-draft { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 12px 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; font-family: inherit; }
    .email-draft .to { color: #888; margin-bottom: 8px; }
    .email-draft .subject { font-weight: 600; margin-bottom: 12px; }
    .copy-btn { background: #4F46E5; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .copy-btn:hover { background: #4338CA; }
    input, select { width: 100%; padding: 10px 12px; border: 1.5px solid #d9d9d9; border-radius: 6px; font-size: 14px; font-family: inherit; margin-bottom: 12px; }
    input:focus { outline: none; border-color: #4F46E5; }
    label { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 4px; }
    .save-btn { background: #22c55e; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; width: 100%; margin-top: 8px; }
    .save-btn:hover { background: #16a34a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-todo { background: #fef3c7; color: #92400e; }
    .badge-done { background: #dcfce7; color: #166534; }
    .divider { border-top: 1px solid #e8e8e8; margin: 24px 0; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #1a1a2e; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 14px; display: none; z-index: 100; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="font-size:20px">Vendor Setup <span style="font-size:12px;color:#888">My Orbit Health</span></h1>
    <a class="back" href="/admin">&larr; Admin</a>
  </div>
  <div class="container">

    <!-- IMAWARE (Labs) -->
    <div class="card">
      <h3>1. Lab Vendor — imaware <span class="badge badge-todo">ACTION NEEDED</span></h3>
      <p>We need at-home blood test kits for patients who don't have recent labs. imaware is our top pick — dried blood spot (DBS) kits, API integration, $40-80/kit wholesale, no minimums.</p>

      <h4>What to do</h4>
      <ol>
        <li><strong>Send the email below</strong> to <code>sales@poweredbyimaware.com</code></li>
        <li>They'll reply with pricing + API docs</li>
        <li>Come back here and paste the API credentials</li>
      </ol>

      <h4>Draft email (copy and send from shubh@myorbithealth.com)</h4>
      <div class="email-draft" id="imawareEmail">
<div class="to">To: sales@poweredbyimaware.com</div>
<div class="subject">Subject: B2B API Partnership Inquiry — My Orbit Health (Telehealth Platform)</div>

Hi imaware team,

I'm Dr. Shubh, Medical Director at My Orbit Health. We're a white-label telehealth platform that provides hormone therapy, peptide therapy, and weight loss prescriptions through licensed providers.

We're looking for an at-home lab testing partner to integrate into our patient intake flow. Specifically, we need:

<strong>Panels needed:</strong>
• Hormone panel (Total T, Free T, SHBG, LH, FSH, Estradiol, Prolactin) — for testosterone and enclomiphene patients
• Metabolic panel (CBC, CMP, Lipid Panel, TSH, Fasting Glucose) — for estrogen therapy patients
• PSA (for patients 40+)

<strong>What we're looking for:</strong>
• At-home DBS kits shipped directly to patients
• B2B/wholesale pricing (we'll be ordering on behalf of patients)
• REST API access for programmatic kit ordering + result retrieval
• HIPAA-compliant data handling
• No minimum order commitments (we're launching, volume will grow)

<strong>Our integration plan:</strong>
Patient completes telehealth intake → our system orders a kit via API → kit ships to patient → patient completes test → results return via API/webhook → our provider reviews and prescribes.

Current volume: ~50-100 patients/month requiring labs, scaling to 500+.

Could we schedule a call to discuss pricing and API access? Happy to sign an NDA if needed.

Best,
Dr. Shubh
Medical Director, My Orbit Health
shubh@myorbithealth.com</div>
      <button class="copy-btn" onclick="copyEmail()">Copy Email Text</button>

      <div class="divider"></div>

      <h4>After you hear back — paste credentials here</h4>
      <label>imaware API Key</label>
      <input type="text" id="imawareApiKey" placeholder="Paste API key from imaware">
      <label>imaware API Base URL</label>
      <input type="text" id="imawareBaseUrl" placeholder="e.g. https://api.imaware.health/v1" value="https://api.imaware.health/v1">
      <label>imaware Webhook Secret (if provided)</label>
      <input type="text" id="imawareWebhookSecret" placeholder="For result delivery webhooks (optional)">
      <button class="save-btn" onclick="saveImaware()">Save imaware Credentials</button>
    </div>

    <!-- PHARMACY — RxHQ / Olympia -->
    <div class="card">
      <h3>2. Pharmacy API — RxHQ (Olympia) <span class="badge badge-todo">ACTION NEEDED</span></h3>
      <p>We're integrating the RxHQ / Olympia Pharmacy API so prescriptions auto-submit when you approve a case, and tracking/shipped/delivered updates flow back automatically to the patient. You'll no longer need to manually enter tracking numbers.</p>

      <h4>What we need from you</h4>
      <p>Log in to your RxHQ portal at <a href="http://rxhqportal.com" target="_blank">rxhqportal.com</a> and grab the following. If you don't see an API section in your account, email RxHQ support and ask them to <strong>"enable API access and issue API credentials (username, password, and 32-character secret) for my account."</strong></p>

      <ol>
        <li><strong>API Username</strong> — usually your portal login username</li>
        <li><strong>API Password</strong> — your portal password (or a separate API password if they issue one)</li>
        <li><strong>API Secret</strong> — a 32-character string RxHQ generates for your account</li>
        <li><strong>Your Physician ID</strong> — the numeric ID RxHQ assigned to you as a prescriber (shown in your profile or on any prescription you've submitted through their portal)</li>
      </ol>

      <h4>Also confirm (so we can finish the integration)</h4>
      <ul>
        <li>✅ All 18 services we offer are stocked by RxHQ (GLP-1s, ED, HRT male/female, peptides, blends)? If some aren't, list which ones so we route them elsewhere.</li>
        <li>✅ Testosterone Injectable (Schedule III controlled) — confirmed RxHQ can ship it, and which states they're licensed in.</li>
        <li>✅ Does RxHQ charge shipping separately, or is it included in product price?</li>
        <li>✅ Default number of refills you want on a standard prescription (0, 2, 11)?</li>
      </ul>

      <h4>Enter your RxHQ credentials</h4>
      <label>RxHQ API Username</label>
      <input type="text" id="rxhqUsername" placeholder="Your RxHQ portal username">
      <label>RxHQ API Password</label>
      <input type="password" id="rxhqPassword" placeholder="Your RxHQ API password">
      <label>RxHQ API Secret (32 characters)</label>
      <input type="text" id="rxhqSecret" placeholder="Xh7pM2Z5Tq9Vw3Lb8jN0Yk4Rf6G1QdCs">
      <label>Your RxHQ Physician ID</label>
      <input type="text" id="rxhqPhysicianId" placeholder="e.g. 12345">
      <label>API Base URL</label>
      <input type="text" id="rxhqBaseUrl" value="https://rxhqportal.com" placeholder="https://rxhqportal.com">

      <h4 style="margin-top:20px">Notes (optional — answer the confirm questions above)</h4>
      <textarea id="rxhqNotes" rows="5" style="width:100%;padding:10px 12px;border:1.5px solid #d9d9d9;border-radius:6px;font-size:14px;font-family:inherit;margin-bottom:12px" placeholder="e.g. All 18 stocked. Test inj shippable in CA/FL/TX/NY. Shipping $15 flat. Default 2 refills."></textarea>

      <button class="save-btn" onclick="savePharmacy()">Save RxHQ Credentials</button>
    </div>

    <!-- STRIPE -->
    <div class="card">
      <h3>3. Stripe Account <span class="badge badge-todo">ACTION NEEDED</span></h3>
      <p>The old Stripe account was closed. We're running with STRIPE_BYPASS=true (no real charges). Once you set up a new Stripe account:</p>
      <ol>
        <li>Create account at <a href="https://dashboard.stripe.com/register" target="_blank">stripe.com</a></li>
        <li>Get your API keys from Settings → Developers → API Keys</li>
        <li>Paste them below</li>
      </ol>
      <label>Stripe Secret Key</label>
      <input type="password" id="stripeSecretKey" placeholder="sk_live_...">
      <label>Stripe Publishable Key</label>
      <input type="text" id="stripePublishableKey" placeholder="pk_live_...">
      <label>Stripe Webhook Secret</label>
      <input type="text" id="stripeWebhookSecret" placeholder="whsec_...">
      <button class="save-btn" onclick="saveStripe()">Save Stripe Credentials</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function showToast(msg, color) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = color || '#1a1a2e';
      t.style.color = '#fff';
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 4000);
    }

    function copyEmail() {
      const el = document.getElementById('imawareEmail');
      // Get text content without HTML tags
      const text = el.innerText;
      navigator.clipboard.writeText(text).then(() => {
        showToast('Email copied to clipboard!', '#22c55e');
      }).catch(() => {
        // Fallback: select text
        const range = document.createRange();
        range.selectNode(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        showToast('Text selected — press Ctrl+C to copy', '#f59e0b');
      });
    }

    async function saveImaware() {
      const apiKey = document.getElementById('imawareApiKey').value.trim();
      const baseUrl = document.getElementById('imawareBaseUrl').value.trim();
      const webhookSecret = document.getElementById('imawareWebhookSecret').value.trim();
      if (!apiKey) { showToast('Enter the API key', '#f59e0b'); return; }

      try {
        const res = await fetch('/admin/vendor-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor: 'imaware', apiKey, baseUrl, webhookSecret }),
        });
        const data = await res.json();
        if (data.success) showToast('imaware credentials saved!', '#22c55e');
        else showToast(data.error || 'Failed', '#dc2626');
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    async function savePharmacy() {
      const username = document.getElementById('rxhqUsername').value.trim();
      const password = document.getElementById('rxhqPassword').value.trim();
      const secret = document.getElementById('rxhqSecret').value.trim();
      const physicianId = document.getElementById('rxhqPhysicianId').value.trim();
      const baseUrl = document.getElementById('rxhqBaseUrl').value.trim();
      const notes = document.getElementById('rxhqNotes').value.trim();
      if (!username || !password || !secret) { showToast('Enter username, password, and secret', '#f59e0b'); return; }
      if (secret.length !== 32) { showToast('Secret must be 32 characters', '#f59e0b'); return; }
      if (!physicianId) { showToast('Enter your RxHQ physician ID', '#f59e0b'); return; }

      try {
        const res = await fetch('/admin/vendor-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor: 'pharmacy', username, password, secret, physicianId, baseUrl, notes }),
        });
        const data = await res.json();
        if (data.success) showToast('Pharmacy credentials saved!', '#22c55e');
        else showToast(data.error || 'Failed', '#dc2626');
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }

    async function saveStripe() {
      const secretKey = document.getElementById('stripeSecretKey').value.trim();
      const publishableKey = document.getElementById('stripePublishableKey').value.trim();
      const webhookSecret = document.getElementById('stripeWebhookSecret').value.trim();
      if (!secretKey || !publishableKey) { showToast('Enter both Stripe keys', '#f59e0b'); return; }

      try {
        const res = await fetch('/admin/vendor-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor: 'stripe', secretKey, publishableKey, webhookSecret }),
        });
        const data = await res.json();
        if (data.success) showToast('Stripe credentials saved! Redeploy needed to activate.', '#22c55e');
        else showToast(data.error || 'Failed', '#dc2626');
      } catch (err) {
        showToast('Network error', '#dc2626');
      }
    }
  </script>
</body>
</html>`);
});

// Save vendor credentials to KV
admin.post("/vendor-credentials", async (c) => {
  const body = await c.req.json();
  const vendor = body.vendor as string;

  if (vendor === "imaware") {
    await c.env.PARTNERS.put(
      "vendor:imaware",
      JSON.stringify({
        apiKey: body.apiKey,
        baseUrl: body.baseUrl || "https://api.imaware.health/v1",
        webhookSecret: body.webhookSecret || "",
        savedAt: new Date().toISOString(),
      }),
    );
    return c.json({ success: true });
  }

  if (vendor === "pharmacy") {
    await c.env.PARTNERS.put(
      "vendor:pharmacy",
      JSON.stringify({
        name: "RxHQ (Olympia)",
        username: body.username || "",
        password: body.password || "",
        secret: body.secret || "",
        physicianId: body.physicianId || "",
        baseUrl: body.baseUrl || "https://rxhqportal.com",
        notes: body.notes || "",
        savedAt: new Date().toISOString(),
      }),
    );
    return c.json({ success: true });
  }

  if (vendor === "stripe") {
    // Store in KV — will need to be set as Cloudflare secrets for prod use
    await c.env.PARTNERS.put(
      "vendor:stripe",
      JSON.stringify({
        secretKey: body.secretKey,
        publishableKey: body.publishableKey,
        webhookSecret: body.webhookSecret || "",
        savedAt: new Date().toISOString(),
        note: "These are stored in KV for reference. Run 'wrangler secret put STRIPE_SECRET_KEY' etc. to activate in prod.",
      }),
    );
    return c.json({ success: true });
  }

  return c.json({ error: "Unknown vendor" }, 400);
});

export default admin;
