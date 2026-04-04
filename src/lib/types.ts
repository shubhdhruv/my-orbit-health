export interface Env {
  PARTNERS: KVNamespace;
  HEALTHIE_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ENVIRONMENT: string;
}

export interface ServiceConfig {
  type: "semaglutide" | "hrt";
  initialPrice: number;
  subscriptionPrice: number;
  subscriptionInterval: "monthly";
}

export interface PartnerConfig {
  slug: string;
  businessName: string;
  contactEmail: string;
  websiteUrl: string;
  logoUrl: string;
  brandColors: {
    primary: string;
    secondary: string;
  };
  font: string;
  services: ServiceConfig[];
  paymentMode: "platform" | "direct";
  stripeConnectAccountId?: string;
  stripeDirectAccountId?: string;
  healthieOrgId?: string;
  createdAt: string;
}

export interface IntakeSubmission {
  partnerSlug: string;
  serviceType: string;
  patient: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  medicalHistory: Record<string, string | boolean>;
  stripePaymentIntentId: string;
}
