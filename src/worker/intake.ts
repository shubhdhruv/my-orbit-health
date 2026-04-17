import { Hono } from "hono";
import { Env } from "../lib/types";
import {
  getPartner,
  savePendingCase,
  getPendingCase,
  addCaseToPatientIndex,
  addCaseToPartnerIndex,
  savePatientEmailIndex,
  getPatientIdByEmail,
  getPatientCaseIds,
  saveMagicToken,
  getCoupon,
  recordCouponUsage,
} from "../lib/kv";
import { PendingCase } from "../lib/types";
import {
  sendEmail,
  getPartnerEmailConfig,
  buildPortalWelcomeEmail,
} from "./email";
import { getServiceById } from "../lib/services";
import { generateIntakeFormHTML } from "../templates/form-engine";
import { generateRecommendationHTML } from "../templates/recommendation";
import { generateCheckoutHTML } from "../templates/checkout";
import {
  generateTermsOfService,
  generatePrivacyPolicy,
  generateTelehealthConsent,
  generateElectronicCommunicationsConsent,
  generateCompoundedMedicationConsent,
  generateProgramEnrollmentTerms,
  DISCLOSURE_VERSION,
} from "../templates/legal";
import {
  createStripeClient,
  authorizePayment,
  chargeKitFee,
  ensureCustomerWithPaymentMethod,
} from "./stripe";

const BLOODWORK_KIT_PRICE_DEFAULT = 124.99;

// Generates a URL-safe random hex token for magic sign-in links.
async function createRandomToken(bytes = 32): Promise<string> {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
import {
  createPatient as createMedplumPatient,
  createQuestionnaireResponse,
  uploadBinary,
  createDocumentReference,
} from "./medplum";
import {
  submitUnifiedIntake,
  getEncounterMapping,
  searchPatient as searchPrxPatient,
} from "./prescribe-rx";
import type { UnifiedIntakeInput } from "./prescribe-rx";
import { routePatient, RoutingResult } from "../lib/router";
import { evaluateDosing, DosingResult } from "../lib/dosing";
import { notifyOnIntake } from "./notify";

const intake = new Hono<{ Bindings: Env }>();

// Serve branded intake form
intake.get("/:slug/:serviceType", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false)
    return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig)
    return c.text("Service not available for this partner", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateIntakeFormHTML(
    service,
    partner,
    c.env.STRIPE_PUBLISHABLE_KEY || "",
    baseUrl,
  );
  return c.html(html);
});

// Recommendation page (shown after intake)
intake.get("/:slug/:serviceType/recommend", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false)
    return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig) return c.text("Service not available", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateRecommendationHTML(
    service,
    partner,
    serviceConfig,
    baseUrl,
  );
  return c.html(html);
});

// Checkout page
intake.get("/:slug/:serviceType/checkout", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);
  if (partner.enabled === false)
    return c.text("This partner is currently inactive", 403);

  const service = getServiceById(serviceType);
  if (!service) return c.text("Service not found", 404);

  const serviceConfig = partner.services.find((s) => s.type === serviceType);
  if (!serviceConfig) return c.text("Service not available", 404);

  const baseUrl = new URL(c.req.url).origin;
  const html = generateCheckoutHTML(
    service,
    partner,
    serviceConfig,
    c.env.STRIPE_PUBLISHABLE_KEY || "",
    baseUrl,
    c.env.STRIPE_BYPASS === "true",
  );
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

intake.get("/:slug/electronic-communications-consent", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generateElectronicCommunicationsConsent(partner));
});

intake.get("/:slug/compounded-medication-consent", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generateCompoundedMedicationConsent(partner));
});

intake.get("/:slug/enrollment-terms", async (c) => {
  const partner = await getPartner(c.env.PARTNERS, c.req.param("slug"));
  if (!partner) return c.text("Partner not found", 404);
  return c.html(generateProgramEnrollmentTerms(partner));
});

// Upload lab results file → Medplum Binary
intake.post("/:slug/:serviceType/upload-labs", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);
  if (!partner) return c.json({ error: "Partner not found" }, 404);

  const service = getServiceById(serviceType);
  if (!service) return c.json({ error: "Service not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize)
    return c.json({ error: "File too large (max 10MB)" }, 400);

  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
  if (!allowed.includes(file.type))
    return c.json({ error: "File type not supported" }, 400);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const binary = await uploadBinary(c.env, arrayBuffer, file.type);
    return c.json({ success: true, binaryId: binary.id, fileName: file.name });
  } catch (err) {
    console.error("Lab file upload failed:", err);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// Validate a promo code and return the discounted price
intake.post("/:slug/validate-coupon", async (c) => {
  const { slug } = c.req.param();
  const { code, serviceType, email, planPrice } = await c.req.json();

  if (!code || typeof code !== "string") {
    return c.json({ valid: false, error: "Enter a promo code" });
  }

  const coupon = await getCoupon(c.env.PARTNERS, code);
  if (!coupon || !coupon.active) {
    return c.json({ valid: false, error: "Invalid promo code" });
  }
  if (coupon.partnerSlug && coupon.partnerSlug !== slug) {
    return c.json({ valid: false, error: "Invalid promo code" });
  }
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return c.json({ valid: false, error: "This promo code has expired" });
  }
  if (coupon.onePerEmail && email) {
    const lower = email.toLowerCase();
    if (coupon.usedEmails.includes(lower)) {
      return c.json({ valid: false, error: "You have already used this code" });
    }
  }

  let discountedPrice: number;
  let discount: number;

  if (coupon.type === "percent") {
    discount = Math.round(planPrice * (coupon.value! / 100));
    discountedPrice = planPrice - discount;
  } else if (coupon.type === "fixed") {
    discount = Math.min(coupon.value!, planPrice);
    discountedPrice = Math.max(0, planPrice - discount);
  } else {
    // at-cost: pharmacy cost + $5 MOH fee
    const pharmacyCost = coupon.atCostPrices?.[serviceType];
    if (pharmacyCost === undefined) {
      return c.json({
        valid: false,
        error: "This code is not valid for this product",
      });
    }
    discountedPrice = pharmacyCost + 5;
    discount = Math.max(0, planPrice - discountedPrice);
  }

  return c.json({ valid: true, discountedPrice, discount, type: coupon.type });
});

// Process intake form submission (from checkout)
intake.post("/:slug/:serviceType/submit", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.json({ error: "Partner not found" }, 404);

  const body = await c.req.json();
  const serviceConfig = partner.services.find((s) => s.type === serviceType);

  if (!serviceConfig) return c.json({ error: "Service not available" }, 400);

  // Mutual-exclusion: only one service per group allowed per patient.
  // e.g., a patient should only be on one GLP-1 (semaglutide OR tirzepatide OR retatrutide).
  const EXCLUSIVE_GROUPS: string[][] = [
    ["semaglutide", "tirzepatide", "retatrutide"],
  ];
  const exclusiveGroup = EXCLUSIVE_GROUPS.find((g) => g.includes(serviceType));
  if (exclusiveGroup) {
    const patientEmail = (body.answers?.email || body.shipping?.email || "")
      .toString()
      .toLowerCase();
    if (patientEmail) {
      const existingPatientId = await getPatientIdByEmail(
        c.env.PARTNERS,
        slug,
        patientEmail,
      );
      if (existingPatientId) {
        const existingCaseIds = await getPatientCaseIds(
          c.env.PARTNERS,
          existingPatientId,
        );
        for (const caseId of existingCaseIds) {
          const existing = await getPendingCase(c.env.PARTNERS, caseId);
          if (
            existing &&
            existing.status === "pending" &&
            existing.partnerSlug === slug &&
            exclusiveGroup.includes(existing.serviceType) &&
            existing.serviceType !== serviceType
          ) {
            const conflictLabel = existing.serviceName || existing.serviceType;
            return c.json({
              success: false,
              blocked: true,
              message: `You already have a pending order for ${conflictLabel}. Only one medication in this class can be prescribed at a time.`,
            });
          }
        }
      }
    }
  }

  // Legal: patient must acknowledge the Patient Enrollment Disclosure
  // before we authorize payment or create any Medplum records. This is
  // a hard gate — refusal to acknowledge stops the flow cold.
  if (body.disclosureAcknowledged !== true) {
    return c.json(
      {
        error:
          "You must acknowledge the Patient Enrollment Disclosure before completing enrollment.",
      },
      400,
    );
  }
  const disclosureAcknowledgedAt = new Date().toISOString();
  const disclosureIp =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "";
  const disclosureUserAgent = c.req.header("User-Agent") || "";

  // Determine charge amount based on selected plan, then apply coupon if present
  let chargeAmount = body.selectedPlan?.price || serviceConfig.initialPrice;
  let couponCode: string | undefined;
  let couponDiscount: number | undefined;

  if (body.couponCode && typeof body.couponCode === "string") {
    const coupon = await getCoupon(c.env.PARTNERS, body.couponCode);
    if (coupon && coupon.active) {
      const validPartner = !coupon.partnerSlug || coupon.partnerSlug === slug;
      const withinLimit = !coupon.maxUses || coupon.usedCount < coupon.maxUses;
      const emailLower = (body.shipping?.email || "").toLowerCase();
      const notUsedByEmail =
        !coupon.onePerEmail || !coupon.usedEmails.includes(emailLower);

      if (validPartner && withinLimit && notUsedByEmail) {
        if (coupon.type === "percent") {
          couponDiscount = Math.round(chargeAmount * (coupon.value! / 100));
          chargeAmount = chargeAmount - couponDiscount;
        } else if (coupon.type === "fixed") {
          couponDiscount = Math.min(coupon.value!, chargeAmount);
          chargeAmount = Math.max(0, chargeAmount - couponDiscount);
        } else if (coupon.type === "at-cost") {
          const pharmacyCost = coupon.atCostPrices?.[serviceType];
          if (pharmacyCost !== undefined) {
            const newPrice = pharmacyCost + 5;
            couponDiscount = Math.max(0, chargeAmount - newPrice);
            chargeAmount = newPrice;
          }
        }
        if (couponDiscount && couponDiscount > 0) {
          couponCode = coupon.code;
          // NOTE: coupon usage is recorded later, AFTER routing and dosing
          // gates pass, so a blocked/disqualified patient doesn't burn a
          // redemption for nothing.
        }
      }
    }
  }

  // Route patient: determine sync vs async based on state + service
  const patientState = body.shipping?.state || body.answers?.state || "";
  let routing: RoutingResult | undefined;
  if (patientState) {
    try {
      routing = routePatient(
        patientState,
        serviceType,
        true,
        body.daysSinceLastVisit,
      );
    } catch (err) {
      console.error("Routing lookup failed:", err);
    }
  }

  // Fail closed: if we have a state but routing threw (e.g., service missing
  // from schedule_map), don't silently proceed to payment. This is the exact
  // bug that caused hair-loss / progesterone customers to get charged then
  // told "not available."
  if (patientState && !routing) {
    return c.json({
      success: false,
      blocked: true,
      message:
        "We're unable to verify service availability for your state. Please contact support.",
    });
  }

  // 0.5. Run dosing engine — evaluate eligibility, starting dose, flags
  const dosingResult = evaluateDosing(
    serviceType,
    body.answers || {},
    body.labResults,
  );

  // If hard blocked by dosing engine, return immediately — don't authorize payment
  if (dosingResult.hardBlocked) {
    return c.json({
      success: false,
      disqualified: true,
      reasons: dosingResult.disqualifiers
        .filter((d) => d.blockType === "hard")
        .map((d) => d.reason),
      message:
        "Based on your responses, this service is not available for you. Our team will reach out to discuss alternative options.",
    });
  }

  // 0.6. If routing says the service is blocked in this state, return immediately
  //       BEFORE authorizing payment. Previously the auth was placed first and
  //       then the patient received an email saying "card not charged" — but the
  //       auth hold appeared on their statement as a pending charge.
  if (routing?.visitType === "blocked") {
    return c.json({
      success: false,
      blocked: true,
      message:
        "Unfortunately, this service is not available via telehealth in your state. Our team will contact you to discuss options.",
    });
  }

  if (routing?.visitType === "in_person_required") {
    return c.json({
      success: false,
      blocked: true,
      message:
        "An in-person evaluation is required in your state before we can prescribe this medication via telehealth. Our team will reach out to help coordinate this.",
    });
  }

  // 0.7. Now that routing and dosing gates have passed, record coupon usage.
  //       Placed here so a blocked/disqualified patient doesn't burn a redemption.
  if (couponCode) {
    await recordCouponUsage(
      c.env.PARTNERS,
      couponCode,
      body.shipping?.email || "",
    );
  }

  // 1. Ensure a Stripe Customer exists with the payment method attached.
  //    This is required because a single PaymentMethod cannot be used on two
  //    separate PaymentIntents (rx auth + kit charge) unless it's attached
  //    to a Customer first.
  const service = getServiceById(serviceType);
  const bloodworkAnswer = body.answers?.["bloodwork-status"] as
    | string
    | undefined;
  const bloodworkStatus: "have-labs" | "buy-kit" | "not-required" =
    !service?.requiresBloodwork
      ? "not-required"
      : bloodworkAnswer === "have-labs"
        ? "have-labs"
        : bloodworkAnswer === "buy-kit"
          ? "buy-kit"
          : "not-required";

  let stripeCustomerId: string | undefined;
  if (c.env.STRIPE_BYPASS !== "true") {
    try {
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
      stripeCustomerId = await ensureCustomerWithPaymentMethod(
        stripe,
        partner,
        body.shipping?.email || "",
        body.paymentMethodId,
      );
    } catch (err) {
      console.error("Stripe customer setup failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Card setup failed: ${msg}` }, 400);
    }
  }

  // 2. Authorize the treatment payment (manual capture, captured on approval)
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
        serviceType,
        stripeCustomerId,
      );
    } catch (err) {
      console.error("Payment authorization failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Payment authorization failed: ${msg}` }, 400);
    }
  }

  let bloodworkDocRefId: string | undefined;

  // 2.5. If patient chose to buy the HRT Clearance Kit, charge it now
  let bloodworkKitPaymentId: string | undefined;
  if (bloodworkStatus === "buy-kit" && c.env.STRIPE_BYPASS !== "true") {
    try {
      const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
      bloodworkKitPaymentId = await chargeKitFee(
        stripe,
        partner,
        partner.bloodworkKitPrice ?? BLOODWORK_KIT_PRICE_DEFAULT,
        body.shipping?.email || "",
        body.paymentMethodId,
        stripeCustomerId,
      );
    } catch (err) {
      console.error("HRT Clearance Kit charge failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Kit charge failed: ${msg}` }, 400);
    }
  } else if (bloodworkStatus === "buy-kit") {
    // Bypass mode — simulate kit charge
    bloodworkKitPaymentId = `bypass_kit_${Date.now()}`;
  }

  // 3. Create patient + questionnaire response in Medplum
  //
  // On re-intake for the same email within this tenant, reuse the
  // existing Medplum Patient ID so the portal email index stays stable
  // and all orders aggregate under one patient. Otherwise a second
  // intake would orphan the first order from the portal dashboard.
  let medplumPatientId: string | undefined;
  try {
    const intakeEmailLower = (body.answers?.email || body.shipping?.email || "")
      .toString()
      .toLowerCase();
    if (intakeEmailLower) {
      const existingId = await getPatientIdByEmail(
        c.env.PARTNERS,
        slug,
        intakeEmailLower,
      );
      if (existingId) medplumPatientId = existingId;
    }
    if (!medplumPatientId) {
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
    }

    // Submit intake answers as QuestionnaireResponse
    const medplumQuestionnaireId =
      partner.medplumQuestionnaireIds?.[serviceType];
    if (medplumQuestionnaireId) {
      await createQuestionnaireResponse(
        c.env,
        medplumPatientId,
        medplumQuestionnaireId,
        body.answers || {},
      );
    }

    // Link uploaded lab file to patient via DocumentReference
    if (body.bloodworkBinaryId && medplumPatientId) {
      try {
        const docRef = await createDocumentReference(c.env, {
          patientId: medplumPatientId,
          binaryId: body.bloodworkBinaryId,
          contentType: body.bloodworkContentType || "application/pdf",
          description: `Lab results for ${serviceType} intake`,
        });
        bloodworkDocRefId = docRef.id;
      } catch (err) {
        console.error("DocumentReference creation failed:", err);
      }
    }
  } catch (err) {
    console.error("Medplum patient creation failed:", err);
    // Don't fail — payment is authorized, we can create the patient later
  }

  // 3.1. Dual-write: submit intake to PrescribeRx (new EMR).
  //       Runs in waitUntil so the patient doesn't wait on the PRX round-trip.
  //       On success, updates the PendingCase in KV with PRX IDs.
  //       Once migration is complete, Medplum calls above will be removed.
  const prxMapping = getEncounterMapping(serviceType as any);
  if (prxMapping && prxMapping.encounterTypeId) {
    // Strip PII keys from answers — these are passed in the structured
    // `patient` object; sending them again in `answers` leaks duplicates
    // into PrescribeRx's questionnaire storage.
    const PII_KEYS = new Set([
      "firstName",
      "lastName",
      "email",
      "phone",
      "dob",
      "gender",
      "heightInches",
      "weightLbs",
      "allergies",
      "medications",
      "conditions",
    ]);
    const questionnaireAnswers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.answers || {})) {
      if (!PII_KEYS.has(k)) questionnaireAnswers[k] = v;
    }

    const prxInput: UnifiedIntakeInput = {
      serviceId: serviceType as any,
      patient: {
        firstName: body.answers?.firstName || "",
        lastName: body.answers?.lastName || "",
        email: body.answers?.email || body.shipping?.email || "",
        phone: body.answers?.phone || "",
        dateOfBirth: body.answers?.dob || "",
        gender: body.answers?.gender || "",
        address: {
          street: body.shipping?.street || "",
          city: body.shipping?.city || "",
          state: body.shipping?.state || "",
          zip: body.shipping?.zip || "",
        },
      },
      answers: questionnaireAnswers as Record<
        string,
        string | string[] | boolean
      >,
    };

    // Pass vitals if present in intake answers
    const heightIn = Number(body.answers?.heightInches);
    const weightLb = Number(body.answers?.weightLbs);
    if (heightIn || weightLb) {
      prxInput.vitals = {
        ...(heightIn ? { heightInches: heightIn } : {}),
        ...(weightLb ? { weightLbs: weightLb } : {}),
      };
    }

    // Pass medical history fields if present
    if (
      body.answers?.allergies ||
      body.answers?.medications ||
      body.answers?.conditions
    ) {
      prxInput.allergies = body.answers.allergies || undefined;
      prxInput.medications = body.answers.medications || undefined;
      prxInput.conditions = body.answers.conditions || undefined;
    }

    // Capture refs needed inside waitUntil closure
    const kvRef = c.env.PARTNERS;
    const envRef = c.env;
    const piId = paymentIntentId;

    c.executionCtx.waitUntil(
      (async () => {
        try {
          // Check for existing PRX patient to avoid duplicates on re-intake.
          // Scoped to its own try so a search failure (API shape drift,
          // transient 5xx, etc.) cannot block the unified intake below —
          // PRX dedupes by email server-side regardless.
          const patientEmail = (
            body.answers?.email ||
            body.shipping?.email ||
            ""
          )
            .toString()
            .toLowerCase();
          if (patientEmail) {
            try {
              const existing = await searchPrxPatient(envRef, patientEmail);
              if (existing) {
                console.log(
                  `[PRX] Existing patient found: ${existing.id} — unified intake will update, not duplicate`,
                );
              }
            } catch (searchErr) {
              console.error(
                "[PRX] Patient dedup search failed (non-blocking):",
                searchErr,
              );
            }
          }

          const prxResult = await submitUnifiedIntake(envRef, prxInput);
          console.log(
            `[PRX] Intake submitted: encounter=${prxResult.encounter_id} patient=${prxResult.patient_chart_id}`,
          );

          // Update the PendingCase in KV with PRX IDs
          const savedCase = await getPendingCase(kvRef, piId);
          if (savedCase) {
            savedCase.prescribeRxPatientChartId = prxResult.patient_chart_id;
            savedCase.prescribeRxEncounterId = prxResult.encounter_id;
            await savePendingCase(kvRef, savedCase);
            console.log(`[PRX] PendingCase ${piId} updated with PRX IDs`);
          }
        } catch (err) {
          console.error("[PRX] Unified intake failed (non-blocking):", err);
        }
      })(),
    );
  } else {
    console.log(
      `[PRX] Skipped: no encounter type mapped for service ${serviceType}`,
    );
  }

  console.log(
    `[SUBMIT] ${slug}/${serviceType} patient=${body.answers?.email || "?"} amount=${chargeAmount} pi=${paymentIntentId}`,
  );

  // 3.5. Save pending case to KV for doctor portal
  try {
    const pendingCase: PendingCase = {
      paymentIntentId,
      status: "pending",
      patientName:
        `${body.answers?.firstName || ""} ${body.answers?.lastName || ""}`.trim(),
      patientEmail: body.answers?.email || body.shipping?.email || "",
      patientPhone: body.answers?.phone || "",
      patientState,
      patientDob: body.answers?.dob || "",
      shippingAddress: body.shipping
        ? {
            street: body.shipping.street || "",
            apt: body.shipping.apt || "",
            city: body.shipping.city || "",
            state: body.shipping.state || "",
            zip: body.shipping.zip || "",
          }
        : undefined,
      medplumPatientId,
      // prescribeRxPatientChartId + prescribeRxEncounterId are set
      // asynchronously via waitUntil (step 3.1) after KV save
      partnerSlug: slug,
      partnerName: partner.businessName,
      serviceType,
      serviceName: service?.label || serviceType,
      chargeAmount,
      subscriptionPrice: serviceConfig.subscriptionPrice,
      planMonths: body.selectedPlan?.months || 1,
      paymentMethodId: body.paymentMethodId || "",
      visitType: routing?.visitType || "async",
      dosingResult: dosingResult,
      bloodworkStatus,
      bloodworkBinaryId: body.bloodworkBinaryId,
      bloodworkDocRefId,
      bloodworkKitPurchased: bloodworkStatus === "buy-kit",
      bloodworkKitPaymentId,
      answers: body.answers || {},
      routingConstraints: routing?.constraints || [],
      // Coupon
      couponCode,
      couponDiscount,
      // Legal consent audit trail
      disclosureAcknowledged: true,
      disclosureAcknowledgedAt,
      disclosureVersion: DISCLOSURE_VERSION,
      disclosureIp,
      disclosureUserAgent,
      createdAt: new Date().toISOString(),
      authExpiresAt: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
    await savePendingCase(c.env.PARTNERS, pendingCase);

    // 3a. Maintain patient-side indexes so the portal can list a patient's
    // orders and resolve their email to a Medplum ID at login time.
    if (medplumPatientId) {
      await addCaseToPatientIndex(
        c.env.PARTNERS,
        medplumPatientId,
        pendingCase.paymentIntentId,
      );
      const lowerEmail = (body.answers?.email || body.shipping?.email || "")
        .toString()
        .toLowerCase();
      if (lowerEmail) {
        await savePatientEmailIndex(
          c.env.PARTNERS,
          slug,
          lowerEmail,
          medplumPatientId,
        );
      }
    }

    // 3a2. Maintain partner-side index so the partner dashboard can list
    // all orders for this partner without scanning every case in KV.
    await addCaseToPartnerIndex(
      c.env.PARTNERS,
      slug,
      pendingCase.paymentIntentId,
    );

    // 3b. Send portal welcome email with a magic sign-in link. Only fires
    // when the partner has a portalDomain configured — otherwise we skip
    // quietly so existing partners without the portal wired up aren't
    // affected. Failures are non-fatal: intake still completes.
    if (partner.portalDomain && medplumPatientId) {
      const welcomeEmail = (body.answers?.email || body.shipping?.email || "")
        .toString()
        .toLowerCase();
      const firstName =
        (body.answers?.firstName || "").toString().trim() || "there";
      if (welcomeEmail) {
        try {
          const token = await createRandomToken(32);
          await saveMagicToken(c.env.PARTNERS, token, {
            medplumPatientId,
            partnerSlug: slug,
            createdAt: new Date().toISOString(),
          });
          const magicUrl = `https://${partner.portalDomain}/portal/magic?token=${token}`;
          const { apiKey, from } = getPartnerEmailConfig(
            partner,
            c.env.RESEND_API_KEY,
          );
          const html = buildPortalWelcomeEmail({
            patientFirstName: firstName,
            brandName: partner.businessName,
            logoUrl: partner.logoUrl,
            primaryColor: partner.brandColors?.primary,
            magicUrl,
            serviceName: service?.label || serviceType,
          });
          await sendEmail(
            apiKey,
            {
              to: welcomeEmail,
              subject: `Welcome to ${partner.businessName} — track your order`,
              html,
            },
            from,
          );
        } catch (err) {
          console.error("Portal welcome email failed:", err);
        }
      }
    }
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
        patientName:
          `${body.answers?.firstName || ""} ${body.answers?.lastName || ""}`.trim(),
        patientEmail: body.answers?.email || body.shipping?.email || "",
        patientState,
        paymentIntentId: body.stripePaymentIntentId,
        medplumPatientId,
        isFirstVisit: true,
        daysSinceLastVisit: body.daysSinceLastVisit,
        dosingResult,
        bloodworkStatus,
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
    message:
      visitType === "sync"
        ? "Your intake form has been submitted. A video visit is required for your state — you'll receive a link to schedule your appointment."
        : visitType === "in_person_required"
          ? "Your intake form has been submitted. An in-person visit is required in your state before we can proceed. Our team will reach out with next steps."
          : visitType === "blocked"
            ? "Unfortunately, this service is not available via telehealth in your state. Our team will contact you to discuss options."
            : "Your intake form has been submitted. A provider will review your information and you will only be charged if your prescription is approved.",
  });
});

export default intake;
