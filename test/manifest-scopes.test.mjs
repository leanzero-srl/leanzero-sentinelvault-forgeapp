// 7.0.0 scope audit (docs/SCOPES-7.0.md): the scopes the app must keep, and the 12 it dropped.
// read:confluence-content.summary looks unused by REST but the five page/attachment triggers
// need it (Forge events reference; `forge lint` permission-scope-required) — the 2026-10-04 trim
// proposal had it on the removal list. Re-adding a dropped scope is a major version: decide it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, report } from "./_assert.mjs";

const manifest = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../manifest.yml"), "utf8");
const scopes = new Set((manifest.split("\n  scopes:\n")[1] || "").split("\n  content:")[0].match(/^ {4}- ([a-z:.-]+)\s*$/gm)?.map((l) => l.trim().slice(2)) || []);
for (const s of ["read:confluence-content.summary", "read:label:confluence", "report:personal-data", "storage:app", "read:confluence-content.all", "write:confluence-content", "write:confluence-file", "write:confluence-props", "read:confluence-content.permission"]) {
  ok(`keeps ${s}`, scopes.has(s));
}
for (const s of ["read:confluence-space.summary", "read:confluence-props", "read:content:confluence", "write:content:confluence", "write:attachment:confluence", "read:comment:confluence", "read:content.property:confluence", "write:content.property:confluence", "read:content.restriction:confluence", "write:content.restriction:confluence", "read:content.metadata:confluence", "read:content.permission:confluence"]) {
  ok(`dropped in 7.0.0: ${s}`, !scopes.has(s));
}
// 8.0 (docs/JIRA-SEALS.md): three Jira scopes for sealing Jira attachments — a major version.
for (const s of ["read:jira-work", "write:jira-work", "read:jira-user"]) ok(`8.0 adds ${s}`, scopes.has(s));
ok("30 scopes", scopes.size === 30);
ok("Jira is an OPTIONAL app of the one installation", /compatibility:\n\s+confluence:\n\s+required: true\n\s+jira:\n\s+required: false/.test(manifest));
report("manifest-scopes");
