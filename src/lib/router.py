"""
Patient routing engine for My Orbit Health.
Determines sync vs async visit type based on patient state, service, and visit history.

AUDIT CHANGES v1.1.0 (2026-04-05):
  - get_schedule(): Normalize service_id hyphen/underscore variants. Raise on unknown
    service_id instead of silently returning 'none' — prevents Sch III drugs being
    misclassified as non-controlled if upstream sends underscores.
  - route_patient(): Added days_since_last_visit param to enforce TX 90-day window.
    A follow-up patient last seen >90 days ago is re-routed to sync, not async.
  - Constraints now split into first_visit_constraints / follow_up_constraints in JSON.
    Router reads the correct block per visit_key — no more stale constraints on follow-ups.
  - get_schedule() handles schedule IV and V explicitly, mapping to schedule_III_V block.
    Prevents future formulary additions (e.g. tramadol/Sch IV) falling into Sch II block.
  - Added VALID_VISIT_TYPES guard — raises immediately if JSON contains a non-standard
    visit_type value (catches NJ-style 'in_person_every_3_months' at load time).

Usage:
    from router import route_patient

    result = route_patient(
        state="TX",
        service_id="testosterone-injectable",
        is_first_visit=True
    )

    # Follow-up with 90-day enforcement (TX):
    result = route_patient(
        state="TX",
        service_id="testosterone-injectable",
        is_first_visit=False,
        days_since_last_visit=95   # >90 → overrides to sync
    )

    # result.visit_type  -> "sync" | "async" | "in_person_required" | "blocked"
    # result.constraints -> list of applicable constraints for this visit type
    # result.routing_note -> state routing note
    # result.license_note -> state license note
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

RULES_PATH = Path(__file__).parent / "routing_rules.json"

# Canonical visit types. Any value in JSON not in this set is a schema error.
VALID_VISIT_TYPES = {"sync", "async", "in_person_required", "blocked"}

# States where a lapsed follow-up window requires re-routing to sync.
# Key: state code. Value: (constraint_name, threshold_days)
LAPSE_RULES: dict[str, tuple[str, int]] = {
    "TX": ("async_ok_if_seen_within_90_days", 90),
}


@dataclass
class RoutingResult:
    visit_type: str           # "sync" | "async" | "in_person_required" | "blocked"
    schedule: str             # "none" | "II" | "III" | "IV" | "V"
    constraints: list[str]    # Applicable constraints for this specific visit_key
    routing_note: str
    license_note: str
    category: str
    state: str
    service_id: str
    days_since_last_visit: Optional[int] = None
    lapse_override: bool = False  # True if visit_type was upgraded due to lapse


def _load_rules() -> dict:
    with open(RULES_PATH) as f:
        rules = json.load(f)

    # Validate all visit_type values at load time — fail loud on schema errors.
    for state_code, state_data in rules["states"].items():
        for block_name in ("non_controlled", "schedule_III_V", "schedule_II"):
            block = state_data.get(block_name)
            if not block:
                continue
            for visit_key in ("first_visit", "follow_up"):
                vt = block.get(visit_key)
                if vt and vt not in VALID_VISIT_TYPES:
                    raise ValueError(
                        f"Invalid visit_type '{vt}' in state {state_code}.{block_name}.{visit_key}. "
                        f"Must be one of: {VALID_VISIT_TYPES}"
                    )
    return rules


_rules = _load_rules()


def get_schedule(service_id: str) -> str:
    """
    Return DEA schedule for a service: 'none', 'II', 'III', 'IV', or 'V'.

    Normalizes hyphen/underscore variants (e.g. 'testosterone_injectable' →
    'testosterone-injectable') so upstream format differences don't silently
    downgrade a controlled substance to non-controlled.

    Raises ValueError for unrecognized service IDs — fail loud, not silent.
    """
    normalized = service_id.replace("_", "-").lower().strip()
    result = _rules["schedule_map"].get(normalized)
    if result is None:
        raise ValueError(
            f"Unknown service_id: '{service_id}' (normalized: '{normalized}'). "
            f"Add to schedule_map in routing_rules.json."
        )
    return result


def _get_rule_block(state_rules: dict, schedule: str) -> dict:
    """Map DEA schedule string to the correct state rule block."""
    if schedule == "none":
        return state_rules["non_controlled"]
    elif schedule in ("III", "IV", "V"):
        # Schedule IV and V use the same block as III.
        # If/when a Sch IV/V product is added to formulary, no router change needed.
        return state_rules["schedule_III_V"]
    elif schedule == "II":
        return state_rules["schedule_II"]
    else:
        raise ValueError(f"Unhandled schedule value: '{schedule}'")


def route_patient(
    state: str,
    service_id: str,
    is_first_visit: bool = True,
    days_since_last_visit: Optional[int] = None,
) -> RoutingResult:
    """
    Determine visit type for a patient.

    Args:
        state: Two-letter state code (e.g. "TX", "NY")
        service_id: Service identifier. Hyphen or underscore format accepted.
        is_first_visit: True if patient has no prior visit with this provider.
        days_since_last_visit: Days since last encounter. Used to enforce
            state-specific lapse rules (e.g. TX 90-day window). If None and
            is_first_visit=False, lapse rules are not applied — callers should
            pass this value whenever available.
    """
    state = state.upper().strip()
    schedule = get_schedule(service_id)

    state_rules = _rules["states"].get(state)
    if not state_rules:
        raise ValueError(f"Unknown state: '{state}'")

    visit_key = "first_visit" if is_first_visit else "follow_up"
    constraints_key = f"{visit_key}_constraints"

    rule_block = _get_rule_block(state_rules, schedule)

    visit_type = rule_block[visit_key]
    constraints = rule_block.get(constraints_key, [])

    # --- Lapse override ---
    # For follow-up visits, check if the time since last visit exceeds a
    # state-specific threshold that requires upgrading back to sync.
    lapse_override = False
    if (
        not is_first_visit
        and days_since_last_visit is not None
        and state in LAPSE_RULES
    ):
        lapse_constraint, threshold_days = LAPSE_RULES[state]
        if lapse_constraint in constraints and days_since_last_visit > threshold_days:
            # Patient has lapsed — treat as effectively a new patient for routing.
            visit_type = rule_block["first_visit"]
            constraints = rule_block.get("first_visit_constraints", [])
            lapse_override = True

    return RoutingResult(
        visit_type=visit_type,
        schedule=schedule,
        constraints=constraints,
        routing_note=state_rules["routing_note"],
        license_note=state_rules["license_note"],
        category=state_rules["category"],
        state=state,
        service_id=service_id,
        days_since_last_visit=days_since_last_visit,
        lapse_override=lapse_override,
    )


def requires_sync(
    state: str,
    service_id: str,
    is_first_visit: bool = True,
    days_since_last_visit: Optional[int] = None,
) -> bool:
    """Quick check: does this patient need a sync video visit?"""
    result = route_patient(state, service_id, is_first_visit, days_since_last_visit)
    return result.visit_type == "sync"


def is_blocked(
    state: str,
    service_id: str,
    is_first_visit: bool = True,
    days_since_last_visit: Optional[int] = None,
) -> bool:
    """Quick check: is this service blocked or requires in-person in this state?"""
    result = route_patient(state, service_id, is_first_visit, days_since_last_visit)
    return result.visit_type in ("blocked", "in_person_required")


if __name__ == "__main__":
    # Smoke tests covering all changed states and edge cases.
    test_cases = [
        # (state, service_id, is_first_visit, days_since_last_visit, expected_visit_type)
        ("TX", "testosterone-injectable", True,  None, "sync"),           # New patient → sync
        ("TX", "testosterone-injectable", False, 60,   "async"),          # Follow-up within 90d → async
        ("TX", "testosterone-injectable", False, 95,   "sync"),           # Follow-up >90d → lapse → sync
        ("TX", "testosterone-injectable", False, None, "async"),          # No days provided → no lapse check
        ("TX", "semaglutide",            True,  None, "async"),           # Non-controlled → async always
        ("NY", "testosterone-oral",       True,  None, "in_person_required"),
        ("NY", "testosterone-oral",       False, None, "async"),
        ("NY", "sildenafil",              True,  None, "async"),           # Non-controlled → async
        ("AL", "testosterone-injectable", True,  None, "sync"),
        ("AL", "testosterone-injectable", False, None, "sync"),
        ("WA", "testosterone-injectable", True,  None, "sync"),
        ("WA", "testosterone-injectable", False, None, "sync"),           # WA: sync even on follow-up
        ("LA", "testosterone-injectable", True,  None, "sync"),
        ("LA", "testosterone-injectable", False, None, "sync"),           # LA: sync on follow-up too
        ("FL", "semaglutide",            True,  None, "async"),
        ("FL", "testosterone-injectable", True,  None, "async"),          # Sch III OK in FL
        ("CA", "testosterone-injectable", True,  None, "sync"),
        ("CA", "testosterone-injectable", False, None, "async"),
        ("NJ", "testosterone-injectable", True,  None, "async"),          # Sch III OK in NJ
        ("NJ", "testosterone-injectable", False, None, "async"),
        ("ID", "testosterone-injectable", True,  None, "async"),          # Most permissive
        # Underscore normalization
        ("TX", "testosterone_injectable", True,  None, "sync"),           # Underscore → normalized
    ]

    print(f"{'State':<6} {'Service':<28} {'Visit':<10} {'Days':<6} {'Expected':<22} {'Got':<22} {'Pass'}")
    print("-" * 105)

    all_pass = True
    for state, service, first, days, expected in test_cases:
        visit_label = "first" if first else "follow-up"
        try:
            r = route_patient(state, service, first, days)
            passed = r.visit_type == expected
            all_pass = all_pass and passed
            lapse_flag = " [lapse]" if r.lapse_override else ""
            print(
                f"{state:<6} {service:<28} {visit_label:<10} {str(days):<6} "
                f"{expected:<22} {r.visit_type + lapse_flag:<22} {'✅' if passed else '❌ FAIL'}"
            )
        except Exception as e:
            all_pass = False
            print(f"{state:<6} {service:<28} {visit_label:<10} {str(days):<6} {expected:<22} ERROR: {e}")

    print()
    print("All tests passed ✅" if all_pass else "⚠️  Some tests FAILED — review output above")
