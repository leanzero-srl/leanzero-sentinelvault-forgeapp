/*
 * The ACTION LOG (2026-10-21, owner: "logs for our apps — the combo of actual buttons pressed ... we
 * don't want user data, we just want what they're doing in the app"). When a customer reports a
 * problem, Forge's own logs now say which action they ran, from which surface, and how it ended.
 *
 * ONE line per action, printed inside the function the action already runs (no extra invocation, no
 * egress, no storage, no manifest change: plain console output that `forge logs` and the Developer
 * Console show):
 *
 *   {"lz":"action","app":"sv","v":"8.13.0","env":"production","via":"ui","action":"sealing.lock-attachment",
 *    "surface":"sentinel-vault-byline","outcome":"ok","ms":412,"trail":["pd-tab-attachments","pd-seal-open"]}
 *
 *   lz        always "action" (filter on it)
 *   app, v    "sv" and the Forge app version; env = the Forge environment type
 *   via       ui (a resolver), rest (the config REST API: the request, then one line per operation), job
 *             (a queue consumer that runs work a user started: scan, AI review, backup, REST job, restore)
 *   action    <area>.<key>: the capsule and the resolver key, "rest.<op>", "job.<queue>[.<kind>]"
 *   surface   the Forge module the call came from (its manifest key), "rest-api" or the queue
 *   outcome   ok | refused (the action said no: not sealed, already pending...) | denied (a permission
 *             or signature refusal) | busy (Confluence is limiting requests) | error (it threw) |
 *             timeout (still running 1.5 s before the platform limit; a later line may follow)
 *   errorType the error's class name (TypeError, FetchError...), with status (an HTTP status) and code
 *             (an upper-case error code) when the error carries them, and step: where it was thrown,
 *             as the app source file:line ("server/capsules/realms/actions.js:239") from the stack
 *             frames (the message is never read), or a named step a job reports ("llm-call")
 *   reason    the slug of a refusal whose text is written literally in the source (never one built at
 *             runtime, which can hold a name or a title)
 *   ms        how long the action took; trail = the UI controls pressed since the previous call
 *             (src/ui/kit/bridge.js), as names written literally in the source; dropped = how many
 *             trail entries were refused
 *
 * WHAT A LINE NEVER CARRIES: account ids, names, emails, space or page ids/keys/titles, file names,
 * content, secrets, codes, free text, payload values, error messages or refusal texts built at
 * runtime. By construction: every string field is either a fixed word of this module, a manifest
 * key, an identifier or a literal from this app's own source (scripts/gen-action-names.mjs), each
 * re-checked here. test/action-log.test.mjs pins that every resolver and user-started job is wrapped
 * and that a line holds no payload or context value.
 */
import * as forgeApi from "@forge/api";
import { cleanTrail } from "../../ui/kit/ui-action-names.js";
import { REASONS } from "./action-reasons.gen.js";
import { errorFacts, stepOf, STEP_RE, IDENT_RE, CODE_RE, KEY_RE, errText, safeKey, spaceKeyForLog } from "../../ui/kit/error-facts.js";

// errorFacts/stepOf/errText live in src/ui/kit/error-facts.js (pure, shared with the frontend bundle).
export { errorFacts, stepOf, STEP_RE, errText, safeKey, spaceKeyForLog };

export const LOGGED = Symbol.for("lz.action-log");
const TRAIL_KEY = "__lzTrail";
const BARE_KEY = "__lzBare";
const REASON_SET = new Set(REASONS);

const ACTION_RE = /^[a-z0-9][a-z0-9-]{0,40}(?:\.[a-z0-9][a-z0-9-]{0,63}){1,2}$/;

let appFacts = null;
function facts() {
  if (appFacts) return appFacts;
  let v = "unknown", env = "unknown";
  try {
    const c = typeof forgeApi.getAppContext === "function" ? forgeApi.getAppContext() : null;
    if (c && typeof c.appVersion === "string" && /^\d+\.\d+\.\d+$/.test(c.appVersion)) v = c.appVersion;
    if (c && typeof c.environmentType === "string" && /^[A-Z_]{1,20}$/i.test(c.environmentType)) env = c.environmentType.toLowerCase();
  } catch (_) { /* outside the Forge runtime (tests): keep "unknown" */ }
  appFacts = { v, env };
  return appFacts;
}
/** Tests only: forget the cached app version. */
export const resetFacts = () => { appFacts = null; };

function remainingMs() {
  try {
    const c = typeof forgeApi.getAppContext === "function" ? forgeApi.getAppContext() : null;
    const n = c && typeof c.invocationRemainingTimeInMillis === "function" ? c.invocationRemainingTimeInMillis() : null;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) { return null; }
}


/** PURE. The slug of a refusal text, only when the text is a literal of the source. */
export function reasonSlug(text) {
  if (typeof text !== "string" || !REASON_SET.has(text)) return undefined;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || undefined;
}

/**
 * PURE. A refusal or failure reason as a log line may print it: its slug when the text is a literal
 * of the source, "unlisted" when it was built at runtime (it may hold a title, a name or an error
 * message), "none" when there is none.
 */
export const reasonText = (text) => reasonSlug(text) || (text ? "unlisted" : "none");

// A refusal that is about WHO is asking (classified from the text; only the category is printed).
// Curated against every literal refusal in action-reasons.gen.js (test/action-log.test.mjs pins samples
// both ways): "must be an object" / "Only a label-scoped workflow" are input refusals, not permission ones.
const DENIED_RE = /\b(permission|not authori[sz]ed|unauthori[sz]ed|forbidden|cannot see|can't see|cannot (?:read|edit) (?:that|this)|do not have access|don't have access|no access to|not the (?:seal|section|file) owner|not an approver|not signed in|only (?:a |an |the )?(?:site |space |confluence )?admins?\b|only (?:this page's |the page's |the )?(?:approvers?|owner|requester)\b|only someone who can|only (?:a |an )?(?:space|site) admin)/i;

/** PURE. The outcome of a resolver's RETURNED value (a throw is handled by errorFacts). */
export function classifyResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { outcome: "ok" };
  const text = typeof result.reason === "string" ? result.reason : typeof result.error === "string" ? result.error : null;
  const refused = result.success === false || result.ok === false || (typeof result.error === "string" && result.success !== true);
  if (!refused) return { outcome: "ok" };
  if (result.busy === true) return { outcome: "busy" };
  const reason = reasonSlug(typeof result.deniedReason === "string" ? result.deniedReason : text);
  if (result.signatureRequired || result.codeRequired || result.lockedOut) return { outcome: "denied", errorType: "signature", ...(reason ? { reason } : {}) };
  const denied = (text && DENIED_RE.test(text)) || result.status === 403 || result.forbidden === true;
  return { outcome: denied ? "denied" : "refused", ...(reason ? { reason } : {}) };
}

/** PURE. The payload without the UI trail (and its bare marker), and the trail itself (cleaned). */
export function splitTrail(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !(TRAIL_KEY in payload || BARE_KEY in payload)) return { payload, trail: [], dropped: 0 };
  const { [TRAIL_KEY]: raw, [BARE_KEY]: bare, ...rest } = payload;
  const { trail, dropped } = cleanTrail(raw);
  // A bare call (the UI sent no payload) gets `{}`, exactly what @forge/resolver hands a payload-less call.
  return { payload: rest, trail, dropped };
}

/** Print ONE action line. Never throws. */
export function emit(fields) {
  try {
    const { v, env } = facts();
    const line = { lz: "action", app: "sv", v, env, ...fields };
    const text = JSON.stringify(line);
    if (fields.outcome === "error" || fields.outcome === "timeout") console.error(text);
    else console.log(text);
  } catch (_) { /* logging never breaks an action */ }
}

const RESOLVER_LIMIT_MS = 25_000;
const TIMEOUT_MARGIN_MS = 1_500;

/**
 * Run `fn(...args)` and print its one line. `describe(args)` returns the fixed fields
 * ({ via, action, surface }); `classify(result)` maps a returned value to { outcome, ... }.
 * A throw is printed as outcome "error" and RE-THROWN (behaviour unchanged).
 */
export function logged(fn, { describe, classify = classifyResult, limitMs = RESOLVER_LIMIT_MS }) {
  const wrapped = async (...args) => {
    const started = Date.now();
    let base;
    try { base = describe(...args); } catch (_) { base = { via: "ui", action: "unknown.unknown", surface: "unknown" }; }
    let timedOut = false;
    const budget = (remainingMs() ?? limitMs) - TIMEOUT_MARGIN_MS;
    const timer = budget > 0 ? setTimeout(() => { timedOut = true; emit({ ...base, outcome: "timeout", ms: Date.now() - started }); }, budget) : null;
    if (timer && typeof timer.unref === "function") timer.unref();
    try {
      const result = await fn(...args);
      let c;
      try { c = classify(result) || { outcome: "ok" }; } catch (_) { c = { outcome: "ok" }; }
      emit({ ...base, ...c, ms: Date.now() - started, ...(timedOut ? { afterTimeout: true } : {}) });
      return result;
    } catch (e) {
      emit({ ...base, outcome: "error", ...errorFacts(e), ms: Date.now() - started, ...(timedOut ? { afterTimeout: true } : {}) });
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  wrapped[LOGGED] = true;
  return wrapped;
}

/**
 * A resolver, logged: strips the UI trail from the payload before the action sees it and prints
 * `<area>.<key>` from the module the call came from.
 */
export function withActionLog(area, key, fn) {
  const action = `${safeKey(area)}.${safeKey(key)}`;
  const inner = async (req, meta) => fn(meta.req);
  const run = logged(inner, {
    describe: (_req, meta) => ({ via: "ui", action, surface: safeKey(_req?.context?.moduleKey, "none"), ...(meta.trail.length ? { trail: meta.trail } : {}), ...(meta.dropped ? { dropped: meta.dropped } : {}) }),
  });
  const wrapped = (req) => {
    const { payload, trail, dropped } = splitTrail(req?.payload);
    const clean = req && payload !== req.payload ? { ...req, payload } : req;
    return run(req, { req: clean, trail, dropped });
  };
  wrapped[LOGGED] = true;
  return wrapped;
}

export const OUTCOMES = Object.freeze(["ok", "refused", "denied", "busy", "skipped", "error", "timeout"]);
const OUTCOME_SET = new Set(OUTCOMES);

/**
 * PURE. The outcome of a queue consumer's returned value. A job may return
 * { outcome, step, errorType, status, code } itself (each re-checked here); otherwise ok/success
 * false is "refused", status "failed" is "error", anything else "ok". A throw is handled by logged().
 */
export function classifyJob(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { outcome: "ok" };
  if (OUTCOME_SET.has(r.outcome)) {
    const out = { outcome: r.outcome };
    if (typeof r.step === "string" && (KEY_RE.test(r.step) || STEP_RE.test(r.step))) out.step = r.step;
    if (typeof r.errorType === "string" && IDENT_RE.test(r.errorType)) out.errorType = r.errorType;
    if (Number.isInteger(r.status) && r.status >= 100 && r.status <= 599) out.status = r.status;
    if (typeof r.code === "string" && CODE_RE.test(r.code)) out.code = r.code;
    return out;
  }
  if (r.status === "failed") return { outcome: "error" };
  if (r.ok === false || r.success === false) return { outcome: "refused" };
  return { outcome: "ok" };
}

/** A queue consumer that runs work a user started, logged as `job.<name>[.<kind>]`. */
export function withJobLog(name, fn, { kinds = [], kindOf = (event) => event?.body?.kind ?? event?.payload?.kind, limitMs = 900_000, classify = classifyJob } = {}) {
  const base = `job.${safeKey(name)}`;
  return logged(fn, {
    limitMs,
    describe: (event) => {
      let k = null;
      try { k = kindOf(event); } catch (_) { k = null; }
      return { via: "job", action: kinds.includes(k) ? `${base}.${k}` : base, surface: safeKey(name) };
    },
    classify,
  });
}

/** PURE. A fixed action name, or "unknown.unknown" when it is not one. */
export const safeAction = (s) => (typeof s === "string" && ACTION_RE.test(s) ? s : "unknown.unknown");
