import { kvs } from "@forge/kvs";
import { BASELINE_HOLD_SPAN } from "../../shared/baseline.js";

/**
 * Get storage key for policy based on scope
 *
 * @param {string} scope - Either "global" or "realm"
 * @param {string} [realmKey] - Realm key (required for realm scope)
 * @returns {string} The storage key for the policy
 */
function getPolicyStorageKey(scope, realmKey) {
  if (scope === "global") {
    return "admin-settings-global";
  } else if (scope === "realm" && realmKey) {
    // Sanitize the realm key to match Forge storage key pattern: ^(?!\s+$)[a-zA-Z0-9:._\s-#]+$
    const sanitizedKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    return `admin-settings-space-${sanitizedKey}`;
  } else {
    throw new Error("Invalid scope or missing realm key");
  }
}

/**
 * Retrieve policy ruleset for a given scope
 *
 * @param {string} scope - Either "global" or "realm"
 * @param {string} [realmKey] - Realm key (required for realm scope)
 * @returns {Object|null} The policy object or null if not found
 */
export async function getPolicyRuleset(scope, realmKey) {
  try {
    const storageKey = getPolicyStorageKey(scope, realmKey);

    const ruleset = await kvs.get(storageKey);

    // Return default values if no ruleset exists
    return ruleset || {};
  } catch (error) {
    console.error(`Failed to get policy ruleset (${scope}):`, error);
    return {};
  }
}

/**
 * Save policy ruleset for a given scope
 *
 * @param {string} scope - Either "global" or "realm"
 * @param {string} [realmKey] - Realm key (required for realm scope)
 * @param {Object} data - The policy data to save
 * @returns {Promise<{success: boolean}>} Success status
 * @throws {Error} If validation fails or saving fails
 */
export async function savePolicyRuleset(scope, realmKey, data) {
  try {
    const storageKey = getPolicyStorageKey(scope, realmKey);

    if (scope === "realm") {
      const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    }

    // Validate data
    if (!data) {
      throw new Error("No policy provided");
    }

    // Validate seal duration if present
    if (
      data.defaultLockDuration !== undefined &&
      (!Number.isInteger(data.defaultLockDuration) ||
        data.defaultLockDuration < 60)
    ) {
      throw new Error(
        "Default lock duration must be an integer of at least 60 seconds",
      );
    }

    // Store policy with no expiration (persistent)
    await kvs.set(storageKey, data);

    return { success: true };
  } catch (error) {
    console.error(`Failed to save policy ruleset (${scope}):`, error);
    throw new Error(error.message || "Could not save configuration");
  }
}

/**
 * Get seal duration for a given realm
 * This function checks realm-specific policy first, then falls back to global policy,
 * then to the default constant.
 *
 * @param {string} [realmKey] - Realm key (optional)
 * @returns {Promise<number>} Seal duration in seconds
 */
export async function getSealDuration(realmKey) {
  let holdPeriod = BASELINE_HOLD_SPAN;

  if (realmKey) {
    // Check realm-specific policy first
    const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmPolicy = await kvs.get(
      `admin-settings-space-${sanitizedRealmKey}`,
    );

    // If realm has custom timeout setting, use it for seal duration too!
    if (
      realmPolicy?.autoUnlockTimeoutHours &&
      realmPolicy.autoUnlockTimeoutHours !== null
    ) {
      holdPeriod = realmPolicy.autoUnlockTimeoutHours * 3600; // Convert hours to seconds
    } else {
      // Fall back to global policy
      const globalPolicy = await kvs.get("admin-settings-global");

      if (globalPolicy?.defaultLockDuration) {
        holdPeriod = globalPolicy.defaultLockDuration;
      }
    }
  } else {
    // No realm context, use global only
    const globalPolicy = await kvs.get("admin-settings-global");
    if (globalPolicy?.defaultLockDuration) {
      holdPeriod = globalPolicy.defaultLockDuration;
    }
  }

  return holdPeriod;
}

/**
 * Get auto-unseal timeout hours for a given realm
 * This function checks realm-specific policy first, then falls back to global policy.
 *
 * @param {string} [realmKey] - Realm key (optional)
 * @returns {Promise<number>} Auto-unseal timeout in hours
 */
export async function getAutoUnsealTimeoutHours(realmKey) {
  // Get global policy for default and auto-unseal enabled check
  const globalPolicy = await kvs.get("admin-settings-global");

  // Calculate default timeout hours from defaultLockDuration (convert seconds to hours)
  const defaultTimeoutHours = globalPolicy?.defaultLockDuration
    ? Math.round(globalPolicy.defaultLockDuration / 3600)
    : 24;

  if (realmKey) {
    // Check realm-specific policy
    const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmPolicy = await kvs.get(
      `admin-settings-space-${sanitizedRealmKey}`,
    );

    if (
      realmPolicy?.autoUnlockTimeoutHours !== undefined &&
      realmPolicy.autoUnlockTimeoutHours !== null
    ) {
      return realmPolicy.autoUnlockTimeoutHours;
    }
  }

  return defaultTimeoutHours;
}

/**
 * Check if auto-unseal is enabled globally
 *
 * @returns {Promise<boolean>} True if auto-unseal is enabled
 */
export async function isAutoUnsealEnabled() {
  const globalPolicy = await kvs.get("admin-settings-global");
  // Default to true if not explicitly disabled
  return globalPolicy?.autoUnlockEnabled !== false;
}
