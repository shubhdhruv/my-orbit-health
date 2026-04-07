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
import { getPendingCase } from "../lib/kv";
import { getPartner } from "../lib/kv";
import { processFollowUps } from "./followup";
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

// Clean URLs — serve .html files without extension
async function serveStaticPage(c: any, htmlPath: string) {
  try {
    const url = new URL(c.req.url);
    url.pathname = htmlPath;
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
}

app.get("/price-list", (c) => serveStaticPage(c, "/price-list/index.html"));
app.get("/price-list/nda", (c) => serveStaticPage(c, "/price-list/nda.html"));
app.get("/price-list/dashboard", (c) => serveStaticPage(c, "/price-list/dashboard.html"));

// ─── Patient Order Status Page (no auth — unique link in emails) ───

app.get("/status/:id", async (c) => {
  const id = c.req.param("id");
  const pendingCase = await getPendingCase(c.env.PARTNERS, id);
  if (!pendingCase) return c.html(renderStatusNotFound());

  const partner = await getPartner(c.env.PARTNERS, pendingCase.partnerSlug);
  const brandName = partner?.businessName || pendingCase.partnerName;
  const primaryColor = partner?.brandColors?.primary || "#4F46E5";
  const logoUrl = partner?.logoUrl || "";
  const font = partner?.font || "Inter";

  return c.html(renderStatusPage(pendingCase, brandName, primaryColor, logoUrl, font));
});

function renderStatusNotFound(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Order Not Found</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1)}h1{font-size:20px;margin-bottom:8px}p{color:#666;font-size:14px}</style></head>
  <body><div class="card"><h1>Order Not Found</h1><p>This link may have expired or is invalid. Check your email for the correct link, or contact support.</p></div></body></html>`;
}

function renderStatusPage(
  c: import("../lib/types").PendingCase,
  brandName: string,
  primaryColor: string,
  logoUrl: string,
  font: string,
): string {
  const firstName = c.patientName.split(" ")[0];

  // Status logic
  const isPending = c.status === "pending";
  const isDenied = c.status === "denied";
  const isApproved = c.status === "approved";

  // Step completion
  const step1Done = true; // Always submitted
  const step2Done = isApproved || isDenied;
  const step3Done = isApproved && (c.orderStatus === "prescribed" || c.orderStatus === "shipped" || c.orderStatus === "delivered");
  const step4Done = isApproved && (c.orderStatus === "shipped" || c.orderStatus === "delivered");
  const step5Done = isApproved && c.orderStatus === "delivered";

  // Current status message
  let statusMessage = "";
  let statusColor = "";
  if (isDenied) {
    statusMessage = "Your provider was unable to approve this prescription at this time.";
    statusColor = "#dc2626";
  } else if (isPending) {
    statusMessage = "Your intake is being reviewed by your provider. This typically takes 1-2 business days.";
    statusColor = "#f59e0b";
  } else if (c.orderStatus === "delivered") {
    statusMessage = "Your medication has been delivered. Follow the dosing instructions included with your shipment.";
    statusColor = "#22c55e";
  } else if (c.orderStatus === "shipped") {
    statusMessage = "Your medication is on the way!";
    statusColor = "#3b82f6";
  } else if (c.orderStatus === "prescribed") {
    statusMessage = "Your prescription has been approved and is being prepared by the pharmacy.";
    statusColor = "#6366f1";
  } else {
    statusMessage = "Your prescription has been approved.";
    statusColor = "#22c55e";
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const stepStyle = (done: boolean, active: boolean) => {
    if (done) return `background:${primaryColor};color:#fff;`;
    if (active) return `background:${primaryColor}20;color:${primaryColor};border:2px solid ${primaryColor};`;
    return `background:#e5e7eb;color:#999;`;
  };

  const labelStyle = (done: boolean) => done ? `color:${primaryColor};font-weight:600` : `color:#999`;

  // Tracking section
  let trackingHtml = "";
  if (c.trackingNumber) {
    trackingHtml = `<div style="background:#f8f9fa;border-radius:10px;padding:16px 20px;margin-top:20px">
      <p style="font-size:13px;font-weight:600;color:#333;margin:0 0 8px">Shipping Details</p>
      ${c.carrier ? `<p style="font-size:14px;color:#333;margin:0 0 4px"><strong>Carrier:</strong> ${esc(c.carrier)}</p>` : ""}
      <p style="font-size:14px;color:#333;margin:0 0 4px"><strong>Tracking:</strong> ${esc(c.trackingNumber)}</p>
      ${c.trackingUrl ? `<a href="${c.trackingUrl}" target="_blank" style="display:inline-block;margin-top:8px;background:${primaryColor};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Track Package</a>` : ""}
    </div>`;
  }

  // Dosing reminder for delivered
  let dosingHtml = "";
  if (c.orderStatus === "delivered" && c.dosingResult?.startingDose) {
    dosingHtml = `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-top:20px">
      <p style="font-size:13px;font-weight:600;color:#0369a1;margin:0 0 4px">Your Starting Dose</p>
      <p style="font-size:20px;font-weight:700;color:#333;margin:0">${esc(c.dosingResult.startingDose)}</p>
      <p style="font-size:13px;color:#666;margin:8px 0 0">Follow the instructions included with your medication. Contact your provider with any questions.</p>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Status — ${esc(brandName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --primary: ${primaryColor}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: '${font}', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; min-height: 100vh; }
    .container { max-width: 520px; margin: 0 auto; padding: 24px; }
    .logo { text-align: center; padding: 20px 0; }
    .logo img { max-height: 36px; max-width: 160px; }
    .status-card { background: #fff; border-radius: 16px; padding: 32px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .greeting { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .service-label { font-size: 14px; color: #888; margin-bottom: 20px; }
    .status-msg { font-size: 15px; color: #333; line-height: 1.5; padding: 16px; border-radius: 10px; margin-bottom: 24px; }
    .timeline { position: relative; padding-left: 48px; }
    .timeline::before { content: ''; position: absolute; left: 19px; top: 8px; bottom: 8px; width: 2px; background: #e5e7eb; }
    .step { position: relative; padding-bottom: 24px; }
    .step:last-child { padding-bottom: 0; }
    .step-dot { position: absolute; left: -48px; top: 0; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; z-index: 1; }
    .step-label { font-size: 14px; padding-top: 8px; }
    .step-time { font-size: 12px; color: #999; margin-top: 2px; }
    .footer { text-align: center; padding: 24px 0; font-size: 12px; color: #bbb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      ${logoUrl ? `<img src="${logoUrl}" alt="${esc(brandName)}" onerror="this.style.display='none'">` : `<p style="font-size:18px;font-weight:700">${esc(brandName)}</p>`}
    </div>

    <div class="status-card">
      <p class="greeting">Hi ${esc(firstName)}</p>
      <p class="service-label">${esc(c.serviceName)}</p>

      <div class="status-msg" style="background:${statusColor}10;border-left:4px solid ${statusColor}">
        ${statusMessage}
      </div>

      ${isDenied ? `
        ${c.denyReason ? `<div style="background:#f8f9fa;border-radius:10px;padding:16px 20px;margin-bottom:20px">
          <p style="font-size:13px;font-weight:600;color:#666;margin:0 0 4px">Provider's Note</p>
          <p style="font-size:14px;color:#333;margin:0">${esc(c.denyReason)}</p>
        </div>` : ""}
        <p style="font-size:14px;color:#666">Your card was <strong>not</strong> charged. If you have questions, reply to any email from ${esc(brandName)}.</p>
      ` : `
        <div class="timeline">
          <div class="step">
            <div class="step-dot" style="${stepStyle(step1Done, false)}">1</div>
            <div class="step-label" style="${labelStyle(step1Done)}">Intake Submitted</div>
            <div class="step-time">${new Date(c.createdAt).toLocaleDateString()}</div>
          </div>
          <div class="step">
            <div class="step-dot" style="${stepStyle(step2Done, isPending)}">2</div>
            <div class="step-label" style="${labelStyle(step2Done)}">${isPending ? "Under Review" : "Provider Reviewed"}</div>
            ${c.resolvedAt ? `<div class="step-time">${new Date(c.resolvedAt).toLocaleDateString()}</div>` : ""}
          </div>
          <div class="step">
            <div class="step-dot" style="${stepStyle(step3Done, step2Done && !step3Done)}">3</div>
            <div class="step-label" style="${labelStyle(step3Done)}">Prescription Sent to Pharmacy</div>
          </div>
          <div class="step">
            <div class="step-dot" style="${stepStyle(step4Done, step3Done && !step4Done)}">4</div>
            <div class="step-label" style="${labelStyle(step4Done)}">Shipped</div>
            ${c.shippedAt ? `<div class="step-time">${new Date(c.shippedAt).toLocaleDateString()}</div>` : ""}
          </div>
          <div class="step">
            <div class="step-dot" style="${stepStyle(step5Done, step4Done && !step5Done)}">5</div>
            <div class="step-label" style="${labelStyle(step5Done)}">Delivered</div>
            ${c.deliveredAt ? `<div class="step-time">${new Date(c.deliveredAt).toLocaleDateString()}</div>` : ""}
          </div>
        </div>

        ${trackingHtml}
        ${dosingHtml}
      `}
    </div>

    <div class="footer">&copy; ${new Date().getFullYear()} ${esc(brandName)}. All rights reserved.</div>
  </div>
</body>
</html>`;
}

// Health check
app.get("/", (c) => {
  return c.json({
    name: "My Orbit Health",
    status: "ok",
    version: "1.0.0",
  });
});

// ─── Scheduled handler (Cron Trigger) ────────────────────────

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      processFollowUps(env).then(({ sent, errors }) => {
        console.log(`Follow-up cron complete: ${sent} sent, ${errors} errors`);
      })
    );
  },
};
