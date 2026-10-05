/*
 * One-at-a-time locks on Forge KVS (the backup lease, the privacy sweep lock, the pending-erasure
 * list).
 *
 * MEASURED 2026-10-05 on wolfaenpak dev: a lock row written with a 16-minute ttl was still
 * readable — and still made `keyPolicy: "FAIL_IF_EXISTS"` refuse — more than two hours after its
 * expireTime (a run killed during an A/B left it). The ttl is NOT a liveness guarantee: every
 * backup, restore and privacy erasure job failed "Another backup or restore is running" until the
 * row was cleaned up. A lock older than its hold time belongs to a dead run (every holder runs in
 * a 900 s consumer, shorter than the hold) and may be TAKEN OVER — safely:
 *
 *   B1  a read that FAILS (a 429, a 5xx) means HELD. Never "no lock": that stole a live lease.
 *   B2  the takeover is CLAIMED first with an atomic FAIL_IF_EXISTS row
 *       `${key}:takeover:${deadToken}`; only the claim's winner deletes the dead row and writes its
 *       own, after re-reading that the dead token is still there. Delete-then-write without a
 *       claim let two takers both win (33/200 in sv-break2/lock.mjs). A claim row that itself
 *       lingers (its taker died mid-takeover) is stale after CLAIM_MS and is claimed in turn by a
 *       chained key (`…:takeover:<dead>:<deadClaim>`), at most CLAIM_DEPTH deep.
 * Review 2026-10-05 (final). test/kvs-lock.test.mjs drives this with a fake KVS (latency, failed
 * reads, FAIL_IF_EXISTS) — both repros are RED on the previous version and GREEN here.
 */
import { kvs as forgeKvs } from "@forge/kvs";

export const CLAIM_MS = 120000;
const CLAIM_DEPTH = 3;

/** PURE. Is this lock row stale at `nowMs` (unreadable time, or older than `holdMs`)? A MISSING row is not stale: it is free. */
export function lockIsStale(row, nowMs, holdMs) {
  if (!row) return false;
  const at = Date.parse(row?.at || "");
  return !Number.isFinite(at) || nowMs - at >= holdMs;
}

/** PURE. The claim key for taking over `key` from the row carrying `deadToken`. */
export const takeoverKey = (key, deadToken) => `${key}:takeover:${deadToken || "unknown"}`;

/** Bind the lock functions to a KVS (the real one by default; tests pass a fake). */
export function makeLocks(kvs = forgeKvs) {
  const put = (key, token, holdMs) => kvs.set(key, { token, at: new Date().toISOString() }, { ttl: { value: Math.ceil(holdMs / 1000), unit: "SECONDS" }, keyPolicy: "FAIL_IF_EXISTS" });
  const tryPut = async (key, token, holdMs) => { try { await put(key, token, holdMs); return true; } catch (_) { return false; } };
  /** "absent" | "failed" | the row. A failed read is never mistaken for an absent row (B1). */
  const read = async (key) => { try { const v = await kvs.get(key); return v == null ? "absent" : v; } catch (_) { return "failed"; } };

  /**
   * Win the right to take over `key` from `deadToken`: a FAIL_IF_EXISTS claim, chained past dead
   * claims (each level is atomic, so a chain never lets two takers both win). At the last level a
   * claim dead for 3× CLAIM_MS is deleted and re-claimed, logged (review L4: a 3-deep chain of dead
   * claims used to wedge the lock until KVS purged the rows) — the only non-atomic step, reached
   * only after CLAIM_DEPTH takers in a row died mid-takeover.
   */
  async function claim(key, deadToken, token, depth = 0) {
    const ck = takeoverKey(key, deadToken);
    if (await tryPut(ck, token, CLAIM_MS)) return ck;
    const c = await read(ck);
    if (c === "failed" || c === "absent" || !lockIsStale(c, Date.now(), CLAIM_MS)) return null;
    if (depth < CLAIM_DEPTH - 1) return claim(ck, c.token, token, depth + 1);
    if (!lockIsStale(c, Date.now(), 3 * CLAIM_MS)) return null;
    console.warn(`[LOCK] ${ck}: a claim chain ${CLAIM_DEPTH} deep, dead for 3× ${CLAIM_MS} ms — cleared`);
    try { await kvs.delete(ck); } catch (_) { return null; }
    return (await tryPut(ck, token, CLAIM_MS)) ? ck : null;
  }

  /** Try once to take `key` for `holdMs`. Resolves true only when this caller holds it (with `token`). */
  async function acquireLock(key, holdMs, token) {
    if (await tryPut(key, token, holdMs)) return true;
    const cur = await read(key);
    if (cur === "failed") return false; // B1: cannot see it → treat as held
    // Released meanwhile: one more atomic try. NEVER a delete here (review round 4): a refused write
    // after an empty read almost always means another caller took the lock in between, so clearing
    // "ghost" rows deleted LIVE holders (26 overlapping holds in sv-break4/count.mjs). The measured
    // real case — an expired row that is still READABLE — is the stale takeover below.
    if (cur === "absent") return tryPut(key, token, holdMs);
    if (!lockIsStale(cur, Date.now(), holdMs)) return false;
    const ck = await claim(key, cur.token, token);
    if (!ck) return false; // B2: someone else is taking it over
    const giveUp = async () => { await kvs.delete(ck).catch(() => {}); return false; };
    try {
      // The claim's winner. L5: the dead row must STILL be the one we claimed against, read right
      // before the delete. Assumption (documented, best effort): a taker does not stall between this
      // read and its delete for longer than a whole new holder's run; holders run ≤ 900 s, the
      // gap here is two KVS calls.
      const again = await read(key);
      if (again === "failed") return giveUp();
      if (again !== "absent" && again.token !== cur.token) return giveUp();
      console.warn(`[LOCK] ${key}: taking over a stale lock from ${cur.at || "unknown"} (token ${cur.token || "?"})`);
      if (again !== "absent") await kvs.delete(key); // L2: a throw here is caught below
      const won = await tryPut(key, token, holdMs);
      await kvs.delete(ck).catch(() => {});
      return won;
    } catch (e) {
      console.warn(`[LOCK] ${key}: takeover aborted (${String(e?.message || e).slice(0, 120)})`);
      return giveUp();
    }
  }

  /** Release `key` only if this caller still holds it (an unreadable row is left alone). */
  async function releaseLock(key, token) {
    const cur = await read(key);
    if (cur !== "failed" && cur !== "absent" && cur.token === token) await kvs.delete(key).catch(() => {});
  }

  /**
   * Run `fn` under `key`, retrying the acquire for up to `waitMs` — by default a little LONGER than
   * the hold (review L3), so a holder that crashed is outlived and its lock taken over instead of
   * the caller giving up "busy". Throws when it cannot get it.
   */
  async function withLock(key, holdMs, fn, { waitMs = holdMs + 5000, stepMs = 500 } = {}) {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const until = Date.now() + waitMs;
    while (!(await acquireLock(key, holdMs, token))) {
      if (Date.now() > until) throw new Error(`lock ${key} is busy`);
      await new Promise((r) => setTimeout(r, stepMs));
    }
    try { return await fn(); } finally { await releaseLock(key, token); }
  }

  return { acquireLock, releaseLock, withLock };
}

const real = makeLocks();
export const acquireLock = real.acquireLock;
export const releaseLock = real.releaseLock;
export const withLock = real.withLock;
