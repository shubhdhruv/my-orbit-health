// Partner self-service catalog edit page.
//
// Lets partners toggle products on/off and set their own subscription
// prices. Styling mirrors src/worker/partner-dashboard.ts renderDashboard.
// Spec: docs/partner-self-service-catalog.md

import { PartnerConfig } from "../lib/types";
import { CatalogRow } from "../lib/partner-catalog";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFontName(font: string | undefined): string {
  const cleaned = (font || "").replace(/[^A-Za-z0-9 ]/g, "").trim();
  return cleaned || "Inter";
}

export function renderCatalogPage(
  partner: PartnerConfig,
  rows: CatalogRow[],
): string {
  const primary = partner.brandColors.primary || "#0B1F3A";
  const font = safeFontName(partner.font);
  const name = esc(partner.businessName);

  // Client needs the row list to render from JSON. Safely embed it.
  const initialRowsJson = JSON.stringify(rows).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${name} \u2014 Products & Pricing</title>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --p: ${primary}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'${font}',system-ui,sans-serif; background:#f4f5f7; color:#1e293b; -webkit-font-smoothing:antialiased; }

  .topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 32px; height:56px; display:flex; align-items:center; justify-content:space-between; }
  .topbar-left { display:flex; align-items:center; gap:12px; }
  .topbar-left img { height:28px; }
  .topbar-left .sep { font-size:13px; color:#94a3b8; padding-left:12px; border-left:1px solid #e2e8f0; }
  .nav-tabs { display:flex; gap:4px; margin-left:24px; }
  .nav-tab { font-size:13px; color:#64748b; text-decoration:none; padding:8px 14px; border-radius:8px; font-weight:500; }
  .nav-tab:hover { color:#0f172a; background:#f1f5f9; }
  .nav-tab.active { color:var(--p); background:${primary}14; font-weight:600; }
  .topbar a.signout { font-size:13px; color:#64748b; text-decoration:none; }
  .topbar a.signout:hover { color:#0f172a; }

  .page { max-width:1080px; margin:0 auto; padding:28px 32px 120px; }
  h1 { font-size:24px; font-weight:700; letter-spacing:-0.02em; margin-bottom:6px; }
  .intro { font-size:14px; color:#64748b; line-height:1.55; margin-bottom:24px; max-width:680px; }

  .category { background:#fff; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:16px; overflow:hidden; }
  .category-head { padding:14px 24px; border-bottom:1px solid #f1f5f9; font-size:13px; font-weight:600; color:#0f172a; text-transform:uppercase; letter-spacing:0.04em; background:#f8fafc; }

  .row { display:grid; grid-template-columns:28px 1fr 110px 140px 120px; gap:16px; align-items:center; padding:16px 24px; border-top:1px solid #f1f5f9; }
  .row:first-of-type { border-top:none; }
  .row.disabled .name, .row.disabled .meta, .row.disabled .margin-val { opacity:0.45; }

  .toggle { display:flex; align-items:center; justify-content:center; }
  .toggle input { width:18px; height:18px; accent-color:var(--p); cursor:pointer; }

  .name { font-size:14px; font-weight:600; color:#0f172a; }
  .sub { font-size:12px; color:#94a3b8; margin-top:2px; }

  .meta { font-size:12px; color:#64748b; text-align:right; line-height:1.45; }
  .meta .num { font-weight:600; color:#334155; font-size:13px; }

  .price-wrap { position:relative; }
  .price-input { width:100%; padding:10px 12px 10px 26px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; font-family:inherit; outline:none; transition:border 0.15s, background 0.15s; background:#fff; }
  .price-input:focus { border-color:var(--p); }
  .price-input.err { border-color:#dc2626; background:#fef2f2; }
  .price-input:disabled { background:#f8fafc; color:#94a3b8; cursor:not-allowed; }
  .price-sym { position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:14px; color:#94a3b8; pointer-events:none; font-weight:500; }
  .floor-hint { font-size:11px; color:#94a3b8; margin-top:4px; }
  .floor-hint.err { color:#dc2626; font-weight:500; }

  .margin-val { font-size:13px; font-weight:600; color:#059669; text-align:right; }
  .margin-val.warn { color:#ca8a04; }

  .col-head { display:grid; grid-template-columns:28px 1fr 110px 140px 120px; gap:16px; padding:0 24px 10px 24px; font-size:11px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; }
  .col-head .txt-right { text-align:right; }

  .save-bar { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid #e2e8f0; padding:16px 32px; display:flex; align-items:center; justify-content:flex-end; gap:16px; box-shadow:0 -2px 8px rgba(0,0,0,0.04); }
  .save-bar .status { font-size:13px; color:#64748b; }
  .save-bar .status.ok { color:#059669; font-weight:500; }
  .save-bar .status.err { color:#dc2626; font-weight:500; }
  .btn { padding:11px 22px; border-radius:9px; font-weight:600; font-size:14px; border:none; cursor:pointer; font-family:inherit; transition:opacity 0.15s; }
  .btn-primary { background:var(--p); color:#fff; }
  .btn-primary:hover { opacity:0.92; }
  .btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
  .btn-secondary { background:#e2e8f0; color:#334155; }
  .btn-secondary:hover { background:#cbd5e1; }

  .modal-bg { position:fixed; inset:0; background:rgba(15,23,42,0.55); display:none; align-items:center; justify-content:center; z-index:100; padding:20px; }
  .modal-bg.open { display:flex; }
  .modal { background:#fff; border-radius:14px; max-width:480px; width:100%; padding:28px; box-shadow:0 10px 40px rgba(0,0,0,0.2); }
  .modal h2 { font-size:18px; font-weight:700; margin-bottom:10px; }
  .modal p { font-size:14px; color:#475569; line-height:1.55; margin-bottom:16px; }
  .modal ul { list-style:none; margin:0 0 20px 0; padding:0; }
  .modal li { font-size:14px; padding:10px 14px; background:#fef3c7; border-radius:8px; margin-bottom:6px; color:#78350f; }
  .modal li strong { color:#431407; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; }

  @media(max-width:720px) {
    .row, .col-head { grid-template-columns:24px 1fr 120px; gap:10px; padding-left:16px; padding-right:16px; }
    .row .meta, .col-head .col-meta, .row .margin-val, .col-head .col-margin { display:none; }
    .page { padding:20px 16px 140px; }
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    ${partner.logoUrl ? `<img src="${esc(partner.logoUrl)}" alt="${name}" onerror="this.style.display='none'">` : `<strong>${name}</strong>`}
    <span class="sep">Partner Portal</span>
    <div class="nav-tabs">
      <a class="nav-tab" href="/partner/dashboard">Dashboard</a>
      <a class="nav-tab active" href="/partner/catalog">Products &amp; Pricing</a>
    </div>
  </div>
  <a class="signout" href="/partner/logout">Sign out</a>
</div>

<div class="page">
  <h1>Products &amp; Pricing</h1>
  <p class="intro">Choose which products you offer and set your monthly subscription price. Changes apply to new patients only &mdash; existing subscribers keep their current price. The minimum price covers the pharmacy cost plus the MOH platform fee and a $1 minimum partner margin.</p>

  <div id="catalog"></div>
</div>

<div class="save-bar">
  <span id="status" class="status"></span>
  <button id="saveBtn" class="btn btn-primary">Save changes</button>
</div>

<div id="confirmModal" class="modal-bg" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
  <div class="modal">
    <h2 id="confirmTitle">Confirm disabling products</h2>
    <p>These products have active subscribers. Existing patients will continue to receive refills at their current price. New patients will not see these products.</p>
    <ul id="confirmList"></ul>
    <div class="modal-actions">
      <button id="confirmCancel" class="btn btn-secondary" type="button">Cancel</button>
      <button id="confirmOk" class="btn btn-primary" type="button">Confirm &amp; save</button>
    </div>
  </div>
</div>

<script>
(function(){
  var INITIAL_ROWS = ${initialRowsJson};
  var rowsByType = {};
  var pendingConfirm = [];

  function money(n){ return '$' + n.toFixed(2); }

  function computeMargin(row, priceStr){
    var price = parseFloat(priceStr);
    if (!isFinite(price)) return null;
    return price - row.platformFee;
  }

  function renderRows(rows){
    rowsByType = {};
    var byCat = {};
    var catOrder = [];
    rows.forEach(function(r){
      rowsByType[r.type] = r;
      if (!byCat[r.category]){ byCat[r.category] = []; catOrder.push(r.category); }
      byCat[r.category].push(r);
    });

    var html = '';
    catOrder.forEach(function(cat){
      html += '<div class="category">';
      html += '<div class="category-head">' + escHtml(cat) + '</div>';
      html += '<div class="col-head">';
      html += '<span></span><span>Product</span>';
      html += '<span class="txt-right col-meta">Pharmacy cost</span>';
      html += '<span class="txt-right">Your monthly price</span>';
      html += '<span class="txt-right col-margin">Your margin</span>';
      html += '</div>';
      byCat[cat].forEach(function(r){
        html += rowHtml(r);
      });
      html += '</div>';
    });
    document.getElementById('catalog').innerHTML = html;

    rows.forEach(function(r){
      wireRow(r.type);
    });
  }

  function rowHtml(r){
    var price = (typeof r.subscriptionPrice === 'number' && r.subscriptionPrice > 0) ? r.subscriptionPrice : r.floor;
    var margin = price - r.platformFee;
    var marginClass = margin < 5 ? 'warn' : '';
    var disabledCls = r.enabled ? '' : ' disabled';
    return (
      '<div class="row' + disabledCls + '" data-type="' + escAttr(r.type) + '">' +
        '<div class="toggle"><input type="checkbox" data-role="enabled"' + (r.enabled ? ' checked' : '') + ' aria-label="Offer ' + escAttr(r.name) + '"></div>' +
        '<div><div class="name">' + escHtml(r.name) + '</div><div class="sub">MOH fee ' + money(r.platformFee) + '</div></div>' +
        '<div class="meta"><div class="num">' + money(r.cost) + '</div></div>' +
        '<div class="price-wrap">' +
          '<span class="price-sym">$</span>' +
          '<input type="number" step="0.01" min="0" class="price-input" data-role="price" value="' + price.toFixed(2) + '"' + (r.enabled ? '' : ' disabled') + '>' +
          '<div class="floor-hint" data-role="floor">Minimum ' + money(r.floor) + '</div>' +
        '</div>' +
        '<div class="margin-val ' + marginClass + '" data-role="margin">' + money(margin) + '</div>' +
      '</div>'
    );
  }

  function wireRow(type){
    var rowEl = document.querySelector('.row[data-type="' + cssEscape(type) + '"]');
    if (!rowEl) return;
    var enabled = rowEl.querySelector('[data-role="enabled"]');
    var price = rowEl.querySelector('[data-role="price"]');
    var marginEl = rowEl.querySelector('[data-role="margin"]');
    var floorEl = rowEl.querySelector('[data-role="floor"]');

    enabled.addEventListener('change', function(){
      if (enabled.checked){
        rowEl.classList.remove('disabled');
        price.disabled = false;
      } else {
        rowEl.classList.add('disabled');
        price.disabled = true;
        price.classList.remove('err');
        floorEl.classList.remove('err');
        floorEl.textContent = 'Minimum ' + money(rowsByType[type].floor);
      }
    });

    price.addEventListener('input', function(){
      price.classList.remove('err');
      floorEl.classList.remove('err');
      floorEl.textContent = 'Minimum ' + money(rowsByType[type].floor);
      var m = computeMargin(rowsByType[type], price.value);
      if (m === null){ marginEl.textContent = '\u2014'; marginEl.className = 'margin-val'; return; }
      marginEl.textContent = money(m);
      marginEl.className = 'margin-val' + (m < 5 ? ' warn' : '');
    });
  }

  function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s){ return escHtml(s).replace(/"/g,'&quot;'); }
  function cssEscape(s){ return String(s).replace(/[^a-zA-Z0-9_-]/g, function(ch){ return '\\\\' + ch; }); }

  function collectPayload(){
    var out = [];
    document.querySelectorAll('.row').forEach(function(rowEl){
      var type = rowEl.getAttribute('data-type');
      var enabled = rowEl.querySelector('[data-role="enabled"]').checked;
      var priceVal = parseFloat(rowEl.querySelector('[data-role="price"]').value);
      out.push({ type: type, enabled: enabled, subscriptionPrice: isFinite(priceVal) ? priceVal : 0 });
    });
    return out;
  }

  function setStatus(msg, kind){
    var el = document.getElementById('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function clearFieldErrors(){
    document.querySelectorAll('.price-input.err').forEach(function(el){ el.classList.remove('err'); });
    document.querySelectorAll('.floor-hint.err').forEach(function(el){ el.classList.remove('err'); });
  }

  function applyFieldErrors(errors){
    errors.forEach(function(e){
      if (e.kind === 'PRICE_BELOW_FLOOR' || e.kind === 'PRICE_NOT_A_NUMBER'){
        var rowEl = document.querySelector('.row[data-type="' + cssEscape(e.service) + '"]');
        if (!rowEl) return;
        var priceEl = rowEl.querySelector('[data-role="price"]');
        var floorEl = rowEl.querySelector('[data-role="floor"]');
        priceEl.classList.add('err');
        floorEl.classList.add('err');
        if (e.kind === 'PRICE_BELOW_FLOOR'){
          floorEl.textContent = 'Must be at least ' + money(e.floor);
        } else {
          floorEl.textContent = 'Enter a valid price';
        }
      }
    });
  }

  function showConfirmModal(activeList, onConfirm){
    var ul = document.getElementById('confirmList');
    ul.innerHTML = '';
    activeList.forEach(function(a){
      var name = (rowsByType[a.service] && rowsByType[a.service].name) || a.service;
      var li = document.createElement('li');
      li.innerHTML = '<strong>' + escHtml(name) + '</strong> \u2014 ' + a.activeCount + ' active ' + (a.activeCount === 1 ? 'subscriber' : 'subscribers');
      ul.appendChild(li);
    });
    var modal = document.getElementById('confirmModal');
    modal.classList.add('open');
    var ok = document.getElementById('confirmOk');
    var cancel = document.getElementById('confirmCancel');
    function cleanup(){ modal.classList.remove('open'); ok.removeEventListener('click', okHandler); cancel.removeEventListener('click', cancelHandler); }
    function okHandler(){ cleanup(); onConfirm(activeList.map(function(a){ return a.service; })); }
    function cancelHandler(){ cleanup(); setStatus('Save cancelled', ''); document.getElementById('saveBtn').disabled = false; }
    ok.addEventListener('click', okHandler);
    cancel.addEventListener('click', cancelHandler);
  }

  function save(confirmList){
    clearFieldErrors();
    setStatus('Saving\u2026', '');
    var btn = document.getElementById('saveBtn');
    btn.disabled = true;
    var payload = { services: collectPayload() };
    if (confirmList && confirmList.length) payload.confirmDisableWithActiveSubs = confirmList;

    fetch('/partner/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res){
      return res.json().then(function(data){ return { status: res.status, data: data }; });
    }).then(function(r){
      if (r.status === 200){
        setStatus('Saved', 'ok');
        btn.disabled = false;
        // Refresh rows from server so UI reflects persisted state
        return fetch('/partner/api/catalog').then(function(res){ return res.json(); }).then(function(j){
          if (j && j.rows) renderRows(j.rows);
        });
      }
      var errors = (r.data && r.data.errors) || [];
      var activeSubsErrors = errors.filter(function(e){ return e.kind === 'ACTIVE_SUBS_REQUIRE_CONFIRMATION'; });
      var otherErrors = errors.filter(function(e){ return e.kind !== 'ACTIVE_SUBS_REQUIRE_CONFIRMATION'; });

      if (otherErrors.length){
        applyFieldErrors(otherErrors);
        setStatus('Please fix the highlighted fields', 'err');
        btn.disabled = false;
        return;
      }
      if (r.status === 409 && activeSubsErrors.length){
        setStatus('', '');
        showConfirmModal(activeSubsErrors, function(confirmed){
          save(confirmed);
        });
        return;
      }
      setStatus((r.data && r.data.error) || 'Save failed', 'err');
      btn.disabled = false;
    }).catch(function(){
      setStatus('Network error', 'err');
      btn.disabled = false;
    });
  }

  document.getElementById('saveBtn').addEventListener('click', function(){ save(null); });

  renderRows(INITIAL_ROWS);
})();
</script>
</body>
</html>`;
}
