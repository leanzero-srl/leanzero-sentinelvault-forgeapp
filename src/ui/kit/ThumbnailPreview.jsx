import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

// F3 (owner feedback 2026-08-27): "the images are not displaying their name inside the document
// … currently it is not predictable who image-20230720-212157.png is". The preview used to be
// available only after expanding a card, so identifying a screenshot meant opening every row in
// turn. It now renders inline on the card as well — which means a page of 20 images asks for 20
// previews at once, and a preview is the whole file as a base64 data URI (up to 5 MB), fetched
// and encoded server-side.
//
// So the requests are queued. At most MAX_IN_FLIGHT run at a time; the rest wait their turn, in
// the order they mounted, which is the order the user reads down the list. Unmounting while
// queued gives the slot straight back rather than spending it on a card nobody is looking at.
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting = [];

function pump() {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const job = waiting.shift();
    if (job.cancelled) continue;
    inFlight++;
    job.run().finally(() => {
      inFlight--;
      pump();
    });
  }
}

function enqueue(run) {
  const job = { run, cancelled: false };
  waiting.push(job);
  pump();
  return () => { job.cancelled = true; };
}

// Previews survive a card collapsing/expanding and a list re-render within one page view.
// Keyed by attachment id; bounded so a long session cannot grow it without limit.
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 60;
function rememberPreview(id, dataUri) {
  if (!id || !dataUri) return;
  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    previewCache.delete(previewCache.keys().next().value);
  }
  previewCache.set(id, dataUri);
}

const ThumbnailPreview = ({ artifactId, contentId, cachedDataUri, onCached, variant = "full", alt, onClick }) => {
  const seed = cachedDataUri || previewCache.get(artifactId) || null;
  const [dataUri, setDataUri] = useState(seed);
  const [loading, setLoading] = useState(!seed);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (seed) return;
    let done = false;
    // it57: bound the spinner — if resolve-artifact-preview HANGS, .finally never fires and the
    // "Loading preview…" placeholder spins forever (the odd surface out; AI-review + realm-scan
    // both have timeouts). Fall back to "Preview unavailable" after 8s. The clock starts when the
    // request does, not when the card mounts, so a card waiting behind the queue is not timed out
    // for other cards' latency.
    let timer = null;
    // SV-SEC-1: mediaType/fileSize are no longer sent. The server used to accept them and skip
    // its own metadata read when mediaType was present, which let a caller claim "image/png"
    // and pull down any file of any size. They are properties of the attachment; the server
    // reads them there now.
    const cancel = enqueue(() => {
      if (done) return Promise.resolve();
      timer = setTimeout(() => { if (!done) { done = true; setLoading(false); setTimedOut(true); } }, 8000);
      return invoke("resolve-artifact-preview", { artifactId, contentId })
        .then((r) => {
          if (done) return;
          if (r?.dataUri) {
            setDataUri(r.dataUri);
            rememberPreview(artifactId, r.dataUri);
            if (onCached) onCached(r.dataUri);
          }
        })
        .catch(() => {})
        .finally(() => { if (!done) { done = true; clearTimeout(timer); setLoading(false); } });
    });
    return () => { done = true; cancel(); if (timer) clearTimeout(timer); };
  }, [artifactId, contentId, seed]);

  // The compact variant sits on the card row in place of the generic file icon. It stays out of
  // the way when there is nothing to show: no placeholder box, no "unavailable" text, because a
  // row of empty dashed rectangles reads as breakage rather than as an absent preview.
  if (variant === "thumb") {
    if (!dataUri) {
      return loading
        ? <span className="card-thumbnail-mini is-loading" aria-hidden="true" />
        : null;
    }
    return (
      <img
        src={dataUri}
        alt={alt || "Preview"}
        className={`card-thumbnail-mini ${onClick ? "is-clickable" : ""}`}
        title={onClick ? `Open ${alt || "this image"}` : (alt || "Preview")}
        onClick={onClick}
      />
    );
  }

  if (loading) return <div className="card-thumbnail-placeholder">Loading preview…</div>;
  if (!dataUri) return timedOut ? <div className="card-thumbnail-placeholder">Preview unavailable</div> : null;
  return <img src={dataUri} alt={alt || "Preview"} className="card-thumbnail" />;
};

export default ThumbnailPreview;
