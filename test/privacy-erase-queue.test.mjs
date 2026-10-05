// The backup's part of a privacy erasure is never LOST (review blocking, 2026-10-05; repro
// sv-break3/pending/pending.mjs was RED on a32e6fd: a failed queue push or a busy pending lock left
// the ids nowhere — index x stamped, nothing pending, nothing re-queued). Each failure below must end
// with the ids pending, or re-queued by the next sweep.
import { eq, ok, report } from "./_assert.mjs";
import { makeQueueBackupErasure, ERASE_PENDING_KEY, ERASE_PENDING_LOCK } from "../src/server/capsules/privacy/erase-queue.js";
import { settleBackupHandOff, jobAlive, JOB_STALE_MS } from "../src/server/capsules/privacy/accounts.js";
import { makeLocks } from "../src/server/shared/kvs-lock.js";

const X = "712020:11111111-2222-3333-4444-555555555555";
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const quiet = console.warn; console.warn = () => {};

function world() {
  const store = new Map();
  const ctl = { failGetKey: null, failPush: false };
  const kvs = {
    async get(k) { if (ctl.failGetKey === k) { const e = new Error("429"); e.status = 429; throw e; } return store.get(k); },
    async set(k, v, o) { if (o?.keyPolicy === "FAIL_IF_EXISTS" && store.has(k)) throw new Error("KEY_EXISTS"); store.set(k, structuredClone(v)); },
    async delete(k) { store.delete(k); },
  };
  const L = makeLocks(kvs);
  const withLock = (k, h, fn) => L.withLock(k, h, fn, { waitMs: 150, stepMs: 20 });
  const jobs = new Map();
  const readJob = async (id) => jobs.get(id) || null;
  const startJob = async (kind) => {
    if (ctl.failPush) throw new Error("queue push 503");
    const j = { id: `j${jobs.size}`, kind, status: "queued", createdAt: iso() };
    jobs.set(j.id, j);
    return j;
  };
  const queue = makeQueueBackupErasure({ kvs, withLock, readJob, startJob, jobAlive });
  return { store, ctl, jobs, queue };
}

/** The sweep's tail, in worker.js order: erase → stamp x → hand over → settle on failure → pending restart. */
async function sweepTail(w, index, newlyClosed) {
  const unfinished = Object.entries(index).filter(([, e]) => e?.c && !e.x).map(([id]) => id);
  const forBackup = [...new Set([...newlyClosed, ...unfinished])];
  let backup = null;
  if (forBackup.length) {
    for (const id of forBackup) index[id] = { ...index[id], x: iso() };
    backup = await w.queue(forBackup).catch((e) => ({ error: String(e.message) }));
    index = settleBackupHandOff(index, forBackup, backup);
  }
  if (!backup) { const p = w.store.get(ERASE_PENDING_KEY); if (p?.ids?.length) backup = await w.queue([]).catch((e) => ({ error: String(e.message) })); }
  return { index, backup };
}
const closedIndex = () => ({ [X]: { u: iso(), r: iso(), c: iso(), x: null } });
const queuedFor = (w) => [...w.jobs.values()].filter((j) => j.status === "queued").length;

for (const mode of ["push-fails", "lock-busy", "get-fails"]) {
  const w = world();
  if (mode === "push-fails") w.ctl.failPush = true;
  if (mode === "lock-busy") w.store.set(ERASE_PENDING_LOCK, { token: "CRASHED", at: iso() });
  if (mode === "get-fails") w.ctl.failGetKey = ERASE_PENDING_KEY;
  const s1 = await sweepTail(w, closedIndex(), [X]);
  ok(`${mode}: sweep 1 reports the hand-off failed`, !!s1.backup?.error, s1.backup);
  const pendingIds = w.store.get(ERASE_PENDING_KEY)?.ids || [];
  ok(`${mode}: after sweep 1 the id is pending OR marked not-erased (nothing lost)`, pendingIds.includes(X) || s1.index[X].x === null, { pendingIds, x: s1.index[X].x });
  eq(`${mode}: the index no longer claims the erasure finished`, s1.index[X].x, null);
  // the next sweep, healthy
  w.ctl.failPush = false; w.ctl.failGetKey = null; w.store.delete(ERASE_PENDING_LOCK);
  const s2 = await sweepTail(w, s1.index, []);
  ok(`${mode}: sweep 2 queues the backup erasure`, !!s2.backup?.jobId && queuedFor(w) === 1, s2.backup);
  ok(`${mode}: … with the id pending for the job`, (w.store.get(ERASE_PENDING_KEY)?.ids || []).includes(X));
  eq(`${mode}: … and the erasure is now stamped done`, !!s2.index[X].x, true);
}
{ // push-fails specifically: the ids were written BEFORE the job was started
  const w = world(); w.ctl.failPush = true;
  await w.queue([X]).catch(() => {});
  eq("push fails: the id is already pending (written first)", w.store.get(ERASE_PENDING_KEY)?.ids, [X]);
}
{ // healthy path and reuse
  const w = world();
  const a = await w.queue([X]);
  const b = await w.queue(["712020:22222222-2222-3333-4444-555555555555"]);
  eq("healthy: one job, reused for a second id", [a.reused, b.reused, b.jobId === a.jobId, w.jobs.size], [false, true, true, 1]);
  eq("healthy: both ids pending", w.store.get(ERASE_PENDING_KEY).ids.length, 2);
  ok("healthy: the pending lock is released", !w.store.has(ERASE_PENDING_LOCK));
}
{ // L1: a re-queued job whose push failed stays "queued"; after JOB_STALE_MS a new one is started
  const w = world();
  const a = await w.queue([X]);
  w.jobs.get(a.jobId).queuedAt = iso(Date.now() - JOB_STALE_MS - 60000);
  const b = await w.queue([]);
  eq("L1: a stale 'queued' job is not reused forever", [b.reused, b.jobId !== a.jobId], [false, true]);
  const now = Date.now();
  eq("L1: a fresh re-queue (5 min delay) is alive", jobAlive({ status: "queued", queuedAt: iso(now - 6 * 60000) }, now), true);
  eq("L1: queued with no queuedAt falls back to createdAt", jobAlive({ status: "queued", createdAt: iso(now - 40 * 60000) }, now), false);
}
eq("settle: a successful hand-off keeps x", settleBackupHandOff({ [X]: { x: "t" } }, [X], { jobId: "j" })[X].x, "t");

console.warn = quiet;
report("privacy-erase-queue");
