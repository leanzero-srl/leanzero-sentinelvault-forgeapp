/*
 * What a THROWN value may say in a log line — PURE, no imports, shared by the server
 * (src/server/shared/action-log.js re-exports it) and the frontend bundle.
 *
 * A log line never prints an error's message, its String() form or the error object itself (console
 * prints message + stack): a message can carry a page title, a file name, a person's name or whatever
 * Confluence echoed back. It prints the error's class, an HTTP status and an upper-case code when the
 * error carries them, and where it was thrown (the app source file:line, read from the stack FRAMES;
 * the message line is cut off first and never parsed).
 *
 *   console.warn(`[X] step failed: ${errText(e)}`)  →  "[X] step failed: TypeError status=404 code=ENOTFOUND at server/capsules/x.js:120"
 *
 * test/log-privacy.test.mjs fails the build on a console call that prints a message or an error object.
 */
export const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const IDENT_RE = /^[A-Za-z_$][\w$]{0,59}$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

/** PURE. What a thrown value may say in a log line: its class, status, code and the app frame. */
export function errorFacts(e) {
  try {
    const out = {};
    const name = e && typeof e === "object" ? (typeof e.name === "string" ? e.name : e.constructor?.name) : null;
    out.errorType = typeof name === "string" && IDENT_RE.test(name) ? name : e instanceof Error ? "Error" : `thrown-${typeof e}`;
    const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) out.status = status;
    if (typeof e?.code === "string" && CODE_RE.test(e.code)) out.code = e.code;
    const step = stepOf(e);
    if (step) out.step = step;
    return out;
  } catch (_) {
    return { errorType: "unreadable" }; // a hostile getter or a revoked Proxy: never replace the real error
  }
}

// Frame names that are plumbing, not the app step (Promise.all, Function.prototype.call, generators...).
const BUILTIN_FRAMES = new Set(["Promise", "Array", "Object", "Function", "new", "anonymous", "all", "allSettled", "race", "any", "then", "call", "apply", "bind", "next", "step", "asyncGeneratorStep", "_next", "_throw", "fulfilled", "rejected", "processTicksAndRejections", "runMicrotasks", "map", "forEach", "reduce", "run", "runInvocation", "wrapped", "inner", "withInvocation"]);

/**
 * PURE. Where the error was thrown, from the stack FRAMES (the message line is cut off first and never
 * parsed): the app source file and line ("server/capsules/realms/actions.js:239") when the frame maps
 * to src/ (Forge bundles with source maps; its async transpilation renames functions to "call" /
 * "_invoke", so a name alone says nothing there), else the first app function name.
 */
export const STEP_RE = /^(?:[A-Za-z_$][\w$]{0,59}|[a-z0-9][\w./-]{0,100}\.(?:js|jsx|mjs):\d{1,6})$/;
export function stepOf(e) {
  let stack;
  try { stack = typeof e?.stack === "string" ? e.stack : ""; } catch (_) { return undefined; }
  if (!stack) return undefined;
  let msg = "";
  try { msg = typeof e?.message === "string" ? e.message : ""; } catch (_) { return undefined; }
  let rest;
  if (msg) {
    const at = stack.indexOf(msg);
    if (at < 0) return undefined;
    rest = stack.slice(at + msg.length);
  } else rest = stack;
  const firstFrame = rest.search(/\n\s+at /);
  if (firstFrame < 0) return undefined;
  let named;
  for (const line of rest.slice(firstFrame).split("\n")) {
    const m = line.match(/^\s+at (?:async )?(?:([A-Za-z_$][\w$.]*?)(?: \[as [\w$]+\])? \((.*)\)|(\S+))$/);
    if (!m) continue;
    const where = m[2] ?? m[3] ?? "";
    if (/node_modules|node:|internal\//.test(where)) continue;
    const src = where.match(/\/src\/([\w./-]+\.(?:js|jsx|mjs)):(\d+)(?::\d+)?$/);
    if (src && !src[1].endsWith("shared/action-log.js") && !src[1].endsWith("kit/error-facts.js")) { const s2 = `${src[1]}:${src[2]}`; if (STEP_RE.test(s2)) return s2; }
    const fn = m[1] ? m[1].split(".").pop() : null;
    if (!named && fn && IDENT_RE.test(fn) && !BUILTIN_FRAMES.has(fn)) named = fn;
  }
  return named;
}

/**
 * PURE. One log-safe phrase for a thrown value: "TypeError status=404 code=ENOTFOUND at
 * server/capsules/x.js:120" (each part only when the error carries it). Never throws, never reads
 * the message.
 */
export function errText(e) {
  const f = errorFacts(e);
  let out = f.errorType;
  if (f.status !== undefined) out += ` status=${f.status}`;
  if (f.code) out += ` code=${f.code}`;
  if (f.step) out += ` at ${f.step}`;
  return out;
}

/** PURE. A key-like value (a code, a slug, a manifest key) or the fallback: what a log line may print of a string it did not write. */
export const safeKey = (s, fallback = "unknown") => (typeof s === "string" && KEY_RE.test(s) ? s : fallback);

/**
 * PURE. A space key as a log line may print it. A PERSONAL space's key is "~" + its owner's account id
 * with the colon and dashes removed, or a legacy "~username" that may hold dots, colons, "+", "@" or
 * any letter. Every personal token prints as "~personal", masked from its start to the next whitespace,
 * "/", quote, comma, semicolon or bracket ( ) [ ] { } < > (or the end): a dot never ends it. Its start is "~", its URL-encoded "%7E", the
 * storage-key encoding "#7e." (steward-checks kvsPart) or "_" after a "-" (the "_" a sanitised storage
 * key such as "admin-settings-space-_557058..." puts in place of "~"; a global key never holds "_").
 * Keys of global spaces print unchanged. A structured string whose tail must survive (a bundle path
 * "spaces.<key>.policy") is formatted by its owner (config-api/pure.js bundlePathForLog).
 */
const PERSONAL_RE = /(?:~|%7e|#7e\.|(?<=-)_)[^\s/"',;()[\]{}<>]*/gi;
export const spaceKeyForLog = (k) => (typeof k === "string" ? k.replace(PERSONAL_RE, "~personal") : k);
