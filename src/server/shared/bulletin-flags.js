import { kvs } from "@forge/kvs";
import { DISPATCH_DEFAULTS } from "../shared/baseline.js";

/**
 * Get bulletin flags from steward settings with proper defaults
 * This is a centralized utility function to avoid code duplication
 *
 * @returns {Promise<Object>} Bulletin flags object with the following properties:
 *   - ENABLE_TOAST_DISPATCHES: boolean
 *   - ENABLE_PAGE_BANNERS: boolean
 *   - ENABLE_CONFLUENCE_BULLETINS: boolean
 *   - ENABLE_EMAIL_BULLETINS: boolean
 *   - ENABLE_SEAL_EXPIRY_REMINDER_EMAIL: boolean
 *   - ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL: boolean
 *   - ENABLE_PERIODIC_REMINDER_EMAIL: boolean
 */
export async function resolveBulletinToggles(existingConfig = null) {
  try {
    const stewardConfig = existingConfig || await kvs.get("admin-settings-global");

    return {
      ENABLE_TOAST_DISPATCHES:
        stewardConfig?.enableFlashMessages !== false,
      ENABLE_PAGE_BANNERS: stewardConfig?.enableDocRibbons !== false,
      ENABLE_CONFLUENCE_BULLETINS:
        stewardConfig?.enableConfluenceDispatches !== false,
      ENABLE_EMAIL_BULLETINS:
        stewardConfig?.enableEmailDispatches !== false,
      ENABLE_SEAL_EXPIRY_REMINDER_EMAIL:
        stewardConfig?.enableSealExpiryReminderEmail !== false,
      ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL:
        stewardConfig?.enableAutoUnsealDispatchEmail !== false,
      ENABLE_PERIODIC_REMINDER_EMAIL:
        stewardConfig?.enablePeriodicReminderEmail !== false,
    };
  } catch (error) {
    console.error("Error fetching bulletin flags, using defaults:", error);
    // Fall back to constants if config fetch fails
    return DISPATCH_DEFAULTS;
  }
}
