import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import { getServiceById } from "../lib/services";
import { generateIntakeFormHTML } from "../templates/form-engine";
import { generateRecommendationHTML } from "../templates/recommendation";
import { generateCheckoutHTML } from "../templates/checkout";
import { createStripeClient, authorizePayment } from "./stripe";
import { createHealthieClient, createPatient, createFormCompletion } from "./healthie";

const intake = new Hono<{ Bindings: Env }>();

// Serve branded intake form
intake.get("/:slug/:serviceType", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false) return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig) return c.text("Service not available for this partner", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateIntakeFormHTML(service, partner, c.env.STRIPE_PUBLISHABLE_KEY || "", baseUrl);
  return c.html(html);
});

// Recommendation page (shown after intake)
intake.get("/:slug/:serviceType/recommend", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false) return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig) return c.text("Service not available", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateRecommendationHTML(service, partner, serviceConfig, baseUrl);
  return c.html(html);
});

// Checkout page
intake.get("/:slug/:serviceType/checkout", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false) return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig) return c.text("Service not available", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateCheckoutHTML(service, partner, serviceConfig, c.env.STRIPE_PUBLISHABLE_KEY || "", baseUrl);
  return c.html(html);
});

// Process intake form submission (from checkout)
intake.post("/:slug/:serviceType/submit", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.json({ error: "Partner not found" }, 404);

  const body = await c.req.json();
  const serviceConfig = partner.services.find((s) => s.type === serviceType);

  if (!serviceConfig) return c.json({ error: "Service not available" }, 400);

  // Determine charge amount based on selected plan
  const chargeAmount = body.selectedPlan?.price || serviceConfig.initialPrice;

  // 1. Authorize payment (don't charge yet)
  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
  let paymentIntentId: string;
  try {
    paymentIntentId = await authorizePayment(
      stripe,
      partner,
      chargeAmount,
      body.shipping?.email || "",
      body.paymentMethodId,
      serviceType
    );
  } catch (err) {
    console.error("Payment authorization failed:", err);
    return c.json({ error: "Payment authorization failed" }, 400);
  }

  // 2. Create patient in Healthie
  const healthie = createHealthieClient(c.env.HEALTHIE_API_KEY);
  let patientId: string | undefined;
  try {
    patientId = await createPatient(healthie, {
      firstName: body.answers?.firstName || "",
      lastName: body.answers?.lastName || "",
      email: body.answers?.email || "",
      phone: body.answers?.phone || "",
      dateOfBirth: body.answers?.dob || "",
      gender: body.answers?.gender || "",
      userGroupId: partner.healthieOrgId,
    });
  } catch (err) {
    console.error("Patient creation failed:", err);
    // Don't fail — payment is authorized, we can create the patient later
  }

  // 3. Submit intake form answers to Healthie
  if (patientId) {
    const healthieFormId = partner.healthieFormIds?.[serviceType];
    if (healthieFormId) {
      try {
        await createFormCompletion(healthie, patientId, healthieFormId, {
          ...body.answers,
          partner_slug: slug,
          service_type: serviceType,
          payment_intent_id: paymentIntentId,
          selected_plan: JSON.stringify(body.selectedPlan),
          subscription_price: serviceConfig.subscriptionPrice,
          disqualified: body.disqualified,
          disqualify_reasons: JSON.stringify(body.disqualifyReasons || []),
          shipping_address: JSON.stringify(body.shipping),
        });
      } catch (err) {
        console.error("Form completion failed:", err);
      }
    }
  }

  return c.json({
    success: true,
    patientId,
    paymentIntentId,
    message: "Your intake form has been submitted. A provider will review your information and you will only be charged if your prescription is approved.",
  });
});

export default intake;
