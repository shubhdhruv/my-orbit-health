import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "../lib/types";
import onboard from "./onboard";
import intake from "./intake";
import webhooks from "./webhooks";
import admin from "./admin";
import mdReview from "./md-review";
import doctor from "./doctor";
import priceList from "./price-list";
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import manifestJSON from "__STATIC_CONTENT_MANIFEST";

const assetManifest = JSON.parse(manifestJSON);

const app = new Hono<{ Bindings: Env }>();

// CORS for embedded forms
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Influencer onboarding
app.route("/onboard", onboard);

// Patient intake forms
app.route("/form", intake);

// Webhooks
app.route("/webhooks", webhooks);

// Admin panel (password protected)
app.route("/admin", admin);

// MD protocol review (password protected)
app.route("/md-review", mdReview);

// Doctor approve/deny portal (password protected)
app.route("/doctor", doctor);

// Price list API (token protected)
app.route("/price-list/api", priceList);

// Serve static assets (price-list HTML/JS files)
app.get("/price-list/*", async (c, next) => {
  // Skip API routes — let them fall through to the priceList router
  if (c.req.path.startsWith("/price-list/api")) return next();
  try {
    const response = await getAssetFromKV(
      {
        request: c.req.raw,
        waitUntil: (p: Promise<any>) => c.executionCtx.waitUntil(p),
      },
      {
        ASSET_NAMESPACE: (c.env as any).__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
      }
    );
    return new Response(response.body, response);
  } catch {
    return next();
  }
});

// Serve /price-list/ as index.html
app.get("/price-list", async (c) => {
  try {
    const url = new URL(c.req.url);
    url.pathname = "/price-list/index.html";
    const response = await getAssetFromKV(
      {
        request: new Request(url.toString(), c.req.raw),
        waitUntil: (p: Promise<any>) => c.executionCtx.waitUntil(p),
      },
      {
        ASSET_NAMESPACE: (c.env as any).__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
      }
    );
    return new Response(response.body, response);
  } catch {
    return c.text("Not found", 404);
  }
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
