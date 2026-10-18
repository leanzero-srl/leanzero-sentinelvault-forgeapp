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
import { setWithTtl } from "../../shared/kvs-ttl.js";

// The stamp only has to outlive the banners open on the page; it expires on its own (a missing stamp
// reads 0, which costs an open banner one extra re-read) and goes with a purged page
// (workflow/logic.js purgePageWorkflow). Forge's TTL is for cleanup only: a key past it can still be
// read for a while, which is harmless here (a stamp is only ever compared for a change).
export const WORKFLOW_STAMP_TTL_MS = 24 * 3600 * 1000;
export const workflowStampKey = (pageId) => `protections-last-workflow-${pageId}`;

export async function touchByline(pageId) {
  if (!pageId) return;
  // Every workflow writer calls this, so open banners learn of the change here too: their poll
  // (check-seal-stamp) reads this page's stamp and re-reads the page when it moves.
  await setWithTtl(workflowStampKey(pageId), Date.now(), WORKFLOW_STAMP_TTL_MS).catch(() => {});
  try {
    const { refreshByline } = await import("./byline.js");
    await refreshByline(pageId);
  } catch (e) {
    console.warn(`[BYLINE] workflow touch for ${pageId} failed:`, e?.message || e);
  }
}
