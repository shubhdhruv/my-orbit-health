import { Hono } from "hono";
import { Env } from "../lib/types";
import { getPartner } from "../lib/kv";
import { injectBrand, injectPrices } from "../lib/brand";
import { createStripeClient, authorizePayment } from "./stripe";
import { createHealthieClient, createPatient, createFormCompletion } from "./healthie";

const intake = new Hono<{ Bindings: Env }>();

// Serve branded intake form
intake.get("/:slug/:serviceType", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.text("Partner not found", 404);

  const service = partner.services.find((s) => s.type === serviceType);
  if (!service) return c.text("Service not available for this partner", 404);

  let html = INTAKE_FORM_HTML;
  html = injectBrand(html, partner);
  html = injectPrices(html, serviceType, partner);

  // Inject Stripe publishable key placeholder
  html = html.replace(
    /\{\{STRIPE_CONFIG\}\}/g,
    JSON.stringify({
      partnerSlug: slug,
      serviceType,
      paymentMode: partner.paymentMode,
    })
  );

  return c.html(html);
});

// Process intake form submission
intake.post("/:slug/:serviceType/submit", async (c) => {
  const { slug, serviceType } = c.req.param();
  const partner = await getPartner(c.env.PARTNERS, slug);

  if (!partner) return c.json({ error: "Partner not found" }, 404);

  const body = await c.req.json();
  const service = partner.services.find((s) => s.type === serviceType);

  if (!service) return c.json({ error: "Service not available" }, 400);

  // 1. Authorize payment (don't charge yet)
  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
  let paymentIntentId: string;
  try {
    paymentIntentId = await authorizePayment(
      stripe,
      partner,
      service.initialPrice,
      body.patient.email,
      body.paymentMethodId
    );
  } catch (err) {
    console.error("Payment authorization failed:", err);
    return c.json({ error: "Payment authorization failed" }, 400);
  }

  // 2. Create patient in Healthie
  const healthie = createHealthieClient(c.env.HEALTHIE_API_KEY);
  let patientId: string;
  try {
    patientId = await createPatient(healthie, {
      ...body.patient,
      organizationId: partner.healthieOrgId,
    });
  } catch (err) {
    console.error("Patient creation failed:", err);
    return c.json({ error: "Patient creation failed" }, 500);
  }

  // 3. Submit intake form data to Healthie
  try {
    await createFormCompletion(healthie, patientId, {
      ...body.medicalHistory,
      partner_slug: slug,
      service_type: serviceType,
      payment_intent_id: paymentIntentId,
      initial_price: service.initialPrice,
      subscription_price: service.subscriptionPrice,
    });
  } catch (err) {
    console.error("Form completion failed:", err);
  }

  return c.json({
    success: true,
    patientId,
    paymentIntentId,
    message: "Your intake form has been submitted. A provider will review your information and you will only be charged if your prescription is approved.",
  });
});

const INTAKE_FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{BUSINESS_NAME}} - {{SERVICE_LABEL}}</title>
  <link href="https://fonts.googleapis.com/css2?family={{FONT}}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: '{{FONT}}', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }

    .form-container { max-width: 600px; margin: 0 auto; padding: 40px 24px; }

    .header {
      text-align: center; margin-bottom: 40px; padding-bottom: 24px;
      border-bottom: 2px solid {{PRIMARY_COLOR}}20;
    }
    .header img { max-height: 48px; margin-bottom: 16px; }
    .header h1 { font-size: 22px; color: {{PRIMARY_COLOR}}; margin-bottom: 4px; }
    .header p { color: #666; font-size: 14px; }

    .step { display: none; }
    .step.active { display: block; }

    .progress-bar { display: flex; gap: 6px; margin-bottom: 32px; }
    .progress-segment { flex: 1; height: 4px; border-radius: 2px; background: #e0e0e0; }
    .progress-segment.active { background: {{PRIMARY_COLOR}}; }
    .progress-segment.completed { background: {{PRIMARY_COLOR}}; opacity: 0.5; }

    h2 { font-size: 20px; margin-bottom: 20px; }

    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; margin-top: 16px; }
    input, select, textarea {
      width: 100%; padding: 12px 16px; border: 1px solid #d1d5db;
      border-radius: 8px; font-size: 15px; font-family: inherit;
    }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: {{PRIMARY_COLOR}};
      box-shadow: 0 0 0 3px {{PRIMARY_COLOR}}20;
    }
    textarea { resize: vertical; min-height: 80px; }

    .row { display: flex; gap: 16px; }
    .row > div { flex: 1; }

    .radio-group { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .radio-option {
      display: flex; align-items: center; gap: 10px; padding: 12px 16px;
      border: 1px solid #d1d5db; border-radius: 8px; cursor: pointer;
    }
    .radio-option:hover { border-color: {{PRIMARY_COLOR}}; }
    .radio-option input[type="radio"] { width: auto; }

    .pricing-card {
      background: white; border: 2px solid {{PRIMARY_COLOR}}; border-radius: 12px;
      padding: 24px; text-align: center; margin: 24px 0;
    }
    .pricing-card .price { font-size: 36px; font-weight: 700; color: {{PRIMARY_COLOR}}; }
    .pricing-card .price-label { font-size: 14px; color: #666; margin-top: 4px; }
    .pricing-card .subscription-note {
      font-size: 13px; color: #888; margin-top: 12px;
      padding-top: 12px; border-top: 1px solid #e0e0e0;
    }

    .consent-box {
      display: flex; align-items: flex-start; gap: 10px;
      margin-top: 20px; padding: 16px; background: #f0f0ff; border-radius: 8px;
    }
    .consent-box input[type="checkbox"] { width: auto; margin-top: 3px; }
    .consent-box label { margin: 0; font-weight: 400; font-size: 13px; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;
      border: none; cursor: pointer; transition: all 0.2s; margin-top: 24px;
      font-family: inherit;
    }
    .btn-primary { background: {{PRIMARY_COLOR}}; color: white; width: 100%; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-back { background: #e0e0e0; color: #333; margin-right: 12px; }
    .btn-row { display: flex; gap: 12px; }
    .btn-row .btn { flex: 1; }

    #card-element {
      padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; margin-top: 8px;
    }
    .card-errors { color: #dc2626; font-size: 13px; margin-top: 8px; }

    .success-message {
      text-align: center; padding: 48px 20px;
    }
    .success-message h2 { color: #22c55e; margin-bottom: 12px; }

    .disclaimer {
      font-size: 12px; color: #999; text-align: center;
      margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0;
    }

    @media (max-width: 480px) { .row { flex-direction: column; gap: 0; } }
  </style>
</head>
<body>
  <div class="form-container">
    <div class="header">
      <img src="{{LOGO_URL}}" alt="{{BUSINESS_NAME}}">
      <h1>{{SERVICE_LABEL}}</h1>
      <p>Powered by {{BUSINESS_NAME}}</p>
    </div>

    <div class="progress-bar">
      <div class="progress-segment active" data-step="1"></div>
      <div class="progress-segment" data-step="2"></div>
      <div class="progress-segment" data-step="3"></div>
      <div class="progress-segment" data-step="4"></div>
      <div class="progress-segment" data-step="5"></div>
    </div>

    <!-- Step 1: Basic Info -->
    <div class="step active" data-step="1">
      <h2>Your Information</h2>

      <div class="row">
        <div>
          <label for="firstName">First Name</label>
          <input type="text" id="firstName" required>
        </div>
        <div>
          <label for="lastName">Last Name</label>
          <input type="text" id="lastName" required>
        </div>
      </div>

      <label for="email">Email</label>
      <input type="email" id="email" required>

      <label for="phone">Phone</label>
      <input type="tel" id="phone" required>

      <div class="row">
        <div>
          <label for="dob">Date of Birth</label>
          <input type="date" id="dob" required>
        </div>
        <div>
          <label for="gender">Gender</label>
          <select id="gender">
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <label for="street">Street Address</label>
      <input type="text" id="street" required>

      <div class="row">
        <div>
          <label for="city">City</label>
          <input type="text" id="city" required>
        </div>
        <div>
          <label for="state">State</label>
          <input type="text" id="state" maxlength="2" placeholder="CA" required>
        </div>
        <div>
          <label for="zip">ZIP</label>
          <input type="text" id="zip" maxlength="5" required>
        </div>
      </div>

      <button class="btn btn-primary" onclick="nextIntakeStep()">Continue</button>
    </div>

    <!-- Step 2: Medical History (dynamically varies by service type) -->
    <div class="step" data-step="2">
      <h2>Medical History</h2>
      <div id="medicalQuestions"></div>

      <div class="btn-row">
        <button class="btn btn-back" onclick="prevIntakeStep()">Back</button>
        <button class="btn btn-primary" onclick="nextIntakeStep()">Continue</button>
      </div>
    </div>

    <!-- Step 3: Current Medications -->
    <div class="step" data-step="3">
      <h2>Current Medications</h2>

      <label for="currentMeds">List any medications you are currently taking</label>
      <textarea id="currentMeds" placeholder="Include name, dosage, and frequency"></textarea>

      <label for="allergies">Known Allergies</label>
      <textarea id="allergies" placeholder="List any known drug or food allergies"></textarea>

      <label for="conditions">Existing Medical Conditions</label>
      <textarea id="conditions" placeholder="e.g. diabetes, thyroid issues, high blood pressure"></textarea>

      <div class="btn-row">
        <button class="btn btn-back" onclick="prevIntakeStep()">Back</button>
        <button class="btn btn-primary" onclick="nextIntakeStep()">Continue</button>
      </div>
    </div>

    <!-- Step 4: Plan & Payment -->
    <div class="step" data-step="4">
      <h2>Your Plan</h2>

      <div class="pricing-card">
        <div class="price">$\{{INITIAL_PRICE}}</div>
        <div class="price-label">Initial Consultation</div>
        <div class="subscription-note">
          Then $\{{SUBSCRIPTION_PRICE}}/month for ongoing treatment & monitoring.
          <br>Cancel anytime. You are only charged if your prescription is approved.
        </div>
      </div>

      <label>Payment Information</label>
      <div id="card-element"></div>
      <div class="card-errors" id="card-errors"></div>

      <div class="consent-box">
        <input type="checkbox" id="consent">
        <label for="consent">
          I understand I will be charged $\{{INITIAL_PRICE}} only if my prescription is approved,
          followed by $\{{SUBSCRIPTION_PRICE}}/month for ongoing treatment. I can cancel my
          subscription at any time.
        </label>
      </div>

      <div class="btn-row">
        <button class="btn btn-back" onclick="prevIntakeStep()">Back</button>
        <button class="btn btn-primary" id="submitBtn" onclick="submitIntake()">Submit & Schedule</button>
      </div>
    </div>

    <!-- Step 5: Success -->
    <div class="step" data-step="5">
      <div class="success-message">
        <h2>Submitted Successfully</h2>
        <p>Your intake form has been received. A provider will review your information.</p>
        <p style="margin-top: 12px; color: #666; font-size: 14px;">
          You will only be charged if your prescription is approved.
          Check your email for next steps and scheduling information.
        </p>
      </div>
    </div>

    <p class="disclaimer">
      This form is securely processed by My Orbit Health. Your information is protected under HIPAA guidelines.
    </p>
  </div>

  <script src="https://js.stripe.com/v3/"></script>
  <script>
    const config = {{STRIPE_CONFIG}};
    let currentStep = 1;
    const totalSteps = 5;
    let stripe, cardElement;

    // Medical questions per service type
    const medicalQuestions = {
      semaglutide: [
        { id: 'currentWeight', label: 'Current Weight (lbs)', type: 'number' },
        { id: 'height', label: 'Height', type: 'text', placeholder: "e.g. 5'10\\"" },
        { id: 'bmi', label: 'BMI (if known)', type: 'number', required: false },
        { id: 'weightLossGoal', label: 'Weight Loss Goal (lbs)', type: 'number' },
        { id: 'previousWeightLoss', label: 'Have you tried other weight loss programs?', type: 'textarea' },
        { id: 'diabetesHistory', label: 'Do you have a history of diabetes or thyroid issues?', type: 'radio', options: ['Yes', 'No'] },
        { id: 'pancreatitisHistory', label: 'Have you ever had pancreatitis?', type: 'radio', options: ['Yes', 'No'] },
        { id: 'pregnancyStatus', label: 'Are you pregnant or planning to become pregnant?', type: 'radio', options: ['Yes', 'No', 'N/A'] },
      ],
      hrt: [
        { id: 'symptoms', label: 'What symptoms are you experiencing?', type: 'textarea', placeholder: 'e.g. fatigue, low libido, mood changes, hot flashes' },
        { id: 'symptomDuration', label: 'How long have you experienced these symptoms?', type: 'text' },
        { id: 'previousHrt', label: 'Have you used hormone therapy before?', type: 'radio', options: ['Yes', 'No'] },
        { id: 'previousHrtDetails', label: 'If yes, what type and for how long?', type: 'textarea', required: false },
        { id: 'recentLabwork', label: 'Have you had bloodwork in the last 6 months?', type: 'radio', options: ['Yes', 'No'] },
        { id: 'cancerHistory', label: 'Do you have a personal or family history of hormone-sensitive cancers?', type: 'radio', options: ['Yes', 'No'] },
        { id: 'bloodClotHistory', label: 'Have you ever had blood clots?', type: 'radio', options: ['Yes', 'No'] },
      ],
    };

    // Render medical questions based on service type
    function renderMedicalQuestions() {
      const questions = medicalQuestions[config.serviceType] || [];
      const container = document.getElementById('medicalQuestions');
      container.innerHTML = questions.map(q => {
        if (q.type === 'radio') {
          return '<label>' + q.label + '</label><div class="radio-group">' +
            q.options.map(opt =>
              '<label class="radio-option"><input type="radio" name="' + q.id + '" value="' + opt + '"> ' + opt + '</label>'
            ).join('') + '</div>';
        }
        if (q.type === 'textarea') {
          return '<label for="' + q.id + '">' + q.label + '</label>' +
            '<textarea id="' + q.id + '" placeholder="' + (q.placeholder || '') + '"></textarea>';
        }
        return '<label for="' + q.id + '">' + q.label + '</label>' +
          '<input type="' + q.type + '" id="' + q.id + '" placeholder="' + (q.placeholder || '') + '"' +
          (q.required === false ? '' : ' required') + '>';
      }).join('');
    }

    // Initialize Stripe Elements when reaching payment step
    function initStripe() {
      if (stripe) return;
      // The publishable key should be served from the worker config
      stripe = Stripe('pk_live_REPLACE_ME');
      const elements = stripe.elements();
      cardElement = elements.create('card', {
        style: {
          base: { fontSize: '16px', fontFamily: "'{{FONT}}', system-ui, sans-serif" },
        },
      });
      cardElement.mount('#card-element');
      cardElement.on('change', (event) => {
        document.getElementById('card-errors').textContent = event.error ? event.error.message : '';
      });
    }

    function nextIntakeStep() {
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.remove('active');
      currentStep++;
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.add('active');
      updateProgress();
      if (currentStep === 4) initStripe();
    }

    function prevIntakeStep() {
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.remove('active');
      currentStep--;
      document.querySelector('.step[data-step="' + currentStep + '"]').classList.add('active');
      updateProgress();
    }

    function updateProgress() {
      document.querySelectorAll('.progress-segment').forEach(seg => {
        const step = parseInt(seg.dataset.step);
        seg.classList.remove('active', 'completed');
        if (step === currentStep) seg.classList.add('active');
        if (step < currentStep) seg.classList.add('completed');
      });
    }

    function collectMedicalHistory() {
      const questions = medicalQuestions[config.serviceType] || [];
      const data = {};
      questions.forEach(q => {
        if (q.type === 'radio') {
          const checked = document.querySelector('input[name="' + q.id + '"]:checked');
          data[q.id] = checked ? checked.value : '';
        } else {
          const el = document.getElementById(q.id);
          data[q.id] = el ? el.value : '';
        }
      });
      data.currentMedications = document.getElementById('currentMeds')?.value || '';
      data.allergies = document.getElementById('allergies')?.value || '';
      data.existingConditions = document.getElementById('conditions')?.value || '';
      return data;
    }

    async function submitIntake() {
      const consent = document.getElementById('consent');
      if (!consent.checked) {
        alert('Please agree to the terms to continue.');
        return;
      }

      const btn = document.getElementById('submitBtn');
      btn.textContent = 'Processing...';
      btn.disabled = true;

      try {
        const { paymentMethod, error } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElement,
          billing_details: {
            name: document.getElementById('firstName').value + ' ' + document.getElementById('lastName').value,
            email: document.getElementById('email').value,
          },
        });

        if (error) {
          document.getElementById('card-errors').textContent = error.message;
          btn.textContent = 'Submit & Schedule';
          btn.disabled = false;
          return;
        }

        const payload = {
          patient: {
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            dateOfBirth: document.getElementById('dob').value,
            gender: document.getElementById('gender').value,
            address: {
              street: document.getElementById('street').value,
              city: document.getElementById('city').value,
              state: document.getElementById('state').value,
              zip: document.getElementById('zip').value,
            },
          },
          medicalHistory: collectMedicalHistory(),
          paymentMethodId: paymentMethod.id,
        };

        const res = await fetch('/form/' + config.partnerSlug + '/' + config.serviceType + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (data.success) {
          document.querySelector('.step[data-step="4"]').classList.remove('active');
          document.querySelector('.step[data-step="5"]').classList.add('active');
          updateProgress();
        } else {
          alert(data.error || 'Something went wrong. Please try again.');
          btn.textContent = 'Submit & Schedule';
          btn.disabled = false;
        }
      } catch (err) {
        console.error(err);
        alert('Something went wrong. Please try again.');
        btn.textContent = 'Submit & Schedule';
        btn.disabled = false;
      }
    }

    renderMedicalQuestions();
  </script>
</body>
</html>`;

export default intake;
