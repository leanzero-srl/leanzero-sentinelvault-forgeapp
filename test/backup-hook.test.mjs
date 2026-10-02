// Pillar 12: "a backup on every save through ONE hook". Every resolver action registered by a
// capsule must be classified in backup/hook.js as a WRITE (schedules a backup) or a READ — a new
// write path that nobody classified would silently never trigger a backup. Static: reads the
// capsules' `actions` arrays from source (the capsules pull @forge/* and cannot load under node).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { WRITE_ACTIONS, READ_ACTIONS, succeeded } from "../src/server/capsules/backup/hook.js";
import { validateBackupOp } from "../src/server/capsules/backup/rest-validate.js";
import { OPS, BACKUP_OPS, opRoleFloor } from "../src/server/capsules/config-api/admission.js";

const here = dirname(fileURLToPath(import.meta.url));
const capsules = resolve(here, "../src/server/capsules");
const keys = new Set();
for (const dir of readdirSync(capsules)) {
  let body = "";
  try { body = readFileSync(resolve(capsules, dir, "actions.js"), "utf8"); } catch (_) { continue; }
  for (const m of body.matchAll(/\[\s*"([a-z0-9-]+)",\s*\w+\s*\]/g)) keys.add(m[1]);
}
ok("found the registered actions (sanity)", keys.size >= 150);
for (const k of keys) ok(`action "${k}" is classified as a write or a read in backup/hook.js`, WRITE_ACTIONS.includes(k) || READ_ACTIONS.includes(k));
for (const k of WRITE_ACTIONS) ok(`write action "${k}" still exists`, keys.has(k));
eq("no action is both", WRITE_ACTIONS.filter((k) => READ_ACTIONS.includes(k)), []);
// Registry wiring: the wrapper is applied to WRITE_ACTIONS (one home: registry.js).
const registry = readFileSync(resolve(here, "../src/server/registry.js"), "utf8");
ok("registry wraps WRITE_ACTIONS with withBackupHook", /WRITE_ACTIONS\.includes\(key\)\) wrapped = withBackupHook\(key, wrapped\)/.test(registry));
ok("registry registers the backup capsule", registry.includes("...backupActions"));
// The REST bundle path schedules one too.
ok("config-api consumer schedules a backup after an applied bundle", /scheduleBackup\("rest-bundle"\)/.test(readFileSync(resolve(capsules, "config-api/consumer.js"), "utf8")));

eq("success shapes", [succeeded({ success: true }), succeeded({ ok: true }), succeeded(undefined), succeeded({ success: false }), succeeded({ error: "x" }), succeeded([])], [true, true, false, false, false, true]);

// ── REST: every backup op is a config-api op, admin only, body validated ──
for (const op of BACKUP_OPS) {
  ok(`op ${op} is accepted by the trigger`, OPS.includes(op));
  eq(`op ${op} needs the admin role`, opRoleFloor(op, "editor"), "admin");
}
eq("whoami stays open to a viewer", opRoleFloor("whoami", "admin"), "viewer");
eq("backup with no body is valid", validateBackupOp("backup", {}).ok, true);
eq("restore preview is valid", validateBackupOp("restore", { preview: true }).ok, true);
eq("restore with a junk generation id is refused", validateBackupOp("restore", { generationId: "../../x" }).ok, false);
eq("export needs a page", validateBackupOp("export", {}).ok, false);
eq("import needs a page and an attachment", validateBackupOp("import", { pageId: "1" }).ok, false);
eq("import with both is valid", validateBackupOp("import", { pageId: "123", attachmentId: "att456" }).ok, true);
eq("backup-location needs a space key", validateBackupOp("backup-location", { spaceKey: "" }).ok, false);
eq("a non-object body is refused", validateBackupOp("backup", [1]).ok, false);
eq("receiptPageId must be a page id", validateBackupOp("backup", { receiptPageId: "x" }).ok, false);
// The hourly check runs only in the Confluence installation (the app is also installed in Jira).
const worker = readFileSync(resolve(capsules, "backup/worker.js"), "utf8");
ok("the sweep refuses a non-Confluence installation", /if \(!isConfluenceInstall\(context\)\) \{[^\n]*return; \}/.test(worker));
ok("boot passes the cron's context to the sweep", /backupSweep\(context \|\| event\?\.context\)/.test(readFileSync(resolve(here, "../src/boot.js"), "utf8")));
report("backup-hook");
