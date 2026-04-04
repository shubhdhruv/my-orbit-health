// Checkout page — plan selection, shipping, Stripe Elements, order summary
// Matches Sana Direct design: "Due Today: $0 — Only charged if prescribed"

import { PartnerConfig, ServiceConfig } from "../lib/types";
import { ServiceDefinition } from "../lib/services";

export function generateCheckoutHTML(
  service: ServiceDefinition,
  partner: PartnerConfig,
  serviceConfig: ServiceConfig,
  stripePublishableKey: string,
  baseUrl: string
): string {
  const monthlyPrice = serviceConfig.subscriptionPrice;
  const threeMonthPrice = Math.round(monthlyPrice * 3 * 0.95);
  const sixMonthPrice = Math.round(monthlyPrice * 6 * 0.8);
  const threeMonthPerMonth = Math.round(threeMonthPrice / 3);
  const sixMonthPerMonth = Math.round(sixMonthPrice / 6);
  const threeMonthSavings = (monthlyPrice * 3) - threeMonthPrice;
  const sixMonthSavings = (monthlyPrice * 6) - sixMonthPrice;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${partner.businessName} - Complete Your Order</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(partner.font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${partner.brandColors.primary};
      --primary-light: ${partner.brandColors.primary}10;
      --secondary: ${partner.brandColors.secondary};
      --font: '${partner.font}', system-ui, -apple-system, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: #fff; color: #1a1a2e; }

    .page { display: flex; max-width: 1100px; margin: 0 auto; padding: 32px 24px; gap: 40px; }

    /* Left column */
    .main { flex: 1; }
    .main h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .main .subtitle { font-size: 14px; color: #888; margin-bottom: 32px; }

    h2.section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 16px; font-weight: 700; margin-bottom: 16px; margin-top: 32px;
    }
    h2.section-title svg { width: 20px; height: 20px; color: #666; }

    /* Plan cards */
    .plan-card {
      border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px;
      margin-bottom: 12px; cursor: pointer; transition: all 0.15s;
      position: relative;
    }
    .plan-card:hover { border-color: #999; }
    .plan-card.selected { border-color: var(--primary); background: var(--primary-light); }

    .plan-card .plan-header {
      display: flex; align-items: center; justify-content: space-between;
    }
    .plan-card .plan-radio {
      width: 22px; height: 22px; min-width: 22px; border: 2px solid #ccc;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      margin-right: 12px; transition: all 0.15s;
    }
    .plan-card.selected .plan-radio {
      border-color: var(--primary);
    }
    .plan-card.selected .plan-radio::after {
      content: ''; width: 12px; height: 12px; border-radius: 50%;
      background: var(--primary);
    }

    .plan-card .plan-left { display: flex; align-items: center; }
    .plan-card .plan-name { font-size: 15px; font-weight: 600; }
    .plan-card .plan-details { font-size: 13px; color: #888; margin-top: 2px; }
    .plan-card .plan-price { font-size: 20px; font-weight: 700; text-align: right; }
    .plan-card .plan-price-sub { font-size: 12px; color: #888; font-weight: 400; }
    .plan-card .plan-per-month { font-size: 13px; color: #888; }

    .plan-card .plan-includes {
      margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;
      font-size: 13px; color: #555;
    }
    .plan-card .plan-includes strong { display: block; margin-bottom: 6px; }
    .plan-card .plan-includes li {
      list-style: none; display: flex; align-items: center; gap: 6px; padding: 2px 0;
    }
    .plan-card .plan-includes li::before {
      content: '✓'; color: #22c55e; font-weight: 700; font-size: 12px;
    }

    .savings-badge {
      position: absolute; top: 12px; right: 12px;
      background: var(--primary); color: #fff; font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 4px;
    }

    /* Shipping */
    .form-row { display: flex; gap: 12px; margin-bottom: 12px; }
    .form-row > div { flex: 1; }

    .field-label {
      display: block; font-size: 13px; font-weight: 500; color: #555;
      margin-bottom: 4px;
    }

    input[type="text"], select {
      width: 100%; padding: 12px 14px; border: 1.5px solid #d9d9d9;
      border-radius: 8px; font-size: 14px; font-family: var(--font);
      outline: none; transition: border-color 0.15s;
    }
    input:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-light);
    }

    /* Stripe Elements */
    .payment-section { margin-top: 32px; }
    .payment-header {
      display: flex; align-items: center; gap: 8px;
      font-size: 16px; font-weight: 700; margin-bottom: 16px;
    }
    .payment-header svg { width: 20px; height: 20px; }
    .payment-method {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--primary);
    }
    .secure-note {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; color: #888; margin-bottom: 16px;
    }
    .secure-note svg { width: 14px; height: 14px; color: #22c55e; }

    #card-element {
      padding: 14px; border: 1.5px solid #d9d9d9; border-radius: 8px;
      margin-bottom: 8px; transition: border-color 0.15s;
    }
    #card-element.StripeElement--focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
    .card-errors { color: #dc2626; font-size: 13px; margin-bottom: 12px; min-height: 18px; }

    .card-fields { display: flex; gap: 12px; }
    .card-fields > div { flex: 1; }

    .consent-text {
      font-size: 12px; color: #888; line-height: 1.6; margin-top: 16px;
    }
    .consent-text strong { color: #555; }
    .consent-text a { color: var(--primary); text-decoration: none; }

    /* Submit */
    .btn-submit {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 16px; background: var(--primary); color: #fff;
      border: none; border-radius: 10px; font-size: 16px; font-weight: 600;
      font-family: var(--font); cursor: pointer; margin-top: 24px;
      transition: opacity 0.15s;
    }
    .btn-submit:hover { opacity: 0.9; }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .provider-note {
      text-align: center; font-size: 13px; color: #888; margin-top: 12px; line-height: 1.5;
    }

    /* Right column — Order Summary */
    .sidebar {
      width: 360px; position: sticky; top: 32px; align-self: flex-start;
    }
    .order-card {
      border: 1px solid #e8e8e8; border-radius: 12px; padding: 24px;
    }
    .order-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 20px; }

    .order-product {
      display: flex; gap: 16px; margin-bottom: 20px;
      padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;
    }
    .order-product img { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
    .order-product-info h4 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .order-product-info p { font-size: 12px; color: #888; }
    .order-product-info .plan-tag {
      display: inline-block; background: #f0f0f0; font-size: 11px;
      padding: 2px 8px; border-radius: 4px; margin-top: 4px; color: #555;
    }

    .order-line {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 14px; padding: 6px 0;
    }
    .order-line .label { color: #666; }
    .order-line .value { font-weight: 600; }

    .order-total {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 18px; font-weight: 700; margin-top: 12px;
      padding-top: 16px; border-top: 1px solid #f0f0f0;
    }

    .due-today-note {
      font-size: 14px; font-weight: 700; margin-top: 16px;
      padding-top: 16px; border-top: 1px solid #f0f0f0;
    }
    .due-today-amount {
      display: flex; justify-content: space-between; margin-bottom: 8px;
    }
    .due-today-amount .amount { font-size: 24px; }
    .due-today-explain {
      font-size: 13px; color: #888; line-height: 1.5; font-weight: 400;
    }
    .due-today-explain strong { color: #555; }

    /* Footer links */
    .footer-links {
      display: flex; justify-content: center; gap: 16px;
      padding: 24px 0; font-size: 12px;
    }
    .footer-links a { color: #888; text-decoration: none; }
    .footer-links a:hover { color: #555; }

    @media (max-width: 768px) {
      .page { flex-direction: column-reverse; }
      .sidebar { width: 100%; position: static; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="main">
      <h1>Complete Your Order</h1>
      <p class="subtitle">Secure checkout for your treatment</p>

      <!-- Plan Selection -->
      <h2 class="section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        Select Your Treatment Plan
      </h2>

      <div class="plan-card selected" data-plan="monthly" data-price="${monthlyPrice}" data-months="1" onclick="selectPlan(this)">
        <div class="plan-header">
          <div class="plan-left">
            <div class="plan-radio"></div>
            <div>
              <div class="plan-name">Monthly Supply</div>
              <div class="plan-details">$${monthlyPrice}/mo</div>
            </div>
          </div>
          <div>
            <div class="plan-price">$${monthlyPrice}<span class="plan-price-sub">/mo</span></div>
          </div>
        </div>
        <div class="plan-includes">
          <strong>Includes:</strong>
          <ul>
            <li>Free expedited shipping</li>
            <li>Provider oversight and support</li>
          </ul>
        </div>
        <div class="savings-badge" style="display:none"></div>
      </div>

      <div class="plan-card" data-plan="3-month" data-price="${threeMonthPrice}" data-months="3" onclick="selectPlan(this)">
        <div class="plan-header">
          <div class="plan-left">
            <div class="plan-radio"></div>
            <div>
              <div class="plan-name">3-Month Supply</div>
              <div class="plan-details">$${threeMonthPrice} upfront</div>
            </div>
          </div>
          <div>
            <div class="plan-price">$${threeMonthPrice}</div>
            <div class="plan-per-month">$${threeMonthPerMonth}/mo</div>
          </div>
        </div>
      </div>

      <div class="plan-card" data-plan="6-month" data-price="${sixMonthPrice}" data-months="6" onclick="selectPlan(this)">
        <div class="plan-header">
          <div class="plan-left">
            <div class="plan-radio"></div>
            <div>
              <div class="plan-name">6-Month Supply</div>
              <div class="plan-details">$${sixMonthPerMonth}/mo</div>
            </div>
          </div>
          <div>
            <div class="plan-price">$${sixMonthPrice}</div>
            <div class="plan-per-month">$${sixMonthPerMonth}/mo</div>
          </div>
        </div>
        <div class="savings-badge">SAVE ${Math.round((sixMonthSavings / (monthlyPrice * 6)) * 100)}%!</div>
      </div>

      <!-- Shipping -->
      <h2 class="section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        Shipping Information
      </h2>

      <label class="field-label">Street Address</label>
      <input type="text" id="street" placeholder="Start typing your address...">

      <label class="field-label" style="margin-top:12px">Apartment, suite, etc. (optional)</label>
      <input type="text" id="apt" placeholder="Apt, Suite, etc.">

      <div class="form-row" style="margin-top:12px">
        <div>
          <label class="field-label">City</label>
          <input type="text" id="city" placeholder="City">
        </div>
        <div>
          <label class="field-label">State</label>
          <select id="state"><option value="">Select State</option>
            <option>AL</option><option>AK</option><option>AZ</option><option>AR</option><option>CA</option>
            <option>CO</option><option>CT</option><option>DE</option><option>FL</option><option>GA</option>
            <option>HI</option><option>ID</option><option>IL</option><option>IN</option><option>IA</option>
            <option>KS</option><option>KY</option><option>LA</option><option>ME</option><option>MD</option>
            <option>MA</option><option>MI</option><option>MN</option><option>MS</option><option>MO</option>
            <option>MT</option><option>NE</option><option>NV</option><option>NH</option><option>NJ</option>
            <option>NM</option><option>NY</option><option>NC</option><option>ND</option><option>OH</option>
            <option>OK</option><option>OR</option><option>PA</option><option>RI</option><option>SC</option>
            <option>SD</option><option>TN</option><option>TX</option><option>UT</option><option>VT</option>
            <option>VA</option><option>WA</option><option>WV</option><option>WI</option><option>WY</option>
            <option>DC</option>
          </select>
        </div>
      </div>

      <label class="field-label">ZIP Code</label>
      <input type="text" id="zip" placeholder="ZIP Code" maxlength="5" style="max-width:200px">

      <!-- Payment -->
      <div class="payment-section">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          Payment Information
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16" style="color:#888"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </h2>

        <div class="payment-method">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="1" y="4" width="22" height="16" rx="2"/></svg>
          Card
        </div>

        <div class="secure-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Secure, fast checkout with Link
        </div>

        <div id="card-element"></div>
        <div class="card-errors" id="card-errors"></div>

        <div class="consent-text">
          <p><strong>Payment Authorization:</strong> We'll securely pre-authorize your payment method for the amount shown. You'll only be charged if a licensed physician prescribes your medication after reviewing your medical information.</p>
          <p style="margin-top:8px"><strong>Medical Disclaimer:</strong> By submitting this form, I confirm that all information provided is accurate and complete to the best of my knowledge. I understand that providing complete and honest medical information is essential for safe treatment.</p>
          <p style="margin-top:8px">By completing checkout, you agree to our <a href="#">Terms of Service</a>, <a href="#">Privacy Policy</a>, and <a href="#">Telehealth Consent</a>.</p>
          <p style="margin-top:8px; font-size:11px">*Product packaging may vary. Prescriptions will be fulfilled by a licensed compounding pharmacy.</p>
        </div>

        <button class="btn-submit" id="submitBtn" onclick="submitOrder()">
          <span id="btnText">Please enter your address to continue</span>
        </button>

        <p class="provider-note">A licensed healthcare provider will review your information and ensure that the treatment is right for you before any prescription is written.</p>
      </div>

      <div class="footer-links">
        <a href="#">Terms of Service</a>
        <a href="#">Privacy Policy</a>
        <a href="#">Telehealth Consent</a>
      </div>
    </div>

    <!-- Order Summary Sidebar -->
    <div class="sidebar">
      <div class="order-card">
        <h3>Order Summary</h3>

        <div class="order-product">
          <div class="order-product-info">
            <h4>${service.label}</h4>
            <p>Personalized Compounded Medication</p>
            <span class="plan-tag" id="planTag">Monthly Supply Plan</span>
          </div>
        </div>

        <div class="order-line">
          <span class="label" id="planLabel">Monthly Supply</span>
          <span class="value" id="planPrice">$${monthlyPrice} <span style="font-weight:400;font-size:12px;color:#888">billed on approval</span></span>
        </div>

        <div class="due-today-note">
          <div class="due-today-amount">
            <span>Due Today</span>
            <span class="amount">$0</span>
          </div>
          <p class="due-today-explain">
            <strong>Only charged if prescribed by a licensed physician</strong><br>
            We'll securely hold your payment method. You'll only be charged after a doctor reviews your information and prescribes your medication.
          </p>
        </div>
      </div>
    </div>
  </div>

  <script src="https://js.stripe.com/v3/"></script>
  <script>
    const CONFIG = {
      partnerSlug: "${partner.slug}",
      serviceType: "${service.id}",
      baseUrl: "${baseUrl}",
      stripeKey: "${stripePublishableKey}",
      monthlyPrice: ${monthlyPrice},
    };

    let selectedPlan = { id: 'monthly', months: 1, price: ${monthlyPrice} };
    let stripe, cardElement;

    // Init Stripe
    stripe = Stripe(CONFIG.stripeKey);
    const elements = stripe.elements();
    cardElement = elements.create('card', {
      style: {
        base: {
          fontSize: '15px',
          fontFamily: "'${partner.font}', system-ui, sans-serif",
          color: '#1a1a2e',
          '::placeholder': { color: '#aab7c4' },
        },
      },
    });
    cardElement.mount('#card-element');
    cardElement.on('change', (event) => {
      document.getElementById('card-errors').textContent = event.error ? event.error.message : '';
    });

    function selectPlan(el) {
      document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');

      selectedPlan = {
        id: el.dataset.plan,
        months: parseInt(el.dataset.months),
        price: parseInt(el.dataset.price),
      };

      // Update sidebar
      const labels = { 'monthly': 'Monthly Supply', '3-month': '3-Month Supply', '6-month': '6-Month Supply' };
      document.getElementById('planTag').textContent = labels[selectedPlan.id] + ' Plan';
      document.getElementById('planLabel').textContent = labels[selectedPlan.id];
      document.getElementById('planPrice').innerHTML = '$' + selectedPlan.price + ' <span style="font-weight:400;font-size:12px;color:#888">billed on approval</span>';
    }

    // Enable submit when address filled
    function checkForm() {
      const street = document.getElementById('street').value;
      const city = document.getElementById('city').value;
      const state = document.getElementById('state').value;
      const zip = document.getElementById('zip').value;
      const btn = document.getElementById('submitBtn');
      const btnText = document.getElementById('btnText');

      if (street && city && state && zip) {
        btn.disabled = false;
        btnText.textContent = 'Complete Order';
      } else {
        btn.disabled = true;
        btnText.textContent = 'Please enter your address to continue';
      }
    }

    document.querySelectorAll('#street, #city, #state, #zip').forEach(el => {
      el.addEventListener('input', checkForm);
      el.addEventListener('change', checkForm);
    });

    async function submitOrder() {
      const btn = document.getElementById('submitBtn');
      const btnText = document.getElementById('btnText');
      btn.disabled = true;
      btnText.textContent = 'Processing...';

      try {
        const { paymentMethod, error } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElement,
          billing_details: {
            address: {
              line1: document.getElementById('street').value,
              line2: document.getElementById('apt').value,
              city: document.getElementById('city').value,
              state: document.getElementById('state').value,
              postal_code: document.getElementById('zip').value,
              country: 'US',
            },
          },
        });

        if (error) {
          document.getElementById('card-errors').textContent = error.message;
          btn.disabled = false;
          btnText.textContent = 'Complete Order';
          return;
        }

        // Get intake answers from session storage
        const intakeAnswers = JSON.parse(sessionStorage.getItem('intakeAnswers') || '{}');
        const disqualified = JSON.parse(sessionStorage.getItem('disqualified') || 'false');
        const disqualifyReasons = JSON.parse(sessionStorage.getItem('disqualifyReasons') || '[]');

        const payload = {
          paymentMethodId: paymentMethod.id,
          answers: intakeAnswers,
          disqualified,
          disqualifyReasons,
          selectedPlan,
          shipping: {
            street: document.getElementById('street').value,
            apt: document.getElementById('apt').value,
            city: document.getElementById('city').value,
            state: document.getElementById('state').value,
            zip: document.getElementById('zip').value,
          },
        };

        const res = await fetch(CONFIG.baseUrl + '/form/' + CONFIG.partnerSlug + '/' + CONFIG.serviceType + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (data.success) {
          // Show success
          document.querySelector('.page').innerHTML =
            '<div style="max-width:600px;margin:80px auto;text-align:center;padding:24px">' +
            '<h2 style="color:#22c55e;font-size:28px;margin-bottom:12px">Order Submitted!</h2>' +
            '<p style="font-size:16px;color:#666;margin-bottom:8px">Your intake form has been received and your payment method is securely saved.</p>' +
            '<p style="font-size:14px;color:#888">A licensed provider will review your information. You will <strong>only be charged if your prescription is approved</strong>.</p>' +
            '<p style="font-size:14px;color:#888;margin-top:16px">Check your email for next steps and scheduling information.</p>' +
            '</div>';
        } else {
          document.getElementById('card-errors').textContent = data.error || 'Something went wrong. Please try again.';
          btn.disabled = false;
          btnText.textContent = 'Complete Order';
        }
      } catch (err) {
        console.error(err);
        document.getElementById('card-errors').textContent = 'Something went wrong. Please try again.';
        btn.disabled = false;
        btnText.textContent = 'Complete Order';
      }
    }

    // Init
    checkForm();
  </script>
</body>
</html>`;
}
