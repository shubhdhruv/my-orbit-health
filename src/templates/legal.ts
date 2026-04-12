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

// ─── Patient Enrollment Disclosure ────────────────────────────
//
// Legal-required disclosure patients must acknowledge before completing
// enrollment. `DISCLOSURE_VERSION` is stamped onto each pending case so
// we can prove exactly which revision of the text a patient agreed to
// if legal ever needs to reproduce it.
export const DISCLOSURE_VERSION = "2026-04-11-v1";

export function generatePatientEnrollmentDisclosure(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  const contact = escapeHtml(partner.contactEmail || "support@myorbithealth.com");
  return legalShell(partner, "Patient Enrollment Disclosure", `
    <p style="font-size:14px;color:#666;margin-bottom:24px"><em>Please read this disclosure carefully before completing your enrollment. By enrolling in a clinical program, you acknowledge that you have read and understood the information below.</em></p>

    <h2>1. About Your Clinical Provider</h2>
    <p>You are enrolling in a clinical program provided by My Orbit Health ("MOH"), a telehealth medical practice owned and operated by a licensed California physician. All clinical services — including your physician consultation, medical evaluation, treatment recommendations, and prescriptions — are provided by licensed physicians employed or contracted by MOH.</p>
    <p>${name} (your "Program Partner") is a marketing and enrollment partner of MOH. Your Program Partner is not a physician, does not provide clinical services, and does not make any medical decisions regarding your care. All clinical decisions are made exclusively by MOH's licensed physicians.</p>

    <h2>2. About Your Physician Consultation</h2>
    <p>Before any medication is prescribed, you will be evaluated by a licensed physician employed or contracted by MOH. That evaluation may be conducted as:</p>
    <ul>
      <li>A synchronous (live video) telehealth visit, or</li>
      <li>An asynchronous telehealth visit, in which you complete a detailed health questionnaire and the physician reviews your information and responds within the timeframe disclosed at enrollment.</li>
    </ul>
    <p>The physician's evaluation is independent. The physician may determine that a particular program or medication is not appropriate for you based on your individual health history, current medications, or other clinical factors. Enrollment in a program does not guarantee that a prescription will be issued.</p>

    <h2>3. About Your Medications</h2>
    <p>If your physician determines that medication is appropriate for you, your prescription will be dispensed by a licensed 503A compounding pharmacy. Important facts about your medications:</p>
    <ul>
      <li>Compounded medications are prepared specifically for you pursuant to your physician's prescription. They are not FDA-approved drugs and have not been evaluated by the FDA for safety, efficacy, or quality in the same manner as FDA-approved drugs.</li>
      <li>Your medication will be shipped directly to you from the compounding pharmacy. MOH does not dispense medications.</li>
      <li>Your physician retains authority to modify, discontinue, or change your prescription at any time based on clinical judgment, your response to treatment, or changes in applicable law or pharmacy availability.</li>
      <li>You should not share your prescription medications with any other person.</li>
    </ul>

    <h2>4. About Your Payment</h2>
    <p>Your program fee is a single bundled charge that covers:</p>
    <ul>
      <li>Your physician consultation and ongoing clinical oversight;</li>
      <li>Your compounded medication for the program period; and</li>
      <li>Platform and administrative services.</li>
    </ul>
    <p>Your payment is collected by MOH. MOH collects the pharmaceutical component of your fee as authorized billing agent for the dispensing pharmacy. This means that when you pay your program fee, the pharmacy portion of that fee is held by MOH on behalf of the pharmacy and remitted to the pharmacy separately. You will see a single charge on your payment method.</p>
    <p>Your program fee covers one program period as disclosed at the time of enrollment. Fees for subsequent program periods will be disclosed prior to renewal.</p>

    <h2>5. About Your Program Partner</h2>
    <p>${name} is compensated by MOH for marketing and enrollment services. ${name}'s compensation does not affect your program fee, the medications you are prescribed, or any clinical decision made by your physician. If ${name} is using their own brand name or platform to present this program to you, the underlying clinical services are still provided by MOH's licensed physicians.</p>

    <h2>6. No Guarantees</h2>
    <p>Individual results vary. No clinical program, medication, or treatment guarantees a specific outcome. The results described in marketing materials are not typical and may not reflect your individual experience. Only your physician can evaluate whether a program is appropriate for your individual health circumstances.</p>

    <h2>7. Your Rights as a Patient</h2>
    <ul>
      <li>You have the right to ask questions about your treatment and to receive honest answers from your physician.</li>
      <li>You have the right to decline any prescribed medication or treatment.</li>
      <li>You have the right to seek a second opinion from another physician.</li>
      <li>You have the right to access your medical records.</li>
      <li>Your health information is protected by applicable privacy laws including HIPAA. MOH's Privacy Notice is available upon request.</li>
      <li>You may discontinue your participation in a clinical program at any time, subject to the refund terms disclosed at enrollment.</li>
    </ul>

    <h2>8. Contact Information</h2>
    <p>If you have questions about your clinical care or billing, contact MOH's support team at: <strong>${contact}</strong></p>
    <p>If you have a clinical emergency, contact 911 or go to your nearest emergency room. Telehealth services are not appropriate for emergencies.</p>

    <h2>Patient Acknowledgment</h2>
    <p>By checking the acknowledgment box at checkout, you confirm that:</p>
    <ul>
      <li>You have read and understand this Patient Enrollment Disclosure;</li>
      <li>You understand that clinical services are provided by MOH's licensed physicians, not by the Program Partner who referred you;</li>
      <li>You understand that your medications are compounded by a licensed 503A compounding pharmacy and are not FDA-approved drugs;</li>
      <li>You understand that MOH collects your full program fee, including the pharmaceutical component, as authorized billing agent for the dispensing pharmacy;</li>
      <li>You understand that enrollment in a program does not guarantee that a prescription will be issued and that all prescribing decisions are made by a licensed physician;</li>
      <li>You understand that individual results vary and no specific outcome is guaranteed;</li>
      <li>You have had the opportunity to ask questions prior to acknowledging this disclosure.</li>
    </ul>
    <p style="font-size:13px;color:#666;margin-top:24px"><em>Your electronic acknowledgment is legally binding under the federal E-SIGN Act and applicable state law.</em></p>
  `);
}
