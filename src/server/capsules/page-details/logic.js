/*
 * Page details (5.0, mockup §4) — logic shared by the summary resolver and the byline writer.
 *
 * PURE (row-state.js, zero imports, pinned by test/page-details.test.mjs, re-exported here):
 *   primaryActionFor(row, viewer)   one primary action per seal row, by state (decision 5)
 *   menuActionsFor(row, viewer)     what sits under ⋯ for that row
 *
 * LIVE (Forge):
 *   readPageMeta(pageId)            v2 page read as the app → { id, title, type, spaceId } | null
 *   collectPageSeals(pageId, type)  every attachment seal (live and trashed) + every section seal
 *                                   on ONE page. Attachment ids come from the page's own attachment
 *                                   collection (v2, as the app, paged) and each `protection-{id}`
 *                                   is read by key — never the site-wide protection-* scan that
 *                                   enumeratePageSeals still does. Sections come from the one
 *                                   paginated reader (listSectionSealRecordsForPage).
 */
import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { listSectionSealRecordsForPage } from "../section-seals/logic.js";

// The pure row-state rules live in row-state.js (zero imports, shared with the browser bundle).
export { primaryActionFor, menuActionsFor } from "./row-state.js";

// ── LIVE ──────────────────────────────────────────────────────────────────────────────────────

const NUMERIC = /^\d{1,20}$/;
const ATTACHMENT_PAGE_CAP = 20; // 20 × 250 — the ribbon's ceiling, same reasoning

/** v2 page read as the app. A blogpost id answers on /blogposts; try that when /pages is 404. */
export async function readPageMeta(pageId) {
  if (!NUMERIC.test(String(pageId ?? ""))) return null;
  for (const coll of ["pages", "blogposts"]) {
    try {
      const res = await asApp().requestConfluence(
        coll === "pages" ? route`/wiki/api/v2/pages/${pageId}` : route`/wiki/api/v2/blogposts/${pageId}`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const p = await res.json();
        return { id: String(p.id), title: p.title || "", type: coll === "pages" ? "page" : "blogpost", spaceId: p.spaceId != null ? String(p.spaceId) : null, status: p.status || null };
      }
      if (res.status !== 404) return null;
    } catch (_) { return null; }
  }
  return null;
}

async function listAttachments(pageId, collection, status) {
  const ids = [];
  let cursor = null;
  for (let i = 0; i < ATTACHMENT_PAGE_CAP; i++) {
    let url;
    if (collection === "blogposts") {
      url = status
        ? (cursor ? route`/wiki/api/v2/blogposts/${pageId}/attachments?status=${status}&limit=250&cursor=${cursor}` : route`/wiki/api/v2/blogposts/${pageId}/attachments?status=${status}&limit=250`)
        : (cursor ? route`/wiki/api/v2/blogposts/${pageId}/attachments?limit=250&cursor=${cursor}` : route`/wiki/api/v2/blogposts/${pageId}/attachments?limit=250`);
    } else {
      url = status
        ? (cursor ? route`/wiki/api/v2/pages/${pageId}/attachments?status=${status}&limit=250&cursor=${cursor}` : route`/wiki/api/v2/pages/${pageId}/attachments?status=${status}&limit=250`)
        : (cursor ? route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}` : route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`);
    }
    const res = await asApp().requestConfluence(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`attachments ${status || "current"} → ${res.status}`);
    const data = await res.json();
    for (const a of data?.results || []) if (a?.id) ids.push({ id: String(a.id), title: a.title || "", fileSize: a.fileSize ?? null, mediaType: a.mediaType || null, createdAt: a.createdAt || null, version: a.version?.number ?? null, downloadLink: a.downloadLink || a._links?.download || null });
    const next = data?._links?.next;
    if (!next) break;
    try { cursor = new URL(next, "https://example.com").searchParams.get("cursor"); } catch (_) { cursor = null; }
    if (!cursor) break;
  }
  return ids;
}

/**
 * @returns {Promise<{ attachments: Array<{ id, record, trashed }>, sections: object[], all: object[] }>}
 * `all` is every CURRENT attachment's metadata (id, title, fileSize, mediaType, createdAt, version,
 * downloadLink) — the seal action lists them with a checkbox each.
 * A `protection-*` record with `trashedOnly` is the S7 tracking record, not a seal — skipped.
 */
export async function collectPageSeals(pageId, contentType = "page") {
  const collection = contentType === "blogpost" ? "blogposts" : "pages";
  const attachments = [];
  const all = await listAttachments(pageId, collection, null);
  const current = all.map((a) => a.id);
  let trashed = [];
  try { trashed = (await listAttachments(pageId, collection, "trashed")).map((a) => a.id).filter((id) => !current.includes(id)); }
  catch (e) { console.warn("[PAGE-DETAILS] trashed-attachment probe failed:", e?.message || e); }
  const readBatch = async (ids, isTrashed) => {
    for (let i = 0; i < ids.length; i += 25) {
      const records = await Promise.all(ids.slice(i, i + 25).map((id) => kvs.get(`protection-${id}`).catch(() => null)));
      records.forEach((r, j) => {
        if (!r || !r.lockedBy || r.trashedOnly) return;
        attachments.push({ id: ids[i + j], record: r, trashed: isTrashed });
      });
    }
  };
  await readBatch(current, false);
  await readBatch(trashed, true);
  const sections = (await listSectionSealRecordsForPage(String(pageId))).filter((s) => s?.lockedBy);
  return { attachments, sections, all };
}
