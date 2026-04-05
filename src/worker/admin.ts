import { Hono } from "hono";
import { Env, PartnerConfig, ServiceId } from "../lib/types";
import { getPartner, savePartner, listPartners } from "../lib/kv";

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
  if (path === "/admin/login" || path === "/admin/auth") {
    return next();
  }

  // Check session cookie
  const sessionCookie = c.req.header("Cookie")?.match(/admin_session=([^;]+)/)?.[1];
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
  const email = (body.email as string || "").toLowerCase().trim();
  const password = body.password as string || "";

  const passwordHash = await hashPassword(password);
  const storedHash = c.env.ADMIN_PASSWORD_HASH.trim();
  const storedEmail = c.env.ADMIN_EMAIL.trim();

  console.log("Login attempt:", { email, storedEmail, emailMatch: email === storedEmail, hashMatch: passwordHash === storedHash, passwordHash, storedHash });

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

  return c.html(LOGIN_HTML.replace("</form>", '<p style="color:#dc2626;margin-top:12px;font-size:14px">Invalid email or password</p></form>'));
});

// Dashboard — list all partners
admin.get("/", async (c) => {
  const slugs = await listPartners(c.env.PARTNERS);
  const partners = (await Promise.all(slugs.map((s) => getPartner(c.env.PARTNERS, s)))).filter(Boolean) as PartnerConfig[];

  return c.html(renderDashboard(partners));
});

// Partner detail / edit
admin.get("/partner/:slug", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);

  return c.html(renderPartnerDetail(partner));
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

  // Update platform fees
  if (body.platformFees) {
    partner.platformFees = body.platformFees;
  }

  // Update service prices
  if (body.services) {
    for (const update of body.services) {
      const service = partner.services.find((s) => s.type === update.type);
      if (service) {
        if (update.initialPrice !== undefined) service.initialPrice = update.initialPrice;
        if (update.subscriptionPrice !== undefined) service.subscriptionPrice = update.subscriptionPrice;
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

// Update platform fees for a partner
admin.post("/partner/:slug/fees", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  partner.platformFees = body.fees || {};
  await savePartner(c.env.PARTNERS, partner);
  return c.json({ success: true });
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
    'semaglutide': 'Semaglutide', 'tirzepatide': 'Tirzepatide', 'retatrutide': 'Retatrutide',
    'sildenafil': 'Sildenafil', 'tadalafil': 'Tadalafil',
    'testosterone-injectable': 'TRT Injectable', 'testosterone-oral': 'TRT Oral',
    'enclomiphene': 'Enclomiphene', 'estrogen-cream-vaginal': 'Estrogen Cream (Vaginal)', 'estrogen-cream-systemic': 'Estrogen Cream (Systemic)', 'estrogen-patches': 'Estrogen Patches',
    'mots-c': 'MOTS-c', 'nad': 'NAD+', 'bpc-157': 'BPC-157', 'tb-500': 'TB-500',
    'wolverine': 'Wolverine', 'glo': 'GLO', 'klow': 'KLOW',
  };

  const partnerRows = partners.map((p) => {
    const services = p.services.map((s) => serviceLabels[s.type] || s.type).join(", ");
    const statusColor = p.enabled !== false ? "#22c55e" : "#dc2626";
    const statusText = p.enabled !== false ? "Active" : "Disabled";
    return `<tr onclick="window.location='/admin/partner/${p.slug}'" style="cursor:pointer">
      <td><strong>${p.businessName}</strong><br><span style="color:#888;font-size:12px">${p.slug}</span></td>
      <td>${services}</td>
      <td>${p.paymentMode === "platform" ? "Platform" : "Direct"}</td>
      <td><span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${statusColor}20;color:${statusColor}">${statusText}</span></td>
      <td style="color:#888;font-size:13px">${new Date(p.createdAt).toLocaleDateString()}</td>
    </tr>`;
  }).join("");

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
      <div class="stat-card"><div class="value">${partners.reduce((sum, p) => sum + p.services.length, 0)}</div><div class="label">Total Services</div></div>
      <div class="stat-card"><div class="value">${partners.filter((p) => p.paymentMode === "platform").length}</div><div class="label">Platform Mode</div></div>
    </div>

    <h2>Partners</h2>
    ${partners.length > 0 ? `
    <table>
      <thead><tr><th>Partner</th><th>Services</th><th>Payment</th><th>Status</th><th>Joined</th></tr></thead>
      <tbody>${partnerRows}</tbody>
    </table>` : '<div class="empty">No partners yet. Partners will appear here after they complete the onboarding form.</div>'}
  </div>
</body>
</html>`;
}

function renderPartnerDetail(partner: PartnerConfig): string {
  const serviceLabels: Record<string, string> = {
    'semaglutide': 'Semaglutide', 'tirzepatide': 'Tirzepatide', 'retatrutide': 'Retatrutide',
    'sildenafil': 'Sildenafil', 'tadalafil': 'Tadalafil',
    'testosterone-injectable': 'TRT Injectable', 'testosterone-oral': 'TRT Oral',
    'enclomiphene': 'Enclomiphene', 'estrogen-cream-vaginal': 'Estrogen Cream (Vaginal)', 'estrogen-cream-systemic': 'Estrogen Cream (Systemic)', 'estrogen-patches': 'Estrogen Patches',
    'mots-c': 'MOTS-c', 'nad': 'NAD+', 'bpc-157': 'BPC-157', 'tb-500': 'TB-500',
    'wolverine': 'Wolverine', 'glo': 'GLO', 'klow': 'KLOW',
  };

  const feeRows = partner.services.map((s) => {
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
  }).join("");

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

    <!-- Embed Codes -->
    <div class="card">
      <h3>Embed Codes</h3>
      ${partner.services.map((s) => {
        const label = serviceLabels[s.type] || s.type;
        return `<div style="margin-bottom:12px">
          <div class="field-label">${label}</div>
          <code style="font-size:12px;background:#f0f0f0;padding:8px 12px;border-radius:6px;display:block;word-break:break-all">&lt;iframe src="https://onboard.myorbithealth.com/form/${partner.slug}/${s.type}" style="width:100%;min-height:800px;border:none;"&gt;&lt;/iframe&gt;</code>
        </div>`;
      }).join("")}
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

export default admin;
