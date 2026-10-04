/*
 * Backup — the ONE save hook. registry.js wraps every resolver in WRITE_ACTIONS with
 * `withBackupHook`; the config-API consumer calls `scheduleBackup` after a job that applied
 * anything. A save does not run a backup: it raises a flag (`backup-dirty`) and queues ONE
 * delayed backup, so twenty saves in a minute cost one backup, and the save itself pays one KVS
 * read. The hourly sweep (worker.js) catches what no resolver saw (page events, sweeps, expiry).
 *
 * Every registered action must be classified below — test/backup-hook.test.mjs reads the
 * capsules' action keys from source and fails on one that is in neither list, so a new write
 * path cannot skip the backup by being forgotten here.
 */
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { setWithTtl } from "../../shared/kvs-ttl.js";

export const BACKUP_QUEUE_KEY = "backup-queue";
export const DIRTY_KEY = "backup-dirty";
const DEBOUNCE_SECONDS = 90;
const DIRTY_TTL_MS = 2 * 3600000; // a lost queue event cannot wedge the flag: the sweep runs anyway

/** Actions that change what the backup holds. */
export const WRITE_ACTIONS = Object.freeze([
  "acknowledge-dispatch", "approve-edit-request", "approve-page-gate", "approve-section-edit", "approve-steward-request",
  "assign-workflow", "bulk-assign-workflow", "classification-assets-import", "classification-assets-set-link",
  "classification-manage-levels", "classification-set-page", "classification-set-space-default", "confirm-read",
  "confirm-signature-enrollment", "create-api-token", "decide-approval", "delete-artifact", "delete-space-workflow",
  "deny-edit-request", "deny-section-edit", "deny-steward-request", "enqueue-page-validation", "enroll-signature",
  "extend-seal", "extend-section", "flush-operator-dispatches", "grant-edit-access", "grant-section-edit", "guard-page-now",
  "label-artifact", "launch-realm-audit", "purge-seal-record", "recheck-page-validation", "refresh-section-snapshot",
  "release-copied-section", "remove-workflow", "request-edit-access", "request-section-edit", "request-steward-access",
  "request-transition", "rerequest-approval", "restore-sealed-artifact", "revoke-api-token", "revoke-edit-grant",
  "revoke-section-edit-grant", "revoke-signature", "save-workflow-bundle", "seal-artifact", "seal-section",
  "section-insert-intent", "set-ai-finding-state", "set-review-due", "set-space-workflow-settings", "steward-unseal",
  "store-doc-panel-prefs", "store-policy", "store-space-workflow", "store-validation-config", "store-workflow-config",
  "unlabel-artifact", "unseal-artifact", "unseal-section", "unwatch-artifact", "upload-artifact", "validate-page-now",
  "watch-artifact", "withdraw-approval",
]);

/** Actions that only read (or that ARE the backup's own doors, which schedule nothing). */
export const READ_ACTIONS = Object.freeze([
  "check-audit-status", "check-edit-request", "check-license", "check-panel-status", "check-seal-stamp", "check-section-edit",
  "check-steward-request", "check-user-role", "check-watch", "classification-assets-attributes", "classification-assets-link",
  "classification-assets-object-types", "classification-assets-preview", "classification-assets-schemas",
  "classification-get-page", "classification-list-spaces", "classification-provider", "classification-space-default",
  "count-my-work", "current-operator", "discover-panel-key", "enumerate-doc-artifacts", "enumerate-operator-seals",
  "enumerate-operators", "enumerate-page-seals", "enumerate-panel-artifacts", "enumerate-realm-rulesets",
  "enumerate-realm-seals", "enumerate-section-seals", "enumerate-teams", "export-site-config", "export-space-config",
  "get-ai-findings", "get-api-job", "get-page-activity", "get-page-approvals", "get-page-workflow", "get-read-report",
  "get-read-status", "get-space-activity", "get-space-workflow-settings", "get-validation-audit", "get-validation-job",
  "get-validation-state", "get-workflow-dashboard", "get-workflow-log", "identify-operator", "identify-realm",
  "list-ai-models", "list-api-jobs", "list-api-tokens", "list-breach-dispatches", "list-edit-grants", "list-edit-requests",
  "list-my-approval-requests", "list-my-approvals", "list-my-edit-requests", "list-my-requests",
  "list-my-section-edit-requests", "list-my-steward-requests", "list-page-headings", "list-section-edit-grants",
  "list-section-edit-requests", "list-space-workflows", "list-steward-requests", "load-bulletin-toggles", "load-policy",
  "load-session", "load-validation-config", "load-workflow-config", "operator-dispatches", "page-details-summary",
  "recent-dispatches", "resolve-artifact-preview", "ribbon-summary", "search-grantees", "search-operators",
  "search-workflow-groups", "search-workflow-users", "section-seal-status", "signature-status", "steward-override-enabled",
  "workflow-seals-to-freeze",
  // the backup's own doors
  "backup-status", "backup-discover", "backup-now", "backup-preview", "backup-restore", "backup-decline", "backup-job", "backup-export",
  "backup-export-part", "backup-import-part", "backup-import-commit", "backup-set-location", "backup-delete",
  "backup-resume-automations", "backup-history",
  // the privacy sweep's doors: the sweep itself schedules a backup when it deleted anything
  "privacy-status", "privacy-run-now",
]);

/**
 * Raise the flag and queue one delayed backup — unless one is already pending. Never throws: a
 * save must not fail because the backup could not be scheduled (the sweep is the backstop).
 */
export async function scheduleBackup(reason = "save") {
  try {
    if (await kvs.get(DIRTY_KEY)) return false;
    await setWithTtl(DIRTY_KEY, { since: new Date().toISOString(), reason }, DIRTY_TTL_MS);
    await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "backup", reason }, delayInSeconds: DEBOUNCE_SECONDS });
    return true;
  } catch (e) {
    console.warn("[BACKUP] could not schedule a backup after a save:", e?.message || e);
    return false;
  }
}

/** PURE. Did the resolver report success? (the shapes this codebase returns) */
export const succeeded = (r) => !(r == null || r === false || (typeof r === "object" && (r.success === false || r.ok === false || r.error)));

/** Wrap a write resolver: run it, then schedule a backup if it succeeded. */
export const withBackupHook = (key, fn) => async (req) => {
  const result = await fn(req);
  if (succeeded(result)) await scheduleBackup(key);
  return result;
};
