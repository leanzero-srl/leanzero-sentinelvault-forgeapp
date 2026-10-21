// Through the default export (the documented `api.asApp()` shape): test fakes that patch it apply here too.
import api from "@forge/api";
import { AsyncLocalStorage } from "node:async_hooks";
import { safeKey } from "./action-log.js";

// ── The ONE door to Confluence's REST API (8.12.0) ─────────────────────────────────────────────
//
// WHY. Confluence meters apps in POINTS per hour (developer.atlassian.com/cloud/confluence/
// rate-limiting: 1 point per page/space/attachment object read, 2 per user, group or permission
// object; the default Global Pool is 65,000 points an hour SHARED by every site the app is on, reset
// at the top of each UTC hour, and once it is spent every request is refused until the reset). On
// 2026-10-18 the space-admin check of 8.10.0 (186 permission rows ≈ 375 points, run ~6 times per
// banner refresh) spent that pool in under an hour, and every customer site got 429 for the rest of
// it. A 429 was then read as "not a space admin", and the approver picker's group fetch sent the
// same request twice.
//
// What this module does for every call that goes through it:
//   1. a 429 is LOGGED with the headers that say why (RateLimit-Reason global/tenant, Retry-After,
//      X-RateLimit-Reset/-Remaining/-Limit), so the next incident is attributable;
//   2. an idempotent read is retried: it waits Retry-After (or a doubling backoff from 500 ms with
//      ±30 % jitter when there is none), at most twice, and never past the invocation's budget (20 s
//      of the 25 s resolver limit; 6 s of waiting outside a resolver). A quota answer ("come back at
//      the top of the hour") is never waited out;
//   3. a 429 that stands is noted on the INVOCATION (rateLimitOf), so an authorization question it
//      left unanswered is told apart from a "no" (authzUnknownOf / registry.js busyAware).
//
// Every resolver invocation runs inside runInvocation (registry.js), which also carries a memo for
// answers that do not change within one invocation (the caller's user record, the space admin set).
// Outside a resolver (a product trigger, a queue consumer) there is no scope: calls still retry and
// log, and nothing is memoised.

const als = new AsyncLocalStorage();

export const RESOLVER_BUDGET_MS = 20_000; // Forge resolvers stop at 25 s; 5 s are left for the work after the reads
export const UNSCOPED_WAIT_MS = 6_000;    // outside a resolver: the most one call waits in total
export const MAX_RETRIES = 2;
export const MAX_SINGLE_WAIT_MS = 8_000;  // a longer Retry-After is a spent quota, not a burst: answer now

/**
 * Run `fn` as one invocation: its own memo, its own rate-limit notes, its own deadline. With a
 * `label` (the resolver key, the trigger name) the invocation ends with ONE log line counting what
 * it asked Confluence, by kind — the measurement for the points budget (space-permission rows cost
 * 2 points each): `[CONFLUENCE] ribbon-evaluate calls=7 perms=1 users=1 groups=0 spaces=1 other=4 429=0`.
 */
export function runInvocation(fn, { budgetMs = RESOLVER_BUDGET_MS, label = null } = {}) {
  const now = Date.now();
  const scope = { startedAt: now, deadline: now + budgetMs, memo: new Map(), rateLimited: null, authzUnknown: false, nearLimitLogged: false, counts: null };
  if (!label) return als.run(scope, fn);
  scope.counts = { calls: 0, perms: 0, users: 0, groups: 0, spaces: 0, other: 0, limited: 0 };
  return als.run(scope, async () => {
    try { return await fn(); } finally {
      const c = scope.counts;
      if (c.calls > 0) console.info(`[CONFLUENCE] ${label} calls=${c.calls} perms=${c.perms} users=${c.users} groups=${c.groups} spaces=${c.spaces} other=${c.other} 429=${c.limited} ms=${Date.now() - now}`);
    }
  });
}

/** PURE. The kind of a Confluence path, for the per-invocation count. */
export function callKind(path) {
  const p = pathForLog(path);
  if (/\/permissions$/.test(p) && p.includes("/spaces/")) return "perms";
  if (p.startsWith("/wiki/rest/api/user/memberof") || /\/group/.test(p)) return "groups";
  if (p.startsWith("/wiki/rest/api/user")) return "users";
  if (p.startsWith("/wiki/api/v2/spaces")) return "spaces";
  return "other";
}

/** The current invocation's scope, or null outside one. */
export const currentInvocation = () => als.getStore() || null;

/**
 * Memoise `load()` for the rest of this invocation under `key` (callers prefix it with what it is).
 * Concurrent askers share one in-flight promise. A null/undefined answer or a rejection is NOT kept,
 * so a failed read is asked again instead of inherited. Outside an invocation it just loads.
 * An entry lives at most MEMO_TTL_MS even inside a long invocation (a 15-minute queue consumer), so
 * a permission answer memoised here is never older than the cross-invocation cache allows.
 */
export const MEMO_TTL_MS = 60_000;
export function invocationMemo(key, load) {
  const scope = currentInvocation();
  if (!scope) return load();
  const cur = scope.memo.get(key);
  if (!cur || Date.now() - cur.at > MEMO_TTL_MS) {
    const entry = { at: Date.now(), p: null };
    entry.p = Promise.resolve().then(load).then(
      (v) => {
        if (v == null && scope.memo.get(key) === entry) scope.memo.delete(key);
        // A value read from a cache carries when Confluence said it (`sourceAt`): the memo expires
        // with THAT time, so a 59 s old cached grant is not kept another minute (review 2026-10-18).
        const src = Number(v?.sourceAt);
        if (Number.isFinite(src) && src < entry.at) entry.at = src;
        return v;
      },
      (e) => { if (scope.memo.get(key) === entry) scope.memo.delete(key); throw e; },
    );
    scope.memo.set(key, entry);
    return entry.p;
  }
  return cur.p;
}

/** Wrap a Forge function handler so each call is one invocation (memo, notes, retry deadline). */
export const asInvocation = (handler, { budgetMs = RESOLVER_BUDGET_MS, label = null } = {}) =>
  (...args) => runInvocation(() => handler(...args), { budgetMs, label });

const headerOf = (res, name) => {
  try { const v = res?.headers?.get?.(name); return v == null || v === "" ? null : String(v); } catch (_) { return null; }
};

/** PURE. Seconds from a Retry-After value (delta-seconds or an HTTP date), or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.ceil(Number(s)));
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : null;
}

/** What a 429 (or a near-limit answer) says about the limit, from its headers. */
export function rateLimitInfo(res, now = Date.now()) {
  const reset = headerOf(res, "X-RateLimit-Reset");
  let retryAfterSeconds = parseRetryAfter(headerOf(res, "Retry-After"), now);
  if (retryAfterSeconds == null && reset) {
    const t = Date.parse(reset);
    if (Number.isFinite(t)) retryAfterSeconds = Math.max(0, Math.ceil((t - now) / 1000));
  }
  return {
    status: res?.status ?? null,
    retryAfterSeconds,
    reset,
    reason: headerOf(res, "RateLimit-Reason"),
    remaining: headerOf(res, "X-RateLimit-Remaining"),
    limit: headerOf(res, "X-RateLimit-Limit"),
    nearLimit: headerOf(res, "X-RateLimit-NearLimit"),
  };
}

/** PURE. The path for a log line: no query string (account ids live there), no label name (text a user typed). */
export function pathForLog(path) {
  const raw = typeof path === "string" ? path : (path?.value ?? path?.value_ ?? String(path));
  return String(raw).split("?")[0].replace(/\/label\/[^/]+/g, "/label/*");
}

/** PURE. The wait before retry number `attempt` (0-based): Retry-After + up to 30 %, else a jittered doubling from 500 ms. */
export function retryWaitMs(info, attempt, rand = Math.random) {
  if (info?.retryAfterSeconds != null) return Math.ceil(info.retryAfterSeconds * 1000 * (1 + 0.3 * rand()));
  return Math.ceil(500 * 2 ** attempt * (0.7 + 0.6 * rand()));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function noteRateLimited(info) {
  const scope = currentInvocation();
  if (!scope) return;
  const prev = scope.rateLimited;
  const secs = [prev?.retryAfterSeconds, info?.retryAfterSeconds].filter((v) => v != null);
  scope.rateLimited = { retryAfterSeconds: secs.length ? Math.max(...secs) : null, reason: info?.reason || prev?.reason || null };
}

/** The 429 that stood in this invocation ({ retryAfterSeconds, reason }), or null. */
export const rateLimitOf = () => currentInvocation()?.rateLimited || null;

/**
 * An authorization question in this invocation could not be answered because Confluence refused
 * with 429. The check itself still answered "no" (fail closed); this is how the resolver's answer
 * says "try again" instead of "you are not allowed". Call it ONLY when the 429 decided the answer.
 */
export function noteAuthzUnknown() {
  const scope = currentInvocation();
  if (scope) scope.authzUnknown = true;
}
export const authzUnknownOf = () => !!currentInvocation()?.authzUnknown;

/** PURE. Is this response a rate-limit refusal? */
export const isRateLimited = (res) => res?.status === 429;

async function call(who, path, init, { idempotent } = {}) {
  const method = String(init?.method || "GET").toUpperCase();
  const retriable = idempotent ?? (method === "GET" || method === "HEAD");
  const scope = currentInvocation();
  const until = scope ? scope.deadline : Date.now() + UNSCOPED_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    const requester = who === "user" ? api.asUser() : api.asApp();
    if (scope?.counts) { scope.counts.calls += 1; scope.counts[callKind(path)] += 1; }
    const res = await requester.requestConfluence(path, init);
    if (scope?.counts && res?.status === 429) scope.counts.limited += 1;
    if (res?.status !== 429) {
      if (scope && !scope.nearLimitLogged && headerOf(res, "X-RateLimit-NearLimit") === "true") {
        scope.nearLimitLogged = true;
        const i = rateLimitInfo(res);
        console.warn(`[RATE-LIMIT] near the limit: ${method} ${pathForLog(path)} remaining=${i.remaining ?? "-"} limit=${i.limit ?? "-"} reset=${i.reset ?? "-"}`);
      }
      return res;
    }
    const info = rateLimitInfo(res);
    const wait = retryWaitMs(info, attempt);
    const giveUp = !retriable || attempt >= MAX_RETRIES || wait > MAX_SINGLE_WAIT_MS || Date.now() + wait > until;
    console.warn(`[RATE-LIMIT] ${who === "user" ? "asUser" : "asApp"} ${method} ${pathForLog(path)} -> 429 reason=${safeKey(info.reason, info.reason ? "other" : "-")} retry-after=${info.retryAfterSeconds ?? "-"} reset=${info.reset || "-"} remaining=${info.remaining ?? "-"} limit=${info.limit ?? "-"} attempt=${attempt + 1} ${giveUp ? "giving up" : `retrying in ${wait} ms`}`);
    if (giveUp) { noteRateLimited(info); return res; }
    await sleep(wait);
  }
}

/** asApp().requestConfluence through the door (retry, logging, notes). `opts.idempotent` marks a read-only POST. */
export const appConfluence = (path, init, opts) => call("app", path, init, opts);
/** asUser().requestConfluence through the door. Throws whatever asUser() throws (no user session). */
export const userConfluence = (path, init, opts) => call("user", path, init, opts);

/**
 * PURE. What a person is told when Confluence's limit, not their rights, decided the answer.
 * `what` names what could not be done; `nothingChanged` adds that the action did not run.
 */
export function busyReason(retryAfterSeconds = null, { what = "your permissions could not be checked", nothingChanged = false } = {}) {
  const s = Number(retryAfterSeconds);
  const when = !Number.isFinite(s) || s <= 0 ? "in a minute"
    : s < 90 ? `in ${Math.max(5, Math.ceil(s / 5) * 5)} seconds`
      : `in about ${Math.ceil(s / 60)} minutes`;
  return `Confluence is limiting requests right now, so ${what}.${nothingChanged ? " Nothing was changed." : ""} Try again ${when}.`;
}
