/**
 * Dosing engine for My Orbit Health.
 * Evaluates patient intake answers against protocol rules to produce:
 *   - Starting dose recommendation
 *   - Disqualification flags (hard blocks, soft reviews, route redirects)
 *   - Required lab checklist with pass/fail
 *   - Titration schedule
 *   - Monitoring plan
 *
 * Automation levels:
 *   "fully_automated" — system can recommend dose without provider input (ED meds)
 *   "decision_support" — system suggests, provider confirms (everything else)
 */

import dosingRules from "./dosing_rules.json";
import { ServiceId } from "./types";

// ─── Types ───────────────────────────────────────────────────

export type BlockType =
  | "hard"
  | "hard_pending_review"
  | "soft_review"
  | "soft_defer"
  | "route_redirect"
  | "flag_only";

export interface DisqualifierResult {
  field: string;
  reason: string;
  blockType: BlockType;
  value?: string;
}

export interface LabRequirement {
  panel: string;
  requiredBeforeStart: boolean;
  met: boolean;
  note?: string;
}

export interface DoseAdjustment {
  condition: string;
  action: string;
  applied: boolean;
}

export interface TitrationStep {
  step: number;
  dose: string;
  durationWeeks: number | null;
  label: string;
  gate?: boolean;
}

export interface DosingResult {
  serviceId: string;
  status:
    | "active"
    | "awaiting_md_signature"
    | "awaiting_md_dose_confirmation"
    | "awaiting_md_blend_ratio";
  automationLevel: string;
  eligible: boolean;
  disqualifiers: DisqualifierResult[];
  hardBlocked: boolean;
  softReviewRequired: boolean;
  routeRedirect?: string;
  startingDose: string | null;
  maxDose: string | null;
  route: string;
  frequency: string;
  titrationSchedule: TitrationStep[];
  doseAdjustments: DoseAdjustment[];
  labRequirements: LabRequirement[];
  monitoringSchedule: string | null;
  escalationTriggers: Array<{ trigger: string; action: string }>;
  visitModel: { initial: string; followUp: string };
  providerNotes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────

type Answers = Record<string, string | string[] | boolean>;

function answerMatches(
  answers: Answers,
  field: string,
  value: string,
): boolean {
  const answer = answers[field];
  if (answer === undefined) return false;
  if (typeof answer === "boolean")
    return answer === (value === "yes" || value === "true");
  if (Array.isArray(answer)) return answer.includes(value);
  return answer === value;
}

function answerIsTrue(answers: Answers, field: string): boolean {
  const answer = answers[field];
  if (answer === true || answer === "yes" || answer === "true") return true;
  if (Array.isArray(answer) && answer.length > 0 && !answer.includes("none"))
    return true;
  return false;
}

function getAge(answers: Answers): number | null {
  const dob = answers["date_of_birth"] || answers["dateOfBirth"];
  if (!dob || typeof dob !== "string") return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) {
    age--;
  }
  return age;
}

// ─── Core Engine ─────────────────────────────────────────────

const protocols = (dosingRules as any).protocols;

export function getProtocol(serviceId: ServiceId | string): any | null {
  const normalized = serviceId.replace(/_/g, "-").toLowerCase().trim();
  // Handle "nad" → "nad-plus" and "estrogen-cream" → needs caller to specify vaginal/systemic
  if (normalized === "nad") return protocols["nad-plus"] || null;
  return protocols[normalized] || null;
}

export function evaluateDosing(
  serviceId: ServiceId | string,
  answers: Answers,
  labResults?: Record<string, number | string | boolean>,
): DosingResult {
  const protocol = getProtocol(serviceId);
  const normalizedId = serviceId.replace(/_/g, "-").toLowerCase().trim();

  // Default result for unknown or pending services
  if (!protocol) {
    return {
      serviceId: normalizedId,
      status: "awaiting_md_dose_confirmation",
      automationLevel: "decision_support",
      eligible: false,
      disqualifiers: [
        {
          field: "service",
          reason: `No protocol found for ${normalizedId}`,
          blockType: "hard",
        },
      ],
      hardBlocked: true,
      softReviewRequired: false,
      startingDose: null,
      maxDose: null,
      route: "unknown",
      frequency: "unknown",
      titrationSchedule: [],
      doseAdjustments: [],
      labRequirements: [],
      monitoringSchedule: null,
      escalationTriggers: [],
      visitModel: { initial: "sync", followUp: "async" },
      providerNotes: [`No dosing protocol loaded for ${normalizedId}`],
    };
  }

  const disqualifiers: DisqualifierResult[] = [];
  const doseAdjustments: DoseAdjustment[] = [];
  const labRequirements: LabRequirement[] = [];
  const providerNotes: string[] = [];
  let routeRedirect: string | undefined;

  // ── Check protocol status ──
  if (protocol.status !== "active") {
    providerNotes.push(
      `Protocol status: ${protocol.status}. Full dosing automation not yet available.`,
    );
  }

  // ── Evaluate disqualifiers ──
  const protoDisqualifiers = protocol.disqualifiers || [];
  for (const dq of protoDisqualifiers) {
    // Check if the disqualifiers reference another service
    if (!dq.field) continue;

    let triggered = false;

    if (dq.value) {
      triggered = answerMatches(answers, dq.field, dq.value);
    } else if (dq.condition) {
      // Condition-based checks
      triggered = checkCondition(dq.condition, dq.field, answers, labResults);
    }

    if (triggered) {
      const result: DisqualifierResult = {
        field: dq.field,
        reason: dq.reason || "Disqualified",
        blockType: dq.block_type as BlockType,
      };
      disqualifiers.push(result);

      if (dq.block_type === "route_redirect") {
        routeRedirect = dq.reason;
      }
    }
  }

  // ── Check disqualifying medications (GLP-1 class) ──
  if (protocol.disqualifying_medications) {
    for (const med of protocol.disqualifying_medications) {
      if (
        answerMatches(answers, "disqualifying-medications", med) ||
        answerMatches(answers, med, "yes")
      ) {
        disqualifiers.push({
          field: med,
          reason: `Disqualifying medication: ${med}`,
          blockType: "hard",
        });
      }
    }
  }

  const hardBlocked = disqualifiers.some((d) => d.blockType === "hard");
  const softReviewRequired = disqualifiers.some(
    (d) =>
      d.blockType === "soft_review" || d.blockType === "hard_pending_review",
  );

  // ── Evaluate labs ──
  const requiredLabs = protocol.required_labs || [];
  for (const lab of requiredLabs) {
    if (!lab.panel || lab.panel.startsWith("None")) continue;

    const met = lab.required_before_start
      ? labResults !== undefined && labResults[lab.panel] !== undefined
      : true; // Non-required labs default to met

    labRequirements.push({
      panel: lab.panel,
      requiredBeforeStart: lab.required_before_start || false,
      met,
      note: lab.notes || lab.condition,
    });
  }

  const labsBlocked = labRequirements.some(
    (l) => l.requiredBeforeStart && !l.met,
  );

  // ── Calculate starting dose with adjustments ──
  let startingDose: string | null = null;
  let maxDose: string | null = null;
  let route = "unknown";
  let frequency = "unknown";

  if (protocol.dosing) {
    const d = protocol.dosing;
    route = d.route || "unknown";
    frequency = d.frequency || d.modes?.prn?.frequency || "unknown";

    // Determine starting dose
    if (d.starting_dose_mg !== undefined) {
      let adjustedDose = d.starting_dose_mg;

      // Apply age-based adjustments (sildenafil)
      if (d.adjustment_rules) {
        const age = getAge(answers);
        for (const rule of d.adjustment_rules) {
          let ruleApplied = false;

          if (rule.condition === "age_gte_65" && age !== null && age >= 65) {
            if (rule.adjusted_starting_dose_mg !== undefined) {
              adjustedDose = rule.adjusted_starting_dose_mg;
              ruleApplied = true;
            }
          }

          if (
            rule.condition === "hepatic_impairment_any" &&
            answerIsTrue(answers, "hepatic_impairment")
          ) {
            if (rule.adjusted_starting_dose_mg !== undefined)
              adjustedDose = rule.adjusted_starting_dose_mg;
            ruleApplied = true;
          }

          doseAdjustments.push({
            condition: rule.condition,
            action: rule.action,
            applied: ruleApplied,
          });
        }
      }

      // ── Prior-use GLP-1 dose adjustment ──
      const glp1Prior = evaluateGlp1PriorUse(normalizedId, answers);
      if (glp1Prior) {
        adjustedDose = glp1Prior.dose;
        doseAdjustments.push({
          condition: glp1Prior.reason,
          action: `Start at ${glp1Prior.dose}mg instead of ${d.starting_dose_mg}mg (prior use adjustment)`,
          applied: true,
        });
        providerNotes.push(glp1Prior.providerNote);
      }

      // ── Prior-use ED dose adjustment (sildenafil) ──
      const edPrior = evaluateEdPriorUse(normalizedId, answers, adjustedDose);
      if (edPrior) {
        adjustedDose = edPrior.dose;
        doseAdjustments.push({
          condition: edPrior.reason,
          action: `Start at ${edPrior.dose}mg instead of default (prior use adjustment)`,
          applied: true,
        });
        providerNotes.push(edPrior.providerNote);
      }

      startingDose = `${adjustedDose}mg`;
    } else if (d.starting_dose_range) {
      startingDose = d.starting_dose_range;
    } else if (d.modes) {
      // Tadalafil dual-mode
      const mode = answers["dosing_preference"] === "daily" ? "daily" : "prn";
      const modeConfig = d.modes[mode];
      if (modeConfig) {
        let modeDose = modeConfig.starting_dose_mg;

        // ── Prior-use ED dose adjustment (tadalafil) ──
        const edPrior = evaluateEdPriorUse(normalizedId, answers, modeDose);
        if (edPrior) {
          modeDose = edPrior.dose;
          doseAdjustments.push({
            condition: edPrior.reason,
            action: `Start at ${edPrior.dose}mg instead of ${modeConfig.starting_dose_mg}mg (prior use adjustment)`,
            applied: true,
          });
          providerNotes.push(edPrior.providerNote);
        }

        startingDose = `${modeDose}mg ${mode === "daily" ? "daily" : "PRN"}`;
        frequency = modeConfig.frequency;
      }
    } else if (d.loading_phase) {
      startingDose = d.loading_phase.dose;
      frequency = `${d.loading_phase.frequency} x ${d.loading_phase.duration_days || d.loading_phase.duration} days loading, then ${d.maintenance_phase?.frequency || "maintenance"}`;
    }

    // Max dose
    if (d.max_dose_mg !== undefined) {
      maxDose = `${d.max_dose_mg}mg`;
    } else if (d.max_dose) {
      maxDose = d.max_dose;
    } else if (d.max_dose_mg_bid) {
      maxDose = `${d.max_dose_mg_bid}mg BID (${d.max_daily_mg}mg/day)`;
    }
  }

  // ── Build titration schedule (trimmed if prior-use adjusted) ──
  const titrationSchedule: TitrationStep[] = [];
  const adjustedStartMg = startingDose ? parseFloat(startingDose) : 0;
  if (protocol.dosing?.titration) {
    for (const step of protocol.dosing.titration) {
      const stepDoseMg = step.dose_mg || 0;
      // Skip titration steps below the adjusted starting dose
      if (stepDoseMg > 0 && adjustedStartMg > 0 && stepDoseMg < adjustedStartMg)
        continue;
      titrationSchedule.push({
        step: step.step || titrationSchedule.length + 1,
        dose: step.dose_mg
          ? `${step.dose_mg}mg`
          : step.dose || step.action || "see protocol",
        durationWeeks: step.duration_weeks ?? null,
        label: step.label || `Step ${step.step}`,
        gate: step.gate,
      });
    }
  }

  // ── Provider notes ──
  if (protocol.dea_note) providerNotes.push(protocol.dea_note);
  if (protocol.dosing?.black_box_warning)
    providerNotes.push(`BLACK BOX: ${protocol.dosing.black_box_warning}`);
  if (protocol.dosing?.lab_timing_critical)
    providerNotes.push(`LAB TIMING: ${protocol.dosing.lab_timing_critical}`);
  if (protocol.dosing?.food_requirement)
    providerNotes.push(`FOOD: ${protocol.dosing.food_requirement}`);
  if (protocol.dosing?.gallbladder_workflow)
    providerNotes.push(
      `Gallbladder monitoring: ${protocol.dosing.gallbladder_workflow.action}`,
    );

  if (
    protocol.progesterone_co_prescribing_rule &&
    answerIsTrue(answers, "uterus_intact")
  ) {
    const prog = protocol.progesterone_co_prescribing_rule;
    providerNotes.push(
      `MANDATORY: Co-prescribe ${prog.drug}. Postmenopause: ${prog.postmenopause_dose}. Perimenopause: ${prog.perimenopause_dose}.`,
    );
  }

  if (protocol.mammogram_workflow) {
    providerNotes.push(
      "Annual mammogram acknowledgment required before refill.",
    );
  }

  if (protocol.injection_training_required) {
    providerNotes.push(
      "Injection technique must be confirmed on initial video visit.",
    );
  }

  // ── Visit model ──
  const visitModel = protocol.visit_model || {
    initial: "sync",
    follow_up: "async",
  };

  return {
    serviceId: normalizedId,
    status: protocol.status,
    automationLevel: protocol.automation_level || "decision_support",
    eligible: !hardBlocked && !labsBlocked && !routeRedirect,
    disqualifiers,
    hardBlocked,
    softReviewRequired,
    routeRedirect,
    startingDose: hardBlocked ? null : startingDose,
    maxDose,
    route,
    frequency,
    titrationSchedule,
    doseAdjustments,
    labRequirements,
    monitoringSchedule: protocol.monitoring?.schedule || null,
    escalationTriggers: protocol.escalation_triggers || [],
    visitModel: { initial: visitModel.initial, followUp: visitModel.follow_up },
    providerNotes,
  };
}

// ─── Condition Evaluator ─────────────────────────────────────

function checkCondition(
  condition: string,
  field: string,
  answers: Answers,
  labResults?: Record<string, number | string | boolean>,
): boolean {
  // Lab-dependent conditions: if labs are absent at this stage (typically
  // intake submission, before the doctor has uploaded results), do NOT hard
  // block. The doctor's approval gate re-evaluates labs at review time.
  const isLabCondition =
    condition === "NOT_both_below_300" ||
    condition === "above_54" ||
    condition === "gte_4_or_rapid_rise" ||
    condition === "not_obtained";
  if (isLabCondition && !labResults) return false;

  switch (condition) {
    case "NOT_both_below_300": {
      const t1 = labResults!["total_testosterone_1"];
      const t2 = labResults!["total_testosterone_2"];
      // Labs present but incomplete — defer, don't block
      if (t1 === undefined || t2 === undefined) return false;
      return !(Number(t1) < 300 && Number(t2) < 300);
    }
    case "above_54": {
      const hct = Number(labResults![field] ?? labResults!["hematocrit"]);
      return !isNaN(hct) && hct > 54;
    }
    case "gte_4_or_rapid_rise": {
      const psa = Number(labResults!["psa"]);
      return !isNaN(psa) && psa >= 4;
    }
    case "within_6_months":
    case "within_12_months": {
      return answerIsTrue(answers, field);
    }
    case "sbp_above_160_or_dbp_above_100": {
      const sbp = Number(answers["sbp"] || answers["systolic_bp"]);
      const dbp = Number(answers["dbp"] || answers["diastolic_bp"]);
      return (!isNaN(sbp) && sbp > 160) || (!isNaN(dbp) && dbp > 100);
    }
    case "not_obtained": {
      return labResults![field] === undefined;
    }
    default:
      return false;
  }
}

// ─── Prior-Use Dose Adjustments ──────────────────────────────

// GLP-1 titration tiers mapped by service for cross-medication equivalence.
// Tier position (step number) is used for cross-mapping: step 1 ≈ step 1, etc.
const GLP1_TIERS: Record<string, number[]> = {
  semaglutide: [0.25, 0.5, 1.0, 1.7, 2.4],
  tirzepatide: [2.5, 5.0, 7.5, 10.0, 12.5, 15.0],
  retatrutide: [2, 4, 8, 12],
};

interface PriorUseResult {
  dose: number;
  reason: string;
  providerNote: string;
}

/**
 * Evaluates GLP-1 prior-use answers and returns an adjusted starting dose.
 * Rules:
 *   - Same med, current or stopped <4 weeks → restart at prior dose
 *   - Same med, stopped 4-8 weeks → one step below prior dose
 *   - Same med, stopped 8+ weeks → restart from step 1 (GI tolerance reset)
 *   - Different GLP-1, current or <4 weeks → equivalent tier minus one step
 *   - Different GLP-1, 4-8 weeks off → equivalent tier minus two steps
 *   - Different GLP-1, 8+ weeks off → restart from step 1
 *   - "Other" prior med → no adjustment (doctor decides)
 *   - Never exceeds the current med's titration tiers
 */
function evaluateGlp1PriorUse(
  currentServiceId: string,
  answers: Answers,
): PriorUseResult | null {
  if (answers["prior-glp1"] !== "yes") return null;

  const priorMed = answers["prior-glp1-which"] as string | undefined;
  if (!priorMed || priorMed === "other") return null;

  // Get the prior dose from the medication-specific question
  const priorDoseStr = answers[`prior-glp1-dose-${priorMed}`] as
    | string
    | undefined;
  if (!priorDoseStr) return null;
  const priorDose = parseFloat(priorDoseStr);
  if (isNaN(priorDose)) return null;

  const timing = (answers["prior-glp1-timing"] as string) || "over-8-weeks";

  // Get tiers for both medications
  const currentTiers = GLP1_TIERS[currentServiceId];
  const priorTiers = GLP1_TIERS[priorMed];
  if (!currentTiers || !priorTiers) return null;

  // Find the patient's tier position in their prior medication
  let priorTierIndex = priorTiers.indexOf(priorDose);
  if (priorTierIndex === -1) {
    // Closest tier below
    priorTierIndex = priorTiers.filter((t) => t <= priorDose).length - 1;
    if (priorTierIndex < 0) return null;
  }

  const sameMed = priorMed === currentServiceId;
  let targetTierIndex: number;

  if (sameMed) {
    if (timing === "current" || timing === "under-4-weeks") {
      // Restart at prior dose
      targetTierIndex = priorTierIndex;
    } else if (timing === "4-to-8-weeks") {
      // One step below
      targetTierIndex = priorTierIndex - 1;
    } else {
      // 8+ weeks — GI tolerance fully reset
      return null; // No adjustment, start from protocol default
    }
  } else {
    // Different GLP-1: cross-titrate by equivalent tier position
    if (timing === "current" || timing === "under-4-weeks") {
      targetTierIndex = priorTierIndex - 1; // One step conservative for med switch
    } else if (timing === "4-to-8-weeks") {
      targetTierIndex = priorTierIndex - 2;
    } else {
      return null; // Too long off, restart from scratch
    }
  }

  // Clamp: minimum step 1 (index 0), max is highest current tier
  if (targetTierIndex <= 0) return null; // Step 0 or below = just use default starting dose
  if (targetTierIndex >= currentTiers.length)
    targetTierIndex = currentTiers.length - 1;

  const adjustedDose = currentTiers[targetTierIndex];
  const defaultDose = currentTiers[0];

  // Only return if we're actually skipping steps
  if (adjustedDose <= defaultDose) return null;

  const priorMedLabel = priorMed.charAt(0).toUpperCase() + priorMed.slice(1);
  const timingLabel =
    timing === "current"
      ? "currently taking"
      : timing === "under-4-weeks"
        ? "stopped <4 weeks ago"
        : "stopped 4-8 weeks ago";

  return {
    dose: adjustedDose,
    reason: `Prior GLP-1 use: ${priorMedLabel} ${priorDose}mg, ${timingLabel}`,
    providerNote:
      `PRIOR USE: Patient reports ${priorMedLabel} ${priorDose}mg/week (${timingLabel}). ` +
      `${sameMed ? "Same medication" : "Cross-titration from different GLP-1"} — ` +
      `starting at ${adjustedDose}mg instead of ${defaultDose}mg. ` +
      `Monitor for GI tolerance in first 2 weeks.`,
  };
}

/**
 * Evaluates ED medication prior-use answers and returns an adjusted starting dose.
 * Rules:
 *   - Same med + "worked great" → start at prior dose (up to mode max)
 *   - Same med + "partial" → start at prior dose (doctor may escalate)
 *   - Same med + "didn't work" → no adjustment (doctor decides, may escalate)
 *   - Same med + "side effects" → no adjustment (doctor reviews)
 *   - Different ED med → no adjustment (different pharmacology)
 *   - Tadalafil: prior dose capped at mode max (daily max 5mg, PRN max 20mg)
 */
function evaluateEdPriorUse(
  currentServiceId: string,
  answers: Answers,
  currentDefault: number,
): PriorUseResult | null {
  if (answers["ed-previous-treatment"] !== "yes") return null;

  const priorMed = answers["ed-prior-which"] as string | undefined;
  if (!priorMed || priorMed === "other") return null;
  if (priorMed !== currentServiceId) return null; // Different med — no auto-adjustment

  const response = answers["ed-prior-response"] as string | undefined;
  if (!response || response === "none" || response === "side-effects")
    return null;

  // Get the prior dose
  const priorDoseStr = answers[`ed-prior-dose-${priorMed}`] as
    | string
    | undefined;
  if (!priorDoseStr) return null;
  let priorDose = parseFloat(priorDoseStr);
  if (isNaN(priorDose)) return null;

  // Tadalafil safety: cap at mode-specific max (daily max 5mg, PRN max 20mg)
  if (currentServiceId === "tadalafil") {
    const mode = answers["dosing_preference"] === "daily" ? "daily" : "prn";
    const modeMax = mode === "daily" ? 5 : 20;
    priorDose = Math.min(priorDose, modeMax);
  }

  if (priorDose <= currentDefault) return null;

  return {
    dose: priorDose,
    reason: `Prior ED use: ${priorMed} ${priorDose}mg, response: ${response}`,
    providerNote:
      `PRIOR USE: Patient reports ${priorMed} ${priorDoseStr}mg (${response === "good" ? "worked well" : "partial response"}). ` +
      `Starting at ${priorDose}mg instead of ${currentDefault}mg.`,
  };
}

// ─── Convenience: Get all active protocol IDs ────────────────

export function getActiveProtocolIds(): string[] {
  return Object.entries(protocols)
    .filter(([_, p]: [string, any]) => p.status === "active")
    .map(([id]) => id);
}

export function getPendingProtocolIds(): string[] {
  return Object.entries(protocols)
    .filter(([_, p]: [string, any]) => p.status !== "active")
    .map(([id]) => id);
}

export function getProtocolStatus(serviceId: string): string | null {
  const p = getProtocol(serviceId);
  return p?.status || null;
}
