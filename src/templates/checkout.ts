// Checkout page — plan selection, shipping, Stripe Elements, order summary
// Matches Sana Direct design: "Due Today: $0 — Only charged if prescribed"

import { PartnerConfig, ServiceConfig } from "../lib/types";
import { ServiceDefinition } from "../lib/services";

export function generateCheckoutHTML(
  service: ServiceDefinition,
  partner: PartnerConfig,
  serviceConfig: ServiceConfig,
  stripePublishableKey: string,
  baseUrl: string,
  stripeBypass?: boolean
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
      --primary-soft: ${partner.brandColors.primary}08;
      --secondary: ${partner.brandColors.secondary};
      --font: '${partner.font}', system-ui, -apple-system, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: #f7f7f8; color: #1a1a2e; min-height: 100vh; }

    /* Header bar */
    .top-bar {
      background: #fff; border-bottom: 1px solid #e8e8e8; padding: 14px 32px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .top-bar img { max-height: 36px; object-fit: contain; }
    .top-bar .trust-pills { display: flex; gap: 16px; align-items: center; }
    .top-bar .pill {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; color: #666; font-weight: 500;
    }
    .top-bar .pill svg { width: 14px; height: 14px; color: #22c55e; }

    .page { display: flex; max-width: 1100px; margin: 0 auto; padding: 32px 24px; gap: 40px; }

    /* Left column */
    .main { flex: 1; }
    .main h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .main .subtitle { font-size: 14px; color: #888; margin-bottom: 28px; }

    /* Section cards */
    .section-card {
      background: #fff; border: 1px solid #e8e8e8; border-radius: 14px;
      padding: 24px; margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    h2.section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 700; margin-bottom: 16px;
      color: #1a1a2e;
    }
    h2.section-title svg { width: 18px; height: 18px; color: var(--primary); }

    /* Plan cards */
    .plan-card {
      border: 2px solid #e8e8e8; border-radius: 12px; padding: 18px 20px;
      margin-bottom: 10px; cursor: pointer; transition: all 0.2s;
      position: relative; background: #fff;
    }
    .plan-card:hover { border-color: #bbb; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .plan-card.selected {
      border-color: var(--primary); background: var(--primary-light);
      box-shadow: 0 0 0 3px ${partner.brandColors.primary}15;
    }

    .plan-card .plan-header {
      display: flex; align-items: center; justify-content: space-between;
    }
    .plan-card .plan-radio {
      width: 22px; height: 22px; min-width: 22px; border: 2px solid #ccc;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      margin-right: 12px; transition: all 0.15s;
    }
    .plan-card.selected .plan-radio { border-color: var(--primary); }
    .plan-card.selected .plan-radio::after {
      content: ''; width: 12px; height: 12px; border-radius: 50%;
      background: var(--primary);
    }

    .plan-card .plan-left { display: flex; align-items: center; }
    .plan-card .plan-name { font-size: 15px; font-weight: 600; }
    .plan-card .plan-details { font-size: 13px; color: #888; margin-top: 2px; }
    .plan-card .plan-price { font-size: 20px; font-weight: 700; text-align: right; }
    .plan-card .plan-price-sub { font-size: 12px; color: #888; font-weight: 400; }
    .plan-card .plan-per-month { font-size: 13px; color: #888; text-align: right; }

    .plan-card .plan-includes {
      margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;
      font-size: 13px; color: #555;
    }
    .plan-card .plan-includes strong { display: block; margin-bottom: 6px; }
    .plan-card .plan-includes li {
      list-style: none; display: flex; align-items: center; gap: 6px; padding: 2px 0;
    }
    .plan-card .plan-includes li::before {
      content: ''; display: inline-block; width: 16px; height: 16px;
      background: #22c55e; border-radius: 50%;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E");
      background-size: 10px; background-repeat: no-repeat; background-position: center;
      min-width: 16px;
    }

    .savings-badge {
      position: absolute; top: -8px; right: 12px;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      color: #fff; font-size: 11px; font-weight: 700;
      padding: 4px 10px; border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    }

    /* Form fields */
    .form-row { display: flex; gap: 12px; }
    .form-row > div { flex: 1; }
    .form-group { margin-bottom: 14px; }

    .field-label {
      display: block; font-size: 13px; font-weight: 600; color: #444;
      margin-bottom: 6px;
    }

    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], input[type="number"], select {
      width: 100%; padding: 12px 14px; border: 1.5px solid #d9d9d9;
      border-radius: 8px; font-size: 14px; font-family: var(--font);
      outline: none; transition: all 0.15s; background: #fff;
    }
    input:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-light);
    }
    input::placeholder { color: #bbb; }
    select { color: #555; }

    /* Stripe Elements */
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
      margin-bottom: 8px; transition: border-color 0.15s; background: #fff;
    }
    #card-element.StripeElement--focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
    .card-errors { color: #dc2626; font-size: 13px; margin-bottom: 12px; min-height: 18px; }

    .consent-text {
      font-size: 12px; color: #888; line-height: 1.6; margin-top: 16px;
    }
    .consent-text strong { color: #555; }
    .consent-text a { color: var(--primary); text-decoration: none; }
    .consent-text a:hover { text-decoration: underline; }

    /* Submit */
    .btn-submit {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 16px; background: var(--primary); color: #fff;
      border: none; border-radius: 10px; font-size: 16px; font-weight: 600;
      font-family: var(--font); cursor: pointer; margin-top: 20px;
      transition: all 0.2s; box-shadow: 0 2px 8px ${partner.brandColors.primary}40;
    }
    .btn-submit:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px ${partner.brandColors.primary}50; }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

    .provider-note {
      text-align: center; font-size: 13px; color: #888; margin-top: 12px; line-height: 1.5;
    }

    /* Trust badges below button */
    .trust-row {
      display: flex; justify-content: center; gap: 24px; margin-top: 16px;
      padding-top: 16px; border-top: 1px solid #f0f0f0;
    }
    .trust-item {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: #888; font-weight: 500;
    }
    .trust-item svg { width: 16px; height: 16px; color: #22c55e; }

    /* Right column — Order Summary */
    .sidebar {
      width: 380px; position: sticky; top: 32px; align-self: flex-start;
    }
    .order-card {
      background: #fff; border: 1px solid #e8e8e8; border-radius: 14px; padding: 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .order-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 20px; }

    .order-product {
      margin-bottom: 20px;
      padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;
    }
    .order-product-info h4 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .order-product-info p { font-size: 13px; color: #888; }
    .order-product-info .plan-tag {
      display: inline-block; background: var(--primary-light); border: 1px solid ${partner.brandColors.primary}20;
      font-size: 11px; font-weight: 600;
      padding: 3px 10px; border-radius: 6px; margin-top: 8px; color: var(--primary);
    }

    .order-line {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 14px; padding: 8px 0;
    }
    .order-line .label { color: #666; }
    .order-line .value { font-weight: 600; }

    .due-today-note {
      font-size: 14px; font-weight: 700; margin-top: 16px;
      padding-top: 16px; border-top: 1px solid #f0f0f0;
    }
    .due-today-amount {
      display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;
    }
    .due-today-amount .amount { font-size: 28px; font-weight: 700; color: #22c55e; }
    .due-today-explain {
      font-size: 13px; color: #888; line-height: 1.6; font-weight: 400;
    }
    .due-today-explain strong { color: #333; }

    /* Guarantee badge in sidebar */
    .guarantee-badge {
      margin-top: 20px; padding: 16px; border-radius: 10px;
      background: #f0fdf4; border: 1px solid #bbf7d0;
      display: flex; align-items: start; gap: 10px;
    }
    .guarantee-badge svg { width: 20px; height: 20px; min-width: 20px; color: #22c55e; margin-top: 1px; }
    .guarantee-badge p { font-size: 12px; color: #166534; line-height: 1.5; }
    .guarantee-badge strong { font-weight: 700; }

    /* Footer links */
    .footer-links {
      display: flex; justify-content: center; gap: 16px;
      padding: 24px 0; font-size: 12px;
    }
    .footer-links a { color: #888; text-decoration: none; }
    .footer-links a:hover { color: #555; }

    @media (max-width: 768px) {
      .top-bar .trust-pills { display: none; }
      .page { flex-direction: column-reverse; padding: 16px; gap: 20px; }
      .sidebar { width: 100%; position: static; }
      .section-card { padding: 20px; }
      .trust-row { flex-wrap: wrap; gap: 12px; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="top-bar">
    <img src="${partner.logoUrl}" alt="${partner.businessName}">
    <div class="trust-pills">
      <span class="pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Secure Checkout
      </span>
      <span class="pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        HIPAA Compliant
      </span>
      <span class="pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Licensed Providers
      </span>
    </div>
  </div>

  <div class="page">
    <div class="main">
      <h1>Complete Your Order</h1>
      <p class="subtitle">Secure, confidential checkout for your treatment plan</p>

      <!-- Plan Selection -->
      <div class="section-card">
      <h2 class="section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        Select Your Treatment Plan
      </h2>

      <div class="plan-card selected" data-plan="monthly" data-price="${monthlyPrice}" data-months="1">
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
      </div>

      <div class="plan-card" data-plan="3-month" data-price="${threeMonthPrice}" data-months="3" >
        <div class="plan-header">
          <div class="plan-left">
            <div class="plan-radio"></div>
            <div>
              <div class="plan-name">3-Month Supply</div>
              <div class="plan-details">$${threeMonthPerMonth}/mo for 3 months</div>
            </div>
          </div>
          <div>
            <div class="plan-price">$${threeMonthPerMonth}<span class="plan-price-sub">/mo</span></div>
            <div class="plan-per-month" style="color:#22c55e;font-weight:600">Save $${monthlyPrice - threeMonthPerMonth}/mo</div>
          </div>
        </div>
      </div>

      <div class="plan-card" data-plan="6-month" data-price="${sixMonthPrice}" data-months="6" >
        <div class="plan-header">
          <div class="plan-left">
            <div class="plan-radio"></div>
            <div>
              <div class="plan-name">6-Month Supply</div>
              <div class="plan-details">$${sixMonthPerMonth}/mo for 6 months</div>
            </div>
          </div>
          <div>
            <div class="plan-price">$${sixMonthPerMonth}<span class="plan-price-sub">/mo</span></div>
            <div class="plan-per-month" style="color:#22c55e;font-weight:600">Save $${monthlyPrice - sixMonthPerMonth}/mo</div>
          </div>
        </div>
        <div class="savings-badge">BEST VALUE</div>
      </div>

      <div style="display:flex;gap:20px;margin-top:16px;padding:14px 16px;background:#f8faf8;border-radius:10px;border:1px solid #e8efe8">
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Free expedited shipping
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Provider oversight and support
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Cancel anytime
        </div>
      </div>

      </div>

      <!-- Patient Info -->
      <div class="section-card">
      <h2 class="section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Patient Information
      </h2>

      <div class="form-row">
        <div>
          <label class="field-label">First Name</label>
          <input type="text" id="firstName" placeholder="First name" required>
        </div>
        <div>
          <label class="field-label">Last Name</label>
          <input type="text" id="lastName" placeholder="Last name" required>
        </div>
      </div>

      <label class="field-label" style="margin-top:12px">Email</label>
      <input type="email" id="email" placeholder="your@email.com" required>

      <div class="form-row" style="margin-top:12px">
        <div>
          <label class="field-label">Phone</label>
          <input type="tel" id="phone" placeholder="(555) 555-5555" required>
        </div>
        <div>
          <label class="field-label">Date of Birth</label>
          <input type="date" id="dob" required>
        </div>
      </div>

      <label class="field-label" style="margin-top:12px">Gender</label>
      <select id="gender" required>
        <option value="">Select</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="other">Other</option>
        <option value="prefer-not-to-say">Prefer not to say</option>
      </select>

      </div>

      <!-- Shipping -->
      <div class="section-card">
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

      </div>

      <!-- Payment -->
      <div class="section-card">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          Payment Information
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16" style="color:#22c55e"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
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
          <p style="margin-top:8px"><strong>Third-Party Medical Provider Disclosure:</strong> ${partner.businessName} is not a healthcare provider and does not provide medical advice, diagnosis, or treatment. Medical services are provided by independently licensed physicians through My Orbit Health's telehealth platform. Your provider-patient relationship is between you and your prescribing physician. ${partner.businessName} facilitates access to these services but does not employ, supervise, or control the medical providers.</p>
          <p style="margin-top:8px"><strong>Medical Disclaimer:</strong> By submitting this form, I confirm that all information provided is accurate and complete to the best of my knowledge. I understand that providing complete and honest medical information is essential for safe treatment.</p>
          <p style="margin-top:8px">By completing checkout, you agree to our <a href="${baseUrl}/form/${partner.slug}/terms" target="_blank">Terms of Service</a>, <a href="${baseUrl}/form/${partner.slug}/privacy" target="_blank">Privacy Policy</a>, and <a href="${baseUrl}/form/${partner.slug}/telehealth-consent" target="_blank">Telehealth Consent</a>.</p>
          <p style="margin-top:8px; font-size:11px">*Product packaging may vary. Prescriptions will be fulfilled by a licensed compounding pharmacy.</p>
        </div>

        <button class="btn-submit" id="submitBtn" onclick="submitOrder()">
          <span id="btnText">Please enter your address to continue</span>
        </button>

        <p class="provider-note">A licensed healthcare provider will review your information and ensure that the treatment is right for you before any prescription is written.</p>

        <div class="trust-row">
          <span class="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            256-bit SSL
          </span>
          <span class="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            HIPAA Compliant
          </span>
          <span class="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            No charge until approved
          </span>
        </div>
      </div>

      <div class="footer-links">
        <a href="${baseUrl}/form/${partner.slug}/terms" target="_blank">Terms of Service</a>
        <a href="${baseUrl}/form/${partner.slug}/privacy" target="_blank">Privacy Policy</a>
        <a href="${baseUrl}/form/${partner.slug}/telehealth-consent" target="_blank">Telehealth Consent</a>
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
          <span class="value" id="planPrice">$${monthlyPrice}/mo <span style="font-weight:400;font-size:12px;color:#888">billed on approval</span></span>
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
        <div class="guarantee-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <p><strong>Your protection guarantee:</strong> Your card is only charged if a licensed physician approves your prescription. If not approved, you pay nothing.</p>
        </div>
      </div>
    </div>
  </div>

  ${stripeBypass ? '' : '<script src="https://js.stripe.com/v3/"></script>'}
  <script>
    const CONFIG = {
      partnerSlug: "${partner.slug}",
      serviceType: "${service.id}",
      baseUrl: "${baseUrl}",
      stripeKey: "${stripePublishableKey}",
      stripeBypass: ${stripeBypass ? 'true' : 'false'},
      monthlyPrice: ${monthlyPrice},
      logoUrl: "${partner.logoUrl}",
      businessName: "${partner.businessName.replace(/"/g, '\\"')}",
      primaryColor: "${partner.brandColors.primary}",
      serviceName: "${service.label.replace(/"/g, '\\"')}",
    };

    let selectedPlan = { id: 'monthly', months: 1, price: ${monthlyPrice} };
    let stripe, cardElement;

    // Init Stripe (or bypass)
    if (!CONFIG.stripeBypass) {
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
    } else {
      document.getElementById('card-element').innerHTML = '<div style="padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:13px;color:#166534;font-weight:600">Test Mode — No card required</div>';
    }

    function selectPlan(el) {
      document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');

      selectedPlan = {
        id: el.dataset.plan,
        months: parseInt(el.dataset.months),
        price: parseInt(el.dataset.price),
      };

      // Update sidebar
      var perMonth = Math.round(selectedPlan.price / selectedPlan.months);
      var billingNote = selectedPlan.months === 1 ? 'billed monthly on approval' : 'billed monthly for ' + selectedPlan.months + ' months';
      const labels = { 'monthly': 'Monthly Supply', '3-month': '3-Month Supply', '6-month': '6-Month Supply' };
      document.getElementById('planTag').textContent = labels[selectedPlan.id] + ' Plan';
      document.getElementById('planLabel').textContent = labels[selectedPlan.id];
      document.getElementById('planPrice').innerHTML = '$' + perMonth + '/mo <span style="font-weight:400;font-size:12px;color:#888">' + billingNote + '</span>';
    }

    // Event delegation for plan clicks
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.plan-card');
      if (card) selectPlan(card);
    });

    // Enable submit when all required fields filled
    function checkForm() {
      const firstName = document.getElementById('firstName').value;
      const lastName = document.getElementById('lastName').value;
      const email = document.getElementById('email').value;
      const phone = document.getElementById('phone').value;
      const dob = document.getElementById('dob').value;
      const gender = document.getElementById('gender').value;
      const street = document.getElementById('street').value;
      const city = document.getElementById('city').value;
      const state = document.getElementById('state').value;
      const zip = document.getElementById('zip').value;
      const btn = document.getElementById('submitBtn');
      const btnText = document.getElementById('btnText');

      if (firstName && lastName && email && phone && dob && gender && street && city && state && zip) {
        btn.disabled = false;
        btnText.textContent = 'Complete Order';
      } else {
        btn.disabled = true;
        btnText.textContent = 'Please fill in all required fields';
      }
    }

    document.querySelectorAll('#firstName, #lastName, #email, #phone, #dob, #gender, #street, #city, #state, #zip').forEach(el => {
      el.addEventListener('input', checkForm);
      el.addEventListener('change', checkForm);
    });

    async function submitOrder() {
      const btn = document.getElementById('submitBtn');
      const btnText = document.getElementById('btnText');
      btn.disabled = true;
      btnText.textContent = 'Processing...';

      try {
        let paymentMethodId = 'bypass_pm_' + Date.now();

        if (!CONFIG.stripeBypass) {
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
          paymentMethodId = paymentMethod.id;
        }

        // Get intake answers from session storage and merge patient info
        const intakeAnswers = JSON.parse(sessionStorage.getItem('intakeAnswers') || '{}');
        intakeAnswers.firstName = document.getElementById('firstName').value;
        intakeAnswers.lastName = document.getElementById('lastName').value;
        intakeAnswers.email = document.getElementById('email').value;
        intakeAnswers.phone = document.getElementById('phone').value;
        intakeAnswers.dob = document.getElementById('dob').value;
        intakeAnswers.gender = document.getElementById('gender').value;

        const disqualified = JSON.parse(sessionStorage.getItem('disqualified') || 'false');
        const disqualifyReasons = JSON.parse(sessionStorage.getItem('disqualifyReasons') || '[]');

        const payload = {
          paymentMethodId: paymentMethodId,
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
            email: document.getElementById('email').value,
          },
        };

        const res = await fetch(CONFIG.baseUrl + '/form/' + CONFIG.partnerSlug + '/' + CONFIG.serviceType + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (data.success) {
          // Show branded success page
          document.querySelector('.page').innerHTML =
            '<div style="max-width:520px;margin:60px auto;text-align:center;padding:32px">' +
            '<img src="' + CONFIG.logoUrl + '" alt="' + CONFIG.businessName + '" style="max-width:160px;max-height:80px;margin-bottom:32px;object-fit:contain">' +
            '<div style="width:64px;height:64px;border-radius:50%;background:' + CONFIG.primaryColor + '18;display:flex;align-items:center;justify-content:center;margin:0 auto 24px">' +
            '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="' + CONFIG.primaryColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
            '</div>' +
            '<h2 style="font-size:26px;font-weight:700;color:#1a1a2e;margin:0 0 8px 0">You Are All Set!</h2>' +
            '<p style="font-size:15px;color:#666;margin:0 0 24px 0">Your ' + CONFIG.serviceName + ' intake has been submitted successfully.</p>' +
            '<div style="background:#f8f9fa;border-radius:12px;padding:24px;text-align:left;margin-bottom:24px">' +
            '<p style="font-size:14px;font-weight:600;color:#1a1a2e;margin:0 0 12px 0">What happens next?</p>' +
            '<div style="display:flex;align-items:start;gap:12px;margin-bottom:12px">' +
            '<div style="min-width:24px;height:24px;border-radius:50%;background:' + CONFIG.primaryColor + ';color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">1</div>' +
            '<p style="font-size:14px;color:#555;margin:2px 0 0 0">A licensed provider reviews your information</p></div>' +
            '<div style="display:flex;align-items:start;gap:12px;margin-bottom:12px">' +
            '<div style="min-width:24px;height:24px;border-radius:50%;background:' + CONFIG.primaryColor + ';color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">2</div>' +
            '<p style="font-size:14px;color:#555;margin:2px 0 0 0">If approved, your card is charged and your prescription is sent to the pharmacy</p></div>' +
            '<div style="display:flex;align-items:start;gap:12px">' +
            '<div style="min-width:24px;height:24px;border-radius:50%;background:' + CONFIG.primaryColor + ';color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">3</div>' +
            '<p style="font-size:14px;color:#555;margin:2px 0 0 0">Your medication ships directly to your door</p></div>' +
            '</div>' +
            '<div style="background:' + CONFIG.primaryColor + '10;border:1px solid ' + CONFIG.primaryColor + '30;border-radius:10px;padding:16px;margin-bottom:24px">' +
            '<p style="font-size:13px;color:#555;margin:0"><strong style="color:#1a1a2e">No charge today.</strong> You will only be billed if a provider approves your prescription.</p>' +
            '</div>' +
            '<p style="font-size:13px;color:#999;margin:0">Check your email for updates. Questions? Reply to any email from us.</p>' +
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
