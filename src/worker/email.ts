import { DosingResult } from "../lib/dosing";

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

function buildDosingSection(dosing?: DosingResult): string {
  if (!dosing) return "";

  const flagColor = dosing.softReviewRequired ? "#f59e0b" : "#22c55e";
  const flagLabel = dosing.softReviewRequired ? "Requires Provider Review" : "Eligible — Decision Support";

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
      const gate = step.gate ? ' <span style="color: #dc2626; font-weight: 600;">[PROVIDER GATE]</span>' : "";
      const duration = step.durationWeeks ? ` (${step.durationWeeks} weeks)` : " (maintenance)";
      html += `<li style="font-size: 12px; color: #333; margin-bottom: 4px;">${escapeHtml(step.dose)}${duration} — ${escapeHtml(step.label)}${gate}</li>`;
    }
    html += `</ol>`;
  }

  // Applied dose adjustments
  const appliedAdjustments = dosing.doseAdjustments.filter(a => a.applied);
  if (appliedAdjustments.length > 0) {
    html += `<p style="font-size: 13px; font-weight: 600; color: #f59e0b; margin: 12px 0 6px 0;">Active Dose Adjustments</p><ul style="margin: 0; padding-left: 20px;">`;
    for (const adj of appliedAdjustments) {
      html += `<li style="font-size: 12px; color: #92400e; margin-bottom: 4px;">${escapeHtml(adj.condition)}: ${escapeHtml(adj.action)}</li>`;
    }
    html += `</ul>`;
  }

  // Soft review disqualifiers
  const softFlags = dosing.disqualifiers.filter(d => d.blockType === "soft_review" || d.blockType === "hard_pending_review");
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
  const requiredLabs = dosing.labRequirements.filter(l => l.requiredBeforeStart);
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

export async function sendEmail(apiKey: string, params: EmailParams): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: "My Orbit Health <noreply@myorbithealth.com>",
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error: ${error}`);
  }
}

export function buildOnboardingCompleteEmail(
  businessName: string,
  embedCode: string,
  previewUrl: string,
  stripeOnboardingUrl?: string
): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 24px; margin-bottom: 8px;">Welcome to My Orbit Health</h1>
      <p style="color: #666; margin-bottom: 32px;">Your white-label telehealth forms are ready, ${businessName}.</p>

      <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Your Embed Codes</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 12px;">Each code below is labeled with the service name. Copy and paste each one into the corresponding page on your website.</p>
        <p style="font-size: 13px; color: #888; margin-bottom: 16px;">The HTML comments above each iframe tell your developer exactly which form it is and where to place it.</p>
        <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; word-break: break-all;">${escapeHtml(embedCode)}</pre>
      </div>

      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Preview Your Forms</h2>
        <a href="${previewUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Preview Forms</a>
      </div>

      ${stripeOnboardingUrl ? `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Connect Your Bank Account</h2>
        <p style="font-size: 14px; color: #666; margin-bottom: 12px;">Complete this step to start receiving payments:</p>
        <a href="${stripeOnboardingUrl}" style="display: inline-block; background: #635BFF; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px;">Connect Bank Account</a>
      </div>
      ` : ""}

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
  healthiePatientId?: string;
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
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Medplum Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ''}
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
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">We Received Your Intake</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Thank you for completing your ${escapeHtml(params.serviceName)} intake through ${escapeHtml(params.partnerName)}.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your provider is now reviewing your information. This typically takes 1-2 business days. You will only be charged if your prescription is approved.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">We will email you as soon as there is an update.</p>
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
  healthiePatientId?: string;
  medplumPatientId?: string;
  appointmentCreated?: boolean;
  appointmentError?: string;
  dosingResult?: DosingResult;
}): string {
  const constraintsList = params.constraints.length > 0
    ? params.constraints.map(c => `<li style="font-size: 13px; color: #92400e; margin-bottom: 4px;">${escapeHtml(c.replace(/_/g, " "))}</li>`).join("")
    : "<li style=\"font-size: 13px; color: #92400e;\">Standard sync visit required</li>";

  const appointmentStatus = params.appointmentCreated
    ? `<p style="font-size: 14px; color: #666; margin-bottom: 24px;">An appointment has been created. The patient will receive a scheduling link.</p>`
    : params.appointmentError
      ? `<div style="background: #fecaca; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
          <p style="font-size: 13px; font-weight: 600; color: #991b1b; margin: 0 0 4px 0;">Appointment creation failed — please schedule manually.</p>
          <p style="font-size: 12px; color: #991b1b; margin: 0;">${escapeHtml(params.appointmentError)}</p>
        </div>`
      : `<p style="font-size: 14px; color: #666; margin-bottom: 24px;">No patient ID available — please create the appointment manually.</p>`;

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
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Medplum Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ''}
      </table>

      <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; font-weight: 600; color: #92400e; margin: 0 0 8px 0;">State Compliance Requirements:</p>
        <ul style="margin: 0; padding-left: 20px;">${constraintsList}</ul>
      </div>

      ${appointmentStatus}

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
  const headerColor = params.routingFailed ? "#fecaca" : isBlocked ? "#fecaca" : "#fed7aa";
  const borderColor = params.routingFailed ? "#ef4444" : isBlocked ? "#ef4444" : "#f97316";
  const textColor = params.routingFailed ? "#991b1b" : isBlocked ? "#991b1b" : "#9a3412";
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
        ${params.medplumPatientId ? `<tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Medplum Patient</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.medplumPatientId)}</td></tr>` : ''}
      </table>

      <div style="background: ${headerColor}; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; font-weight: 600; color: ${textColor}; margin: 0 0 8px 0;">${
          params.routingFailed
            ? "The routing engine encountered an error processing this patient. Defaulted to blocked for safety. Please review manually and determine the correct visit type."
            : isBlocked
              ? "This service cannot be prescribed via telehealth in this state."
              : "This state requires an in-person evaluation before telehealth prescribing for this service."
        }</p>
        ${params.constraints.map(c => `<p style="font-size: 13px; color: ${textColor}; margin: 4px 0;">${escapeHtml(c.replace(/_/g, " "))}</p>`).join("")}
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
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Your Video Visit</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Hi ${escapeHtml(params.patientName)},</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Thank you for completing your ${escapeHtml(params.serviceName)} intake through ${escapeHtml(params.partnerName)}.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Based on your state's requirements, a brief video consultation with your provider is needed before we can process your prescription. You'll receive a separate email from our scheduling system with a link to book your appointment.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 8px;">The visit is quick and straightforward — your provider will review your intake answers with you and confirm your treatment plan.</p>
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
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #166534; margin: 0;">Prescription Approved</p>
      </div>
      <h1 style="font-size: 20px; margin-bottom: 16px;">Great News, ${escapeHtml(params.patientName)}!</h1>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your ${escapeHtml(params.serviceName)} prescription has been approved by your provider.</p>
      <p style="font-size: 15px; color: #333; margin-bottom: 16px;">Your card has been charged and your prescription is now being processed. You will receive shipping and tracking information once your medication is on its way.</p>
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
