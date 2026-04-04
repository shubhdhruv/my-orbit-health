export interface Env {
  PARTNERS: KVNamespace;
  HEALTHIE_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD_HASH: string;
  ENVIRONMENT: string;
}

export type ServiceId =
  | "semaglutide"
  | "tirzepatide"
  | "retatrutide"
  | "sildenafil"
  | "tadalafil"
  | "testosterone-injectable"
  | "testosterone-oral"
  | "enclomiphene"
  | "estrogen-cream"
  | "estrogen-patches"
  | "mots-c"
  | "nad"
  | "bpc-157"
  | "tb-500"
  | "wolverine"
  | "glo"
  | "klow";

export interface ServiceConfig {
  type: ServiceId;
  initialPrice: number;
  subscriptionPrice: number;
  subscriptionInterval: "monthly";
  plans?: PlanOption[];
}

export interface PlanOption {
  id: string;
  label: string;
  months: number;
  pricePerMonth: number;
  totalPrice: number;
  savings?: string;
  featured?: boolean;
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
  healthieFormIds?: Record<string, string>; // serviceId → Healthie form ID
  platformFees?: Record<string, number>; // serviceId → flat dollar amount MOH keeps
  enabled: boolean;
  createdAt: string;
}

export interface IntakeSubmission {
  partnerSlug: string;
  serviceType: ServiceId;
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
  answers: Record<string, string | string[] | boolean>;
  bloodworkStatus?: "have-labs" | "need-labs";
  bloodworkFileUrl?: string;
  labOrderPreference?: "walk-in" | "at-home";
  selectedPlan?: {
    id: string;
    months: number;
    totalPrice: number;
  };
  stripePaymentIntentId: string;
  disqualified?: boolean;
  disqualifyingReasons?: string[];
}
