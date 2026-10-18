/**
 * WF-6: ONE line every workflow writer calls after it changed what the byline chip should say
 * (a state persisted, an approval requested / re-requested / decided / cleared). The chip is a
 * content property Confluence renders lazily, so the status is folded in at write time.
 *
 * `byline.js` imports the workflow capsule (to read the status), and the workflow capsule calls
 * this — the import here is DYNAMIC so the module graph has no static cycle. Never awaited into
 * the caller's failure path: a chip that lags is a nuisance, a transition that fails because the
 * property write did is a bug.
 */
import { kvs } from "@forge/kvs";

export async function touchByline(pageId) {
  if (!pageId) return;
  // Every workflow writer calls this, so open banners learn of the change here too: their poll
  // (check-seal-stamp) reads this page's stamp and re-reads the page when it moves.
  await kvs.set(`protections-last-workflow-${pageId}`, Date.now()).catch(() => {});
  try {
    const { refreshByline } = await import("./byline.js");
    await refreshByline(pageId);
  } catch (e) {
    console.warn(`[BYLINE] workflow touch for ${pageId} failed:`, e?.message || e);
  }
}
