// Partner pricing form — shows pharmacy costs + $5 MOH fee, lets partner set their margin

const PHARMACY_COSTS: Record<string, { product: string; cost: number }> = {
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

const SERVICE_LIST = [
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

export function generatePartnerPricingForm(slug: string): string {
  // Group by category
  const categories: Record<string, typeof SERVICE_LIST> = {};
  SERVICE_LIST.forEach((s) => {
    if (!categories[s.cat]) categories[s.cat] = [];
    categories[s.cat].push(s);
  });

  let serviceRows = "";
  for (const [cat, items] of Object.entries(categories)) {
    serviceRows +=
      '<div class="category"><div class="category-title">' + cat + "</div>";
    for (const s of items) {
      const pc = PHARMACY_COSTS[s.id];
      const mohBase = pc ? (pc.cost + 5).toFixed(2) : "0";
      const pcDisplay = pc ? "$" + pc.cost.toFixed(2) : "$0.00";
      const productLabel = pc ? pc.product : "TBD";
      serviceRows +=
        '<div class="service-row" data-service="' +
        s.id +
        '">' +
        '<div class="row-header">' +
        '<div class="service-name">' +
        s.name +
        "</div>" +
        '<div class="pharmacy-info">Pharmacy: <strong>' +
        pcDisplay +
        '</strong>/mo — <span class="product-label">' +
        productLabel +
        "</span></div>" +
        '<div class="moh-base">MOH base (cost + $5): <strong>$' +
        mohBase +
        "</strong></div>" +
        "</div>" +
        '<div class="fields">' +
        '<div class="field"><label>Your Price to Patient ($/mo)</label>' +
        '<input type="number" class="patient-price" placeholder="' +
        mohBase +
        '" step="0.01" min="' +
        mohBase +
        '" value=""></div>' +
        '<div><span class="calc-label">Your Margin</span><div class="calculated" data-calc>—</div></div>' +
        "</div></div>";
    }
    serviceRows += "</div>";
  }

  const pharmacyCostsJson = JSON.stringify(PHARMACY_COSTS);

  return (
    "<!DOCTYPE html>" +
    '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<title>Set Your Pricing</title>" +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    "<style>" +
    "* { margin: 0; padding: 0; box-sizing: border-box; }" +
    "body { font-family: 'Inter', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; }" +
    ".container { max-width: 700px; margin: 0 auto; padding: 48px 24px; }" +
    "h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }" +
    ".subtitle { color: #666; font-size: 14px; margin-bottom: 32px; line-height: 1.5; }" +
    ".info-box { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 16px; margin-bottom: 32px; font-size: 13px; color: #4338CA; line-height: 1.6; }" +
    ".category { margin-bottom: 28px; }" +
    ".category-title { font-size: 13px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }" +
    ".service-row { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px; margin-bottom: 10px; }" +
    ".service-name { font-size: 15px; font-weight: 600; margin-bottom: 4px; }" +
    ".pharmacy-info { font-size: 12px; color: #666; margin-bottom: 2px; }" +
    ".product-label { color: #999; }" +
    ".moh-base { font-size: 12px; color: #4F46E5; margin-bottom: 12px; }" +
    ".fields { display: flex; gap: 16px; align-items: flex-end; }" +
    ".field { flex: 1; }" +
    ".field label { display: block; font-size: 12px; font-weight: 500; color: #666; margin-bottom: 4px; }" +
    ".field input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; }" +
    ".field input:focus { outline: none; border-color: #4F46E5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }" +
    ".calculated { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-weight: 600; color: #16a34a; text-align: center; min-width: 120px; }" +
    ".calculated.negative { background: #fef2f2; border-color: #fecaca; color: #dc2626; }" +
    ".calc-label { font-size: 12px; font-weight: 500; color: #666; margin-bottom: 4px; display: block; }" +
    ".btn { display: block; width: 100%; padding: 16px; background: #4F46E5; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit; margin-top: 32px; }" +
    ".btn:hover { background: #4338CA; }" +
    ".btn:disabled { background: #a5a5a5; cursor: not-allowed; }" +
    ".success { display: none; text-align: center; padding: 60px 20px; }" +
    ".success h2 { font-size: 24px; color: #22c55e; margin-bottom: 12px; }" +
    ".success p { color: #666; font-size: 16px; }" +
    "@media (max-width: 480px) { .fields { flex-direction: column; } }" +
    '</style></head><body><div class="container"><div id="formSection">' +
    "<h1>Set Your Pricing</h1>" +
    '<p class="subtitle">For each service, set the monthly price your patients will pay. The pharmacy cost and MOH base price (pharmacy + $5) are shown for reference.</p>' +
    '<div class="info-box"><strong>How it works:</strong> The pharmacy cost is what we pay the pharmacy. MOH adds a $5 platform fee. You set your price to the patient — anything above the MOH base is your margin.</div>' +
    serviceRows +
    '<button class="btn" onclick="submitPricing()">Submit Pricing</button></div>' +
    '<div class="success" id="successSection"><h2>Pricing Submitted!</h2><p>Your prices have been saved. We will apply them to the system shortly.</p></div></div>' +
    "<script>" +
    "var pharmacyCosts = " +
    pharmacyCostsJson +
    ";" +
    'document.querySelectorAll(".service-row").forEach(function(row) {' +
    '  var priceInput = row.querySelector(".patient-price");' +
    '  var calcEl = row.querySelector("[data-calc]");' +
    "  var serviceId = row.dataset.service;" +
    "  var pc = pharmacyCosts[serviceId];" +
    "  var mohBase = pc ? pc.cost + 5 : 0;" +
    '  priceInput.addEventListener("input", function() {' +
    "    var price = parseFloat(priceInput.value) || 0;" +
    "    if (price > 0) {" +
    "      var margin = (price - mohBase).toFixed(2);" +
    '      calcEl.textContent = (margin >= 0 ? "+" : "") + "$" + margin;' +
    '      calcEl.classList.toggle("negative", margin < 0);' +
    '    } else { calcEl.textContent = "—"; calcEl.classList.remove("negative"); }' +
    "  });" +
    "});" +
    "function submitPricing() {" +
    "  var services = [];" +
    '  document.querySelectorAll(".service-row").forEach(function(row) {' +
    '    var price = parseFloat(row.querySelector(".patient-price").value) || 0;' +
    "    var serviceId = row.dataset.service;" +
    "    var pc = pharmacyCosts[serviceId];" +
    "    if (price > 0) {" +
    "      services.push({ serviceId: serviceId, patientPrice: price, pharmacyCost: pc ? pc.cost : 0, mohBase: pc ? pc.cost + 5 : 0, margin: +(price - (pc ? pc.cost + 5 : 0)).toFixed(2) });" +
    "    }" +
    "  });" +
    '  if (services.length === 0) { alert("Please set at least one price."); return; }' +
    '  var btn = document.querySelector(".btn");' +
    '  btn.textContent = "Submitting..."; btn.disabled = true;' +
    '  fetch("/onboard/pricing/' +
    slug +
    '", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ services: services }) })' +
    '  .then(function(res) { if (res.ok) { document.getElementById("formSection").style.display = "none"; document.getElementById("successSection").style.display = "block"; } else { alert("Something went wrong."); btn.textContent = "Submit Pricing"; btn.disabled = false; } })' +
    '  .catch(function() { alert("Something went wrong."); btn.textContent = "Submit Pricing"; btn.disabled = false; });' +
    "}" +
    "</script></body></html>"
  );
}
