/**
 * Partner Dashboard — authenticated, white-labeled per tenant.
 *
 * Partners (influencers) see sales, revenue, earnings, and conversion
 * metrics. Auth is password-based with a daily-rotation session cookie,
 * following the same pattern as doctor.ts.
 *
 * Routing: Host-based (same as patient portal). The `index.ts` entry
 * point detects the portal subdomain and sets `c.get("partner")`.
 * Dashboard URL: portal.brand.com/partner/dashboard
 */

import { Hono } from "hono";
import { Env, PartnerConfig, PendingCase } from "../lib/types";
import { getPartnerCases, getPendingCase, savePendingCase } from "../lib/kv";

type Vars = { partner: PartnerConfig };

const partnerDashboard = new Hono<{ Bindings: Env; Variables: Vars }>();

// ─── Helpers ──────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterdayKey(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

async function buildSessionToken(
  slug: string,
  secret: string,
  dateKey: string,
): Promise<string> {
  return sha256(`${slug}|partner_dashboard|${dateKey}|${secret}`);
}

function getCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function safeFontName(font: string | undefined): string {
  const cleaned = (font || "").replace(/[^A-Za-z0-9 ]/g, "").trim();
  return cleaned || "Inter";
}

function formatMoney(amount: number): string {
  const fixed = amount.toFixed(2);
  const [whole, decimal] = fixed.split(".");
  const formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${formatted}.${decimal}`;
}

function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "\u2014";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ─── Auth middleware ──────────────────────────────────────────

partnerDashboard.use("*", async (c, next) => {
  const partner = c.get("partner");
  if (!partner)
    return c.text("Partner dashboard not available for this domain", 404);

  const path = c.req.path;
  const publicRoutes = ["/partner/login", "/partner/auth", "/partner/logout"];
  if (publicRoutes.some((p) => path === p || path === p + "/")) return next();

  const sessionCookie = getCookie(c.req.header("Cookie"), "partner_session");
  if (!sessionCookie) return c.redirect("/partner/login");

  const secret = c.env.MEDPLUM_CLIENT_SECRET || c.env.ADMIN_PASSWORD_HASH;
  if (!secret) return c.redirect("/partner/login");

  const expectedToday = await buildSessionToken(
    partner.slug,
    secret,
    todayKey(),
  );
  const expectedYesterday = await buildSessionToken(
    partner.slug,
    secret,
    yesterdayKey(),
  );

  if (sessionCookie !== expectedToday && sessionCookie !== expectedYesterday) {
    return c.redirect("/partner/login");
  }

  return next();
});

// ─── Routes ──────────────────────────────────────────────────

partnerDashboard.get("/", (c) => c.redirect("/partner/dashboard"));

partnerDashboard.get("/login", (c) => {
  const partner = c.get("partner");
  const error = c.req.query("error");
  return c.html(renderLoginPage(partner, error));
});

partnerDashboard.post("/auth", async (c) => {
  const partner = c.get("partner");
  const body = await c.req.parseBody();
  const password = ((body.password as string) || "").trim();

  if (!password) return c.redirect("/partner/login?error=missing");

  const passwordHash = await sha256(password);
  const storedHash = await c.env.PARTNERS.get(
    `partner_password_hash:${partner.slug}`,
  );

  if (!storedHash || passwordHash !== storedHash) {
    return c.redirect("/partner/login?error=invalid");
  }

  const secret = c.env.MEDPLUM_CLIENT_SECRET || c.env.ADMIN_PASSWORD_HASH;
  if (!secret) return c.redirect("/partner/login?error=config");

  const sessionToken = await buildSessionToken(
    partner.slug,
    secret,
    todayKey(),
  );
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/partner/dashboard",
      "Set-Cookie": `partner_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
});

partnerDashboard.get("/logout", () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/partner/login",
      "Set-Cookie": `partner_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
});

partnerDashboard.get("/dashboard", async (c) => {
  const partner = c.get("partner");
  const cases = await getPartnerCases(c.env.PARTNERS, partner.slug);
  return c.html(renderDashboard(partner, cases));
});

// Cancel a pending order (partner customer service)
partnerDashboard.post("/orders/:id/cancel", async (c) => {
  const partner = c.get("partner");
  const id = c.req.param("id");
  const pc = await getPendingCase(c.env.PARTNERS, id);
  if (!pc || pc.partnerSlug !== partner.slug)
    return c.json({ error: "Not found" }, 404);
  if (pc.status !== "pending")
    return c.json({ error: "Order is no longer pending" }, 400);

  // Void the Stripe auth
  if (!id.startsWith("bypass_")) {
    try {
      const { createStripeClient } = await import("./stripe");
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
      await stripe.paymentIntents.cancel(id);
    } catch (err) {
      console.error("Stripe cancel failed:", err);
    }
  }

  pc.status = "denied";
  pc.denyReason = "Cancelled by partner";
  pc.resolvedAt = new Date().toISOString();
  await savePendingCase(c.env.PARTNERS, pc);
  return c.json({ success: true });
});

// ─── Dashboard Data ──────────────────────────────────────────

function computeStats(partner: PartnerConfig, cases: PendingCase[]) {
  const fees = partner.platformFees || {};
  const kitPrice = partner.bloodworkKitPrice ?? 124.99;
  const kitFee = partner.bloodworkKitFee ?? kitPrice;

  const approved = cases.filter((c) => c.status === "approved");
  const denied = cases.filter((c) => c.status === "denied");
  const pending = cases.filter((c) => c.status === "pending");
  const resolved = approved.length + denied.length;

  const totalRevenue = approved.reduce((sum, c) => sum + c.chargeAmount, 0);
  let partnerEarnings = 0;
  for (const c of approved) {
    partnerEarnings += c.chargeAmount - (fees[c.serviceType] || 0);
    if (c.bloodworkKitPurchased) {
      partnerEarnings += kitPrice - kitFee;
    }
  }

  const approvalRate =
    resolved > 0 ? Math.round((approved.length / resolved) * 100) : 0;

  // Revenue by service
  const serviceMap = new Map<
    string,
    {
      serviceName: string;
      orders: number;
      approved: number;
      revenue: number;
      earnings: number;
    }
  >();
  for (const c of cases) {
    if (!serviceMap.has(c.serviceType)) {
      serviceMap.set(c.serviceType, {
        serviceName: c.serviceName,
        orders: 0,
        approved: 0,
        revenue: 0,
        earnings: 0,
      });
    }
    const s = serviceMap.get(c.serviceType)!;
    s.orders++;
    if (c.status === "approved") {
      s.approved++;
      s.revenue += c.chargeAmount;
      s.earnings += c.chargeAmount - (fees[c.serviceType] || 0);
      if (c.bloodworkKitPurchased) {
        s.earnings += kitPrice - kitFee;
      }
    }
  }

  // Month-over-month
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const thisMonthCases = cases.filter(
    (c) => new Date(c.createdAt) >= thisMonthStart,
  );
  const lastMonthCases = cases.filter((c) => {
    const d = new Date(c.createdAt);
    return d >= lastMonthStart && d < thisMonthStart;
  });
  const thisMonthApproved = thisMonthCases.filter(
    (c) => c.status === "approved",
  );
  const lastMonthApproved = lastMonthCases.filter(
    (c) => c.status === "approved",
  );

  return {
    totalOrders: cases.length,
    totalRevenue,
    partnerEarnings,
    approvalRate,
    pendingCount: pending.length,
    serviceStats: Array.from(serviceMap.values()),
    thisMonth: {
      orders: thisMonthCases.length,
      revenue: thisMonthApproved.reduce((s, c) => s + c.chargeAmount, 0),
    },
    lastMonth: {
      orders: lastMonthCases.length,
      revenue: lastMonthApproved.reduce((s, c) => s + c.chargeAmount, 0),
    },
  };
}

// ─── HTML Templates ──────────────────────────────────────────

function renderLoginPage(
  partner: PartnerConfig,
  error?: string | null,
): string {
  const primary = partner.brandColors.primary || "#0B1F3A";
  const font = safeFontName(partner.font);
  const name = esc(partner.businessName);
  const logo = partner.logoUrl
    ? `<img src="${esc(partner.logoUrl)}" alt="${name}" style="max-height:36px;max-width:180px" onerror="this.style.display='none'">`
    : `<span style="font-size:20px;font-weight:700">${name}</span>`;

  const errorHtml =
    error === "invalid"
      ? `<div style="background:#fef2f2;color:#991b1b;padding:12px 16px;border-radius:10px;font-size:14px;margin-bottom:16px">Invalid password</div>`
      : error === "missing"
        ? `<div style="background:#fef2f2;color:#991b1b;padding:12px 16px;border-radius:10px;font-size:14px;margin-bottom:16px">Please enter your password</div>`
        : error === "config"
          ? `<div style="background:#fef2f2;color:#991b1b;padding:12px 16px;border-radius:10px;font-size:14px;margin-bottom:16px">Dashboard not configured. Contact support.</div>`
          : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Partner Login \u2014 ${name}</title>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --primary: ${primary}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'${font}',system-ui,sans-serif; background:#f6f7f9; color:#1a1a2e; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .login-card { background:#fff; border-radius:16px; padding:40px 32px; max-width:400px; width:100%; margin:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
  .logo { text-align:center; margin-bottom:24px; }
  .title { font-size:22px; font-weight:700; margin-bottom:6px; text-align:center; }
  .subtitle { font-size:14px; color:#6b7280; text-align:center; margin-bottom:24px; }
  label { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px; }
  input { width:100%; padding:14px 16px; border-radius:10px; border:1px solid #d1d5db; font-size:15px; font-family:inherit; outline:none; transition:border 0.2s; }
  input:focus { border-color:var(--primary); }
  button { width:100%; padding:14px; border-radius:10px; background:var(--primary); color:#fff; font-weight:600; font-size:15px; border:none; cursor:pointer; font-family:inherit; margin-top:16px; }
  button:hover { opacity:0.92; }
</style>
</head><body>
<div class="login-card">
  <div class="logo">${logo}</div>
  <p class="title">Partner Dashboard</p>
  <p class="subtitle">Sign in to view your sales and earnings.</p>
  ${errorHtml}
  <form method="POST" action="/partner/auth">
    <label>Password</label>
    <input name="password" type="password" required placeholder="Enter your dashboard password">
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`;
}

function renderDashboard(partner: PartnerConfig, cases: PendingCase[]): string {
  const stats = computeStats(partner, cases);
  const primary = partner.brandColors.primary || "#0B1F3A";
  const font = safeFontName(partner.font);
  const name = esc(partner.businessName);

  const fees = partner.platformFees || {};
  const kitPrice = partner.bloodworkKitPrice ?? 124.99;
  const kitFee = partner.bloodworkKitFee ?? kitPrice;

  const statusBadge = (status: string) => {
    if (status === "approved")
      return '<span class="badge bg-emerald">Approved</span>';
    if (status === "denied") return '<span class="badge bg-red">Denied</span>';
    return '<span class="badge bg-amber">Pending</span>';
  };

  const recentCases = cases.slice(0, 20);
  const recentRows = recentCases
    .map((c) => {
      const share =
        c.status === "approved"
          ? c.chargeAmount -
            (fees[c.serviceType] || 0) +
            (c.bloodworkKitPurchased ? kitPrice - kitFee : 0)
          : 0;
      const cancelBtn =
        c.status === "pending"
          ? `<button class="btn-cancel" onclick="cancelOrder('${esc(c.paymentIntentId)}',this)">Cancel</button>`
          : c.status === "denied" && c.denyReason
            ? `<span style="font-size:11px;color:#94a3b8">${esc(c.denyReason)}</span>`
            : "";
      return `<tr>
      <td>${new Date(c.createdAt).toLocaleDateString()}</td>
      <td>${esc(abbreviateName(c.patientName))}<div style="font-size:11px;color:#94a3b8">${esc(c.patientEmail || "")}</div></td>
      <td>${esc(c.serviceName)}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${formatMoney(c.chargeAmount)}</td>
      <td>${c.status === "approved" ? formatMoney(share) : "\u2014"}</td>
      <td>${cancelBtn}</td>
    </tr>`;
    })
    .join("");

  const serviceRows = stats.serviceStats
    .map(
      (s) => `<tr>
    <td>${esc(s.serviceName)}</td>
    <td>${s.orders}</td>
    <td>${s.approved}</td>
    <td>${formatMoney(s.revenue)}</td>
    <td style="color:${primary};font-weight:600">${formatMoney(s.earnings)}</td>
  </tr>`,
    )
    .join("");

  const orderDelta = stats.thisMonth.orders - stats.lastMonth.orders;
  const revDelta = stats.thisMonth.revenue - stats.lastMonth.revenue;
  const deltaTag = (val: number, isMoney = false) => {
    if (val === 0) return "";
    const color = val > 0 ? "#10b981" : "#ef4444";
    const arrow = val > 0 ? "\u2191" : "\u2193";
    const display = isMoney
      ? formatMoney(Math.abs(val))
      : String(Math.abs(val));
    return `<span style="font-size:13px;font-weight:600;color:${color};background:${color}12;padding:2px 8px;border-radius:6px;margin-left:8px">${arrow} ${display}</span>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${name} \u2014 Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --p: ${primary}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'${font}',system-ui,sans-serif; background:#f4f5f7; color:#1e293b; -webkit-font-smoothing:antialiased; }

  /* Top bar */
  .topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 32px; height:56px; display:flex; align-items:center; justify-content:space-between; }
  .topbar-left { display:flex; align-items:center; gap:12px; }
  .topbar-left img { height:28px; }
  .topbar-left span { font-size:13px; color:#94a3b8; padding-left:12px; border-left:1px solid #e2e8f0; }
  .topbar a { font-size:13px; color:#64748b; text-decoration:none; }
  .topbar a:hover { color:#0f172a; }

  .page { max-width:1240px; margin:0 auto; padding:28px 32px 48px; }

  /* Earnings hero banner */
  .hero-banner { background:linear-gradient(135deg,${primary},${primary}cc); border-radius:16px; padding:36px 40px; color:#fff; margin-bottom:24px; display:flex; align-items:center; justify-content:space-between; gap:32px; flex-wrap:wrap; }
  .hero-banner .hero-logo { height:40px; opacity:0.9; }
  .hero-main { flex:1; min-width:200px; }
  .hero-main .label { font-size:13px; opacity:0.75; margin-bottom:6px; font-weight:500; }
  .hero-main .big { font-size:42px; font-weight:700; letter-spacing:-0.03em; line-height:1; }
  .hero-main .sub { font-size:14px; opacity:0.7; margin-top:8px; }
  .hero-stats { display:flex; gap:40px; }
  .hero-stat { text-align:center; }
  .hero-stat .num { font-size:28px; font-weight:700; }
  .hero-stat .lbl { font-size:12px; opacity:0.7; margin-top:2px; }

  /* Metric row */
  .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:24px; }
  @media(max-width:700px) { .metrics { grid-template-columns:1fr; } }
  .metric { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px 24px; }
  .metric .label { font-size:12px; color:#64748b; font-weight:500; margin-bottom:6px; }
  .metric .row { display:flex; align-items:baseline; gap:4px; }
  .metric .val { font-size:26px; font-weight:700; color:#0f172a; letter-spacing:-0.02em; }

  /* Two-column layout */
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
  @media(max-width:800px) { .cols { grid-template-columns:1fr; } }

  /* Cards */
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
  .card-head { padding:16px 24px; border-bottom:1px solid #f1f5f9; font-size:14px; font-weight:600; color:#0f172a; display:flex; align-items:center; gap:8px; }
  .card-head svg { width:16px; height:16px; color:var(--p); }
  .card-body { padding:0; }

  /* Tables */
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:10px 20px; font-size:11px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; background:#f8fafc; }
  td { padding:12px 20px; font-size:13px; color:#334155; border-top:1px solid #f1f5f9; }
  tr:hover td { background:#fafbfc; }

  /* Badges */
  .badge { display:inline-block; padding:3px 10px; border-radius:6px; font-size:11px; font-weight:600; }
  .bg-emerald { background:#d1fae5; color:#065f46; }
  .bg-red { background:#fee2e2; color:#991b1b; }
  .bg-amber { background:#fef3c7; color:#92400e; }

  /* Month compare */
  .compare { display:flex; gap:24px; padding:20px 24px; }
  .compare-block { flex:1; }
  .compare-block .lbl { font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px; }
  .compare-block .val { font-size:24px; font-weight:700; color:#0f172a; display:flex; align-items:center; }

  .empty-state { text-align:center; padding:64px 24px; color:#94a3b8; }
  .empty-state h3 { font-size:18px; color:#334155; margin-bottom:8px; }
  .footer { text-align:center; padding:24px; font-size:11px; color:#cbd5e1; }

  .btn-cancel { padding:5px 12px; font-size:12px; font-weight:600; color:#dc2626; background:#fee2e2; border:none; border-radius:6px; cursor:pointer; font-family:inherit; transition:all 0.15s; }
  .btn-cancel:hover { background:#dc2626; color:#fff; }
  .btn-cancel:disabled { opacity:0.5; cursor:not-allowed; }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    ${partner.logoUrl ? `<img src="${esc(partner.logoUrl)}" alt="${name}" onerror="this.style.display='none'">` : `<strong>${name}</strong>`}
    <span>Dashboard</span>
  </div>
  <a href="/partner/logout">Sign out</a>
</div>

<div class="page">
${
  cases.length === 0
    ? `
  <div class="card"><div class="empty-state">
    <h3>No orders yet</h3>
    <p>When patients complete intake through your forms, their orders will appear here.</p>
  </div></div>
`
    : `
  <!-- Earnings hero -->
  <div class="hero-banner">
    ${partner.logoUrl ? `<img class="hero-logo" src="${esc(partner.logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
    <div class="hero-main">
      <div class="label">Your Earnings</div>
      <div class="big">${formatMoney(stats.partnerEarnings)}</div>
      <div class="sub">${formatMoney(stats.totalRevenue)} total revenue &middot; ${stats.totalOrders} orders</div>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><div class="num">${stats.approvalRate}%</div><div class="lbl">Approval Rate</div></div>
      <div class="hero-stat"><div class="num">${stats.pendingCount}</div><div class="lbl">Pending</div></div>
    </div>
  </div>

  <!-- Month metrics -->
  <div class="metrics">
    <div class="metric">
      <div class="label">This Month Orders</div>
      <div class="row"><span class="val">${stats.thisMonth.orders}</span>${deltaTag(orderDelta)}</div>
    </div>
    <div class="metric">
      <div class="label">This Month Revenue</div>
      <div class="row"><span class="val">${formatMoney(stats.thisMonth.revenue)}</span>${deltaTag(revDelta, true)}</div>
    </div>
    <div class="metric">
      <div class="label">Last Month</div>
      <div class="row"><span class="val">${stats.lastMonth.orders} orders</span><span style="margin-left:12px;font-size:14px;color:#64748b">${formatMoney(stats.lastMonth.revenue)}</span></div>
    </div>
  </div>

  <!-- Revenue + Recent side by side -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      Revenue by Service
    </div>
    <div class="card-body"><div style="overflow-x:auto">
      <table>
        <thead><tr><th>Service</th><th>Orders</th><th>Approved</th><th>Revenue</th><th>Your Earnings</th></tr></thead>
        <tbody>${serviceRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">No data</td></tr>'}</tbody>
      </table>
    </div></div>
  </div>

  <div class="card">
    <div class="card-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
      Recent Orders
    </div>
    <div class="card-body"><div style="overflow-x:auto">
      <table>
        <thead><tr><th>Date</th><th>Patient</th><th>Service</th><th>Status</th><th>Amount</th><th>Your Share</th><th>Actions</th></tr></thead>
        <tbody>${recentRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">No orders</td></tr>'}</tbody>
      </table>
    </div></div>
  </div>
`
}
</div>
<div class="footer">&copy; ${new Date().getFullYear()} ${name}</div>
<script>
async function cancelOrder(id, btn) {
  if (!confirm('Cancel this order? The customer\\'s card hold will be released.')) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var res = await fetch('/partner/orders/' + id + '/cancel', { method: 'POST' });
    var data = await res.json();
    if (data.success) {
      btn.textContent = 'Cancelled';
      btn.style.background = '#e2e8f0';
      btn.style.color = '#64748b';
      // Update the status badge in same row
      var row = btn.closest('tr');
      var badge = row.querySelector('.badge');
      if (badge) { badge.className = 'badge bg-red'; badge.textContent = 'Cancelled'; }
    } else {
      alert(data.error || 'Could not cancel');
      btn.disabled = false;
      btn.textContent = 'Cancel';
    }
  } catch(e) {
    alert('Network error');
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}
</script>
</body>
</html>`;
}

export default partnerDashboard;
