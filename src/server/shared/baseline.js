// lapse-policy.js has zero imports (it says so on purpose), so this edge cannot form a cycle.
import { LAPSE_NOTICE_LIMIT_DEFAULT, LAPSE_NOTICE_INTERVAL_MS_DEFAULT } from "./lapse-policy.js";
// edit-cooldown.js is zero-import too.
import { EDIT_COOLDOWN_HOURS_DEFAULT } from "./edit-cooldown.js";

/**
 * Default notification feature flags (UX review 2026-09-14 §4.2, P1-4).
 *
 * The app has NO egress: nothing here sends email. "Notification" means a Confluence footer
 * comment that @mentions someone; Confluence itself then notifies (and, per the recipient's own
 * preferences, may email) that person. In-app channels (toast, ribbon) are ALWAYS on by default;
 * the comment channel is OPT-IN. A site that explicitly saved a key keeps its value — these
 * defaults only apply to a never-saved key (see resolveBulletinToggles).
 */
export const DISPATCH_DEFAULTS = {
  // Toast dispatches via showFlag (frontend, in-app). ON: a violation / seal event shows a toast.
  ENABLE_TOAST_DISPATCHES: true,

  // Page ribbons (frontend, in-app). ON: the page ribbon lists recent dispatches.
  ENABLE_PAGE_BANNERS: true,

  // Violation footnote comment (persisted key `enableConfluenceDispatches`). ON: a tamper on a
  // sealed attachment / section posts a footer comment on the page (deduped 24h per page/target).
  // Only meaningful together with ENABLE_NATIVE_NOTIFICATIONS. OPT-IN.
  ENABLE_CONFLUENCE_BULLETINS: false,

  // Master switch for every comment that @mentions people (persisted key `enableEmailDispatches`).
  // ON: seal created/released/forced, edit requests, approvals, validations and violations each
  // post a page comment mentioning the people involved, which Confluence may email them. OPT-IN.
  ENABLE_NATIVE_NOTIFICATIONS: false,

  // 50% seal reminder + seal-confirmation comment (`enableSealExpiryReminderEmail`). ON: with the
  // master on, the owner gets a comment when the seal is created and again at half-time.
  ENABLE_HALFWAY_REMINDER_NOTICE: true,

  // Lapse / auto-release comments (`enableAutoUnsealDispatchEmail`). ON: with the master on, the
  // owner gets the overdue reminders and the auto-release comment.
  ENABLE_EXPIRY_NOTICE: true,

  // Daily ribbon for long-held seals (`enablePeriodicReminderEmail`; ribbon-only, no comment).
  ENABLE_PERIODIC_REMINDER_BANNER: true,

  // Editor's own "your change was undone" comment (`notifyEditorOnRevert`). NOT under the master:
  // the person who lost published work is told, with a link to the version that holds it.
  NOTIFY_EDITOR_ON_REVERT: true,
};

/**
 * Storage key for Confluence webhook ID
 */
export const WEBHOOK_STORAGE_KEY = "confluence-webhook-id";

/**
 * Default seal duration in seconds (2 days / 48 hours)
 */
export const BASELINE_HOLD_SPAN = 2 * 24 * 60 * 60;

/**
 * Upper bound for a seal hold span (100 years — safely inside the JS Date ±8.64e15ms range).
 */
export const MAX_HOLD_SECONDS = 100 * 365 * 24 * 60 * 60;

/**
 * B14: is `raw` a valid, in-bounds seal hold span in seconds? Used to VALIDATE stored policy values
 * (store-policy) so an admin gets immediate feedback, alongside the seal-time clamp (sanitizeHoldDuration).
 */
export function withinHoldBounds(raw) {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= MAX_HOLD_SECONDS;
}

/**
 * it55: sanitize a (dev/API-only) `lockDuration` payload into a safe seal hold span (seconds).
 * The seal UI never sends lockDuration, but a direct `seal-artifact` invocation could pass a
 * negative value (→ a PAST expiresAt: a "sealed" record with ZERO protection, returned as success),
 * a non-numeric string (→ NaN → `new Date(...).toISOString()` throws a 500), or an absurd value
 * (→ exceeds the JS Date ±8.64e15ms range → also throws). Accept only a positive, finite, sane
 * number of seconds; otherwise fall back to the baseline hold span.
 */
export function sanitizeHoldDuration(raw, baseline = BASELINE_HOLD_SPAN) {
  return withinHoldBounds(raw) ? Math.floor(raw) : baseline;
}

/**
 * Engine defaults for the policy keys the consoles show (UX review 2026-09-14 §3, P2). ONE copy:
 * `load-policy` seeds a never-saved site from this object and the consoles print "Effective
 * default: …" from it, so a UI seed can no longer contradict what the engine actually does (the
 * 24 h-vs-48 h and force-unseal OFF-vs-ON contradictions the review found). Each value is the one
 * the ENGINE reader applies to an absent key — the reader is cited next to it. Keys the engine
 * reads with `=== true` are opt-IN; keys read with `!== false` are opt-OUT (see settings-schema).
 *
 * The two literals still held inline by triggers.js (`reminderIntervalDays || 7` at the recurring
 * nudge, `autoUnlockEnabled !== false`) agree with these values; triggers.js is outside the P2
 * edit set, so the constants here are the documented mirror, not yet its import.
 */
export const POLICY_DEFAULTS = Object.freeze({
  // Seal duration in SECONDS (policies/logic.js:getSealDuration → BASELINE_HOLD_SPAN).
  defaultLockDuration: BASELINE_HOLD_SPAN,
  // steward-checks.js:211 / entitlements/actions.js:58 — `!== false` → ON.
  allowAdminOverride: true,
  // triggers.js:2259,2551 — `!== false` → ON (seals expire; owners are noticed, then released).
  autoUnlockEnabled: true,
  // triggers.js:2552 — recurring banner every N days when seals never expire.
  reminderIntervalDays: 7,
  // lapse-policy.js — reminders before the auto-release, and the gap between them.
  lapseNoticeLimit: LAPSE_NOTICE_LIMIT_DEFAULT,
  lapseNoticeIntervalHours: LAPSE_NOTICE_INTERVAL_MS_DEFAULT / 3600000,
  // panels/actions.js:37-40, sealing/actions.js:63-65 — `=== true` → OFF.
  allowArtifactDelete: false,
  allowSealRestore: false,
  allowSealPurge: false,
  // triggers.js:289 — `!== false` → ON.
  enableContentProtection: true,
  // doc-surgery.js:497,503 — `=== true` → OFF.
  globalAutoInsertMacro: false,
  replaceAttachmentsMacro: false,
  // bulletin-flags.js (DISPATCH_DEFAULTS is the flag-named twin of these four).
  enableFlashMessages: DISPATCH_DEFAULTS.ENABLE_TOAST_DISPATCHES,
  enableDocRibbons: DISPATCH_DEFAULTS.ENABLE_PAGE_BANNERS,
  enableConfluenceDispatches: DISPATCH_DEFAULTS.ENABLE_CONFLUENCE_BULLETINS,
  enableEmailDispatches: DISPATCH_DEFAULTS.ENABLE_NATIVE_NOTIFICATIONS,
  enableSealExpiryReminderEmail: DISPATCH_DEFAULTS.ENABLE_HALFWAY_REMINDER_NOTICE,
  enableAutoUnsealDispatchEmail: DISPATCH_DEFAULTS.ENABLE_EXPIRY_NOTICE,
  enablePeriodicReminderEmail: DISPATCH_DEFAULTS.ENABLE_PERIODIC_REMINDER_BANNER,
  notifyEditorOnRevert: DISPATCH_DEFAULTS.NOTIFY_EDITOR_ON_REVERT,
  // shared/seal-signature.js — `=== true` → OFF: seal actions are unsigned unless a site opts in.
  signSealActions: false,
  // shared/edit-cooldown.js — hours a person waits after a declined edit request (0 = none).
  editRequestCooldownHours: EDIT_COOLDOWN_HOURS_DEFAULT,
});

/** Space-scope defaults (doc-surgery.js:528,534; policies/logic.js:getSealDuration; notice-policy). */
export const SPACE_POLICY_DEFAULTS = Object.freeze({
  autoUnlockTimeoutHours: null, // null = the site's default seal duration
  autoInsertMacro: true, // `=== false` opts out → ON
  macroInsertPosition: "bottom", // anything but "top" → bottom
  notificationsMode: "normal",
});
