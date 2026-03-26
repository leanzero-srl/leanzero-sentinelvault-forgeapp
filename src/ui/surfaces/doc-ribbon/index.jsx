/**
 * Document Ribbon — Primary UI Surface
 *
 * Always-visible ribbon on every Confluence page.
 * Shows artifact seal count and a button to open the full management overlay.
 * Also displays conflict/expiry alerts when relevant.
 */

import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, Modal } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";

const DocumentRibbon = () => {
  const [sealedCount, setSealedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchArtifactStats = useCallback(async () => {
    try {
      const result = await invoke("enumerate-doc-artifacts", { cursor: null, limit: 50 });
      const artifacts = result?.attachments || [];
      setTotalCount(artifacts.length);
      setSealedCount(
        artifacts.filter(
          (f) => f.lockStatus === "HELD" || f.lockStatus === "HELD_BY_ACTOR",
        ).length,
      );
    } catch (err) {
      console.error("Failed to fetch artifact stats:", err);
    }
  }, []);

  const fetchAlerts = useCallback(async (pageId, operatorId) => {
    try {
      const result = await invoke("recent-dispatches", { pageId });
      if (result?.success && result.dispatches?.length > 0) {
        const relevant = result.dispatches.filter(
          (n) => n.ownerAccountId === operatorId || n.editorAccountId === operatorId,
        );
        setAlerts(relevant);
      } else {
        setAlerts([]);
      }
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        await enablePaletteSync();

        const context = await view.getContext();
        const pageId = context?.extension?.content?.id || context?.contentId;
        const contentType = context?.extension?.content?.type;
        const location = context?.extension?.location || "";
        const operatorId = context?.accountId;

        // Only show ribbon on actual content pages (not space apps, settings, or admin pages)
        const isSpaceAppPage = location.includes("/apps/") || location.includes("/settings/");
        const isContentPage = contentType === "page" || contentType === "blogpost";
        if (!pageId || isSpaceAppPage || (contentType && !isContentPage)) {
          setLoading(false);
          return;
        }

        await fetchArtifactStats();

        if (operatorId) {
          await fetchAlerts(pageId, operatorId);
        }
      } catch (err) {
        console.error("Ribbon init error:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchArtifactStats, fetchAlerts]);

  // Poll for seal changes made in other surfaces (inline panel, overlay)
  useEffect(() => {
    if (loading || totalCount === 0) return;
    let lastStamp = null;
    const poll = async () => {
      try {
        const { stamp } = await invoke("check-seal-stamp");
        if (lastStamp !== null && stamp !== lastStamp) {
          fetchArtifactStats();
        }
        lastStamp = stamp;
      } catch (e) {
        // Polling failures are non-critical
      }
    };
    const interval = setInterval(poll, 5000);
    poll();
    return () => clearInterval(interval);
  }, [loading, totalCount, fetchArtifactStats]);

  const openManageOverlay = useCallback(() => {
    const overlay = new Modal({
      resource: "overlay",
      size: "max",
      onClose: () => {
        fetchArtifactStats();
      },
    });
    overlay.open();
  }, [fetchArtifactStats]);

  const dismissAlert = useCallback(
    async (alertId) => {
      try {
        await invoke("acknowledge-dispatch", { dispatchId: alertId });
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      } catch (err) {
        console.error("Failed to dismiss alert:", err);
      }
    },
    [],
  );

  // Hide ribbon entirely when the page has no artifacts (only after loading)
  if (!loading && totalCount === 0 && alerts.length === 0) {
    return null;
  }

  const primaryAlert = alerts.length > 0 ? alerts[0] : null;

  return (
    <div>
      {/* Main ribbon bar */}
      <div className="ribbon-bar">
        <div className="ribbon-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>

        <span className="ribbon-title">Sentinel Vault</span>

        <span className="ribbon-status">
          {loading ? (
            <span className="ribbon-loading-bar" />
          ) : sealedCount > 0
            ? `${sealedCount} artifact${sealedCount !== 1 ? "s" : ""} sealed on this page`
            : totalCount > 0
              ? `${totalCount} attachment${totalCount !== 1 ? "s" : ""} on this page — none sealed`
              : "No attachments on this page"}
        </span>

        <button className="ribbon-action" onClick={openManageOverlay}>
          Manage Artifacts
        </button>
      </div>

      {/* Alert section */}
      {primaryAlert && (
        <div className="ribbon-alert">
          <div className="ribbon-alert-item">
            <span className="ribbon-alert-icon">⚠</span>
            <div className="ribbon-alert-text">
              {primaryAlert.type === "SEAL_CONFLICT" && (
                <>
                  <strong>{primaryAlert.editorDisplayName}</strong> tried to
                  modify <strong>{primaryAlert.artifactName}</strong> which
                  is held by{" "}
                  <strong>{primaryAlert.ownerDisplayName}</strong>. The
                  modification was automatically rolled back.
                </>
              )}
              {primaryAlert.type === "SEAL_EXPIRED" && (
                <>
                  Your seal on{" "}
                  <strong>{primaryAlert.artifactName}</strong> is overdue.
                  Use the unseal button when you are done.
                </>
              )}
              {alerts.length > 1 && (
                <span className="sv-text-subtle" style={{ fontSize: "11px", marginLeft: "8px" }}>
                  + {alerts.length - 1} more
                </span>
              )}
            </div>

            <button
              className="ribbon-alert-dismiss"
              onClick={() => dismissAlert(primaryAlert.id)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Mount
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<DocumentRibbon />);
}
