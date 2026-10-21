/*
 * The ONE door from the UI to the resolvers: `@forge/bridge` with `invoke` wrapped for the action log.
 * Every surface imports `invoke` from here (test/action-log.test.mjs fails on a direct import from
 * "@forge/bridge"); everything else the bridge exports passes through unchanged.
 *
 * WHAT IT ADDS. Clicks that do not call a resolver (a tab, a menu, Cancel, opening a dialog) are
 * remembered as control NAMES (ui-action-names.js: only strings written literally in this app's
 * source, never a label, a title, a key or anything typed) and ride the NEXT resolver call as
 * `payload.__lzTrail`. The backend wrapper (src/server/shared/action-log.js) strips it before the
 * action runs, re-checks every name, and prints the trail on that call's one log line. So a click
 * costs no invocation of its own, and a support log shows the buttons that led to an action.
 * Nothing is stored: the trail lives in this frame's memory and is lost when the frame closes.
 *
 * FRONTEND LOGS. Atlassian's Frontend Logging (EAP) records only the browser's console.error, uncaught
 * exceptions and unhandled rejections (no clicks). So a resolver call that FAILS in the browser (the
 * invoke rejects: a timeout, a network error, a thrown resolver) prints one console.error descriptor:
 *   {"lz":"ui-error","app":"sv","action":"<resolver key>","errorType":"Error","step":"invoke","trail":[...]}
 * with the same rules as the backend line: no message, no payload, names from the source only. It is
 * harmless while the EAP is off and needs nothing from it. `peekTrail()` is there for later use.
 */
import { invoke as bridgeInvoke } from "@forge/bridge";
import { nameOfId, pushName } from "./ui-action-names.js";

export * from "@forge/bridge";

let trail = [];
export const TRAIL_KEY = "__lzTrail";
export const BARE_KEY = "__lzBare"; // the call had no payload: the backend restores `undefined`

const CONTROL = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"], summary';
const roleOf = (el) => {
  const r = el.getAttribute("role");
  if (r) return r;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "input") return el.getAttribute("type") === "radio" ? "radio" : "checkbox";
  return tag; // button, summary
};
const idOf = (el) => (el && el.getAttribute ? el.getAttribute("data-lz") || el.getAttribute("data-testid") : null);

/** PURE over the DOM: the loggable name of a click on `target`, or null. */
export function nameOfClick(target) {
  const el = target && target.closest ? target.closest(CONTROL) : null;
  if (!el) return null;
  const own = nameOfId(idOf(el));
  if (own) return own;
  const parent = el.parentElement ? el.parentElement.closest("[data-lz], [data-testid]") : null;
  const named = parent ? nameOfId(idOf(parent)) : null;
  return named ? `${named}>${roleOf(el)}` : null;
}

export function track(name) { trail = pushName(trail, name); }
export const peekTrail = () => trail.slice();

if (typeof document !== "undefined" && !globalThis.__lzTrailListener) {
  globalThis.__lzTrailListener = true;
  // Capture phase: runs before React's own handler, so the click is in the trail that handler's
  // resolver call carries.
  document.addEventListener("click", (e) => { try { track(nameOfClick(e.target)); } catch (_) { /* never break a click */ } }, true);
}

const plain = (v) => v != null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const IDENT_RE = /^[A-Za-z_$][\w$]{0,59}$/;

/** PURE. The console.error descriptor of a failed resolver call (no message, no payload). */
export function failureLine(key, e, sent) {
  const name = e && typeof e === "object" ? (typeof e.name === "string" ? e.name : e.constructor && e.constructor.name) : null;
  return JSON.stringify({
    lz: "ui-error", app: "sv",
    action: typeof key === "string" && KEY_RE.test(key) ? key : "unknown",
    errorType: typeof name === "string" && IDENT_RE.test(name) ? name : "Error",
    step: "invoke",
    ...(sent && sent.length ? { trail: sent } : {}),
  });
}

export function invoke(key, payload, ...rest) {
  let sent = [];
  let body = payload;
  if (trail.length && (payload === undefined || plain(payload))) {
    sent = trail;
    trail = [];
    body = payload === undefined ? { [TRAIL_KEY]: sent, [BARE_KEY]: 1 } : { ...payload, [TRAIL_KEY]: sent };
  }
  return bridgeInvoke(key, body, ...rest).catch((e) => {
    try { console.error(failureLine(key, e, sent)); } catch (_) { /* never mask the failure */ }
    throw e;
  });
}
