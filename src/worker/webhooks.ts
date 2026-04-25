import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import {
  createStripeClient,
  capturePayment,
  createSubscription,
} from "./stripe";
import { sendEmail } from "./email";
import { CONSULT_RECIPIENTS } from "./consult";

const webhooks = new Hono<{ Bindings: Env }>();

// Healthie webhook: fires when a prescription is approved or denied
webhooks.post("/healthie", async (c) => {
  const body = await c.req.json();

  // Healthie sends different event types
  const eventType = body.event_type;

  if (
    eventType === "form_answer_group.completed" ||
    eventType === "prescription.approved"
  ) {
    const formData = body.resource_data || {};
    const partnerSlug = formData.partner_slug;
    const paymentIntentId = formData.payment_intent_id;
    const serviceType = formData.service_type;
    const patientEmail = formData.patient_email;
    const subscriptionPrice = parseFloat(formData.subscription_price || "0");

    if (!partnerSlug || !paymentIntentId) {
      console.error(
        "Missing partner_slug or payment_intent_id in webhook data",
      );
      return c.json({ error: "Missing required fields" }, 400);
    }

    const partner = await getPartner(c.env.PARTNERS, partnerSlug);
    if (!partner) {
      console.error(`Partner not found: ${partnerSlug}`);
      return c.json({ error: "Partner not found" }, 404);
    }

    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

    // 1. Capture the initial payment
    try {
      await capturePayment(stripe, paymentIntentId, partner);
      console.log(
        `Payment captured: ${paymentIntentId} for partner ${partnerSlug}`,
      );
    } catch (err) {
      console.error(`Payment capture failed for ${paymentIntentId}:`, err);
      return c.json({ error: "Payment capture failed" }, 500);
    }

    // 2. Set up monthly subscription if applicable
    if (subscriptionPrice > 0 && patientEmail && serviceType) {
      try {
        // Retrieve the payment intent to get the payment method
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        const paymentMethodId = pi.payment_method as string;

        const subscriptionId = await createSubscription(
          stripe,
          partner,
          patientEmail,
          paymentMethodId,
          subscriptionPrice,
          serviceType,
        );
        console.log(
          `Subscription created: ${subscriptionId} for ${patientEmail}`,
        );
      } catch (err) {
        console.error(`Subscription creation failed for ${patientEmail}:`, err);
        // Don't fail the whole webhook — initial payment was captured successfully
      }
    }

    return c.json({ success: true, action: "payment_captured" });
  }

  if (eventType === "prescription.denied") {
    const formData = body.resource_data || {};
    const paymentIntentId = formData.payment_intent_id;
    const partnerSlug = formData.partner_slug;

    if (paymentIntentId && partnerSlug) {
      const partner = await getPartner(c.env.PARTNERS, partnerSlug);
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

      // Cancel the authorization — patient never gets charged
      try {
        await stripe.paymentIntents.cancel(
          paymentIntentId,
          partner?.paymentMode === "direct" && partner?.stripeDirectAccountId
            ? { stripeAccount: partner.stripeDirectAccountId }
            : undefined,
        );
        console.log(
          `Payment cancelled: ${paymentIntentId} (prescription denied)`,
        );
      } catch (err) {
        console.error(
          `Payment cancellation failed for ${paymentIntentId}:`,
          err,
        );
      }
    }

    return c.json({ success: true, action: "payment_cancelled" });
  }

  // Acknowledge other event types (including custom_module_form.created)
  // Notifications are handled at intake submit time, not via webhook,
  // so we just ACK these to keep Healthie happy.
  return c.json({ received: true });
});

// Stripe webhook: handle subscription events
webhooks.post("/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  const rawBody = await c.req.text();
  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.log(
        `Subscription payment failed for customer ${invoice.customer}`,
      );
      // TODO: Send notification email to patient and partner
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      console.log(`Subscription cancelled: ${subscription.id}`);
      // TODO: Update patient status in Healthie
      break;
    }
    case "checkout.session.completed": {
      // $49.99 consultation flow (see worker/consult.ts). Other Checkout
      // Sessions don't carry metadata.type === "consultation" so they fall
      // through silently.
      const session = event.data.object as any;
      const meta = (session.metadata || {}) as Record<string, string>;
      if (meta.type !== "consultation") break;

      const slug = meta.partner_slug;
      const sessionId: string = session.id;
      if (!slug || !sessionId) {
        console.error("consult webhook: missing slug/session id", meta);
        break;
      }

      const recipients = CONSULT_RECIPIENTS[slug];
      if (!recipients || recipients.length === 0) {
        console.error(`consult webhook: no recipients for ${slug}`);
        break;
      }

      // Idempotency: KV record is the source of truth. Bail if already emailed.
      const kvKey = `consult:${slug}:${sessionId}`;
      const raw = await c.env.PARTNERS.get(kvKey);
      const record = raw ? JSON.parse(raw) : null;
      if (record?.emailedAt) {
        console.log(`consult webhook: already emailed ${kvKey}`);
        break;
      }

      const firstName = record?.firstName || meta.first_name || "";
      const lastName = record?.lastName || meta.last_name || "";
      const email = record?.email || meta.email || session.customer_email || "";
      const phone = record?.phone || meta.phone || "";
      const symptoms = record?.symptoms || meta.symptoms || "";
      const heardAbout = record?.heardAbout || meta.heard_about || "";
      const topics: string[] = Array.isArray(record?.topics)
        ? record.topics
        : (meta.topics || "").split(",").filter(Boolean);

      const esc = (s: string) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");

      const partner = await getPartner(c.env.PARTNERS, slug);
      const businessName = partner?.businessName || slug;
      const fullName = `${firstName} ${lastName}`.trim();

      const topicsHtml = topics.length
        ? topics.map((t) => `<div>• ${esc(t)}</div>`).join("")
        : "<em>(none selected)</em>";

      const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;line-height:1.55;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#10b981;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block;margin-bottom:14px">PAID — $49.99</div>
  <h2 style="color:#0B1F3A;margin:0 0 6px">New consultation booking</h2>
  <p style="color:#6B7280;font-size:13px;margin:0 0 24px">Submitted via the consultation form on ${esc(businessName)}.</p>

  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#6B7280;width:160px;vertical-align:top">Name</td><td style="padding:6px 0;font-weight:600">${esc(fullName) || "<em>(unknown)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Email</td><td style="padding:6px 0">${esc(email)}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Phone</td><td style="padding:6px 0">${esc(phone)}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Symptoms / concerns</td><td style="padding:6px 0;white-space:pre-wrap">${esc(symptoms) || "<em>(none)</em>"}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Topics to explore</td><td style="padding:6px 0">${topicsHtml}</td></tr>
    <tr><td style="padding:6px 0;color:#6B7280;vertical-align:top">Heard about / wants to discuss</td><td style="padding:6px 0;white-space:pre-wrap">${esc(heardAbout) || "<em>(none)</em>"}</td></tr>
  </table>

  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#6B7280;font-size:12px;margin:0">Stripe session: ${esc(sessionId)}</p>
  <p style="color:#6B7280;font-size:12px;margin:4px 0 0">Received: ${esc(new Date().toISOString())}</p>
  <p style="color:#1f2937;font-size:14px;margin:18px 0 0"><strong>Next step:</strong> reach out to ${esc(fullName) || "the patient"} within 24 hours to schedule.</p>
</body></html>`;

      try {
        await sendEmail(c.env.RESEND_API_KEY, {
          to: recipients.join(","),
          subject: `Paid consultation booking: ${fullName || email}`,
          html,
          replyTo: email || undefined,
        });
        // Mark emailed for idempotency on retries.
        if (record) {
          record.paid = true;
          record.emailedAt = new Date().toISOString();
          await c.env.PARTNERS.put(kvKey, JSON.stringify(record), {
            expirationTtl: 60 * 60 * 24 * 60,
          });
        }
        console.log(
          `consult webhook: emailed ${recipients.join(",")} for ${kvKey}`,
        );
      } catch (err) {
        console.error(`consult webhook: email send failed for ${kvKey}:`, err);
      }
      break;
    }
  }

  return c.json({ received: true });
});

export default webhooks;
