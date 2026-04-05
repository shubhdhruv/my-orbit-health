/**
 * Patient routing engine for My Orbit Health.
 * Determines sync vs async visit type based on patient state, service, and visit history.
 *
 * AUDIT v1.1.0: Added daysSinceLastVisit for TX 90-day lapse enforcement,
 * lapseOverride flag, service ID normalization, fail-loud on unknown service.
 */

import routingRules from "./routing_rules.json";
import { ServiceId } from "./types";

export type VisitType = "sync" | "async" | "in_person_required" | "blocked";

export interface RoutingResult {
  visitType: VisitType;
  schedule: string;
  constraints: string[];
  routingNote: string;
  licenseNote: string;
  category: string;
  state: string;
  serviceId: string;
  daysSinceLastVisit?: number;
  lapseOverride: boolean;
}

type ScheduleKey = "non_controlled" | "schedule_III_V" | "schedule_II";

// States with lapse rules: state → [constraint_name, threshold_days]
const LAPSE_RULES: Record<string, [string, number]> = {
  TX: ["async_ok_if_seen_within_90_days", 90],
};

function getSchedule(serviceId: string): string {
  const normalized = serviceId.replace(/_/g, "-").toLowerCase().trim();
  const result = (routingRules.schedule_map as Record<string, string>)[normalized];
  if (result === undefined) {
    throw new Error(`Unknown service_id: '${serviceId}' (normalized: '${normalized}'). Add to schedule_map.`);
  }
  return result;
}

function getScheduleKey(schedule: string): ScheduleKey {
  if (schedule === "III" || schedule === "IV" || schedule === "V") return "schedule_III_V";
  if (schedule === "II") return "schedule_II";
  return "non_controlled";
}

export function routePatient(
  state: string,
  serviceId: ServiceId | string,
  isFirstVisit: boolean = true,
  daysSinceLastVisit?: number,
): RoutingResult {
  const stateUpper = state.toUpperCase().trim();
  const schedule = getSchedule(serviceId);
  const stateRules = (routingRules.states as Record<string, any>)[stateUpper];

  if (!stateRules) {
    throw new Error(`Unknown state: ${stateUpper}`);
  }

  const visitKey = isFirstVisit ? "first_visit" : "follow_up";
  const constraintKey = isFirstVisit ? "first_visit_constraints" : "follow_up_constraints";
  const scheduleKey = getScheduleKey(schedule);
  const ruleBlock = stateRules[scheduleKey];

  let visitType = ruleBlock[visitKey] as VisitType;
  let constraints: string[] = ruleBlock[constraintKey] || [];
  let lapseOverride = false;

  // Lapse override: follow-up patient who hasn't been seen within state threshold
  if (
    !isFirstVisit &&
    daysSinceLastVisit !== undefined &&
    stateUpper in LAPSE_RULES
  ) {
    const [lapseConstraint, thresholdDays] = LAPSE_RULES[stateUpper];
    if (constraints.includes(lapseConstraint) && daysSinceLastVisit > thresholdDays) {
      visitType = ruleBlock["first_visit"] as VisitType;
      constraints = ruleBlock["first_visit_constraints"] || [];
      lapseOverride = true;
    }
  }

  return {
    visitType,
    schedule,
    constraints,
    routingNote: stateRules.routing_note,
    licenseNote: stateRules.license_note,
    category: stateRules.category,
    state: stateUpper,
    serviceId,
    daysSinceLastVisit,
    lapseOverride,
  };
}

export function requiresSync(
  state: string,
  serviceId: ServiceId | string,
  isFirstVisit: boolean = true,
  daysSinceLastVisit?: number,
): boolean {
  return routePatient(state, serviceId, isFirstVisit, daysSinceLastVisit).visitType === "sync";
}

export function isBlocked(
  state: string,
  serviceId: ServiceId | string,
  isFirstVisit: boolean = true,
  daysSinceLastVisit?: number,
): boolean {
  const vt = routePatient(state, serviceId, isFirstVisit, daysSinceLastVisit).visitType;
  return vt === "blocked" || vt === "in_person_required";
}
