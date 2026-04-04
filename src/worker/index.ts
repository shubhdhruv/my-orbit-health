import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "../lib/types";
import onboard from "./onboard";
import intake from "./intake";
import webhooks from "./webhooks";
import admin from "./admin";

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

// Admin panel (password protected)
app.route("/admin", admin);

// Health check
app.get("/", (c) => {
  return c.json({
    name: "My Orbit Health",
    status: "ok",
    version: "1.0.0",
  });
});

export default app;
