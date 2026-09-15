/*
 * Config API — the queue consumer (manifest `config-api-queue`, docs/REST-CONFIG-API.md).
 *
 * Loads `api-job-<id>`, marks it running, applies the plan site → spaces → content, EACH step
 * through the existing resolver handler (resolvers.js) invoked as the token's minter — so every
 * gate the UI enforces (canEditPage, authorizeSteward, isOperatorSiteAdmin, SV-SEC-1) applies
 * unchanged. A refusal is a per-step result, never an abort. The receipt is written back to
 * the job row and mirrored onto Confluence properties (mirror.js); after a config apply the
 * effective config is mirrored too.
 *
 * Result statuses: applied | refused (the resolver said no, with its reason) | failed (it threw)
 * | skipped (a prerequisite lookup came back empty, e.g. no such heading / space).
 */
import { kvs } from "@forge/kvs";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { invoke } from "./resolvers.js";
import { planBundle, touchedSpaceKeys } from "./bundle.js";
import { interpretResult, mergeValidationConfig, summarize, findHeadingIndex, isStaleRunning, staleFailureReceipt } from "./pure.js";
import { JOB_TTL_MS, CONSUMER_TIMEOUT_MS, jobKvsKey, activeJobKvsKey } from "./admission.js";
import { mirrorReceipt, mirrorSpaceConfig, mirrorSiteConfig, spaceIdByKey } from "./mirror.js";
import { exportSpaceConfig, exportSiteConfig } from "./export.js";
import { canEditPage } from "../../shared/content-access.js";

const nowIso = () => new Date().toISOString();

async function runStep(step, accountId) {
  const { resolverKey, payload, needs } = step;
  try {
    if (needs === "validationMerge") {
      const existing = await invoke("load-validation-config", { scope: payload.scope, key: payload.key }, accountId);
      const data = mergeValidationConfig(existing, payload.data);
      return interpretResult(await invoke(resolverKey, { scope: payload.scope, key: payload.key, data }, accountId));
    }
    if (needs === "workflowPrune") {
      const wf = await invoke("list-space-workflows", { spaceKey: payload.spaceKey }, accountId);
      if (!wf || wf.error) return { status: "refused", reason: wf?.error || "Refused" };
      const keep = new Set(payload.keep || []);
      const removed = []; const refused = [];
      for (const x of wf.extras || []) {
        if (keep.has(x.workflowId)) continue;
        const r = await invoke("delete-space-workflow", { spaceKey: payload.spaceKey, workflowId: x.workflowId }, accountId);
        if (r?.success) removed.push(x.workflowId); else refused.push(`${x.workflowId}: ${r?.reason || "refused"}`);
      }
      if (refused.length) return { status: "refused", reason: `Kept ${refused.join("; ")}`, removed };
      return { status: "applied", removed };
    }
    if (needs === "spaceId") {
      const spaceId = await spaceIdByKey(payload.spaceKey);
      if (!spaceId) return { status: "skipped", reason: `Space ${payload.spaceKey} not found` };
      return interpretResult(await invoke(resolverKey, { spaceId, levelId: payload.levelId }, accountId));
    }
    if (needs === "headingIndex") {
      const h = await invoke("list-page-headings", { pageId: payload.pageId }, accountId);
      const headingIndex = findHeadingIndex(h?.headings, payload.headingText);
      if (headingIndex == null) return { status: "skipped", reason: `No heading "${payload.headingText}" on page ${payload.pageId} (or the page is not readable)` };
      return interpretResult(await invoke(resolverKey, { pageId: payload.pageId, headingIndex, headingText: payload.headingText, lockDuration: payload.lockDuration }, accountId));
    }
    // No context.extension is ever forged from the payload (red-team MEDIUM, 2026-09-15): a
    // context id reads as authentic to every resolver's `mustVerify` shortcut. Every mapped
    // resolver derives the space from the OBJECT it acts on (seal-artifact from the attachment's
    // page, seal-section / workflow from the page, classification from the page id it gates).
    if (resolverKey === "seal-artifact" && step.pageId) {
      // Re-run safety (design doc): an attachment already held by the minter is a no-op success,
      // never a re-seal that resets its expiry. Read through the page's own seal enumeration,
      // which gates a payload page id on canReadPage itself.
      const held = await invoke("enumerate-page-seals", { pageId: String(step.pageId) }, accountId);
      const mine = (held?.claimedArtifacts || []).find((a) => String(a.id) === String(payload.attachmentId));
      if (mine && mine.lockStatus === "HELD_BY_ACTOR" && !mine.isExpired) return { status: "applied", reason: "already sealed by you — no-op" };
    }
    return interpretResult(await invoke(resolverKey, payload, accountId));
  } catch (e) {
    console.error(`[CONFIG-API] step ${step.path} (${resolverKey}) threw:`, e);
    return { status: "failed", reason: String(e?.message || e).slice(0, 300) };
  }
}

export async function runJob(jobId) {
  const key = jobKvsKey(jobId);
  const job = await kvs.get(key);
  if (!job) { console.warn(`[CONFIG-API] job ${jobId} not found`); return { ok: false }; }
  if (isStaleRunning(job, Date.now(), CONSUMER_TIMEOUT_MS)) {
    // Wedged `running` (the consumer that held it was cut off): settle it as failed so the key
    // and the token's slot are free again, and say so in the receipt.
    const failed = staleFailureReceipt(job, nowIso());
    await setWithTtl(key, failed, JOB_TTL_MS);
    await kvs.delete(activeJobKvsKey(job.tokenId)).catch(() => {});
    try { await mirrorReceipt(failed, { spaceKeys: failed.touchedSpaces || [], receiptPageId: null }); } catch (_) { /* best-effort */ }
    console.warn(`[CONFIG-API] job ${jobId} was stale running; marked failed`);
    return { ok: false, status: "failed" };
  }
  if (job.status !== "queued") { console.warn(`[CONFIG-API] job ${jobId} is ${job.status}; not re-running`); return { ok: false }; }
  const startedAt = nowIso();
  await setWithTtl(key, { ...job, status: "running", startedAt }, JOB_TTL_MS);

  const accountId = job.submittedBy;
  const receipt = { id: job.id, op: job.op, status: "running", submittedBy: accountId, tokenId: job.tokenId || null, tokenName: job.tokenName || null, role: job.role, submittedAt: job.submittedAt, startedAt, finishedAt: null, summary: { applied: 0, refused: 0, failed: 0, skipped: 0 }, results: [] };
  let spaceKeys = [];
  let receiptPageId = job.bundle?.site?.receiptPageId ? String(job.bundle.site.receiptPageId) : null;
  // The receipt page is payload-named and everything mirrored onto it is written asApp: the
  // minter must be able to edit it themselves, or nothing lands there (red-team MEDIUM).
  if (receiptPageId && !(await canEditPage(accountId, receiptPageId))) {
    receipt.results.push({ path: "site.receiptPageId", status: "skipped", reason: `Page ${receiptPageId} is not editable by the submitter; no site mirror written` });
    receiptPageId = null;
  }
  // Remember the receipt page so UI config writes can keep the site mirror current too.
  if (receiptPageId) {
    try { const g = (await kvs.get("admin-settings-global")) || {}; if (g.apiReceiptPageId !== receiptPageId) await kvs.set("admin-settings-global", { ...g, apiReceiptPageId: receiptPageId }); }
    catch (e) { console.warn("[CONFIG-API] could not remember receiptPageId:", e?.message || e); }
  }
  try {
    if (job.op === "whoami") {
      receipt.status = "done";
      receipt.identity = { accountId, role: job.role, tokenId: job.tokenId || null, tokenName: job.tokenName || null };
    } else {
      const plan = planBundle(job.bundle);
      spaceKeys = touchedSpaceKeys(plan);
      receipt.plan = plan.map(({ path, resolverKey, payload }) => ({ path, resolverKey, payload }));
      if (job.op === "dry-run") {
        receipt.status = "done";
        receipt.results = [...receipt.results, ...plan.map(({ path }) => ({ path, status: "skipped", reason: "dry-run" }))];
        receipt.summary = { applied: 0, refused: 0, failed: 0, skipped: receipt.results.length };
      } else {
        for (const step of plan) {
          const r = await runStep(step, accountId);
          receipt.results.push({ path: step.path, status: r.status, ...(r.reason ? { reason: r.reason } : {}), ...(r.removed ? { removed: r.removed } : {}) });
        }
        const s = summarize(receipt.results);
        receipt.summary = s.summary; receipt.status = s.status;
        // Effective-config mirror for every scope the bundle configured.
        const configured = new Set(receipt.results.filter((r) => r.status === "applied").map((r) => r.path));
        const siteTouched = [...configured].some((p) => p.startsWith("site."));
        const spacesTouched = spaceKeys.filter((k) => [...configured].some((p) => p.startsWith(`spaces.${k}.`)));
        receipt.configMirror = { site: null, spaces: {} };
        for (const k of spacesTouched) {
          try { receipt.configMirror.spaces[k] = await mirrorSpaceConfig(k, await exportSpaceConfig(k, accountId)); }
          catch (e) { console.warn(`[CONFIG-API] config mirror for ${k} failed:`, e?.message || e); receipt.configMirror.spaces[k] = false; }
        }
        if (siteTouched && receiptPageId) {
          try { receipt.configMirror.site = await mirrorSiteConfig(receiptPageId, await exportSiteConfig(accountId)); }
          catch (e) { console.warn("[CONFIG-API] site config mirror failed:", e?.message || e); receipt.configMirror.site = false; }
        }
      }
    }
  } catch (e) {
    console.error(`[CONFIG-API] job ${jobId} crashed:`, e);
    receipt.status = "failed";
    receipt.error = String(e?.message || e).slice(0, 300);
  }
  receipt.finishedAt = nowIso();
  receipt.touchedSpaces = spaceKeys;
  await setWithTtl(key, receipt, JOB_TTL_MS);
  await kvs.delete(activeJobKvsKey(job.tokenId)).catch(() => {});
  try {
    receipt.receiptMirror = await mirrorReceipt(
      { id: receipt.id, op: receipt.op, status: receipt.status, submittedBy: receipt.submittedBy, role: receipt.role, submittedAt: receipt.submittedAt, finishedAt: receipt.finishedAt, summary: receipt.summary, results: receipt.results },
      { spaceKeys, receiptPageId },
    );
    await setWithTtl(key, receipt, JOB_TTL_MS);
  } catch (e) { console.warn("[CONFIG-API] receipt mirror failed:", e?.message || e); }
  console.log(`[CONFIG-API] job ${jobId} ${receipt.status} applied=${receipt.summary.applied} refused=${receipt.summary.refused} failed=${receipt.summary.failed} skipped=${receipt.summary.skipped}`);
  return { ok: true, status: receipt.status };
}

export async function configApiConsumer(event) {
  const jobId = event?.body?.jobId || event?.payload?.jobId;
  if (!jobId) { console.warn("[CONFIG-API] consumer: no jobId in event"); return; }
  await runJob(String(jobId));
}
