// Generates the complete intake form HTML from a ServiceDefinition + PartnerConfig
// One-question-per-screen pattern matching Sana Direct design

import { PartnerConfig, ServiceId } from "../lib/types";
import { ServiceDefinition, FormStep } from "../lib/services";

export function generateIntakeFormHTML(
  service: ServiceDefinition,
  partner: PartnerConfig,
  stripePublishableKey: string,
  baseUrl: string,
): string {
  // Filter out conditional steps that will be shown/hidden by JS
  const kitPrice = partner.bloodworkKitPrice ?? 124.99;
  // Deep-clone steps so we can inject partner-specific kit price into labels
  const allSteps: typeof service.intakeSteps = JSON.parse(
    JSON.stringify(service.intakeSteps).replace(
      /\{\{KIT_PRICE\}\}/g,
      `$${kitPrice}`,
    ),
  );
  const totalVisibleSteps = allSteps.filter((s) => !s.conditionalOn).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${partner.businessName} - ${service.label}</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(partner.font)}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${partner.brandColors.primary};
      --primary-light: ${partner.brandColors.primary}15;
      --primary-medium: ${partner.brandColors.primary}30;
      --secondary: ${partner.brandColors.secondary};
      --font: '${partner.font}', system-ui, -apple-system, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font);
      background: #fff;
      color: #1a1a2e;
      min-height: 100vh;
    }

    .container {
      max-width: 650px;
      margin: 0 auto;
      padding: 24px 24px 80px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 16px 0;
      margin-bottom: 12px;
    }
    .header img {
      max-height: 40px;
      max-width: 180px;
    }
    .back-btn {
      position: absolute;
      left: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      color: #333;
      text-decoration: none;
      font-size: 14px;
      cursor: pointer;
      border: none;
      background: none;
      font-family: var(--font);
    }
    .back-btn:hover { color: #000; }
    .back-btn svg { width: 16px; height: 16px; }

    /* Progress bar */
    .progress-bar {
      width: 100%;
      height: 6px;
      background: #e8e8e8;
      border-radius: 3px;
      margin-bottom: 32px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--primary);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* Step content */
    .step {
      display: none;
      flex: 1;
      flex-direction: column;
    }
    .step.active { display: flex; }

    .step h2 {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 6px;
      color: #1a1a2e;
    }
    .step .subtitle {
      font-size: 15px;
      color: #666;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    /* Option cards (radio + checkbox) */
    .option-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border: 1.5px solid #d9d9d9;
      border-radius: 10px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      font-size: 15px;
      line-height: 1.4;
      user-select: none;
    }
    .option-card:hover { border-color: #999; }
    .option-card.selected {
      border-color: var(--primary);
      background: var(--primary);
      color: #fff;
    }
    .option-card input { display: none; }

    .option-indicator {
      width: 22px;
      height: 22px;
      min-width: 22px;
      border: 2px solid #ccc;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .option-card[data-type="checkbox"] .option-indicator {
      border-radius: 4px;
    }
    .option-card.selected .option-indicator {
      border-color: #fff;
      background: #fff;
    }
    .option-card.selected .option-indicator::after {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--primary);
    }
    .option-card.selected[data-type="checkbox"] .option-indicator::after {
      width: 12px;
      height: 7px;
      border-radius: 0;
      background: none;
      border-left: 2.5px solid var(--primary);
      border-bottom: 2.5px solid var(--primary);
      transform: rotate(-45deg);
      margin-bottom: 2px;
    }

    /* Text inputs */
    label.field-label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
      margin-top: 16px;
      color: #333;
    }
    label.field-label:first-child { margin-top: 0; }

    input[type="text"],
    input[type="number"],
    input[type="email"],
    input[type="tel"],
    input[type="date"],
    input[type="url"],
    select,
    textarea {
      width: 100%;
      padding: 14px 16px;
      border: 1.5px solid #d9d9d9;
      border-radius: 10px;
      font-size: 15px;
      font-family: var(--font);
      color: #1a1a2e;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-light);
    }
    textarea {
      resize: vertical;
      min-height: 100px;
    }

    .field-row {
      display: flex;
      gap: 12px;
    }
    .field-row > div { flex: 1; }
    .field-hint {
      font-size: 13px;
      color: #999;
      margin-top: 6px;
    }

    /* BMI Calculator */
    .bmi-result {
      margin-top: 16px;
      display: none;
    }
    .bmi-result.visible { display: block; }
    .bmi-label { font-size: 14px; color: #666; margin-bottom: 8px; }
    .bmi-bar {
      height: 40px;
      border-radius: 8px;
      display: flex;
      overflow: hidden;
      position: relative;
    }
    .bmi-segment {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }
    .bmi-segment.underweight { background: #60a5fa; flex: 18.5; }
    .bmi-segment.normal { background: #34d399; flex: 6.4; }
    .bmi-segment.overweight { background: #fbbf24; flex: 5; }
    .bmi-segment.obese { background: #f97316; flex: 10; }
    .bmi-segment.active-segment {
      position: relative;
    }
    .bmi-segment.active-segment::after {
      content: attr(data-bmi);
      position: absolute;
      font-size: 14px;
    }
    .bmi-categories {
      display: flex;
      margin-top: 6px;
      font-size: 12px;
      color: #888;
    }
    .bmi-categories span { flex: 1; }
    .bmi-value-display {
      text-align: center;
      padding: 10px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 16px;
      color: #fff;
    }

    /* File upload */
    .file-upload-area {
      border: 2px dashed #d9d9d9;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.15s;
    }
    .file-upload-area:hover {
      border-color: var(--primary);
      background: var(--primary-light);
    }
    .file-upload-area.has-file {
      border-color: var(--primary);
      background: var(--primary-light);
    }
    .file-upload-area input { display: none; }
    .file-upload-icon { font-size: 32px; margin-bottom: 8px; }
    .file-upload-text { font-size: 14px; color: #666; }
    .file-upload-name { font-size: 14px; color: var(--primary); font-weight: 600; margin-top: 8px; }

    /* Continue button */
    .btn-continue {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 16px 32px;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      margin-top: auto;
      transition: opacity 0.15s;
    }
    .btn-continue:hover { opacity: 0.9; }
    .btn-continue:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-continue svg { width: 18px; height: 18px; }

    /* Disqualification notice */
    .disqualify-notice {
      display: none;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 10px;
      padding: 16px 20px;
      margin-top: 16px;
      font-size: 14px;
      color: #991b1b;
      line-height: 1.5;
    }
    .disqualify-notice.visible { display: block; }

    /* Footer */
    .footer {
      text-align: center;
      padding: 24px 0;
      font-size: 12px;
      color: #bbb;
      border-top: 1px solid #f0f0f0;
      margin-top: 32px;
    }

    @media (max-width: 480px) {
      .container { padding: 16px 16px 80px; }
      .step h2 { font-size: 20px; }
      .field-row { flex-direction: column; gap: 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <button class="back-btn" id="backBtn" onclick="prevStep()" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
      <img src="${partner.logoUrl}" alt="${partner.businessName}" onerror="this.style.display='none'">
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="progressFill" style="width: ${(1 / totalVisibleSteps) * 100}%"></div>
    </div>

    <div id="stepsContainer">
      ${allSteps.map((step, i) => renderStep(step, i)).join("")}
    </div>

    <div class="footer">
      &copy; ${new Date().getFullYear()} ${partner.businessName}. All rights reserved.
    </div>
  </div>

  <script>
    const CONFIG = {
      partnerSlug: "${partner.slug}",
      serviceType: "${service.id}",
      serviceName: "${service.label}",
      baseUrl: "${baseUrl}",
      stripeKey: "${stripePublishableKey}",
      totalSteps: ${totalVisibleSteps},
      requiresBloodwork: ${service.requiresBloodwork},
    };

    const STEPS = ${JSON.stringify(allSteps.map((s) => ({ id: s.id, type: s.type, conditionalOn: s.conditionalOn, required: s.required !== false })))};

    let currentStepIndex = 0;
    let answers = {};
    let disqualified = false;
    let disqualifyReasons = [];

    function getVisibleSteps() {
      return STEPS.filter(s => {
        if (!s.conditionalOn) return true;
        return answers[s.conditionalOn.stepId] === s.conditionalOn.value;
      });
    }

    function getCurrentVisibleIndex() {
      const visible = getVisibleSteps();
      const currentId = STEPS[currentStepIndex].id;
      return visible.findIndex(s => s.id === currentId);
    }

    function updateProgress() {
      const visible = getVisibleSteps();
      const idx = getCurrentVisibleIndex();
      const pct = Math.max(((idx + 1) / visible.length) * 100, 5);
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('backBtn').style.display = currentStepIndex === 0 ? 'none' : 'flex';
    }

    function showStep(index) {
      document.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active');
        el.style.removeProperty('display');
      });
      const stepEl = document.querySelector('.step[data-index="' + index + '"]');
      if (stepEl) {
        stepEl.classList.add('active');
        currentStepIndex = index;
        updateProgress();
        window.scrollTo(0, 0);
      }
    }

    function nextStep() {
      const current = STEPS[currentStepIndex];

      // Save answer
      saveCurrentAnswer();

      // Find next visible step
      let nextIdx = currentStepIndex + 1;
      while (nextIdx < STEPS.length) {
        const step = STEPS[nextIdx];
        if (!step.conditionalOn) break;
        if (answers[step.conditionalOn.stepId] === step.conditionalOn.value) break;
        nextIdx++;
      }

      if (nextIdx >= STEPS.length) {
        // All intake steps done — go to recommendation/checkout
        submitIntake();
        return;
      }

      showStep(nextIdx);
    }

    function prevStep() {
      let prevIdx = currentStepIndex - 1;
      while (prevIdx >= 0) {
        const step = STEPS[prevIdx];
        if (!step.conditionalOn) break;
        if (answers[step.conditionalOn.stepId] === step.conditionalOn.value) break;
        prevIdx--;
      }
      if (prevIdx >= 0) showStep(prevIdx);
    }

    function saveCurrentAnswer() {
      const step = STEPS[currentStepIndex];
      const stepEl = document.querySelector('.step[data-index="' + currentStepIndex + '"]');

      if (step.type === 'radio') {
        const selected = stepEl.querySelector('.option-card.selected');
        if (selected) answers[step.id] = selected.dataset.value;
      } else if (step.type === 'checkbox') {
        const selected = stepEl.querySelectorAll('.option-card.selected');
        answers[step.id] = Array.from(selected).map(el => el.dataset.value);

        // Check for disqualifying selections
        selected.forEach(el => {
          if (el.dataset.disqualifying === 'true') {
            disqualified = true;
            if (!disqualifyReasons.includes(el.dataset.label)) {
              disqualifyReasons.push(el.dataset.label);
            }
          }
        });
      } else if (step.type === 'bmi') {
        const weight = stepEl.querySelector('#bmi-weight')?.value;
        const feet = stepEl.querySelector('#bmi-feet')?.value;
        const inches = stepEl.querySelector('#bmi-inches')?.value;
        answers[step.id] = { weight, feet, inches };
      } else if (step.type === 'select') {
        const sel = stepEl.querySelector('select');
        if (sel) answers[step.id] = sel.value;
      } else if (step.type === 'textarea') {
        const ta = stepEl.querySelector('textarea');
        if (ta) answers[step.id] = ta.value;
      } else if (step.type === 'text' || step.type === 'number') {
        const input = stepEl.querySelector('input');
        if (input) answers[step.id] = input.value;
      } else if (step.type === 'file-upload') {
        // File handled separately
      }
    }

    // Radio card click
    function selectRadio(card) {
      const stepEl = card.closest('.step');
      stepEl.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      // Check disqualifying
      const notice = stepEl.querySelector('.disqualify-notice');
      if (card.dataset.disqualifying === 'true' && notice) {
        notice.classList.add('visible');
      } else if (notice) {
        notice.classList.remove('visible');
      }
    }

    // Checkbox card click
    function toggleCheckbox(card) {
      const stepEl = card.closest('.step');
      const value = card.dataset.value;

      if (value === 'none') {
        // "None" deselects everything else
        stepEl.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      } else {
        // Deselect "none" if something else is picked
        const noneCard = stepEl.querySelector('.option-card[data-value="none"]');
        if (noneCard) noneCard.classList.remove('selected');
        card.classList.toggle('selected');
      }

      // Check disqualifying
      const notice = stepEl.querySelector('.disqualify-notice');
      const hasDisqualifying = stepEl.querySelector('.option-card.selected[data-disqualifying="true"]');
      if (hasDisqualifying && notice) {
        notice.classList.add('visible');
      } else if (notice) {
        notice.classList.remove('visible');
      }
    }

    // BMI calculator
    function calculateBMI() {
      const weight = parseFloat(document.getElementById('bmi-weight')?.value || '0');
      const feet = parseFloat(document.getElementById('bmi-feet')?.value || '0');
      const inches = parseFloat(document.getElementById('bmi-inches')?.value || '0');

      if (weight > 0 && (feet > 0 || inches > 0)) {
        const totalInches = (feet * 12) + inches;
        const bmi = (weight / (totalInches * totalInches)) * 703;
        const rounded = Math.round(bmi * 10) / 10;

        const resultEl = document.getElementById('bmi-result');
        const valueEl = document.getElementById('bmi-value');
        resultEl.classList.add('visible');

        let category, color;
        if (rounded < 18.5) { category = 'Underweight'; color = '#60a5fa'; }
        else if (rounded < 25) { category = 'Normal'; color = '#34d399'; }
        else if (rounded < 30) { category = 'Overweight'; color = '#fbbf24'; }
        else { category = 'Obese'; color = '#f97316'; }

        valueEl.textContent = rounded + ' - ' + category;
        valueEl.style.background = color;
      }
    }

    // File upload — uploads to Medplum Binary
    async function handleFileSelect(input) {
      const area = input.closest('.file-upload-area');
      const nameEl = area.querySelector('.file-upload-name');
      if (input.files.length === 0) return;

      const file = input.files[0];
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        nameEl.textContent = 'File too large (max 10MB)';
        nameEl.style.color = '#dc2626';
        return;
      }

      area.classList.add('has-file');
      nameEl.textContent = 'Uploading ' + file.name + '...';
      nameEl.style.color = '';

      // Disable Next while uploading
      const nextBtn = document.querySelector('.btn-next');
      if (nextBtn) nextBtn.disabled = true;

      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(CONFIG.baseUrl + '/form/' + CONFIG.partnerSlug + '/' + CONFIG.serviceType + '/upload-labs', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.success) {
          nameEl.textContent = file.name;
          answers[STEPS[currentStepIndex].id] = data.binaryId;
          answers['_bloodworkBinaryId'] = data.binaryId;
          answers['_bloodworkFileName'] = file.name;
        } else {
          nameEl.textContent = data.error || 'Upload failed';
          nameEl.style.color = '#dc2626';
          area.classList.remove('has-file');
        }
      } catch (err) {
        nameEl.textContent = 'Upload failed — please try again';
        nameEl.style.color = '#dc2626';
        area.classList.remove('has-file');
      }

      if (nextBtn) nextBtn.disabled = false;
    }

    async function submitIntake() {
      // Redirect to recommendation page with answers in session storage
      sessionStorage.setItem('intakeAnswers', JSON.stringify(answers));
      sessionStorage.setItem('intakeConfig', JSON.stringify(CONFIG));
      sessionStorage.setItem('disqualified', JSON.stringify(disqualified));
      sessionStorage.setItem('disqualifyReasons', JSON.stringify(disqualifyReasons));
      // Preserve URL params from quiz (addons, contact info) through the flow
      var existingParams = new URLSearchParams(window.location.search);
      var fwd = [];
      ['addons', 'fn', 'ln', 'em'].forEach(function(k) {
        var v = existingParams.get(k);
        if (v) fwd.push(k + '=' + encodeURIComponent(v));
      });
      var recommendUrl = CONFIG.baseUrl + '/form/' + CONFIG.partnerSlug + '/' + CONFIG.serviceType + '/recommend';
      if (fwd.length) recommendUrl += '?' + fwd.join('&');
      window.location.href = recommendUrl;
    }

    // Init
    showStep(0);
  </script>
</body>
</html>`;
}

function renderStep(step: FormStep, index: number): string {
  const conditionalStyle = step.conditionalOn ? ' style="display:none"' : "";
  let content = "";

  switch (step.type) {
    case "radio":
      content = renderRadioStep(step);
      break;
    case "checkbox":
      content = renderCheckboxStep(step);
      break;
    case "bmi":
      content = renderBMIStep(step);
      break;
    case "textarea":
      content = renderTextareaStep(step);
      break;
    case "text":
    case "number":
      content = renderInputStep(step);
      break;
    case "select":
      content = renderSelectStep(step);
      break;
    case "file-upload":
      content = renderFileUploadStep(step);
      break;
    case "date":
      content = renderInputStep(step);
      break;
    default:
      content = renderInputStep(step);
  }

  return `<div class="step" data-index="${index}" data-id="${step.id}"${conditionalStyle}>
    <h2>${step.question}</h2>
    ${step.subtitle ? `<p class="subtitle">${step.subtitle}</p>` : ""}
    ${content}
    ${hasDisqualifyingOptions(step) ? '<div class="disqualify-notice">Based on your selection, you may not be eligible for this treatment. A provider will review your information and follow up with you.</div>' : ""}
    <button class="btn-continue" onclick="nextStep()">
      Continue
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>`;
}

function renderRadioStep(step: FormStep): string {
  return (step.options || [])
    .map(
      (opt) =>
        `<div class="option-card" data-type="radio" data-value="${opt.value}" data-disqualifying="${opt.disqualifying || false}" data-label="${escapeAttr(opt.label)}" onclick="selectRadio(this)">
          <div class="option-indicator"></div>
          <span>${opt.label}</span>
        </div>`,
    )
    .join("");
}

function renderCheckboxStep(step: FormStep): string {
  return (step.options || [])
    .map(
      (opt) =>
        `<div class="option-card" data-type="checkbox" data-value="${opt.value}" data-disqualifying="${opt.disqualifying || false}" data-label="${escapeAttr(opt.label)}" onclick="toggleCheckbox(this)">
          <div class="option-indicator"></div>
          <span>${opt.label}</span>
        </div>`,
    )
    .join("");
}

function renderSelectStep(step: FormStep): string {
  const options = (step.options || [])
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join("");
  return `<select class="select-input" id="select-${step.id}">
    <option value="">Select one...</option>
    ${options}
  </select>`;
}

function renderBMIStep(step: FormStep): string {
  return `
    <label class="field-label">Weight (pounds)</label>
    <input type="number" id="bmi-weight" placeholder="Enter your weight" oninput="calculateBMI()">

    <label class="field-label" style="margin-top:16px">Height</label>
    <div class="field-row">
      <div>
        <input type="number" id="bmi-feet" placeholder="Feet" oninput="calculateBMI()">
        <span class="field-hint">Feet</span>
      </div>
      <div>
        <input type="number" id="bmi-inches" placeholder="Inches" oninput="calculateBMI()">
        <span class="field-hint">Inches</span>
      </div>
    </div>

    <div class="bmi-result" id="bmi-result">
      <p class="bmi-label">Your BMI Result</p>
      <div class="bmi-value-display" id="bmi-value"></div>
      <div class="bmi-categories">
        <span>Underweight &lt;18.5</span>
        <span>Normal 18.5-24.9</span>
        <span>Overweight 25-29.9</span>
        <span>Obese &ge;30</span>
      </div>
    </div>
  `;
}

function renderTextareaStep(step: FormStep): string {
  return `<textarea placeholder="${step.placeholder || ""}">${""}</textarea>
    ${step.required === false ? '<p class="field-hint">This is optional - only include what you think is important</p>' : ""}`;
}

function renderInputStep(step: FormStep): string {
  const inputType = step.type === "number" ? "number" : "text";
  return `<input type="${inputType}" placeholder="${step.placeholder || ""}">`;
}

function renderFileUploadStep(step: FormStep): string {
  return `
    <div class="file-upload-area" onclick="this.querySelector('input').click()">
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic" onchange="handleFileSelect(this)">
      <div class="file-upload-icon">📄</div>
      <div class="file-upload-text">Click to upload your lab results<br>(PDF, JPG, PNG, or HEIC)</div>
      <div class="file-upload-name"></div>
    </div>
  `;
}

function hasDisqualifyingOptions(step: FormStep): boolean {
  return (step.options || []).some((opt) => opt.disqualifying);
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
