/**
 * Sealed-media PRESENTATION protection (Fix 6, incident 2026-07-22: a non-owner resized a
 * sealed image and the save went straight through — attachment seals only checked fileId
 * presence). Owner decision: STRICT — sealing an image also seals how it presents on the page.
 *
 * Design: compare ONLY a fixed protect-list of presentation attrs (mediaSingle layout/width/
 * widthType + media width/height). Everything else on the nodes is ignored, which makes the
 * check immune-by-construction to editor-regenerated attr noise (localId, occurrenceKey, …) —
 * the R1-F3 false-positive class. Baselines are captured from a SERVER READ of the ADF and
 * compared against later SERVER READS, so Confluence's own attr normalization (observed live:
 * a REST-written width 50/percentage came back 340/pixel) cancels out on both sides.
 *
 * Zero imports — unit-testable in plain node.
 */

/** Deep-find the mediaSingle wrapper whose media child references fileId. Returns the LIVE ref. */
export function findSealedMediaSingle(node, fileId) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "mediaSingle") {
    for (const child of node.content || []) {
      if (child?.type === "media" && child.attrs?.id === fileId) return node;
    }
  }
  for (const child of node.content || []) {
    const found = findSealedMediaSingle(child, fileId);
    if (found) return found;
  }
  return null;
}

/** Capture the protect-list presentation attrs from a mediaSingle node (nulls for absent). */
export function capturePresentation(mediaSingleNode) {
  if (!mediaSingleNode) return null;
  const ws = mediaSingleNode.attrs || {};
  const media = (mediaSingleNode.content || []).find((c) => c?.type === "media");
  const ma = media?.attrs || {};
  return {
    layout: ws.layout ?? null,
    width: ws.width ?? null,
    widthType: ws.widthType ?? null,
    mediaWidth: ma.width ?? null,
    mediaHeight: ma.height ?? null,
  };
}

/** true when any protect-list attr differs (null-safe exact equality). */
export function presentationDiffers(baseline, current) {
  if (!baseline || !current) return false; // no baseline → no attr protection (legacy seals)
  for (const k of ["layout", "width", "widthType", "mediaWidth", "mediaHeight"]) {
    if ((baseline[k] ?? null) !== (current[k] ?? null)) return true;
  }
  return false;
}

/** Restore the baseline presentation onto the LIVE node (in place). Returns true if mutated. */
export function applyPresentation(mediaSingleNode, baseline) {
  if (!mediaSingleNode || !baseline) return false;
  let changed = false;
  const attrs = { ...(mediaSingleNode.attrs || {}) };
  for (const [key, bKey] of [["layout", "layout"], ["width", "width"], ["widthType", "widthType"]]) {
    const want = baseline[bKey] ?? null;
    const have = attrs[key] ?? null;
    if (want !== have) {
      changed = true;
      if (want === null) delete attrs[key];
      else attrs[key] = want;
    }
  }
  mediaSingleNode.attrs = attrs;
  const media = (mediaSingleNode.content || []).find((c) => c?.type === "media");
  if (media) {
    const mAttrs = { ...(media.attrs || {}) };
    for (const [key, bKey] of [["width", "mediaWidth"], ["height", "mediaHeight"]]) {
      const want = baseline[bKey] ?? null;
      const have = mAttrs[key] ?? null;
      if (want !== have) {
        changed = true;
        if (want === null) delete mAttrs[key];
        else mAttrs[key] = want;
      }
    }
    media.attrs = mAttrs;
  }
  return changed;
}
