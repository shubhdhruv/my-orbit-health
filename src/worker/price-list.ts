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
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(salt + password));
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, storedHash] = stored.split(":");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(salt + password));
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

async function requireAdmin(c: any): Promise<{ session: any; token: string } | Response> {
  const token = getToken(c);
  if (!token) return c.json({ error: "Missing authorization token" }, 401);
  const session = await getSession(c.env.PARTNERS, token);
  if (!session) return c.json({ error: "Invalid or expired session" }, 401);
  if (session.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  return { session, token };
}

async function logEvent(
  kv: KVNamespace,
  username: string,
  action: string,
  source: string,
  ip?: string
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
    { expirationTtl: 86400 * 90 }
  );
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

  const body = await c.req.json<{ admin_name: string; admin_password: string }>();
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

  await logEvent(kv, "admin", "setup_complete", "setup", c.req.header("CF-Connecting-IP"));

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
    await logEvent(kv, body.username, "login_failed", "login", c.req.header("CF-Connecting-IP"));
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

  await logEvent(kv, user.username, "login", "login", c.req.header("CF-Connecting-IP"));

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
  await logEvent(kv, session.username, "logout", "logout", c.req.header("CF-Connecting-IP"));

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
    c.req.header("CF-Connecting-IP")
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
    c.req.header("CF-Connecting-IP")
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

  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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

  const body = await c.req.json<{ name: string; email: string; tier?: string }>();
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

  await logEvent(kv, username, "user_created_via_api", "api", c.req.header("CF-Connecting-IP"));

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
    c.req.header("CF-Connecting-IP")
  );

  return c.json({ ok: true });
});

export default app;
