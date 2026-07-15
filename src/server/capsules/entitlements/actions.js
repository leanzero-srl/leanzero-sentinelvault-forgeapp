import { kvs } from "@forge/kvs";

/**
 * Get the current request context (session)
 */
const loadSession = async (req) => {
  return req.context;
};

/**
 * Check if the app is licensed for the current installation.
 *
 * audit C1: this was a hardcoded `{ isLicensed: true }` stub — it never read the real license and
 * effectively lied. Read the platform license off the invocation context instead, biased FAIL-OPEN:
 * Forge only populates `context.license` once `app.licensing.enabled` is set in the manifest AND the
 * install has a paid Marketplace subscription, so on a dev install (and the E2E harness) it is
 * `undefined`. We report unlicensed ONLY when the platform EXPLICITLY says `active === false` — an
 * absent/undefined license reads as licensed, so the dev install is never locked out.
 *
 * IMPORTANT for future callers: whoever first gates a feature on `isLicensed` MUST keep this
 * `active !== false` bias (never `=== true`) and soft-degrade (banner / read-only nudge) rather than
 * hard-block — otherwise a dev/harness install (or an explicit inactive license) would be locked out.
 */
export const checkLicense = async (req) => {
  const active = req?.context?.license?.active; // true | false | undefined
  return {
    isLicensed: active !== false,
    active: active ?? null,
    unlicensedButAllowed: active === false,
  };
};

/**
 * Check if steward override is enabled globally
 */
const stewardOverrideEnabled = async () => {
  const globalPolicy = await kvs.get("admin-settings-global");
  return {
    enabled: globalPolicy?.allowAdminOverride !== false,
  };
};

export const actions = [
  ["load-session", loadSession],
  ["check-license", checkLicense],
  ["steward-override-enabled", stewardOverrideEnabled],
];
