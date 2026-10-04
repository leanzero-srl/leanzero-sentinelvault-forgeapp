/*
 * Privacy sweep — the weekly job (queue `privacy-queue`, 900 s).
 *
 *   1. retention    delete activity history, workflow history and read confirmations older than
 *                   the site's `historyRetentionDays` (retention.js)
 *
 * Scheduling: Forge allows 5 scheduled triggers and this app uses all 5, so the weekly run rides
 * the DAILY recurring-nudge trigger (boot.js → privacySweepCheck): once a day it queues a sweep
 * when the last one is older than six and a half days. A site admin can run it at once (Site
 * settings → Privacy and retention, resolver `privacy-run-now`) and over REST (config-api op
 * `privacy-sweep`). Like the backup, it runs only in the Confluence installation: the app is
 * also installed in Jira for the JSM Assets scopes, and that store holds nothing of this.
 */
import { kvs, MetadataField } from "@forge/kvs";
import { Queue } from "@forge/events";
import { readEffective } from "../policies/settings-schema.js";
import { isPastRetention, retainedFamily } from "./retention.js";
import { scheduleBackup } from "../backup/hook.js";

export const PRIVACY_QUEUE_KEY = "privacy-queue";
export const STATUS_KEY = "privacy-status";
const LOCK_KEY = "privacy-lock";
const LOCK_MS = 16 * 60000; // > the 900 s consumer timeout: a killed run frees it on its own
export const SWEEP_EVERY_MS = 6.5 * 86400000;
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);

/** PURE. Does this invocation belong to the Confluence installation? Unknown context → yes. */
export const isConfluenceInstall = (context) => {
  const ic = String(context?.installContext || "");
  return !ic || ic.includes(":confluence::");
};

/** PURE. Is a scheduled sweep due, given the status row? */
export function sweepDue(status, nowMs = Date.now()) {
  const last = Date.parse(status?.lastRunAt || status?.queuedAt || "");
  return !Number.isFinite(last) || nowMs - last >= SWEEP_EVERY_MS;
}

/** Daily check (boot.js, after the recurring-nudge task). Never throws. */
export async function privacySweepCheck(context) {
  try {
    if (!isConfluenceInstall(context)) return;
    const status = (await kvs.get(STATUS_KEY)) || {};
    if (!sweepDue(status)) return;
    await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
    await new Queue({ key: PRIVACY_QUEUE_KEY }).push({ body: { kind: "sweep", reason: "schedule" } });
  } catch (e) {
    console.error("[PRIVACY] daily check failed:", e);
  }
}

/** Queue a sweep now (the admin button). */
export async function queuePrivacySweep(reason = "manual") {
  const status = (await kvs.get(STATUS_KEY)) || {};
  await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
  await new Queue({ key: PRIVACY_QUEUE_KEY }).push({ body: { kind: "sweep", reason } });
}

export async function privacyConsumer(event) {
  const body = event?.body || event?.payload || {};
  if (body.kind !== "sweep") { console.warn("[PRIVACY] consumer: unknown event", JSON.stringify(body).slice(0, 200)); return; }
  await runPrivacySweep({ reason: body.reason || "schedule" });
}

/** Stream every KVS row with its expiry: `onRow({ key, value, expireTime })`. */
async function scanKvs(onRow, { maxPages = 5000 } = {}) {
  let q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100);
  for (let i = 0; i < maxPages; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const r of results || []) await onRow(r);
    if (!nextCursor) return;
    q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100).cursor(nextCursor);
  }
  throw new Error(`KVS scan stopped at ${maxPages} pages`);
}

/**
 * One sweep. One at a time (an atomic FAIL_IF_EXISTS lock); a second caller gets
 * { ok: false, reason: "running" }. Returns the summary it also stores in `privacy-status`.
 */
export async function runPrivacySweep({ reason = "manual", nowMs = Date.now() } = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await kvs.set(LOCK_KEY, { token, at: nowIso() }, { ttl: { value: Math.ceil(LOCK_MS / 1000), unit: "SECONDS" }, keyPolicy: "FAIL_IF_EXISTS" });
  } catch (_) {
    return { ok: false, reason: "running" };
  }
  const startedAt = nowIso();
  const summary = { ok: true, reason, startedAt, finishedAt: null, retentionDays: null, retention: { activity: 0, workflowLog: 0, readAck: 0 }, scanned: 0, error: null };
  try {
    const settings = await kvs.get("admin-settings-global").catch(() => null);
    const days = readEffective("historyRetentionDays", settings?.historyRetentionDays);
    summary.retentionDays = days;

    await scanKvs(async ({ key, value }) => {
      summary.scanned += 1;
      if (isPastRetention(key, value, nowMs, days)) {
        await kvs.delete(key);
        summary.retention[retainedFamily(key)] += 1;
      }
    });
  } catch (e) {
    summary.ok = false;
    summary.error = errText(e);
    console.error("[PRIVACY] sweep failed:", e);
  } finally {
    summary.finishedAt = nowIso();
    // The backup holds this history too: a sweep that deleted anything schedules one (debounced).
    const deleted = Object.values(summary.retention).reduce((n, x) => n + x, 0);
    if (deleted > 0) await scheduleBackup("privacy").catch(() => {});
    const prev = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
    // A failed run does not advance lastRunAt, so tomorrow's daily check tries again.
    await kvs.set(STATUS_KEY, { ...prev, lastRunAt: summary.ok ? summary.finishedAt : prev.lastRunAt || null, lastAttemptAt: summary.finishedAt, queuedAt: null, last: summary }).catch(() => {});
    const cur = await kvs.get(LOCK_KEY).catch(() => null);
    if (cur?.token === token) await kvs.delete(LOCK_KEY).catch(() => {});
  }
  console.log(`[PRIVACY] sweep reason=${reason} scanned=${summary.scanned} retention=${JSON.stringify(summary.retention)} ok=${summary.ok}`);
  return summary;
}
