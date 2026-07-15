import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

const ThumbnailPreview = ({ artifactId, contentId, mediaType, fileSize, cachedDataUri, onCached }) => {
  const [dataUri, setDataUri] = useState(cachedDataUri || null);
  const [loading, setLoading] = useState(!cachedDataUri);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (cachedDataUri) return;
    let done = false;
    // it57: bound the spinner — if resolve-artifact-preview HANGS, .finally never fires and the
    // "Loading preview…" placeholder spins forever (the odd surface out; AI-review + realm-scan
    // both have timeouts). Fall back to "Preview unavailable" after 8s.
    const timer = setTimeout(() => { if (!done) { done = true; setLoading(false); setTimedOut(true); } }, 8000);
    invoke("resolve-artifact-preview", { artifactId, contentId, mediaType, fileSize })
      .then((r) => {
        if (done) return;
        if (r?.dataUri) {
          setDataUri(r.dataUri);
          if (onCached) onCached(r.dataUri);
        }
      })
      .catch(() => {})
      .finally(() => { if (!done) { done = true; clearTimeout(timer); setLoading(false); } });
    return () => { clearTimeout(timer); };
  }, [artifactId, contentId, cachedDataUri]);

  if (loading) return <div className="card-thumbnail-placeholder">Loading preview…</div>;
  if (!dataUri) return timedOut ? <div className="card-thumbnail-placeholder">Preview unavailable</div> : null;
  return <img src={dataUri} alt="Preview" className="card-thumbnail" />;
};

export default ThumbnailPreview;
