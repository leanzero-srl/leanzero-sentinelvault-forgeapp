// Confluence endpoints MEASURED dead for this app (dev hook fn=endpointProbe, wolfaenpak,
// 2026-10-04) must not come back. Each row names what it answered and what replaced it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { sameAttachmentId } from "../src/server/infra/attachment-status.js";
import { isGroupId } from "../src/server/capsules/workflow/approvals.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../src/server");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
walk(root);
const lines = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ where: `${f.slice(root.length + 1)}:${i + 1}`, l })))
  .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l));

const DEAD = [
  { name: "v1 GET /content/{id}?status=trashed (410 for current, trashed and purged alike)", re: /route`\/wiki\/rest\/api\/content\/\$\{[^}]+\}\?status=trashed`/ },
  { name: "v1 GET /group/member?name= (401 scope does not match; not in the v1 spec)", re: /\/wiki\/rest\/api\/group\/member\?/ },
  { name: "v1 /content/{id} with no sub-path (410 Gone for Forge)", re: /route`\/wiki\/rest\/api\/content\/\$\{[^}]+\}`/ },
  { name: "v2 DELETE /pages/{id} (401: needs delete:page:confluence, not in the manifest)", re: /route`\/wiki\/api\/v2\/pages\/\$\{[^}]+\}(\?purge=true)?`,\s*\{\s*method:\s*"DELETE"/ },
];
for (const d of DEAD) {
  const hits = lines.filter(({ l }) => d.re.test(l)).map(({ where }) => where);
  eq(`no ${d.name}`, hits, []);
}

// Known 401, kept on purpose and reported (an authorization arm; changing it grants rights):
// POST /wiki/rest/api/space/{key}/permission/check. It fails CLOSED. Pin the count so a NEW
// use is a deliberate decision, not a copy-paste.
const spaceCheck = lines.filter(({ l }) => /\/wiki\/rest\/api\/space\/\$\{[^}]+\}\/permission\/check/.test(l)).map(({ where }) => where);
eq("space permission/check stays at its two known, fail-closed uses", spaceCheck.length, 2);

eq("att prefix ignored", sameAttachmentId("att123", "123"), true);
eq("same with prefix", sameAttachmentId("att123", "att123"), true);
eq("different ids", sameAttachmentId("att123", "att124"), false);
eq("empty never matches", sameAttachmentId("", ""), false);
eq("null never matches", sameAttachmentId(null, null), false);
eq("group picker id is a group id", isGroupId("9b1bd7bc-281a-4bb5-8ba2-335f9c725833"), true);
eq("a group NAME is not a group id", isGroupId("confluence-users-wolfaenpak"), false);

const status = readFileSync(resolve(root, "infra/attachment-status.js"), "utf8");
ok("purge confirmation lists the page's attachments (current + trashed)", /\/wiki\/api\/v2\/pages\/\$\{pageId\}\/attachments\?status=current&status=trashed/.test(status));
ok("no page id → not confirmed", /if \(!pageId\) \{[\s\S]{0,200}return false;/.test(status));
report("dead-endpoints");
