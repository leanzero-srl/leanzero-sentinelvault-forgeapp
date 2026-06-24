import { asApp, asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import { BASELINE_HOLD_SPAN } from "../../shared/baseline.js";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { touchSealTimestamp } from "../sealing/logic.js";
import {
  readDocBody,
  writeDocBody,
  buildSealedSectionNode,
  isSealedSectionKey,
  getSectionId,
  locateBodiedSectionNodes,
  hashAdf,
  resolveSealedSectionKey,
} from "../../infra/doc-surgery.js";
import {
  computeSectionRange,
  refreshSectionContentProp,
} from "./logic.js";
import { sweepSectionEditAccess } from "../editreq/logic.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newSectionId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (_) { /* fall through */ }
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

function textOfHeading(node) {
  let t = "";
  const walk = (n) => {
    if (n?.type === "text") t += n.text || "";
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  };
  walk(node);
  return t.trim();
}

/**
 * Resolve the effective hold period (seconds): explicit override → realm policy →
 * global default → baseline. Mirrors sealArtifact's resolution.
 */
async function resolveHoldPeriod(realmKey, override) {
  if (override && Number.isFinite(override) && override > 0) return override;
  if (realmKey) {
    const sanitized = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmPolicy = await kvs.get(`admin-settings-space-${sanitized}`);
    if (realmPolicy?.autoUnlockTimeoutHours) return realmPolicy.autoUnlockTimeoutHours * 3600;
  }
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.defaultLockDuration) return globalPolicy.defaultLockDuration;
  return BASELINE_HOLD_SPAN;
}

/**
 * List top-level headings for the section picker, plus whether any sealed
 * sections already exist on the page.
 */
const listPageHeadings = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  if (!pageId) return { headings: [], hasSealedSections: false };
  try {
    const { adfDoc } = await readDocBody(pageId);
    const content = adfDoc.content || [];
    const headings = [];
    let sealed = 0;
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (b.type === "heading") {
        headings.push({ index: i, level: b.attrs?.level || 1, text: textOfHeading(b) || "(untitled heading)" });
      } else if (b.type === "bodiedExtension" && isSealedSectionKey(b.attrs?.extensionKey)) {
        sealed++;
      }
    }
    return { headings, hasSealedSections: sealed > 0 };
  } catch (e) {
    console.error("[SECTION] listPageHeadings failed:", e);
    return { headings: [], hasSealedSections: false };
  }
};

/**
 * List sealed sections on a page (for the inline-panel "Sealed Sections" group).
 */
const enumerateSectionSeals = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  const operatorAccountId = req.context.accountId;
  if (!pageId) return { sections: [] };
  try {
    const { results } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("section-protection-"))
      .limit(100)
      .getMany();
    const sections = (results || [])
      .map(({ value }) => value)
      .filter((v) => v?.pageId === pageId && v?.sectionId)
      .map((v) => ({
        sectionId: v.sectionId,
        sectionTitle: v.sectionTitle || "Sealed section",
        lockedByAccountId: v.lockedBy,
        lockedByName: v.lockedByName,
        expiresAt: v.expiresAt || null,
        isMine: v.lockedBy === operatorAccountId,
        isExpired: !!(v.expiresAt && new Date(v.expiresAt) < new Date()),
      }));
    return { sections };
  } catch (e) {
    console.error("[SECTION] enumerate failed:", e);
    return { sections: [] };
  }
};

/**
 * Seal a section: server-side wrap the heading+range in the app's bodied macro,
 * snapshot it, and record the seal. The app's own page write is ignored by the
 * page-content trigger's loop-guard.
 */
const sealSection = async (req) => {
  const { pageId: payloadPageId, headingIndex, headingText, lockDuration } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  const pageId = payloadPageId || req.context.extension?.content?.id;
  const realmKey =
    req.context.extension?.content?.space?.key || req.context.extension?.space?.key;
  let realmId =
    req.context.extension?.content?.space?.id || req.context.extension?.space?.id;

  if (!pageId || headingIndex == null) return { success: false, reason: "Missing pageId/headingIndex" };

  const extensionKey = await resolveSealedSectionKey();
  if (!extensionKey) return { success: false, reason: "Could not resolve section macro key" };

  const holdPeriod = await resolveHoldPeriod(realmKey, lockDuration);
  const expiresAt = new Date(Date.now() + holdPeriod * 1000).toISOString();
  const sectionId = newSectionId();

  let operatorName = "Current User";
  let operatorEmail = null;
  try {
    const r = await asUser().requestConfluence(route`/wiki/rest/api/user/current`);
    if (r.ok) { const d = await r.json(); operatorName = d.displayName || operatorName; operatorEmail = d.email || null; }
  } catch (_) { /* best effort */ }

  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pageData, adfDoc } = await readDocBody(pageId);
    if (!realmId && pageData.spaceId) realmId = pageData.spaceId;
    const content = adfDoc.content || [];
    const block = content[headingIndex];
    if (!block) return { success: false, reason: "Section not found — refresh and try again" };
    if (headingText && block.type === "heading" && textOfHeading(block) !== headingText) {
      return { success: false, reason: "Page changed — refresh and try again" };
    }
    if (block.type === "bodiedExtension" && isSealedSectionKey(block.attrs?.extensionKey)) {
      return { success: false, reason: "This section is already sealed" };
    }

    const { start, end } = computeSectionRange(content, headingIndex);
    const rangeBlocks = content.slice(start, end).map((b) => JSON.parse(JSON.stringify(b)));
    const wrapper = buildSealedSectionNode({ sectionId, extensionKey, bodyContent: rangeBlocks });
    content.splice(start, end - start, wrapper);
    adfDoc.content = content;

    const putRes = await writeDocBody(pageId, pageData, adfDoc, "(Sentinel Vault sealed a section)");
    if (putRes.ok) {
      result = { wrapper, rangeBlocks, version: pageData.version.number + 1, originalIndex: start };
      break;
    }
    if (putRes.status === 409) { await sleep(Math.pow(2, attempt) * 500); continue; }
    console.error(`[SECTION] seal write failed: ${putRes.status}`);
    return { success: false, reason: `Write failed: ${putRes.status}` };
  }
  if (!result) return { success: false, reason: "Could not seal (version conflict) — try again" };

  const contentHash = hashAdf(result.rangeBlocks);
  const sectionTitle = result.rangeBlocks[0]?.type === "heading"
    ? textOfHeading(result.rangeBlocks[0]) : "Sealed section";

  let pageTitle = "Unknown Page";
  try {
    const pr = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (pr.ok) { const pd = await pr.json(); pageTitle = pd.title || pageTitle; if (!realmId && pd.spaceId) realmId = pd.spaceId; }
  } catch (_) { /* best effort */ }

  const record = {
    sectionId, pageId, spaceId: realmId || null, spaceKey: realmKey || null,
    lockedBy: operatorAccountId, lockedByName: operatorName, lockedByEmail: operatorEmail,
    timestamp: new Date().toISOString(), expiresAt, lockDuration: holdPeriod,
    sectionTitle, sealedVersion: result.version, contentHash, originalIndex: result.originalIndex,
  };
  await kvs.set(`section-protection-${sectionId}`, record);
  await kvs.set(`section-snapshot-${sectionId}`, {
    wrapperNode: result.wrapper, bodyContent: result.rangeBlocks,
    hash: contentHash, version: result.version, originalIndex: result.originalIndex,
  });
  if (realmId) {
    await kvs.set(`space-section-protection-${realmId}-${sectionId}`, {
      sectionId, pageId, sectionTitle, lockedBy: operatorAccountId,
      lockedByName: operatorName, expiresAt, pageTitle,
    });
  }
  await refreshSectionContentProp(pageId);
  await touchSealTimestamp();
  return { success: true, sectionId };
};

/**
 * Unseal a section: unwrap the macro (restore body to the page) and clear records.
 * Owner or steward.
 */
const unsealSection = async (req) => {
  const { sectionId } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  const realmKey =
    req.context.extension?.content?.space?.key || req.context.extension?.space?.key;
  if (!sectionId) return { success: false, reason: "Missing sectionId" };

  const record = await kvs.get(`section-protection-${sectionId}`);
  if (!record) return { success: false, reason: "Section is not sealed" };

  let allowed = record.lockedBy === operatorAccountId;
  if (!allowed) {
    try { allowed = await authorizeSteward(operatorAccountId, record.spaceKey || realmKey); }
    catch (_) { /* deny */ }
  }
  if (!allowed) return { success: false, reason: "Only the section owner or a steward can unseal" };

  const pageId = record.pageId;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pageData, adfDoc } = await readDocBody(pageId);
    const content = adfDoc.content || [];
    const idx = content.findIndex(
      (b) => b.type === "bodiedExtension" && isSealedSectionKey(b.attrs?.extensionKey) && getSectionId(b) === sectionId,
    );
    if (idx === -1) break; // wrapper already gone — just clean KVS
    const body = Array.isArray(content[idx].content) ? content[idx].content : [];
    content.splice(idx, 1, ...body);
    adfDoc.content = content;
    const putRes = await writeDocBody(pageId, pageData, adfDoc, "(Sentinel Vault unsealed a section)");
    if (putRes.ok) break;
    if (putRes.status === 409) { await sleep(Math.pow(2, attempt) * 500); continue; }
    break;
  }

  await kvs.delete(`section-protection-${sectionId}`);
  await kvs.delete(`section-snapshot-${sectionId}`);
  if (record.spaceId) {
    try { await kvs.delete(`space-section-protection-${record.spaceId}-${sectionId}`); }
    catch (_) { /* best effort */ }
  }
  await sweepSectionEditAccess(sectionId);
  await refreshSectionContentProp(pageId);
  await touchSealTimestamp();
  return { success: true };
};

/**
 * Owner re-baselines the sealed body after a legitimate edit so the trigger
 * stops reverting to the old snapshot.
 */
const refreshSectionSnapshot = async (req) => {
  const { sectionId } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  if (!sectionId) return { success: false, reason: "Missing sectionId" };

  const record = await kvs.get(`section-protection-${sectionId}`);
  if (!record) return { success: false, reason: "Section is not sealed" };
  if (record.lockedBy !== operatorAccountId) {
    return { success: false, reason: "Only the owner can refresh the snapshot" };
  }

  const { adfDoc } = await readDocBody(record.pageId);
  const wrap = locateBodiedSectionNodes(adfDoc).find((w) => w.sectionId === sectionId);
  if (!wrap) return { success: false, reason: "Sealed section not found on page" };

  const bodyContent = JSON.parse(JSON.stringify(wrap.node.content || []));
  const contentHash = hashAdf(bodyContent);
  await kvs.set(`section-snapshot-${sectionId}`, {
    wrapperNode: JSON.parse(JSON.stringify(wrap.node)), bodyContent,
    hash: contentHash, version: null, originalIndex: wrap.originalIndex,
  });
  await kvs.set(`section-protection-${sectionId}`, { ...record, contentHash });
  await touchSealTimestamp();
  return { success: true };
};

export const actions = [
  ["list-page-headings", listPageHeadings],
  ["enumerate-section-seals", enumerateSectionSeals],
  ["seal-section", sealSection],
  ["unseal-section", unsealSection],
  ["refresh-section-snapshot", refreshSectionSnapshot],
];
