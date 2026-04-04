// Product recommendation page — shown after intake, before checkout
// Matches Sana Direct design: featured card + alternative options

import { PartnerConfig, ServiceConfig } from "../lib/types";
import { ServiceDefinition } from "../lib/services";

export function generateRecommendationHTML(
  service: ServiceDefinition,
  partner: PartnerConfig,
  serviceConfig: ServiceConfig,
  baseUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${partner.businessName} - Your Recommendation</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(partner.font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${partner.brandColors.primary};
      --primary-light: ${partner.brandColors.primary}10;
      --secondary: ${partner.brandColors.secondary};
      --font: '${partner.font}', system-ui, -apple-system, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: #fff; color: #1a1a2e; }

    .container { max-width: 650px; margin: 0 auto; padding: 24px; }

    .header {
      display: flex; align-items: center; justify-content: center;
      position: relative; padding: 16px 0; margin-bottom: 24px;
    }
    .header img { max-height: 40px; max-width: 180px; }
    .back-btn {
      position: absolute; left: 0; display: flex; align-items: center; gap: 4px;
      color: #333; text-decoration: none; font-size: 14px; cursor: pointer;
      border: none; background: none; font-family: var(--font);
    }

    h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { font-size: 15px; color: #666; margin-bottom: 24px; }

    /* Featured card */
    .featured-card {
      border: 2px solid var(--primary);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    .featured-badge {
      display: flex; justify-content: space-between; align-items: center;
      background: var(--primary); color: #fff; padding: 10px 20px;
      font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .featured-badge .best-value {
      background: #fff; color: var(--primary); padding: 3px 10px;
      border-radius: 4px; font-size: 12px;
    }
    .featured-body { padding: 24px; }
    .featured-product {
      display: flex; align-items: center; gap: 16px; margin-bottom: 16px;
    }
    .featured-product img { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
    .featured-product h3 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
    .featured-product p { font-size: 13px; color: #888; }

    .benefits { list-style: none; margin-bottom: 20px; }
    .benefits li {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; color: #555; padding: 4px 0;
    }
    .benefits li::before {
      content: '✓'; display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; background: var(--primary-light);
      color: var(--primary); border-radius: 50%; font-size: 12px; font-weight: 700;
    }

    .pricing { margin-bottom: 16px; }
    .pricing .old-price {
      font-size: 15px; color: #999; text-decoration: line-through; margin-right: 8px;
    }
    .pricing .current-price { font-size: 32px; font-weight: 700; color: #1a1a2e; }
    .pricing .per-month { font-size: 16px; color: #666; }
    .pricing .shipping { font-size: 13px; color: #888; margin-top: 4px; }

    .guarantee {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; background: #f8f9fa; border-radius: 8px;
      font-size: 14px; color: #555; margin-bottom: 20px;
    }
    .guarantee svg { width: 24px; min-width: 24px; color: var(--primary); }

    .btn-checkout {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 16px; background: var(--primary); color: #fff;
      border: none; border-radius: 10px; font-size: 16px; font-weight: 600;
      font-family: var(--font); cursor: pointer; transition: opacity 0.15s;
    }
    .btn-checkout:hover { opacity: 0.9; }

    /* Other options */
    .other-options { text-align: center; margin-bottom: 16px; }
    .other-options h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .other-options p { font-size: 13px; color: #888; }

    .alt-card {
      display: flex; align-items: center; gap: 16px;
      padding: 16px 20px; border: 1.5px solid #e0e0e0; border-radius: 10px;
      margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s;
    }
    .alt-card:hover { border-color: var(--primary); }
    .alt-card img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; }
    .alt-card .alt-info { flex: 1; }
    .alt-card .alt-info h4 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .alt-card .alt-info p { font-size: 12px; color: #888; }
    .alt-card .alt-price { text-align: right; }
    .alt-card .alt-price .price { font-size: 18px; font-weight: 700; }
    .alt-card .alt-price .per { font-size: 12px; color: #888; }
    .alt-card .alt-price .was { font-size: 12px; color: #999; text-decoration: line-through; }

    .disclaimer {
      font-size: 11px; color: #bbb; line-height: 1.6; margin-top: 24px;
      padding-top: 16px; border-top: 1px solid #f0f0f0;
    }

    .footer { text-align: center; padding: 24px 0; font-size: 12px; color: #bbb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <button class="back-btn" onclick="history.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
      <img src="${partner.logoUrl}" alt="${partner.businessName}" onerror="this.style.display='none'">
    </div>

    <h1>Here's what we recommend</h1>
    <p class="subtitle">Choose your preferred medication.</p>

    <div class="featured-card">
      <div class="featured-badge">
        <span>OUR RECOMMENDATION</span>
        <span class="best-value">BEST VALUE</span>
      </div>
      <div class="featured-body">
        <div class="featured-product">
          <div>
            <h3>${service.label}</h3>
            <p>Personalized Compounded Medication</p>
          </div>
        </div>

        <ul class="benefits" id="benefits"></ul>

        <div class="pricing">
          <span class="current-price">$${serviceConfig.subscriptionPrice}</span>
          <span class="per-month">/mo</span>
          <div class="shipping">Free Shipping &bull; Cancel anytime</div>
        </div>

        <div class="guarantee">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
          <div><strong>100% Success Guarantee</strong><br>Get results or get your money back</div>
        </div>

        <button class="btn-checkout" onclick="goToCheckout('${service.id}')">
          Continue to checkout
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>

    <div id="otherOptions"></div>

    <div class="disclaimer">
      ${partner.businessName} offers medications exclusively from U.S. pharmacies. Compounded medications are highly regulated
      and compounding pharmacies are licensed and inspected by Boards of Pharmacy, but the FDA has not evaluated
      the medications for safety, quality, or efficacy. Medications are prescription drugs that should be taken and
      monitored under the supervision of a licensed health care professional.
    </div>

    <div class="footer">&copy; ${new Date().getFullYear()} ${partner.businessName}. All rights reserved.</div>
  </div>

  <script>
    const SERVICE_ID = "${service.id}";
    const PARTNER_SLUG = "${partner.slug}";
    const BASE_URL = "${baseUrl}";
    const SERVICES = ${JSON.stringify(
      partner.services.map((s) => ({
        type: s.type,
        initialPrice: s.initialPrice,
        subscriptionPrice: s.subscriptionPrice,
      }))
    )};

    // Build benefits based on service category
    const benefitMap = {
      'weight-loss': ['Clinically studied results', 'Weekly injection', 'Provider oversight and support'],
      'ed': ['Fast-acting relief', 'Discreet shipping', 'Provider oversight and support'],
      'hrt-male': ['Personalized dosing', 'Ongoing monitoring', 'Provider oversight and support'],
      'hrt-female': ['Symptom relief', 'Personalized treatment', 'Provider oversight and support'],
      'peptide': ['Research-backed peptide', 'Compounded in US pharmacy', 'Provider oversight and support'],
      'blend': ['Synergistic formula', 'Compounded in US pharmacy', 'Provider oversight and support'],
    };

    const category = "${service.category}";
    const benefitsEl = document.getElementById('benefits');
    (benefitMap[category] || benefitMap['peptide']).forEach(b => {
      benefitsEl.innerHTML += '<li>' + b + '</li>';
    });

    // Build other options from partner's other services in same category
    const otherContainer = document.getElementById('otherOptions');
    const otherServices = SERVICES.filter(s => s.type !== SERVICE_ID);
    if (otherServices.length > 0) {
      let html = '<div class="other-options"><h3>Other Available Options</h3><p>Click on any medication to see more details</p></div>';
      otherServices.forEach(s => {
        const label = s.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        html += '<div class="alt-card" onclick="goToCheckout(\\'' + s.type + '\\')">' +
          '<div class="alt-info"><h4>' + label + '</h4><p>Personalized Compounded Medication</p></div>' +
          '<div class="alt-price"><span class="price">$' + s.subscriptionPrice + '</span><span class="per">/mo</span></div>' +
          '</div>';
      });
      otherContainer.innerHTML = html;
    }

    function goToCheckout(serviceType) {
      window.location.href = BASE_URL + '/form/' + PARTNER_SLUG + '/' + serviceType + '/checkout';
    }
  </script>
</body>
</html>`;
}
