// Guard: no site's data in module scope. One Forge process serves several sites (a warm container that
// ran site A's invocation runs site B's next), so anything a server module keeps at the top level is
// shared between customers. Four memos did exactly that (a page's space key, a person's display name,
// the classification scheme, the app's own account id) and were moved into the invocation
// (shared/confluence-call.js invocationMemo) or the site's own KVS; test/tenant-isolation.test.mjs
// proves the behaviour.
//
// This file fails the build on any NEW module-level holder in the code the server runs (src/ outside
// src/ui, plus every src/ui file the server imports):
//   - a top-level `let`/`var` (any pattern), or a `const` that starts as `new <anything>`, an empty
//     object/array literal, or a call that is not a reviewed pure factory (FACTORIES below);
//   - a write to a module-level binding from inside a function (`x = …`, `x ??= …`, `x++`).
// Each one kept on purpose is listed WITH the reason it cannot carry one site's answer to another; a
// "constant" entry must never be written to after load. Remember a site's answer in invocationMemo, in
// KVS (per installation), or key it by context.installContext, never by a page, space or account id alone.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));
const { parseSync, traverse } = require("@babel/core");
const parse = (src) => parseSync(src, { configFile: false, babelrc: false, sourceType: "module", parserOpts: { plugins: ["jsx"] } });

const CONSTANT = "constant";
const ALLOWED = new Map([
  ["src/server/registry.js:areaOf", [CONSTANT, "resolver key -> capsule area, built once from the static capsule list"]],
  ["src/server/registry.js:router", ["stateless", "the Forge Resolver: its table of definitions is fixed at load"]],
  ["src/server/infra/doc-surgery.js:VOLATILE_ADF_KEYS", [CONSTANT, "fixed ADF attribute names"]],
  ["src/server/infra/doc-surgery.js:BLOCK_NODE_TYPES", [CONSTANT, "fixed ADF node types"]],
  ["src/server/shared/action-log.js:REASON_SET", [CONSTANT, "literal refusal texts of the source (generated)"]],
  ["src/server/shared/action-log.js:OUTCOME_SET", [CONSTANT, "fixed outcome words"]],
  ["src/server/shared/action-log.js:appFacts", ["deployment", "the app version and environment of the code this process runs: the same for every site it serves, never site data"]],
  ["src/server/shared/confluence-call.js:als", ["per-invocation", "AsyncLocalStorage: each invocation runs in its own store"]],
  ["src/server/shared/hook-author.js:als", ["per-invocation", "AsyncLocalStorage entered only by the dev hook, per call"]],
  ["src/server/capsules/bulletins/actions.js:NAMES_EDITOR", [CONSTANT, "fixed notice kinds"]],
  ["src/server/capsules/bulletins/actions.js:NAMES_OWNER", [CONSTANT, "fixed notice kinds"]],
  ["src/server/capsules/policies/settings-schema.js:BY_KEY", [CONSTANT, "settings schema by key, built once from the static control list"]],
  ["src/server/capsules/validations/mirror-scrub.js:MIRROR_FIELDS", [CONSTANT, "fixed field names"]],
  ["src/server/capsules/ribbon/actions.js:byKey", [CONSTANT, "the banner's resolver table, built once from static imports"]],
  ["src/server/capsules/privacy/worker.js:scrubDoneSites", ["per-site", "holds context.installContext values only (one entry per site), never a site's data"]],
  ["src/server/capsules/sealing/actions.js:PURGE_SETTLE_MS", ["test knob", "a settle delay a test may shorten; no site data"]],
  ["src/server/infra/mention-adf.js:TOKEN_RE", ["sync regex", "a /g regex whose lastIndex is reset around one synchronous scan (no await in between); holds no site data"]],
  // src/ui files the server bundle imports (the action log's name lists, the error formatter)
  ["src/ui/kit/error-facts.js:BUILTIN_FRAMES", [CONSTANT, "fixed stack frame names"]],
  ["src/ui/kit/ui-action-names.js:S", [CONSTANT, "generated UI control ids"]],
  ["src/ui/kit/ui-action-names.js:SUF", [CONSTANT, "generated UI control id tails"]],
  ["src/ui/kit/ui-action-names.js:LIT", [CONSTANT, "generated UI literals"]],
  ["src/ui/kit/ui-action-names.js:CODE_ONLY", [CONSTANT, "fixed code-only id heads"]],
  ["src/ui/kit/ui-action-names.js:ROLE_SET", [CONSTANT, "fixed ARIA roles"]],
]);
// Top-level calls that build something stateless (reviewed 2026-10-23): wrappers that return a
// function, factories whose closures hold only their arguments, and array methods on constants.
const FACTORIES = new Map([
  ["Object.freeze", "freezes a literal"], ["Symbol", "a unique token"], ["Symbol.for", "a registry token"],
  ["asInvocation", "wraps a handler; each call opens its own invocation scope"],
  ["withJobLog", "wraps a handler with the action log; keeps nothing between calls"],
  ["logged", "wraps a handler with the action log; keeps nothing between calls"],
  ["withPowers", "wraps a Jira seal action; keeps nothing between calls"],
  ["ownerIndex", "binds KVS key prefixes; reads KVS (per installation) on every call"],
  ["createTokenStore", "binds the KVS storage functions; keeps nothing between calls"],
  ["makeLocks", "binds KVS lock functions; keeps nothing between calls"],
  [".sort", "a sorted copy of a constant list"], [".map", "a mapped copy of a constant list"],
  [".flatMap", "a mapped copy of a constant list"], [".getDefinitions", "the Resolver's fixed definitions"],
]);

const walk = (d, acc = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(js|jsx|mjs)$/.test(p)) acc.push(p); } return acc; };
const rel = (f) => relative(root, f).split("\\").join("/");

/** The server's files: src/ outside src/ui, plus every src/ui file reachable from them by import. */
function serverFiles() {
  const start = walk(join(root, "src")).filter((f) => !rel(f).startsWith("src/ui/"));
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"'`;]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      let p = resolve(dirname(f), m[1] || m[2]);
      if (!/\.(js|jsx|mjs)$/.test(p)) p += ".js";
      try { if (statSync(p).isFile()) queue.push(p); } catch (_) { /* a package, not a file */ }
    }
  }
  return [...seen];
}

const calleeName = (c) => (c.type === "Identifier" ? c.name
  : c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier"
    ? (c.object.type === "Identifier" && c.object.name === "Object") || (c.object.type === "Identifier" && c.object.name === "Symbol")
      ? `${c.object.name}.${c.property.name}` : `.${c.property.name}`
    : "?");
const namesOf = (id) => (id.type === "Identifier" ? [id.name] : id.type === "ObjectPattern" ? id.properties.flatMap((p) => namesOf(p.value || p.argument))
  : id.type === "ArrayPattern" ? id.elements.filter(Boolean).flatMap(namesOf) : id.type === "RestElement" ? namesOf(id.argument) : id.type === "AssignmentPattern" ? namesOf(id.left) : []);

/** PURE. Module-level holders and writes of one source: [{ name, kind, line }]. */
function moduleHolders(src) {
  const out = [];
  const ast = parse(src);
  for (const stmt0 of ast.program.body) {
    const stmt = (stmt0.type === "ExportNamedDeclaration" || stmt0.type === "ExportDefaultDeclaration") && stmt0.declaration ? stmt0.declaration : stmt0;
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of stmt.declarations) {
      const init = d.init;
      let kind = null;
      if (stmt.kind !== "const") kind = stmt.kind;
      else if (init?.type === "NewExpression") kind = `new ${init.callee.type === "Identifier" ? init.callee.name : "?"}`;
      else if (init?.type === "ObjectExpression" && init.properties.length === 0) kind = "{}";
      else if (init?.type === "ArrayExpression" && init.elements.length === 0) kind = "[]";
      else if (init?.type === "CallExpression" && calleeName(init.callee) === "Object.freeze" && init.arguments[0]?.type === "NewExpression") kind = "frozen new"; // freeze does not freeze a Map's entries
      else if (init?.type === "CallExpression" && !FACTORIES.has(calleeName(init.callee))) kind = `call ${calleeName(init.callee)}`;
      if (kind) for (const name of namesOf(d.id)) out.push({ name, kind, line: d.loc.start.line });
    }
  }
  const rootOf = (n) => { while (n && n.type === "MemberExpression") n = n.object; return n; };
  const moduleBound = (p, id) => { if (id?.type !== "Identifier") return false; const b = p.scope.getBinding(id.name); return !!b && b.scope.block.type === "Program"; };
  traverse(ast, {
    "AssignmentExpression|UpdateExpression"(p) {
      if (!p.getFunctionParent()) return;
      const left = p.node.left || p.node.argument;
      if (left?.type === "Identifier" && moduleBound(p, left)) out.push({ name: left.name, kind: "written in a function", line: p.node.loc.start.line });
      else if (left?.type === "MemberExpression" && moduleBound(p, rootOf(left))) out.push({ name: rootOf(left).name, kind: "member written in a function", line: p.node.loc.start.line });
    },
    CallExpression(p) {
      if (!p.getFunctionParent()) return;
      const c = p.node.callee;
      if (c.type === "MemberExpression" && c.object.type === "Identifier" && c.object.name === "Object" && c.property.name === "assign" && moduleBound(p, rootOf(p.node.arguments[0]))) {
        out.push({ name: rootOf(p.node.arguments[0]).name, kind: "member written in a function", line: p.node.loc.start.line });
      }
    },
  });
  const seenKeys = new Set();
  return out.filter((h) => { const k = `${h.name}|${h.kind}`; if (seenKeys.has(k)) return false; seenKeys.add(k); return true; });
}

// ── the detector itself (positive and negative controls) ───────────────────────────────────────
{
  const planted = `
const pageSpaceMemo = new Map();
const actorNameCache = new Map();
const cache = new Map();
let appAccountCache = null;
export const seen = new Set();
const bag = {};
const list = [];
const TABLE = new Map([["a", 1]]);
const frozenMap = Object.freeze(new Map());
const lru = new LRUCache(10);
const memo = makeMemo();
let { a, b } = {};
let lazy;
function get() { lazy ??= load(); return lazy; }
const FROZEN = Object.freeze({ a: 1 });
const wrapped = asInvocation(() => 1);
const fn = () => { const local = new Map(); let x = 1; x++; return local; };
const stats = { hits: 0 };
function hit() { stats.hits++; stats.last = 1; Object.assign(stats, { a: 1 }); }
`;
  eq("the four memos this release removed, and other shapes, are found",
    moduleHolders(planted).map((h) => `${h.name}:${h.kind}`),
    ["pageSpaceMemo:new Map", "actorNameCache:new Map", "cache:new Map", "appAccountCache:let", "seen:new Set", "bag:{}", "list:[]",
      "TABLE:new Map", "frozenMap:frozen new", "lru:new LRUCache", "memo:call makeMemo", "a:let", "b:let", "lazy:let", "lazy:written in a function",
      "stats:member written in a function"]);
  eq("Object.freeze(new Map()) is caught too", moduleHolders("const m = Object.freeze(new Map());").map((h) => h.kind), ["frozen new"]);
}

// ── the app ────────────────────────────────────────────────────────────────────────────────────
const files = serverFiles();
ok(`the scan sees the server code (${files.length} files)`, files.length > 60);
ok("the scan includes the src/ui files the server imports", files.some((f) => rel(f) === "src/ui/kit/error-facts.js"));
const found = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const h of moduleHolders(src)) if (!found.has(`${rel(f)}:${h.name}`)) found.set(`${rel(f)}:${h.name}`, { ...h, rel: rel(f), src });
}
const unlisted = [...found.keys()].filter((k) => !ALLOWED.has(k));
eq("no unlisted module-level state in the server code (remember site answers per invocation, in KVS, or by installContext)",
  unlisted.map((k) => `${k} (${found.get(k).kind}, line ${found.get(k).line})`), []);
const stale = [...ALLOWED.keys()].filter((k) => !found.has(k));
eq("every allowed entry still exists (drop stale ones)", stale, []);
for (const [k, [kind]] of ALLOWED) {
  if (kind !== CONSTANT || !found.has(k)) continue;
  const { name, src } = found.get(k);
  const writes = src.match(new RegExp(`\\b${name}\\s*\\.\\s*(set|add|delete|clear|push|pop|shift|unshift|splice)\\s*\\(`, "g")) || [];
  eq(`${k} is never written after load`, writes, []);
  ok(`${k} is not exported (a write from another file would go unseen)`, !new RegExp(`export\\s+const\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(src));
}
for (const k of ["src/server/infra/activity-log.js:pageSpaceMemo", "src/server/infra/activity-log.js:actorNameCache",
  "src/server/capsules/classification/provider.js:cache", "src/server/capsules/backup/store.js:appAccountCache"]) {
  ok(`${k} is gone`, !found.has(k));
}

// ── every entry point runs as one invocation, so invocationMemo has a scope to live in ───────────
{
  const boot = readFileSync(join(root, "src/boot.js"), "utf8");
  const own = [...boot.matchAll(/^export const (\w+) = (.*)$/gm)];
  ok("boot.js defines its handlers", own.length >= 9);
  eq("every handler boot.js defines is wrapped in asInvocation", own.filter(([, , rhs]) => !rhs.startsWith("asInvocation(")).map(([, n]) => n), []);
  const le = readFileSync(join(root, "src/server/logged-entrypoints.js"), "utf8");
  const jobs = [...le.matchAll(/^export const (\w+) = withJobLog\(.*$/gm)];
  ok("logged-entrypoints defines its queue consumers", jobs.length >= 6);
  eq("every queue consumer runs as one invocation", jobs.filter(([line]) => !/withJobLog\("[^"]+", job\(/.test(line)).map(([, n]) => n), []);
  ok("the REST trigger runs as one invocation", /export const configApiTrigger = logged\(asInvocation\(/.test(le));
  // Every function the manifest names maps to a wrapped handler (a new `export { x } from …` cannot slip by).
  const manifest = readFileSync(join(root, "manifest.yml"), "utf8");
  const handlers = [...manifest.matchAll(/handler:\s*boot\.(\w+)/g)].map((m) => m[1]);
  ok("the manifest names its handlers", handlers.length >= 15);
  const wrappedHere = new Set(own.filter(([, , rhs]) => rhs.startsWith("asInvocation(")).map(([, n]) => n));
  const wrappedLe = new Set([...jobs.map(([, n]) => n), ...(/export const configApiTrigger = logged\(asInvocation\(/.test(le) ? ["configApiTrigger"] : [])]);
  const reexported = new Set(((boot.match(/export \{([^}]*)\} from "\.\/server\/logged-entrypoints\.js"/) || [])[1] || "").split(",").map((x) => x.trim()).filter(Boolean));
  const OTHER = { actionRouter: "every resolver runs in registry.js withInvocation", testStateTrigger: "the dev-only harness hook; production strips it" };
  eq("every manifest handler runs as one invocation", handlers.filter((h) => !(wrappedHere.has(h) || (reexported.has(h) && wrappedLe.has(h)) || OTHER[h])), []);
  const reg = readFileSync(join(root, "src/server/registry.js"), "utf8");
  ok("every resolver runs as one invocation (registry.js withInvocation)", /withInvocation = \(key, fn\) => \(req\) => runInvocation\(/.test(reg));
}

report("process-state");
