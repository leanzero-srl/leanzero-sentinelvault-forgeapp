import { kvs, WhereConditions } from "@forge/kvs";

// Import from shared
import { BASELINE_HOLD_SPAN } from "../../shared/baseline.js";

/**
 * Get admin settings (unified function for global and realm)
 */
const loadPolicy = async (req) => {
  const { scope, key } = req.payload;

  if (scope === "global") {
    const ruleset = await kvs.get("admin-settings-global");
    return (
      ruleset || {
        autoUnlockEnabled: true,
        defaultLockDuration: BASELINE_HOLD_SPAN,
        allowAdminOverride: false,
        reminderIntervalDays: 7,
        // Auto-unlock pause tracking
        autoUnlockPausedAt: null,
        // Notification settings
        enableToastNotifications: true,
        enablePageBanners: true,
        enableConfluenceNotifications: true,
        enableEmailNotifications: false,
        enableLockExpiryReminderEmail: false,
        enableAutoUnlockNotificationEmail: false,
        enablePeriodicReminderEmail: false,
        // Panel settings
        allowArtifactDelete: false,
      }
    );
  } else if (scope === "space" && key) {
    const sanitizedRealmKey = key.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const ruleset = await kvs.get(`admin-settings-space-${sanitizedRealmKey}`);
    return (
      ruleset || {
        activation: "use-system-default",
        autoUnlockTimeoutHours: null,
        overrideGlobalSettings: false,
        adminUsers: [],
        adminGroups: [],
        autoInsertMacro: true,
        macroInsertPosition: "bottom",
      }
    );
  }

  return {};
};

/**
 * Save admin settings (unified function for global and realm)
 */
const storePolicy = async (req) => {
  const { scope, key, data } = req.payload;

  if (scope === "global") {
    const currentRuleset = await kvs.get("admin-settings-global");
    const currentAutoUnsealActive =
      currentRuleset?.autoUnlockEnabled !== false;
    const newAutoUnsealActive = data.autoUnlockEnabled !== false;

    // Handle auto-unseal disable (pause timers)
    if (currentAutoUnsealActive && !newAutoUnsealActive) {
      console.info("Auto-unseal disabled - pausing all seal timers");
      data.autoUnlockPausedAt = Date.now();
    }

    // Handle auto-unseal enable (resume timers)
    if (!currentAutoUnsealActive && newAutoUnsealActive) {
      console.info("Auto-unseal enabled - resuming all seal timers");
      const pausedAt = currentRuleset?.autoUnlockPausedAt || Date.now();
      const pauseDuration = Date.now() - pausedAt;

      console.info(
        `Auto-unseal was paused for ${Math.round(pauseDuration / 1000)} seconds`,
      );

      // Extend all seal expiry times by pause duration
      const { results: seals } = await kvs
        .query()
        .where("key", WhereConditions.beginsWith("protection-"))
        .limit(100)
        .getMany();

      for (const { key: sealKey, value } of seals) {
        if (value && value.expiresAt) {
          const oldExpiresAt = new Date(value.expiresAt).getTime();
          const newExpiresAt = oldExpiresAt + pauseDuration;

          await kvs.set(sealKey, {
            ...value,
            expiresAt: new Date(newExpiresAt).toISOString(),
          });

          console.info(
            `Extended seal ${sealKey.replace("protection-", "")}: expiresAt += ${Math.round(pauseDuration / 1000)}s`,
          );
        }
      }

      data.autoUnlockPausedAt = null;
    }

    await kvs.set("admin-settings-global", data);
    return { success: true };
  } else if (scope === "space" && key) {
    const sanitizedRealmKey = key.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    await kvs.set(`admin-settings-space-${sanitizedRealmKey}`, data);
    return { success: true };
  }

  return { success: false };
};

/**
 * Get global admin settings
 */
const loadGlobalRuleset = async () => {
  const ruleset = await kvs.get("admin-settings-global");
  return (
    ruleset || {
      autoUnlockEnabled: true,
      defaultLockDuration: BASELINE_HOLD_SPAN,
      reminderIntervalDays: 7,
      // Notification settings
      enableToastNotifications: true,
      enablePageBanners: true,
      enableConfluenceNotifications: true,
      enableEmailNotifications: false,
      enableLockExpiryReminderEmail: false,
      enableAutoUnlockNotificationEmail: false,
      enablePeriodicReminderEmail: false,
      // Panel settings
      allowArtifactDelete: false,
    }
  );
};

/**
 * Update global admin settings
 */
const storeGlobalRuleset = async (req) => {
  const { settings } = req.payload;
  await kvs.set("admin-settings-global", settings);
  return { success: true };
};

/**
 * Get realm-specific admin settings
 */
const loadRealmRuleset = async (req) => {
  const { spaceKey } = req.payload;
  const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
  const ruleset = await kvs.get(`admin-settings-space-${sanitizedRealmKey}`);
  return (
    ruleset || {
      autoUnlockTimeoutHours: null,
      overrideGlobalSettings: false,
    }
  );
};

/**
 * Update realm-specific admin settings
 */
const storeRealmRuleset = async (req) => {
  const { spaceKey, settings } = req.payload;
  const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
  await kvs.set(`admin-settings-space-${sanitizedRealmKey}`, settings);
  return { success: true };
};

/**
 * Get all realm settings (for realm admin page)
 */
const enumerateRealmRulesets = async () => {
  try {
    const { results: keys } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("admin-settings-space-"))
      .limit(100)
      .getMany();
    const realmRulesets = await Promise.all(
      keys.map(async ({ key }) => {
        const ruleset = await kvs.get(key);
        const realmKey = key.replace("admin-settings-space-", "");
        return {
          spaceKey: realmKey,
          settings: ruleset || {},
        };
      }),
    );
    return realmRulesets;
  } catch (error) {
    console.error("Error fetching all realm rulesets:", error);
    return [];
  }
};

/**
 * Delete realm settings
 */
const discardRealmRuleset = async (req) => {
  const { spaceKey } = req.payload;
  const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
  await kvs.delete(`admin-settings-space-${sanitizedRealmKey}`);
  return { success: true };
};

export const actions = [
  ["load-policy", loadPolicy],
  ["store-policy", storePolicy],
  ["load-global-ruleset", loadGlobalRuleset],
  ["store-global-ruleset", storeGlobalRuleset],
  ["load-realm-ruleset", loadRealmRuleset],
  ["store-realm-ruleset", storeRealmRuleset],
  ["enumerate-realm-rulesets", enumerateRealmRulesets],
  ["discard-realm-ruleset", discardRealmRuleset],
];
