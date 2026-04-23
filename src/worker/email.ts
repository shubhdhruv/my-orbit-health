import { DosingResult } from "../lib/dosing";

const STATUS_BASE_URL = "https://onboard.myorbithealth.com/status";

function statusButton(paymentIntentId?: string): string {
  if (!paymentIntentId) return "";
  return `<a href="${STATUS_BASE_URL}/${paymentIntentId}" style="display:inline-block;background:#f3f4f6;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-top:16px">Check Order Status</a>`;
}

interface EmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

function buildDosingSection(dosing?: DosingResult): string {
  if (!dosing) return "";

  const flagColor = dosing.softReviewRequired ? "#f59e0b" : "#22c55e";
  const flagLabel = dosing.softReviewRequired
    ? "Requires Provider Review"
    : "Eligible — Decision Support";

  let html = `
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="font-size: 14px; font-weight: 700; color: #0369a1; margin: 0 0 12px 0;">Dosing Recommendation</p>
      <div style="display: inline-block; background: ${flagColor}20; color: ${flagColor}; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-bottom: 12px;">${flagLabel}</div>
      <table style="width: 100%; border-collapse: collapse;">`;

  if (dosing.startingDose) {
    html += `<tr><td style="padding: 4px 0; color: #666; font-size: 13px; width: 140px;">Starting Dose</td><td style="padding: 4px 0; font-size: 13px; font-weight: 600;">${escapeHtml(dosing.startingDose)}</td></tr>`;
  }
  if (dosing.maxDose) {
    html += `<tr><td style="padding: 4px 0; color: #666; font-size: 13px;">Max Dose</td><td style="padding: 4px 0; font-size: 13px;">${escapeHtml(dosing.maxDose)}</td></tr>`;
  }
  html += `<tr><td style="padding: 4px 0; color: #666; font-size: 13px;">Route</td><td style="padding: 4px 0; font-size: 13px;">${escapeHtml(dosing.route)}</td></tr>`;
  html += `<tr><td style="padding: 4px 0; color: #666; font-size: 13px;">Frequency</td><td style="padding: 4px 0; font-size: 13px;">${escapeHtml(dosing.frequency)}</td></tr>`;
  html += `</table>`;

  // Titration schedule
  if (dosing.titrationSchedule.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #0369a1; margin: 12px 0 6px 0;">Titration Schedule</p><ol style="margin: 0; padding-left: 20px;">`;
    for (const step of dosing.titrationSchedule) {
      const gate = step.gate
        ? ' <span style="color: #dc2626; font-weight: 600;">[PROVIDER GATE]</span>'
        : "";
      const duration = step.durationWeeks
        ? ` (${step.durationWeeks} weeks)`
        : " (maintenance)";
      html += `<li style="font-size: 12px; color: #333; margin-bottom: 4px;">${escapeHtml(step.dose)}${duration} — ${escapeHtml(step.label)}${gate}</li>`;
    }
    html += `</ol>`;
  }

  // Applied dose adjustments
  const appliedAdjustments = dosing.doseAdjustments.filter((a) => a.applied);
  if (appliedAdjustments.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #f59e0b; margin: 12px 0 6px 0;">Active Dose Adjustments</p><ul style="margin: 0; padding-left: 20px;">`;
    for (const adj of appliedAdjustments) {
      html += `<li style="font-size: 12px; color: #92400e; margin-bottom: 4px;">${escapeHtml(adj.condition)}: ${escapeHtml(adj.action)}</li>`;
    }
    html += `</ul>`;
  }

  // Soft review disqualifiers
  const softFlags = dosing.disqualifiers.filter(
    (d) =>
      d.blockType === "soft_review" || d.blockType === "hard_pending_review",
  );
  if (softFlags.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #dc2626; margin: 12px 0 6px 0;">Review Flags</p><ul style="margin: 0; padding-left: 20px;">`;
    for (const flag of softFlags) {
      html += `<li style="font-size: 12px; color: #991b1b; margin-bottom: 4px;">${escapeHtml(flag.field)}: ${escapeHtml(flag.reason)}</li>`;
    }
    html += `</ul>`;
  }

  // Provider notes
  if (dosing.providerNotes.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #0369a1; margin: 12px 0 6px 0;">Provider Notes</p><ul style="margin: 0; padding-left: 20px;">`;
    for (const note of dosing.providerNotes) {
      html += `<li style="font-size: 12px; color: #333; margin-bottom: 4px;">${escapeHtml(note)}</li>`;
    }
    html += `</ul>`;
  }

  // Lab requirements
  const requiredLabs = dosing.labRequirements.filter(
    (l) => l.requiredBeforeStart,
  );
  if (requiredLabs.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #0369a1; margin: 12px 0 6px 0;">Required Labs</p><ul style="margin: 0; padding-left: 20px;">`;
    for (const lab of requiredLabs) {
      const status = lab.met ? "Provided" : "MISSING";
      const statusColor = lab.met ? "#22c55e" : "#dc2626";
      html += `<li style="font-size: 12px; color: #333; margin-bottom: 4px;">${escapeHtml(lab.panel)} — <span style="color: ${statusColor}; font-weight: 600;">${status}</span></li>`;
    }
    html += `</ul>`;
  }

  // Monitoring
  if (dosing.monitoringSchedule) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #0369a1; margin: 12px 0 6px 0;">Monitoring Schedule</p>`;
    html += `<p style="font-size: 12px; color: #333; margin: 0;">${escapeHtml(dosing.monitoringSchedule)}</p>`;
  }

  html += `</div>`;
  return html;
}

export async function sendEmail(
  apiKey: string,
  params: EmailParams,
  from?: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: from || "My Orbit Health <noreply@myorbithealth.com>",
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error: ${error}`);
  }
}

/**
 * Returns the API key and "from" address for patient-facing emails.
 * Uses partner's own Resend key + sender if configured, otherwise falls back to MOH defaults.
 */
export function getPartnerEmailConfig(
  partner: {
    resendApiKey?: string;
    senderEmail?: string;
    senderName?: string;
    businessName: string;
  },
  fallbackApiKey: string,
): { apiKey: string; from: string } {
  const name = partner.senderName || partner.businessName;
  if (partner.resendApiKey && partner.senderEmail) {
    return {
      apiKey: partner.resendApiKey,
      from: `${name} <${partner.senderEmail}>`,
    };
  }
  // If they set a senderEmail but no key, use MOH key (domain must be verified on MOH's Resend account)
  if (partner.senderEmail) {
    return {
      apiKey: fallbackApiKey,
      from: `${name} <${partner.senderEmail}>`,
    };
  }
  // Default: MOH sender
  return {
    apiKey: fallbackApiKey,
    from: "My Orbit Health <noreply@myorbithealth.com>",
  };
}

export function buildOnboardingCompleteEmail(
  businessName: string,
  embedCode: string,
  previewUrl: string,
  stripeOnboardingUrl?: string,
): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 24px; margin-bottom: 8px;">Welcome to My Orbit Health</h1>
      <p style="color: #666; margin-bottom: 32px;">Your white-label telehealth forms are ready, ${businessName}.</p>

      <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Integration Guide (2 Steps)</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 12px;">Your intake forms need a small proxy file so they load properly on your domain (required for Safari and Chrome). The full instructions are below — share them with your developer.</p>
        <p style="font-size: 13px; color: #888; margin-bottom: 16px;">Step 1 creates a proxy file in your Cloudflare Pages project. Step 2 adds the embed code to your pages. Both steps are required.</p>
        <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; word-break: break-all;">${escapeHtml(embedCode)}</pre>
      </div>

      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Preview Your Forms</h2>
        <a href="${previewUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Preview Forms</a>
      </div>

      ${
        stripeOnboardingUrl
          ? `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Connect Your Bank Account</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 12px;">Complete this step to start receiving payments:</p>
        <a href="${stripeOnboardingUrl}" style="display: inline-block; background: #635BFF; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Connect Bank Account</a>
      </div>
      `
          : ""
      }

      <p style="font-size: 13px; color: #999; margin-top: 40px;">Questions? Reply to this email and we'll help you get set up.</p>
    </div>
  `;
}

// ============================================================
// Doctor Notification: Async Review
// ============================================================

export function buildAsyncReviewEmail(params: {
  patientName: string;
  patientState: string;
  serviceName: string;
  partnerName: string;
  partnerSlug: string;
  medplumPatientId?: string;
  dosingResult?: DosingResult;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #166534; margin: 0;">New Async Review</p>
      </div>

      <h1 style="font-size: 20px; margin-bottom: 16px;">New Patient Intake — Ready for Review</h1>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px; width: 140px;">Patient</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${escapeHtml(params.patientName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">State</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.patientState)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Service</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.serviceName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Influencer</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.partnerName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Visit Type</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #22c55e;">Async Review</td></tr>
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Legacy EHR Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ""}
      </table>

      ${buildDosingSection(params.dosingResult)}

      <p style="font-size: 14px; color: #666; margin-bottom: 24px;">This patient's state (${escapeHtml(params.patientState)}) allows async review for this service. No video visit required.</p>

      <a href="https://onboard.myorbithealth.com/doctor" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Open Doctor Portal</a>

      <p style="font-size: 12px; color: #999; margin-top: 32px;">My Orbit Health — Automated Notification</p>
    </div>
  `;
}

// ============================================================
// Doctor Notification: Sync Video Visit Required
// ============================================================

// ============================================================
// Patient Notification: Async Acknowledgment
// ============================================================

export function buildAsyncPatientAckEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  paymentIntentId?: string;
  bloodworkStatus?: "have-labs" | "buy-kit" | "not-required";
}): string {
  // Bloodwork-aware next steps. Patients buying a kit need to know the kit
  // is shipping to them with instructions, and that the doctor's 1–2 day
  // review only kicks in after lab results are back.
  let nextSteps = "";
  if (params.bloodworkStatus === "buy-kit") {
    nextSteps = `
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:20px">
        <p style="font-size:14px;font-weight:600;color:#0369a1;margin:0 0 8px">What happens next</p>
        <ol style="font-size:14px;color:#333;margin:0;padding-left:20px;line-height:1.7">
          <li>Your blood work kit will be mailed to you.</li>
          <li>Instructions for collecting and returning your sample will be sent to you.</li>
          <li>Once your results come back, your provider will review them and approve your prescription within 1–2 business days.</li>
          <li>You will only be charged if your prescription is approved.</li>
        </ol>
      </div>`;
  } else if (params.bloodworkStatus === "have-labs") {
    nextSteps = `
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your provider will review the lab results you uploaded along with your intake. This typically takes 1–2 business days. You will only be charged if your prescription is approved.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">We will email you as soon as there is an update.</p>`;
  } else {
    nextSteps = `
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your provider is now reviewing your information. This typically takes 1-2 business days. You will only be charged if your prescription is approved.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">We will email you as soon as there is an update.</p>`;
  }

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">We Received Your Intake</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Thank you for completing your ${escapeHtml(params.serviceName)} intake through ${escapeHtml(params.partnerName)}.</p>
      ${nextSteps}
      ${statusButton(params.paymentIntentId)}
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

export function buildSyncVisitEmail(params: {
  patientName: string;
  patientEmail: string;
  patientState: string;
  serviceName: string;
  partnerName: string;
  constraints: string[];
  medplumPatientId?: string;
  dosingResult?: DosingResult;
}): string {
  const constraintsList =
    params.constraints.length > 0
      ? params.constraints
          .map(
            (c) =>
              `<li style="font-size: 13px; color: #92400e; margin-bottom: 4px;">${escapeHtml(c.replace(/_/g, " "))}</li>`,
          )
          .join("")
      : '<li style="font-size: 13px; color: #92400e;">Standard sync visit required</li>';

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #92400e; margin: 0;">Video Visit Required</p>
      </div>

      <h1 style="font-size: 20px; margin-bottom: 16px;">New Patient — Sync Video Visit Needed</h1>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px; width: 140px;">Patient</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${escapeHtml(params.patientName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Email</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.patientEmail)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">State</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${escapeHtml(params.patientState)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Service</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.serviceName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Influencer</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.partnerName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Visit Type</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #f59e0b;">Sync Video Visit</td></tr>
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Legacy EHR Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ""}
      </table>

      <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; font-weight: 600; color: #92400e; margin: 0 0 8px 0;">State Compliance Requirements:</p>
        <ul style="margin: 0; padding-left: 20px;">${constraintsList}</ul>
      </div>

      <p style="font-size: 14px; color: #666; margin-bottom: 24px;">Please schedule a video visit with this patient via the Doctor Portal.</p>

      ${buildDosingSection(params.dosingResult)}

      <a href="https://onboard.myorbithealth.com/doctor" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Open Doctor Portal</a>

      <p style="font-size: 12px; color: #999; margin-top: 32px;">My Orbit Health — Automated Notification</p>
    </div>
  `;
}

// ============================================================
// Doctor Notification: Blocked / In-Person Required
// ============================================================

export function buildBlockedVisitEmail(params: {
  patientName: string;
  patientEmail: string;
  patientState: string;
  serviceName: string;
  partnerName: string;
  visitType: string;
  constraints: string[];
  medplumPatientId?: string;
  routingFailed?: boolean;
}): string {
  const isBlocked = params.visitType === "blocked";
  const headerColor = params.routingFailed
    ? "#fecaca"
    : isBlocked
      ? "#fecaca"
      : "#fed7aa";
  const borderColor = params.routingFailed
    ? "#ef4444"
    : isBlocked
      ? "#ef4444"
      : "#f97316";
  const textColor = params.routingFailed
    ? "#991b1b"
    : isBlocked
      ? "#991b1b"
      : "#9a3412";
  const label = params.routingFailed
    ? "Routing Error — Manual Review Required"
    : isBlocked
      ? "Service Blocked in State"
      : "In-Person Visit Required First";

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: ${headerColor}; border-left: 4px solid ${borderColor}; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: ${textColor}; margin: 0;">${label}</p>
      </div>

      <h1 style="font-size: 20px; margin-bottom: 16px;">Action Required — ${escapeHtml(params.patientName)}</h1>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px; width: 140px;">Patient</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${escapeHtml(params.patientName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Email</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.patientEmail)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">State</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${escapeHtml(params.patientState)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Service</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.serviceName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Influencer</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.partnerName)}</td></tr>
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Legacy EHR Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ""}
      </table>

      <div style="background: ${headerColor}; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; font-weight: 600; color: ${textColor}; margin: 0 0 8px 0;">${
          params.routingFailed
            ? "The routing engine encountered an error processing this patient. Defaulted to blocked for safety. Please review manually and determine the correct visit type."
            : isBlocked
              ? "This service cannot be prescribed via telehealth in this state."
              : "This state requires an in-person evaluation before telehealth prescribing for this service."
        }</p>
        ${params.constraints.map((c) => `<p style="font-size: 13px; color: ${textColor}; margin: 4px 0;">${escapeHtml(c.replace(/_/g, " "))}</p>`).join("")}
      </div>

      <p style="font-size: 14px; color: #666;">Please contact the patient directly to discuss options.</p>

      <p style="font-size: 12px; color: #999; margin-top: 32px;">My Orbit Health — Automated Notification</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Blocked / In-Person / Routing Error
// ============================================================

export function buildPatientBlockedEmail(params: {
  patientName: string;
  serviceName: string;
  visitType: string;
  patientState: string;
  partnerName: string;
  routingFailed?: boolean;
}): string {
  let message: string;
  if (params.routingFailed) {
    message = `We need a bit more time to process your request. Our medical team is reviewing your information manually and will reach out to you within 1-2 business days with next steps.`;
  } else if (params.visitType === "blocked") {
    message = `Unfortunately, ${escapeHtml(params.serviceName)} is not available via telehealth in ${escapeHtml(params.patientState)}. Our team will contact you to discuss alternative options. Your card has not been charged.`;
  } else {
    message = `Based on ${escapeHtml(params.patientState)}'s telehealth regulations, an in-person evaluation is required before we can prescribe ${escapeHtml(params.serviceName)} via telehealth. Our team will reach out to help coordinate this. Your card has not been charged.`;
  }

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">About Your ${escapeHtml(params.serviceName)} Request</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Thank you for completing your intake through ${escapeHtml(params.partnerName)}.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">${message}</p>
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Video Visit Scheduling
// ============================================================

export function buildPatientSyncEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  paymentIntentId?: string;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Your Video Visit</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Thank you for completing your ${escapeHtml(params.serviceName)} intake through ${escapeHtml(params.partnerName)}.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Based on your state's requirements, a brief video consultation with your provider is needed before we can process your prescription. You'll receive a separate email from our scheduling system with a link to book your appointment.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">The visit is quick and straightforward — your provider will review your intake answers with you and confirm your treatment plan.</p>
      ${statusButton(params.paymentIntentId)}
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Approved — Card Charged
// ============================================================

export function buildPatientApprovedEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  paymentIntentId?: string;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #166534; margin: 0;">Prescription Approved</p>
      </div>
      <h1 style="font-size: 20px; margin-bottom: 16px;">Great News, ${escapeHtml(params.patientName)}!</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your ${escapeHtml(params.serviceName)} prescription has been approved by your provider.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your card has been charged and your prescription is now being processed. You will receive shipping and tracking information once your medication is on its way.</p>
      ${statusButton(params.paymentIntentId)}
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Denied — Card NOT Charged
// ============================================================

export function buildPatientDeniedEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  reason: string;
  paymentIntentId?: string;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">About Your ${escapeHtml(params.serviceName)} Request</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">After reviewing your intake information, your provider has determined that ${escapeHtml(params.serviceName)} is not the right fit for you at this time.</p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="font-size: 13px; font-weight: 600; color: #666; margin: 0 0 4px 0;">Provider's Note</p>
        <p style="font-size: 14px; color: #333; margin: 0;">${escapeHtml(params.reason)}</p>
      </div>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your card has <strong>not</strong> been charged.</p>
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Medication Shipped
// ============================================================

export function buildPatientShippedEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  paymentIntentId?: string;
}): string {
  const trackingHtml = params.trackingNumber
    ? `<div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="font-size: 13px; font-weight: 600; color: #666; margin: 0 0 8px 0;">Shipping Details</p>
        ${params.carrier ? `<p style="font-size: 14px; color: #333; margin: 0 0 4px 0;"><strong>Carrier:</strong> ${escapeHtml(params.carrier)}</p>` : ""}
        <p style="font-size: 14px; color: #333; margin: 0 0 4px 0;"><strong>Tracking #:</strong> ${escapeHtml(params.trackingNumber)}</p>
        ${params.trackingUrl ? `<a href="${params.trackingUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; margin-top: 8px;">Track Your Package</a>` : ""}
      </div>`
    : "";

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #1e40af; margin: 0;">Your Medication Has Shipped</p>
      </div>
      <h1 style="font-size: 20px; margin-bottom: 16px;">It's On the Way, ${escapeHtml(params.patientName)}!</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your ${escapeHtml(params.serviceName)} prescription has been filled and shipped.</p>
      ${trackingHtml}
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Most orders arrive within 3-5 business days. We'll send you another email when it's been delivered.</p>
      ${statusButton(params.paymentIntentId)}
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ============================================================
// Patient Notification: Medication Delivered
// ============================================================

export function buildPatientDeliveredEmail(params: {
  patientName: string;
  serviceName: string;
  partnerName: string;
  startingDose?: string;
  paymentIntentId?: string;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #166534; margin: 0;">Medication Delivered</p>
      </div>
      <h1 style="font-size: 20px; margin-bottom: 16px;">Your Medication Has Arrived, ${escapeHtml(params.patientName)}!</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your ${escapeHtml(params.serviceName)} has been delivered.</p>
      ${
        params.startingDose
          ? `<div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="font-size: 13px; font-weight: 600; color: #0369a1; margin: 0 0 4px 0;">Your Starting Dose</p>
        <p style="font-size: 16px; font-weight: 700; color: #333; margin: 0;">${escapeHtml(params.startingDose)}</p>
      </div>`
          : ""
      }
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">Follow the dosing instructions included with your medication. If you have any questions or experience side effects, contact your provider.</p>
      ${statusButton(params.paymentIntentId)}
      <p style="font-size: 14px; color: #666; margin-top: 32px;">Questions? Reply to this email.</p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">${escapeHtml(params.partnerName)} powered by My Orbit Health</p>
    </div>
  `;
}

// ─── Patient Portal: Magic Link Email ────────────────────────

export function buildPortalMagicLinkEmail(params: {
  brandName: string;
  logoUrl?: string;
  primaryColor?: string;
  magicUrl: string;
}): string {
  const primary = params.primaryColor || "#0B1F3A";
  const logoBlock = params.logoUrl
    ? `<img src="${params.logoUrl}" alt="${escapeHtml(params.brandName)}" style="max-height:32px;max-width:160px" onerror="this.style.display='none'">`
    : `<p style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0">${escapeHtml(params.brandName)}</p>`;

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <div style="text-align:center;margin-bottom:32px">${logoBlock}</div>
      <h1 style="font-size:22px;font-weight:700;margin-bottom:12px;text-align:center">Sign in to your account</h1>
      <p style="font-size:15px;color:#374151;margin-bottom:24px;text-align:center;line-height:1.5">
        Click the button below to sign in. This link will expire in 15 minutes and can only be used once.
      </p>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${params.magicUrl}" style="display:inline-block;background:${primary};color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600">Sign in to ${escapeHtml(params.brandName)}</a>
      </div>
      <p style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:8px">Or copy and paste this URL into your browser:</p>
      <p style="font-size:12px;color:#9ca3af;text-align:center;word-break:break-all;margin-bottom:32px">${params.magicUrl}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#9ca3af;text-align:center">
        If you didn't request this email, you can safely ignore it. No changes have been made to your account.
      </p>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:16px">
        &copy; ${new Date().getFullYear()} ${escapeHtml(params.brandName)}
      </p>
    </div>
  `;
}

// ─── Patient Portal: Welcome (post-checkout credential delivery) ─

export function buildPortalWelcomeEmail(params: {
  patientFirstName: string;
  brandName: string;
  logoUrl?: string;
  primaryColor?: string;
  magicUrl: string;
  serviceName: string;
}): string {
  const primary = params.primaryColor || "#0B1F3A";
  const logoBlock = params.logoUrl
    ? `<img src="${params.logoUrl}" alt="${escapeHtml(params.brandName)}" style="max-height:32px;max-width:160px" onerror="this.style.display='none'">`
    : `<p style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0">${escapeHtml(params.brandName)}</p>`;

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <div style="text-align:center;margin-bottom:32px">${logoBlock}</div>
      <h1 style="font-size:24px;font-weight:700;margin-bottom:12px">Welcome, ${escapeHtml(params.patientFirstName)}</h1>
      <p style="font-size:15px;color:#374151;margin-bottom:16px;line-height:1.5">
        Thanks for choosing ${escapeHtml(params.brandName)}. Your ${escapeHtml(params.serviceName)} intake has been received and is being reviewed by your provider.
      </p>
      <p style="font-size:15px;color:#374151;margin-bottom:24px;line-height:1.5">
        We've created an account for you so you can track every step — from physician approval through pharmacy shipment and delivery. Click below to sign in.
      </p>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${params.magicUrl}" style="display:inline-block;background:${primary};color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600">Sign in to your account</a>
      </div>
      <p style="font-size:13px;color:#6b7280;line-height:1.5;margin-bottom:8px">
        <strong>This sign-in link expires in 15 minutes.</strong> Any time you want to check on your order, return to this sign-in page and we'll email you a fresh link.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:14px;color:#6b7280;line-height:1.5">
        <strong>What to expect next:</strong>
      </p>
      <ul style="font-size:14px;color:#6b7280;line-height:1.7;padding-left:20px">
        <li>Your provider reviews your intake (typically 1–2 business days)</li>
        <li>If approved, your prescription is sent to the pharmacy</li>
        <li>You'll get email updates at every step</li>
        <li>Your card is only charged if your prescription is approved</li>
      </ul>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:32px">
        &copy; ${new Date().getFullYear()} ${escapeHtml(params.brandName)}
      </p>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
