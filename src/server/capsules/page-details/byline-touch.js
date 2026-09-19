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
export async function touchByline(pageId) {
  if (!pageId) return;
  try {
    const { refreshByline } = await import("./byline.js");
    await refreshByline(pageId);
  } catch (e) {
    console.warn(`[BYLINE] workflow touch for ${pageId} failed:`, e?.message || e);
  }
}
