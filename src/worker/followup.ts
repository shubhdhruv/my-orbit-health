// Automated patient follow-up email drip
// Triggered by Cron Trigger — scans delivered cases and sends timed follow-ups
// All emails send from the influencer's branded email, not MOH

import { Env, PendingCase, PartnerConfig } from "../lib/types";
import { getPartner, savePendingCase } from "../lib/kv";
import { sendEmail, getPartnerEmailConfig } from "./email";

// ─── Follow-up schedule (days after delivery) ────────────────
const FOLLOW_UP_SCHEDULE: FollowUpStep[] = [
  {
    id: "day3",
    daysAfter: 3,
    subject: "How's everything going?",
    builder: buildDay3Email,
  },
  {
    id: "week2",
    daysAfter: 14,
    subject: "Quick check-in on your progress",
    builder: buildWeek2Email,
  },
  {
    id: "week4",
    daysAfter: 28,
    subject: "Your progress update",
    builder: buildWeek4Email,
  },
  {
    id: "refill",
    daysAfter: 50,
    subject: "Time to refill your prescription",
    builder: buildRefillEmail,
  },
];

interface FollowUpStep {
  id: string;
  daysAfter: number;
  subject: string;
  builder: (params: FollowUpParams) => string;
}

interface FollowUpParams {
  firstName: string;
  serviceName: string;
  serviceType: string;
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  font: string;
  statusUrl: string;
  startingDose?: string;
}

// ─── Cron handler ────────────────────────────────────────────

export async function processFollowUps(
  env: Env,
): Promise<{ sent: number; errors: number }> {
  const kv = env.PARTNERS;
  const now = new Date();
  let sent = 0;
  let errors = 0;

  // Scan all cases
  const list = await kv.list({ prefix: "case:" });
  for (const key of list.keys) {
    const c = (await kv.get(key.name, "json")) as PendingCase | null;
    if (!c) continue;

    // Only delivered cases get follow-ups
    if (
      c.status !== "approved" ||
      c.orderStatus !== "delivered" ||
      !c.deliveredAt
    )
      continue;

    const deliveredAt = new Date(c.deliveredAt);
    const daysSinceDelivery = Math.floor(
      (now.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    const sentMap = c.followUpsSent || {};

    // Find the next follow-up that's due but not yet sent
    for (const step of FOLLOW_UP_SCHEDULE) {
      if (sentMap[step.id]) continue; // Already sent
      if (daysSinceDelivery < step.daysAfter) continue; // Not due yet

      // Send this follow-up
      try {
        const partner = await getPartner(kv, c.partnerSlug);
        if (!partner) continue;

        const emailConfig = getPartnerEmailConfig(partner, env.RESEND_API_KEY);
        const firstName = c.patientName.split(" ")[0];
        const statusUrl = `https://onboard.myorbithealth.com/status/${c.paymentIntentId}`;

        const params: FollowUpParams = {
          firstName,
          serviceName: c.serviceName,
          serviceType: c.serviceType,
          brandName: partner.businessName,
          logoUrl: partner.logoUrl || "",
          primaryColor: partner.brandColors?.primary || "#4F46E5",
          font: partner.font || "Inter",
          statusUrl,
          startingDose: c.dosingResult?.startingDose || undefined,
        };

        await sendEmail(
          emailConfig.apiKey,
          {
            to: c.patientEmail,
            subject: step.subject,
            html: step.builder(params),
          },
          emailConfig.from,
        );

        // Mark as sent
        sentMap[step.id] = now.toISOString();
        c.followUpsSent = sentMap;
        await savePendingCase(kv, c);
        sent++;
      } catch (e) {
        console.error(
          `Follow-up ${step.id} failed for case ${c.paymentIntentId}:`,
          e,
        );
        errors++;
      }

      // One follow-up per case per cron run (don't blast them)
      break;
    }
  }

  return { sent, errors };
}

// ─── Shared email wrapper ────────────────────────────────────
// Hims/Hers-level branded email shell — logo, colors, typography, clean layout

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(p: FollowUpParams, content: string): string {
  const c = esc(p.primaryColor);
  const f = esc(p.font);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(p.brandName)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">

  <!-- Header with logo -->
  <tr>
    <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0f0f0;">
      ${
        p.logoUrl
          ? `<img src="${p.logoUrl}" alt="${esc(p.brandName)}" style="max-height:40px;max-width:180px;" />`
          : `<span style="font-family:'${f}',system-ui,sans-serif;font-size:20px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">${esc(p.brandName)}</span>`
      }
    </td>
  </tr>

  <!-- Body content -->
  <tr>
    <td style="padding:36px 40px 40px;font-family:'${f}',system-ui,-apple-system,sans-serif;color:#1a1a1a;">
      ${content}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 40px 32px;background:#fafaf8;border-top:1px solid #f0f0f0;text-align:center;">
      <p style="margin:0 0 8px;font-family:'${f}',system-ui,sans-serif;font-size:12px;color:#999;">
        You're receiving this because you're a patient of ${esc(p.brandName)}.
      </p>
      <p style="margin:0;font-family:'${f}',system-ui,sans-serif;font-size:12px;color:#bbb;">
        &copy; ${new Date().getFullYear()} ${esc(p.brandName)}
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(p: FollowUpParams, label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:${esc(p.primaryColor)};color:#ffffff;font-family:'${esc(p.font)}',system-ui,sans-serif;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.2px;">${esc(label)}</a>`;
}

function secondaryButton(
  p: FollowUpParams,
  label: string,
  url: string,
): string {
  return `<a href="${url}" style="display:inline-block;background:#f5f5f0;color:${esc(p.primaryColor)};font-family:'${esc(p.font)}',system-ui,sans-serif;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;border:1px solid #e5e5e0;">${esc(label)}</a>`;
}

function divider(): string {
  return `<div style="height:1px;background:#f0f0f0;margin:28px 0;"></div>`;
}

// ─── Medication tips by category ─────────────────────────────

function getMedicationTips(serviceType: string): {
  day3: string[];
  week2: string[];
  week4: string[];
} {
  const glp1 = {
    day3: [
      "Take your dose at the same time each week for the best results.",
      "Mild nausea is common in the first week and usually fades. Eating smaller meals helps.",
      "Stay hydrated — aim for at least 8 glasses of water a day.",
    ],
    week2: [
      "Many patients start noticing reduced appetite and cravings around this point.",
      "Focus on protein-rich meals to maintain muscle while losing weight.",
      "Light exercise like walking can enhance your results significantly.",
    ],
    week4: [
      "By now your body has adjusted to the medication. Side effects should be minimal.",
      "Take progress photos — the mirror doesn't always show what the camera does.",
      "Your provider will evaluate your progress before any dose adjustments.",
    ],
  };

  const ed = {
    day3: [
      "Take your medication 30-60 minutes before activity for best results.",
      "A light meal is fine, but avoid heavy or high-fat foods beforehand.",
      "Headache or flushing can occur the first few times and typically resolves.",
    ],
    week2: [
      "Consistency is key — the medication works better as your body adjusts.",
      "If you're on daily dosing, take it at the same time each day.",
      "Stay hydrated and limit alcohol for optimal effectiveness.",
    ],
    week4: [
      "Most patients find their ideal timing and routine by now.",
      "If you're not seeing the results you expected, your provider can adjust your dose.",
      "Regular exercise and good sleep also make a meaningful difference.",
    ],
  };

  const hrtMale = {
    day3: [
      "Follow your injection schedule exactly as prescribed for stable hormone levels.",
      "Rotate injection sites to minimize discomfort.",
      "Minor soreness at the injection site is normal and should resolve in a day or two.",
    ],
    week2: [
      "Increased energy and improved mood are often the first benefits patients notice.",
      "Strength training pairs exceptionally well with testosterone therapy.",
      "Keep notes on how you're feeling — your provider will want to know at your check-in.",
    ],
    week4: [
      "Full effects typically develop over 3-6 months, so stay consistent.",
      "Lab work may be needed at this point to dial in your levels.",
      "If you're experiencing any side effects, let your provider know early.",
    ],
  };

  const hrtFemale = {
    day3: [
      "Apply your medication at the same time each day for consistent levels.",
      "If using a topical, let it fully absorb before applying other products.",
      "Mild skin irritation at the application site is common and usually resolves.",
    ],
    week2: [
      "Improved sleep and reduced hot flashes are often the first improvements.",
      "Keep a simple symptom journal to share with your provider.",
      "Stress management and regular movement amplify the benefits of HRT.",
    ],
    week4: [
      "Most patients feel significantly better by the one-month mark.",
      "Your provider may adjust your dose based on how you're responding.",
      "Consistency is the most important factor for long-term results.",
    ],
  };

  const peptide = {
    day3: [
      "Follow your reconstitution and storage instructions carefully — peptides are sensitive to temperature.",
      "Inject at the same time each day for consistent levels.",
      "Mild redness at the injection site is normal and should resolve quickly.",
    ],
    week2: [
      "Many patients start noticing improvements in recovery and energy around this time.",
      "Quality sleep is essential — peptides do much of their work during deep sleep cycles.",
      "Stay well-hydrated to support optimal peptide absorption.",
    ],
    week4: [
      "Results compound over time — the benefits at 8 weeks will be noticeably stronger than at 4.",
      "Share how you're feeling with your provider so they can optimize your protocol.",
      "Consistent timing and proper storage are the keys to getting the most out of your protocol.",
    ],
  };

  if (["semaglutide", "tirzepatide", "retatrutide"].includes(serviceType))
    return glp1;
  if (["sildenafil", "tadalafil"].includes(serviceType)) return ed;
  if (
    ["testosterone-injectable", "testosterone-oral", "enclomiphene"].includes(
      serviceType,
    )
  )
    return hrtMale;
  if (
    [
      "estrogen-cream-vaginal",
      "estrogen-cream-systemic",
      "estrogen-patches",
    ].includes(serviceType)
  )
    return hrtFemale;
  return peptide; // peptides + blends
}

// ─── Email builders ──────────────────────────────────────────

function buildDay3Email(p: FollowUpParams): string {
  const tips = getMedicationTips(p.serviceType);
  const tipsHtml = tips.day3
    .map(
      (t) =>
        `<tr>
      <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
      </td>
      <td style="padding:0 0 12px;font-size:15px;line-height:1.6;color:#444;">${esc(t)}</td>
    </tr>`,
    )
    .join("");

  return emailShell(
    p,
    `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.3;">
      Hey ${esc(p.firstName)}, how's it going?
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#666;">
      It's been a few days since your ${esc(p.serviceName)} arrived. We just wanted to check in and make sure everything is going smoothly.
    </p>

    <div style="background:#fafaf8;border-radius:12px;padding:24px 28px;margin:0 0 28px;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.5px;">
        Tips for your first week
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        ${tipsHtml}
      </table>
    </div>

    ${
      p.startingDose
        ? `
    <div style="background:${esc(p.primaryColor)}08;border:1px solid ${esc(p.primaryColor)}20;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:${esc(p.primaryColor)};text-transform:uppercase;letter-spacing:0.5px;">Your current dose</p>
      <p style="margin:0;font-size:20px;font-weight:700;color:#1a1a1a;">${esc(p.startingDose)}</p>
    </div>`
        : ""
    }

    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
      If you have any questions at all, just reply to this email. We're here for you.
    </p>

    <div style="text-align:center;">
      ${secondaryButton(p, "View Order Status", p.statusUrl)}
    </div>
  `,
  );
}

function buildWeek2Email(p: FollowUpParams): string {
  const tips = getMedicationTips(p.serviceType);
  const tipsHtml = tips.week2
    .map(
      (t) =>
        `<tr>
      <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
      </td>
      <td style="padding:0 0 12px;font-size:15px;line-height:1.6;color:#444;">${esc(t)}</td>
    </tr>`,
    )
    .join("");

  return emailShell(
    p,
    `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.3;">
      Two weeks in, ${esc(p.firstName)}.
    </h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#666;">
      How are you feeling? This is usually when patients start noticing real changes.
    </p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#666;">
      Here's what to keep in mind as you continue your treatment.
    </p>

    <div style="background:#fafaf8;border-radius:12px;padding:24px 28px;margin:0 0 28px;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.5px;">
        What to expect right now
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        ${tipsHtml}
      </table>
    </div>

    ${divider()}

    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
      Remember, consistency is the biggest factor in your results. Keep going — you're doing great.
    </p>

    <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#444;">
      Questions or concerns? Just hit reply.
    </p>
  `,
  );
}

function buildWeek4Email(p: FollowUpParams): string {
  const tips = getMedicationTips(p.serviceType);
  const tipsHtml = tips.week4
    .map(
      (t) =>
        `<tr>
      <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
      </td>
      <td style="padding:0 0 12px;font-size:15px;line-height:1.6;color:#444;">${esc(t)}</td>
    </tr>`,
    )
    .join("");

  return emailShell(
    p,
    `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.3;">
      One month down, ${esc(p.firstName)}.
    </h1>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#666;">
      You've been on ${esc(p.serviceName)} for about four weeks now. This is a great time to check in on your progress and look ahead.
    </p>

    <div style="background:#fafaf8;border-radius:12px;padding:24px 28px;margin:0 0 28px;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.5px;">
        Your one-month checkpoint
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        ${tipsHtml}
      </table>
    </div>

    ${divider()}

    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
      Your provider is monitoring your progress and will reach out if any adjustments are needed. In the meantime, keep doing what you're doing.
    </p>

    <p style="margin:0;font-size:15px;line-height:1.6;color:#444;">
      We're proud of you for sticking with it. Reply anytime if you need us.
    </p>
  `,
  );
}

function buildRefillEmail(p: FollowUpParams): string {
  return emailShell(
    p,
    `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1a1a1a;line-height:1.3;">
      Time to refill, ${esc(p.firstName)}.
    </h1>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#666;">
      Your ${esc(p.serviceName)} supply is running low. To keep your progress on track and avoid any gaps in treatment, it's time to reorder.
    </p>

    <div style="background:${esc(p.primaryColor)}08;border:1px solid ${esc(p.primaryColor)}20;border-radius:12px;padding:24px 28px;margin:0 0 28px;text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;color:#666;">Don't lose your momentum.</p>
      <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1a1a1a;">
        Gaps in treatment can slow your progress and may require dose readjustment.
      </p>
      ${ctaButton(p, "Refill My Prescription", p.statusUrl)}
    </div>

    ${divider()}

    <div style="background:#fafaf8;border-radius:12px;padding:20px 24px;margin:0 0 28px;">
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#1a1a1a;">Why staying consistent matters:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        <tr>
          <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
          </td>
          <td style="padding:0 0 10px;font-size:15px;line-height:1.6;color:#444;">Your body has adapted to the medication — stopping and restarting can reset that progress.</td>
        </tr>
        <tr>
          <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
          </td>
          <td style="padding:0 0 10px;font-size:15px;line-height:1.6;color:#444;">Consistent dosing leads to better, more predictable results.</td>
        </tr>
        <tr>
          <td style="padding:0 16px 0 0;vertical-align:top;width:24px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${esc(p.primaryColor)};margin-top:7px;"></div>
          </td>
          <td style="padding:0 0 0;font-size:15px;line-height:1.6;color:#444;">Refilling on time means no waiting for a new shipment when you run out.</td>
        </tr>
      </table>
    </div>

    <p style="margin:0;font-size:15px;line-height:1.6;color:#444;">
      Questions about your treatment? Just reply to this email and your care team will get back to you.
    </p>
  `,
  );
}
