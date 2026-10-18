/**
 * The byline item under the page title, kept in step by the banner (2026-10-18, content pilot
 * live-fix-ship-1). PURE; test/byline-sync.test.mjs.
 *
 * Confluence renders `confluence:contentBylineItem` from the `sentinel-byline` content property when
 * the page LOADS and never re-reads it, so after a move made elsewhere the item kept its old status
 * ("Draft") while the banner, which polls the per-page workflow stamp, showed "In Review". The bridge's
 * updateBylineProperties (called from another module on the same page) changes the open page's item;
 * the banner calls it with the byline ribbon-summary answers. This decides WHEN:
 *   - the first answer for a page is remembered, not pushed: it is what Confluence just rendered from
 *     the property (pushing it would only risk a flicker, or replace the manifest's default title and
 *     icon on a page that never had the property);
 *   - after that, a byline that differs from the last one is pushed once;
 *   - an answer without a byline (the summary could not read the page) changes nothing.
 *
 * @param {{ pageId: string, stamp: string }|null} state  what the banner last saw
 * @param {string|null} pageId
 * @param {{ title?: string, icon?: string, tooltip?: string }|null} byline
 * @returns {{ state, push: { title, icon, tooltip }|null }}
 */
export function bylineSyncStep(state, pageId, byline) {
  const id = pageId == null ? null : String(pageId);
  if (!byline || typeof byline !== "object" || !byline.title) {
    return { state: state && state.pageId === id ? state : { pageId: id, stamp: null }, push: null };
  }
  const value = { title: String(byline.title), icon: byline.icon ? String(byline.icon) : "", tooltip: byline.tooltip ? String(byline.tooltip) : "" };
  const stamp = `${value.title}|${value.icon}|${value.tooltip}`;
  if (!state || state.pageId !== id || state.stamp == null) {
    // A page we have not seen an answer for: what Confluence shows is the property it just loaded.
    // (A remembered "no answer" for this page is not a stamp: the next byline is the baseline too.)
    return { state: { pageId: id, stamp }, push: null };
  }
  if (state.stamp === stamp) return { state, push: null };
  return { state: { pageId: id, stamp }, push: value };
}
