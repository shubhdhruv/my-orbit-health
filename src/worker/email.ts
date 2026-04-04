interface EmailParams {
  to: string;
  subject: string;
  html: string;
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
