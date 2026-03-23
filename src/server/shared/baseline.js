/**
 * Bulletin feature flags
 * Set to false to disable any bulletin feature
 */
export const DISPATCH_DEFAULTS = {
  // Option 1: Toast dispatches via showFlag (frontend)
  ENABLE_TOAST_DISPATCHES: true,

  // Option 2: Page banners (frontend)
  ENABLE_PAGE_BANNERS: true,

  // Option 3: Native Confluence bulletins via comments
  ENABLE_CONFLUENCE_BULLETINS: true,

  // Option 4: Email bulletins via Resend
  ENABLE_EMAIL_BULLETINS: true,

  // Option 4A: Seal expiry reminder email (sent when sealing)
  ENABLE_SEAL_EXPIRY_REMINDER_EMAIL: true,

  // Option 4B: Auto-unseal bulletin email (sent when cleaned up)
  ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL: true,

  // Option 4C: Periodic reminder email (sent every X days when auto-unseal is disabled)
  ENABLE_PERIODIC_REMINDER_EMAIL: true,
};

/**
 * Storage key for Confluence webhook ID
 */
export const WEBHOOK_STORAGE_KEY = "confluence-webhook-id";

/**
 * Default seal duration in seconds (2 days / 48 hours)
 */
export const BASELINE_HOLD_SPAN = 2 * 24 * 60 * 60;

// Note: RESEND_CONFIG has been moved to src/server/internal/mail-transport.js
// to keep email credentials in a single, secure location.
// Use SENDER_ADDRESS export from there for the fallback sender address.
