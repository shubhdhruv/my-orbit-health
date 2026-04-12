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

// ─── Legal consent pages (four-part) ──────────────────────────
//
// Hims/Hers-style clickwrap: the checkout checkbox links out to four
// separate branded legal pages, and `DISCLOSURE_VERSION` is stamped onto
// every PendingCase so we can prove which revision of the consents the
// patient agreed to. Bump the version whenever any of the four pages
// below is materially revised.
export const DISCLOSURE_VERSION = "2026-04-11-v2";

// 1 of 4 — Telehealth Informed Consent
export function generateTelehealthConsent(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Telehealth Informed Consent", `
    <p style="font-size:14px;color:#666;margin-bottom:24px"><em>Required by law before any telehealth service. Clinical services are provided by My Orbit Health, a licensed telehealth medical practice, in partnership with ${name}.</em></p>

    <h2>1. What Telehealth Is</h2>
    <p>Telehealth is the delivery of healthcare services using electronic communications between a provider and a patient not in the same physical location. Your program uses one of two visit types:</p>
    <ul>
      <li><strong>Synchronous (Live Video):</strong> A real-time interactive visit with your physician via secure video.</li>
      <li><strong>Asynchronous (Store-and-Forward):</strong> You complete a detailed health questionnaire; your physician reviews your information and responds with a clinical assessment and treatment recommendation. You are not present in real time during the review.</li>
    </ul>
    <p>Your program type determines which visit type is used and is disclosed before enrollment.</p>

    <h2>2. Benefits of Telehealth</h2>
    <ul>
      <li>Access to licensed physician care without travel to a physical office</li>
      <li>Convenient scheduling from your home or private location</li>
      <li>Faster access to evaluation and treatment</li>
      <li>Secure ongoing communication with your care team</li>
    </ul>

    <h2>3. Risks &amp; Limitations</h2>
    <ul>
      <li>Your physician cannot physically examine you. Some conditions may require an in-person evaluation before a prescription can be issued.</li>
      <li>Technology failures may interrupt a visit. Your provider will attempt to reconnect or contact you by phone.</li>
      <li>Transmission of health information over electronic networks carries inherent security risks despite security measures in place.</li>
      <li>Telehealth is not appropriate for emergencies. <strong>Call 911 immediately if an emergency develops.</strong></li>
      <li>Your physician may determine at any time that a program or medication is not appropriate for you based on the information available via telehealth.</li>
    </ul>

    <h2>4. Your Rights</h2>
    <ul>
      <li>You have the right to receive care in person from a physician of your choice instead of or in addition to telehealth.</li>
      <li>You have the right to know the identity, credentials, and license number of your treating physician — available in your patient portal and upon request before your visit.</li>
      <li>All physicians providing services through My Orbit Health hold valid, current medical licenses in the states where they practice.</li>
      <li>You will be asked to verify your identity and confirm your physical location at the time of your visit.</li>
      <li>If you are located in a state where your treating physician is not licensed, please notify your care team before your visit.</li>
    </ul>

    <p style="font-size:13px;color:#666;margin-top:24px"><em>By checking the acknowledgment box at checkout, you consent to receive healthcare services via telehealth and confirm you understand the difference between synchronous and asynchronous visits, the benefits and risks of telehealth, your right to in-person care, and your right to know your provider's identity and credentials.</em></p>
  `);
}

// 2 of 4 — Electronic Communications Consent
export function generateElectronicCommunicationsConsent(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Electronic Communications Consent", `
    <p style="font-size:14px;color:#666;margin-bottom:24px"><em>Email, SMS, portal messaging &amp; E-SIGN. Clinical services are provided by My Orbit Health in partnership with ${name}.</em></p>

    <h2>1. How We Communicate With You</h2>
    <p>By enrolling, you consent to receive communications electronically — including by email, SMS, in-platform messaging, and phone — for appointment updates, clinical notes, prescription notifications, program renewals, and billing information.</p>

    <h2>2. Security</h2>
    <p>My Orbit Health uses HIPAA-compliant platforms for clinical communications and data storage. However, email and SMS transmitted outside secured platforms may not be fully secure. You may request portal-only communication at any time.</p>

    <h2>3. SMS Messages</h2>
    <p>By providing your mobile number at enrollment you consent to receive SMS messages for reminders and updates. Message and data rates may apply. Text <strong>STOP</strong> to any message to opt out at any time.</p>

    <h2>4. Electronic Signatures (E-SIGN)</h2>
    <p>Your electronic acknowledgment of this document is legally binding under the federal E-SIGN Act and applicable state law, with the same legal effect as a handwritten signature.</p>

    <h2>5. Technology Requirements</h2>
    <p>You are responsible for maintaining a compatible device, reliable internet connectivity, a private location for health discussions, and updated browser or app software required by the patient platform.</p>

    <p style="font-size:13px;color:#666;margin-top:24px"><em>By checking the acknowledgment box at checkout, you consent to receive communications electronically including email and SMS, understand the security limitations, and understand your electronic acknowledgment is legally binding under the E-SIGN Act.</em></p>
  `);
}

// 3 of 4 — Compounded Medication Consent
export function generateCompoundedMedicationConsent(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Compounded Medication Consent", `
    <p style="font-size:14px;color:#666;margin-bottom:24px"><em>FDA status, risks, and your pharmacy rights. Clinical services are provided by My Orbit Health in partnership with ${name}.</em></p>

    <h2>1. What Compounded Medications Are</h2>
    <p>If your physician prescribes medication as part of your program, it may be a compounded medication prepared specifically for you by a licensed 503A compounding pharmacy, based on your physician's individual prescription.</p>

    <h2>2. Compounded Medications Are Not FDA-Approved</h2>
    <div style="background:#FFF8ED;border-left:4px solid #E6A800;border-radius:0 8px 8px 0;padding:14px 18px;margin:12px 0;color:#7A5000;font-weight:500">
      <strong>Important:</strong> Compounded medications are not FDA-approved. They have not been evaluated by the FDA for safety, effectiveness, or quality in the same manner as commercially manufactured FDA-approved drugs. Their use is based entirely on your physician's independent clinical judgment.
    </div>

    <h2>3. Risks to Understand</h2>
    <ul>
      <li>Variability in potency, purity, and sterility compared to FDA-approved products, though licensed 503A pharmacies must comply with USP standards and state pharmacy regulations</li>
      <li>The specific formulation prescribed has not been evaluated in clinical trials for safety or efficacy in the way FDA-approved medications have been</li>
      <li>Compounded medications may produce side effects, allergic reactions, or adverse events — report any unexpected symptoms to your physician immediately</li>
      <li>Long-term safety data for specific compounded formulations may be limited</li>
    </ul>

    <h2>4. Your Pharmacy Rights</h2>
    <p>Your medication is dispensed by a licensed 503A compounding pharmacy and shipped directly to you. You have the right to request your prescription be transferred to any licensed pharmacy of your choice at any time. Contact patient support to initiate a transfer.</p>
    <p>My Orbit Health collects your payment for the pharmaceutical component of your program as <strong>authorized billing agent for the dispensing pharmacy</strong>. The pharmacy is solely responsible for all pharmaceutical services.</p>

    <p style="font-size:13px;color:#666;margin-top:24px"><em>By checking the acknowledgment box at checkout, you understand that medications prescribed may be compounded and are not FDA-approved, understand the associated risks, and understand your right to transfer your prescription to any licensed pharmacy of your choice.</em></p>
  `);
}

// 4 of 4 — Program Enrollment Terms
export function generateProgramEnrollmentTerms(partner: PartnerConfig): string {
  const name = escapeHtml(partner.businessName);
  return legalShell(partner, "Program Enrollment Terms", `
    <p style="font-size:14px;color:#666;margin-bottom:24px"><em>Provider structure, fees, privacy, and patient rights. Clinical services are provided by My Orbit Health in partnership with ${name}.</em></p>

    <h2>1. Your Clinical Provider</h2>
    <p>Your clinical services are provided by <strong>My Orbit Health</strong>, a licensed telehealth medical practice, in partnership with <strong>${name}</strong>. All clinical decisions — evaluation, diagnosis, treatment recommendation, and prescribing — are made exclusively by My Orbit Health's licensed physicians, independent of any business or marketing considerations.</p>

    <h2>2. About Your Program Partner</h2>
    <p>${name} is a marketing and enrollment partner of My Orbit Health. ${name} is not a physician, does not provide clinical services, and does not make any clinical decisions about your care. ${name}'s compensation does not affect your program pricing or the medications you are prescribed.</p>

    <h2>3. Your Program Fee</h2>
    <p>Your program fee is a single bundled charge covering physician consultation and oversight, compounded medication for the program period, and platform and administrative services. You will be notified of any pricing changes before your next renewal date.</p>
    <p>My Orbit Health collects the pharmaceutical component of your fee as <strong>authorized billing agent for the dispensing pharmacy</strong>. The pharmacy portion of your fee is held by My Orbit Health on behalf of the pharmacy and remitted to the pharmacy separately. You will see a single charge on your payment method.</p>

    <h2>4. No Guarantee of Prescription</h2>
    <p>Enrollment does not guarantee that a prescription will be issued. Your physician makes an independent clinical determination based on your health information. Refund eligibility if a prescription is not issued is governed by the refund policy disclosed at enrollment.</p>

    <h2>5. Your Privacy</h2>
    <p>Your health information is protected by HIPAA and applicable state privacy laws. My Orbit Health will not disclose your identifiable health information to ${name} or any third party except as required for treatment, payment, and healthcare operations — or as authorized by you, or as required by law. The full Notice of Privacy Practices is available in your patient portal.</p>

    <h2>6. Your Patient Rights</h2>
    <ul>
      <li>Ask questions about your treatment and receive honest answers from your physician</li>
      <li>Decline any prescribed medication or treatment at any time</li>
      <li>Seek a second opinion from any physician of your choice</li>
      <li>Request an in-person examination</li>
      <li>Access and receive copies of your medical records</li>
      <li>Request your prescription be transferred to a pharmacy of your choice</li>
      <li>Discontinue your program at any time, subject to the refund terms disclosed at enrollment</li>
      <li>File a complaint with the California Medical Board (licensing authority for My Orbit Health's physicians) at <strong>(800) 633-2322</strong> or <strong>mbc.ca.gov</strong>, or with the medical licensing board in your state of residence</li>
    </ul>

    <h2>7. Contact</h2>
    <p>Questions about your clinical care or billing? Contact us at <strong>${escapeHtml(partner.contactEmail)}</strong>.</p>
    <p>If you have a clinical emergency, contact 911 or go to your nearest emergency room. Telehealth services are not appropriate for emergencies.</p>

    <p style="font-size:13px;color:#666;margin-top:24px"><em>By checking the acknowledgment box at checkout, you understand your clinical services are provided by My Orbit Health's licensed physicians, understand enrollment does not guarantee a prescription, understand your health information is protected by HIPAA, and have been informed of your full patient rights.</em></p>
  `);
}
