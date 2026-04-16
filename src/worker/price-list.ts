import { Hono } from "hono";
import { Env } from "../lib/types";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(salt + password),
  );
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${hash}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, storedHash] = stored.split(":");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(salt + password),
  );
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hash === storedHash;
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => chars[b % chars.length])
    .join("");
}

function getToken(c: any): string | null {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function getSession(kv: KVNamespace, token: string) {
  const raw = await kv.get(`pl_session:${token}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (new Date(session.expires_at) < new Date()) {
    await kv.delete(`pl_session:${token}`);
    return null;
  }
  return session;
}

async function requireAdmin(
  c: any,
): Promise<{ session: any; token: string } | Response> {
  const token = getToken(c);
  if (!token) return c.json({ error: "Missing authorization token" }, 401);
  const session = await getSession(c.env.PARTNERS, token);
  if (!session) return c.json({ error: "Invalid or expired session" }, 401);
  if (session.role !== "admin")
    return c.json({ error: "Admin access required" }, 403);
  return { session, token };
}

async function logEvent(
  kv: KVNamespace,
  username: string,
  action: string,
  source: string,
  ip?: string,
) {
  const key = `pl_log:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
  await kv.put(
    key,
    JSON.stringify({
      username,
      action,
      source,
      ip: ip || "unknown",
      timestamp: new Date().toISOString(),
    }),
    { expirationTtl: 86400 * 90 },
  );
}

// ---------------------------------------------------------------------------
// DocuSign JWT Auth (Web Crypto — no Node SDK needed)
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string): string {
  return btoa(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getDocuSignAccessToken(env: any): Promise<string> {
  const kv = env.PARTNERS as KVNamespace;

  // Check cached token
  const cached = await kv.get("pl_docusign_token");
  if (cached) {
    const { token, expires_at } = JSON.parse(cached);
    if (Date.now() < expires_at - 60000) return token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: env.DOCUSIGN_INTEGRATION_KEY,
      sub: env.DOCUSIGN_USER_ID,
      aud: "account-d.docusign.com",
      iat: now,
      exp: now + 3600,
      scope: "signature impersonation",
    }),
  );

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.DOCUSIGN_RSA_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigData = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    sigData,
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch("https://account-d.docusign.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DocuSign auth failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  await kv.put(
    "pl_docusign_token",
    JSON.stringify({
      token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }),
    { expirationTtl: data.expires_in },
  );

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /setup — One-time admin account creation
app.post("/setup", async (c) => {
  const kv = c.env.PARTNERS;
  const existing = await kv.get("pl_setup_done");
  if (existing) {
    return c.json({ error: "Setup already completed" }, 400);
  }

  const body = await c.req.json<{
    admin_name: string;
    admin_password: string;
  }>();
  if (!body.admin_name || !body.admin_password) {
    return c.json({ error: "admin_name and admin_password are required" }, 400);
  }

  const password_hash = await hashPassword(body.admin_password);

  const user = {
    username: "admin",
    name: body.admin_name,
    password_hash,
    role: "admin",
    tier: "default",
    active: true,
    created_at: new Date().toISOString(),
  };

  await kv.put("pl_user:admin", JSON.stringify(user));
  await kv.put("pl_setup_done", "true");

  await logEvent(
    kv,
    "admin",
    "setup_complete",
    "setup",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({ ok: true, message: "Admin account created" });
});

// POST /login — Authenticate and create session
app.post("/login", async (c) => {
  const kv = c.env.PARTNERS;
  const body = await c.req.json<{ username: string; password: string }>();

  if (!body.username || !body.password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const raw = await kv.get(`pl_user:${body.username}`);
  if (!raw) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const user = JSON.parse(raw);
  if (!user.active) {
    return c.json({ error: "Account disabled" }, 401);
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    await logEvent(
      kv,
      body.username,
      "login_failed",
      "login",
      c.req.header("CF-Connecting-IP"),
    );
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const session = {
    username: user.username,
    name: user.name,
    role: user.role,
    tier: user.tier,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };

  await kv.put(`pl_session:${token}`, JSON.stringify(session), {
    expirationTtl: 86400,
  });

  await logEvent(
    kv,
    user.username,
    "login",
    "login",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({ token, name: user.name, role: user.role, tier: user.tier });
});

// POST /logout — Invalidate session
app.post("/logout", async (c) => {
  const kv = c.env.PARTNERS;
  const token = getToken(c);
  if (!token) {
    return c.json({ error: "Missing authorization token" }, 401);
  }

  const session = await getSession(kv, token);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  await kv.delete(`pl_session:${token}`);
  await logEvent(
    kv,
    session.username,
    "logout",
    "logout",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({ ok: true });
});

// GET /verify — Check session validity
app.get("/verify", async (c) => {
  const kv = c.env.PARTNERS;
  const token = getToken(c);
  if (!token) {
    return c.json({ valid: false }, 401);
  }

  const session = await getSession(kv, token);
  if (!session) {
    return c.json({ valid: false }, 401);
  }

  return c.json({
    valid: true,
    name: session.name,
    role: session.role,
    tier: session.tier,
  });
});

// GET /admin/users — List all price-list users
app.get("/admin/users", async (c) => {
  const kv = c.env.PARTNERS;
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;

  const list = await kv.list({ prefix: "pl_user:" });
  const users: any[] = [];

  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    const user = JSON.parse(raw);
    const { password_hash, ...safe } = user;
    users.push(safe);
  }

  return c.json({ users });
});

// POST /admin/users — Create a new user
app.post("/admin/users", async (c) => {
  const kv = c.env.PARTNERS;
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json<{
    username: string;
    password: string;
    name: string;
    tier?: string;
  }>();

  if (!body.username || !body.password || !body.name) {
    return c.json({ error: "username, password, and name are required" }, 400);
  }

  const existing = await kv.get(`pl_user:${body.username}`);
  if (existing) {
    return c.json({ error: "Username already exists" }, 409);
  }

  const password_hash = await hashPassword(body.password);

  const user = {
    username: body.username,
    name: body.name,
    password_hash,
    role: "user",
    tier: body.tier || "default",
    active: true,
    created_at: new Date().toISOString(),
  };

  await kv.put(`pl_user:${body.username}`, JSON.stringify(user));

  await logEvent(
    kv,
    auth.session.username,
    `created_user:${body.username}`,
    "admin",
    c.req.header("CF-Connecting-IP"),
  );

  const { password_hash: _, ...safe } = user;
  return c.json({ ok: true, user: safe });
});

// DELETE /admin/users/:username — Delete a user
app.delete("/admin/users/:username", async (c) => {
  const kv = c.env.PARTNERS;
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;

  const username = c.req.param("username");

  if (username === "admin") {
    return c.json({ error: "Cannot delete admin account" }, 400);
  }

  const existing = await kv.get(`pl_user:${username}`);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  await kv.delete(`pl_user:${username}`);

  await logEvent(
    kv,
    auth.session.username,
    `deleted_user:${username}`,
    "admin",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({ ok: true });
});

// GET /admin/logs — List all log events
app.get("/admin/logs", async (c) => {
  const kv = c.env.PARTNERS;
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;

  const list = await kv.list({ prefix: "pl_log:" });
  const logs: any[] = [];

  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    logs.push(JSON.parse(raw));
  }

  logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return c.json({ logs });
});

// POST /create-user — Programmatic user creation via API key
app.post("/create-user", async (c) => {
  const kv = c.env.PARTNERS;

  const apiKey = c.req.header("x-api-key");
  if (!apiKey) {
    return c.json({ error: "Missing x-api-key header" }, 401);
  }

  const storedKey = await kv.get("pl_api_key");
  if (!storedKey || apiKey !== storedKey) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  const body = await c.req.json<{
    name: string;
    email: string;
    tier?: string;
  }>();
  if (!body.name || !body.email) {
    return c.json({ error: "name and email are required" }, 400);
  }

  // Generate username from name: lowercase, replace spaces with dots, append random suffix
  const base = body.name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  const suffix = Math.random().toString(36).slice(2, 6);
  const username = `${base}.${suffix}`;

  const password = generatePassword();
  const password_hash = await hashPassword(password);

  const user = {
    username,
    name: body.name,
    email: body.email,
    password_hash,
    role: "user",
    tier: body.tier || "default",
    active: true,
    created_at: new Date().toISOString(),
  };

  await kv.put(`pl_user:${username}`, JSON.stringify(user));

  await logEvent(
    kv,
    username,
    "user_created_via_api",
    "api",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({
    username,
    password,
    login_url: "/price-list/login",
  });
});

// POST /set-api-key — Set the API key for programmatic access
app.post("/set-api-key", async (c) => {
  const kv = c.env.PARTNERS;
  const auth = await requireAdmin(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json<{ api_key: string }>();
  if (!body.api_key) {
    return c.json({ error: "api_key is required" }, 400);
  }

  await kv.put("pl_api_key", body.api_key);

  await logEvent(
    kv,
    auth.session.username,
    "set_api_key",
    "admin",
    c.req.header("CF-Connecting-IP"),
  );

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// NDA Form Submission (DocuSign)
// ---------------------------------------------------------------------------

app.post("/nda", async (c) => {
  const { name, email, company } = await c.req.json();
  if (!name || !email || !company) {
    return c.json({ error: "Name, email, and company are required" }, 400);
  }

  const env = c.env as any;
  if (!env.DOCUSIGN_INTEGRATION_KEY || !env.DOCUSIGN_TEMPLATE_ID) {
    return c.json({ error: "DocuSign is not configured" }, 500);
  }

  try {
    const kv = c.env.PARTNERS;
    const accessToken = await getDocuSignAccessToken(env);
    const accountId = env.DOCUSIGN_ACCOUNT_ID;
    const baseUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}`;

    // Store signer info in KV for webhook lookup
    const signerKey = `pl_nda_signer:${email.toLowerCase()}`;
    await kv.put(signerKey, JSON.stringify({ name, email, company }), {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    // Create and send envelope from template
    const envelopeRes = await fetch(`${baseUrl}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateId: env.DOCUSIGN_TEMPLATE_ID,
        templateRoles: [
          {
            email,
            name,
            roleName: "Signer",
          },
        ],
        status: "sent",
        emailSubject: "NDA - My Orbit Health",
        emailBlurb: `Hi ${name.split(" ")[0]}, please review and sign the attached Non-Disclosure Agreement. Once signed, you'll receive access to our partner price list.`,
      }),
    });

    if (!envelopeRes.ok) {
      const errBody = await envelopeRes.text();
      console.error("DocuSign envelope error:", envelopeRes.status, errBody);
      return c.json({ error: `DocuSign error (${envelopeRes.status})` }, 500);
    }

    await logEvent(kv, email, "nda_sent", "nda");
    return c.json({ success: true });
  } catch (err: any) {
    console.error("NDA error:", err);
    return c.json(
      { error: err.message || "An unexpected error occurred" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// DocuSign Webhook — auto-create credentials on envelope completion
// ---------------------------------------------------------------------------

app.post("/docusign/webhook", async (c) => {
  const kv = c.env.PARTNERS;
  const env = c.env as any;

  try {
    const json = (await c.req.json()) as any;

    // Only process envelope-completed events
    if (json.event !== "envelope-completed") return c.json({ ok: true });

    const envelopeId = json.data?.envelopeId;
    if (!envelopeId) {
      console.error("Webhook: no envelopeId");
      return c.json({ ok: true });
    }

    // Fetch envelope recipients from DocuSign
    const accessToken = await getDocuSignAccessToken(env);
    const accountId = env.DOCUSIGN_ACCOUNT_ID;
    const recipientsRes = await fetch(
      `https://demo.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!recipientsRes.ok) {
      console.error(
        "Webhook: failed to fetch recipients:",
        recipientsRes.status,
      );
      return c.json({ ok: true });
    }

    const recipientsData = (await recipientsRes.json()) as any;
    const signers = recipientsData.signers || [];
    const signer =
      signers.find((s: any) => s.roleName === "Signer") || signers[0];

    if (!signer?.email) {
      console.error("Webhook: no signer email found");
      return c.json({ ok: true });
    }

    const signerEmail = signer.email.toLowerCase();
    const signerName = signer.name || "";

    // Look up stored signer info
    const signerKey = `pl_nda_signer:${signerEmail}`;
    const signerRaw = await kv.get(signerKey);
    const signerInfo = signerRaw
      ? JSON.parse(signerRaw)
      : { name: signerName, email: signerEmail };

    // Generate username from name
    const username = signerInfo.name
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .trim()
      .split(/\s+/)
      .join("")
      .slice(0, 20);

    let finalUsername = username;
    let counter = 1;
    while (await kv.get(`pl_user:${finalUsername}`)) {
      finalUsername = `${username}${counter}`;
      counter++;
    }

    const password = generatePassword();
    const hash = await hashPassword(password);

    await kv.put(
      `pl_user:${finalUsername}`,
      JSON.stringify({
        username: finalUsername,
        name: signerInfo.name,
        email: signerInfo.email,
        password_hash: hash,
        role: "user",
        tier: "default",
        active: true,
        created_at: new Date().toISOString(),
      }),
    );

    await logEvent(
      kv,
      "docusign",
      `created_user:${finalUsername} (${signerInfo.email})`,
      "webhook",
    );

    // Send credentials email via Resend
    if (env.RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "My Orbit Health <noreply@myorbithealth.com>",
          to: [signerInfo.email],
          subject: "Your Price List Access — My Orbit Health",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; width: 48px; height: 48px; position: relative;">
                  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#2563eb" stroke-width="2.5"/>
                    <circle cx="24" cy="24" r="8" fill="#2563eb"/>
                  </svg>
                </div>
              </div>
              <h1 style="font-size: 22px; color: #111; margin-bottom: 8px;">Welcome, ${signerInfo.name.split(" ")[0]}!</h1>
              <p style="color: #666; font-size: 15px; line-height: 1.6;">Thank you for signing the NDA. Here are your login credentials for our partner price list:</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <p style="margin: 0 0 12px; font-size: 14px;"><strong style="color: #111;">Username:</strong> <code style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">${finalUsername}</code></p>
                <p style="margin: 0; font-size: 14px;"><strong style="color: #111;">Password:</strong> <code style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">${password}</code></p>
              </div>
              <a href="https://onboard.myorbithealth.com/price-list/" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">View Price List</a>
              <p style="color: #999; font-size: 12px; margin-top: 32px;">This email was sent by My Orbit Health. If you have questions, contact support@myorbithealth.com.</p>
            </div>
          `,
        }),
      });

      if (!emailRes.ok) {
        console.error(
          "Resend email error:",
          emailRes.status,
          await emailRes.text(),
        );
      }
    }

    // Clean up signer info
    await kv.delete(signerKey);

    return c.json({ ok: true, username: finalUsername });
  } catch (err) {
    console.error("Webhook error:", err);
    return c.json({ ok: true });
  }
});

export default app;
