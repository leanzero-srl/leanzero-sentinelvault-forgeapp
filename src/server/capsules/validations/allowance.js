/*
 * The SITE-WIDE monthly AI allowance (owner decision 2026-10-26). Forge LLM tokens are billed to
 * LeanZero, so every site gets a monthly allowance of one worst-case review per licensed user:
 *
 *   allowance = max(licensed users, 10) x 30,480 micro-dollars        ($0.0305 per user per month)
 *
 * Worst-case review = 10,000 input + 4,096 output tokens at the Haiku 4.5 price on Forge LLM
 * ($1 per 1M input, $5 per 1M output: cost in micro-dollars = in x 1 + out x 5). Only Haiku is ever
 * called (forge-llm.js isForgeLlmModelAllowed), so the price holds for every call.
 *
 * The meter is ONE row per site per UTC month, `ai-allowance-YYYYMM`, changed ONLY under the KVS lock
 * `ai-allowance-lock` (shared/kvs-lock.js). Right before each model call the consumer RESERVES the
 * worst case for that prompt; after the call it SETTLES to the tokens the model reported (a failed
 * call reports zeros). A crashed run leaves its reservation counted; a reservation older than
 * RESERVATION_MAX_MS is charged as spent at its reserved size (fail-safe, and it keeps the row small).
 * A busy lock or a failed KVS read REFUSES the review ("busy"): never a review the meter cannot see.
 * A new month is a new row: rollover needs no job.
 *
 * The user count comes from Confluence's licence userCount, read AS THE APP, cached daily; a failed
 * read uses the last good count up to 35 days old, then the 10-user allowance. A trial or an inactive
 * licence gets the 10-user allowance (a trial is not licence-funded), and so does a production
 * install with no licence object. Users never supply the number.
 *
 * An admin may LOWER the allowance (validation-config-global.ai.monthlyAllowanceMicro), never raise
 * it: the effective limit is min(stored, default), on save and on every read.
 */
import { kvs as forgeKvs } from "@forge/kvs";
import { route, getAppContext } from "@forge/api";
import { makeLocks } from "../../shared/kvs-lock.js";
import { appConfluence } from "../../shared/confluence-call.js";
import { errText } from "../../shared/action-log.js";

export const IN_MICRO_PER_TOKEN = 1;
export const OUT_MICRO_PER_TOKEN = 5;
export const MAX_OUTPUT_TOKENS = 4096;
export const OUTPUT_RESERVE_MICRO = MAX_OUTPUT_TOKENS * OUT_MICRO_PER_TOKEN; // 20,480
export const PER_USER_MICRO = 10000 * IN_MICRO_PER_TOKEN + OUTPUT_RESERVE_MICRO; // 30,480
export const FREE_TIER_USERS = 10;
export const COUNT_TTL_MS = 24 * 3600 * 1000;
export const COUNT_STALE_MAX_MS = 35 * 24 * 3600 * 1000;
export const RESERVATION_MAX_MS = 20 * 60 * 1000; // longer than any consumer (120 s) can run
export const LOCK_KEY = "ai-allowance-lock";
export const ROW_PREFIX = "ai-allowance-";
export const COUNT_KEY = "ai-licensed-users";
const LOCK_HOLD_MS = 15000;
const LOCK_WAIT_MS = 8000;
const ROW_TTL_MS = 400 * 24 * 3600 * 1000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** PURE. "YYYYMM" of the UTC month containing `ms`. */
export function monthKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** PURE. The first instant of the UTC month after the one containing `ms`. */
export function nextMonthStart(ms) {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
export const rowKey = (month) => `${ROW_PREFIX}${month}`;
/** PURE. "October 2026" for "202610". */
export function monthLabel(month) {
  const m = String(month || "");
  return `${MONTHS[Number(m.slice(4, 6)) - 1] || "this month"} ${m.slice(0, 4)}`.trim();
}
/** PURE. "1 November 2026". */
export function resetLabel(ms) {
  const d = nextMonthStart(ms);
  return `1 ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** PURE. What the model reported, in micro-dollars. */
export function costMicro(usage) {
  const i = Math.max(0, Number(usage?.inputTokens) || 0);
  const o = Math.max(0, Number(usage?.outputTokens) || 0);
  return i * IN_MICRO_PER_TOKEN + o * OUT_MICRO_PER_TOKEN;
}
/** PURE. The worst case for a prompt of `chars` characters (~3 chars a token is generous). */
export function estimateMicro(chars) {
  return Math.ceil(Math.max(0, Number(chars) || 0) / 3) * IN_MICRO_PER_TOKEN + OUTPUT_RESERVE_MICRO;
}
/** PURE. The default allowance for `users` licensed users (10-user floor). */
export function defaultAllowanceMicro(users) {
  const n = Math.max(FREE_TIER_USERS, Math.floor(Number(users) || 0));
  return n * PER_USER_MICRO;
}
/** PURE. An admin's stored value only ever LOWERS the default. */
export function effectiveLimitMicro(defaultMicro, stored) {
  const s = Math.floor(Number(stored));
  return Number.isFinite(s) && s > 0 ? Math.min(s, defaultMicro) : defaultMicro;
}
/**
 * PURE. Does the licence force the 10-user allowance? `ctx` is getAppContext().
 * A trial (isEvaluation) or an inactive licence: yes. Production with no licence object: yes.
 * Development / staging (no licence object): no, the count applies.
 */
export function licenceForcesFreeTier(ctx) {
  const lic = ctx?.license;
  if (lic) {
    if (lic.isEvaluation === true) return "trial";
    if (lic.active === false) return "unlicensed";
    return null;
  }
  return String(ctx?.environmentType || "").toUpperCase() === "PRODUCTION" ? "unlicensed" : null;
}
/** PURE. A remaining amount below one review's output reserve cannot run a review. */
export const isExhausted = (limit, spent, reserved) => limit - spent - reserved <= OUTPUT_RESERVE_MICRO;

const emptyRow = () => ({ spentMicro: 0, reservedMicro: 0, runs: 0, reservations: {}, reachedAt: null });

/** PURE. Charge reservations older than RESERVATION_MAX_MS as spent (a run that died). Mutates `row`. */
export function expireReservations(row, nowMs) {
  for (const [id, r] of Object.entries(row.reservations || {})) {
    const at = Date.parse(r?.at || "");
    if (!Number.isFinite(at) || nowMs - at >= RESERVATION_MAX_MS) {
      row.spentMicro += Number(r?.micro) || 0;
      delete row.reservations[id];
    }
  }
  row.reservedMicro = Object.values(row.reservations || {}).reduce((s, r) => s + (Number(r?.micro) || 0), 0);
  return row;
}

export function allowanceMessage(nowMs) {
  return `This site has used its AI review allowance for ${monthLabel(monthKeyOf(nowMs))}. AI review starts again on ${resetLabel(nowMs)}. Other Sentinel Vault features keep working.`;
}
export const ALLOWANCE_BUSY_REASON = "AI review is busy right now. Please try again in a minute.";
export const COUNT_FALLBACK_NOTE = "Could not read the licensed user count; using the 10-user allowance.";

async function readUserCount() {
  const res = await appConfluence(route`/wiki/rest/license/1.0/license/userCount`);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  const n = Number(body?.count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Bind the allowance to a KVS (the real one by default; tests pass fakes and a clock). */
export function makeAllowance({
  kvs = forgeKvs,
  locks = makeLocks(kvs),
  now = () => Date.now(),
  fetchCount = readUserCount,
  appContext = () => { try { return getAppContext(); } catch (_) { return null; } },
  lockWaitMs = LOCK_WAIT_MS,
} = {}) {
  /** { users, source } — source: "count" | "cached" | "stale-cache" | "fallback" | "trial" | "unlicensed". */
  async function licensedUsers() {
    const forced = licenceForcesFreeTier(appContext());
    if (forced) return { users: FREE_TIER_USERS, source: forced };
    let cached = null;
    try { cached = await kvs.get(COUNT_KEY); } catch (_) { cached = null; }
    const at = Date.parse(cached?.at || "");
    const age = Number.isFinite(at) ? now() - at : Infinity;
    if (cached?.count > 0 && age < COUNT_TTL_MS) return { users: cached.count, source: "cached" };
    let count = null;
    try { count = await fetchCount(); } catch (e) { console.warn("[AI-ALLOWANCE] user count read failed:", errText(e)); }
    if (count > 0) {
      try { await kvs.set(COUNT_KEY, { count, at: new Date(now()).toISOString() }); } catch (_) { /* next read retries */ }
      return { users: count, source: "count" };
    }
    if (cached?.count > 0 && age < COUNT_STALE_MAX_MS) return { users: cached.count, source: "stale-cache" };
    return { users: FREE_TIER_USERS, source: "fallback" };
  }

  /** The limit for this site now: { limitMicro, defaultMicro, lowered, users, userSource }. */
  async function limits(globalAi) {
    const { users, source } = await licensedUsers();
    const defaultMicro = defaultAllowanceMicro(users);
    const limitMicro = effectiveLimitMicro(defaultMicro, globalAi?.monthlyAllowanceMicro);
    return { limitMicro, defaultMicro, lowered: limitMicro < defaultMicro, users, userSource: source };
  }

  /** The admin's view (read only). Throws when the meter row cannot be read. */
  async function view(globalAi) {
    const t = now();
    const month = monthKeyOf(t);
    const lim = await limits(globalAi);
    const row = expireReservations({ ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) }, t);
    const remainingMicro = Math.max(0, lim.limitMicro - row.spentMicro - row.reservedMicro);
    return {
      month, monthLabel: monthLabel(month), resetsOn: nextMonthStart(t).toISOString(), resetLabel: resetLabel(t),
      ...lim, spentMicro: row.spentMicro, reservedMicro: row.reservedMicro, remainingMicro, runs: row.runs,
      exhausted: isExhausted(lim.limitMicro, row.spentMicro, row.reservedMicro), reachedAt: row.reachedAt || null,
      ...(lim.userSource === "fallback" ? { note: COUNT_FALLBACK_NOTE } : {}),
    };
  }

  /** Cheap, non-reserving check for the request paths: { ok } or { ok:false, why, reason }. */
  async function precheck(globalAi) {
    try {
      const v = await view(globalAi);
      return v.exhausted ? { ok: false, why: "allowance", reason: allowanceMessage(now()) } : { ok: true };
    } catch (e) {
      console.error("[AI-ALLOWANCE] precheck failed:", errText(e));
      return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON };
    }
  }

  async function underLock(fn) {
    return locks.withLock(LOCK_KEY, LOCK_HOLD_MS, fn, { waitMs: lockWaitMs, stepMs: 150 });
  }

  /**
   * Reserve `micro` for run `id` right before the model call. Returns
   * { ok:true, month, id, micro } or { ok:false, why:"allowance"|"busy", reason, firstTrip }.
   */
  async function reserve(id, micro, globalAi) {
    let lim;
    try { lim = await limits(globalAi); } catch (e) { return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON }; }
    try {
      return await underLock(async () => {
        const t = now();
        const month = monthKeyOf(t);
        const row = expireReservations({ ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) }, t);
        if (row.spentMicro + row.reservedMicro + micro > lim.limitMicro) {
          const firstTrip = !row.reachedAt;
          if (firstTrip) { row.reachedAt = new Date(t).toISOString(); await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } }); }
          return { ok: false, why: "allowance", reason: allowanceMessage(t), firstTrip, month, limitMicro: lim.limitMicro };
        }
        row.reservations[id] = { micro, at: new Date(t).toISOString() };
        row.reservedMicro += micro;
        await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } });
        return { ok: true, month, id, micro, limitMicro: lim.limitMicro };
      });
    } catch (e) {
      console.warn("[AI-ALLOWANCE] reserve refused:", errText(e));
      return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON };
    }
  }

  /**
   * Settle a reservation to what the model reported, in the month it was RESERVED in. Returns
   * { settled, firstTrip, month, limitMicro }. If the lock cannot be had, the reservation stays and
   * is charged at its reserved (larger) size when it expires: never under-counted.
   */
  async function settle(reservation, usage) {
    if (!reservation?.ok) return { settled: false };
    const { month, id, limitMicro } = reservation;
    try {
      return await underLock(async () => {
        const row = { ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) };
        row.reservations = row.reservations || {};
        // A reservation that already expired was charged at its reserved size (>= what the model
        // can report for that prompt): charging the actual on top would bill it twice.
        if (row.reservations[id]) {
          delete row.reservations[id];
          row.spentMicro += costMicro(usage);
        }
        row.runs = (row.runs || 0) + 1;
        expireReservations(row, now());
        let firstTrip = false;
        if (!row.reachedAt && isExhausted(limitMicro, row.spentMicro, row.reservedMicro)) {
          row.reachedAt = new Date(now()).toISOString();
          firstTrip = true;
        }
        await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } });
        return { settled: true, firstTrip, month, limitMicro };
      });
    } catch (e) {
      console.warn("[AI-ALLOWANCE] settle deferred:", errText(e));
      return { settled: false };
    }
  }

  return { licensedUsers, limits, view, precheck, reserve, settle };
}

const real = makeAllowance();
export const aiAllowance = real;
