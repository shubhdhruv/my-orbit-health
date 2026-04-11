import type { DosingResult } from "./dosing";

export interface Env {
  PARTNERS: KVNamespace;
  ASSETS: Fetcher;
  HEALTHIE_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD_HASH: string;
  DOCTOR_HEALTHIE_ID: string;
  ENVIRONMENT: string;
  STRIPE_BYPASS?: string;
  ANTHROPIC_API_KEY: string;
  // Medplum (primary EHR)
  MEDPLUM_CLIENT_ID: string;
  MEDPLUM_CLIENT_SECRET: string;
  MEDPLUM_BASE_URL: string;
  DOCTOR_PRACTITIONER_ID: string;
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
  | "estrogen-cream-vaginal"
  | "estrogen-cream-systemic"
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
  // Medplum (primary)
  medplumOrgId?: string;
  medplumQuestionnaireIds?: Record<string, string>; // serviceId → Questionnaire ID
  platformFees?: Record<string, number>; // serviceId → flat dollar amount MOH keeps
  // Branded email sending — domain verified on MOH's Resend account
  senderEmail?: string;    // e.g. "noreply@beverlyhillsdrip.com"
  senderName?: string;     // e.g. "Beverly Hills Drip" — defaults to businessName
  resendApiKey?: string;   // Partner's own Resend API key — falls back to MOH key
  resendDomainId?: string; // Resend domain ID for verification tracking
  resendDomainStatus?: "not_started" | "pending" | "verified" | "failed";
  resendDnsRecords?: Array<{ record: string; name: string; type: string; value: string; ttl: number; status: string; priority?: number | null }>;
  enabled: boolean;
  createdAt: string;
}

export type OrderStatus = "prescribed" | "shipped" | "delivered";

export interface PendingCase {
  paymentIntentId: string;
  status: "pending" | "approved" | "denied";

  // Patient
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  patientState: string;
  patientDob: string;
  shippingAddress?: {
    street: string;
    apt?: string;
    city: string;
    state: string;
    zip: string;
  };
  healthiePatientId?: string;
  medplumPatientId?: string;

  // Service
  partnerSlug: string;
  partnerName: string;
  serviceType: string;
  serviceName: string;

  // Payment
  chargeAmount: number;
  subscriptionPrice: number;
  paymentMethodId: string;

  // Clinical
  visitType: string;
  dosingResult?: DosingResult;
  answers: Record<string, string | string[] | boolean>;
  routingConstraints: string[];

  // Bloodwork
  bloodworkStatus?: "have-labs" | "need-labs" | "not-required";
  bloodworkBinaryId?: string;   // Medplum Binary ID for uploaded lab file
  bloodworkDocRefId?: string;   // Medplum DocumentReference linking file to patient

  // SOAP Note
  soapNoteId?: string;

  // Order Fulfillment (set after approval)
  orderStatus?: OrderStatus;
  pharmacyOrderId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;

  // Follow-up email tracking (ISO timestamps of when each was sent)
  followUpsSent?: Record<string, string>;

  // Timestamps
  createdAt: string;
  authExpiresAt: string;
  resolvedAt?: string;
  denyReason?: string;
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
