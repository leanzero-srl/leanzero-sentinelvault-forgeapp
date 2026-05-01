import { kvs } from "@forge/kvs";
import { DISPATCH_DEFAULTS } from "../shared/baseline.js";

/**
 * Resolve notification feature flags from steward settings.
 *
 * The KVS keys are kept under their historical names (`enableEmailDispatches`,
 * `enableSealExpiryReminderEmail`, `enableAutoUnsealDispatchEmail`,
 * `enablePeriodicReminderEmail`) so existing installations keep their values.
 * The exported flag names reflect the current, native-comment behavior.
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
      ENABLE_TOAST_DISPATCHES: stewardConfig?.enableFlashMessages !== false,
      ENABLE_PAGE_BANNERS: stewardConfig?.enableDocRibbons !== false,
      ENABLE_CONFLUENCE_BULLETINS:
        stewardConfig?.enableConfluenceDispatches !== false,
      ENABLE_NATIVE_NOTIFICATIONS:
        stewardConfig?.enableEmailDispatches !== false,
      ENABLE_HALFWAY_REMINDER_NOTICE:
        stewardConfig?.enableSealExpiryReminderEmail !== false,
      ENABLE_EXPIRY_NOTICE:
        stewardConfig?.enableAutoUnsealDispatchEmail !== false,
      ENABLE_PERIODIC_REMINDER_BANNER:
        stewardConfig?.enablePeriodicReminderEmail !== false,
    };
  } catch (error) {
    console.error("Error fetching notification flags, using defaults:", error);
    return DISPATCH_DEFAULTS;
  }
}
