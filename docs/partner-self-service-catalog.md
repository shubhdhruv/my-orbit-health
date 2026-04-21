# Partner Self-Service Catalog

**Status:** Locked 2026-04-21. Implementation in progress.

**Context:** On 2026-04-16 sermorelin and cjc-ipamorelin were added to the global
service catalog. They were not propagated to the 9 existing partner KV records,
so every partner's `onboard.myorbithealth.com/form/{slug}/sermorelin` URL
returned 404 until 2026-04-21 when the records were batch-patched by hand.

Root cause: the partner pricing form at `src/worker/onboard.ts:190-202` writes
submissions to a dead-end KV key (`pricing-submission:{slug}`) that nothing ever
reads. There is no code path that updates `partner.services[]` without manual
intervention. This is the "partner KV drift" bug — every catalog addition
silently breaks every existing partner until someone notices.

This feature makes partners fully self-service so MOH is never in the loop
for catalog or pricing changes.

## Locked decisions

### 1. Where the page lives

Inside the partner dashboard, served at the partner's own `portalDomain`
(e.g., `portal.kingdomlongevitylabs.com`, `portal.thrivingagain.health`).
Reuses existing partner auth (`partner_password_hash:{slug}` in KV).

### 2. Disabling a product with active subscribers

**Soft block with confirmation.** If a partner toggles a product OFF and
there are active Stripe subscriptions on that product for that partner, the
UI shows: "N patients are active on this. They'll continue to receive
refills; new patients will no longer see this product. Confirm?"

Confirming disables the product for new signups only. Existing subscriptions
are not touched in any way.

### 3. Price changes and existing subscribers

**New price applies to new patients only. Existing subs grandfathered forever
at their original price.**

This is free architecturally: the catalog price lives in partner KV; existing
Stripe subscriptions carry their own price ID and never re-read KV. Simply
don't touch existing Stripe subscriptions when a partner updates KV.

If a partner genuinely needs to raise prices on existing customers, that's a
support ticket (expected to be rare).

### 4. Minimum price floor

**Hard floor enforced server-side:**

```
min_price = pharmacy_cost + MOH_platform_fee ($5) + min_partner_margin ($1)
```

Example: sermorelin cost $65 → min price = $65 + $5 + $1 = **$71**.

Partners cannot save a price below the floor. The UI shows the floor inline
for each service so they always know it. Hard floor (not warning) is
deliberate — prevents fat-finger errors and partner-vs-partner race-to-zero
pricing that also destroys MOH's margin.

## Implementation surface

| File                                   | Change                                       |
| -------------------------------------- | -------------------------------------------- |
| `docs/partner-self-service-catalog.md` | new — this file                              |
| `src/templates/partner-catalog.ts`     | new — dashboard catalog edit UI              |
| `src/worker/partner-dashboard.ts`      | modified — add "Products & Pricing" tab      |
| `src/worker/index.ts`                  | modified — wire new API route                |
| `src/worker/onboard.ts:190-202`        | deleted — dead-end `pricing-submission` path |

## API contract

### `POST /partner/api/catalog`

**Auth:** partner session cookie (existing pattern).

**Body:**

```json
{
  "services": [
    { "type": "sermorelin", "enabled": true, "subscriptionPrice": 349 },
    { "type": "cjc-ipamorelin", "enabled": false, "subscriptionPrice": 319 }
  ],
  "confirmDisableWithActiveSubs": ["cjc-ipamorelin"]
}
```

**Response:**

- `200` on success
- `400 {error: "PRICE_BELOW_FLOOR", service, floor}` if any price below floor
- `409 {error: "ACTIVE_SUBS_REQUIRE_CONFIRMATION", service, activeCount}` if a
  service is being disabled but has active subs AND the confirm list doesn't
  include it. Caller must re-POST with `confirmDisableWithActiveSubs`
  including the service.

**Behavior:**

- Validates every price against floor before writing anything
- Queries Stripe for active sub counts on services being disabled
- If soft-block required and not confirmed → returns 409 with count so UI can
  render the confirmation dialog
- On success: writes `partner.services[]` + `partner.platformFees{}` to KV in
  one transactional put, appends audit entry to `partner_catalog_audit:{slug}`

## Audit trail

KV key `partner_catalog_audit:{slug}` holds the last 50 changes as a JSON
array. Each entry:

```json
{
  "at": "2026-04-21T18:45:12Z",
  "actor": "partner",
  "changes": [
    { "service": "sermorelin", "field": "price", "from": 349, "to": 399 },
    { "service": "bpc-157", "field": "enabled", "from": true, "to": false }
  ]
}
```

Useful for dispute resolution ("you changed the price on 4/22 not us") and
future fraud-pattern detection.

## What this does NOT solve

- **Stripe Connect onboarding** — still manual via the existing onboard flow
- **Adding a partner** — still manual KV provisioning (separate problem)
- **New services in master catalog** — still requires code change to
  `src/lib/services.ts` + `src/templates/partner-pricing.ts` for pharmacy
  cost, but now auto-appears on every partner's dashboard with toggle OFF
  by default (no KV backfill ever needed again)
