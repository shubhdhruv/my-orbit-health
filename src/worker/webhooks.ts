import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import { createStripeClient, capturePayment, createSubscription } from "./stripe";

const webhooks = new Hono<{ Bindings: Env }>();

// Healthie webhook: fires when a prescription is approved or denied
webhooks.post("/healthie", async (c) => {
  const body = await c.req.json();

  // Healthie sends different event types
  const eventType = body.event_type;

  if (eventType === "form_answer_group.completed" || eventType === "prescription.approved") {
    const formData = body.resource_data || {};
    const partnerSlug = formData.partner_slug;
    const paymentIntentId = formData.payment_intent_id;
    const serviceType = formData.service_type;
    const patientEmail = formData.patient_email;
    const subscriptionPrice = parseFloat(formData.subscription_price || "0");

    if (!partnerSlug || !paymentIntentId) {
      console.error("Missing partner_slug or payment_intent_id in webhook data");
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
      console.log(`Payment captured: ${paymentIntentId} for partner ${partnerSlug}`);
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
          serviceType
        );
        console.log(`Subscription created: ${subscriptionId} for ${patientEmail}`);
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
            : undefined
        );
        console.log(`Payment cancelled: ${paymentIntentId} (prescription denied)`);
      } catch (err) {
        console.error(`Payment cancellation failed for ${paymentIntentId}:`, err);
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
    event = stripe.webhooks.constructEvent(rawBody, signature, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.log(`Subscription payment failed for customer ${invoice.customer}`);
      // TODO: Send notification email to patient and partner
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      console.log(`Subscription cancelled: ${subscription.id}`);
      // TODO: Update patient status in Healthie
      break;
    }
  }

  return c.json({ received: true });
});

export default webhooks;
