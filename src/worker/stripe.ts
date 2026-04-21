import Stripe from "stripe";
import { PartnerConfig } from "../lib/types";

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
}

// Create a Stripe Connect account for an influencer (platform mode)
export async function createConnectAccount(
  stripe: Stripe,
  email: string,
  businessName: string,
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
    refresh_url: "https://onboard.myorbithealth.com/onboard",
    return_url: "https://onboard.myorbithealth.com/onboard/complete",
    type: "account_onboarding",
  });

  return {
    accountId: account.id,
    onboardingUrl: link.url,
  };
}

// Create (or reuse) a Customer and attach the payment method so the same PM
// can be used on multiple PaymentIntents in the same flow (rx auth + kit
// charge). Without this, Stripe treats a raw PaymentMethod as single-use.
export async function ensureCustomerWithPaymentMethod(
  stripe: Stripe,
  partner: PartnerConfig,
  customerEmail: string,
  paymentMethodId: string,
): Promise<string> {
  const opts: Stripe.RequestOptions | undefined =
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined;

  // Try to reuse an existing customer for this email
  const existing = await stripe.customers.list(
    { email: customerEmail, limit: 1 },
    opts,
  );
  let customer: Stripe.Customer;
  if (existing.data.length > 0) {
    customer = existing.data[0];
    try {
      await stripe.paymentMethods.attach(
        paymentMethodId,
        { customer: customer.id },
        opts,
      );
    } catch (err: any) {
      // PM may already be attached from an earlier call in the same multi-service
      // checkout flow (add-ons). Safe to continue — PM is already on this customer.
      if (!err?.message?.includes("already been attached")) throw err;
    }
    await stripe.customers.update(
      customer.id,
      { invoice_settings: { default_payment_method: paymentMethodId } },
      opts,
    );
  } else {
    customer = await stripe.customers.create(
      {
        email: customerEmail,
        payment_method: paymentMethodId,
        invoice_settings: { default_payment_method: paymentMethodId },
        metadata: { partner_slug: partner.slug },
      },
      opts,
    );
  }
  return customer.id;
}

// Authorize a card without charging (manual capture)
export async function authorizePayment(
  stripe: Stripe,
  partner: PartnerConfig,
  amount: number,
  customerEmail: string,
  paymentMethodId: string,
  serviceType?: string,
  customerId?: string,
): Promise<string> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: amount * 100, // cents
    currency: "usd",
    customer: customerId,
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
      : undefined,
  );

  return intent.id;
}

// Capture payment after prescription approval
export async function capturePayment(
  stripe: Stripe,
  paymentIntentId: string,
  partner: PartnerConfig,
): Promise<void> {
  await stripe.paymentIntents.capture(
    paymentIntentId,
    {},
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined,
  );
}

// Create a subscription after first payment
export async function createSubscription(
  stripe: Stripe,
  partner: PartnerConfig,
  customerEmail: string,
  paymentMethodId: string,
  monthlyAmount: number,
  serviceType: string,
  trialDays?: number,
): Promise<string> {
  // Create or find customer
  const customers = await stripe.customers.list({
    email: customerEmail,
    limit: 1,
  });
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
    ...(trialDays && trialDays > 0 ? { trial_period_days: trialDays } : {}),
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
      : undefined,
  );

  return subscription.id;
}

// Count active subscriptions for a partner across one or more service
// types. Returns Record<serviceType, count>. Used by the self-service
// catalog to soft-block a partner from disabling a product that has
// live patients.
//
// "Active" = anything Stripe considers not fully terminated: active,
// trialing, past_due, unpaid. Deliberately conservative — prefer a
// false positive (showing the confirmation dialog when we shouldn't)
// over a false negative (letting a partner orphan live patients).
export async function countActiveSubscriptions(
  stripe: Stripe,
  partner: PartnerConfig,
  serviceTypes: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (serviceTypes.length === 0) return result;
  for (const t of serviceTypes) result[t] = 0;

  const opts: Stripe.RequestOptions | undefined =
    partner.paymentMode === "direct" && partner.stripeDirectAccountId
      ? { stripeAccount: partner.stripeDirectAccountId }
      : undefined;

  // Stripe Search API supports metadata filtering. One query per service
  // type keeps the logic simple and avoids per-status fanout. Search
  // returns up to 100 per page; we don't paginate beyond that because a
  // partner with >100 active subs on a single product should be rare and
  // still yields a correct "many" answer for the UI.
  await Promise.all(
    serviceTypes.map(async (serviceType) => {
      const query = [
        `metadata['partner_slug']:'${partner.slug}'`,
        `metadata['service_type']:'${serviceType}'`,
        `-status:'canceled'`,
        `-status:'incomplete_expired'`,
      ].join(" AND ");
      try {
        const page = await stripe.subscriptions.search(
          { query, limit: 100 },
          opts,
        );
        result[serviceType] = page.data.length;
      } catch {
        // If Search API fails (rare — requires indexing to have caught
        // up), treat as "unknown but non-zero" so the UI errs on the
        // side of asking for confirmation.
        result[serviceType] = 1;
      }
    }),
  );

  return result;
}

// Immediately charge the HRT Clearance Kit fee — captured at intake
// time so we can ship the kit before the doctor reviews the case.
// Partners can set a custom kit price + MOH fee split via bloodworkKitPrice / bloodworkKitFee.
export async function chargeKitFee(
  stripe: Stripe,
  partner: PartnerConfig,
  amountDollars: number,
  customerEmail: string,
  paymentMethodId: string,
  customerId?: string,
): Promise<string> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(amountDollars * 100),
    currency: "usd",
    customer: customerId,
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

  // Platform mode: split kit revenue with partner via Connect
  if (
    partner.paymentMode === "platform" &&
    partner.stripeConnectAccountId &&
    partner.bloodworkKitFee !== undefined
  ) {
    params.transfer_data = {
      destination: partner.stripeConnectAccountId,
    };
    params.application_fee_amount = Math.round(partner.bloodworkKitFee * 100);
  }

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
  customerEmail: string,
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
      : undefined,
  );

  return { clientSecret: intent.client_secret! };
}
