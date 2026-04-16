# My Orbit Health

White-label telehealth intake form system. Generates branded HTML intake forms for influencers that submit patient data to Healthie via a Cloudflare Worker API.

## How It Works

1. **Influencer visits** `/onboard` and fills out a single form (brand, services, pricing, payment)
2. **System automatically** creates their Healthie org, Stripe Connect account, and branded forms
3. **Influencer receives** embed code via email — pastes it into their website
4. **Patient fills out** the branded intake form, enters CC (authorized, not charged)
5. **Doctor reviews** in Healthie and approves/denies the prescription
6. **If approved** — CC is charged, monthly subscription starts
7. **If denied** — CC authorization is released, patient is never charged

## Architecture

```
Influencer Onboarding Form → Cloudflare Worker → Healthie API + Stripe Connect + KV
Patient Intake Form → Cloudflare Worker → Healthie (patient + form) + Stripe (authorize)
Healthie Webhook (Rx approved) → Worker → Stripe (capture + subscription)
```

## Payment Modes

- **Platform** — You (My Orbit Health) charge via your Stripe, influencer gets payout via Stripe Connect
- **Direct** — Influencer uses their own Stripe account

## Setup

### Prerequisites

- Cloudflare account with Workers
- Healthie API key
- Stripe account with Connect enabled
- Resend account for transactional email

### Environment Secrets (set via `wrangler secret put`)

```
HEALTHIE_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
```

### KV Namespace

Create a KV namespace and update the ID in `wrangler.toml`:

```bash
wrangler kv namespace create PARTNERS
```

### Deploy

```bash
npm install
npm run deploy
```

## API Routes

| Route                             | Method | Description                       |
| --------------------------------- | ------ | --------------------------------- |
| `/onboard`                        | GET    | Influencer onboarding form        |
| `/onboard`                        | POST   | Process onboarding                |
| `/form/:slug/:serviceType`        | GET    | Branded patient intake form       |
| `/form/:slug/:serviceType/submit` | POST   | Submit intake + authorize payment |
| `/webhooks/healthie`              | POST   | Healthie prescription webhook     |
| `/webhooks/stripe`                | POST   | Stripe subscription webhook       |
| `/admin/partners`                 | GET    | List all partners                 |
| `/admin/partners/:slug`           | GET    | Get partner config                |
