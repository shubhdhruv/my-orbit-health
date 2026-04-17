#!/usr/bin/env node
// PrescribeRx dual-write smoke test — Session 5.
//
// Walks an existing PendingCase through the three doctor-side actions
// that fire PrescribeRx side-effects, and reports what PRX IDs land on
// the case after each stage.
//
// Prerequisites:
//   1. wrangler dev running (default http://localhost:8787)
//   2. PRX secrets loaded in .dev.vars:
//        PRESCRIBE_RX_BASE_URL
//        PRESCRIBE_RX_API_TOKEN
//        PRESCRIBE_RX_SALES_ORG_ID
//   3. A PendingCase submitted through the real intake form (this script
//      does NOT build an intake payload — too many structured fields +
//      Stripe auth). Use the form in a browser with STRIPE_BYPASS=true
//      to create a case, then pass its paymentIntentId here.
//   4. Env vars in the shell:
//        BASE_URL            (optional, default http://localhost:8787)
//        DOCTOR_PASSWORD     (plaintext; same password used in /doctor/login)
//        ADMIN_EMAIL         (for /admin healthcheck call)
//        ADMIN_PASSWORD      (plaintext; for /admin healthcheck call)
//
// Usage:
//   DOCTOR_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//     node scripts/smoke-prx.mjs <paymentIntentId>
//
// What to watch alongside:
//   In another terminal: `wrangler tail` (or the dev terminal) — grep
//   for `[PRX]` log lines emitted from doctor.ts.

const BASE_URL = process.env.BASE_URL || "http://localhost:8787";
const DOCTOR_PASSWORD = process.env.DOCTOR_PASSWORD || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CASE_ID = process.argv[2];

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function info(msg) {
  console.log(`  ${msg}`);
}

function section(title) {
  console.log(`\n━━ ${title} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ─── Preflight ────────────────────────────────────────────────
if (!CASE_ID) {
  die("Usage: node scripts/smoke-prx.mjs <paymentIntentId>");
}
if (!DOCTOR_PASSWORD) die("Set DOCTOR_PASSWORD env var");
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  die(
    "Set ADMIN_EMAIL and ADMIN_PASSWORD env vars (needed for PRX healthcheck)",
  );
}

// ─── Helpers ──────────────────────────────────────────────────
async function adminLogin() {
  // Admin session cookie = sha256(ADMIN_PASSWORD_HASH + YYYY-MM-DD).
  // Easiest: hit /admin/auth with email+password and capture Set-Cookie.
  const fd = new URLSearchParams();
  fd.set("email", ADMIN_EMAIL);
  fd.set("password", ADMIN_PASSWORD);
  const res = await fetch(`${BASE_URL}/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: fd.toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.get("Set-Cookie") || "";
  const match = setCookie.match(/admin_session=([^;]+)/);
  if (!match) {
    die(
      `Admin login failed (status ${res.status}, Set-Cookie: ${setCookie || "none"})`,
    );
  }
  return match[1];
}

async function doctorLogin() {
  const fd = new URLSearchParams();
  fd.set("password", DOCTOR_PASSWORD);
  const res = await fetch(`${BASE_URL}/doctor/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: fd.toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.get("Set-Cookie") || "";
  const match = setCookie.match(/doctor_session=([^;]+)/);
  if (!match) {
    die(
      `Doctor login failed (status ${res.status}, Set-Cookie: ${setCookie || "none"})`,
    );
  }
  return match[1];
}

async function prxHealthcheck(adminCookie) {
  const res = await fetch(`${BASE_URL}/admin/prescribe-rx-healthcheck`, {
    headers: { Cookie: `admin_session=${adminCookie}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Minimal valid PDF so content-type sniffing + PRX upload both accept it.
function synthPdf() {
  const pdf =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n";
  return Buffer.from(pdf, "utf8");
}

async function doctorPost(cookie, path, bodyJson) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `doctor_session=${cookie}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyJson),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function doctorUploadKit(cookie, caseId) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([synthPdf()], { type: "application/pdf" }),
    "smoke-kit-results.pdf",
  );
  const res = await fetch(
    `${BASE_URL}/doctor/case/${encodeURIComponent(caseId)}/upload-kit-results`,
    {
      method: "POST",
      headers: { Cookie: `doctor_session=${cookie}` },
      body: form,
    },
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ─── Run ──────────────────────────────────────────────────────
(async () => {
  section("Preflight — PrescribeRx healthcheck");
  const adminCookie = await adminLogin();
  ok("Admin login ok");
  const hc = await prxHealthcheck(adminCookie);
  if (hc.status !== 200 || !hc.body?.ok) {
    console.error("  healthcheck payload:", JSON.stringify(hc.body, null, 2));
    die(
      `PRX healthcheck failed (status ${hc.status}). Fix secrets/connectivity before running full smoke.`,
    );
  }
  ok(
    `PRX API reachable — authValid=${hc.body.authValid}, encounterTypes=${hc.body.encounterTypesLoaded}, products=${hc.body.productCount}, latency=${hc.body.latencyMs}ms`,
  );

  section("Doctor login");
  const doctorCookie = await doctorLogin();
  ok("Doctor cookie acquired");

  section(`Step 1 — Approve case ${CASE_ID}`);
  info(
    "Expect log lines: [PRX] Order created... / [PRX] Transaction reported...",
  );
  const approve = await doctorPost(
    doctorCookie,
    `/doctor/case/${encodeURIComponent(CASE_ID)}/approve`,
    {},
  );
  if (approve.status !== 200 || approve.body?.error) {
    console.error("  response:", JSON.stringify(approve.body, null, 2));
    die(
      `Approve failed (status ${approve.status}). Already approved? Missing SOAP? Missing labs?`,
    );
  }
  ok(`Approve returned: ${JSON.stringify(approve.body)}`);

  section("Step 2 — Mark bloodwork kit shipped (buy-kit only)");
  info(
    "Expect log lines: [PRX] Lab order created... (if service has labTestIds mapped)",
  );
  info("Skipped automatically for non-bloodwork / have-labs cases.");
  const shipped = await doctorPost(
    doctorCookie,
    `/doctor/case/${encodeURIComponent(CASE_ID)}/update-order`,
    {
      orderStatus: "bloodwork",
      bloodworkKitShipped: true,
    },
  );
  if (shipped.status !== 200) {
    console.error("  response:", JSON.stringify(shipped.body, null, 2));
    die(`Mark-kit-shipped failed (status ${shipped.status}).`);
  }
  ok(`Kit-shipped returned: ${JSON.stringify(shipped.body)}`);

  section("Step 3 — Upload synthetic kit results");
  info(
    "Expect log lines: [PRX] Kit results uploaded... OR [PRX] Skipped (case not buy-kit)",
  );
  const upload = await doctorUploadKit(doctorCookie, CASE_ID);
  if (upload.status === 400 && /buy-kit/.test(upload.body?.error || "")) {
    info(
      `Skipped upload — case is not buy-kit (${upload.body.error}). That's fine; other paths already covered.`,
    );
  } else if (upload.status !== 200) {
    console.error("  response:", JSON.stringify(upload.body, null, 2));
    die(`Upload failed (status ${upload.status}).`);
  } else {
    ok(`Upload returned binaryId=${upload.body.binaryId}`);
  }

  section("Done");
  info("Give waitUntil tasks a few seconds to flush, then either:");
  info(
    "  a) Open the doctor portal case page and check that prescribeRxOrderId / prescribeRxLabOrderId / prescribeRxLabResultsUploadedAt are set, or",
  );
  info(
    "  b) Watch `wrangler tail` for [PRX] log lines confirming each stage succeeded.",
  );
  info("");
  info("Known non-fatal skips (not bugs, waiting on catalog discovery):");
  info(
    "  - `productIds` empty in SERVICE_ENCOUNTER_MAP → createOrder is skipped",
  );
  info(
    "  - `labTestIds`/`labCollectionMethod` empty → createLabOrder is skipped",
  );
  info(
    "  - `hair-loss` / `hair-loss-women` have no encounter type → full PRX path skipped",
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
