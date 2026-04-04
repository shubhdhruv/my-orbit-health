import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "../lib/types";
import onboard from "./onboard";
import intake from "./intake";
import webhooks from "./webhooks";
import { getPartner, listPartners } from "../lib/kv";

const app = new Hono<{ Bindings: Env }>();

// CORS for embedded forms
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
}));

// Influencer onboarding
app.route("/onboard", onboard);

// Patient intake forms
app.route("/form", intake);

// Webhooks
app.route("/webhooks", webhooks);

// Admin: list partners (protect this in production)
app.get("/admin/partners", async (c) => {
  const slugs = await listPartners(c.env.PARTNERS);
  const partners = await Promise.all(
    slugs.map((slug) => getPartner(c.env.PARTNERS, slug))
  );
  return c.json(partners.filter(Boolean));
});

// Admin: get single partner config
app.get("/admin/partners/:slug", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.json({ error: "Not found" }, 404);
  return c.json(partner);
});

// Health check
app.get("/", (c) => {
  return c.json({
    name: "My Orbit Health",
    status: "ok",
    version: "1.0.0",
  });
});

export default app;
