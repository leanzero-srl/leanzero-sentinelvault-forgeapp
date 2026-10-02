// Renders docs/RELEASE-NOTES.md from src/server/shared/release-notes.js (the one source).
// Usage: node scripts/render-release-notes.mjs [--check]   (--check exits 1 when the doc is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_NOTES } from "../src/server/shared/release-notes.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/RELEASE-NOTES.md");
const lines = ["# Sentinel Vault — release notes", "", "GENERATED from `src/server/shared/release-notes.js` by `scripts/render-release-notes.mjs`. Do not edit.", ""];
for (const n of RELEASE_NOTES) {
  lines.push(`## ${n.version} — ${n.date}${n.status === "testing" ? " (in testing, not yet on the Marketplace)" : ""}`, "", `**${n.headline}**`, "");
  for (const c of n.changes || []) lines.push(`- ${c}`);
  if (n.fixes?.length) { lines.push("", "Fixed:"); for (const f of n.fixes) lines.push(`- ${f}`); }
  if (n.action) lines.push("", `**Do this:** ${n.action}`);
  if (n.reconstructed) lines.push("", "_Written after the release, from the Marketplace listing text._");
  lines.push("");
}
const text = lines.join("\n");
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch (_) { /* missing */ }
  if (cur !== text) { console.error("docs/RELEASE-NOTES.md is stale — run node scripts/render-release-notes.mjs"); process.exit(1); }
  console.log("release notes doc: current");
} else { writeFileSync(out, text); console.log(`wrote ${out}`); }
