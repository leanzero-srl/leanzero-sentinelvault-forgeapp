/**
 * SEC-4 (a) (UX critique 2026-09-19, done 2026-09-20): SEAL ON INSERT. Someone inserts the Sealed
 * Section macro in the editor, puts content inside and publishes — and used to get a wrapper
 * with an empty config and no seal (the badge read "Not sealed yet", the panel a second step).
 * The macro cannot seal itself in the editor: there is no app iframe there and the page is not
 * published yet, so there is nothing to snapshot. The seal happens on PUBLISH: the page-content
 * trigger (and the view-time guard) finds the wrapper without a record and adopts it for the
 * person who published, exactly as sealSection would have recorded it — record, snapshot, space
 * index row, activity — and stamps the app-issued sectionId onto the node in the same write.
 *
 * Timing (the risk the item names): inserted but not published → no event, no record, nothing
 * to protect yet. The macro's Insert leaves a marker (section-insert-pending-{pageId}, 48 h) so
 * the trigger reads the ADF of a page that has no seal yet ONLY when an insert is pending — every
 * other publish keeps the cheap probes. A page that already carries a seal is read anyway.
 */
import { kvs } from "@forge/kvs";
import { asApp, route } from "@forge/api";
import { hashAdf } from "../../infra/doc-surgery.js";
import { resolveSealHoldPeriod } from "../sealing/logic.js";
import { currentUserProfile } from "../../shared/user-or-app.js";
import { recordActivity } from "../../infra/activity-log.js";

export const INSERT_INTENT_PREFIX = "section-insert-pending-";
export const INSERT_INTENT_TTL_MS = 48 * 3600 * 1000;
export const insertIntentKey = (pageId) => `${INSERT_INTENT_PREFIX}${pageId}`;

export const newSectionId = () => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch (_) { /* fall through */ }
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

function headingTextOf(node) {
  const first = Array.isArray(node?.content) ? node.content[0] : null;
  if (first?.type !== "heading") return null;
  let t = "";
  const walk = (n) => { if (n?.type === "text") t += n.text || ""; if (Array.isArray(n?.content)) n.content.forEach(walk); };
  walk(first);
  return t.trim() || null;
}

/**
 * Write the seal for a wrapper the trigger found without a record. The caller stamps the id
 * onto the node and writes the page; this writes everything sealSection writes around it.
 * @returns {{ sectionId, record }}
 */
export async function adoptInsertedSection({ pageId, spaceKey, spaceId, pageTitle, node, originalIndex, ownerAccountId, version }) {
  const sectionId = newSectionId();
  const body = JSON.parse(JSON.stringify(node?.content || []));
  const contentHash = hashAdf(body);
  const holdPeriod = await resolveSealHoldPeriod(spaceKey);
  const expiresAt = new Date(Date.now() + holdPeriod * 1000).toISOString();
  let ownerName = "Current User", ownerEmail = null;
  try { const p = await currentUserProfile(ownerAccountId); ownerName = p.displayName || ownerName; ownerEmail = p.email || null; } catch (_) { /* best effort */ }
  let title = pageTitle || null;
  let sid = spaceId || null;
  if (!title || !sid) {
    try {
      const pr = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
      if (pr.ok) { const pd = await pr.json(); title = title || pd.title || null; sid = sid || pd.spaceId || null; }
    } catch (_) { /* best effort */ }
  }
  const sectionTitle = headingTextOf(node) || "Sealed section";
  const record = {
    sectionId, pageId: String(pageId), spaceId: sid, spaceKey: spaceKey || null,
    lockedBy: ownerAccountId, lockedByName: ownerName, lockedByEmail: ownerEmail,
    timestamp: new Date().toISOString(), expiresAt, lockDuration: holdPeriod,
    sectionTitle, sealedVersion: version ?? null, contentHash, originalIndex: originalIndex ?? null,
    note: null, adoptedOnInsert: true,
  };
  await kvs.set(`section-protection-${sectionId}`, record);
  await kvs.set(`section-snapshot-${sectionId}`, { wrapperNode: JSON.parse(JSON.stringify(node)), bodyContent: body, hash: contentHash, version: version ?? null, originalIndex: originalIndex ?? null });
  if (sid) {
    await kvs.set(`space-section-protection-${sid}-${sectionId}`, { sectionId, pageId: String(pageId), sectionTitle, lockedBy: ownerAccountId, lockedByName: ownerName, expiresAt, pageTitle: title || "Unknown Page" }).catch(() => {});
  }
  await recordActivity({
    type: "section.sealed",
    pageId: String(pageId),
    spaceKey: spaceKey || null,
    actor: { accountId: ownerAccountId, name: ownerName },
    target: { kind: "section", id: sectionId, name: sectionTitle },
    details: { expiresAt, lockDuration: holdPeriod, blocks: body.length, adoptedOnInsert: true },
    version: version ?? null,
  }).catch((e) => console.warn("[SECTION-ADOPT] activity:", e?.message || e));
  return { sectionId, record };
}
