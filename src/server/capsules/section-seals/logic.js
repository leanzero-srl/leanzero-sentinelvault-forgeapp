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
 * Compute the top-level block range [start, end) that makes up a "section": the
 * heading at startIndex plus every following block until the next heading of the
 * same or higher level. Non-heading blocks seal just themselves.
 */
export function computeSectionRange(content, startIndex) {
  const start = content[startIndex];
  if (!start || start.type !== "heading") {
    return { start: startIndex, end: startIndex + 1 };
  }
  const level = start.attrs?.level || 1;
  let end = startIndex + 1;
  while (end < content.length) {
    const node = content[end];
    if (node.type === "heading" && (node.attrs?.level || 1) <= level) break;
    end++;
  }
  return { start: startIndex, end };
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
  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith("section-protection-"))
    .limit(100)
    .getMany();
  const sections = (results || [])
    .map(({ value }) => value)
    .filter((v) => v?.pageId === pageId && v?.sectionId)
    .map((v) => ({ sectionId: v.sectionId, lockedBy: v.lockedBy, expiresAt: v.expiresAt }));
  await writeSectionContentProp(pageId, sections);
}
