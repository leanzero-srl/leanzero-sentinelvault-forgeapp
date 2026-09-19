import { kvs, WhereConditions } from "@forge/kvs";
import { asApp, route } from "@forge/api";

// Content Sealing (section-level) — storage helpers.
//
// Key families (mirror the attachment-seal triad):
//   section-protection-{sectionId}            primary record
//   section-snapshot-{sectionId}              sealed body + wrapper snapshot
//   space-section-protection-{spaceId}-{id}   realm index
// Plus a page content property "section-protection-" holding a small array so
// the page-content trigger can early-bail with one API call.

const SECTION_PROP_KEY = "section-protection-";

/**
 * A top-level block that is one of Sentinel Vault's OWN macros (the inline panel, a sealed
 * section, anything under `/static/sentinel-vault-…`). Matched by the key's module segment so it
 * holds for every environment (dev/staging/prod keys differ only in app/env ids).
 */
export function isSentinelVaultExtension(node) {
  if (!node || !/extension$/i.test(String(node.type || ""))) return false;
  return /\/static\/sentinel-vault-/.test(String(node.attrs?.extensionKey || ""));
}

/**
 * Compute the top-level block range [start, end) that makes up a "section": the heading at
 * startIndex plus every following block until the next heading of the same or higher level —
 * OR the first Sentinel Vault macro, whichever comes first. Non-heading blocks seal just themselves.
 *
 * SEC-1 (UX critique 2026-09-19): for the LAST heading "the next heading" is the end of the page,
 * so the range swallowed everything below — including the app's own inline panel, which then
 * vanished from the page and could not render inside the sealed body. The app's surfaces are
 * never content to seal, so the range stops in front of them. Other apps' macros (a status, an
 * expand, a table of contents) stay inside the range: to the author they ARE the section's content.
 */
export function computeSectionRange(content, startIndex) {
  return describeSectionRange(content, startIndex).range;
}

/**
 * The range plus what ended it, for the picker: `{ range: { start, end }, blocks, stopsAt }` where
 * `blocks` is the number of blocks after the heading and `stopsAt` is
 * `{ kind: "heading", text }` | `{ kind: "sentinel-vault", what }` | `{ kind: "end" }` — `what` is
 * "panel" | "sealed-section" | "macro" (any other Sentinel Vault macro).
 */
export function describeSectionRange(content, startIndex) {
  const start = content[startIndex];
  if (!start || start.type !== "heading") {
    return { range: { start: startIndex, end: startIndex + 1 }, blocks: 0, stopsAt: { kind: "end" } };
  }
  const level = start.attrs?.level || 1;
  let end = startIndex + 1;
  let stopsAt = { kind: "end" };
  while (end < content.length) {
    const node = content[end];
    if (node.type === "heading" && (node.attrs?.level || 1) <= level) {
      stopsAt = { kind: "heading", text: headingText(node) };
      break;
    }
    if (isSentinelVaultExtension(node)) { stopsAt = { kind: "sentinel-vault", what: sentinelVaultMacroName(node) }; break; }
    end++;
  }
  return { range: { start: startIndex, end }, blocks: end - startIndex - 1, stopsAt };
}

function sentinelVaultMacroName(node) {
  const key = String(node?.attrs?.extensionKey || "");
  if (/\/static\/sentinel-vault-panel$/.test(key)) return "panel";
  if (/\/static\/sentinel-vault-sealed-section$/.test(key)) return "sealed-section";
  return "macro";
}

function headingText(node) {
  let t = "";
  const walk = (n) => { if (!n) return; if (n.type === "text") t += n.text || ""; (n.content || []).forEach(walk); };
  (node.content || []).forEach(walk);
  return t.trim();
}

/**
 * Write/replace the page's section-protection content property with the supplied
 * compact array [{ sectionId, lockedBy, expiresAt }]. Deletes the property when
 * the array is empty.
 */
export async function writeSectionContentProp(pageId, sections) {
  if (!pageId) return;
  if (!sections || sections.length === 0) {
    await removeSectionContentProp(pageId);
    return;
  }
  try {
    const getResponse = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${SECTION_PROP_KEY}`,
    );
    if (!getResponse.ok) return;
    const getBody = await getResponse.json();
    const existing = getBody.results?.[0];
    if (existing) {
      const nextVersion = (existing.version?.number || 1) + 1;
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: SECTION_PROP_KEY, value: sections, version: { number: nextVersion } }),
        },
      );
    } else {
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: SECTION_PROP_KEY, value: sections }),
        },
      );
    }
  } catch (e) {
    console.error("[SECTION-PROP] write failed:", e);
  }
}

/**
 * Delete the page's section-protection content property.
 */
export async function removeSectionContentProp(pageId) {
  if (!pageId) return;
  try {
    const getResponse = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${SECTION_PROP_KEY}`,
    );
    if (!getResponse.ok) return;
    const getBody = await getResponse.json();
    const existing = getBody.results?.[0];
    if (!existing) return;
    await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`,
      { method: "DELETE" },
    );
  } catch (e) {
    console.error("[SECTION-PROP] delete failed:", e);
  }
}

/**
 * Rebuild the page's section-protection content property from current KVS records.
 */
export async function refreshSectionContentProp(pageId) {
  if (!pageId) return;
  const sections = (await listSectionSealRecordsForPage(pageId))
    .map((v) => ({ sectionId: v.sectionId, lockedBy: v.lockedBy, expiresAt: v.expiresAt }));
  await writeSectionContentProp(pageId, sections);
}

/**
 * Every section-protection-* record for ONE page, cursor-paginated. Review F1 (2026-09-14): the
 * two writers above and in actions.js each took a single limit(100) slice of the SITE-WIDE prefix
 * and filtered by pageId — past 100 sealed sections anywhere, a page's seals silently fell off
 * the content property and the trigger's fast path stopped protecting them. Same defect the
 * trigger's own reader had already fixed (audit B4); one loop now serves all three.
 */
export async function listSectionSealRecordsForPage(pageId, { maxPages = 50 } = {}) {
  const out = [];
  let q = kvs.query().where("key", WhereConditions.beginsWith("section-protection-")).limit(100);
  let iters = 0;
  do {
    const { results, nextCursor } = await q.getMany();
    for (const { value: v } of results || []) {
      if (v?.pageId === pageId && v?.sectionId) out.push(v);
    }
    if (!nextCursor) break;
    q = kvs.query().where("key", WhereConditions.beginsWith("section-protection-")).limit(100).cursor(nextCursor);
  } while (++iters < maxPages);
  if (iters >= maxPages) console.warn(`[SECTION] listSectionSealRecordsForPage(${pageId}) hit the ${maxPages}-page cap`);
  return out;
}
