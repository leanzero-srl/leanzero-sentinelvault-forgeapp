/**
 * Default notification feature flags. Notifications flow through Confluence
 * footer comments with @mentions; Confluence's notification engine emails
 * the recipient when their preferences allow it.
 */
export const DISPATCH_DEFAULTS = {
  // Toast dispatches via showFlag (frontend)
  ENABLE_TOAST_DISPATCHES: true,

  // Page banners (frontend)
  ENABLE_PAGE_BANNERS: true,

  // Native Confluence comments (footnote-style audit comments)
  ENABLE_CONFLUENCE_BULLETINS: true,

  // Master switch for comment-with-mention notifications
  ENABLE_NATIVE_NOTIFICATIONS: true,

  // 50% seal reminder comment
  ENABLE_HALFWAY_REMINDER_NOTICE: true,

  // Auto-release / seal expiry comment
  ENABLE_EXPIRY_NOTICE: true,

  // Daily banner for long-held seals (banner-only, no comment)
  ENABLE_PERIODIC_REMINDER_BANNER: true,
};

/**
 * Storage key for Confluence webhook ID
 */
export const WEBHOOK_STORAGE_KEY = "confluence-webhook-id";

/**
 * Default seal duration in seconds (2 days / 48 hours)
 */
export const BASELINE_HOLD_SPAN = 2 * 24 * 60 * 60;
