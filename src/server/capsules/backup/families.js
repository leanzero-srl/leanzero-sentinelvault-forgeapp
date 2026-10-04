/*
 * Backup — which Forge storage keys are the customer's setup (PURE, no Forge import).
 *
 * Pillar 12 (docs/BACKUP-AND-RESTORE.md): everything an admin or a user CONFIGURED or PROTECTED is
 * mirrored to a backup that survives an uninstall; secrets never are; caches and bookkeeping are
 * rebuilt by the app and are left out. This table is the ONE place that decides it. Every key
 * family the code writes must appear here — `test/backup-families.test.mjs` scans the source for
 * key prefixes and fails the build on one this table does not know, so a new family cannot ship
 * silently unprotected (or a new secret silently backed up).
 *
 * Classes:
 *   config   backed up and restored. `label` is what the admin reads in the preview.
 *            `index: true` marks a lookup table the app keeps beside a primary record: it is backed up
 *            (several have no rebuild path) but the preview counts it apart, not as user data.
 *   secret   NEVER backed up. The restore names what must be re-entered (`secretNote`).
 *   runtime  not backed up: caches, markers, cursors, job rows, dedup windows — the app rebuilds
 *            them, and restoring a stale one is worse than starting clean (a stale "processing"
 *            scan status would stop the hourly index rebuild for that space for good).
 *
 * Matching is longest-prefix-wins, so `ai-finding-state-` (a user's triage decisions, config)
 * beats `ai-finding-` (write-only history, runtime). A key no row matches is backed up and
 * reported as "Other app data": losing an unknown family is the worse failure.
 */

/** Key families. `prefix` matches with startsWith; an exact key is listed as its own prefix. */
export const FAMILIES = Object.freeze([
  // ── configuration ────────────────────────────────────────────────────────────────────────
  { prefix: "admin-settings-global", cls: "config", group: "settings", label: "Site settings" },
  { prefix: "admin-settings-space-", cls: "config", group: "settings", label: "Space settings" },
  { prefix: "validation-config-", cls: "config", group: "validation", label: "Validation rules" },
  { prefix: "workflow-def-", cls: "config", group: "workflow", label: "Workflow definitions" },
  { prefix: "workflow-settings-", cls: "config", group: "workflow", label: "Workflow settings per space" },
  { prefix: "classification-levels", cls: "config", group: "classification", label: "Classification levels" },
  { prefix: "classification-space-", cls: "config", group: "classification", label: "Space classification defaults" },
  { prefix: "classification-page-", cls: "config", group: "classification", label: "Page classifications" },
  { prefix: "classification-assets-link", cls: "config", group: "classification", label: "Classification levels linked to JSM Assets" },
  // ── protection state the users created ──────────────────────────────────────────────────
  { prefix: "protection-", cls: "config", group: "seals", label: "Sealed files" },
  { prefix: "section-protection-", cls: "config", group: "seals", label: "Sealed sections" },
  { prefix: "section-snapshot-", cls: "config", group: "seals", label: "Sealed section baselines" },
  { prefix: "space-protection-", cls: "config", group: "seals", index: true, label: "Sealed-file index per space" },
  { prefix: "space-section-protection-", cls: "config", group: "seals", index: true, label: "Sealed-section index per space" },
  { prefix: "edit-grant-", cls: "config", group: "access", label: "Edit access granted on sealed files" },
  { prefix: "section-edit-grant-", cls: "config", group: "access", label: "Edit access granted on sealed sections" },
  { prefix: "edit-request-", cls: "config", group: "access", label: "Edit requests on sealed files" },
  { prefix: "section-edit-request-", cls: "config", group: "access", label: "Edit requests on sealed sections" },
  { prefix: "editreq-owner-", cls: "config", group: "access", index: true, label: "Edit-request inbox index" },
  { prefix: "sectionreq-owner-", cls: "config", group: "access", index: true, label: "Section edit-request inbox index" },
  { prefix: "editreq-mine-", cls: "config", group: "access", index: true, label: "\"My requests\" index" },
  { prefix: "steward-request-", cls: "config", group: "access", label: "Space-admin access requests" },
  { prefix: "stewardreq-space-", cls: "config", group: "access", index: true, label: "Space-admin request index" },
  { prefix: "notify-request-", cls: "config", group: "access", label: "\"Tell me when it is released\" watches" },
  // ── document workflow ───────────────────────────────────────────────────────────────────
  { prefix: "workflow-state-", cls: "config", group: "workflow", label: "Page workflow states" },
  { prefix: "workflow-pending-", cls: "config", group: "workflow", label: "Open approval requests" },
  { prefix: "workflow-approval-", cls: "config", group: "workflow", label: "Approval decisions" },
  { prefix: "workflow-idx-", cls: "config", group: "workflow", index: true, label: "Workflow dashboard index" },
  { prefix: "workflow-inbox-", cls: "config", group: "workflow", index: true, label: "Approver inbox index" },
  { prefix: "wfreq-mine-", cls: "config", group: "workflow", index: true, label: "\"Approvals you asked for\" index" },
  { prefix: "workflow-log-", cls: "config", group: "history", label: "Workflow history" },
  { prefix: "read-ack-", cls: "config", group: "workflow", label: "Read confirmations" },
  // ── validation state ────────────────────────────────────────────────────────────────────
  { prefix: "validation-lastgood-", cls: "config", group: "validation", label: "Last passing version per page" },
  { prefix: "ai-finding-state-", cls: "config", group: "validation", label: "AI review triage decisions" },
  { prefix: "ai-latest-", cls: "config", group: "validation", label: "Latest AI review per page" },
  { prefix: "ai-usage-", cls: "config", group: "validation", label: "AI budget used this month" },
  // ── history ─────────────────────────────────────────────────────────────────────────────
  { prefix: "activity-page-", cls: "config", group: "history", label: "Activity history (pages)" },
  { prefix: "activity-space-", cls: "config", group: "history", label: "Activity history (spaces)" },
  { prefix: "activity-site-", cls: "config", group: "history", label: "Activity history (site)" },

  // ── secrets: never leave KVS ────────────────────────────────────────────────────────────
  // sig-secret- / sig-enroll- live in the KVS SECRET namespace since 2026-10-04 (a plain row is
  // a pre-migration leftover); sig-device- is the plain "has a device" marker the scan can see.
  { prefix: "sig-secret-", cls: "secret", secretNote: "authenticator" },
  { prefix: "sig-enroll-", cls: "secret", secretNote: "authenticator" },
  { prefix: "sig-device-", cls: "secret", secretNote: "authenticator" },
  { prefix: "sig-last-", cls: "secret" },
  { prefix: "sig-fail-", cls: "secret" },
  { prefix: "api-tokens", cls: "secret", secretNote: "api-tokens" },
  { prefix: "api-token-revoked:", cls: "secret" },

  // ── runtime: rebuilt by the app ─────────────────────────────────────────────────────────
  { prefix: "app-account-id", cls: "runtime" },
  { prefix: "macro-extension-key", cls: "runtime" },
  { prefix: "section-macro-extension-key", cls: "runtime" },
  { prefix: "webtrigger-url:", cls: "runtime" },
  { prefix: "confluence-webhook-id", cls: "runtime" },
  { prefix: "protections-last-", cls: "runtime" },
  { prefix: "space-scan-status-", cls: "runtime" },
  { prefix: "page-guard-", cls: "runtime" },
  { prefix: "section-restore-pending-", cls: "runtime" },
  { prefix: "section-insert-pending-", cls: "runtime" },
  { prefix: "section-adopt-claim-", cls: "runtime" },
  { prefix: "violation-noticed-", cls: "runtime" },
  { prefix: "violation-alert-", cls: "runtime" },
  { prefix: "notification-", cls: "runtime" },
  { prefix: "recent-notifications", cls: "runtime" },
  { prefix: "expiry-notified-", cls: "runtime" },
  { prefix: "fifty-percent-reminder-sent-", cls: "runtime" },
  { prefix: "reminder-sent-", cls: "runtime" },
  { prefix: "workflow-review-notified-", cls: "runtime" },
  { prefix: "workflow-integrity-notified-", cls: "runtime" },
  { prefix: "workflow-autoassigned-", cls: "runtime" },
  { prefix: "workflow-completing-", cls: "runtime" },
  { prefix: "workflow-label-", cls: "runtime" },
  { prefix: "validation-checked-", cls: "runtime" },
  { prefix: "ai-validation-status-", cls: "runtime" },
  { prefix: "ai-finding-", cls: "runtime" },
  { prefix: "byline-stamp-", cls: "runtime" },
  { prefix: "byline-fanout-", cls: "runtime" },
  { prefix: "api-job-", cls: "runtime" },
  { prefix: "api-active-", cls: "runtime" },
  { prefix: "harness-", cls: "runtime" },
  // The backup's own bookkeeping (status, debounce flag, jobs, import staging, paused list).
  { prefix: "backup-", cls: "runtime" },
  // The privacy sweep's status, lock and account index (capsules/privacy) — rebuilt by the next sweep.
  { prefix: "privacy-", cls: "runtime" },
]);

const BY_LENGTH = [...FAMILIES].sort((a, b) => b.prefix.length - a.prefix.length);
export const OTHER_FAMILY = Object.freeze({ prefix: "", cls: "config", group: "other", label: "Other app data" });

/** PURE. The family a key belongs to (longest prefix wins); unknown keys → OTHER_FAMILY. */
export function familyOf(key) {
  const k = String(key || "");
  for (const f of BY_LENGTH) if (k.startsWith(f.prefix)) return f;
  return OTHER_FAMILY;
}

/** PURE. Is this key part of the backup? */
export const isBackedUp = (key) => familyOf(key).cls === "config";

/** PURE. Families grouped for the "what survives" card and the preview. */
export const GROUP_LABELS = Object.freeze({
  settings: "Site and space settings",
  seals: "Sealed files and sections",
  access: "Edit access and requests",
  workflow: "Document workflow",
  validation: "Validations and AI review",
  classification: "Classification",
  history: "Activity and workflow history",
  other: "Other app data",
});
