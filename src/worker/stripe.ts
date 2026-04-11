import Stripe from "stripe";
import { PartnerConfig } from "../lib/types";

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
}

// Create a Stripe Connect account for an influencer (platform mode)
export async function createConnectAccount(
  stripe: Stripe,
  email: string,
  businessName: string
): Promise<{ accountId: string; onboardingUrl: string }> {
  const account = await stripe.accounts.create({
    type: "express",
    email,
    business_profile: {
      name: businessName,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  const link = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: "https://myorbithealth.com/partner/retry",
    return_url: "https://myorbithealth.com/partner/success",
    type: "account_onboarding",
  });

  return {
    accountId: account.id,
    onboardingUrl: link.url,
  };
}

// Authorize a card without charging (manual capture)
export async function authorizePayment(
  stripe: Stripe,
  partner: PartnerConfig,
  amount: number,
  customerEmail: string,
  paymentMethodId: string,
  serviceType?: string
): Promise<string> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: amount * 100, // cents
    currency: "usd",
    payment_method: paymentMethodId,
    capture_method: "manual",
    confirm: true,
    receipt_email: customerEmail,
    metadata: {
      partner_slug: partner.slug,
      partner_name: partner.businessName,
      service_type: serviceType || "",
    },
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: "never",
    },
  };

  // Platform mode: charge on behalf of the influencer
  if (partner.paymentMode === "platform" && partner.stripeConnectAccountId) {
    // Calculate platform fee (flat dollar amount MOH keeps)
    const platformFee = partner.platformFees?.[serviceType || ""] || 0;

    params.transfer_data = {
      destination: partner.stripeConnectAccountId,
    };

    if (platformFee > 0) {
      params.application_fee_amount = platformFee * 100; // cents
    }
  }

  const intent = await stripe.paymentIntents.create(
    params,
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined
  );

  return intent.id;
}

// Capture payment after prescription approval
export async function capturePayment(
  stripe: Stripe,
  paymentIntentId: string,
  partner: PartnerConfig
): Promise<void> {
  await stripe.paymentIntents.capture(
    paymentIntentId,
    {},
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined
  );
}

// Create a subscription after first payment
export async function createSubscription(
  stripe: Stripe,
  partner: PartnerConfig,
  customerEmail: string,
  paymentMethodId: string,
  monthlyAmount: number,
  serviceType: string
): Promise<string> {
  // Create or find customer
  const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
  let customer: Stripe.Customer;

  if (customers.data.length > 0) {
    customer = customers.data[0];
  } else {
    customer = await stripe.customers.create({
      email: customerEmail,
      payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId },
      metadata: { partner_slug: partner.slug },
    });
  }

  // Create a price for this partner + service combo
  const price = await stripe.prices.create({
    unit_amount: monthlyAmount * 100,
    currency: "usd",
    recurring: { interval: "month" },
    product_data: {
      name: `${partner.businessName} - ${serviceType}`,
      metadata: { partner_slug: partner.slug, service_type: serviceType },
    },
  });

  const subParams: Stripe.SubscriptionCreateParams = {
    customer: customer.id,
    items: [{ price: price.id }],
    metadata: {
      partner_slug: partner.slug,
      service_type: serviceType,
    },
  };

  if (partner.paymentMode === "platform" && partner.stripeConnectAccountId) {
    subParams.transfer_data = {
      destination: partner.stripeConnectAccountId,
    };
  }

  const subscription = await stripe.subscriptions.create(
    subParams,
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined
  );

  return subscription.id;
}

// Immediately charge the HRT Clearance Kit fee ($124.99) — captured at intake
// time so we can ship the kit before the doctor reviews the case.
export async function chargeKitFee(
  stripe: Stripe,
  partner: PartnerConfig,
  amountDollars: number,
  customerEmail: string,
  paymentMethodId: string,
): Promise<string> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(amountDollars * 100),
    currency: "usd",
    payment_method: paymentMethodId,
    capture_method: "automatic",
    confirm: true,
    receipt_email: customerEmail,
    description: "HRT Clearance Kit",
    metadata: {
      partner_slug: partner.slug,
      partner_name: partner.businessName,
      kind: "hrt_clearance_kit",
    },
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: "never",
    },
  };

  const intent = await stripe.paymentIntents.create(
    params,
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined,
  );

  return intent.id;
}

// Create a Stripe Checkout session to collect payment method (no charge)
export async function createSetupIntent(
  stripe: Stripe,
  partner: PartnerConfig,
  customerEmail: string
): Promise<{ clientSecret: string }> {
  const intent = await stripe.setupIntents.create(
    {
      payment_method_types: ["card"],
      metadata: {
        partner_slug: partner.slug,
        customer_email: customerEmail,
      },
    },
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined
  );

  return { clientSecret: intent.client_secret! };
}
