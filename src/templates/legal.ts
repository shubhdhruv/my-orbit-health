import { PartnerConfig } from "../lib/types";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function legalShell(partner: PartnerConfig, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${escapeHtml(partner.businessName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(partner.font)}:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: '${partner.font}', system-ui, sans-serif; background: #fff; color: #333; line-height: 1.7; }
    .header { border-bottom: 1px solid #eee; padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
    .header img { max-height: 40px; object-fit: contain; }
    .header span { font-size: 13px; color: #888; }
    .container { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .updated { font-size: 13px; color: #888; margin-bottom: 32px; }
    h2 { font-size: 18px; font-weight: 700; margin: 32px 0 12px 0; }
    p { font-size: 15px; margin-bottom: 12px; }
    ul { margin: 0 0 12px 24px; }
    li { font-size: 15px; margin-bottom: 6px; }
    .footer { text-align: center; padding: 32px; font-size: 12px; color: #999; border-top: 1px solid #eee; margin-top: 48px; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${escapeHtml(partner.logoUrl)}" alt="${escapeHtml(partner.businessName)}">
    <span>powered by My Orbit Health</span>
  </div>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p class="updated">Last updated: April 5, 2026</p>
    ${body}
  </div>
  <div class="footer">${escapeHtml(partner.businessName)} powered by My Orbit Health</div>
</body>
</html>`;
}

export function generateTermsOfService(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Terms of Service", `
    <h2>1. Overview</h2>
    <p>${name} partners with My Orbit Health, a licensed telehealth platform, to connect you with independent, licensed healthcare providers. ${name} does not provide medical services, diagnose conditions, or prescribe medications. All clinical decisions are made solely by licensed physicians and healthcare providers.</p>

    <h2>2. Third-Party Medical Provider Disclosure</h2>
    <p><strong>${name} is not a healthcare provider.</strong> Medical services, including consultations, prescriptions, and ongoing care, are provided by independently licensed physicians and practitioners through My Orbit Health's telehealth platform. ${name} facilitates access to these services but does not employ, supervise, or control the medical providers. Your provider-patient relationship is between you and your prescribing physician.</p>

    <h2>3. Eligibility</h2>
    <p>To use our services you must be at least 18 years old, reside in a U.S. state where telehealth services are available for your requested treatment, and provide truthful and complete medical information.</p>

    <h2>4. Payment &amp; Authorization</h2>
    <p>When you submit an intake form, your payment method is authorized but <strong>not charged</strong> until a licensed provider reviews your information and approves your prescription. If your prescription is not approved, your card will not be charged. Authorization holds expire after 7 days.</p>

    <h2>5. Subscriptions</h2>
    <p>Some treatment plans include a recurring monthly subscription. You may cancel your subscription at any time by contacting support. Cancellation takes effect at the end of the current billing cycle.</p>

    <h2>6. Compounding Pharmacy</h2>
    <p>Approved prescriptions are filled by licensed compounding pharmacies and shipped directly to you. Product packaging and appearance may vary. All medications are prepared in accordance with applicable state and federal compounding regulations.</p>

    <h2>7. No Guarantee of Prescription</h2>
    <p>Submitting an intake form does not guarantee a prescription. Providers may determine that a requested medication is not appropriate based on your medical history, current medications, lab results, or other clinical factors.</p>

    <h2>8. Limitation of Liability</h2>
    <p>${name} and My Orbit Health are not liable for any adverse effects, allergic reactions, or other outcomes resulting from prescribed medications. You agree to follow your provider's instructions and report any side effects immediately.</p>

    <h2>9. Changes to Terms</h2>
    <p>We may update these terms at any time. Continued use of the service constitutes acceptance of the updated terms.</p>

    <h2>10. Contact</h2>
    <p>Questions about these terms? Contact us at ${escapeHtml(partner.contactEmail)}.</p>
  `);
}

export function generatePrivacyPolicy(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Privacy Policy", `
    <h2>1. Information We Collect</h2>
    <p>We collect the following information when you use our services:</p>
    <ul>
      <li><strong>Personal information:</strong> name, email, phone number, date of birth, gender, shipping address</li>
      <li><strong>Medical information:</strong> health history, current medications, symptoms, lab results, and other information provided during your intake</li>
      <li><strong>Payment information:</strong> processed securely through Stripe — we do not store your full card number</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To connect you with a licensed healthcare provider for evaluation</li>
      <li>To process your prescription and payment</li>
      <li>To ship medication to your address</li>
      <li>To communicate with you about your care, order status, and account</li>
      <li>To comply with legal and regulatory requirements</li>
    </ul>

    <h2>3. Who We Share Your Information With</h2>
    <p>Your information is shared only with:</p>
    <ul>
      <li><strong>Licensed healthcare providers</strong> who review your intake and make prescribing decisions</li>
      <li><strong>Licensed compounding pharmacies</strong> that fulfill your prescription</li>
      <li><strong>My Orbit Health</strong>, the telehealth platform that coordinates your care</li>
      <li><strong>Payment processors</strong> (Stripe) for secure payment handling</li>
    </ul>
    <p>We do not sell your personal or medical information to third parties.</p>

    <h2>4. HIPAA &amp; Data Security</h2>
    <p>Medical information is handled in compliance with HIPAA (Health Insurance Portability and Accountability Act) requirements. We use encryption, secure servers, and access controls to protect your data.</p>

    <h2>5. Your Rights</h2>
    <p>You may request access to, correction of, or deletion of your personal information by contacting us. Certain medical records may be retained as required by law.</p>

    <h2>6. Cookies &amp; Analytics</h2>
    <p>We may use essential cookies for site functionality. We do not use third-party advertising trackers on medical intake forms.</p>

    <h2>7. Contact</h2>
    <p>Privacy questions? Contact us at ${escapeHtml(partner.contactEmail)}.</p>
  `);
}

export function generateTelehealthConsent(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Telehealth Consent", `
    <h2>1. What is Telehealth?</h2>
    <p>Telehealth involves the delivery of healthcare services using electronic communications. This may include asynchronous review of your medical information by a licensed provider (without a live video visit) or synchronous video consultations, depending on your state's requirements.</p>

    <h2>2. Third-Party Provider Relationship</h2>
    <p><strong>${name} is not your healthcare provider.</strong> By completing this intake, you are engaging with an independent, licensed physician through My Orbit Health's telehealth platform. ${name} facilitates access but does not make medical decisions, supervise your provider, or have access to your medical consultations.</p>

    <h2>3. Informed Consent</h2>
    <p>By submitting your intake form, you consent to the following:</p>
    <ul>
      <li>A licensed healthcare provider will review your medical information and make an independent clinical decision about your treatment</li>
      <li>You may be required to complete a video visit based on your state's telehealth regulations</li>
      <li>Telehealth has limitations — it may not be appropriate for all conditions, and your provider may refer you for in-person care</li>
      <li>Your information will be transmitted electronically and stored securely</li>
      <li>You have the right to withdraw consent at any time</li>
    </ul>

    <h2>4. Risks &amp; Limitations</h2>
    <ul>
      <li>Telehealth is not a substitute for emergency care — call 911 for emergencies</li>
      <li>Technology failures may delay care</li>
      <li>Your provider relies on the accuracy of information you provide — incomplete or inaccurate information may affect your treatment</li>
      <li>Not all medications or treatments are available via telehealth in all states</li>
    </ul>

    <h2>5. Prescriptions</h2>
    <p>If your provider determines that medication is appropriate, a prescription will be sent to a licensed compounding pharmacy. You are not guaranteed a prescription. Your provider may deny a prescription for any clinical reason.</p>

    <h2>6. Payment</h2>
    <p>Your payment method is authorized at the time of intake submission but is <strong>not charged</strong> until a provider approves your prescription. If your prescription is denied, you will not be charged.</p>

    <h2>7. Contact</h2>
    <p>Questions? Contact us at ${escapeHtml(partner.contactEmail)}.</p>
  `);
}
