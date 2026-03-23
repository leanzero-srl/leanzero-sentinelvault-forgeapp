/**
 * Entitlements capsule — re-exports steward authorization checks
 * from the shared layer.
 *
 * The core permission logic (realm steward check, cohort membership,
 * site admin check, composite authorization) lives in shared/steward-checks.js.
 * This module provides the canonical capsule entry-point for consumers
 * that need entitlement verification.
 */
export {
  isOperatorRealmSteward,
  isOperatorInStewardCohorts,
  isOperatorSiteAdmin,
  authorizeSteward,
} from "../../shared/steward-checks.js";
