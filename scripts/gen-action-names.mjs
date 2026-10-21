#!/usr/bin/env node
/*
 * Regenerates the two name lists the action log (src/server/shared/action-log.js) is allowed to print.
 *
 * WHY. An action log line must never carry user data: no account ids, names, emails, space keys,
 * page titles, file names, content or free text. The safest proof is by construction: every word a
 * line can contain is a string that appears LITERALLY in this app's own (public) source code. This
 * script collects those literals; the runtime refuses anything that is not composed of them.
 *
 *   src/ui/kit/ui-action-ids.gen.js        the control names the UI may report (frontend trail)
 *     STATIC    data-testid / data-lz / testId literals ("pd-close", "sv-decline")
 *     PREFIXES  the head of a templated test id (`pd-tab-${id}` -> "pd-tab-")
 *     SUFFIXES  the tail of an id built on a testId prop (`${testId}-confirm` -> "confirm")
 *     LITERALS  code-defined ids in src/ui ("overview", "extend"): the only dynamic parts a templated
 *               id may keep, and only for ui-action-names.js CODE_ONLY_PREFIXES ("pd-tab-overview");
 *               anything else becomes "head-*"
 *   src/server/shared/action-reasons.gen.js   refusal sentences written literally in src/server
 *               (`reason: "This file is not sealed"`): a refusal is logged by its slug only when its
 *               text is exactly one of these; a sentence built at runtime (a name in it) never is.
 *
 * Both files are COMMITTED. test/action-log.test.mjs regenerates them in memory and fails when the
 * committed copy is stale, so a new button or refusal never silently falls out of the log.
 * Run: node scripts/gen-action-names.mjs   (no arguments; writes both files)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI_OUT = join(ROOT, "src/ui/kit/ui-action-ids.gen.js");
const SERVER_OUT = join(ROOT, "src/server/shared/action-reasons.gen.js");

const walk = (dir, exts, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e)) && !p.endsWith(".gen.js")) out.push(p);
  }
  return out.sort();
};

// A control name: lowercase words joined by "-" (what every test id in this app looks like).
export const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_ID = 64;
const okId = (s) => typeof s === "string" && s.length <= MAX_ID && ID_RE.test(s);

/** The brace-balanced expression that starts at `i` (the "{" after `attr=`). */
function braceExpr(src, i) {
  let depth = 0;
  for (let j = i; j < src.length && j < i + 400; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return "";
}

export function collectUi(files) {
  const STATIC = new Set(), PREFIXES = new Set(), SUFFIXES = new Set(), LITERALS = new Set();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // data-testid="x" / data-lz="x" / testId="x" / testPrefix="x" / testId: "x"
    for (const m of src.matchAll(/(?:data-testid|data-lz|testId|testPrefix)\s*[=:]\s*"([^"]*)"/g)) if (okId(m[1])) STATIC.add(m[1]);
    // data-testid={...} / data-lz={...}: literals inside, template heads and testId tails
    for (const m of src.matchAll(/(?:data-testid|data-lz)\s*=\s*\{/g)) {
      const expr = braceExpr(src, m.index + m[0].length - 1);
      for (const s of expr.matchAll(/"([^"]*)"/g)) if (okId(s[1])) STATIC.add(s[1]);
      for (const t of expr.matchAll(/`([^`]*)`/g)) {
        const tpl = t[1];
        const head = tpl.split("${")[0];
        if (head && head.endsWith("-") && okId(head.slice(0, -1))) PREFIXES.add(head);
        // `${testId}-confirm` / `${testPrefix}-choice`: a fixed tail on a prop literal
        const tail = tpl.match(/^\$\{\s*(?:testId|testPrefix)\s*\}-([a-z0-9-]+)$/);
        if (tail && okId(tail[1])) SUFFIXES.add(tail[1]);
      }
    }
    // code-defined ids that feed a templated test id: `id: "x"` / `key: "x"` / `value: "x"` (option and
    // role lists) and the first item of a `["x", "Label"]` pair (tab lists)
    for (const m of src.matchAll(/\b(?:id|key|value|kind|mode)\s*:\s*"([a-z][a-z0-9-]{1,31})"/g)) if (okId(m[1])) LITERALS.add(m[1]);
    for (const m of src.matchAll(/\[\s*"([a-z][a-z0-9-]{1,31})"\s*,\s*["'`]/g)) if (okId(m[1])) LITERALS.add(m[1]);
    // keys of label maps (`{ extend: "Extend the seal", "give-access": "Give edit access…" }`)
    for (const m of src.matchAll(/[{,]\s*("?)([a-z][a-z0-9-]{1,31})\1\s*:\s*"[^"]*"/g)) if (okId(m[2])) LITERALS.add(m[2]);
  }
  const sort = (s) => [...s].sort();
  return { STATIC: sort(STATIC), PREFIXES: sort(PREFIXES), SUFFIXES: sort(SUFFIXES), LITERALS: sort(LITERALS) };
}

export function collectReasons(files) {
  const REASONS = new Set();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:reason|error)\s*:\s*"([^"\\\n]{3,200})"\s*[,}\n)]/g)) REASONS.add(m[1]);
  }
  return [...REASONS].sort();
}

const HEADER = (what) => `/*
 * GENERATED by scripts/gen-action-names.mjs — do NOT hand-edit. ${what}
 * Every string here is a literal from this app's own source; the action log may print nothing else.
 * test/action-log.test.mjs fails when this file is stale: re-run the script and commit the result.
 */
`;

export function renderUi(data) {
  const arr = (name) => `export const ${name} = Object.freeze(${JSON.stringify(data[name])});\n`;
  return HEADER("The UI control names (frontend trail).") + arr("STATIC") + arr("PREFIXES") + arr("SUFFIXES") + arr("LITERALS");
}

export function renderReasons(reasons) {
  return HEADER("The refusal sentences written literally in src/server.") + `export const REASONS = Object.freeze(${JSON.stringify(reasons, null, 0)});\n`;
}

export function generate() {
  const ui = renderUi(collectUi(walk(join(ROOT, "src/ui"), [".js", ".jsx"])));
  const reasons = renderReasons(collectReasons(walk(join(ROOT, "src/server"), [".js"])));
  return { ui, reasons };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ui, reasons } = generate();
  writeFileSync(UI_OUT, ui);
  writeFileSync(SERVER_OUT, reasons);
  console.log(`wrote ${UI_OUT.slice(ROOT.length + 1)} (${ui.length} bytes) and ${SERVER_OUT.slice(ROOT.length + 1)} (${reasons.length} bytes)`);
}

export const OUT = { UI_OUT, SERVER_OUT };
