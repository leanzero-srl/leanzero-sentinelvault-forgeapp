// The action log (src/server/shared/action-log.js, src/ui/kit/bridge.js; 2026-10-21).
//
// Pins what must not regress:
//   A. coverage: every resolver the router defines, the REST trigger and every user-started queue
//      consumer is wrapped (one line each); every other manifest function is exempt BY NAME, with a reason;
//      the UI reaches resolvers only through src/ui/kit/bridge.js
//   B. privacy: a line never carries a payload or context value (account id, page id, space key, title,
//      file name, secret-looking text, error message, a refusal text built at runtime); trail names that
//      are not literals of the source are refused on the server too
//   C. behaviour: the action gets the payload WITHOUT the trail (and `undefined` when the UI sent none),
//      its answer and its throw are unchanged, one line per call, the timeout line fires before the limit
//   D. the generated name lists are fresh (scripts/gen-action-names.mjs)
import { register } from "node:module";
import "./_forge-fake/install.mjs";
register("./_forge-fake/bridge-loader.mjs", import.meta.url);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|jsx)$/.test(p)) out.push(p); } return out; };

// Capture console output (the lines ARE console output).
const lines = [];
const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const capture = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : String(x))).join(" "); if (s.startsWith('{"lz":')) lines.push(JSON.parse(s)); };
console.log = capture; console.error = capture; console.warn = () => {}; console.info = () => {};
const take = () => lines.splice(0, lines.length);

const AL = await import("../src/server/shared/action-log.js");
const names = await import("../src/ui/kit/ui-action-names.js");
const gen = await import("../scripts/gen-action-names.mjs");

// ── D. generated lists are fresh ──────────────────────────────────────────────────────────────
{
  const { ui, reasons } = gen.generate();
  eq("ui-action-ids.gen.js is fresh (run node scripts/gen-action-names.mjs)", read("src/ui/kit/ui-action-ids.gen.js") === ui, true);
  eq("action-reasons.gen.js is fresh (run node scripts/gen-action-names.mjs)", read("src/server/shared/action-reasons.gen.js") === reasons, true);
}

// ── names: only literals of the source ───────────────────────────────────────────────────────
eq("static id", names.nameOfId("pd-close"), "pd-close");
eq("templated id with a code literal", names.nameOfId("pd-tab-overview"), "pd-tab-overview");
eq("templated id with data → *", names.nameOfId("cls-space-row-FINANCE"), "cls-space-row-*");
eq("templated id with an attachment id → *", names.nameOfId("jv-seal-10042"), "jv-seal-*");
eq("testId prop + fixed tail", names.nameOfId("sv-decline-confirm"), "sv-decline-confirm");
eq("unknown id → nothing", names.nameOfId("john-smith"), null);
eq("non-string → nothing", names.nameOfId(42), null);
for (const bad of ["john.smith", "a@b.c", "pd-close~1", "pd-close>div", "secret-AKIA1234", "pd-tab-FINANCE", "x".repeat(200), "cls-space-row-finance"]) {
  ok(`server refuses trail entry ${JSON.stringify(bad).slice(0, 40)}`, !names.isKnownName(bad));
}
for (const good of ["pd-close", "pd-close~3", "jv-row-*>button", "cls-space-row-*", "pd-tab-activity"]) ok(`server accepts ${good}`, names.isKnownName(good));
eq("repeat collapses", names.pushName(names.pushName(["pd-close"], "pd-close"), "pd-close"), ["pd-close~3"]);
eq("trail keeps the newest 20", names.pushName(Array.from({ length: 20 }, (_, i) => (i % 2 ? "pd-close" : "pd-modal")), "pd-tab-overview").length, 20);

// ── B/C. a resolver through the REAL registry ────────────────────────────────────────────────
const SECRETS = {
  accountId: "712020:aaaabbbb-cccc-dddd-eeee-ffff00001111",
  page: "998877665", space: "FINANCE", title: "Q3 salaries.xlsx",
  secret: "AKIAIOSFODNN7EXAMPLE", content: "the password is hunter2",
};
const leaks = (obj) => {
  const s = JSON.stringify(obj);
  return Object.entries(SECRETS).filter(([, v]) => s.includes(v)).map(([k]) => k);
};

const registry = await import("../src/server/registry.js");
const { actionRouter, wrappedActions, allActions } = registry;
ok("router has every action + heartbeat", actionRouter.size === allActions.length + 1);
const unwrapped = [...actionRouter.entries()].filter(([, fn]) => !fn[AL.LOGGED]).map(([k]) => k);
eq("every router definition is wrapped by the action log", unwrapped, []);
eq("every wrappedActions entry is wrapped", wrappedActions.filter(([, fn]) => !fn[AL.LOGGED]).map(([k]) => k), []);
// Source guards: one Resolver, one define door.
{
  const server = walk(join(root, "src/server")).concat([join(root, "src/boot.js")]);
  const resolvers = server.filter((f) => /new Resolver\(/.test(readFileSync(f, "utf8")));
  eq("exactly one Resolver in the backend", resolvers.map((f) => f.slice(root.length + 1)), ["src/server/registry.js"]);
  const reg = read("src/server/registry.js");
  eq("router.define is called only inside define()", (reg.match(/router\.define\(/g) || []).length, 1);
  ok("define() wraps whatever is not wrapped", /const define = \(key, fn\) => router\.define\(key, fn\[LOGGED\] \? fn : withActionLog\(/.test(reg));
}

{
  const fn = actionRouter.get("approve-edit-request");
  const r = await fn({
    payload: { requesterAccountId: SECRETS.accountId, note: SECRETS.content, __lzTrail: ["sv-decline", "pd-tab-overview", "john.smith", SECRETS.secret] },
    context: { accountId: SECRETS.accountId, moduleKey: "sentinel-vault-byline", extension: { content: { id: SECRETS.page }, space: { key: SECRETS.space } } },
  });
  eq("the action's answer is unchanged", r, { success: false, reason: "Missing params" });
  const got = take();
  eq("one line per call", got.length, 1);
  const l = got[0] || {};
  eq("line: lz/app/via", [l.lz, l.app, l.via], ["action", "sv", "ui"]);
  eq("line: action = area.key", l.action, "editreq.approve-edit-request");
  eq("line: surface = module key", l.surface, "sentinel-vault-byline");
  eq("line: refused with the literal's slug", [l.outcome, l.reason], ["refused", "missing-params"]);
  eq("line: trail keeps only source literals", l.trail, ["sv-decline", "pd-tab-overview"]);
  eq("line: dropped counts the refused entries", l.dropped, 2);
  ok("line: ms is a number", Number.isInteger(l.ms));
  eq("line: v / env from the app context", [l.v, l.env], ["0.0.0", "development"]);
  eq("line: carries no payload or context value", leaks(l), []);
  eq("line: only known fields", Object.keys(l).filter((k) => !["lz", "app", "v", "env", "via", "action", "surface", "outcome", "errorType", "status", "code", "step", "reason", "ms", "trail", "dropped", "afterTimeout"].includes(k)), []);
}
{
  // A seal that is not there: still a literal refusal, the attachment id never printed.
  await actionRouter.get("approve-edit-request")({ payload: { attachmentId: SECRETS.page, requesterAccountId: SECRETS.accountId }, context: { accountId: SECRETS.accountId, moduleKey: "my-work" } });
  const [l] = take();
  eq("second refusal reason slug", l && l.reason, "seal-not-found");
  eq("second refusal leaks nothing", leaks(l), []);
}
{
  const r = await actionRouter.get("heartbeat")({ payload: undefined, context: {} });
  eq("heartbeat answers as before", r, "Sentinel Vault operational");
  const [l] = take();
  eq("heartbeat is logged", [l && l.action, l && l.outcome, l && l.surface], ["app.heartbeat", "ok", "none"]);
}

// ── C. the wrapper itself ────────────────────────────────────────────────────────────────────
{
  let seen;
  const w = AL.withActionLog("sealing", "probe", async (req) => { seen = req.payload; return { success: true }; });
  await w({ payload: { pageId: SECRETS.page, __lzTrail: ["pd-close"] }, context: {} });
  eq("the action never sees the trail", seen, { pageId: SECRETS.page });
  await w({ payload: { __lzTrail: ["pd-close"], __lzBare: 1 }, context: {} });
  eq("a bare call gets undefined back", seen, undefined);
  await w({ payload: [1, 2], context: {} });
  eq("a non-object payload passes untouched", seen, [1, 2]);
  take();
}
{
  // A throw: re-thrown unchanged; the line has the class and the app frame, never the message.
  const boom = async function sealTheFile() { const e = new TypeError(`cannot read ${SECRETS.title} for ${SECRETS.accountId}`); e.status = 404; e.code = "ENOTFOUND"; throw e; };
  const w = AL.withActionLog("sealing", "seal-artifact", boom);
  let thrown = null;
  try { await w({ payload: {}, context: {} }); } catch (e) { thrown = e; }
  ok("the throw reaches the caller unchanged", thrown instanceof TypeError && thrown.message.includes(SECRETS.title));
  const [l] = take();
  eq("error line", [l.outcome, l.errorType, l.status, l.code], ["error", "TypeError", 404, "ENOTFOUND"]);
  eq("error line names the failing app function", l.step, "sealTheFile");
  eq("error line carries no message", leaks(l), []);
}
{
  // A message that fakes stack frames cannot smuggle text into `step`.
  const e = new Error(`x\n    at ${SECRETS.space}Steal (evil)`);
  eq("step ignores frames inside the message", AL.stepOf(e) === `${SECRETS.space}Steal`, false);
  eq("non-identifier error names are not printed", AL.errorFacts({ name: SECRETS.content }).errorType, "thrown-object");
}
{
  // Classification of answers.
  eq("ok", AL.classifyResult({ success: true, title: SECRETS.title }), { outcome: "ok" });
  eq("array ok", AL.classifyResult([1]), { outcome: "ok" });
  eq("dynamic refusal text: no reason", AL.classifyResult({ success: false, reason: `Sealed by ${SECRETS.title}` }), { outcome: "refused" });
  eq("permission refusal: denied", AL.classifyResult({ success: false, reason: "Only a space admin can edit workflow definitions" }).outcome, "denied");
  eq("permission refusal built at runtime: denied without text", AL.classifyResult({ success: false, reason: `You do not have permission to edit ${SECRETS.title}` }), { outcome: "denied" });
  eq("signature", AL.classifyResult({ success: false, reason: "x", signatureRequired: true }).outcome, "denied");
  eq("busy", AL.classifyResult({ success: false, busy: true, reason: "Confluence is limiting requests" }), { outcome: "busy" });
  eq("error string", AL.classifyResult({ error: "Not authorized" }).outcome, "denied");
  eq("job: own outcome re-checked", AL.classifyJob({ outcome: "error", step: SECRETS.title, errorType: "TypeError" }), { outcome: "error", errorType: "TypeError" });
  eq("job: failed status", AL.classifyJob({ ok: true, status: "failed" }), { outcome: "error" });
  eq("job: ok false", AL.classifyJob({ ok: false }), { outcome: "refused" });
}
{
  // Timeout: a line before the platform limit, then the real outcome marked afterTimeout.
  const w = AL.logged(async () => { await new Promise((r) => setTimeout(r, 1700)); return { success: true }; }, { describe: () => ({ via: "ui", action: "sealing.slow", surface: "x" }), limitMs: 1600 });
  await w();
  const got = take();
  eq("timeout line first", got.map((l) => l.outcome), ["timeout", "ok"]);
  eq("the late line says so", got[1] && got[1].afterTimeout, true);
}

// ── A. boot.js: REST trigger, consumers, exemptions ──────────────────────────────────────────
// boot.js itself cannot load under node (the dev hook uses bundler-style imports): its exports are read
// from source, the logged entry points are imported from the module it re-exports them from.
const boot = await import("../src/server/logged-entrypoints.js");
{
  const manifest = read("manifest.yml");
  const bootSrc = read("src/boot.js");
  const handlers = [...manifest.matchAll(/handler:\s*boot\.(\w+)/g)].map((m) => m[1]);
  ok("manifest lists the functions (sanity)", handlers.length >= 15);
  const reexport = bootSrc.match(/export \{([^}]*)\} from "\.\/server\/logged-entrypoints\.js"/);
  const fromLogged = reexport ? reexport[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
  const exported = (h) => new RegExp(`export (?:const|async function|function) ${h}\\b|export \\{[^}]*\\b${h}\\b[^}]*\\}`).test(bootSrc);
  const bad = handlers.filter((h) => {
    if (h === "actionRouter") return !/export \{ actionRouter \} from "\.\/server\/registry\.js"/.test(bootSrc);
    if (fromLogged.includes(h)) return !(boot[h] && boot[h][AL.LOGGED]);
    return !(boot.ACTION_LOG_EXEMPT[h] && exported(h));
  });
  eq("every manifest function is logged or exempt with a reason", bad, []);
  const stale = Object.keys(boot.ACTION_LOG_EXEMPT).filter((h) => !handlers.includes(h));
  eq("no exemption for a function the manifest no longer has", stale, []);
  eq("nothing is both logged and exempt", fromLogged.filter((h) => boot.ACTION_LOG_EXEMPT[h]), []);
  for (const h of ["configApiTrigger", "configApiConsumer", "realmScanConsumer", "aiValidationConsumer", "backupConsumer", "privacyConsumer", "jiraRestoreConsumer"]) ok(`${h} is logged and exported by boot.js`, !!(boot[h] && boot[h][AL.LOGGED]) && fromLogged.includes(h));
}
{
  const r = await boot.configApiTrigger({ method: "GET", queryParameters: { op: ["evil-op"] }, headers: { authorization: `Bearer ${SECRETS.secret}` } });
  eq("REST answer unchanged", r, { outputKey: "not-allowed" });
  const [l] = take();
  eq("REST line", [l.via, l.action, l.surface, l.outcome, l.reason], ["rest", "rest.unknown", "rest-api", "refused", "not-allowed"]);
  eq("REST line leaks nothing", leaks(l), []);
  await boot.configApiTrigger({ method: "POST", queryParameters: { op: "whoami" }, headers: { authorization: `Bearer ${SECRETS.secret}` } });
  const [l2] = take();
  eq("REST bad token → denied", [l2.action, l2.outcome, l2.reason], ["rest.whoami", "denied", "unauthorized"]);
}
{
  await boot.configApiConsumer({ body: { jobId: SECRETS.accountId } });
  const [l] = take();
  eq("job line for a missing REST job", [l.via, l.action, l.outcome], ["job", "job.config-api", "refused"]);
  eq("job line leaks nothing", leaks(l), []);
  await boot.privacyConsumer({ body: { kind: SECRETS.space } });
  const [l2] = take();
  eq("an unknown job kind is not printed", l2.action, "job.privacy");
}

// ── A. the UI door ───────────────────────────────────────────────────────────────────────────
{
  const ui = walk(join(root, "src/ui")).filter((f) => !f.endsWith("kit/bridge.js"));
  const direct = ui.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*["']@forge\/bridge["']/.test(s) || /\{\s*[^}]*\binvoke\b[^}]*\}\s*=\s*await import\(["']@forge\/bridge["']\)/.test(s) || /@forge\/bridge["']\)\.then\([^)]*invoke/.test(s);
  }).map((f) => f.slice(root.length + 1));
  eq("no UI file takes invoke straight from @forge/bridge", direct, []);
  const attrs = ui.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/data-lz=\{/g)].map(() => f.slice(root.length + 1)));
  eq("data-lz is always a string literal", attrs, []);
}
{
  const fakeBridge = await import("./_forge-fake/bridge.mjs");
  const kit = await import("../src/ui/kit/bridge.js");
  kit.track("pd-tab-attachments");
  kit.track("pd-close");
  await kit.invoke("ribbon-summary", { pageId: SECRETS.page });
  const sent = fakeBridge.calls.at(-1);
  eq("the trail rides the next call", sent.payload, { pageId: SECRETS.page, __lzTrail: ["pd-tab-attachments", "pd-close"] });
  await kit.invoke("ribbon-summary", { pageId: SECRETS.page });
  eq("and only once", fakeBridge.calls.at(-1).payload, { pageId: SECRETS.page });
  kit.track("pd-close");
  await kit.invoke("heartbeat");
  eq("a bare call is marked bare", fakeBridge.calls.at(-1).payload, { __lzTrail: ["pd-close"], __lzBare: 1 });
  kit.track("pd-close");
  await kit.invoke("x", "not-an-object");
  eq("a non-object payload is sent as is", fakeBridge.calls.at(-1).payload, "not-an-object");
  eq("and the trail waits for the next call", kit.peekTrail(), ["pd-close"]);
  // A failed call: rejection unchanged, one console.error descriptor without the message.
  fakeBridge.setAnswer(async () => { throw new Error(`timeout reading ${SECRETS.title}`); });
  take();
  let rejected = null;
  try { await kit.invoke("seal-artifact", { attachmentId: SECRETS.page }); } catch (e) { rejected = e; }
  ok("the rejection reaches the caller", rejected && rejected.message.includes(SECRETS.title));
  const [u] = take();
  eq("ui-error descriptor", u && [u.lz, u.action, u.errorType, u.step], ["ui-error", "seal-artifact", "Error", "invoke"]);
  eq("ui-error descriptor carries the trail", u && u.trail, ["pd-close"]);
  eq("ui-error descriptor leaks nothing", leaks(u), []);
  // nameOfClick over a minimal DOM shape.
  const el = (attrs, parent = null, tag = "BUTTON") => ({ tagName: tag, parentElement: parent, getAttribute: (k) => attrs[k] ?? null, closest(sel) { if (sel.includes("data-") ? (attrs["data-testid"] || attrs["data-lz"]) : true) return this; return parent ? parent.closest(sel) : null; } });
  eq("click on a named button", kit.nameOfClick(el({ "data-testid": "pd-close" })), "pd-close");
  const row = el({ "data-testid": "jv-row-10042" }, null, "DIV");
  eq("click on an unnamed button inside a named row", kit.nameOfClick(el({}, row)), "jv-row-*>button");
  eq("click on a control with a data id only", kit.nameOfClick(el({ "data-testid": `row-${SECRETS.space}` })), null);
}

console.log = real.log; console.error = real.error; console.warn = real.warn; console.info = real.info;
report("action-log");
