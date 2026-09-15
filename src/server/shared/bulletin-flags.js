import { kvs } from "@forge/kvs";
import { DISPATCH_DEFAULTS } from "../shared/baseline.js";
import { NOTIFICATIONS_MODE_NORMAL, normalizeNotificationsMode } from "./notice-policy.js";

/**
 * Resolve notification feature flags from steward settings.
 *
 * The KVS keys are kept under their historical names (`enableEmailDispatches`,
 * `enableSealExpiryReminderEmail`, `enableAutoUnsealDispatchEmail`,
 * `enablePeriodicReminderEmail`) so existing installations keep their values.
 * The exported flag names reflect the current, native-comment behavior. NOTE the word "email"
 * in those keys is historical: the app has no egress and sends no email. A notice is a page
 * comment with an @mention, and it is Confluence that may email the mentioned person.
 *
 * Default profile (UX review 2026-09-14 §4.2): in-app channels (toast, ribbon) default ON; the
 * comment / @mention channel defaults OFF (opt-in). See `DISPATCH_DEFAULTS` in baseline.js.
 *
 * @returns {Promise<Object>} Notification flags:
 *   - ENABLE_TOAST_DISPATCHES
 *   - ENABLE_PAGE_BANNERS
 *   - ENABLE_CONFLUENCE_BULLETINS
 *   - ENABLE_NATIVE_NOTIFICATIONS         (master switch for comment+mention notices)
 *   - ENABLE_HALFWAY_REMINDER_NOTICE      (50% seal reminder comment)
 *   - ENABLE_EXPIRY_NOTICE                (auto-release / expiry comment)
 *   - ENABLE_PERIODIC_REMINDER_BANNER     (daily banner for long-held seals)
 */
export async function resolveBulletinToggles(existingConfig = null) {
  try {
    const stewardConfig = existingConfig || (await kvs.get("admin-settings-global"));

    return {
      // In-app channels: ON unless explicitly switched off.
      // ON: violation / seal events show a toast.
      ENABLE_TOAST_DISPATCHES: stewardConfig?.enableFlashMessages !== false,
      // ON: the page ribbon lists recent dispatches.
      ENABLE_PAGE_BANNERS: stewardConfig?.enableDocRibbons !== false,
      // Comment channel: OPT-IN (P1-4, 2026-09-14) — only an explicit `true` opens it. A site that
      // saved `true` before the flip keeps it; a never-saved site is now silent on the page.
      // ON: a tamper on a sealed attachment / section posts a footer comment on the page.
      ENABLE_CONFLUENCE_BULLETINS:
        stewardConfig?.enableConfluenceDispatches === true,
      // ON (master): seal created / released / forced, edit requests, approvals, validations and
      // violations post a page comment that @mentions the people involved — Confluence itself
      // notifies (and may email) them. OFF: no comment of any kind is posted by the app.
      ENABLE_NATIVE_NOTIFICATIONS:
        stewardConfig?.enableEmailDispatches === true,
      // Sub-switches under the master (ON unless switched off; inert while the master is off).
      // ON: seal-confirmation and half-time reminder comments to the owner.
      ENABLE_HALFWAY_REMINDER_NOTICE:
        stewardConfig?.enableSealExpiryReminderEmail !== false,
      // ON: overdue-reminder and auto-release comments to the owner.
      ENABLE_EXPIRY_NOTICE:
        stewardConfig?.enableAutoUnsealDispatchEmail !== false,
      // ON: daily ribbon for long-held seals (ribbon only, never a comment).
      ENABLE_PERIODIC_REMINDER_BANNER:
        stewardConfig?.enablePeriodicReminderEmail !== false,
    };
  } catch (error) {
    console.error("Error fetching notification flags, using defaults:", error);
    return DISPATCH_DEFAULTS;
  }
}

/**
 * Per-space quiet mode (P1-4). Reads `notificationsMode` from `admin-settings-space-{key}`.
 *
 * Fails OPEN to "normal": a KVS blip must never silently swallow a genuine notice — the cost of
 * one extra comment in a quiet space is far lower than a lost violation notice. The failure is
 * logged so it is visible. A missing / unknown space key is also "normal" (nothing to be quiet
 * about).
 *
 * @param {string|null} spaceKey
 * @returns {Promise<"normal"|"quiet">}
 */
export async function resolveSpaceNotificationsMode(spaceKey) {
  if (!spaceKey) return NOTIFICATIONS_MODE_NORMAL;
  try {
    const sanitized = String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmConfig = await kvs.get(`admin-settings-space-${sanitized}`);
    return normalizeNotificationsMode(realmConfig?.notificationsMode);
  } catch (error) {
    console.error(
      `[NOTIFY] Could not read notificationsMode for space ${spaceKey} — treating as "normal" (fail open):`,
      error,
    );
    return NOTIFICATIONS_MODE_NORMAL;
  }
}
