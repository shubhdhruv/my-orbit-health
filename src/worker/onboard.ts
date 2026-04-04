import { Hono } from "hono";
import { Env, PartnerConfig } from "../lib/types";
import { savePartner } from "../lib/kv";
import { createHealthieClient, createOrganization } from "./healthie";
import { createStripeClient, createConnectAccount } from "./stripe";
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
    services: body.services.map((s: { type: string; initialPrice: number; subscriptionPrice: number }) => ({
      type: s.type,
      initialPrice: s.initialPrice,
      subscriptionPrice: s.subscriptionPrice,
      subscriptionInterval: "monthly" as const,
    })),
    paymentMode: body.paymentMode,
    createdAt: new Date().toISOString(),
  };

  // 1. Create Healthie organization
  const healthie = createHealthieClient(c.env.HEALTHIE_API_KEY);
  try {
    const orgId = await createOrganization(healthie, partner.businessName);
    partner.healthieOrgId = orgId;
  } catch (err) {
    console.error("Healthie org creation failed:", err);
  }

  // 2. Set up Stripe
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

  // 3. Save partner config to KV
  await savePartner(c.env.PARTNERS, partner);

  // 4. Generate embed code
  const baseUrl = new URL(c.req.url).origin;
  const embedCode = partner.services
    .map(
      (s) =>
        `<iframe src="${baseUrl}/form/${slug}/${s.type}" style="width:100%;min-height:800px;border:none;" title="${partner.businessName} - ${s.type} Intake Form"></iframe>`
    )
    .join("\n");

  const previewUrl = `${baseUrl}/form/${slug}/${partner.services[0].type}`;

  // 5. Send welcome email with embed code
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
  });
});

// Placeholder — the actual HTML is below
const ONBOARDING_FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Partner With My Orbit Health</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }

    .container { max-width: 640px; margin: 0 auto; padding: 48px 24px; }

    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 16px; margin-bottom: 40px; }

    .step { display: none; }
    .step.active { display: block; }

    .step-indicator { display: flex; gap: 8px; margin-bottom: 32px; }
    .step-dot {
      width: 40px; height: 4px; border-radius: 2px; background: #e0e0e0;
      transition: background 0.3s;
    }
    .step-dot.active { background: #4F46E5; }
    .step-dot.completed { background: #22c55e; }

    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; margin-top: 20px; }
    input, select { width: 100%; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; }
    input:focus, select:focus { outline: none; border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }

    .color-row { display: flex; gap: 16px; }
    .color-row > div { flex: 1; }
    input[type="color"] { height: 48px; padding: 4px; cursor: pointer; }

    .service-card {
      border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px;
      margin-bottom: 16px; cursor: pointer; transition: all 0.2s;
    }
    .service-card:hover { border-color: #4F46E5; }
    .service-card.selected { border-color: #4F46E5; background: #f0f0ff; }
    .service-card h3 { font-size: 16px; margin-bottom: 4px; }
    .service-card p { font-size: 13px; color: #666; }

    .price-section { display: none; margin-top: 16px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; }
    .price-section.visible { display: block; }
    .price-row { display: flex; gap: 16px; }
    .price-row > div { flex: 1; }

    .payment-option {
      border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px;
      margin-bottom: 12px; cursor: pointer; transition: all 0.2s;
    }
    .payment-option:hover { border-color: #4F46E5; }
    .payment-option.selected { border-color: #4F46E5; background: #f0f0ff; }
    .payment-option h3 { font-size: 15px; margin-bottom: 4px; }
    .payment-option p { font-size: 13px; color: #666; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;
      border: none; cursor: pointer; transition: all 0.2s; margin-top: 24px;
    }
    .btn-primary { background: #4F46E5; color: white; }
    .btn-primary:hover { background: #4338CA; }
    .btn-secondary { background: #e0e0e0; color: #333; margin-right: 12px; }

    .btn-row { display: flex; justify-content: space-between; }

    .review-section { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; border: 1px solid #e0e0e0; }
    .review-section h3 { font-size: 14px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .review-value { font-size: 15px; margin-bottom: 4px; }

    .success-screen { text-align: center; padding: 60px 20px; }
    .success-screen h2 { font-size: 24px; margin-bottom: 12px; color: #22c55e; }
    .embed-code { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; text-align: left; font-size: 13px; overflow-x: auto; margin: 20px 0; }

    @media (max-width: 480px) {
      .price-row, .color-row { flex-direction: column; gap: 0; }
    }
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
        <div>
          <label for="primaryColor">Primary Color</label>
          <input type="color" id="primaryColor" value="#4F46E5">
        </div>
        <div>
          <label for="secondaryColor">Secondary Color</label>
          <input type="color" id="secondaryColor" value="#1a1a2e">
        </div>
      </div>

      <label for="font">Font</label>
      <select id="font">
        <option value="Inter">Inter</option>
        <option value="Playfair Display">Playfair Display</option>
        <option value="Montserrat">Montserrat</option>
        <option value="Roboto">Roboto</option>
        <option value="Poppins">Poppins</option>
        <option value="DM Sans">DM Sans</option>
      </select>

      <button class="btn btn-primary" onclick="nextStep()">Continue</button>
    </div>

    <!-- Step 2: Services -->
    <div class="step" data-step="2">
      <h2>Select Services to Offer</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Choose which telehealth services your patients can access.</p>

      <div class="service-card" data-service="semaglutide" onclick="toggleService(this)">
        <h3>GLP-1 Weight Loss (Semaglutide)</h3>
        <p>FDA-approved weight management program with provider consultation and ongoing monitoring.</p>
      </div>

      <div class="service-card" data-service="hrt" onclick="toggleService(this)">
        <h3>Hormone Replacement Therapy (HRT)</h3>
        <p>Comprehensive hormone therapy with lab review, provider consultation, and personalized treatment.</p>
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

      <div class="price-section" id="price-semaglutide">
        <h3 style="font-size: 16px; margin-bottom: 16px;">GLP-1 Weight Loss</h3>
        <div class="price-row">
          <div>
            <label for="semaglutideInitial">Initial Consultation ($)</label>
            <input type="number" id="semaglutideInitial" placeholder="349" min="1">
          </div>
          <div>
            <label for="semaglutideMonthly">Monthly Subscription ($)</label>
            <input type="number" id="semaglutideMonthly" placeholder="299" min="1">
          </div>
        </div>
      </div>

      <div class="price-section" id="price-hrt">
        <h3 style="font-size: 16px; margin-bottom: 16px;">Hormone Replacement Therapy</h3>
        <div class="price-row">
          <div>
            <label for="hrtInitial">Initial Consultation ($)</label>
            <input type="number" id="hrtInitial" placeholder="199" min="1">
          </div>
          <div>
            <label for="hrtMonthly">Monthly Subscription ($)</label>
            <input type="number" id="hrtMonthly" placeholder="149" min="1">
          </div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn btn-primary" onclick="nextStep()">Continue</button>
      </div>
    </div>

    <!-- Step 4: Payment -->
    <div class="step" data-step="4">
      <h2>Payment Setup</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Choose how you want to receive payments.</p>

      <div class="payment-option" data-mode="platform" onclick="selectPaymentMode(this)">
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

      <div class="review-section">
        <h3>Brand</h3>
        <p class="review-value" id="reviewBusiness"></p>
        <p class="review-value" id="reviewEmail"></p>
        <p class="review-value" id="reviewWebsite"></p>
      </div>

      <div class="review-section">
        <h3>Services & Pricing</h3>
        <div id="reviewServices"></div>
      </div>

      <div class="review-section">
        <h3>Payment</h3>
        <p class="review-value" id="reviewPayment"></p>
      </div>

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
        <a id="previewLink" class="btn btn-primary" href="#" target="_blank">Preview Your Forms</a>
      </div>
    </div>
  </div>

  <script>
    let currentStep = 1;
    let selectedServices = [];
    let paymentMode = 'platform';

    function nextStep() {
      if (currentStep === 3) updatePriceSections();
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
      updatePriceSections();
    }

    function updatePriceSections() {
      document.getElementById('price-semaglutide').classList.toggle('visible', selectedServices.includes('semaglutide'));
      document.getElementById('price-hrt').classList.toggle('visible', selectedServices.includes('hrt'));
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
      document.getElementById('reviewWebsite').textContent = document.getElementById('websiteUrl').value;

      let servicesHtml = '';
      selectedServices.forEach(s => {
        const label = s === 'semaglutide' ? 'GLP-1 Weight Loss' : 'HRT';
        const initial = document.getElementById(s + 'Initial').value || '—';
        const monthly = document.getElementById(s + 'Monthly').value || '—';
        servicesHtml += '<p class="review-value">' + label + ': $' + initial + ' initial / $' + monthly + '/mo</p>';
      });
      document.getElementById('reviewServices').innerHTML = servicesHtml;

      document.getElementById('reviewPayment').textContent =
        paymentMode === 'platform' ? 'Bank deposits (we handle payments)' : 'Own Stripe account';
    }

    async function submitOnboarding() {
      const services = selectedServices.map(s => ({
        type: s,
        initialPrice: parseInt(document.getElementById(s + 'Initial').value) || 0,
        subscriptionPrice: parseInt(document.getElementById(s + 'Monthly').value) || 0,
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
        }
      } catch (err) {
        alert('Something went wrong. Please try again.');
        console.error(err);
      }
    }
  </script>
</body>
</html>`;

export default onboard;
