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
import { errText } from "../../shared/action-log.js";

/**
 * The page's banner stamp: open banners poll it (check-seal-stamp, the `workflowStamp`) and re-read
 * the page when it moves. Moved by every workflow writer (touchByline) and by every alert recorded
 * for the page (bulletins/logic.js recordDispatch), each AFTER its own write, so a banner that
 * re-read the page on an earlier move (a state written before its alert) reads it again.
 */
export async function touchBannerStamp(pageId) {
  if (!pageId) return;
  await kvs.set(`protections-last-workflow-${pageId}`, Date.now()).catch(() => {});
}

export async function touchByline(pageId) {
  if (!pageId) return;
  // Every workflow writer calls this, so open banners learn of the change here too.
  await touchBannerStamp(pageId);
  try {
    const { refreshByline } = await import("./byline.js");
    await refreshByline(pageId);
  } catch (e) {
    console.warn(`[BYLINE] workflow touch for ${pageId} failed:`, errText(e));
  }
}
