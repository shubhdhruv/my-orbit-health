import { PartnerConfig } from "./types";

export function injectBrand(html: string, partner: PartnerConfig): string {
  return html
    .replace(/\{\{BUSINESS_NAME\}\}/g, partner.businessName)
    .replace(/\{\{LOGO_URL\}\}/g, partner.logoUrl)
    .replace(/\{\{PRIMARY_COLOR\}\}/g, partner.brandColors.primary)
    .replace(/\{\{SECONDARY_COLOR\}\}/g, partner.brandColors.secondary)
    .replace(/\{\{FONT\}\}/g, partner.font)
    .replace(/\{\{PARTNER_SLUG\}\}/g, partner.slug)
    .replace(/\{\{WEBSITE_URL\}\}/g, partner.websiteUrl);
}

export function injectPrices(
  html: string,
  serviceType: string,
  partner: PartnerConfig,
): string {
  const service = partner.services.find((s) => s.type === serviceType);
  if (!service) return html;

  return html
    .replace(/\{\{INITIAL_PRICE\}\}/g, service.initialPrice.toString())
    .replace(
      /\{\{SUBSCRIPTION_PRICE\}\}/g,
      service.subscriptionPrice.toString(),
    )
    .replace(/\{\{SERVICE_TYPE\}\}/g, service.type)
    .replace(
      /\{\{SERVICE_LABEL\}\}/g,
      service.type === "semaglutide"
        ? "GLP-1 Weight Loss Program"
        : "Hormone Replacement Therapy",
    );
}
