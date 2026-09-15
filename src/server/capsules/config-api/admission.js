/*
 * Config API admission — PURE decisions for the static web trigger (trigger.js).
 *
 * The trigger can only answer with one of the manifest's fixed outputs, so every decision
 * below is an output key. Idempotency (docs/REST-CONFIG-API.md "The request"): the caller's
 * Idempotency-Key IS the job id — PER TOKEN (red-team MEDIUM, 2026-09-15: a site-wide key let
 * one token's job answer another's) — so the row is `api-job-<tokenId>:<key>`. The same key
 * while the job runs is `conflict`, once it is settled it is `accepted` with nothing written
 * (the receipt is already there). One job at a time per token: `busy`, judged from the
 * `api-active-<tokenId>` marker (its own prefix so a job listing never sees it).
 */
import { isStaleRunning } from "./pure.js";

export const OUTPUT = Object.freeze({
  accepted: "accepted",
  invalid: "invalid",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  conflict: "conflict",
  busy: "busy",
  notAllowed: "not-allowed",
});

export const OPS = Object.freeze(["bundle", "dry-run", "whoami"]);
export const ACTIVE_STATUSES = Object.freeze(["queued", "running"]);
export const JOB_TTL_MS = 7 * 86400000;
/** A `running` row older than this is reclaimable (Forge async-event consumers are cut off at 300 s). */
export const CONSUMER_TIMEOUT_MS = 300000;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

export const JOB_PREFIX = "api-job-";
export const ACTIVE_PREFIX = "api-active-";
/** The job id the queue and the hook carry: `<tokenId>:<key>`. */
export const jobId = (tokenId, key) => `${tokenId}:${key}`;
export const jobKvsKey = (id) => `${JOB_PREFIX}${id}`;
export const activeJobKvsKey = (tokenId) => `${ACTIVE_PREFIX}${tokenId}`;

/** PURE. Is the caller's Idempotency-Key usable as a job id? */
export const validIdempotencyKey = (key) => typeof key === "string" && KEY_RE.test(key);

/** PURE. Is this row still occupying its key / the token's slot? A stale `running` is not. */
export const isActiveJob = (job, nowMs = Date.now()) =>
  !!job && ACTIVE_STATUSES.includes(job.status) && !isStaleRunning(job, nowMs, CONSUMER_TIMEOUT_MS);

/**
 * PURE. { existingJob, runningForToken, key, nowMs } → { outputKey, noop, stale }
 *   existingJob      the `api-job-<tokenId>:<key>` row, or null
 *   runningForToken  true when another job by the same token is still queued/running
 *   stale            true when existingJob is a wedged `running` row (settled: the trigger
 *                    writes the failure receipt; the caller resubmits with a new key)
 */
export function decideAdmission({ existingJob, runningForToken, key, nowMs = Date.now() }) {
  if (!validIdempotencyKey(key)) return { outputKey: OUTPUT.invalid, noop: false, stale: false };
  if (existingJob) {
    const stale = isStaleRunning(existingJob, nowMs, CONSUMER_TIMEOUT_MS);
    if (!stale && ACTIVE_STATUSES.includes(existingJob.status)) return { outputKey: OUTPUT.conflict, noop: false, stale: false };
    return { outputKey: OUTPUT.accepted, noop: true, stale };
  }
  if (runningForToken) return { outputKey: OUTPUT.busy, noop: false, stale: false };
  return { outputKey: OUTPUT.accepted, noop: false, stale: false };
}

/** PURE. Role floor of an op + bundle. whoami is open to any live token. */
export function opRoleFloor(op, bundleFloor) {
  if (op === "whoami") return "viewer";
  return bundleFloor; // bundle / dry-run: what the bundle contains decides
}
