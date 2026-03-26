import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

const ThumbnailPreview = ({ artifactId, contentId, mediaType, fileSize, cachedDataUri, onCached }) => {
  const [dataUri, setDataUri] = useState(cachedDataUri || null);
  const [loading, setLoading] = useState(!cachedDataUri);

  useEffect(() => {
    if (cachedDataUri) return;
    invoke("resolve-artifact-preview", { artifactId, contentId, mediaType, fileSize })
      .then((r) => {
        if (r?.dataUri) {
          setDataUri(r.dataUri);
          if (onCached) onCached(r.dataUri);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [artifactId, contentId, cachedDataUri]);

  if (loading) return <div className="card-thumbnail-placeholder">Loading preview...</div>;
  if (!dataUri) return null;
  return <img src={dataUri} alt="Preview" className="card-thumbnail" />;
};

export default ThumbnailPreview;
