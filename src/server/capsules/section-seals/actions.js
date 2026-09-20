import { asApp, asUser, route } from "@forge/api";
import { currentUserProfile } from "../../shared/user-or-app.js";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey } from "../../shared/content-access.js";
import { touchSealTimestamp, resolveSealHoldPeriod } from "../sealing/logic.js";
import { BASELINE_HOLD_SPAN, sanitizeHoldDuration } from "../../shared/baseline.js";
import { setUntil } from "../../shared/kvs-ttl.js"; // SEC-7: grants carried forward on extend
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
  describeSectionRange,
  refreshSectionContentProp,
} from "./logic.js";
import { sweepSectionEditAccess, getActiveSectionEditGrant } from "../editreq/logic.js";
import { recordActivity } from "../../infra/activity-log.js";
import { validateReleaseReason } from "../../shared/release-reason.js";
import { refreshByline } from "../page-details/byline.js"; // 5.0 byline chip
import { heldRefusal, isWorkflowHeld, heldLabel } from "../../shared/seal-authority.js"; // SEC-2
import { releaseSectionSeal } from "./release.js"; // SEC-7 (d): one teardown with the expiry sweep

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
        // SEC-1: the picker shows what the seal will cover (blocks after the heading and what
        // ends the range) so the user sees the range BEFORE freezing it.
        const { blocks, stopsAt } = describeSectionRange(content, i);
        headings.push({ index: i, level: b.attrs?.level || 1, text: textOfHeading(b) || "(untitled heading)", blocks, stopsAt });
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
        note: v.note || null,
        isMine: v.lockedBy === operatorAccountId,
        isExpired: !!(v.expiresAt && new Date(v.expiresAt) < new Date()),
        workflowHeld: isWorkflowHeld(v), heldLabel: heldLabel(v), // SEC-2
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
  // SEC-7: an optional note, like the attachment seal action carries (kept on the record, shown on the rows).
  const note = typeof req.payload?.note === "string" && req.payload.note.trim() ? req.payload.note.trim().slice(0, 300) : null;
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
      return { success: false, reason: "This section already contains a sealed section — release that one first" };
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
    note,
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
  if (!allowed) return { success: false, reason: "Only the section owner or a space admin can release this seal" };
  // SEC-2: while the page is Approved the seal is the workflow's — the owner cannot release it;
  // a steward's break-glass (typed reason, below) is the one door out.
  { const held = heldRefusal(record, isOwner ? "release" : "force-release"); if (held) return { success: false, reason: held }; }
  // Part 3.5: break-glass (steward, or anyone releasing a lapsed seal) needs a TYPED reason that
  // the trail shows. ONE rule with the attachment paths — shared/release-reason.js.
  let forcedReason = null;
  if (!isOwner) {
    const v = validateReleaseReason(rawReason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }

  const pageId = record.pageId;
  // ONE teardown with the expiry sweep's auto-release (section-seals/release.js): unwrap the
  // wrapper (body spliced back), then every key family the seal consists of. `unwrapped` says
  // whether the wrapper came off (A1 review F8).
  const { unwrapped } = await releaseSectionSeal(sectionId, record);
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
      workflowHeld: isWorkflowHeld(record), heldLabel: heldLabel(record), // SEC-2: the macro badge says so
    };
  } catch (e) {
    console.error("[SECTION] status failed:", e);
    return closed;
  }
};

/**
 * Judge this page's live version NOW (tester report 2026-09-17 — the page event that drives the
 * restore was arriving 20+ minutes late). Called by the sealed-section macro in view mode and by
 * the ribbon on a page that carries seals. The caller only has to be able to READ the page: the
 * app is not acting on their behalf, it is running its own enforcement — every input is a
 * server-owned seal record and the live page, nothing from the payload reaches a write.
 * `mine` tells the viewer it was THEIR version that was undone, so the macro can say where
 * their text went.
 */
const UNDONE_NOTICE_WINDOW_MS = 10 * 60 * 1000;
const guardPageNowAction = async (req) => {
  const ctxPageId = req.context?.extension?.content?.id;
  const accountId = req.context?.accountId;
  const pageId = String(req.payload?.pageId || ctxPageId || "");
  if (!accountId || !/^\d{1,20}$/.test(pageId)) return { checked: false, restored: false };
  if (mustVerify(req.payload?.pageId, ctxPageId) && !(await canReadPage(accountId, pageId))) return { checked: false, restored: false };
  try {
    // Dynamic: triggers.js is the heaviest module in the bundle and imports half the capsules.
    const { guardPageNow } = await import("../../triggers.js");
    const r = await guardPageNow(pageId, "view");
    // WHO put it back does not matter to the person who lost the text. When the page event was
    // on time, the trigger restored the section before this view and the guard has nothing to
    // report (live-proven 2026-09-17, attempt 1) — so the caller's own recent section reverts
    // are read from the same dispatch records the ribbon shows, and answered either way.
    let mineEvents = [];
    try {
      const cutoff = Date.now() - UNDONE_NOTICE_WINDOW_MS;
      mineEvents = ((await kvs.get("recent-notifications"))?.events || []).filter((e) => String(e.pageId) === pageId
        && e.sectionId && e.editorAccountId === accountId && e.ownerAccountId !== accountId
        && new Date(e.timestamp).getTime() >= cutoff);
    } catch (_) { /* the notice is a courtesy */ }
    const guardMine = !!(r.restored && r.authorId && r.authorId === accountId);
    return {
      checked: !!r.checked,
      restored: !!r.restored || mineEvents.length > 0,
      fresh: !!r.restored, // put back during THIS view: the body on screen is stale → offer Reload
      mine: guardMine || mineEvents.length > 0,
      revertedVersion: mineEvents[0]?.revertedVersion || (r.restored ? r.version : null),
      sectionIds: [...new Set([...(r.restored ? (r.sectionIds || []) : []), ...mineEvents.map((e) => e.sectionId)])],
    };
  } catch (e) {
    console.error("[PAGE-GUARD] view check failed:", e);
    return { checked: false, restored: false };
  }
};

/**
 * SEC-7 (UX critique 2026-09-19): extend a section seal — the mirror of sealing/actions.js
 * extendSeal. Owner or a steward of the RECORD's space (never the caller's context space). A live
 * seal extends from its current expiry, a lapsed one from now. Every edit grant on the section is
 * carried forward to the new expiry (a grant inherits the seal's expiry at grant time, so leaving
 * it behind would cut an editor off while the seal still holds). The snapshot, the hash and the
 * workflow's enforce baseline are NOT touched: an extension changes when, never what.
 */
export const extendSection = async (req) => {
  const { sectionId, additionalSeconds } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  if (!sectionId) return { success: false, reason: "Missing sectionId" };
  const record = await kvs.get(`section-protection-${sectionId}`);
  if (!record || !record.lockedBy) return { success: false, reason: "Section is not sealed" };
  let authorized = record.lockedBy === operatorAccountId;
  if (!authorized) {
    try {
      const objectSpaceKey = record.spaceKey || (record.pageId ? await resolvePageSpaceKey(record.pageId) : null);
      authorized = !!objectSpaceKey && await authorizeSteward(operatorAccountId, objectSpaceKey);
    } catch (_) { authorized = false; }
  }
  if (!authorized) return { success: false, reason: "Only the seal owner or a space admin can extend this seal" };
  { const held = heldRefusal(record, "extend"); if (held) return { success: false, reason: held }; } // SEC-2

  let addSeconds = sanitizeHoldDuration(additionalSeconds, 0);
  if (!addSeconds) addSeconds = await resolveSealHoldPeriod(record.spaceKey);
  addSeconds = sanitizeHoldDuration(addSeconds, BASELINE_HOLD_SPAN);
  const now = Date.now();
  const currentExpiryMs = record.expiresAt ? new Date(record.expiresAt).getTime() : 0;
  const anchorMs = Number.isFinite(currentExpiryMs) && currentExpiryMs > now ? currentExpiryMs : now;
  const newExpiresAt = new Date(anchorMs + addSeconds * 1000).toISOString();
  const newExpiryMs = anchorMs + addSeconds * 1000;

  const updated = { ...record, expiresAt: newExpiresAt, extendedAt: new Date().toISOString(), extendedBy: operatorAccountId, extensionCount: (Number(record.extensionCount) || 0) + 1 };
  await kvs.set(`section-protection-${sectionId}`, updated);
  // Grants ride the seal: every grant on this section now ends when the seal does.
  let grantsMoved = 0;
  try {
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`section-edit-grant-${sectionId}-`)).limit(100).getMany();
    for (const { key, value } of results || []) {
      if (!value) continue;
      await setUntil(key, { ...value, expiresAt: newExpiresAt }, newExpiryMs);
      grantsMoved++;
    }
  } catch (e) { console.warn("[EXTEND-SECTION] grants carry-forward failed:", e?.message || e); }
  if (record.spaceId) {
    try {
      const indexKey = `space-section-protection-${record.spaceId}-${sectionId}`;
      const indexRow = await kvs.get(indexKey);
      if (indexRow) await kvs.set(indexKey, { ...indexRow, expiresAt: newExpiresAt });
    } catch (e) { console.warn("[EXTEND-SECTION] index row update failed:", e?.message || e); }
  }
  await touchSealTimestamp();
  await recordActivity({
    type: "section.extended",
    pageId: record.pageId || null,
    spaceKey: record.spaceKey || null,
    actor: { accountId: operatorAccountId, name: record.lockedBy === operatorAccountId ? (record.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: record.sectionTitle || "Sealed section" },
    details: { previousExpiresAt: record.expiresAt || null, expiresAt: newExpiresAt, addedSeconds: addSeconds, extensionCount: updated.extensionCount, grantsMoved, byOwner: record.lockedBy === operatorAccountId },
    version: null,
  });
  if (record.pageId) await refreshSectionContentProp(record.pageId).catch(() => {});
  if (record.pageId) await refreshByline(record.pageId).catch((e) => console.warn("[BYLINE] extend-section refresh failed:", e?.message || e));
  return { success: true, expiresAt: newExpiresAt, extensionCount: updated.extensionCount, grantsMoved };
};

export const actions = [
  ["list-page-headings", listPageHeadings],
  ["enumerate-section-seals", enumerateSectionSeals],
  ["seal-section", sealSection],
  ["unseal-section", unsealSection],
  ["extend-section", extendSection],
  ["refresh-section-snapshot", refreshSectionSnapshot],
  ["section-seal-status", sectionSealStatus],
  ["guard-page-now", guardPageNowAction],
];
