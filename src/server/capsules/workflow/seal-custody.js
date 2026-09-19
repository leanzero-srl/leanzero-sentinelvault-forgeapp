/**
 * SEC-2 — the workflow takes custody of every seal on a page when the page ENTERS an enforced
 * state, and hands them back when it LEAVES one. The rule (what a held seal is, who may act on it,
 * the remaining-time arithmetic) lives in shared/seal-authority.js; this file is the I/O: the
 * page's section and attachment seal records, their space-index rows, the section content
 * property the macro badge reads, and the activity trail.
 *
 * Called from workflow/logic.js transitionPageWorkflow through a DYNAMIC import (this module
 * reads page-details/logic.js → sealing/logic.js, which reach back into the workflow capsule).
 * Best effort by design: a seal that cannot be re-written is logged, never a failed transition —
 * the state record is the source of truth and the trigger re-derives privilege from it anyway.
 */
import { kvs } from "@forge/kvs";
import { collectPageSeals, readPageMeta } from "../page-details/logic.js";
import { refreshSectionContentProp } from "../section-seals/logic.js";
import { recordActivity } from "../../infra/activity-log.js";
import { holdSeal, handBackSeal, isWorkflowHeld } from "../../shared/seal-authority.js";

async function pageSeals(pageId) {
  const meta = await readPageMeta(pageId).catch(() => null);
  const { attachments, sections } = await collectPageSeals(pageId, meta?.type || "page");
  return {
    attachments: (attachments || []).filter((a) => a?.record?.lockedBy && !a.record.trashedOnly).map((a) => ({ key: `protection-${a.id}`, record: a.record, indexKey: a.record.spaceId ? `space-protection-${a.record.spaceId}-${a.id}` : null, id: a.id, name: a.record.attachmentName || null, kind: "attachment" })),
    sections: (sections || []).filter((s) => s?.lockedBy).map((s) => ({ key: `section-protection-${s.sectionId}`, record: s, indexKey: s.spaceId ? `space-section-protection-${s.spaceId}-${s.sectionId}` : null, id: s.sectionId, name: s.sectionTitle || null, kind: "section" })),
  };
}

async function writeSeal(item, next) {
  await kvs.set(item.key, next);
  if (item.indexKey) {
    try { const row = await kvs.get(item.indexKey); if (row) await kvs.set(item.indexKey, { ...row, expiresAt: next.expiresAt ?? null, workflowHeld: next.workflowHeld || null }); }
    catch (e) { console.warn(`[SEAL-CUSTODY] index row ${item.indexKey}:`, e?.message || e); }
  }
}

/** Entering an enforced state: every live seal on the page becomes the workflow's. */
export async function holdPageSeals({ pageId, record, stateName, actorAccountId, actorName }) {
  const now = Date.now();
  const { attachments, sections } = await pageSeals(pageId);
  const held = [];
  for (const item of [...sections, ...attachments]) {
    if (isWorkflowHeld(item.record)) continue;
    try {
      await writeSeal(item, holdSeal(item.record, { record: { ...record, pageId }, stateName, now }));
      held.push({ kind: item.kind, id: item.id, name: item.name });
    } catch (e) { console.warn(`[SEAL-CUSTODY] hold ${item.key} failed:`, e?.message || e); }
  }
  if (sections.length) await refreshSectionContentProp(pageId).catch(() => {});
  if (held.length) {
    await recordActivity({
      type: "workflow.seals-held", pageId, spaceKey: record?.spaceKey || null,
      actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
      target: { kind: "page", id: pageId, name: null },
      details: { stateId: record?.stateId || null, stateName: stateName || null, sections: held.filter((h) => h.kind === "section").length, attachments: held.filter((h) => h.kind === "attachment").length, names: held.slice(0, 10).map((h) => h.name).filter(Boolean) },
      version: record?.approvedVersion ?? null,
    }).catch(() => {});
  }
  return { held: held.length };
}

/** Leaving an enforced state: every held seal goes back to its owner with the time it had left. */
export async function handBackPageSeals({ pageId, record, actorAccountId, actorName, toStateName }) {
  const now = Date.now();
  const { attachments, sections } = await pageSeals(pageId);
  const back = [];
  for (const item of [...sections, ...attachments]) {
    if (!isWorkflowHeld(item.record)) continue;
    try {
      await writeSeal(item, handBackSeal(item.record, { now }));
      back.push({ kind: item.kind, id: item.id, name: item.name });
    } catch (e) { console.warn(`[SEAL-CUSTODY] hand back ${item.key} failed:`, e?.message || e); }
  }
  if (sections.length) await refreshSectionContentProp(pageId).catch(() => {});
  if (back.length) {
    await recordActivity({
      type: "workflow.seals-released", pageId, spaceKey: record?.spaceKey || null,
      actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
      target: { kind: "page", id: pageId, name: null },
      details: { toStateId: record?.stateId || null, toStateName: toStateName || null, sections: back.filter((h) => h.kind === "section").length, attachments: back.filter((h) => h.kind === "attachment").length, names: back.slice(0, 10).map((h) => h.name).filter(Boolean) },
      version: null,
    }).catch(() => {});
  }
  return { handedBack: back.length };
}

/** What an approval would freeze — for the approval dialog's sentence (SEC-2 d). */
export async function describeSealsToFreeze(pageId) {
  const { attachments, sections } = await pageSeals(pageId);
  return {
    sections: sections.map((s) => ({ id: s.id, name: s.name, owner: s.record.lockedByName || null })),
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, owner: a.record.lockedByName || null })),
  };
}
