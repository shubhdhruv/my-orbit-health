import type { DosingResult } from "./dosing";

export interface Env {
  PARTNERS: KVNamespace;
  BLOODWORK_R2: R2Bucket;
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
  // PrescribeRx (replacing Medplum — optional until cutover)
  PRESCRIBE_RX_BASE_URL?: string;
  PRESCRIBE_RX_API_TOKEN?: string;
  PRESCRIBE_RX_CLIENT_ID?: string;
  PRESCRIBE_RX_SALES_ORG_ID?: string;
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
  | "klow"
  | "sermorelin"
  | "cjc-ipamorelin"
  | "hair-loss"
  | "hair-loss-women"
  | "progesterone";

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
  // HRT Clearance Kit — per-partner pricing + split
  bloodworkKitPrice?: number; // Patient pays this (default $124.99)
  bloodworkKitFee?: number; // MOH keeps this from the kit charge (default = full amount)
  // Branded email sending — domain verified on MOH's Resend account
  senderEmail?: string; // e.g. "noreply@beverlyhillsdrip.com"
  senderName?: string; // e.g. "Beverly Hills Drip" — defaults to businessName
  resendApiKey?: string; // Partner's own Resend API key — falls back to MOH key
  resendDomainId?: string; // Resend domain ID for verification tracking
  resendDomainStatus?: "not_started" | "pending" | "verified" | "failed";
  resendDnsRecords?: Array<{
    record: string;
    name: string;
    type: string;
    value: string;
    ttl: number;
    status: string;
    priority?: number | null;
  }>;
  // Patient portal custom subdomain (e.g. "portal.kingdomlongevitylabs.com")
  // Used for Host-based tenant routing on the portal worker routes.
  portalDomain?: string;
  enabled: boolean;
  createdAt: string;
}

// ─── Coupon / Promo Code ─────────────────────────────────────

export interface Coupon {
  code: string;
  type: "percent" | "fixed" | "at-cost";
  // percent → value = percentage off (e.g. 20 = 20%)
  // fixed   → value = dollar amount off
  // at-cost → ignored (uses atCostPrices instead)
  value?: number;
  // For at-cost coupons: per-service pharmacy cost. Final price = cost + $5 MOH fee.
  atCostPrices?: Record<string, number>;
  maxUses?: number; // undefined = unlimited
  onePerEmail?: boolean; // true = one redemption per email address
  usedCount: number;
  usedEmails: string[];
  partnerSlug?: string; // lock coupon to a specific partner
  active: boolean;
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
  prescribeRxPatientChartId?: string;
  prescribeRxEncounterId?: string;

  // Service
  partnerSlug: string;
  partnerName: string;
  serviceType: string;
  serviceName: string;

  // Payment
  chargeAmount: number;
  subscriptionPrice: number;
  planMonths?: number; // 1 = monthly, 3 = 3-month prepaid, 6 = 6-month prepaid
  paymentMethodId: string;

  // Clinical
  visitType: string;
  dosingResult?: DosingResult;
  answers: Record<string, string | string[] | boolean>;
  routingConstraints: string[];

  // Bloodwork
  bloodworkStatus?: "have-labs" | "buy-kit" | "not-required";
  bloodworkR2Key?: string; // R2 object key for uploaded lab file (current)
  bloodworkBinaryId?: string; // Legacy: Medplum Binary ID — read-only fallback for pre-R2 cases
  bloodworkDocRefId?: string; // Legacy: Medplum DocumentReference — no longer written
  bloodworkKitPurchased?: boolean; // Patient paid $124.99 for HRT clearance kit
  bloodworkKitPaymentId?: string; // Stripe PaymentIntent ID for the kit charge
  bloodworkKitShipped?: boolean; // Admin marks when the kit is physically shipped
  // Bloodwork lifecycle timestamps (drives portal timeline)
  bloodworkKitShippedAt?: string; // ISO: kit shipped to patient
  bloodworkReceivedAt?: string; // ISO: lab has patient's sample
  bloodworkReviewedAt?: string; // ISO: provider has reviewed results

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

  // Legal: Patient Enrollment Disclosure acknowledgment (proof of consent)
  disclosureAcknowledged?: boolean;
  disclosureAcknowledgedAt?: string; // ISO timestamp
  disclosureVersion?: string; // Which revision of the disclosure text
  disclosureIp?: string; // Client IP at time of acknowledgment
  disclosureUserAgent?: string; // Client UA at time of acknowledgment

  // Coupon
  couponCode?: string;
  couponDiscount?: number; // dollar amount saved

  // Timestamps
  createdAt: string;
  authExpiresAt: string;
  resolvedAt?: string;
  denyReason?: string;

  // Re-enrollment after auth expiry: when the original PaymentIntent auth
  // expires before approval, support sends the patient a fresh Checkout
  // Session in subscription mode. The webhook stamps the new subscription
  // ID here so the Approve handler skips Stripe capture + sub creation
  // (already handled by the Checkout Session).
  reenrollmentSubscriptionId?: string;
  reenrolledAt?: string;

  // Reviewer attribution (which doctor approved/denied the case)
  reviewedBySlug?: string; // doctor_accounts slug, e.g. "kle" | "shubh"
  reviewedByName?: string; // display name at time of review
  reviewedByEmail?: string;

  // Audit log of direct messages from doctor → patient (clinical questions
  // that don't resolve the case). Sent via Resend with replyTo=doctor email.
  doctorMessages?: Array<{
    at: string;
    fromSlug: string;
    fromName: string;
    fromEmail: string;
    message: string;
  }>;
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
  bloodworkStatus?: "have-labs" | "buy-kit";
  bloodworkFileUrl?: string;
  selectedPlan?: {
    id: string;
    months: number;
    totalPrice: number;
  };
  stripePaymentIntentId: string;
  disqualified?: boolean;
  disqualifyingReasons?: string[];
}
