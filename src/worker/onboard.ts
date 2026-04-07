import { Hono } from "hono";
import { Env, PartnerConfig, ServiceId } from "../lib/types";
import { savePartner } from "../lib/kv";
import { SERVICE_CATALOG, getServiceById } from "../lib/services";
import {
  createHealthieClient,
  createUserGroup,
  buildIntakeFormInHealthie,
  createOnboardingFlow,
  addFormToOnboardingFlow,
} from "./healthie";
import { createStripeClient, createConnectAccount } from "./stripe";
import { createOrganization, buildIntakeQuestionnaire } from "./medplum";
import { sendEmail, buildOnboardingCompleteEmail } from "./email";

const onboard = new Hono<{ Bindings: Env }>();

// Serve the influencer onboarding form
onboard.get("/", (c) => {
  return c.html(ONBOARDING_FORM_HTML);
});

// Process influencer onboarding submission
onboard.post("/", async (c) => {
  const body = await c.req.json();

  const slug = body.businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Build partner config
  const partner: PartnerConfig = {
    slug,
    businessName: body.businessName,
    contactEmail: body.contactEmail,
    websiteUrl: body.websiteUrl,
    logoUrl: body.logoUrl,
    brandColors: {
      primary: body.primaryColor,
      secondary: body.secondaryColor,
    },
    font: body.font || "Inter",
    services: body.services.map((s: { type: ServiceId; initialPrice: number; subscriptionPrice: number }) => ({
      type: s.type,
      initialPrice: s.initialPrice,
      subscriptionPrice: s.subscriptionPrice,
      subscriptionInterval: "monthly" as const,
    })),
    paymentMode: body.paymentMode,
    healthieFormIds: {},
    platformFees: {},
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  // 1. Create Healthie user group for this influencer
  const healthie = createHealthieClient(c.env.HEALTHIE_API_KEY);
  try {
    const groupId = await createUserGroup(healthie, partner.businessName);
    partner.healthieOrgId = groupId;

    // 2. Create intake forms in Healthie for each selected service
    const formIds: Record<string, string> = {};
    for (const service of partner.services) {
      const serviceDef = getServiceById(service.type);
      if (serviceDef) {
        try {
          const { formId } = await buildIntakeFormInHealthie(healthie, serviceDef, partner.businessName);
          formIds[service.type] = formId;
        } catch (err) {
          console.error(`Failed to create Healthie form for ${service.type}:`, err);
        }
      }
    }
    partner.healthieFormIds = formIds;

    // 3. Create onboarding flow and attach forms
    if (Object.keys(formIds).length > 0) {
      try {
        const flowId = await createOnboardingFlow(healthie, `${partner.businessName} Onboarding`, groupId);
        for (const formId of Object.values(formIds)) {
          await addFormToOnboardingFlow(healthie, flowId, formId);
        }
      } catch (err) {
        console.error("Onboarding flow creation failed:", err);
      }
    }
  } catch (err) {
    console.error("Healthie setup failed:", err);
  }

  // 3b. Dual-write: Create Medplum Organization + Questionnaires
  try {
    const org = await createOrganization(c.env, partner.businessName, slug);
    partner.medplumOrgId = org.id;

    const medplumQIds: Record<string, string> = {};
    for (const service of partner.services) {
      const serviceDef = getServiceById(service.type);
      if (serviceDef) {
        try {
          const q = await buildIntakeQuestionnaire(c.env, serviceDef, partner.businessName);
          medplumQIds[service.type] = q.id;
        } catch (err) {
          console.error(`Medplum questionnaire for ${service.type} failed:`, err);
        }
      }
    }
    partner.medplumQuestionnaireIds = medplumQIds;
  } catch (err) {
    console.error("Medplum partner setup failed (non-blocking):", err);
  }

  // 4. Set up Stripe
  let stripeOnboardingUrl: string | undefined;
  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

  if (partner.paymentMode === "platform") {
    try {
      const connect = await createConnectAccount(stripe, partner.contactEmail, partner.businessName);
      partner.stripeConnectAccountId = connect.accountId;
      stripeOnboardingUrl = connect.onboardingUrl;
    } catch (err) {
      console.error("Stripe Connect creation failed:", err);
    }
  } else if (body.stripeAccountId) {
    partner.stripeDirectAccountId = body.stripeAccountId;
  }

  // 5. Save partner config to KV
  await savePartner(c.env.PARTNERS, partner);

  // 6. Generate embed code — labeled per service so developers know where each goes
  const baseUrl = new URL(c.req.url).origin;
  const serviceLabelsMap: Record<string, string> = {
    'semaglutide': 'Semaglutide (GLP-1 Weight Loss)',
    'tirzepatide': 'Tirzepatide (GLP-1 Weight Loss)',
    'retatrutide': 'Retatrutide (Weight Loss)',
    'sildenafil': 'Sildenafil (Erectile Dysfunction)',
    'tadalafil': 'Tadalafil (Erectile Dysfunction)',
    'testosterone-injectable': 'Testosterone Injectable',
    'testosterone-oral': 'Testosterone Oral',
    'enclomiphene': 'Enclomiphene (Male Hormone Optimization)',
    'estrogen-cream-vaginal': 'Estrogen Cream (Vaginal/GSM)',
    'estrogen-cream-systemic': 'Estrogen Cream (Systemic/Topical)',
    'estrogen-patches': 'Estrogen Patches',
    'mots-c': 'MOTS-c (Metabolic Peptide)',
    'nad': 'NAD+ (Cellular Energy)',
    'bpc-157': 'BPC-157 (Tissue Repair)',
    'tb-500': 'TB-500 (Injury Recovery)',
    'wolverine': 'Wolverine Blend (BPC-157 + TB-500)',
    'glo': 'GLO Blend (Skin & Tissue)',
    'klow': 'KLOW Blend (Anti-Inflammatory)',
  };
  const embedCode = partner.services
    .map(
      (s) =>
        `<!-- ${serviceLabelsMap[s.type] || s.type} Intake Form -->\n` +
        `<!-- Place this where you want the ${serviceLabelsMap[s.type] || s.type} form to appear -->\n` +
        `<iframe src="${baseUrl}/form/${slug}/${s.type}" style="width:100%;min-height:800px;border:none;" title="${partner.businessName} - ${serviceLabelsMap[s.type] || s.type}"></iframe>`
    )
    .join("\n\n");

  const previewUrl = `${baseUrl}/form/${slug}/${partner.services[0].type}`;

  // 7. Send welcome email with embed code
  try {
    await sendEmail(c.env.RESEND_API_KEY, {
      to: partner.contactEmail,
      subject: `Your My Orbit Health forms are ready, ${partner.businessName}!`,
      html: buildOnboardingCompleteEmail(
        partner.businessName,
        embedCode,
        previewUrl,
        stripeOnboardingUrl
      ),
    });
  } catch (err) {
    console.error("Email send failed:", err);
  }

  return c.json({
    success: true,
    slug,
    embedCode,
    previewUrl,
    stripeOnboardingUrl,
    healthieGroupId: partner.healthieOrgId,
    healthieFormIds: partner.healthieFormIds,
    medplumOrgId: partner.medplumOrgId,
    medplumQuestionnaireIds: partner.medplumQuestionnaireIds,
  });
});

// ============================================================
// Onboarding Form HTML — all 17 services grouped by category
// ============================================================

const ONBOARDING_FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Partner With My Orbit Health</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }

    .container { max-width: 640px; margin: 0 auto; padding: 48px 24px; }

    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 16px; margin-bottom: 40px; }

    .step { display: none; }
    .step.active { display: block; }

    .step-indicator { display: flex; gap: 8px; margin-bottom: 32px; }
    .step-dot { width: 40px; height: 4px; border-radius: 2px; background: #e0e0e0; transition: background 0.3s; }
    .step-dot.active { background: #4F46E5; }
    .step-dot.completed { background: #22c55e; }

    h2 { font-size: 20px; font-weight: 700; margin-bottom: 16px; }

    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; margin-top: 20px; }
    input, select { width: 100%; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; font-family: inherit; }
    input:focus, select:focus { outline: none; border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }

    .color-row { display: flex; gap: 16px; }
    .color-row > div { flex: 1; }
    input[type="color"] { height: 48px; padding: 4px; cursor: pointer; }

    /* Service categories */
    .category { margin-bottom: 24px; }
    .category-title { font-size: 14px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }

    .service-card {
      border: 2px solid #e0e0e0; border-radius: 10px; padding: 14px 18px;
      margin-bottom: 8px; cursor: pointer; transition: all 0.15s;
      display: flex; align-items: center; gap: 12px;
    }
    .service-card:hover { border-color: #4F46E5; }
    .service-card.selected { border-color: #4F46E5; background: #f0f0ff; }
    .service-checkbox {
      width: 20px; height: 20px; min-width: 20px; border: 2px solid #ccc;
      border-radius: 4px; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .service-card.selected .service-checkbox { border-color: #4F46E5; background: #4F46E5; }
    .service-card.selected .service-checkbox::after {
      content: ''; width: 10px; height: 6px; border-left: 2px solid #fff;
      border-bottom: 2px solid #fff; transform: rotate(-45deg); margin-bottom: 2px;
    }
    .service-info h3 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .service-info p { font-size: 12px; color: #888; }

    /* Pricing fields */
    .price-section { display: none; margin-top: 12px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; }
    .price-section.visible { display: block; }
    .price-section h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    .price-row { display: flex; gap: 16px; }
    .price-row > div { flex: 1; }
    .price-row label { margin-top: 0; }

    /* Payment */
    .payment-option {
      border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px;
      margin-bottom: 12px; cursor: pointer; transition: all 0.2s;
    }
    .payment-option:hover { border-color: #4F46E5; }
    .payment-option.selected { border-color: #4F46E5; background: #f0f0ff; }
    .payment-option h3 { font-size: 15px; margin-bottom: 4px; }
    .payment-option p { font-size: 13px; color: #666; }

    /* Review */
    .review-section { background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 12px; border: 1px solid #e0e0e0; }
    .review-section h3 { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .review-value { font-size: 14px; margin-bottom: 4px; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;
      border: none; cursor: pointer; transition: all 0.2s; margin-top: 24px; font-family: inherit;
    }
    .btn-primary { background: #4F46E5; color: white; width: 100%; }
    .btn-primary:hover { background: #4338CA; }
    .btn-secondary { background: #e0e0e0; color: #333; }
    .btn-row { display: flex; gap: 12px; }
    .btn-row .btn { flex: 1; }

    .success-screen { text-align: center; padding: 60px 20px; }
    .success-screen h2 { font-size: 24px; margin-bottom: 12px; color: #22c55e; }
    .embed-code { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; text-align: left; font-size: 13px; overflow-x: auto; margin: 20px 0; white-space: pre-wrap; word-break: break-all; }

    @media (max-width: 480px) { .price-row, .color-row { flex-direction: column; gap: 0; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Partner With My Orbit Health</h1>
    <p class="subtitle">Set up your white-label telehealth forms in minutes.</p>

    <div class="step-indicator">
      <div class="step-dot active" data-step="1"></div>
      <div class="step-dot" data-step="2"></div>
      <div class="step-dot" data-step="3"></div>
      <div class="step-dot" data-step="4"></div>
      <div class="step-dot" data-step="5"></div>
    </div>

    <!-- Step 1: About You -->
    <div class="step active" data-step="1">
      <h2>About Your Brand</h2>
      <label for="businessName">Business Name</label>
      <input type="text" id="businessName" placeholder="e.g. FitLife Wellness" required>
      <label for="contactEmail">Contact Email</label>
      <input type="email" id="contactEmail" placeholder="you@yourbrand.com" required>
      <label for="websiteUrl">Website URL</label>
      <input type="url" id="websiteUrl" placeholder="https://yourbrand.com">
      <label for="logoUrl">Logo URL</label>
      <input type="url" id="logoUrl" placeholder="https://yourbrand.com/logo.png">
      <div class="color-row">
        <div><label for="primaryColor">Primary Color</label><input type="color" id="primaryColor" value="#4F46E5"></div>
        <div><label for="secondaryColor">Secondary Color</label><input type="color" id="secondaryColor" value="#1a1a2e"></div>
      </div>
      <label for="font">Font</label>
      <select id="font">
        <option value="Inter">Inter</option><option value="Playfair Display">Playfair Display</option>
        <option value="Montserrat">Montserrat</option><option value="Roboto">Roboto</option>
        <option value="Poppins">Poppins</option><option value="DM Sans">DM Sans</option>
      </select>
      <button class="btn btn-primary" onclick="nextStep()">Continue</button>
    </div>

    <!-- Step 2: Services -->
    <div class="step" data-step="2">
      <h2>Select Services to Offer</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Choose which telehealth services your patients can access.</p>

      <div class="category">
        <div class="category-title">Weight Loss</div>
        <div class="service-card" data-service="semaglutide" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Semaglutide</h3><p>GLP-1 weight management program</p></div>
        </div>
        <div class="service-card" data-service="tirzepatide" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Tirzepatide</h3><p>Dual GIP/GLP-1 weight management</p></div>
        </div>
        <div class="service-card" data-service="retatrutide" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Retatrutide</h3><p>Triple agonist weight management</p></div>
        </div>
      </div>

      <div class="category">
        <div class="category-title">Erectile Dysfunction</div>
        <div class="service-card" data-service="sildenafil" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Sildenafil</h3><p>On-demand ED treatment</p></div>
        </div>
        <div class="service-card" data-service="tadalafil" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Tadalafil</h3><p>Daily or on-demand ED treatment</p></div>
        </div>
      </div>

      <div class="category">
        <div class="category-title">Men's Hormone Therapy</div>
        <div class="service-card" data-service="testosterone-injectable" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Testosterone Injectable</h3><p>Testosterone cypionate/enanthate</p></div>
        </div>
        <div class="service-card" data-service="testosterone-oral" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Testosterone Oral</h3><p>Oral testosterone undecanoate</p></div>
        </div>
        <div class="service-card" data-service="enclomiphene" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Enclomiphene</h3><p>Fertility-preserving hormone optimization</p></div>
        </div>
      </div>

      <div class="category">
        <div class="category-title">Women's Hormone Therapy</div>
        <div class="service-card" data-service="estrogen-cream-vaginal" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Estrogen Cream (Vaginal/GSM)</h3><p>Vaginal estradiol for genitourinary syndrome of menopause</p></div>
        </div>
        <div class="service-card" data-service="estrogen-cream-systemic" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Estrogen Cream (Systemic)</h3><p>Topical estradiol cream for systemic menopause relief</p></div>
        </div>
        <div class="service-card" data-service="estrogen-patches" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Estrogen Patches</h3><p>Transdermal estradiol patches</p></div>
        </div>
      </div>

      <div class="category">
        <div class="category-title">Peptides</div>
        <div class="service-card" data-service="mots-c" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>MOTS-c</h3><p>Mitochondrial peptide for metabolic optimization</p></div>
        </div>
        <div class="service-card" data-service="nad" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>NAD+</h3><p>Cellular energy and DNA repair</p></div>
        </div>
        <div class="service-card" data-service="bpc-157" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>BPC-157</h3><p>Body protection compound for tissue repair</p></div>
        </div>
        <div class="service-card" data-service="tb-500" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>TB-500</h3><p>Thymosin beta-4 for injury recovery</p></div>
        </div>
      </div>

      <div class="category">
        <div class="category-title">Blends</div>
        <div class="service-card" data-service="wolverine" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>Wolverine Blend</h3><p>BPC-157 + TB-500 regenerative combo</p></div>
        </div>
        <div class="service-card" data-service="glo" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>GLO Blend</h3><p>GHK-Cu + BPC-157 + TB-500 for skin & tissue</p></div>
        </div>
        <div class="service-card" data-service="klow" onclick="toggleService(this)">
          <div class="service-checkbox"></div>
          <div class="service-info"><h3>KLOW Blend</h3><p>GHK-Cu + BPC-157 + TB-500 + KPV anti-inflammatory</p></div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn btn-primary" onclick="nextStep()">Continue</button>
      </div>
    </div>

    <!-- Step 3: Pricing -->
    <div class="step" data-step="3">
      <h2>Set Your Prices</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Set the prices your patients will see at checkout.</p>
      <div id="pricingSections"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn btn-primary" onclick="nextStep()">Continue</button>
      </div>
    </div>

    <!-- Step 4: Payment -->
    <div class="step" data-step="4">
      <h2>Payment Setup</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Choose how you want to receive payments.</p>
      <div class="payment-option selected" data-mode="platform" onclick="selectPaymentMode(this)">
        <h3>Deposits to My Bank (Recommended)</h3>
        <p>We process payments and deposit earnings directly to your bank account. No merchant account needed.</p>
      </div>
      <div class="payment-option" data-mode="direct" onclick="selectPaymentMode(this)">
        <h3>Use My Own Stripe Account</h3>
        <p>Payments go directly through your Stripe account. You must have an active Stripe account.</p>
      </div>
      <div id="stripeIdField" style="display: none;">
        <label for="stripeAccountId">Your Stripe Account ID</label>
        <input type="text" id="stripeAccountId" placeholder="acct_...">
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn btn-primary" onclick="nextStep()">Continue</button>
      </div>
    </div>

    <!-- Step 5: Review -->
    <div class="step" data-step="5">
      <h2>Review & Submit</h2>
      <div class="review-section"><h3>Brand</h3><p class="review-value" id="reviewBusiness"></p><p class="review-value" id="reviewEmail"></p></div>
      <div class="review-section"><h3>Services & Pricing</h3><div id="reviewServices"></div></div>
      <div class="review-section"><h3>Payment</h3><p class="review-value" id="reviewPayment"></p></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn btn-primary" onclick="submitOnboarding()">Launch My Forms</button>
      </div>
    </div>

    <!-- Success -->
    <div class="step" data-step="success" style="display:none;">
      <div class="success-screen">
        <h2>You're Live!</h2>
        <p>Your branded telehealth forms are ready. Check your email for the embed code.</p>
        <div id="embedCodeDisplay" class="embed-code"></div>
        <a id="previewLink" class="btn btn-primary" href="#" target="_blank" style="text-decoration:none;margin-top:16px">Preview Your Forms</a>
      </div>
    </div>
  </div>

  <script>
    let currentStep = 1;
    let selectedServices = [];
    let paymentMode = 'platform';

    const serviceLabels = {
      'semaglutide': 'Semaglutide', 'tirzepatide': 'Tirzepatide', 'retatrutide': 'Retatrutide',
      'sildenafil': 'Sildenafil', 'tadalafil': 'Tadalafil',
      'testosterone-injectable': 'Testosterone Injectable', 'testosterone-oral': 'Testosterone Oral',
      'enclomiphene': 'Enclomiphene', 'estrogen-cream-vaginal': 'Estrogen Cream (Vaginal)', 'estrogen-cream-systemic': 'Estrogen Cream (Systemic)', 'estrogen-patches': 'Estrogen Patches',
      'mots-c': 'MOTS-c', 'nad': 'NAD+', 'bpc-157': 'BPC-157', 'tb-500': 'TB-500',
      'wolverine': 'Wolverine Blend', 'glo': 'GLO Blend', 'klow': 'KLOW Blend'
    };

    function nextStep() {
      if (currentStep === 2) updatePricingSections();
      if (currentStep === 5) return;
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.remove('active');
      currentStep++;
      if (currentStep === 5) populateReview();
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.add('active');
      updateDots();
    }

    function prevStep() {
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.remove('active');
      currentStep--;
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.add('active');
      updateDots();
    }

    function updateDots() {
      document.querySelectorAll('.step-dot').forEach(dot => {
        const step = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (step === currentStep) dot.classList.add('active');
        if (step < currentStep) dot.classList.add('completed');
      });
    }

    function toggleService(el) {
      const service = el.dataset.service;
      el.classList.toggle('selected');
      if (selectedServices.includes(service)) {
        selectedServices = selectedServices.filter(s => s !== service);
      } else {
        selectedServices.push(service);
      }
    }

    function updatePricingSections() {
      const container = document.getElementById('pricingSections');
      container.innerHTML = selectedServices.map(s => {
        const label = serviceLabels[s] || s;
        return '<div class="price-section visible"><h3>' + label + '</h3><div class="price-row">' +
          '<div><label>Initial Consultation ($)</label><input type="number" id="price-' + s + '-initial" placeholder="349" min="1"></div>' +
          '<div><label>Monthly Subscription ($)</label><input type="number" id="price-' + s + '-monthly" placeholder="299" min="1"></div>' +
          '</div></div>';
      }).join('');
    }

    function selectPaymentMode(el) {
      document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      paymentMode = el.dataset.mode;
      document.getElementById('stripeIdField').style.display = paymentMode === 'direct' ? 'block' : 'none';
    }

    function populateReview() {
      document.getElementById('reviewBusiness').textContent = document.getElementById('businessName').value;
      document.getElementById('reviewEmail').textContent = document.getElementById('contactEmail').value;

      let html = '';
      selectedServices.forEach(s => {
        const label = serviceLabels[s] || s;
        const initial = document.getElementById('price-' + s + '-initial')?.value || '—';
        const monthly = document.getElementById('price-' + s + '-monthly')?.value || '—';
        html += '<p class="review-value">' + label + ': $' + initial + ' initial / $' + monthly + '/mo</p>';
      });
      document.getElementById('reviewServices').innerHTML = html;
      document.getElementById('reviewPayment').textContent =
        paymentMode === 'platform' ? 'Bank deposits (we handle payments)' : 'Own Stripe account';
    }

    async function submitOnboarding() {
      const services = selectedServices.map(s => ({
        type: s,
        initialPrice: parseInt(document.getElementById('price-' + s + '-initial')?.value) || 0,
        subscriptionPrice: parseInt(document.getElementById('price-' + s + '-monthly')?.value) || 0,
      }));

      const payload = {
        businessName: document.getElementById('businessName').value,
        contactEmail: document.getElementById('contactEmail').value,
        websiteUrl: document.getElementById('websiteUrl').value,
        logoUrl: document.getElementById('logoUrl').value,
        primaryColor: document.getElementById('primaryColor').value,
        secondaryColor: document.getElementById('secondaryColor').value,
        font: document.getElementById('font').value,
        services,
        paymentMode,
        stripeAccountId: paymentMode === 'direct' ? document.getElementById('stripeAccountId').value : undefined,
      };

      const btn = event.target;
      btn.textContent = 'Setting up...';
      btn.disabled = true;

      try {
        const res = await fetch('/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.success) {
          document.querySelector('.step[data-step="5"]').classList.remove('active');
          const successEl = document.querySelector('.step[data-step="success"]');
          successEl.style.display = 'block';
          successEl.classList.add('active');
          document.getElementById('embedCodeDisplay').textContent = data.embedCode;
          document.getElementById('previewLink').href = data.previewUrl;
          document.querySelector('.step-indicator').style.display = 'none';
        } else {
          alert('Something went wrong. Please try again.');
          btn.textContent = 'Launch My Forms';
          btn.disabled = false;
        }
      } catch (err) {
        alert('Something went wrong. Please try again.');
        btn.textContent = 'Launch My Forms';
        btn.disabled = false;
        console.error(err);
      }
    }
  </script>
</body>
</html>`;

export default onboard;
