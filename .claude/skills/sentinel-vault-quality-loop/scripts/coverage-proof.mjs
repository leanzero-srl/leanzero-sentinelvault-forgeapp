#!/usr/bin/env node
// coverage-proof.mjs — parsed (never hand-maintained) inventory-vs-evidence coverage proof.
//
// Inventory (parsed fresh every run):
//   1. Resolver keys — the actions = [["key", fn]] arrays in src/server/capsules/*/actions.js
//      plus literal router.define("key", ...) calls in src/server/registry.js.
//   2. Test-hook seams — what === "..." verbs and fn === "..." invoke seams in src/test-hook.js.
//   3. manifest.yml — trigger events (avi:*), scheduledTrigger / consumer / webtrigger / UI
//      module keys (macro, confluence:pageBanner, confluence:globalSettings, confluence:spacePage,
//      confluence:contentBylineItem, ... — every module type except `function` and `llm` plumbing).
//
// Evidence sources:
//   A. Harness specs: $SV_HARNESS (default ~/Projects/forge-live-harness)/scenarios/sentinel-vault/*.spec.ts
//   B. App e2e:      test-harness/scripts/*.mjs
//   C. App unit:     test/*.test.mjs
//
// Matching (coverage tiers: string-verified > annotated > uncovered):
//   - resolver keys / manifest keys / events: literal token with identifier boundaries
//     (so "seal-artifact" does NOT match inside "unseal-artifact").
//   - testhook fn seams:  fn: "name" / fn="name" / ?fn=name
//   - testhook what verbs: what: "verb" / ?what=verb  (plain word match would drown in
//     false positives for verbs like "set"/"delete"/"query").
//   - PLUS optional annotations in evidence files:  // @covers item1 item2
//     Every claimed token MUST resolve to a real inventory item (exact id or unique short
//     name) — unresolvable/ambiguous claims are hard errors (exit 1).
//
// Output:
//   state/COVERAGE-PROOF.md   — human table grouped by capsule/module
//   state/coverage-proof.json — machine-readable
//
// --check mode:
//   Reads state/coverage-baseline.json (creates it on first run: every current gap recorded
//   as {item, reason: "unreviewed-baseline"}). Exits 1 if any item is uncovered and NOT in
//   the baseline — which also catches a previously-covered item regressing to uncovered,
//   since covered items are never baselined. Stale baseline entries (now covered) are
//   reported as prune candidates, not failures.
//
// Dependency-free: node stdlib only.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, "..");
const APP_ROOT = path.resolve(SCRIPT_DIR, "../../../..");
const STATE_DIR = path.join(SKILL_ROOT, "state");
const HARNESS_ROOT = process.env.SV_HARNESS || path.join(os.homedir(), "Projects", "forge-live-harness");

const CHECK_MODE = process.argv.includes("--check");

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const listFiles = (dir, suffix) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().map((f) => path.join(dir, f))
    : [];

// ---------------------------------------------------------------------------
// 1. Inventory
// ---------------------------------------------------------------------------
// item: { id, short, group, matchers: RegExp[], coveredBy: [], annotatedBy: [] }
const inventory = [];
const warnings = [];

const boundary = (token) => new RegExp(`(?<![\\w-])${esc(token)}(?![\\w-])`);

function addItem(id, short, group, matchers) {
  if (inventory.some((i) => i.id === id)) return; // defensive: no dupes
  inventory.push({ id, short, group, matchers, coveredBy: [], annotatedBy: [] });
}

// --- 1a. resolver keys from capsule actions.js + registry.js -----------------
const capsulesDir = path.join(APP_ROOT, "src", "server", "capsules");
const capsuleDirs = fs.existsSync(capsulesDir)
  ? fs.readdirSync(capsulesDir).filter((d) => fs.existsSync(path.join(capsulesDir, d, "actions.js"))).sort()
  : [];
if (!capsuleDirs.length) warnings.push(`no capsules found under ${capsulesDir}`);

for (const cap of capsuleDirs) {
  const src = fs.readFileSync(path.join(capsulesDir, cap, "actions.js"), "utf8");
  const m = src.match(/export const actions\s*=\s*\[([\s\S]*?)\n\];/);
  if (!m) {
    warnings.push(`capsule ${cap}: no "export const actions = [...]" array found`);
    continue;
  }
  for (const pair of m[1].matchAll(/\[\s*["']([^"']+)["']\s*,/g)) {
    addItem(`resolver:${pair[1]}`, pair[1], `resolver/${cap}`, [boundary(pair[1])]);
  }
}
const registrySrc = readIf(path.join(APP_ROOT, "src", "server", "registry.js")) || "";
for (const m of registrySrc.matchAll(/router\.define\(\s*["']([^"']+)["']/g)) {
  addItem(`resolver:${m[1]}`, m[1], "resolver/registry", [boundary(m[1])]);
}

// --- 1b. test-hook what verbs + fn invoke seams ------------------------------
const hookSrc = readIf(path.join(APP_ROOT, "src", "test-hook.js"));
if (hookSrc === null) warnings.push("src/test-hook.js not found");
for (const m of (hookSrc || "").matchAll(/what\s*===\s*["']([^"']+)["']/g)) {
  const verb = m[1];
  addItem(`testhook:what:${verb}`, verb, "testhook/what-verbs", [
    new RegExp(`["']?what["']?\\s*[:=]\\s*["']${esc(verb)}["']|[?&]what=${esc(verb)}(?![\\w-])`),
  ]);
}
for (const m of (hookSrc || "").matchAll(/fn\s*===\s*["']([^"']+)["']/g)) {
  const fn = m[1];
  // Plain boundary literal — fn names are distinctive camelCase, and specs reference them
  // both quoted (inv("watchArtifact", ...)) and bare in header comments.
  addItem(`testhook:fn:${fn}`, fn, "testhook/invoke-seams", [boundary(fn)]);
}

// --- 1c. manifest.yml modules ------------------------------------------------
const manifestSrc = readIf(path.join(APP_ROOT, "manifest.yml"));
if (manifestSrc === null) warnings.push("manifest.yml not found");
const SKIP_TYPES = new Set(["function", "llm"]);
const fnHandlers = {}; // function-module key -> handler
{
  let inModules = false;
  let curType = null;
  let curItem = null; // { type, key, fn, events: [] }
  const manifestItems = [];
  const flush = () => { if (curItem) manifestItems.push(curItem); curItem = null; };
  for (const raw of (manifestSrc || "").split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^\S/.test(line)) { flush(); inModules = /^modules\s*:/.test(line); curType = null; continue; }
    if (!inModules) continue;
    const typeM = line.match(/^ {2}([^\s#][^:]*(?::[^\s#:]+)?)\s*:\s*$/); // "  macro:" / "  confluence:pageBanner:"
    if (typeM && !line.trim().startsWith("-")) { flush(); curType = typeM[1]; continue; }
    if (!curType) continue;
    const itemM = line.match(/^ {4}- (.*)$/);
    if (itemM) {
      flush();
      curItem = { type: curType, key: null, fn: null, events: [] };
      const kv = itemM[1].match(/^(\w[\w-]*)\s*:\s*(.+?)\s*$/);
      if (kv && kv[1] === "key") curItem.key = kv[2];
      continue;
    }
    if (!curItem) continue;
    const propM = line.match(/^ {6}(\w[\w-]*)\s*:\s*(.*?)\s*$/); // item-level prop only (indent 6)
    if (propM) {
      if (propM[1] === "key" && !curItem.key) curItem.key = propM[2];
      if (propM[1] === "handler") curItem.handler = propM[2];
      if (propM[1] === "function" && propM[2]) curItem.fn = propM[2];
      continue;
    }
    const evM = line.match(/^\s*-\s+(avi:\S+)/);
    if (evM) curItem.events.push(evM[1]);
  }
  flush();

  for (const it of manifestItems) if (it.type === "function" && it.key && it.handler) fnHandlers[it.key] = it.handler;

  for (const it of manifestItems) {
    if (SKIP_TYPES.has(it.type)) continue;
    if (it.type === "trigger") {
      for (const ev of it.events) addItem(`event:${ev}`, ev, "manifest/trigger-events", [boundary(ev)]);
      continue;
    }
    if (!it.key) continue;
    const matchers = [boundary(it.key)];
    // parsed alias: the boot.* handler name behind the module's function, if any
    const handler = it.fn && fnHandlers[it.fn];
    if (handler) matchers.push(boundary(handler.replace(/^boot\./, "")));
    addItem(`manifest:${it.type}:${it.key}`, it.key, `manifest/${it.type}`, matchers);
  }
}

// ---------------------------------------------------------------------------
// 2. Evidence
// ---------------------------------------------------------------------------
const evidence = []; // { label, content }
const harnessSpecDir = path.join(HARNESS_ROOT, "scenarios", "sentinel-vault");
if (!fs.existsSync(harnessSpecDir)) warnings.push(`harness spec dir not found: ${harnessSpecDir} (set SV_HARNESS)`);
for (const f of listFiles(harnessSpecDir, ".spec.ts")) evidence.push({ label: `harness/${path.basename(f)}`, content: fs.readFileSync(f, "utf8") });
for (const f of listFiles(path.join(APP_ROOT, "test-harness", "scripts"), ".mjs")) evidence.push({ label: `e2e/${path.basename(f)}`, content: fs.readFileSync(f, "utf8") });
for (const f of listFiles(path.join(APP_ROOT, "test"), ".test.mjs")) evidence.push({ label: `unit/${path.basename(f)}`, content: fs.readFileSync(f, "utf8") });
if (!evidence.length) warnings.push("no evidence files found at all");

// ---------------------------------------------------------------------------
// 3. Match — literal strings, then @covers annotations
// ---------------------------------------------------------------------------
const COVERS_LINE = /^[ \t]*(?:\/\/|#)[ \t]*@covers[ \t]+(.+)$/gm;
for (const ev of evidence) {
  // @covers lines are claims, not evidence — strip them so an annotation naming an item
  // literally cannot inflate that item to the string-verified tier.
  const searchable = ev.content.replace(COVERS_LINE, "");
  for (const item of inventory) {
    if (item.matchers.some((re) => re.test(searchable))) item.coveredBy.push(ev.label);
  }
}

const invalidClaims = []; // { file, token, why }
const byId = new Map(inventory.map((i) => [i.id, i]));
const byShort = new Map();
for (const i of inventory) byShort.set(i.short, byShort.has(i.short) ? "AMBIGUOUS" : i);

for (const ev of evidence) {
  for (const line of ev.content.matchAll(COVERS_LINE)) {
    for (const token of line[1].split(/[\s,]+/).filter(Boolean)) {
      let item = byId.get(token);
      if (!item) {
        const s = byShort.get(token);
        if (s === "AMBIGUOUS") { invalidClaims.push({ file: ev.label, token, why: "ambiguous short name — use the full item id" }); continue; }
        item = s;
      }
      if (!item) { invalidClaims.push({ file: ev.label, token, why: "resolves to no inventory item" }); continue; }
      if (!item.annotatedBy.includes(ev.label)) item.annotatedBy.push(ev.label);
    }
  }
}

for (const item of inventory) {
  item.tier = item.coveredBy.length ? "string-verified" : item.annotatedBy.length ? "annotated" : "uncovered";
}

// ---------------------------------------------------------------------------
// 4. Reports
// ---------------------------------------------------------------------------
fs.mkdirSync(STATE_DIR, { recursive: true });
const counts = {
  total: inventory.length,
  stringVerified: inventory.filter((i) => i.tier === "string-verified").length,
  annotated: inventory.filter((i) => i.tier === "annotated").length,
  gaps: inventory.filter((i) => i.tier === "uncovered").length,
};
const now = new Date().toISOString();

const jsonOut = {
  generatedAt: now,
  appRoot: APP_ROOT,
  harnessRoot: HARNESS_ROOT,
  evidenceFiles: evidence.map((e) => e.label),
  counts,
  items: inventory.map(({ id, short, group, tier, coveredBy, annotatedBy }) => ({ id, short, group, tier, coveredBy, annotatedBy })),
  invalidClaims,
  warnings,
};
fs.writeFileSync(path.join(STATE_DIR, "coverage-proof.json"), JSON.stringify(jsonOut, null, 2) + "\n");

const groups = [...new Set(inventory.map((i) => i.group))].sort();
const evList = (item) => {
  const all = [...item.coveredBy, ...item.annotatedBy.filter((a) => !item.coveredBy.includes(a)).map((a) => `${a} (annotated)`)];
  return all.length > 6 ? all.slice(0, 6).join(", ") + ` … +${all.length - 6} more` : all.join(", ");
};
let md = `# Coverage Proof — Sentinel Vault\n\n`;
md += `Generated ${now} by \`scripts/coverage-proof.mjs\` (parsed inventory — never hand-maintained; do not edit).\n\n`;
md += `**${counts.total} inventory items** — ${counts.stringVerified} string-verified, ${counts.annotated} annotated, ${counts.gaps} gaps.\n`;
md += `Evidence: ${evidence.length} files (harness specs, app e2e scripts, unit tests).\n\n`;
for (const g of groups) {
  const items = inventory.filter((i) => i.group === g);
  const gGaps = items.filter((i) => i.tier === "uncovered").length;
  md += `## ${g} (${items.length} items, ${gGaps} gaps)\n\n| Item | Coverage | Evidence |\n|---|---|---|\n`;
  for (const i of items) {
    md += i.tier === "uncovered"
      ? `| \`${i.short}\` | **GAP** | — |\n`
      : `| \`${i.short}\` | ${i.tier} | ${evList(i)} |\n`;
  }
  md += `\n`;
}
if (invalidClaims.length) {
  md += `## INVALID @covers CLAIMS (errors)\n\n`;
  for (const c of invalidClaims) md += `- \`${c.token}\` in ${c.file}: ${c.why}\n`;
  md += `\n`;
}
if (warnings.length) {
  md += `## Warnings\n\n`;
  for (const w of warnings) md += `- ${w}\n`;
  md += `\n`;
}
fs.writeFileSync(path.join(STATE_DIR, "COVERAGE-PROOF.md"), md);

// ---------------------------------------------------------------------------
// 5. --check gate + summary line
// ---------------------------------------------------------------------------
let exitCode = 0;
let checkNote = "";
if (invalidClaims.length) {
  exitCode = 1;
  for (const c of invalidClaims) console.error(`INVALID @covers claim "${c.token}" in ${c.file}: ${c.why}`);
}

if (CHECK_MODE) {
  const baselinePath = path.join(STATE_DIR, "coverage-baseline.json");
  const gaps = inventory.filter((i) => i.tier === "uncovered").map((i) => i.id);
  if (!fs.existsSync(baselinePath)) {
    const baseline = { createdAt: now, note: "auto-created on first --check run; each entry is an accepted gap", gaps: gaps.map((item) => ({ item, reason: "unreviewed-baseline" })) };
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    checkNote = ` | baseline CREATED with ${gaps.length} unreviewed gaps`;
  } else {
    let baseline;
    try { baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")); } catch (e) {
      console.error(`cannot parse ${baselinePath}: ${e.message}`);
      process.exit(1);
    }
    const baselined = new Set((baseline.gaps || []).map((g) => g.item));
    const unknownBaseline = [...baselined].filter((id) => !byId.has(id));
    for (const id of unknownBaseline) console.error(`WARNING: baseline entry "${id}" matches no inventory item (renamed/removed?) — prune it`);
    const newGaps = gaps.filter((id) => !baselined.has(id)); // covers both brand-new items and regressions of once-covered items
    const stale = [...baselined].filter((id) => byId.has(id) && byId.get(id).tier !== "uncovered");
    if (stale.length) console.error(`INFO: ${stale.length} baselined item(s) now covered — prune from baseline: ${stale.join(", ")}`);
    if (newGaps.length) {
      exitCode = 1;
      for (const id of newGaps) console.error(`NEW GAP (not baselined): ${id}`);
    }
    checkNote = ` | check: ${newGaps.length} new gaps, ${gaps.length - newGaps.length} baselined, ${stale.length} stale baseline entries`;
  }
}

console.log(
  `coverage-proof: ${counts.total} items | ${counts.stringVerified} string-verified | ${counts.annotated} annotated | ${counts.gaps} gaps | ${invalidClaims.length} invalid claims${checkNote}`
);
process.exit(exitCode);
