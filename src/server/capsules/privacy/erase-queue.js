/*
 * Hand the backup's part of a privacy erasure to the backup worker (job kind `privacy-erase`).
 * No @forge imports: the KVS, the lock and the job functions are passed in, so
 * test/privacy-erase-queue.test.mjs drives it with fakes (push fails, lock busy, read fails).
 *
 * The ids wait in `privacy-erase-pending` (a privacy- row: never scanned for people, never backed
 * up as config). Order matters (review blocking, 2026-10-05): the merged ids are written to the
 * pending row FIRST, inside the pending lock, and only then is a job started. A job that cannot be
 * started leaves the ids pending; a lock or a read that fails throws BEFORE anything is lost, and
 * the caller (settleBackupHandOff) then marks the ids not-erased so the next sweep retries.
 */
export const ERASE_PENDING_KEY = "privacy-erase-pending";
export const ERASE_PENDING_LOCK = "privacy-erase-pending-lock";

export function makeQueueBackupErasure({ kvs, withLock, readJob, startJob, jobAlive, now = () => Date.now() }) {
  const iso = () => new Date(now()).toISOString();
  return async function queueBackupErasure(ids) {
    return withLock(ERASE_PENDING_LOCK, 60000, async () => {
      const cur = (await kvs.get(ERASE_PENDING_KEY)) || {};
      const merged = [...new Set([...(cur.ids || []), ...ids])];
      if (!merged.length) return null;
      await kvs.set(ERASE_PENDING_KEY, { ...cur, ids: merged, at: iso() });
      const job = cur.jobId ? await readJob(cur.jobId).catch(() => null) : null;
      if (jobAlive(job, now())) return { jobId: job.id, reused: true };
      const next = await startJob("privacy-erase", {}, null);
      await kvs.set(ERASE_PENDING_KEY, { ids: merged, at: iso(), jobId: next.id });
      return { jobId: next.id, reused: false };
    });
  };
}
