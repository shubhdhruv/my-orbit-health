import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner, savePendingCase } from "../lib/kv";
import { PendingCase } from "../lib/types";
import { getServiceById } from "../lib/services";
import { generateIntakeFormHTML } from "../templates/form-engine";
import { generateRecommendationHTML } from "../templates/recommendation";
import { generateCheckoutHTML } from "../templates/checkout";
import { generateTermsOfService, generatePrivacyPolicy, generateTelehealthConsent } from "../templates/legal";
import { createStripeClient, authorizePayment } from "./stripe";
import {
  createPatient as createMedplumPatient,
  createQuestionnaireResponse,
} from "./medplum";
import { routePatient, RoutingResult } from "../lib/router";
import { evaluateDosing, DosingResult } from "../lib/dosing";
import { notifyOnIntake } from "./notify";

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
  const html = generateCheckoutHTML(service, partner, serviceConfig, c.env.STRIPE_PUBLISHABLE_KEY || "", baseUrl, c.env.STRIPE_BYPASS === "true");
  return c.html(html);
});

// Legal pages (auto-branded per partner)
intake.get("/:slug/terms", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generateTermsOfService(partner));
});

intake.get("/:slug/privacy", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generatePrivacyPolicy(partner));
});

intake.get("/:slug/telehealth-consent", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generateTelehealthConsent(partner));
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

  // Route patient: determine sync vs async based on state + service
  const patientState = body.shipping?.state || body.answers?.state || "";
  let routing: RoutingResult | undefined;
  if (patientState) {
    try {
      routing = routePatient(patientState, serviceType, true, body.daysSinceLastVisit);
    } catch (err) {
      console.error("Routing lookup failed:", err);
    }
  }

  // 0.5. Run dosing engine — evaluate eligibility, starting dose, flags
  const dosingResult = evaluateDosing(serviceType, body.answers || {}, body.labResults);

  // If hard blocked by dosing engine, return immediately — don't authorize payment
  if (dosingResult.hardBlocked) {
    return c.json({
      success: false,
      disqualified: true,
      reasons: dosingResult.disqualifiers.filter(d => d.blockType === "hard").map(d => d.reason),
      message: "Based on your responses, this service is not available for you. Our team will reach out to discuss alternative options.",
    });
  }

  // 1. Authorize payment (don't charge yet)
  let paymentIntentId: string;
  if (c.env.STRIPE_BYPASS === "true") {
    paymentIntentId = `bypass_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  } else {
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
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
  }

  // 2. Create patient + questionnaire response in Medplum
  let medplumPatientId: string | undefined;
  try {
    const medplumPatient = await createMedplumPatient(c.env, {
      firstName: body.answers?.firstName || "",
      lastName: body.answers?.lastName || "",
      email: body.answers?.email || "",
      phone: body.answers?.phone || "",
      dateOfBirth: body.answers?.dob || "",
      gender: body.answers?.gender || "",
      organizationId: partner.medplumOrgId || "",
    });
    medplumPatientId = medplumPatient.id;

    // Submit intake answers as QuestionnaireResponse
    const medplumQuestionnaireId = partner.medplumQuestionnaireIds?.[serviceType];
    if (medplumQuestionnaireId) {
      await createQuestionnaireResponse(c.env, medplumPatientId, medplumQuestionnaireId, body.answers || {});
    }
  } catch (err) {
    console.error("Medplum patient creation failed:", err);
    // Don't fail — payment is authorized, we can create the patient later
  }

  // 3.5. Save pending case to KV for doctor portal
  try {
    const service = getServiceById(serviceType);
    const pendingCase: PendingCase = {
      paymentIntentId,
      status: "pending",
      patientName: `${body.answers?.firstName || ""} ${body.answers?.lastName || ""}`.trim(),
      patientEmail: body.answers?.email || body.shipping?.email || "",
      patientPhone: body.answers?.phone || "",
      patientState,
      patientDob: body.answers?.dob || "",
      medplumPatientId,
      partnerSlug: slug,
      partnerName: partner.businessName,
      serviceType,
      serviceName: service?.label || serviceType,
      chargeAmount,
      subscriptionPrice: serviceConfig.subscriptionPrice,
      paymentMethodId: body.paymentMethodId || "",
      visitType: routing?.visitType || "async",
      dosingResult: dosingResult,
      answers: body.answers || {},
      routingConstraints: routing?.constraints || [],
      createdAt: new Date().toISOString(),
      authExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await savePendingCase(c.env.PARTNERS, pendingCase);
  } catch (err) {
    console.error("Failed to save pending case to KV:", err);
  }

  // 4. Notify doctor + patient based on routing result
  let notifyResult;
  if (patientState) {
    try {
      notifyResult = await notifyOnIntake(c.env, {
        partnerSlug: slug,
        serviceType,
        patientName: `${body.answers?.firstName || ""} ${body.answers?.lastName || ""}`.trim(),
        patientEmail: body.answers?.email || body.shipping?.email || "",
        patientState,
        medplumPatientId,
        isFirstVisit: true,
        daysSinceLastVisit: body.daysSinceLastVisit,
        dosingResult,
      });
    } catch (err) {
      console.error("Notification orchestration failed:", err);
    }
  }

  const visitType = notifyResult?.visitType || routing?.visitType || "async";

  return c.json({
    success: true,
    medplumPatientId,
    paymentIntentId,
    visitType,
    message: visitType === "sync"
      ? "Your intake form has been submitted. A video visit is required for your state — you'll receive a link to schedule your appointment."
      : visitType === "in_person_required"
        ? "Your intake form has been submitted. An in-person visit is required in your state before we can proceed. Our team will reach out with next steps."
        : visitType === "blocked"
          ? "Unfortunately, this service is not available via telehealth in your state. Our team will contact you to discuss options."
          : "Your intake form has been submitted. A provider will review your information and you will only be charged if your prescription is approved.",
  });
});

export default intake;
