// Baseline pillar 4: every note is well-formed, newest first, unique; the doc is rendered from it.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { RELEASE_NOTES, CURRENT_RELEASE, compareVersions } from "../src/server/shared/release-notes.js";

for (const n of RELEASE_NOTES) {
  ok(`${n.version} is x.y.z`, /^\d+\.\d+\.\d+$/.test(n.version));
  ok(`${n.version} has a real date`, /^\d{4}-\d{2}-\d{2}$/.test(n.date) && !Number.isNaN(Date.parse(n.date)));
  ok(`${n.version} has a headline`, typeof n.headline === "string" && n.headline.length > 10);
  ok(`${n.version} says what changed`, (n.changes?.length || 0) + (n.fixes?.length || 0) > 0);
  ok(`${n.version} names no file or finding id`, !/\.(js|jsx|mjs)\b|SV-SEC|it\d{2}\b/.test(JSON.stringify(n)));
}
for (let i = 1; i < RELEASE_NOTES.length; i++) ok(`newest first: ${RELEASE_NOTES[i - 1].version} > ${RELEASE_NOTES[i].version}`, compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version) > 0);
eq("current release is the first", CURRENT_RELEASE, RELEASE_NOTES[0]);
eq("versions compare numerically", compareVersions("6.10.0", "6.9.9") > 0, true);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fresh = true;
try { execFileSync("node", [resolve(root, "scripts/render-release-notes.mjs"), "--check"], { stdio: "pipe" }); } catch (_) { fresh = false; }
ok("docs/RELEASE-NOTES.md is rendered from the module (run scripts/render-release-notes.mjs)", fresh);
report("release-notes");
