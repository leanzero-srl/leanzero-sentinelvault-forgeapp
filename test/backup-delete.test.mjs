// "Delete the backup" must really delete it, and say so when it cannot (2026-10-04).
// Live probe (dev hook endpointProbe, wolfaenpak): v2 DELETE /pages/{id} → 401 "scope does not
// match" (needs delete:page:confluence, not in the manifest), v1 DELETE /content/{id} → 410, v1
// DELETE /content/{id}/pageTree → 202 then the page reads "trashed". Every caller used to ignore
// the result and report success.
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
const fnBody = store.slice(store.indexOf("export async function deletePage"), store.indexOf("export async function readIndex"));
ok("deletePage uses the pageTree door (write:confluence-content)", /route`\/wiki\/rest\/api\/content\/\$\{pageId\}\/pageTree`/.test(fnBody));
ok("deletePage confirms by reading the page back", /pageDeleteState\(/.test(fnBody));
ok("no v2 page DELETE anywhere in the store (needs a scope the app lacks)", !/route`\/wiki\/api\/v2\/pages\/\$\{pageId\}`,\s*\{\s*method:\s*"DELETE"/.test(store));
ok("createBackupPage's cleanup checks the delete and throws with the page id", /const d = await deletePage\(pageId\)[\s\S]{0,200}if \(!d\.ok\)/.test(store));

const actions = read("actions.js");
ok("backup-delete reads each outcome", /outcomes\.push\(\{ pageId: b\.pageId, \.\.\.\(await store\.deletePage\(b\.pageId\)\) \}\)/.test(actions));
ok("backup-delete returns success:false when a page survived", /if \(failed\.length\) \{\s*return \{ success: false/.test(actions));
ok("backup-delete keeps the location row when a page survived", actions.indexOf("if (failed.length)") < actions.indexOf("await kvs.delete(SETTINGS_KEY)"));

const worker = read("worker.js");
ok("relocate no longer swallows the old page's delete", !/store\.deletePage\(before\.pageId\)\.catch\(\(\) => \{\}\)/.test(worker));
ok("relocate reports the old page in its result", /oldPage = \{ pageId: before\.pageId, removed: !!d\.ok/.test(worker));
report("backup-delete");
