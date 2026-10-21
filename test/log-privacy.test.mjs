// Log privacy guard (2026-10-21). Every console line the app prints (server AND browser: Atlassian's
// frontend logs capture console.error) must be free of personal data and of error message text.
//
// Scans every console.log/warn/error/info/debug/trace/dir/table call in src/ (src/test-hook.js is
// dev-only and stripped from production builds) with a real parser, and FAILS on an argument that:
//   1. reads a person: an identifier or property ending in accountId / atlassianId / actor / lockedBy /
//      requester(Id) / authorId / author / approver / owner(Id) / userId / grantee / createdBy /
//      displayName / email / publicName
//   2. reads a title or a name: ...title / ...Title / fileName / filename / ...Name (artifactName,
//      attachmentName, sectionTitle...)
//   3. reads free text a user typed: ...note / ...comment / ...justification / ...declineReason
//   4. reads a secret: ...token / ...secret / ...password / ...apiKey
//   5. prints error text: `.message`, `.stack`, `String(<error>)`, `<error>.toString()`, or an error
//      variable itself (`, e)` `, err)` `, error)` `${e}`, any name ending in Error/Err): console prints
//      an error object's message and stack
//   6. prints a response body: `.text` / `.text()`, `errorText`, `responseText`, `bodyText`
//   7. dumps a structure: any `JSON.stringify(...)`, a record spread into an object (`{ ...seal }`), or
//      a payload- or record-shaped variable passed as its own argument (body, payload, result, res,
//      response, r, data, req, request, event, context, ctx, extension, out, value, record, seal, row,
//      item, job, page, space, user, settings, config, bundle, receipt, ...)
//   8. prints a space key raw: an identifier or property named like spaceKey / realmKey / storedKey /
//      spaceKeys, or `space.key` / `realm.key`. A PERSONAL space's key is "~" + its owner's account id
//      without the colon and dashes, so a space key goes through spaceKeyForLog() ("~personal")
//   9. prints text built at runtime: e.cause, e.body/res.body, r.reason, validation.errors, `detail`
//      (wrap in reasonText/safeKey/errText; a count such as `.errors.length` is fine), or dumps a record
//      through util.inspect/inspect, Object.values/entries/assign/fromEntries or String(record)
//  10. hands console.<method> over as a value (`.catch(console.error)`): it prints what it is given
// The same rules apply to calls of LOGGER WRAPPERS, found across src/ by position: a function whose
// parameter reaches a console/logger call (or another wrapper) as an argument or templated into one,
// directly or through a local variable built from it, a destructured field, or `...rest`. A wrapper
// defined in another file counts where the file imports its name. Also judged: any bare `log(...)`
// (the classification code takes its logger as a parameter named `log`) and logger.x()/log.x().
//
// WHAT A STATIC SCAN CANNOT SEE (review those by hand): a value whose NAME says nothing (`const v =
// seal.lockedBy; console.log(\`${v}\`)` is caught only when built in the same function from a wrapper
// parameter); text that reaches a console line through a function RESULT (only string methods, String(),
// route and JSON.stringify carry taint), an object property, a class or a closure; method calls of
// objects (obj.notify(x)); dynamic dispatch; and the CONTENT of a string variable built elsewhere (a
// `why` sentence holding a space key). Those are the reason every space key, reason and error goes
// through one formatter at the place the value is made.
// Arguments of the safe formatters errText()/errorFacts()/spaceKeyForLog() (src/ui/kit/error-facts.js),
// reasonText()/safeKey() and failureLine() (src/ui/kit/bridge.js) are not inspected: they print only an
// error's class/status/code/source line, a source-literal slug or a masked key. Content ids (page,
// attachment, job id, version, counts, a masked space key) may stay.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));
const { parseSync, traverse } = require("@babel/core");

const METHODS = new Set(["log", "warn", "error", "info", "debug", "trace", "dir", "table"]);
const SAFE_FORMATTERS = new Set(["errText", "errorFacts", "failureLine", "reasonText", "reasonSlug", "safeKey", "presentationText", "spaceKeyForLog", "pathForLog", "bundlePathForLog"]);
const LOGGER_NAMES = new Set(["log"]); // plus every wrapper found in the file (loggerWrappers)
const PEOPLE_RE = /(?:accountIds?|AccountIds?|atlassianId|AtlassianId|actor|Actor|lockedBy|LockedBy|requester(?:Ids?)?|Requester(?:Ids?)?|authorIds?|AuthorIds?|author|Author|approvers?|Approvers?|approverIds?|ApproverIds?|owner|Owner|ownerIds?|OwnerIds?|userIds?|UserIds?|grantee|Grantee|createdBy|CreatedBy|displayName|DisplayName|emails?|Emails?|publicName|PublicName)$/;
const TITLE_RE = /(?:^title|Title|^titles|Titles|fileName|FileName|filename|[a-z]Name|^name)$/;
const FREE_RE = /(?:^note|Note|^notes|Notes|^comment|Comment|justification|Justification|declineReason|DeclineReason)$/;
const SECRET_RE = /(?:^token|Token|^secret|Secret|password|Password|apiKey|ApiKey)$/;
const ERROR_VAR_RE = /^(?:e|e2|err|error|ex|exc)$|(?:Error|Err)$/;
const BODY_NAME_RE = /^(?:errorText|responseText|bodyText)$/;
const PAYLOAD_RE = /^(?:body|payload|result|res|response|r|data|req|request|event|context|ctx|extension|out|value|record|records|rec|summary|details|seal|seals|sealRecord|row|rows|item|items|entry|job|page|pages|attachment|att|space|realm|user|users|operator|account|profile|settings|config|bundle|receipt|fresh|existing|before|after|current|live|probe|pending|doc|adf|node|marker|grant|request|meta)$/;
const SPACE_KEY_RE = /(?:^spaceKeys?|SpaceKeys?|^realmKeys?|RealmKeys?|^storedKey|StoredKey)$/;
const RUNTIME_TEXT_RE = /^(?:cause|reason|reasons|errors|detail|lastReason|errorDetail)$/; // e.cause, r.reason, validation.errors: text built at runtime
const BODYISH_RE = /^(?:body|cause)$/; // e.body / e.cause as a value: a response or an inner error
const RECORD_DUMPERS = new Set(["values", "entries", "fromEntries", "assign"]); // Object.values(record)...
const SPACEISH_RE = /(?:^space|Space|^realm|Realm|^sp)$/; // `space.key`, `realm.key`, `sp.key`

const propName = (m) => (!m.computed && m.property.type === "Identifier" ? m.property.name : m.property.type === "StringLiteral" ? m.property.value : null);
const FLAG_RE = /^(?:is|has|can|was|did|should)[A-Z]/; // isOwner, hasApprover: a boolean, not the person
function nameRule(name) {
  if (FLAG_RE.test(name)) return null;
  if (PEOPLE_RE.test(name)) return "person";
  if (TITLE_RE.test(name)) return "title/name";
  if (FREE_RE.test(name)) return "free text";
  if (SECRET_RE.test(name)) return "secret";
  if (BODY_NAME_RE.test(name)) return "response body";
  if (SPACE_KEY_RE.test(name)) return "raw space key (spaceKeyForLog)";
  if (RUNTIME_TEXT_RE.test(name)) return "runtime text (reasonText/errText)";
  return null;
}
const isMember = (n) => n && (n.type === "MemberExpression" || n.type === "OptionalMemberExpression");
const isCall = (n) => n && (n.type === "CallExpression" || n.type === "OptionalCallExpression");
const leafName = (n) => (n.type === "Identifier" ? n.name : isMember(n) ? propName(n) : null);
const errorish = (n) => n && (n.type === "Identifier" ? ERROR_VAR_RE.test(n.name) : isMember(n) ? isErrorPath(n) : false);
const isErrorPath = (n) => { const p = propName(n); return p === "message" || p === "stack" || (p != null && ERROR_VAR_RE.test(p)); };

/** PURE. The findings for ONE console call's argument list. */
export function inspectArgs(args, direct = true) {
  const found = [];
  const flag = (rule, what) => found.push(`${rule}: ${what}`);
  const visit = (n, direct) => {
    if (!n || typeof n !== "object") return;
    switch (n.type) {
      case "Identifier": {
        const r = nameRule(n.name);
        if (r) flag(r, n.name);
        if (ERROR_VAR_RE.test(n.name)) flag("error object", n.name);
        if (direct && PAYLOAD_RE.test(n.name)) flag("payload dump", n.name);
        return;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const p = propName(n);
        // A count prints a number, whatever it counts (validation.errors.length, ids.length).
        if (p === "length" || p === "size") { if (!isMember(n.object) && n.object.type !== "Identifier") visit(n.object, false); return; }
        if (p === "message" || p === "stack") flag("error text", `.${p}`);
        else if (p === "text") flag("response body", ".text");
        else if (p != null) {
          const r = nameRule(p);
          if (r) flag(r, `.${p}`);
          if (p === "key" && SPACEISH_RE.test(leafName(n.object) || "")) flag("raw space key (spaceKeyForLog)", `${leafName(n.object)}.key`);
          if (BODYISH_RE.test(p)) flag("payload dump", `.${p}`);
          if (ERROR_VAR_RE.test(p) && p.length > 3) flag("error object", `.${p}`);
          if (direct && PAYLOAD_RE.test(p)) flag("payload dump", `.${p}`);
        }
        if (n.computed) visit(n.property, false);
        // The object is only a path to the property... unless it is itself computed (a call, a template).
        if (!isMember(n.object) && n.object.type !== "Identifier" && n.object.type !== "ThisExpression") visit(n.object, false);
        else if (isMember(n.object)) visitPath(n.object);
        return;
      }
      case "CallExpression":
      case "OptionalCallExpression": {
        const c = n.callee;
        const cName = c.type === "Identifier" ? c.name : isMember(c) ? propName(c) : null;
        if (c.type === "Identifier" && SAFE_FORMATTERS.has(c.name)) return;
        if (isMember(c) && c.object.type === "Identifier" && c.object.name === "JSON" && cName === "stringify") { flag("payload dump", "JSON.stringify"); return; }
        if (c.type === "Identifier" && c.name === "String" && n.arguments.some((a) => errorish(a) || (isMember(a) && propName(a) === "text"))) flag("error text", "String(error)");
        if (isMember(c) && cName === "toString" && errorish(c.object)) flag("error text", "error.toString()");
        if (isMember(c) && cName === "text") flag("response body", ".text()");
        if (cName === "inspect" || (isMember(c) && c.object.type === "Identifier" && c.object.name === "util")) flag("payload dump", `${cName}()`);
        if (isMember(c) && c.object.type === "Identifier" && c.object.name === "Object" && RECORD_DUMPERS.has(cName)) flag("payload dump", `Object.${cName}()`);
        if (c.type === "Identifier" && c.name === "String" && n.arguments.some((a) => PAYLOAD_RE.test(leafName(a) || ""))) flag("payload dump", "String(record)");
        // A method call's value is derived from its receiver (ids.join(", "), title.slice(0, 40)).
        if (isMember(c)) visit(c.object, false); else if (c.type !== "Identifier") visit(c, false);
        for (const a of n.arguments) visit(a, false);
        return;
      }
      // A value only TESTED is never printed: `x ? "set" : "none"`, `!x`, `typeof x`, `x == null`, the
      // left of `x && "..."` (a falsy value prints as false/0/""/null/undefined, never as data).
      case "ConditionalExpression": presence(n.test); visit(n.consequent, false); visit(n.alternate, false); return;
      case "UnaryExpression": if (n.operator === "!" || n.operator === "typeof") { presence(n.argument); return; } break;
      case "LogicalExpression": if (n.operator === "&&") { presence(n.left); visit(n.right, false); return; } break;
      case "BinaryExpression": if (/^[!=]==?$/.test(n.operator) && [n.left, n.right].some((x) => x.type === "NullLiteral" || (x.type === "Identifier" && x.name === "undefined") || x.type === "StringLiteral" || x.type === "NumericLiteral")) { presence(n.left); presence(n.right); return; } break;
      case "ObjectExpression":
        for (const pr of n.properties) {
          if (pr.type === "SpreadElement") { flag("record spread", "{ ...x }"); visit(pr.argument, false); }
          else { if (pr.computed) visit(pr.key, false); visit(pr.value ?? pr.body, false); }
        }
        return;
      case "SpreadElement": visit(n.argument, direct); return; // a forwarded argument list: judged by the wrapper's callers
      default: break;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments" || k === "extra") continue;
      if (n.type === "ObjectProperty" && k === "key" && !n.computed) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === "string" && visit(x, false));
      else if (v && typeof v.type === "string") visit(v, false);
    }
  };
  const presence = (n) => { if (n && n.type !== "Identifier" && !isMember(n)) visit(n, false); };
  // A member path's inner links (value.accountId.length → accountId is read).
  const visitPath = (m) => {
    const p = propName(m);
    if (p === "message" || p === "stack") flag("error text", `.${p}`);
    else if (p === "text") flag("response body", ".text");
    else if (p != null) { const r = nameRule(p); if (r) flag(r, `.${p}`); if (p === "key" && SPACEISH_RE.test(leafName(m.object) || "")) flag("raw space key (spaceKeyForLog)", `${leafName(m.object)}.key`); }
    if (m.computed) visit(m.property, false);
    if (isMember(m.object)) visitPath(m.object);
    else if (m.object.type !== "Identifier" && m.object.type !== "ThisExpression") visit(m.object, false);
  };
  for (const a of args) visit(a, direct);
  return found;
}

const parse = (src) => parseSync(src, { configFile: false, babelrc: false, sourceType: "module", parserOpts: { plugins: ["jsx"] } });

const isConsoleCall = (n) => isCall(n) && isMember(n.callee) && n.callee.object.type === "Identifier" && n.callee.object.name === "console";
const TEXT_METHODS = new Set(["slice", "substring", "substr", "join", "replace", "replaceAll", "trim", "trimStart", "trimEnd", "toString", "toLowerCase", "toUpperCase", "concat", "map", "filter", "padStart", "padEnd", "split", "stringify", "at"]);
const TEXT_FUNCTIONS = new Set(["String", "encodeURIComponent", "decodeURIComponent", "stringify", "route", "assumeTrustedRoute"]);
const LOGGER_OBJECTS = new Set(["console", "logger", "log"]); // console.warn(), logger.info(), log.error()
const isLoggerMethodCall = (n) => isCall(n) && isMember(n.callee) && n.callee.object.type === "Identifier" && LOGGER_OBJECTS.has(n.callee.object.name) && (n.callee.object.name !== "console" || METHODS.has(propName(n.callee)));
// The action log re-checks every field it prints (test/action-log.test.mjs); its functions are not wrappers.
const NOT_WRAPPERS = /src\/server\/shared\/action-log\.js$|src\/ui\/kit\/bridge\.js$/;

/**
 * LOGGER WRAPPERS, by position. A function whose parameter reaches a console (or logger, or another
 * wrapper's) call's arguments, as the argument itself or templated into one, directly or through a local
 * variable built from it (`const why = \`space ${key}\`; console.info(why)`). Returns
 * Map(name → [{ index, field, whole }]): `field` is a destructured property name ({ title }) or "rest";
 * `whole` says the parameter itself is a console argument (then a record passed to it is a dump).
 */
export function wrapperFlows(ast, known = new Map()) {
  const flows = new Map();
  const consider = (name, fn) => {
    if (!name || !fn || !fn.params?.length) return;
    const taint = new Map(); // local name → [{ index, field }]
    fn.params.forEach((prm, index) => {
      const x = prm.type === "AssignmentPattern" ? prm.left : prm;
      if (x.type === "Identifier") taint.set(x.name, [{ index, field: null }]);
      else if (x.type === "RestElement" && x.argument.type === "Identifier") taint.set(x.argument.name, [{ index, field: "rest" }]);
      else if (x.type === "ObjectPattern") for (const pr of x.properties) {
        if (pr.type !== "ObjectProperty") continue;
        const v = pr.value.type === "AssignmentPattern" ? pr.value.left : pr.value;
        const key = pr.key.type === "Identifier" ? pr.key.name : pr.key.value;
        if (v.type === "Identifier") taint.set(v.name, [{ index, field: key }]);
      }
    });
    // Identifiers READ inside an expression (not property names, not inside a safe formatter or a test).
    const reads = (expr) => {
      const out = [];
      const go = (n, parent, key) => {
        if (!n || typeof n.type !== "string") return;
        if (isCall(n) && n.callee.type === "Identifier" && SAFE_FORMATTERS.has(n.callee.name)) return;
        if (n.type === "ConditionalExpression") { go(n.consequent); go(n.alternate); return; }
        if (n.type === "UnaryExpression" && (n.operator === "!" || n.operator === "typeof")) return;
        if (n.type === "Identifier") { if (!(parent && parent.type === "ObjectProperty" && key === "key" && !parent.computed)) out.push(n.name); return; }
        // A field read prints the field (res.status), not the object: only the leaf decides, as in inspectArgs.
        if (isMember(n)) { if (n.computed) go(n.property); if (!isMember(n.object) && n.object.type !== "Identifier") go(n.object); return; }
        // A method call's value is derived from its receiver (key.slice(), ids.join()).
        // Only calls that pass their input through as text carry it on; any other call returns its own value
        // (a fetch result, a count), which is judged by the fields read from it.
        if (isCall(n)) {
          const cn = n.callee.type === "Identifier" ? n.callee.name : isMember(n.callee) ? propName(n.callee) : null;
          if (isMember(n.callee) && TEXT_METHODS.has(cn)) { go(n.callee.object); n.arguments.forEach((a) => go(a)); }
          else if (TEXT_FUNCTIONS.has(cn)) n.arguments.forEach((a) => go(a));
          return;
        }
        if (n.type === "AwaitExpression") return; // an awaited call's result is its own value
        for (const k of Object.keys(n)) {
          if (k === "loc" || k === "start" || k === "end" || k.endsWith("Comments") || k === "extra") continue;
          const v = n[k];
          if (Array.isArray(v)) v.forEach((c) => go(c, n, k)); else if (v && typeof v.type === "string") go(v, n, k);
        }
      };
      go(expr);
      return out;
    };
    // Two rounds of local propagation: const a = `${param}`; const b = a + "x";
    for (let round = 0; round < 2; round++) traverse.cheap(fn.body, (n) => {
      if (n.type !== "VariableDeclarator" || n.id.type !== "Identifier" || !n.init || /Function/.test(n.init.type)) return;
      const src = reads(n.init).flatMap((r) => taint.get(r) || []);
      if (src.length && !taint.has(n.id.name)) taint.set(n.id.name, src);
    });
    const found = [];
    const note = (args, wholeOk) => {
      for (const a of args) {
        const x = a.type === "SpreadElement" ? a.argument : a;
        const whole = wholeOk && x.type === "Identifier";
        for (const r of reads(x)) for (const t of taint.get(r) || []) found.push({ ...t, whole: whole && fn.params.some((pp) => (pp.type === "Identifier" && pp.name === r)) });
      }
    };
    traverse.cheap(fn.body, (n) => {
      if (isLoggerMethodCall(n)) note(n.arguments, true);
      else if (isCall(n) && n.callee.type === "Identifier" && known.has(n.callee.name) && n.callee.name !== name) {
        for (const [a, whole] of flowingArgs(n, known.get(n.callee.name))) note([a], whole);
      }
    });
    if (found.length) flows.set(name, [...new Map(found.map((f) => [`${f.index}|${f.field}|${f.whole}`, f])).values()]);
  };
  let defaultName = null;
  traverse(ast, {
    VariableDeclarator(p) { if (p.node.id.type === "Identifier" && /Function/.test(p.node.init?.type || "")) consider(p.node.id.name, p.node.init); },
    FunctionDeclaration(p) { consider(p.node.id?.name, p.node); },
    // export default function (...) / export default (...) => ... / export default someWrapper
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration;
      if (/Function/.test(d.type)) consider(DEFAULT_KEY, d);
      else if (d.type === "Identifier") defaultName = d.name;
    },
  });
  if (defaultName && flows.has(defaultName)) flows.set(DEFAULT_KEY, flows.get(defaultName));
  return flows;
}

// A file's default export, keyed per module in the global map ("default:src/x/y", extension dropped).
const DEFAULT_KEY = "\0default";
const moduleId = (file) => file.replace(/\.(?:js|jsx|mjs)$/, "").replace(/\/index$/, "");
const defaultKeyOf = (file) => `default:${moduleId(file)}`;
const resolveImport = (file, spec) => (spec.startsWith(".") ? moduleId(posix.normalize(posix.join(posix.dirname(file), spec))) : spec);

/** The arguments of one wrapper call that reach a console line, as [node, direct] pairs. */
function flowingArgs(call, flows) {
  const out = [];
  for (const f of flows) {
    if (f.field === "rest") { for (const a of call.arguments.slice(f.index)) out.push([a, f.whole]); continue; }
    const a = call.arguments[f.index];
    if (!a) continue;
    if (f.field && a.type === "ObjectExpression") {
      for (const pr of a.properties) {
        if (pr.type === "SpreadElement") out.push([pr, false]);
        else if (!pr.computed && (pr.key.name ?? pr.key.value) === f.field) out.push([pr.value ?? pr, false]);
      }
    } else out.push([a, f.whole && !f.field]);
  }
  return out;
}

/** local name → exported name (`import { a as b }` → b → a), and the namespace imports (`import * as ns`). */
function importsOf(ast, file) {
  const named = new Map();
  const namespaces = new Set();
  for (const n of ast.program.body) {
    if (n.type !== "ImportDeclaration") continue;
    const defaultKey = `default:${resolveImport(file, n.source.value)}`;
    for (const sp of n.specifiers) {
      if (sp.type === "ImportSpecifier") { const name = sp.imported.name ?? sp.imported.value; named.set(sp.local.name, name === "default" ? defaultKey : name); }
      else if (sp.type === "ImportDefaultSpecifier") named.set(sp.local.name, defaultKey); // import say from "./a.js"
      else if (sp.type === "ImportNamespaceSpecifier") namespaces.add(sp.local.name);
    }
  }
  return { named, namespaces };
}

/**
 * The findings for one source text: [{ line, method, findings }]. `globalFlows` holds the wrappers
 * found across src/ (a wrapper defined in another file counts where this file imports its name).
 */
export function scanSource(src, globalFlows = new Map(), file = "") {
  const out = [];
  const ast = parse(src);
  const local = NOT_WRAPPERS.test(file) ? new Map() : wrapperFlows(ast, globalFlows);
  const { named, namespaces } = importsOf(ast, file);
  const flowsOf = (name) => local.get(name) || (named.has(name) ? globalFlows.get(named.get(name)) : null);
  // ns.announce(...) through `import * as ns`
  const calleeFlows = (c) => (c.type === "Identifier" ? flowsOf(c.name) : isMember(c) && c.object.type === "Identifier" && namespaces.has(c.object.name) && propName(c) ? globalFlows.get(propName(c)) : null);
  const calleeName = (c) => (c.type === "Identifier" ? c.name : `${c.object.name}.${propName(c)}`);
  traverse(ast, {
    MemberExpression(p) {
      // console.error handed over as a value (`.catch(console.error)`) prints whatever arrives: an error object.
      const n = p.node;
      if (n.object.type === "Identifier" && n.object.name === "console" && METHODS.has(propName(n)) && !(isCall(p.parent) && p.parent.callee === n)) {
        out.push({ line: n.loc.start.line, method: `console.${propName(n)} (passed as a callback)`, findings: ["prints whatever it is handed: an error object or a record"] });
      }
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type === "Identifier" && LOGGER_NAMES.has(c.name)) {
        const findings = inspectArgs(p.node.arguments);
        if (findings.length) out.push({ line: p.node.loc.start.line, method: `${c.name} (logger wrapper)`, findings });
        return;
      }
      if (calleeFlows(c)) {
        const findings = flowingArgs(p.node, calleeFlows(c)).flatMap(([a, direct]) => inspectArgs([a], direct));
        if (findings.length) out.push({ line: p.node.loc.start.line, method: `${calleeName(c)} (logger wrapper)`, findings });
        return;
      }
      if (!isMember(c) || c.object.type !== "Identifier" || !LOGGER_OBJECTS.has(c.object.name)) return;
      const m = propName(c);
      if (c.object.name === "console" && !METHODS.has(m) && !c.computed) return;
      const findings = c.computed ? ["dynamic console method"] : inspectArgs(p.node.arguments);
      if (findings.length) out.push({ line: p.node.loc.start.line, method: c.object.name === "console" ? m : `${c.object.name}.${m} (logger)`, findings });
    },
  });
  return out;
}

/** Wrappers across a set of sources (two rounds, so a wrapper of a wrapper is found). */
export function globalWrapperFlows(sources) {
  let flows = new Map();
  for (let round = 0; round < 2; round++) {
    const next = new Map();
    for (const [file, src] of sources) { if (NOT_WRAPPERS.test(file)) continue; for (const [k0, v] of wrapperFlows(parse(src), flows)) { const k = k0 === DEFAULT_KEY ? defaultKeyOf(file) : k0; next.set(k, [...new Map([...(next.get(k) || []), ...v].map((f) => [`${f.index}|${f.field}|${f.whole}`, f])).values()]); } }
    flows = next;
  }
  return flows;
}

const walk = (d, acc = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(js|jsx|mjs)$/.test(p)) acc.push(p); } return acc; };

// ── the guard proves it bites (every shape that was fixed) and stays quiet on the clean ones ────
const bites = [
  'console.error("x failed:", e);',
  'console.warn("x failed:", err);',
  'console.error("x", error);',
  'console.warn("x", indexError);',
  'console.warn("x", noticeError, 1);',
  'console.warn(`x ${e}`);',
  'console.warn("x", e?.message || e);',
  'console.warn("x", e?.message);',
  'console.warn(`x ${String(e?.message || e).slice(0, 120)}`);',
  'console.warn(`x ${String(e)}`);',
  'console.warn(`x ${err.stack}`);',
  'console.warn(`x ${e.toString()}`);',
  'console.warn(`x ${value.accountId}`);',
  'console.warn(`x ${accountId}`);',
  'console.info(`x ${recipientAccountId}`);',
  'console.warn(`x by ${ctx.atlassianId}`);',
  'console.warn(`x by ${atlassianId}`);',
  'console.info(`x by=${live.authorId || "?"}`);',
  'console.warn(`x minter ${token.createdBy}`);',
  'console.warn(`x ${seal.lockedBy}`);',
  'console.warn(`x ${req.requesterId}`);',
  'console.warn(`x ${r.approver}`);',
  'console.warn(`x ${u.displayName}`);',
  'console.warn(`x ${u.email}`);',
  'console.warn(`x ${u.publicName}`);',
  'console.warn(`x ${actor}`);',
  'console.warn(`x "${put.title}"`);',
  'console.warn(`x "${originalTitle}"`);',
  'console.warn(`x ${artifactName}`);',
  'console.warn(`x ${sealRecord?.attachmentName || attachmentId}`);',
  'console.warn(`x ${list.map((a) => `${a.sectionId} (${a.sectionTitle})`).join(", ")}`);',
  'console.warn(`x ${body.declineReason}`);',
  'console.warn(`x ${cur.token}`);',
  'console.warn(`x ${res.status} ${await res.text()}`);',
  'console.warn(`x ${put.status} ${put.text || ""}`);',
  'console.warn(`x ${String(last.text).slice(0, 300)}`);',
  'console.error(`x ${response.status} - ${errorText}`);',
  'console.warn("x", JSON.stringify(body).slice(0, 200));',
  'console.warn(`x ${JSON.stringify(r)}`);',
  'console.warn(`x ${JSON.stringify(req.context.extension)}`);',
  'console.info("x summary", res);',
  'console.error("x", context?.extension);',
  'console.warn(`x ${e?.message || e}`);',
  'console.info("x", { pageId, who: ctx.atlassianId });',
  'console.warn(`x ${shown ? accountId : "-"}`);',
  'console.warn(`x ${ok || req.requesterAccountId}`);',
  'console.warn(`x ${noticeResult.reason ? sealRecord.attachmentName : ""}`);',
  'console.info(`[PANEL-AUTO] Auto-insert disabled for space ${spaceKey}, skipping`);',
  'console.warn(`[AUTHZ] space permissions ${space.key} -> 429`);',
  'console.warn(`x ${realmKey}`);',
  'console.warn(`x ${s.spaceKey}`);',
  'console.warn(`x ${spaceKeys.join(",")}`);',
  'console.warn(`x admin-settings-space-${storedKey}`);',
  'console.warn("x", { ...seal, pageId });',
  'console.warn("x", sealRecord);',
  'console.warn("x", row);',
  'const log = (m) => console.warn(m); log(`x ${spaceKey}`);',
  'function say(...a) { console.info("[X]", ...a); } say("y", e);',
  'log(`x threw: ${e?.message || e}`);',
  // round 3 (re-review): callbacks, templating wrappers, indirect variables, runtime text, record dumps, logger objects
  'p.catch(console.error);',
  'run().then(ok, console.warn);',
  'function queue(ids, why) { console.info(`[Q] queued ${ids.length} (${why})`); } queue([], ctx.atlassianId);',
  'function empty(reason, extra) { console.warn(`x ${safeKey(reason)} ${extra}`); } empty("a", sealRecord.attachmentName);',
  'function f(k) { const msg = `space ${k}`; console.warn(msg); } f(spaceKey);',
  'function g({ pageId, who }) { console.info(`x ${pageId} by ${who}`); } g({ pageId, who: actorAccountId });',
  'console.warn(`x ${e.cause}`);',
  'console.warn(`x ${res.body}`);',
  'console.warn(`x ${r.reason}`);',
  'console.warn(`x ${validation.errors.join(";")}`);',
  'console.warn(`x ${util.inspect(seal)}`);',
  'console.warn(`x ${inspect(row)}`);',
  'console.warn(`x ${Object.values(record).join(",")}`);',
  'console.warn(`x ${String(sealRecord)}`);',
  'logger.info(`x ${accountId}`);',
  'log.warn("x", err);',
];
for (const s of bites) ok(`guard bites: ${s.slice(0, 90)}`, scanSource(s).length === 1);
const quiet = [
  'console.error(`x failed: ${errText(e)}`);',
  'console.error("x failed:", errText(e));',
  'console.error(failureLine(key, e, sent));',
  'console.warn(`x page ${pageId} v${version} attachment ${attachmentId} space ${spaceKeyForLog(spaceKey)}`);',
  'console.warn(`x ${res.status} ${e.status} ${e.code}`);',
  'console.info(`x ${teamNames.length} teams, ${results.length} results`);',
  'console.info(`x ${r.outcome} ${body.kind} ${job.id} ${token.id}`);',
  'console.info("[ribbon]", show ? "OPEN" : "CLOSE", why);',
  'console.error(text);',
  'console.warn(`x ${key.split("-").slice(0, 3).join("-")}`);',
  'console.info(`x actor=${atlassianId ? "set" : "none"} ${!e ? "" : "failed"}`);',
  'console.log(`x ${summary.error ? " failed=yes" : ""} ${live.authorId && "author"}`);',
  'console.warn(`x ${reasonText(noticeResult.reason)} ${safeKey(body.kind, "none")} ${presentationText(seal.mediaBaseline)}`);',
  'console.warn(`x ${who === "user" ? "asUser" : "asApp"} ${typeof err}`);',
  'console.info(`x space ${spaceKeyForLog(spaceKey)} ${spaceKeyForLog(space.key)} ${spaceId}`);',
  'const log = (m) => console.warn(m); log(`x ${spaceKeyForLog(spaceKey)} ${errText(e)}`);',
  'console.error("x", response.status, info?.componentStack);',
  'function queue(ids, why) { console.info(`[Q] queued ${ids.length} (${why})`); } queue(changed, "space default");',
  'function call(path) { console.warn(`[RL] ${pathForLog(path)}`); } call(route`/wiki/rest/api/user?accountId=${accountId}`);',
  'function h(res) { const i = info(res); console.warn(`x ${i.remaining}`); } h(await fetchAs(accountId));',
  'console.warn(`x ${validation.errors.length} error(s) ${ids.size}`);',
  'console.warn(`x ${safeKey(info.reason, "-")} ${reasonText(r.reason)} ${bundlePathForLog(step.path)}`);',
  'p.catch((e) => console.error("x", errText(e)));',
];
for (const s of quiet) eq(`guard is quiet: ${s.slice(0, 90)}`, scanSource(s), []);

// ── a wrapper defined in one file and imported by another ────────────────────────────────────
{
  const a = ["src/a.js", 'export function announce(pageId, why) { console.info(`[A] ${pageId}: ${why}`); }'];
  const b = ["src/b.js", 'import { announce } from "./a.js";\nannounce(pageId, `by ${atlassianId}`);\nannounce(pageId, "quiet mode");'];
  const flows = globalWrapperFlows([a, b]);
  eq("cross-file: the importer's leaking call is found, its literal call is not", scanSource(b[1], flows, b[0]).map((h) => h.line), [2]);
  eq("cross-file: a same-named function NOT imported is not judged", scanSource('function announce() {}\nannounce(pageId, atlassianId);', flows, "src/c.js"), []);
  eq("cross-file: an aliased import is judged", scanSource('import { announce as say } from "./a.js";\nsay(pageId, atlassianId);', flows, "src/d.js").map((h) => h.line), [2]);
  const dA = ["src/infra/say.js", 'export default function (pageId, why) { console.info(`[S] ${pageId}: ${why}`); }'];
  const dB = ["src/infra/shout.js", 'const shout = (why) => console.warn(`[H] ${why}`);\nexport default shout;'];
  const dFlows = globalWrapperFlows([dA, dB]);
  eq("cross-file: a default-imported wrapper is judged", scanSource('import say from "../infra/say.js";\nsay(pageId, atlassianId);\nsay(pageId, "quiet");', dFlows, "src/capsules/x.js").map((h) => h.line), [2]);
  eq("cross-file: `export default <name>` and `{ default as x }` are judged", scanSource('import { default as shout } from "../infra/shout.js";\nshout(`by ${atlassianId}`);', dFlows, "src/capsules/y.js").map((h) => h.line), [2]);
  eq("cross-file: a default import from another module is not that wrapper", scanSource('import say from "./other.js";\nsay(pageId, atlassianId);', dFlows, "src/capsules/z.js"), []);
  eq("cross-file: a namespace import is judged", scanSource('import * as notify from "./a.js";\nnotify.announce(pageId, atlassianId);\nnotify.announce(pageId, "quiet");', flows, "src/e.js").map((h) => h.line), [2]);
}

// ── the space-key masker (src/ui/kit/error-facts.js) and the bundle path formatter ─────────────
{
  const { spaceKeyForLog } = await import("../src/ui/kit/error-facts.js");
  const cases = [
    ["~557058653160a56112470dbaea333ac760364e", "~personal"],
    ["~john.smith", "~personal"],
    ["~john.smith:work+x", "~personal"],
    ["~josé.ñúñez", "~personal"],
    ["~jsmith@example", "~personal"],
    ["%7Ejohn.smith", "~personal"],
    ["%7ejohn.smith", "~personal"],
    ["admin-settings-space-~john.smith", "admin-settings-space-~personal"],
    ["admin-settings-space-_557058653160a5611", "admin-settings-space-~personal"],
    ["authz-space-id-#7e.john#2e.smith", "authz-space-id-~personal"],
    ["space ~john.smith is in quiet mode", "space ~personal is in quiet mode"],
    ["/wiki/spaces/~john.smith/pages/1", "/wiki/spaces/~personal/pages/1"],
    ["(~abc)", "(~personal)"],
    ["[~john.smith] <~x> {~y}", "[~personal] <~personal> {~personal}"],
    ["space ~abc; next", "space ~personal; next"],
    ["MY_SPACE", "MY_SPACE"],
    ["FIN", "FIN"],
    ["admin-settings-space-FIN", "admin-settings-space-FIN"],
    ["space FIN is in quiet mode", "space FIN is in quiet mode"],
  ];
  for (const [input, want] of cases) eq(`spaceKeyForLog(${JSON.stringify(input)})`, spaceKeyForLog(input), want);
  eq("spaceKeyForLog leaves non-strings alone", [spaceKeyForLog(null), spaceKeyForLog(undefined)], [null, undefined]);
  const { bundlePathForLog } = await import("../src/server/capsules/config-api/pure.js");
  const paths = [
    ["spaces.FIN.policy", "spaces.FIN.policy"],
    ["spaces.~john.smith.policy", "spaces.~personal.policy"],
    ["spaces.~557058653160a5611.workflows[2]", "spaces.~personal.workflows[2]"],
    ["spaces.~john.smith.workflows.$replace", "spaces.~personal.workflows.$replace"],
    ["spaces.~a.b.c.unknownTail", "spaces.~personal"],
    ["spaces.MY_SPACE.policy", "spaces.MY_SPACE.policy"],
    ["spaces.MY_SPACE.unknownTail", "spaces.MY_SPACE.unknownTail"],
    ["spaces.%7Ejohn.smith.policy", "spaces.~personal.policy"],
    ["site.policy", "site.policy"],
    ["content[3]", "content[3]"],
  ];
  for (const [input, want] of paths) eq(`bundlePathForLog(${JSON.stringify(input)})`, bundlePathForLog(input), want);
}

// ── the app ───────────────────────────────────────────────────────────────────────────────────
const files = walk(join(root, "src")).filter((f) => !f.endsWith(`${"/"}test-hook.js`));
ok("the scan sees the app (more than 80 source files)", files.length > 80);
let calls = 0;
const offenders = [];
const sources = files.map((f) => [relative(root, f), readFileSync(f, "utf8")]);
const appFlows = globalWrapperFlows(sources);
ok(`the scan finds the app's logger wrappers (${appFlows.size})`, appFlows.size >= 3);
for (const [f, src] of sources) {
  calls += (src.match(/\bconsole\.(?:log|warn|error|info|debug|trace|dir|table)\s*\(/g) || []).length;
  for (const hit of scanSource(src, appFlows, f)) offenders.push(`${f}:${hit.line} ${hit.method.includes("(") ? hit.method : `console.${hit.method}`} — ${[...new Set(hit.findings)].join("; ")}`);
}
ok(`the scan sees the console calls (${calls})`, calls > 300);
for (const o of offenders) console.log(`  OFFENDER ${o}`);
eq(`no console call prints personal data, titles, free text, secrets, error text or a payload (${offenders.length} offenders listed above)`, offenders.length, 0);

report("log-privacy");
