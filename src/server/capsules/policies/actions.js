import { kvs, WhereConditions } from "@forge/kvs";

// Import from shared
import { BASELINE_HOLD_SPAN, MAX_HOLD_SECONDS, withinHoldBounds } from "../../shared/baseline.js";
import { isOperatorSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";

// SECURITY (audit A1): these resolvers write admin-settings-* — including the steward list
// (adminUsers) and the force-override toggle — so an UNGATED write is a full privilege
// escalation (any reader could make themselves a steward/admin). Gate every write, mirroring
// realms/actions.js:approveStewardRequest. A site-admin may bootstrap a brand-new space's
// first steward, so space writes accept steward-OF-that-space OR site-admin.
const DENY = { success: false, reason: "Not authorized — steward or admin access required." };
const canWriteGlobal = async (accountId) => !!accountId && (await isOperatorSiteAdmin(accountId));
const canWriteSpace = async (accountId, key) =>
  !!accountId && ((await isOperatorSteward(accountId, key)) || (await isOperatorSiteAdmin(accountId)));

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
        // Macro auto-insert settings
        globalAutoInsertMacro: false,
        replaceAttachmentsMacro: false,
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
  const caller = req.context?.accountId;

  // B14: validate seal-duration bounds at the WRITE boundary (the it55 guard lived in the dead
  // policies/logic.js:savePolicyRuleset). null = "unset / inherit" so only a present non-null numeric
  // value is checked. defaultLockDuration is SECONDS; autoUnlockTimeoutHours is HOURS. The seal path
  // also clamps (sanitizeHoldDuration) as a backstop; this just gives the admin immediate feedback.
  if (data && data.defaultLockDuration != null && !withinHoldBounds(data.defaultLockDuration)) {
    return { success: false, reason: `Default seal duration must be a positive number of seconds up to ${MAX_HOLD_SECONDS}.` };
  }
  if (data && data.autoUnlockTimeoutHours != null && !withinHoldBounds(data.autoUnlockTimeoutHours * 3600)) {
    return { success: false, reason: `Auto-unseal timeout must be a positive number of hours up to ${Math.floor(MAX_HOLD_SECONDS / 3600)}.` };
  }

  if (scope === "global") {
    if (!(await canWriteGlobal(caller))) return DENY;
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

      // Extend all seal expiry times by the pause duration.
      // it55: cursor-paginate — a single limit(100) getMany() silently missed every seal beyond the
      // first 100, so on an instance with >100 seals those would keep their original expiresAt and
      // auto-unseal early by the whole pause duration. Loop the cursor (same pattern as the expiry
      // sweep / recurring-nudge, triggers.js). Cap iterations as a runaway guard.
      let sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100);
      let extended = 0;
      for (let si = 0; si < 200; si++) {
        const { results: seals, nextCursor } = await sq.getMany();
        for (const { key: sealKey, value } of seals || []) {
          if (value && value.expiresAt) {
            const newExpiresAt = new Date(value.expiresAt).getTime() + pauseDuration;
            await kvs.set(sealKey, { ...value, expiresAt: new Date(newExpiresAt).toISOString() });
            extended++;
          }
        }
        if (!nextCursor) break;
        sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100).cursor(nextCursor);
      }
      console.info(`Auto-unseal resume: extended ${extended} seal(s) by ${Math.round(pauseDuration / 1000)}s`);

      data.autoUnlockPausedAt = null;
    }

    // audit A3: MERGE, don't overwrite — a partial settings save (e.g. the toggles) must not
    // drop keys it omits (notably the steward list `adminUsers`/`adminGroups`, or the
    // pause/resume `autoUnlockPausedAt`).
    await kvs.set("admin-settings-global", { ...(currentRuleset || {}), ...data });
    return { success: true };
  } else if (scope === "space" && key) {
    if (!(await canWriteSpace(caller, key))) return DENY;
    const sanitizedRealmKey = key.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const currentSpace = await kvs.get(`admin-settings-space-${sanitizedRealmKey}`);
    await kvs.set(`admin-settings-space-${sanitizedRealmKey}`, { ...(currentSpace || {}), ...data });
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
      // Macro auto-insert settings
      globalAutoInsertMacro: false,
      replaceAttachmentsMacro: false,
    }
  );
};

/**
 * Update global admin settings
 */
const storeGlobalRuleset = async (req) => {
  const { settings } = req.payload;
  if (!(await canWriteGlobal(req.context?.accountId))) return DENY;
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
  if (!(await canWriteSpace(req.context?.accountId, spaceKey))) return DENY;
  const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
  await kvs.set(`admin-settings-space-${sanitizedRealmKey}`, settings);
  return { success: true };
};

/**
 * Get all realm settings (for realm admin page)
 */
// SECURITY (audit B15): this CROSS-SPACE enumeration returns every space's admin-settings —
// including each space's steward list (adminUsers) + policy. It was ungated (the handler didn't
// even accept `req`), so ANY logged-in user could name the action via the router and harvest the
// steward/admin roster for the whole site. Gate it like the write siblings, but with the GLOBAL
// (site-admin) gate — a steward of one space must not read other spaces' rosters. Deny → [] so a
// non-admin caller degrades to "no realms" rather than an error (mirrors the catch below).
export const enumerateRealmRulesets = async (req) => {
  if (!(await canWriteGlobal(req?.context?.accountId))) return [];
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
  if (!(await canWriteSpace(req.context?.accountId, spaceKey))) return DENY;
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
