import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import { flashArtifactSealed, flashArtifactUnsealed } from "../../kit/flash-messages";

// Operator avatar component with fallback
const AvatarFigure = ({ operatorInfo }) => {
  const [imageError, setImageError] = useState(false);

  // Standard operator icon SVG
  const OperatorIcon = () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        borderRadius: "50%",
        backgroundColor: "var(--sv-border-secondary)",
        padding: "2px",
      }}
    >
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill="var(--sv-text-subtle)"
      />
    </svg>
  );

  if (!operatorInfo.profilePicture || imageError) {
    return <OperatorIcon />;
  }

  return (
    <img
      src={operatorInfo.profilePicture}
      alt={operatorInfo.displayName}
      style={{
        width: "16px",
        height: "16px",
        borderRadius: "50%",
      }}
      onError={() => setImageError(true)}
    />
  );
};

// Operator component that fetches operator data via resolver
const OperatorTag = ({ accountId }) => {
  const [operatorInfo, setOperatorInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }

    const fetchOperatorInfo = async () => {
      try {
        const data = await invoke("identify-operator", { accountId });
        setOperatorInfo(data);
      } catch (error) {
        console.error(`Failed to fetch operator info for ${accountId}:`, error);
        setOperatorInfo({ displayName: `User ${accountId.slice(-4)}`, accountId });
      } finally {
        setLoading(false);
      }
    };

    fetchOperatorInfo();
  }, [accountId]);

  if (!accountId) return <span>-</span>;
  if (loading) return <span>Resolving...</span>;
  if (!operatorInfo) return <span>Unknown operator</span>;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
      }}
      title={`${operatorInfo.displayName} (${operatorInfo.accountId})`}
    >
      <AvatarFigure operatorInfo={operatorInfo} />
      {operatorInfo.displayName}
    </span>
  );
};

const ArtifactControlPanel = () => {
  const [currentView, setCurrentView] = useState("page-attachments");
  const [fileList, setFileList] = useState([]);
  const [myReservedFiles, setMyReservedFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mySealsLoading, setMySealsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [orderByField, setOrderByField] = useState("title");
  const [orderDirection, setOrderDirection] = useState("asc");
  const [myFilesOrderField, setMyFilesOrderField] = useState("lockedOn");
  const [myFilesOrderDir, setMyFilesOrderDir] = useState("desc");
  // Page panel settings
  const [panelHidden, setPanelHidden] = useState(false);
  const [panelConfigUpdating, setPanelConfigUpdating] = useState(false);
  const [panelConfigReady, setPanelConfigReady] = useState(false);
  // Track global auto-unlock enabled status
  const [expiryAlertsActive, setExpiryAlertsActive] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Track dispatch request state per artifact
  const [watchStatus, setWatchStatus] = useState({});

  // Pagination state for artifacts tab
  const [moreFilesAvailable, setMoreFilesAvailable] = useState(false);
  const [nextFileCursor, setNextFileCursor] = useState(null);
  const [fetchingMoreFiles, setFetchingMoreFiles] =
    useState(false);

  // Pagination state for my sealed artifacts tab
  const [moreReservedAvailable, setMoreReservedAvailable] = useState(false);
  const [nextReservedCursor, setNextReservedCursor] = useState(null);
  const [fetchingMoreReserved, setFetchingMoreReserved] = useState(false);

  const retrieveFileData = async (append = false, cursorOverride = null) => {
    try {
      setLoading(!append);
      setError(null);
      const cursor = cursorOverride !== null ? cursorOverride : null;
      console.log(
        `[OVERLAY] Fetching artifacts: cursor=${cursor}, append=${append}`,
      );

      const result = await invoke("enumerate-doc-artifacts", {
        cursor,
        limit: 10,
      });

      console.log(
        `[OVERLAY] Got result: hasMore=${result.hasMore}, nextCursor=${result.nextCursor}, count=${result.attachments?.length}`,
      );

      if (append) {
        setFileList((prev) => [...prev, ...(result.attachments || [])]);
      } else {
        setFileList(result.attachments || []);
      }

      // Update both state and refs immediately
      const hasMore = result.hasMore || false;
      const nextCursor = result.nextCursor || null;

      setMoreFilesAvailable(hasMore);
      setNextFileCursor(nextCursor);

      console.log(
        `[OVERLAY] Updated: hasMore=${hasMore}, nextCursor=${nextCursor}`,
      );
    } catch (err) {
      console.error("Failed to fetch artifacts:", err);
      setError("Unable to retrieve files. Please try again.");
      setFileList([]);
    } finally {
      setLoading(false);
    }
  };

  const retrieveMyReservedFiles = async (
    append = false,
    cursorOverride = null,
  ) => {
    try {
      setMySealsLoading(!append);
      setError(null);
      const cursor = cursorOverride !== null ? cursorOverride : null;
      console.log(
        `[OVERLAY] Fetching my sealed artifacts: cursor=${cursor}, append=${append}`,
      );

      const result = await invoke("enumerate-operator-seals", {
        cursor,
        limit: 10,
      });

      console.log(
        `[OVERLAY] Got my seals result: hasMore=${result.hasMore}, nextCursor=${result.nextCursor}, count=${result.attachments?.length}`,
      );

      if (append) {
        setMyReservedFiles((prev) => [
          ...prev,
          ...(result.attachments || []),
        ]);
      } else {
        setMyReservedFiles(result.attachments || []);
      }

      // Update both state and refs immediately
      const hasMore = result.hasMore || false;
      const nextCursor = result.nextCursor || null;

      setMoreReservedAvailable(hasMore);
      setNextReservedCursor(nextCursor);

      console.log(
        `[OVERLAY] Updated my seals: hasMore=${hasMore}, nextCursor=${nextCursor}`,
      );
    } catch (err) {
      console.error("Failed to fetch my sealed artifacts:", err);
      setError("Unable to retrieve your claimed files. Please try again.");
      setMyReservedFiles([]);
    } finally {
      setMySealsLoading(false);
    }
  };

  useEffect(() => {
    // Initialize theme detection and fetch artifacts
    const initializeComponent = async () => {
      await enablePaletteSync();
      await retrieveFileData();

      // Fetch global settings to check auto-unlock status
      try {
        const globalSettings = await invoke("load-policy", {
          scope: "global",
        });
        const enabled = globalSettings?.expiryAlertsActive !== false;
        setExpiryAlertsActive(enabled);
        setSettingsLoaded(true);
      } catch (error) {
        console.warn(
          "Failed to get auto-unlock setting, defaulting to enabled:",
          error,
        );
        setSettingsLoaded(true);
      }

      // Fetch page-level panel settings
      try {
        const panelStatus = await invoke("check-panel-status", { pageId: null });
        setPanelHidden(panelStatus?.widgetHidden === true);
      } catch (error) {
        console.warn("Failed to get panel status:", error);
      } finally {
        setPanelConfigReady(true);
      }
    };
    initializeComponent();
  }, []);

  const fetchNextFilePage = useCallback(async () => {
    console.log(
      `[OVERLAY] fetchNextFilePage called: hasMore=${moreFilesAvailable}, isLoading=${fetchingMoreFiles}, nextCursor=${nextFileCursor}`,
    );

    if (!moreFilesAvailable || fetchingMoreFiles || !nextFileCursor) {
      console.log(`[OVERLAY] fetchNextFilePage skipped - conditions not met`);
      return;
    }

    console.log(
      `[OVERLAY] fetchNextFilePage proceeding with cursor=${nextFileCursor}`,
    );
    setFetchingMoreFiles(true);
    try {
      await retrieveFileData(true, nextFileCursor);
    } catch (error) {
      console.error("Error loading more artifacts:", error);
    } finally {
      setFetchingMoreFiles(false);
    }
  }, [moreFilesAvailable, fetchingMoreFiles, nextFileCursor]);

  const fetchNextReservedPage = useCallback(async () => {
    console.log(
      `[OVERLAY] fetchNextReservedPage called: hasMore=${moreReservedAvailable}, isLoading=${fetchingMoreReserved}, nextCursor=${nextReservedCursor}`,
    );

    if (!moreReservedAvailable || fetchingMoreReserved || !nextReservedCursor) {
      console.log(`[OVERLAY] fetchNextReservedPage skipped - conditions not met`);
      return;
    }

    console.log(
      `[OVERLAY] fetchNextReservedPage proceeding with cursor=${nextReservedCursor}`,
    );
    setFetchingMoreReserved(true);
    try {
      await retrieveMyReservedFiles(true, nextReservedCursor);
    } catch (error) {
      console.error("Error loading more sealed artifacts:", error);
    } finally {
      setFetchingMoreReserved(false);
    }
  }, [moreReservedAvailable, fetchingMoreReserved, nextReservedCursor]);

  // Fetch my sealed artifacts when switching to that tab
  useEffect(() => {
    if (
      currentView === "my-locked-attachments" &&
      myReservedFiles.length === 0 &&
      !mySealsLoading
    ) {
      retrieveMyReservedFiles();
    }
  }, [currentView]);

  const onDismiss = () => {
    view.close();
  };

  const onSecureFile = async (artifactId) => {
    try {
      // Find artifact name for dispatch
      const artifact = fileList.find((att) => att.id === artifactId);
      const artifactName = artifact?.title || "attachment";

      await invoke("seal-artifact", { attachmentId: artifactId });
      await retrieveFileData();

      // Show success flash (Option 1)
      try {
        await flashArtifactSealed(artifactName);
      } catch (notifyErr) {
        // Flash failed, but seal succeeded - continue
      }
    } catch (err) {
      console.error("Failed to seal artifact:", err);
      setError("Could not claim file.");
    }
  };

  const onReleaseFile = async (artifactId) => {
    try {
      // Find artifact name for dispatch
      const artifact = fileList.find((att) => att.id === artifactId);
      const artifactName = artifact?.title || "attachment";

      await invoke("unseal-artifact", { attachmentId: artifactId });
      await retrieveFileData();

      // Show success flash (Option 1)
      try {
        await flashArtifactUnsealed(artifactName);
      } catch (notifyErr) {
        // Flash failed, but unseal succeeded - continue
      }
    } catch (err) {
      console.error("Failed to unseal artifact:", err);
      setError("Could not relinquish file.");
    }
  };

  const onWatchToggle = async (artifactId) => {
    const isCurrentlyRequested = watchStatus[artifactId];

    try {
      if (isCurrentlyRequested) {
        const result = await invoke("unwatch-artifact", {
          attachmentId: artifactId,
        });
        if (result.success) {
          setWatchStatus((prev) => ({ ...prev, [artifactId]: false }));
        }
      } else {
        const result = await invoke("watch-artifact", { attachmentId: artifactId });
        if (result.success) {
          setWatchStatus((prev) => ({ ...prev, [artifactId]: true }));
        }
      }
    } catch (err) {
      console.error("Failed to toggle dispatch:", err);
    }
  };

  // Check dispatch request status for sealed artifacts
  useEffect(() => {
    const checkDispatchStatus = async () => {
      const sealedArtifacts = fileList.filter(
        (att) => att.lockStatus === "HELD",
      );
      for (const att of sealedArtifacts) {
        try {
          const result = await invoke("check-watch", {
            attachmentId: att.id,
          });
          if (result.success) {
            setWatchStatus((prev) => ({
              ...prev,
              [att.id]: result.requested,
            }));
          }
        } catch (err) {
          console.error("Failed to check dispatch status:", err);
        }
      }
    };
    if (fileList.length > 0) {
      checkDispatchStatus();
    }
  }, [fileList]);

  // Expiry dispatch effect - show banner when operator's seals have expired
  useEffect(() => {
    const checkExpiredArtifacts = async () => {
      const expiredArtifacts = fileList.filter((artifact) => {
        if (!artifact.expiresAt || artifact.lockStatus !== "HELD_BY_ACTOR") return false;
        return new Date(artifact.expiresAt) <= new Date();
      });

      if (expiredArtifacts.length > 0) {
        try {
          const { showFlag } = await import("@forge/bridge");
          for (const artifact of expiredArtifacts) {
            showFlag({
              id: "expiry-notice-" + artifact.id,
              title: "Reservation expired",
              description: `Your reservation on "${artifact.title}" has expired. Relinquish it when you are finished.`,
              type: "warning",
              appearance: "warning",
              isAutoDismiss: false,
              actions: [{ text: "Understood", onClick: () => {} }],
            });
          }
        } catch (error) {
          console.warn("Failed to show expiry dispatch:", error);
        }
      }
    };
    checkExpiredArtifacts();
  }, [fileList]);

  const formatRemainingTime = (artifact) => {
    if (!artifact.expiresAt) return "-";
    const expiresDate = new Date(artifact.expiresAt);
    const now = new Date();
    const diffMs = expiresDate - now;

    if (diffMs <= 0) {
      return "Overdue";
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m`;
    }
    return `${diffMinutes}m`;
  };

  const onReorderColumn = (field) => {
    if (orderByField === field) {
      setOrderDirection(orderDirection === "asc" ? "desc" : "asc");
    } else {
      setOrderByField(field);
      setOrderDirection("asc");
    }
  };

  const arrangeFileList = () => {
    return [...fileList].sort((a, b) => {
      let aValue = a[orderByField];
      let bValue = b[orderByField];

      // Handle different field types
      if (orderByField === "title") {
        aValue = aValue?.toLowerCase() || "";
        bValue = bValue?.toLowerCase() || "";
      } else if (orderByField === "lockStatus") {
        // Sort by seal status priority: UNLOCKED < SEALED BY ME < SEALED
        const statusPriority = {
          OPEN: 0,
          "HELD_BY_ACTOR": 1,
          HELD: 2,
        };
        aValue = statusPriority[aValue] || 0;
        bValue = statusPriority[bValue] || 0;
      } else if (orderByField === "expiresAt") {
        // Handle date sorting, treating null/undefined as far future
        aValue = aValue ? new Date(aValue).getTime() : Number.MAX_SAFE_INTEGER;
        bValue = bValue ? new Date(bValue).getTime() : Number.MAX_SAFE_INTEGER;
      }

      if (orderDirection === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  };

  const columnSortIndicator = (field) => {
    if (orderByField !== field) return "↕";
    return orderDirection === "asc" ? "↑" : "↓";
  };

  // Sorting for My Sealed Artifacts tab
  const onReorderMyFiles = (field) => {
    if (myFilesOrderField === field) {
      setMyFilesOrderDir(myFilesOrderDir === "asc" ? "desc" : "asc");
    } else {
      setMyFilesOrderField(field);
      setMyFilesOrderDir("asc");
    }
  };

  const arrangeMyReservedFiles = () => {
    return [...myReservedFiles].sort((a, b) => {
      let aValue = a[myFilesOrderField];
      let bValue = b[myFilesOrderField];

      // Handle different field types
      if (
        myFilesOrderField === "title" ||
        myFilesOrderField === "pageTitle" ||
        myFilesOrderField === "spaceName"
      ) {
        aValue = aValue?.toLowerCase() || "";
        bValue = bValue?.toLowerCase() || "";
      } else if (
        myFilesOrderField === "lockedOn" ||
        myFilesOrderField === "expiresAt"
      ) {
        aValue = aValue ? new Date(aValue).getTime() : Number.MAX_SAFE_INTEGER;
        bValue = bValue ? new Date(bValue).getTime() : Number.MAX_SAFE_INTEGER;
      }

      if (myFilesOrderDir === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  };

  const myFilesSortIndicator = (field) => {
    if (myFilesOrderField !== field) return "↕";
    return myFilesOrderDir === "asc" ? "↑" : "↓";
  };

  const onReleaseMyFile = async (artifactId) => {
    try {
      const artifact = myReservedFiles.find(
        (att) => att.id === artifactId,
      );
      const artifactName = artifact?.title || "attachment";

      await invoke("unseal-artifact", { attachmentId: artifactId });

      // Remove from my sealed artifacts list
      setMyReservedFiles((prev) =>
        prev.filter((att) => att.id !== artifactId),
      );

      // Also refresh page artifacts if on the same page
      await retrieveFileData();

      try {
        await flashArtifactUnsealed(artifactName);
      } catch (notifyErr) {
        // Flash failed, but unseal succeeded
      }
    } catch (err) {
      console.error("Failed to unseal artifact:", err);
      setError("Could not relinquish file.");
    }
  };

  const formatReservedDate = (timestamp) => {
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="modal-container">
      <div className="modal-header">
        <h1 className="modal-title">Sentinel Vault</h1>
        <button onClick={onDismiss} className="modal-close">
          ×
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${currentView === "page-attachments" ? "active" : ""}`}
          onClick={() => setCurrentView("page-attachments")}
        >
          Files on This Page
        </button>
        <button
          className={`tab-button ${currentView === "my-locked-attachments" ? "active" : ""}`}
          onClick={() => setCurrentView("my-locked-attachments")}
        >
          My Claimed Files
        </button>
      </div>

      {/* Inline panel visibility setting */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--sv-border-primary)",
          background: !panelConfigReady
            ? "var(--sv-bg-secondary)"
            : panelHidden
              ? "rgba(222, 53, 11, 0.04)"
              : "rgba(0, 135, 90, 0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "4px",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: !panelConfigReady
                    ? "#97A0AF"
                    : panelHidden
                      ? "#DE350B"
                      : "#00875A",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--sv-text-primary)",
                }}
              >
                {!panelConfigReady
                  ? "Checking inline panel status…"
                  : panelHidden
                    ? "Inline status panel is hidden on this page"
                    : "Inline status panel is visible on this page"}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--sv-text-subtle)",
                paddingLeft: "16px",
              }}
            >
              {!panelConfigReady
                ? "Checking whether the inline status panel is enabled for this page…"
                : panelHidden
                  ? "The status panel that normally appears inside the page content is currently turned off. Visitors to this page will not see file claim information inline. You can still manage claims from this dialog."
                  : "The status panel is displayed inside the page content, allowing all viewers to see which files are claimed and by whom directly on the page."}
            </p>
          </div>
          <button
            disabled={panelConfigUpdating || !panelConfigReady}
            onClick={async () => {
              const newValue = !panelHidden;
              setPanelConfigUpdating(true);
              try {
                await invoke("store-doc-panel-prefs", {
                  pageId: null,
                  widgetHidden: newValue,
                });
                setPanelHidden(newValue);
              } catch (err) {
                console.error("Failed to save panel settings:", err);
              } finally {
                setPanelConfigUpdating(false);
              }
            }}
            style={{
              background: !panelConfigReady
                ? "transparent"
                : panelHidden
                  ? "#00875A"
                  : "transparent",
              color: !panelConfigReady
                ? "var(--sv-text-subtle)"
                : panelHidden
                  ? "#fff"
                  : "var(--sv-text-secondary)",
              border: !panelConfigReady
                ? "1px solid var(--sv-border-secondary)"
                : panelHidden
                  ? "1px solid #00875A"
                  : "1px solid var(--sv-border-secondary)",
              padding: "6px 14px",
              borderRadius: "3px",
              fontSize: "12px",
              cursor: panelConfigUpdating || !panelConfigReady ? "not-allowed" : "pointer",
              opacity: panelConfigUpdating || !panelConfigReady ? 0.6 : 1,
              transition: "all 0.15s",
              fontWeight: 500,
              whiteSpace: "nowrap",
              flexShrink: 0,
              marginTop: "1px",
            }}
          >
            {!panelConfigReady
              ? "Please wait…"
              : panelConfigUpdating
                ? "Updating…"
                : panelHidden
                  ? "Show on this page"
                  : "Hide on this page"}
          </button>
        </div>
      </div>

      <div
        className="modal-body"
        style={{ display: "flex", flexDirection: "column" }}
      >
        {error && <div className="alert-error">{error}</div>}

        {/* Page Artifacts Tab */}
        {currentView === "page-attachments" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {loading && (
              <div className="loading-text">Retrieving files...</div>
            )}

            {!loading && !error && fileList.length === 0 && (
              <div className="alert-info">
                This page has no files attached.
              </div>
            )}

            {!loading && !error && fileList.length > 0 && (
              <div
                className="attachments-tab-content"
                style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th
                        className="sortable"
                        onClick={() => onReorderColumn("title")}
                      >
                        Name {columnSortIndicator("title")}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => onReorderColumn("lockStatus")}
                      >
                        Status {columnSortIndicator("lockStatus")}
                      </th>
                      <th>Held by</th>
                      {settingsLoaded && expiryAlertsActive && (
                        <th
                          className="sortable"
                          onClick={() => onReorderColumn("expiresAt")}
                        >
                          Lapses {columnSortIndicator("expiresAt")}
                        </th>
                      )}
                      <th>Watch for Relinquish</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="attachment-list">
                    {arrangeFileList().map((artifact) => (
                      <tr key={artifact.id}>
                        <td>{artifact.title}</td>
                        <td>
                          <span
                            className={`status-badge ${
                              artifact.lockStatus === "HELD"
                                ? "locked"
                                : artifact.lockStatus === "HELD_BY_ACTOR"
                                  ? "locked-by-me"
                                  : "unlocked"
                            }`}
                          >
                            {artifact.lockStatus || "OPEN"}
                          </span>
                        </td>
                        <td>
                          {artifact.lockStatus === "HELD_BY_ACTOR" ? (
                            "You"
                          ) : artifact.lockStatus === "HELD" &&
                            artifact.lockedByAccountId ? (
                            <OperatorTag
                              accountId={artifact.lockedByAccountId}
                            />
                          ) : artifact.lockStatus === "HELD" ? (
                            "Someone else"
                          ) : (
                            "-"
                          )}
                        </td>
                        {settingsLoaded && expiryAlertsActive && (
                          <td
                            style={{
                              color: artifact.isExpired
                                ? "var(--sv-text-subtle)"
                                : "var(--sv-text-subtle)",
                              fontStyle: artifact.isExpired
                                ? "italic"
                                : "normal",
                            }}
                          >
                            {formatRemainingTime(artifact)}
                          </td>
                        )}
                        <td>
                          {artifact.lockStatus === "HELD" && (
                            <button
                              onClick={() => onWatchToggle(artifact.id)}
                              style={{
                                backgroundColor: watchStatus[artifact.id]
                                  ? "var(--sv-interactive-success)"
                                  : "var(--sv-bg-tertiary)",
                                color: watchStatus[artifact.id]
                                  ? "var(--sv-text-inverse)"
                                  : "var(--sv-text-primary)",
                                border: watchStatus[artifact.id]
                                  ? "1px solid var(--sv-interactive-success)"
                                  : "1px solid var(--sv-border-secondary)",
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                cursor: "pointer",
                                fontWeight: 500,
                                transition: "all 0.2s ease",
                              }}
                              title={
                                watchStatus[artifact.id]
                                  ? "Stop watching"
                                  : "Get alerted when relinquished"
                              }
                            >
                              {watchStatus[artifact.id]
                                ? "Watching"
                                : "Watch"}
                            </button>
                          )}
                        </td>
                        <td>
                          {artifact.lockStatus === "OPEN" && (
                            <button
                              onClick={() => onSecureFile(artifact.id)}
                              className="btn btn-primary"
                            >
                              Claim
                            </button>
                          )}
                          {artifact.lockStatus === "HELD_BY_ACTOR" && (
                            <button
                              onClick={() => onReleaseFile(artifact.id)}
                              className="btn btn-warning"
                            >
                              Relinquish
                            </button>
                          )}
                          {artifact.lockStatus === "HELD" && (
                            <button
                              className="btn btn-subtle"
                              disabled
                              title="This file is held by someone else"
                            >
                              Claimed
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(fetchingMoreFiles || moreFilesAvailable) && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: "20px",
                    }}
                  >
                    {fetchingMoreFiles ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          color: "var(--sv-text-subtle)",
                        }}
                      >
                        <div
                          className="loading-spinner"
                          style={{
                            width: "16px",
                            height: "16px",
                            margin: "0 8px 0 0",
                          }}
                        ></div>
                        Fetching additional files...
                      </div>
                    ) : (
                      <button
                        onClick={fetchNextFilePage}
                        style={{
                          backgroundColor: "var(--sv-interactive-primary)",
                          color: "var(--sv-text-inverse)",
                          border: "none",
                          padding: "8px 16px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          cursor: "pointer",
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary)";
                        }}
                      >
                        Show more files
                      </button>
                    )}
                  </div>
                )}
                {!moreFilesAvailable && fileList.length > 0 && !loading && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "16px",
                      color: "var(--sv-text-subtle)",
                      fontStyle: "italic",
                      fontSize: "12px",
                    }}
                  >
                    End of file list
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* My Sealed Artifacts Tab */}
        {currentView === "my-locked-attachments" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {mySealsLoading && (
              <div className="loading-text">
                Retrieving your claimed files...
              </div>
            )}

            {!mySealsLoading && !error && myReservedFiles.length === 0 && (
              <div className="alert-info">
                You have no claimed files anywhere in Confluence.
              </div>
            )}

            {!mySealsLoading && !error && myReservedFiles.length > 0 && (
              <div
                className="my-locks-tab-content"
                style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th
                        className="sortable"
                        onClick={() => onReorderMyFiles("title")}
                      >
                        Name {myFilesSortIndicator("title")}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => onReorderMyFiles("pageTitle")}
                      >
                        Location {myFilesSortIndicator("pageTitle")}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => onReorderMyFiles("spaceName")}
                      >
                        Space {myFilesSortIndicator("spaceName")}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => onReorderMyFiles("lockedOn")}
                      >
                        Claimed on {myFilesSortIndicator("lockedOn")}
                      </th>
                      {settingsLoaded && expiryAlertsActive && (
                        <th
                          className="sortable"
                          onClick={() => onReorderMyFiles("expiresAt")}
                        >
                          Lapses {myFilesSortIndicator("expiresAt")}
                        </th>
                      )}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="attachment-list">
                    {arrangeMyReservedFiles().map((artifact) => (
                      <tr key={artifact.id}>
                        <td>{artifact.title}</td>
                        <td>
                          {artifact.pageUrl ? (
                            <a
                              href={artifact.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "var(--sv-interactive-primary)",
                                textDecoration: "none",
                              }}
                              title={`Open ${artifact.pageTitle}`}
                            >
                              {artifact.pageTitle}
                            </a>
                          ) : (
                            artifact.pageTitle
                          )}
                        </td>
                        <td>
                          {artifact.spaceName || artifact.spaceKey || "-"}
                        </td>
                        <td>{formatReservedDate(artifact.lockedOn)}</td>
                        {settingsLoaded && expiryAlertsActive && (
                          <td
                            style={{
                              color: artifact.isExpired
                                ? "var(--sv-text-subtle)"
                                : "var(--sv-text-subtle)",
                              fontStyle: artifact.isExpired
                                ? "italic"
                                : "normal",
                            }}
                          >
                            {formatRemainingTime(artifact)}
                          </td>
                        )}
                        <td>
                          <button
                            onClick={() =>
                              onReleaseMyFile(artifact.id)
                            }
                            className="btn btn-warning"
                          >
                            Relinquish
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(fetchingMoreReserved || moreReservedAvailable) && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: "20px",
                    }}
                  >
                    {fetchingMoreReserved ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          color: "var(--sv-text-subtle)",
                        }}
                      >
                        <div
                          className="loading-spinner"
                          style={{
                            width: "16px",
                            height: "16px",
                            margin: "0 8px 0 0",
                          }}
                        ></div>
                        Fetching additional claimed files...
                      </div>
                    ) : (
                      <button
                        onClick={fetchNextReservedPage}
                        style={{
                          backgroundColor: "var(--sv-interactive-primary)",
                          color: "var(--sv-text-inverse)",
                          border: "none",
                          padding: "8px 16px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          cursor: "pointer",
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary)";
                        }}
                      >
                        Show more claimed files
                      </button>
                    )}
                  </div>
                )}
                {!moreReservedAvailable &&
                  myReservedFiles.length > 0 &&
                  !mySealsLoading && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "16px",
                        color: "var(--sv-text-subtle)",
                        fontStyle: "italic",
                        fontSize: "12px",
                      }}
                    >
                      All claimed files displayed
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button
          onClick={() =>
            currentView === "page-attachments"
              ? retrieveFileData()
              : retrieveMyReservedFiles()
          }
          className="btn btn-subtle btn-footer"
        >
          Reload
        </button>
        <button onClick={onDismiss} className="btn btn-primary btn-footer">
          Done
        </button>
      </div>
    </div>
  );
};

// Render the overlay
function renderApp() {
  const container = document.getElementById("root");
  if (container) {
    const root = createRoot(container);
    root.render(<ArtifactControlPanel />);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderApp);
} else {
  renderApp();
}
