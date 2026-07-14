/**
 * it56: stable KEYSET (seek) pagination.
 *
 * The old "my sealed files" pagination re-scanned + re-sorted every seal on each page request, then
 * sliced by a numeric OFFSET (start, start+limit) and returned nextCursor = String(start+limit).
 * Because the offset indexes a list that is rebuilt+resorted per call, any seal/unseal between two
 * page requests shifts every index → an item is shown twice (a new seal sorts to the top) or skipped
 * (an unseal shifts items up). Keyset pagination anchors the cursor on the LAST returned item's
 * (lockedOn, id) and returns items strictly AFTER that anchor in the sort order, which is stable
 * under concurrent insert/delete.
 *
 * Sort order: lockedOn DESC, then id DESC (a total order so equal timestamps still page stably).
 * Items must expose `.lockedOn` (ISO/date/ms) and `.id`.
 */

// numeric sort timestamp for an item (invalid/missing → 0, which sorts to the end)
const ts = (x) => {
  const n = new Date(x && x.lockedOn).getTime();
  return Number.isFinite(n) ? n : 0;
};

// strictly AFTER the anchor in (lockedOn DESC, id DESC) order
const afterAnchor = (x, anchor) => {
  const t = ts(x);
  if (t !== anchor.t) return t < anchor.t;
  return String(x.id) < String(anchor.id);
};

/**
 * @param {Array} items   the FULL filtered result set (unsorted is fine — sorted here)
 * @param {{t:number,id:string}|null} cursor  decoded anchor of the previous page, or null for page 1
 * @param {number} limit  page size
 * @returns {{page:Array, hasMore:boolean, nextCursor:{t:number,id:string}|null, total:number}}
 */
export function keysetPage(items, cursor, limit) {
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const sorted = [...(items || [])].sort((a, b) => {
    const d = ts(b) - ts(a);
    if (d !== 0) return d;
    const ai = String(a.id), bi = String(b.id);
    return ai < bi ? 1 : ai > bi ? -1 : 0; // id DESC
  });

  let startIdx = 0;
  if (cursor && Number.isFinite(cursor.t)) {
    const found = sorted.findIndex((x) => afterAnchor(x, cursor));
    startIdx = found < 0 ? sorted.length : found;
  }

  const page = sorted.slice(startIdx, startIdx + lim);
  const hasMore = startIdx + lim < sorted.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { t: ts(last), id: String(last.id) } : null;
  return { page, hasMore, nextCursor, total: sorted.length };
}

/** Encode a keyset cursor to an opaque string the UI round-trips verbatim (`t|id`). */
export function encodeKeysetCursor(c) {
  return c && Number.isFinite(c.t) ? `${c.t}|${c.id}` : null;
}

/** Decode an incoming cursor string; an old numeric-offset cursor (no `|`) or garbage → null (page 1). */
export function decodeKeysetCursor(cursor) {
  if (typeof cursor !== "string") return null;
  const i = cursor.indexOf("|");
  if (i < 0) return null;
  const t = parseInt(cursor.slice(0, i), 10);
  return Number.isFinite(t) ? { t, id: cursor.slice(i + 1) } : null;
}
