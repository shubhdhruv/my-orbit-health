// Shared pharmacy cost catalog. Single source of truth used by the
// partner self-service catalog for price floor validation and display.
// When a new service is added to src/lib/services.ts, add its cost here.

export interface PharmacyCost {
  product: string;
  cost: number;
}

export const PHARMACY_COSTS: Record<string, PharmacyCost> = {
  semaglutide: { product: "Semaglutide Flex-Dose 2.5mg/mL 2mL", cost: 65 },
  tirzepatide: { product: "Tirzepatide Flex-Dose 10mg/mL 2mL", cost: 91 },
  retatrutide: { product: "Retatrutide 8mg/ml 2ml", cost: 175.5 },
  sildenafil: { product: "Sildenafil Tablet 20mg (x30)", cost: 36.6 },
  tadalafil: { product: "Tadalafil RDT 6mg (x30)", cost: 18.6 },
  "testosterone-injectable": {
    product: "Testosterone Cypionate 200mg/ml 10ml",
    cost: 46,
  },
  "testosterone-oral": {
    product: "Testosterone Undecanoate 200mg (x60)",
    cost: 80.4,
  },
  enclomiphene: { product: "Enclomiphene Citrate 25mg (x30)", cost: 48.9 },
  "estrogen-cream-vaginal": {
    product: "Estradiol HRT Cream 0.5mg/gm (x30)",
    cost: 60,
  },
  "estrogen-cream-systemic": {
    product: "Biestrogen HRT Cream 1mg/gm (x30)",
    cost: 60,
  },
  "estrogen-patches": {
    product: "Estradiol Patch 0.05mg/day (8 patches)",
    cost: 92.02,
  },
  "mots-c": { product: "Empress MOTS-C/BPC-157/GHK-CU blend 5ml", cost: 130 },
  nad: { product: "NAD+ 200mg/mL 5mL", cost: 91 },
  "bpc-157": { product: "BPC-157 2mg/ml 5ml", cost: 78 },
  "tb-500": { product: "TB-500 2mg/ml 5ml", cost: 109.2 },
  sermorelin: { product: "Sermorelin 3mg/ml 3ml", cost: 65 },
  "cjc-ipamorelin": { product: "Prometheus CJC-1295/Ipamorelin", cost: 91 },
  wolverine: { product: "Valkyr BPC-157/TB-500 blend 5ml", cost: 91 },
  glo: {
    product: "Fountain of Youth GHK-CU/BPC-157/TB500 blend 5ml",
    cost: 130,
  },
  klow: { product: "Fountain of Youth + KPV blend 5ml", cost: 201.5 },
};

// Platform fee MOH keeps on every subscription, on top of pharmacy cost.
export const MOH_PLATFORM_FEE = 5;

// Minimum partner margin. Enforced to prevent fat-finger errors and
// partner-vs-partner race-to-zero pricing.
export const MIN_PARTNER_MARGIN = 1;

// Hard floor for a partner's patient-facing monthly price.
// Returns null if the service is not in the pharmacy catalog (unknown service).
export function priceFloor(serviceId: string): number | null {
  const pc = PHARMACY_COSTS[serviceId];
  if (!pc) return null;
  return pc.cost + MOH_PLATFORM_FEE + MIN_PARTNER_MARGIN;
}

// MOH's platform fee for a partner's platformFees map.
// Stored fee = pharmacy_cost + MOH_PLATFORM_FEE (legacy schema).
export function platformFeeFor(serviceId: string): number | null {
  const pc = PHARMACY_COSTS[serviceId];
  if (!pc) return null;
  return pc.cost + MOH_PLATFORM_FEE;
}

// Display catalog — the list of services a partner can choose to offer,
// grouped by category. Used by both the legacy onboarding pricing form and
// the self-service catalog page. Order here determines UI ordering.
export const SERVICE_CATALOG: Array<{ id: string; name: string; cat: string }> =
  [
    { id: "semaglutide", name: "Semaglutide", cat: "Weight Loss" },
    { id: "tirzepatide", name: "Tirzepatide", cat: "Weight Loss" },
    { id: "retatrutide", name: "Retatrutide", cat: "Weight Loss" },
    { id: "sildenafil", name: "Sildenafil", cat: "Erectile Dysfunction" },
    { id: "tadalafil", name: "Tadalafil", cat: "Erectile Dysfunction" },
    {
      id: "testosterone-injectable",
      name: "Testosterone Injectable",
      cat: "Men's Hormone Therapy",
    },
    {
      id: "testosterone-oral",
      name: "Testosterone Oral",
      cat: "Men's Hormone Therapy",
    },
    { id: "enclomiphene", name: "Enclomiphene", cat: "Men's Hormone Therapy" },
    {
      id: "estrogen-cream-vaginal",
      name: "Estrogen Cream (Vaginal)",
      cat: "Women's Hormone Therapy",
    },
    {
      id: "estrogen-cream-systemic",
      name: "Estrogen Cream (Systemic)",
      cat: "Women's Hormone Therapy",
    },
    {
      id: "estrogen-patches",
      name: "Estrogen Patches",
      cat: "Women's Hormone Therapy",
    },
    { id: "mots-c", name: "MOTS-c", cat: "Peptides" },
    { id: "nad", name: "NAD+", cat: "Peptides" },
    { id: "bpc-157", name: "BPC-157", cat: "Peptides" },
    { id: "tb-500", name: "TB-500", cat: "Peptides" },
    { id: "sermorelin", name: "Sermorelin", cat: "Peptides" },
    { id: "cjc-ipamorelin", name: "CJC-1295/Ipamorelin", cat: "Peptides" },
    { id: "wolverine", name: "Wolverine Blend", cat: "Blends" },
    { id: "glo", name: "GLO Blend", cat: "Blends" },
    { id: "klow", name: "KLOW Blend", cat: "Blends" },
  ];
