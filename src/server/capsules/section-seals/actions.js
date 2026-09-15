import { asApp, asUser, route } from "@forge/api";
import { currentUserProfile } from "../../shared/user-or-app.js";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey } from "../../shared/content-access.js";
import { touchSealTimestamp, resolveSealHoldPeriod } from "../sealing/logic.js";
import { listSectionSealRecordsForPage } from "./logic.js";
import { restampIfEnforced } from "../workflow/logic.js";
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
import { sweepSectionEditAccess, getActiveSectionEditGrant } from "../editreq/logic.js";
import { recordActivity } from "../../infra/activity-log.js";
import { validateReleaseReason } from "../../shared/release-reason.js";
import { refreshByline } from "../page-details/byline.js"; // 5.0 byline chip

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
 * List top-level headings for the section picker, plus whether any sealed
 * sections already exist on the page.
 */
export const listPageHeadings = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  if (!pageId) return { headings: [], hasSealedSections: false };
  // SV-SEC-1 (disclosure side): readDocBody runs as asApp(), so a payload-named page id
  // would hand back the heading outline of ANY page on the site. A context id costs no
  // call — rendering the module there already required read access.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
    return { headings: [], hasSealedSections: false };
  }
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
export const enumerateSectionSeals = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  const operatorAccountId = req.context.accountId;
  if (!pageId) return { sections: [] };
  // SV-SEC-1 (disclosure side): the records carry section titles plus who holds each seal,
  // so a payload-named page id would enumerate that for any page on the site.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(operatorAccountId, pageId))) {
    return { sections: [] };
  }
  try {
    const sections = (await listSectionSealRecordsForPage(pageId))
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
export const sealSection = async (req) => {
  const { pageId: payloadPageId, headingIndex, headingText, lockDuration } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  const pageId = payloadPageId || req.context.extension?.content?.id;
  let realmId =
    req.context.extension?.content?.space?.id || req.context.extension?.space?.id;

  if (!pageId || headingIndex == null) return { success: false, reason: "Missing pageId/headingIndex" };

  // The space is a property of the PAGE being sealed, not of where the caller is standing.
  // Context supplies it for free on the panel; any other caller (the hook, a future content
  // action) has none, and without it the seal was written with spaceKey null — no space index
  // leg for the steward console and, since A1, no space-report entry. Derive it from the page.
  const realmKey =
    req.context.extension?.content?.space?.key
    || req.context.extension?.space?.key
    || (await resolvePageSpaceKey(pageId));

  // SV-SEC-1 (fixed 2026-08-20; see SECURITY-TODO.md and CLAUDE.md). pageId above is attacker-controlled and everything below reads and REWRITES
  // that page through asApp(), which carries site-wide write:confluence-content — so without
  // this gate any logged-in user could restructure any page on the site. Confluence's own
  // answer to "may this account edit this content" is the bar, i.e. exactly the bar the user
  // would face doing it by hand.
  //
  // UNCONDITIONAL on purpose: this is a write, so the "trusted context id" shortcut the two
  // read paths above use does not apply. Holding a page id in resolver context proves the
  // caller can SEE the page, never that they may CHANGE it — a reader would sail through.
  //
  // unsealSection below gates on owner-or-steward. That asymmetry is intended (seal = anyone
  // who may edit the page, unseal = only the owner or a steward); this side was simply absent,
  // which is what made an unentitled seal both possible and, once made, unremovable by the
  // people who actually own the page.
  if (!(await canEditPage(operatorAccountId, pageId))) {
    return { success: false, reason: "You do not have permission to edit this page" };
  }

  const extensionKey = await resolveSealedSectionKey();
  if (!extensionKey) return { success: false, reason: "Could not resolve section macro key" };
  if (headingIndex == null || !Number.isInteger(Number(headingIndex)) || Number(headingIndex) < 0) {
    return { success: false, reason: "Section not found — refresh and try again" };
  }

  const holdPeriod = await resolveSealHoldPeriod(realmKey, lockDuration);
  const expiresAt = new Date(Date.now() + holdPeriod * 1000).toISOString();
  const sectionId = newSectionId();

  let operatorName = "Current User";
  let operatorEmail = null;
  try {
    const prof = await currentUserProfile(operatorAccountId);
    operatorName = prof.displayName || operatorName; operatorEmail = prof.email || null;
  } catch (_) { /* best effort */ }

  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pageData, adfDoc } = await readDocBody(pageId);
    if (!realmId && pageData.spaceId) realmId = pageData.spaceId;
    const content = adfDoc.content || [];
    const block = content[headingIndex];
    if (!block) return { success: false, reason: "Section not found — refresh and try again" };
    // Review F4: the picker named a heading; if what sits at that index is no longer THAT
    // heading (a paragraph inserted above, a retitle), the page changed under the user — never
    // seal whatever happens to be there now.
    if (headingText && (block.type !== "heading" || textOfHeading(block) !== headingText)) {
      return { success: false, reason: "Page changed — refresh and try again" };
    }
    if (block.type === "bodiedExtension" && isSealedSectionKey(block.attrs?.extensionKey)) {
      return { success: false, reason: "This section is already sealed" };
    }

    const { start, end } = computeSectionRange(content, headingIndex);
    const rangeBlocks = content.slice(start, end).map((b) => JSON.parse(JSON.stringify(b)));
    // Review F5: a heading whose range already holds a sealed sub-section must not be sealed
    // over it — the outer snapshot would then include the inner wrapper, and every legitimate
    // inner-owner edit would read as tampering of the outer one.
    if (rangeBlocks.some((b) => b?.type === "bodiedExtension" && isSealedSectionKey(b.attrs?.extensionKey))) {
      return { success: false, reason: "This section already contains a sealed section — unseal that one first" };
    }
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
  // A1: record + snapshot written — the section is sealed from here on (the page write that
  // wrapped it already succeeded above, at result.version).
  await recordActivity({
    type: "section.sealed",
    pageId,
    spaceKey: realmKey || null,
    actor: { accountId: operatorAccountId, name: operatorName },
    target: { kind: "section", id: sectionId, name: sectionTitle },
    details: { expiresAt, lockDuration: holdPeriod, blocks: result.rangeBlocks.length },
    version: result.version,
  });
  if (realmId) {
    await kvs.set(`space-section-protection-${realmId}-${sectionId}`, {
      sectionId, pageId, sectionTitle, lockedBy: operatorAccountId,
      lockedByName: operatorName, expiresAt, pageTitle,
    });
  }
  await refreshSectionContentProp(pageId);
  await touchSealTimestamp();
  if (pageId) await restampIfEnforced(pageId); // #44 §2.7: keep an enforced baseline seal-complete
  await refreshByline(pageId).catch((e) => console.warn("[BYLINE] seal-section refresh failed:", e?.message || e));
  return { success: true, sectionId };
};

/**
 * Unseal a section: unwrap the macro (restore body to the page) and clear records.
 * Owner or steward.
 */
export const unsealSection = async (req) => {
  const { sectionId, reason: rawReason } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  const realmKey =
    req.context.extension?.content?.space?.key || req.context.extension?.space?.key;
  if (!sectionId) return { success: false, reason: "Missing sectionId" };

  const record = await kvs.get(`section-protection-${sectionId}`);
  if (!record) return { success: false, reason: "Section is not sealed" };

  const isOwner = record.lockedBy === operatorAccountId;
  let allowed = isOwner;
  if (!allowed) {
    // Review F3: the space is a property of the RECORD's page, never of where the caller is
    // standing (CLAUDE.md — the confused-deputy shape). A record with no spaceKey is resolved
    // from its page; a steward of some other space stays refused.
    const objectSpaceKey = record.spaceKey || (record.pageId ? await resolvePageSpaceKey(record.pageId) : null);
    try { allowed = !!objectSpaceKey && await authorizeSteward(operatorAccountId, objectSpaceKey); }
    catch (_) { /* deny */ }
  }
  if (!allowed) {
    // Review F6: no sweep releases an expired section seal, and the panel offers "Unseal" on an
    // expired one to everyone — so anyone who may edit the page may release a lapsed seal.
    const expired = !!(record.expiresAt && new Date(record.expiresAt) < new Date());
    if (expired && record.pageId) {
      try { allowed = await canEditPage(operatorAccountId, record.pageId); } catch (_) { /* deny */ }
    }
  }
  if (!allowed) return { success: false, reason: "Only the section owner or a space admin can unseal" };
  // Part 3.5: break-glass (steward, or anyone releasing a lapsed seal) needs a TYPED reason that
  // the trail shows. ONE rule with the attachment paths — shared/release-reason.js.
  let forcedReason = null;
  if (!isOwner) {
    const v = validateReleaseReason(rawReason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }

  const pageId = record.pageId;
  let unwrapped = false; // A1 review F8: the record must say whether the wrapper came off
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pageData, adfDoc } = await readDocBody(pageId);
    const content = adfDoc.content || [];
    const idx = content.findIndex(
      (b) => b.type === "bodiedExtension" && isSealedSectionKey(b.attrs?.extensionKey) && getSectionId(b) === sectionId,
    );
    if (idx === -1) { unwrapped = true; break; } // wrapper already gone — just clean KVS
    const body = Array.isArray(content[idx].content) ? content[idx].content : [];
    content.splice(idx, 1, ...body);
    adfDoc.content = content;
    const putRes = await writeDocBody(pageId, pageData, adfDoc, "(Sentinel Vault unsealed a section)");
    if (putRes.ok) { unwrapped = true; break; }
    if (putRes.status === 409) { await sleep(Math.pow(2, attempt) * 500); continue; }
    break;
  }

  await kvs.delete(`section-protection-${sectionId}`);
  await kvs.delete(`section-snapshot-${sectionId}`);
  // A1: the seal record is gone — released. `forced` says a steward did it to someone else's.
  await recordActivity({
    type: "section.released",
    pageId,
    spaceKey: record.spaceKey || realmKey || null,
    actor: {
      accountId: operatorAccountId,
      name: record.lockedBy === operatorAccountId ? (record.lockedByName || null) : null,
    },
    target: { kind: "section", id: sectionId, name: record.sectionTitle || "Sealed section" },
    details: {
      forced: !isOwner,
      ...(forcedReason ? { reason: forcedReason } : {}), // Part 3.5: the typed break-glass reason
      unwrapped, // false = protection ended but the macro wrapper is still on the page (write failed)
      ownerAccountId: record.lockedBy || null,
      ownerName: record.lockedByName || null,
    },
    version: null,
  });
  if (record.spaceId) {
    try { await kvs.delete(`space-section-protection-${record.spaceId}-${sectionId}`); }
    catch (_) { /* best effort */ }
  }
  await sweepSectionEditAccess(sectionId);
  await refreshSectionContentProp(pageId);
  await touchSealTimestamp();
  await refreshByline(pageId).catch((e) => console.warn("[BYLINE] unseal-section refresh failed:", e?.message || e));
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

/**
 * GAP 3 (req 2.3): read-only seal status for ONE section, for the editor lock banner.
 * Payload { sectionId } → { sealed, isMine, hasGrant, ownerName, ownerAccountId, expiresAt,
 * isExpired, pageId }. The record names who holds the seal on which page, so it is only
 * returned to a caller who can READ that page (SV-SEC-1 disclosure side; fails closed to
 * { sealed: false } — the same answer an unsealed id gets, so the refusal says nothing).
 */
const sectionSealStatus = async (req) => {
  const { sectionId } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  const closed = { sealed: false };
  if (!sectionId || typeof sectionId !== "string" || !operatorAccountId) return closed;
  try {
    const record = await kvs.get(`section-protection-${sectionId}`);
    if (!record?.lockedBy || !record.pageId) return closed;
    if (!(await canReadPage(operatorAccountId, record.pageId))) return closed;
    const isMine = record.lockedBy === operatorAccountId;
    const hasGrant = !isMine && !!(await getActiveSectionEditGrant(sectionId, operatorAccountId));
    return {
      sealed: true,
      isMine,
      hasGrant,
      ownerName: record.lockedByName || null,
      ownerAccountId: record.lockedBy,
      expiresAt: record.expiresAt || null,
      isExpired: !!(record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()),
      pageId: record.pageId,
    };
  } catch (e) {
    console.error("[SECTION] status failed:", e);
    return closed;
  }
};

export const actions = [
  ["list-page-headings", listPageHeadings],
  ["enumerate-section-seals", enumerateSectionSeals],
  ["seal-section", sealSection],
  ["unseal-section", unsealSection],
  ["refresh-section-snapshot", refreshSectionSnapshot],
  ["section-seal-status", sectionSealStatus],
];
