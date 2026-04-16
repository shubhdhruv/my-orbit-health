// Product recommendation page — shown after intake, before checkout
// Matches Sana Direct design: featured card + alternative options

import { PartnerConfig, ServiceConfig } from "../lib/types";
import { ServiceDefinition } from "../lib/services";

export function generateRecommendationHTML(
  service: ServiceDefinition,
  partner: PartnerConfig,
  serviceConfig: ServiceConfig,
  baseUrl: string,
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

    /* Add-on options */
    .addons-header { text-align: center; margin-bottom: 16px; }
    .addons-header h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .addons-header p { font-size: 13px; color: #888; }

    .alt-card {
      display: flex; align-items: center; gap: 16px;
      padding: 16px 20px; border: 1.5px solid #e0e0e0; border-radius: 10px;
      margin-bottom: 10px; cursor: pointer; transition: all 0.15s;
    }
    .alt-card:hover { border-color: var(--primary); }
    .alt-card.selected { border-color: var(--primary); background: var(--primary-light); }
    .alt-card .addon-check {
      width: 24px; height: 24px; min-width: 24px; border: 2px solid #ccc;
      border-radius: 6px; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .alt-card.selected .addon-check {
      background: var(--primary); border-color: var(--primary);
    }
    .alt-card .alt-info { flex: 1; }
    .alt-card .alt-info h4 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .alt-card .alt-info p { font-size: 12px; color: #888; }
    .alt-card .alt-price { text-align: right; }
    .alt-card .alt-price .price { font-size: 18px; font-weight: 700; }
    .alt-card .alt-price .per { font-size: 12px; color: #888; }

    /* Primary toggle */
    .featured-toggle {
      display: flex; align-items: center; gap: 8px; margin-top: 16px;
      padding-top: 16px; border-top: 1px solid #eee; font-size: 14px; color: #555;
    }
    .featured-toggle input { width: 18px; height: 18px; accent-color: var(--primary); cursor: pointer; }
    .featured-card.excluded { border-color: #e0e0e0; opacity: 0.5; }
    .featured-card.excluded .featured-badge { background: #999; }

    /* Support section */
    .support-section {
      background: var(--primary-light); border-radius: 14px; padding: 28px 24px;
      margin-bottom: 24px;
    }
    .support-section h2 {
      font-size: 20px; font-weight: 600; color: var(--primary);
      line-height: 1.4; margin-bottom: 20px;
    }
    .support-item {
      display: flex; align-items: center; gap: 12px;
      font-size: 15px; color: #333; padding: 8px 0;
    }
    .support-icon {
      width: 36px; height: 36px; min-width: 36px; border-radius: 50%;
      background: #fff; display: flex; align-items: center; justify-content: center;
    }
    .support-icon svg { width: 18px; height: 18px; color: var(--primary); }

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

        <div class="featured-toggle">
          <input type="checkbox" id="includePrimary" checked onchange="togglePrimary()">
          <label for="includePrimary">Include in your order</label>
        </div>

        <button class="btn-checkout" id="checkoutBtn" onclick="goToCheckout()">
          Continue to checkout
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>

    <div id="otherOptions"></div>

    <!-- Support section -->
    <div class="support-section">
      <h2>You won't have to do it alone. We're here to help.</h2>
      <div class="support-item">
        <div class="support-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <span>Unlimited messaging with a medical provider</span>
      </div>
      <div class="support-item">
        <div class="support-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <span>Regular check-ins</span>
      </div>
      <div class="support-item">
        <div class="support-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>
        <span>Adjustments as needed</span>
      </div>
    </div>

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
      })),
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

    // Mutual-exclusion groups: only one service per group allowed.
    // e.g., a patient should only be on one GLP-1 at a time.
    const EXCLUSIVE_GROUPS = [
      ['semaglutide', 'tirzepatide', 'retatrutide'],
    ];

    function getExclusiveGroup(serviceType) {
      return EXCLUSIVE_GROUPS.find(g => g.includes(serviceType));
    }

    // Build add-on options from partner's other services
    const otherContainer = document.getElementById('otherOptions');
    const otherServices = SERVICES.filter(s => s.type !== SERVICE_ID);
    if (otherServices.length > 0) {
      const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      let html = '<div class="addons-header"><h3>Add to Your Order</h3><p>Select additional treatments to include in your checkout</p></div>';
      otherServices.forEach(s => {
        const label = s.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        html += '<div class="alt-card" data-type="' + s.type + '" data-price="' + s.subscriptionPrice + '" data-label="' + label + '" onclick="toggleAddon(this)">' +
          '<div class="addon-check">' + checkSvg + '</div>' +
          '<div class="alt-info"><h4>' + label + '</h4><p>Compounded Medication</p></div>' +
          '<div class="alt-price"><span class="price">$' + s.subscriptionPrice + '</span><span class="per">/mo</span></div>' +
          '</div>';
      });
      otherContainer.innerHTML = html;
    }

    // Pre-select add-ons from quiz multi-select (passed via ?addons=type1,type2 URL param)
    (function preSelectFromQuiz() {
      var params = new URLSearchParams(window.location.search);
      var addonsParam = params.get('addons');
      if (!addonsParam) return;
      addonsParam.split(',').forEach(function(type) {
        var card = document.querySelector('.alt-card[data-type="' + type.trim() + '"]');
        if (card) card.classList.add('selected');
      });
      updateCheckoutButton();
    })();

    function toggleAddon(el) {
      if (el.classList.contains('disabled')) return;
      el.classList.toggle('selected');
      enforceExclusiveGroups();
      updateCheckoutButton();
    }

    // When a service is selected (primary or add-on), disable other
    // services in the same exclusive group so only one can be chosen.
    function enforceExclusiveGroups() {
      // Collect all selected service types (primary + add-ons)
      var selected = [];
      var primaryIncluded = document.getElementById('includePrimary').checked;
      if (primaryIncluded) selected.push(SERVICE_ID);
      document.querySelectorAll('.alt-card.selected').forEach(function(c) {
        selected.push(c.dataset.type);
      });

      // For each add-on card, check if it conflicts with a selected service
      document.querySelectorAll('.alt-card').forEach(function(card) {
        var type = card.dataset.type;
        if (card.classList.contains('selected')) return; // Don't disable selected cards
        var group = getExclusiveGroup(type);
        if (group && selected.some(function(s) { return s !== type && group.includes(s); })) {
          card.classList.add('disabled');
          card.style.opacity = '0.4';
          card.style.pointerEvents = 'none';
          card.title = 'Cannot combine with ' + selected.find(function(s) { return group.includes(s); });
        } else {
          card.classList.remove('disabled');
          card.style.opacity = '';
          card.style.pointerEvents = '';
          card.title = '';
        }
      });
    }

    // Run on load to handle primary being a GLP-1
    enforceExclusiveGroups();

    function togglePrimary() {
      var checked = document.getElementById('includePrimary').checked;
      var card = document.querySelector('.featured-card');
      if (checked) { card.classList.remove('excluded'); }
      else { card.classList.add('excluded'); }
      // If primary was re-included and conflicts with a selected add-on,
      // deselect the conflicting add-on.
      if (checked) {
        var group = getExclusiveGroup(SERVICE_ID);
        if (group) {
          document.querySelectorAll('.alt-card.selected').forEach(function(c) {
            if (group.includes(c.dataset.type)) c.classList.remove('selected');
          });
        }
      }
      enforceExclusiveGroups();
      updateCheckoutButton();
    }

    function updateCheckoutButton() {
      var addonCount = document.querySelectorAll('.alt-card.selected').length;
      var primaryIncluded = document.getElementById('includePrimary').checked;
      var total = addonCount + (primaryIncluded ? 1 : 0);
      var btn = document.getElementById('checkoutBtn');
      btn.disabled = total === 0;
      btn.textContent = total > 1
        ? 'Continue to checkout (' + total + ' items)'
        : total === 1 ? 'Continue to checkout' : 'Select at least one item';
    }

    function goToCheckout() {
      var primaryIncluded = document.getElementById('includePrimary').checked;
      var addons = [];
      document.querySelectorAll('.alt-card.selected').forEach(function(card) {
        addons.push({
          type: card.dataset.type,
          label: card.dataset.label,
          subscriptionPrice: parseInt(card.dataset.price),
        });
      });
      sessionStorage.setItem('selectedAddons', JSON.stringify(addons));
      sessionStorage.setItem('includePrimary', JSON.stringify(primaryIncluded));
      // Forward quiz contact info to checkout for auto-population
      var params = new URLSearchParams(window.location.search);
      var fwd = [];
      ['fn', 'ln', 'em'].forEach(function(k) {
        var v = params.get(k);
        if (v) fwd.push(k + '=' + encodeURIComponent(v));
      });
      var checkoutUrl = BASE_URL + '/form/' + PARTNER_SLUG + '/' + SERVICE_ID + '/checkout';
      if (fwd.length) checkoutUrl += '?' + fwd.join('&');
      window.location.href = checkoutUrl;
    }
  </script>
</body>
</html>`;
}
