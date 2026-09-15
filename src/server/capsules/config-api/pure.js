/*
 * Config API — the PURE consumer/mirror helpers, kept @forge-free so test/config-api.test.mjs
 * can import them in plain node. consumer.js and mirror.js are their only production callers.
 */
import { readSet } from "./bundle.js";

export const RECEIPTS_KEPT = 20;

/** PURE. Interpret a resolver's answer: { success|ok: true } applies; anything else refuses. */
export function interpretResult(r) {
  if (r && (r.success === true || r.ok === true)) return { status: "applied" };
  if (r && Array.isArray(r.results) && r.results.length && r.results.every((x) => x?.ok === true)) return { status: "applied" };
  const first = r && Array.isArray(r.results) ? r.results.find((x) => x && x.ok !== true) : null;
  const reason = r?.reason || r?.error || first?.reason || (r && typeof r === "object" && !("success" in r) && !("ok" in r) ? null : "Refused");
  return { status: "refused", reason: reason || "Refused" };
}

/** PURE. Upsert semantics for a validation config: shallow overlay; rules merged by id unless $replace. */
export function mergeValidationConfig(existing, data) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const out = { ...base };
  for (const [k, v] of Object.entries(data || {})) {
    if (k === "rules") continue;
    if (k === "modes" && v && typeof v === "object" && base.modes && typeof base.modes === "object") out.modes = { ...base.modes, ...v };
    else out[k] = v;
  }
  const set = data && data.rules !== undefined ? readSet(data.rules) : null;
  if (set) {
    if (set.replace) out.rules = set.items;
    else {
      const byId = new Map((Array.isArray(base.rules) ? base.rules : []).map((r) => [r?.id, r]));
      for (const r of set.items) byId.set(r?.id, r);
      out.rules = [...byId.values()];
    }
  }
  return out;
}

/** PURE. Summary + terminal status from the results. */
export function summarize(results) {
  const summary = { applied: 0, refused: 0, failed: 0, skipped: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  const bad = summary.refused + summary.failed + summary.skipped;
  const status = bad === 0 ? "done" : summary.applied > 0 ? "partial" : "failed";
  return { summary, status };
}

/** PURE. Pick the heading index for a heading text (exact first, then case-insensitive). */
export function findHeadingIndex(headings, text) {
  const list = Array.isArray(headings) ? headings : [];
  const exact = list.find((h) => h.text === text);
  if (exact) return exact.index;
  const lower = String(text).trim().toLowerCase();
  const loose = list.find((h) => String(h.text).trim().toLowerCase() === lower);
  return loose ? loose.index : null;
}

/** PURE. Prepend a receipt to a list, newest first, capped, de-duplicated by id. */
export function pushReceipt(existing, receipt, keep = RECEIPTS_KEPT) {
  const list = Array.isArray(existing?.receipts) ? existing.receipts : [];
  const rest = list.filter((r) => r && r.id !== receipt.id);
  return { receipts: [receipt, ...rest].slice(0, keep), updatedAt: new Date().toISOString() };
}


/**
 * PURE. What the `sentinel-vault-config` MIRROR may carry (red-team HIGH, 2026-09-15).
 *
 * A space property is readable by any VIEWER of the space and the site mirror by any reader of
 * the receipt page, while the app's own resolvers redact the steward roster, the approver
 * rosters / entry conditions and the AI prompts from non-stewards. So the mirror carries only
 * what the UI already shows every user: policy durations and toggles (minus the roster),
 * `validation` reduced to `{ enabled, modes }` (rule TEXT and `ai` stay private), workflows as
 * `{ workflowId, name, labels, priority }` (no definitions), the classification default and
 * the site classification levels. The full export stays behind the gated `export-space-config`
 * / `export-site-config` resolvers.
 */
export function redactConfigForMirror(config, scope = "space") {
  if (!config || typeof config !== "object") return config;
  const out = {};
  for (const k of ["version", "spaceKey", "exportedAt"]) if (config[k] !== undefined) out[k] = config[k];
  if (config.policy && typeof config.policy === "object") {
    const { adminUsers, adminGroups, ...policy } = config.policy;
    void adminUsers; void adminGroups;
    out.policy = policy;
  } else out.policy = config.policy ?? null;
  const v = config.validation;
  out.validation = v && typeof v === "object"
    ? { enabled: v.enabled ?? null, modes: v.modes && typeof v.modes === "object" ? { ...v.modes } : null }
    : null;
  if (scope === "site") {
    out.classification = config.classification ?? null;
  } else {
    out.workflows = (Array.isArray(config.workflows) ? config.workflows : []).map((w) => ({
      workflowId: w?.workflowId ?? null,
      name: w?.name ?? w?.def?.name ?? null,
      labels: Array.isArray(w?.labels) ? w.labels.slice() : [],
      priority: w?.priority ?? null,
    }));
    out.classificationDefault = config.classificationDefault ?? null;
  }
  return out;
}

/**
 * PURE. A job wedged in `running` (consumer crashed / timed out) must not hold its key or the
 * token's one-job slot forever: past the consumer timeout it is reclaimable.
 */
export function isStaleRunning(job, nowMs, timeoutMs) {
  if (!job || job.status !== "running") return false;
  const started = Date.parse(job.startedAt || "");
  if (!Number.isFinite(started)) return true; // running with no start time: nothing can finish it
  return nowMs - started > timeoutMs;
}

export const STALE_RUNNING_REASON = "consumer timed out; resubmit with a new Idempotency-Key";

/** PURE. The receipt a stale running row becomes. */
export function staleFailureReceipt(job, nowIso) {
  const { bundle, ...rest } = job || {};
  void bundle;
  return {
    ...rest,
    status: "failed",
    reason: STALE_RUNNING_REASON,
    error: STALE_RUNNING_REASON,
    finishedAt: nowIso,
    summary: { applied: 0, refused: 0, failed: 0, skipped: 0 },
    results: Array.isArray(rest.results) ? rest.results : [],
  };
}
