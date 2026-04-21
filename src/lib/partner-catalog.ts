// Self-service partner catalog — validation + apply + audit logic.
//
// Partners edit their products and pricing from their own dashboard. This
// module owns the pure logic (no side effects on the network) that decides
// whether a requested update is legal and what the resulting partner record
// looks like.
//
// Route handlers live in src/worker/partner-dashboard.ts.
// Design decisions: docs/partner-self-service-catalog.md.

import { PartnerConfig, ServiceConfig, ServiceId } from "./types";
import { priceFloor, platformFeeFor, PHARMACY_COSTS } from "./pharmacy-costs";

// ─── Request shape ────────────────────────────────────────────

export interface CatalogUpdateRequest {
  services: CatalogServiceInput[];
  // Partner must re-POST with services they've acknowledged will be
  // disabled despite having active subscribers.
  confirmDisableWithActiveSubs?: string[];
}

export interface CatalogServiceInput {
  type: string;
  enabled: boolean;
  subscriptionPrice: number;
}

// ─── Validation ───────────────────────────────────────────────

export type ValidationError =
  | { kind: "UNKNOWN_SERVICE"; service: string }
  | { kind: "PRICE_NOT_A_NUMBER"; service: string }
  | { kind: "PRICE_BELOW_FLOOR"; service: string; floor: number; got: number }
  | {
      kind: "ACTIVE_SUBS_REQUIRE_CONFIRMATION";
      service: string;
      activeCount: number;
    };

export interface ValidationContext {
  // serviceId → active subscription count. Callers fetch this from Stripe
  // for services being disabled. Services not in the map are treated as 0.
  activeSubCounts: Record<string, number>;
}

// Returns an empty array if the request is legal. Otherwise returns every
// error found (callers can surface all at once instead of one per roundtrip).
export function validateCatalogUpdate(
  currentPartner: PartnerConfig,
  req: CatalogUpdateRequest,
  ctx: ValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const confirmed = new Set(req.confirmDisableWithActiveSubs || []);

  const currentEnabled = new Set<string>(
    currentPartner.services.map((s) => s.type),
  );

  for (const input of req.services) {
    // Unknown service — not in master pharmacy catalog.
    const floor = priceFloor(input.type);
    if (floor === null) {
      errors.push({ kind: "UNKNOWN_SERVICE", service: input.type });
      continue;
    }

    // Price must be a finite number.
    if (
      typeof input.subscriptionPrice !== "number" ||
      !Number.isFinite(input.subscriptionPrice)
    ) {
      errors.push({ kind: "PRICE_NOT_A_NUMBER", service: input.type });
      continue;
    }

    // Price floor is always enforced, even on products the partner is
    // disabling — prevents a partner from saving a bad number "just to
    // turn it off" and re-enabling later with an illegal price.
    if (input.subscriptionPrice < floor) {
      errors.push({
        kind: "PRICE_BELOW_FLOOR",
        service: input.type,
        floor,
        got: input.subscriptionPrice,
      });
    }

    // Soft-block: if partner is disabling a service that has active subs
    // and hasn't confirmed, reject with ACTIVE_SUBS_REQUIRE_CONFIRMATION.
    const wasEnabled = currentEnabled.has(input.type);
    const isBeingDisabled = wasEnabled && !input.enabled;
    if (isBeingDisabled) {
      const activeCount = ctx.activeSubCounts[input.type] || 0;
      if (activeCount > 0 && !confirmed.has(input.type)) {
        errors.push({
          kind: "ACTIVE_SUBS_REQUIRE_CONFIRMATION",
          service: input.type,
          activeCount,
        });
      }
    }
  }

  return errors;
}

// ─── Apply ────────────────────────────────────────────────────

// Returns the partner config that should be written to KV. Does NOT mutate
// the input. Only services whose `enabled` is true appear in the output's
// `services[]`. Platform fees are computed from the shared pharmacy catalog.
export function applyCatalogUpdate(
  currentPartner: PartnerConfig,
  req: CatalogUpdateRequest,
): PartnerConfig {
  const next: PartnerConfig = {
    ...currentPartner,
    services: [],
    platformFees: { ...(currentPartner.platformFees || {}) },
  };

  // Preserve existing per-service fields that the catalog form doesn't
  // touch (e.g. plans, initialPrice) by keying off the old services[].
  const existingByType = new Map<string, ServiceConfig>();
  for (const s of currentPartner.services) {
    existingByType.set(s.type, s);
  }

  for (const input of req.services) {
    if (!input.enabled) continue;

    const prev = existingByType.get(input.type);
    next.services.push({
      type: input.type as ServiceId,
      initialPrice: prev?.initialPrice ?? 0,
      subscriptionPrice: input.subscriptionPrice,
      subscriptionInterval: "monthly",
      ...(prev?.plans ? { plans: prev.plans } : {}),
    });

    // Update platform fee from canonical pharmacy catalog. Partners can't
    // set this themselves — MOH always takes pharmacy cost + $5 fee.
    const fee = platformFeeFor(input.type);
    if (fee !== null && next.platformFees) {
      next.platformFees[input.type] = fee;
    }
  }

  return next;
}

// ─── Audit diff ───────────────────────────────────────────────

export interface AuditChange {
  service: string;
  field: "enabled" | "price";
  from: number | boolean | null;
  to: number | boolean;
}

export interface AuditEntry {
  at: string; // ISO timestamp
  actor: "partner" | "admin";
  changes: AuditChange[];
}

// Computes the diff between current partner state and a proposed update so
// the audit log captures exactly what changed. No-op changes are filtered
// out. Returns empty array if nothing changed.
export function diffForAudit(
  currentPartner: PartnerConfig,
  req: CatalogUpdateRequest,
): AuditChange[] {
  const changes: AuditChange[] = [];
  const currentByType = new Map<string, ServiceConfig>();
  for (const s of currentPartner.services) currentByType.set(s.type, s);

  for (const input of req.services) {
    const prev = currentByType.get(input.type);
    const wasEnabled = !!prev;

    // enabled toggled?
    if (wasEnabled !== input.enabled) {
      changes.push({
        service: input.type,
        field: "enabled",
        from: wasEnabled,
        to: input.enabled,
      });
    }

    // price changed on a service that remained enabled?
    if (
      prev &&
      input.enabled &&
      prev.subscriptionPrice !== input.subscriptionPrice
    ) {
      changes.push({
        service: input.type,
        field: "price",
        from: prev.subscriptionPrice,
        to: input.subscriptionPrice,
      });
    }

    // newly enabled services set a price from null baseline
    if (!prev && input.enabled) {
      changes.push({
        service: input.type,
        field: "price",
        from: null,
        to: input.subscriptionPrice,
      });
    }
  }

  return changes;
}

// ─── Display helpers (UI can import this) ────────────────────

export interface CatalogRow {
  type: string;
  name: string;
  category: string;
  cost: number; // pharmacy cost
  platformFee: number; // cost + $5
  floor: number; // min allowed subscriptionPrice
  enabled: boolean;
  subscriptionPrice: number; // current price, 0 if never set
}

export function buildCatalogRows(
  currentPartner: PartnerConfig,
  serviceList: Array<{ id: string; name: string; cat: string }>,
): CatalogRow[] {
  const current = new Map<string, ServiceConfig>();
  for (const s of currentPartner.services) current.set(s.type, s);

  const rows: CatalogRow[] = [];
  for (const entry of serviceList) {
    const pc = PHARMACY_COSTS[entry.id];
    if (!pc) continue; // no pharmacy cost → can't offer it
    const floor = priceFloor(entry.id);
    if (floor === null) continue;
    const fee = platformFeeFor(entry.id);
    if (fee === null) continue;
    const live = current.get(entry.id);
    rows.push({
      type: entry.id,
      name: entry.name,
      category: entry.cat,
      cost: pc.cost,
      platformFee: fee,
      floor,
      enabled: !!live,
      subscriptionPrice: live?.subscriptionPrice ?? floor,
    });
  }
  return rows;
}
