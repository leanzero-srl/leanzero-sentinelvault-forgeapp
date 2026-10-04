// "Delete the backup" must really delete it, and say so when it cannot (2026-10-04).
// Live probe (dev hook endpointProbe, wolfaenpak): v2 DELETE /pages/{id} → 401 "scope does not
// match" (needs delete:page:confluence, not in the manifest), v1 DELETE /content/{id} → 410, v1
// DELETE /content/{id}/pageTree → 202 then the page reads "trashed". Every caller used to ignore
// the result and report success. A trashed app-restricted page answers 404 to a site admin and
// is not in their space-trash listing, so the page is EMPTIED (files purged) before it is trashed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { pageDeleteState } from "../src/server/capsules/backup/store.js";

eq("404 → gone", pageDeleteState(404, null), "gone");
eq("200 trashed → trashed", pageDeleteState(200, { status: "trashed" }), "trashed");
eq("200 current → current", pageDeleteState(200, { status: "current" }), "current");
eq("401 → unknown (never read as deleted)", pageDeleteState(401, { status: "trashed" }), "unknown");
eq("200 without a body → unknown", pageDeleteState(200, null), "unknown");

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, "../src/server/capsules/backup", p), "utf8");
const store = read("store.js");
const fnBody = store.slice(store.indexOf("export async function deletePage"), store.indexOf("export async function emptyAndTrashBackupPage"));
ok("deletePage uses the pageTree door (write:confluence-content)", /route`\/wiki\/rest\/api\/content\/\$\{pageId\}\/pageTree`/.test(fnBody));
ok("deletePage confirms by reading the page back", /pageDeleteState\(/.test(fnBody));
ok("no v2 page DELETE anywhere in the store (needs a scope the app lacks)", !/route`\/wiki\/api\/v2\/pages\/\$\{pageId\}`,\s*\{\s*method:\s*"DELETE"/.test(store));
ok("createBackupPage's cleanup checks the delete and throws with the page id", /const d = await deletePage\(pageId\)[\s\S]{0,200}if \(!d\.ok\)/.test(store));
const empty = store.slice(store.indexOf("export async function emptyAndTrashBackupPage"), store.indexOf("export async function readIndex"));
ok("emptying purges every file before trashing", /for \(const a of await listAttachments\(pageId\)\)[\s\S]*deleteFile\(a\.id\)/.test(empty) && empty.indexOf("deleteFile") < empty.indexOf("deletePage(pageId)"));
ok("a file that will not go stops the trash (the backup stays usable)", /if \(failed\) return \{ ok: false/.test(empty));

const actions = read("actions.js");
ok("backup-delete is a queued job (can outlast 25 s)", /startJob\("delete", \{\}, req\.context\.accountId\)/.test(actions));
const worker = read("worker.js");
ok("the job empties then trashes each page", /store\.emptyAndTrashBackupPage\(b\.pageId\)/.test(worker));
ok("a surviving page fails the job and keeps the location row", /if \(failed\.length\) \{\s*return \{ ok: false/.test(worker) && worker.indexOf("if (failed.length) {") < worker.indexOf("await kvs.delete(SETTINGS_KEY)"));
ok("relocate no longer swallows the old page's delete", !/store\.deletePage\(before\.pageId\)\.catch\(\(\) => \{\}\)/.test(worker));
ok("relocate empties the old page and reports it", /store\.emptyAndTrashBackupPage\(before\.pageId\)/.test(worker) && /oldPage = \{ pageId: before\.pageId, removed: !!d\.ok/.test(worker));
// The hourly check must not undo a delete (review 2026-10-04): with no status row it used to
// queue a "schedule" backup, and ensureBackupPage created a NEW page within the hour.
const { sweepReason } = await import("../src/server/capsules/backup/worker.js");
const NOW = Date.parse("2026-10-04T12:00:00Z");
eq("sweep: deleted on purpose, nothing changed -> no backup", sweepReason({ deletedAt: "2026-10-04T11:00:00Z" }, false, NOW), null);
eq("sweep: deleted, then a change -> backup (the dialog's promise)", sweepReason({ deletedAt: "2026-10-04T11:00:00Z" }, true, NOW), "save");
eq("sweep: deleted long ago, still nothing changed -> no backup", sweepReason({ deletedAt: "2026-01-01T00:00:00Z" }, false, NOW), null);
eq("sweep: never backed up (fresh install) -> schedule", sweepReason({}, false, NOW), "schedule");
eq("sweep: last check 2 h ago -> nothing", sweepReason({ lastCheckAt: "2026-10-04T10:00:00Z" }, false, NOW), null);
eq("sweep: last check 25 h ago -> schedule", sweepReason({ lastCheckAt: "2026-10-03T11:00:00Z" }, false, NOW), "schedule");
eq("sweep: dirty -> save", sweepReason({ lastCheckAt: "2026-10-04T11:59:00Z" }, true, NOW), "save");
ok("delete leaves a deletedAt status row instead of no row", /kvs\.set\(STATUS_KEY, \{ deletedAt: nowIso\(\)/.test(worker) && !/kvs\.delete\(STATUS_KEY\)/.test(worker));
const engine = read("engine.js");
ok("a recorded backup clears deletedAt (both status writes that set lastBackup)", (engine.match(/const \{ deletedAt: _d, deletedBy: _b, \.\.\.prev(Status)? \} = \(await kvs\.get\(STATUS_KEY\)\) \|\| \{\};/g) || []).length === 2);
report("backup-delete");
