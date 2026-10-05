/*
 * PURE. Why a backup generation was taken, in the admin's words (Backup tab). Automatic backups
 * after a change carry the resolver key that changed something ("approve-edit-request",
 * "create-api-token", …) — those read "after a change", never the raw key (found 2026-10-05 in
 * the 7.0.0 live check). No imports, so test/backup-reason.test.mjs runs it in plain node.
 */
export const BACKUP_REASON = Object.freeze({
  manual: "on request", schedule: "daily", save: "after a change", rest: "over REST", "rest-bundle": "after a change over REST",
  "before-restore": "before a restore", "after-restore": "after a restore", moved: "after a move", import: "imported file",
  privacy: "after the personal-data check",
});
export const backupReasonText = (reason) => (reason ? BACKUP_REASON[reason] || "after a change" : "");
