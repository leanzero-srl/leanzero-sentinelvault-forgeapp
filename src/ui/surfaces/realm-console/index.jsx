// src/ui/surfaces/realm-console/index.jsx

import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import logo from "../../assets/icons/icon.png";

const SkeletonRow = ({ cols = 5 }) => (
  <tr className="skeleton-row">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i}><span className="skeleton-bar skeleton-cell" /></td>
    ))}
  </tr>
);

const SkeletonDropdownItem = () => (
  <div className="skeleton-dropdown-item">
    <span className="skeleton-bar skeleton-avatar" />
    <span className="skeleton-bar skeleton-name" />
  </div>
);

const SkeletonCard = () => (
  <div className="artifact-card" style={{ opacity: 0.5 }}>
    <div className="card-row card-row-primary">
      <span className="card-filename"><span className="skeleton-bar" style={{ width: "60%", height: 14 }} /></span>
      <span className="card-row-right"><span className="skeleton-bar" style={{ width: 60, height: 20, borderRadius: 9999 }} /></span>
    </div>
    <div className="card-row card-row-secondary" style={{ marginTop: 4 }}>
      <span className="skeleton-bar" style={{ width: "40%", height: 10 }} />
    </div>
  </div>
);

const ArtifactTypeIcon = ({ mediaType }) => {
  const isImage = mediaType?.startsWith("image/");
  const isPdf = mediaType === "application/pdf";
  const color = isImage ? "#36B37E" : isPdf ? "#FF5630" : "var(--sv-text-subtle)";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="file-icon">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke={color} strokeWidth="1.5" />
      <polyline points="14,2 14,8 20,8" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const ColumnPicker = ({ columns, visible, onChange, isOpen, onToggle }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onToggle(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);

  return (
    <div className="column-picker" ref={ref}>
      <button
        className="column-picker-trigger"
        onClick={() => onToggle(!isOpen)}
        title="Choose which columns to display"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Properties
      </button>
      {isOpen && (
        <div className="column-picker-dropdown">
          {columns.map((col) => (
            <label key={col.key} className="column-picker-option">
              <input
                type="checkbox"
                checked={!!visible[col.key]}
                disabled={col.alwaysOn}
                onChange={() => onChange(col.key)}
              />
              <span>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const REALM_COLUMNS = [
  { key: "name",     label: "Name",      defaultOn: true, alwaysOn: true },
  { key: "status",   label: "Status",    defaultOn: true },
  { key: "sealedBy", label: "Sealed by", defaultOn: true },
  { key: "location", label: "Location",  defaultOn: true },
  { key: "fileSize", label: "File Size", defaultOn: false },
  { key: "sealedOn", label: "Sealed on", defaultOn: false },
  { key: "lapses",   label: "Lapses",    defaultOn: true },
  { key: "actions",  label: "Actions",   defaultOn: true, alwaysOn: true },
];

const REALM_SORT_FIELDS = [
  { key: "title", label: "Name" },
  { key: "lockedBy", label: "Sealed by" },
  { key: "pageTitle", label: "Location" },
  { key: "lockedOn", label: "Sealed on" },
  { key: "expiresAt", label: "Lapses" },
];

const buildDefaults = (cols) =>
  cols.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultOn }), {});

const SortPicker = ({ orderField, orderDir, onSort }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);

  const fields = REALM_SORT_FIELDS;
  const currentLabel = fields.find(f => f.key === orderField)?.label || "Name";
  const arrow = orderDir === "asc" ? "\u2191" : "\u2193";

  return (
    <div className="sort-picker" ref={ref}>
      <button className="column-picker-trigger" onClick={() => setIsOpen(!isOpen)} title="Change sort order">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" />
        </svg>
        {currentLabel} {arrow}
      </button>
      {isOpen && (
        <div className="column-picker-dropdown">
          {fields.map((f) => (
            <div
              key={f.key}
              className={`column-picker-option ${f.key === orderField ? "selected" : ""}`}
              style={{ cursor: "pointer", fontWeight: f.key === orderField ? 600 : 400 }}
              onClick={() => { onSort(f.key); setIsOpen(false); }}
            >
              <span>{f.label}</span>
              {f.key === orderField && <span style={{ marginLeft: "auto", fontSize: "11px" }}>{arrow}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RealmClaimedCard = ({ artifact, onForceRelease, onWatch, isWatching, forceReleaseActive, visibleColumns, busyAction }) => {
  const statusClass = artifact.isExpired ? "expired" : "locked";
  const statusText = artifact.isExpired ? "Overdue" : "Sealed";

  const vc = visibleColumns || {};

  const metaItems = [];
  if (vc.sealedBy !== false && artifact.lockedBy) metaItems.push(
    <span key="owner" className="card-meta-owner">
      <span className="card-meta-owner-label">Sealed by</span>
      <span>{artifact.lockedBy}</span>
    </span>
  );
  if (vc.location !== false && artifact.pageTitle) metaItems.push(<span key="loc" className="card-meta-item">{artifact.pageTitle}</span>);
  if (vc.fileSize !== false && artifact.fileSize) metaItems.push(<span key="size" className="card-meta-item">{artifact.fileSize}</span>);
  if (vc.sealedOn !== false && artifact.lockedOn) {
    const d = new Date(artifact.lockedOn);
    metaItems.push(<span key="date" className="card-meta-item">{d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>);
  }
  // Lapses
  if (vc.lapses !== false && artifact.expiresAt) {
    const now = new Date();
    const exp = new Date(artifact.expiresAt);
    const diff = exp - now;
    if (diff > 0) {
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      metaItems.push(<span key="lapses" className="card-meta-item">{hours}h {mins}m</span>);
    } else {
      metaItems.push(<span key="lapses" className="card-meta-item" style={{ color: "var(--sv-status-warning)" }}>Overdue</span>);
    }
  }

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <ArtifactTypeIcon mediaType={artifact.mediaType} />
          <span className="card-filename-text">{artifact.title}</span>
        </span>
        <span className="card-row-right">
          {vc.status !== false && (
            <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          )}
          {vc.actions !== false && forceReleaseActive && onForceRelease && (
            <button className={`action-btn unlock ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => onForceRelease(artifact.id)} disabled={busyAction && busyAction !== "unseal"} title="Override the seal as a steward and release this file">
              {busyAction === "unseal" ? <>Unsealing<span className="btn-busy-bar" /></> : "Force Unseal"}
            </button>
          )}
        </span>
      </div>
      {metaItems.length > 0 && (
        <div className="card-row card-row-secondary">
          <span className="card-secondary-left">
            <span className="card-meta">
              {metaItems.reduce((acc, item, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`} className="card-meta-sep">&middot;</span>);
                acc.push(item);
                return acc;
              }, [])}
            </span>
          </span>
          <span className="card-secondary-right">
            {onWatch && (
              <button className={`action-btn watch ${isWatching ? "watching" : ""} ${busyAction === "watch" ? "is-busy" : ""}`} onClick={() => onWatch(artifact.id)} disabled={busyAction && busyAction !== "watch"} title={isWatching ? "Stop watching this file" : "Get notified when this file is unsealed"}>
                {busyAction === "watch" ? <>Updating<span className="btn-busy-bar" /></> : (isWatching ? "Watching" : "Watch")}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

const MyClaimedCard = ({ artifact, onRelease, busyAction }) => {
  const isExpired = artifact.isExpired || (artifact.expiresAt && new Date(artifact.expiresAt) < new Date());
  const statusClass = isExpired ? "expired" : "locked-by-me";
  const statusText = isExpired ? "Overdue" : "My Reservation";

  const metaItems = [];
  if (artifact.pageTitle) metaItems.push(<span key="loc" className="card-meta-item">{artifact.pageTitle}</span>);
  if (artifact.spaceName || artifact.spaceKey) metaItems.push(<span key="space" className="card-meta-item">{artifact.spaceName || artifact.spaceKey}</span>);
  if (artifact.lockedOn) {
    const d = new Date(artifact.lockedOn);
    metaItems.push(<span key="date" className="card-meta-item">{d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>);
  }
  if (artifact.expiresAt) {
    const now = new Date();
    const exp = new Date(artifact.expiresAt);
    const diff = exp - now;
    if (diff > 0) {
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      metaItems.push(<span key="lapses" className="card-meta-item">{hours}h {mins}m</span>);
    }
  }

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <ArtifactTypeIcon mediaType={artifact.mediaType} />
          <span className="card-filename-text">{artifact.title}</span>
        </span>
        <span className="card-row-right">
          <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          {onRelease && (
            <button className={`action-btn unlock ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => onRelease(artifact.id)} disabled={busyAction && busyAction !== "unseal"} title="Release your seal and allow others to modify this file">
              {busyAction === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Relinquish"}
            </button>
          )}
        </span>
      </div>
      {metaItems.length > 0 && (
        <div className="card-row card-row-secondary">
          <span className="card-secondary-left">
            <span className="card-meta">
              {metaItems.reduce((acc, item, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`} className="card-meta-sep">&middot;</span>);
                acc.push(item);
                return acc;
              }, [])}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

const RealmPolicyDashboard = () => {
  const [activeTab, setActiveTab] = useState("my-claims");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [realmKey, setRealmKey] = useState(null);
  const [realmId, setRealmId] = useState(null);
  const [realmName, setRealmName] = useState("Current Space");

  const [realmPrefs, setRealmPrefs] = useState({
    activation: "use-system-default",
    autoUnlockTimeoutHours: null,
    adminUsers: [],
    adminGroups: [],
  });

  const [reservedFiles, setReservedFiles] = useState([]);
  // New state for fetched teams
  const [teamList, setTeamList] = useState([]);
  // Operator search state
  const [operatorQuery, setOperatorQuery] = useState("");
  const [operatorResults, setOperatorResults] = useState([]);
  const [isSearchingOperators, setIsSearchingOperators] = useState(false);
  const [showOperatorDropdown, setShowOperatorDropdown] = useState(false);
  // Teams custom dropdown state
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [teamSearchTerm, setTeamSearchTerm] = useState("");
  // Activation dropdown state
  const [showActivationDropdown, setShowActivationDropdown] = useState(false);
  // Steward override state
  const [forceReleaseActive, setForceReleaseActive] = useState(true);
  // Track global auto-unlock enabled status
  const [systemExpiryAlertsActive, setSystemExpiryAlertsActive] = useState(true);
  // Track dispatch request state per artifact
  const [watchStatus, setWatchStatus] = useState({});
  // Track which artifact + action is currently in flight
  const [busyAction, setBusyAction] = useState(null);

  // Pagination state for sealed artifacts
  const [moreFilesAvailable, setMoreFilesAvailable] = useState(false);
  const [nextFileCursor, setNextFileCursor] = useState(null);
  const [fetchingMoreFiles, setFetchingMoreFiles] =
    useState(false);

  // Pagination state for operators (initial load and search)
  const [hasMoreOperators, setHasMoreOperators] = useState(false);
  const [nextOperatorsStart, setNextOperatorsStart] = useState(null);
  const [isLoadingMoreOperators, setIsLoadingMoreOperators] = useState(false);
  const [currentSearchQuery, setCurrentSearchQuery] = useState("");

  // Pagination state for teams
  const [hasMoreTeams, setHasMoreTeams] = useState(false);
  const [nextTeamsStart, setNextTeamsStart] = useState(null);
  const [isLoadingMoreTeams, setIsLoadingMoreTeams] = useState(false);

  // Page size selector for sealed artifacts
  const [artifactsPageSize, setArtifactsPageSize] = useState(10);

  // Background scan state
  const [scanStatus, setScanStatus] = useState(null); // null | "queued" | "processing" | "completed" | "failed"
  const [isScanning, setIsScanning] = useState(false);

  // Column/sort picker state
  const [realmVisibleColumns, setRealmVisibleColumns] = useState(buildDefaults(REALM_COLUMNS));
  const [realmColumnPickerOpen, setRealmColumnPickerOpen] = useState(false);
  const [realmSortField, setRealmSortField] = useState("title");
  const [realmSortDir, setRealmSortDir] = useState("asc");

  // Steward search toggle state
  const [showOperatorSearch, setShowOperatorSearch] = useState(false);
  const [showGuildSearch, setShowGuildSearch] = useState(false);

  // Role and my-claims state
  const [userRole, setUserRole] = useState("user");
  const [myClaimedFiles, setMyClaimedFiles] = useState([]);
  const [myClaimsLoading, setMyClaimsLoading] = useState(false);
  const [stewardRequestSent, setStewardRequestSent] = useState(false);
  // "none" | "pending" | "denied"
  const [stewardRequestStatus, setStewardRequestStatus] = useState("none");
  const [stewardRequestDeniedAt, setStewardRequestDeniedAt] = useState(null);

  // Pending steward requests (steward-only)
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingRequestsLoading, setPendingRequestsLoading] = useState(false);
  const [requestActionBusy, setRequestActionBusy] = useState(null); // { id: accountId, action: "approve"|"deny" }

  useEffect(() => {
    const bootstrapRealm = async () => {
      try {
        // Initialize theme detection
        await enablePaletteSync();

        setLoading(true);
        const context = await view.getContext();

        // ACTUAL structure from real context output: context.extension.space.key
        const realmKeyValue = context?.extension?.space?.key;
        const realmIdValue = context?.extension?.space?.id;

        if (realmKeyValue && realmIdValue) {
          setRealmKey(realmKeyValue);
          setRealmId(realmIdValue);

          // Get realm name from Confluence API since it's not in context
          try {
            const realmResponse = await invoke("identify-realm", {
              spaceKey: realmKeyValue,
            });
            setRealmName(realmResponse?.name || "Current Space");
          } catch (err) {
            console.warn("Failed to get realm name, using default");
            setRealmName("Current Space");
          }

          // Check user role
          try {
            const roleResult = await invoke("check-user-role", { spaceKey: realmKeyValue });
            if (roleResult?.role === "steward") {
              setUserRole("steward");
              setActiveTab("locked-attachments");
              // Pre-fetch pending steward requests so the badge count shows immediately
              try {
                const reqResult = await invoke("list-steward-requests", { spaceKey: realmKeyValue });
                setPendingRequests(reqResult?.requests || []);
              } catch (e) { /* non-critical */ }
            } else {
              setUserRole("user");
              setActiveTab("my-claims");
              fetchMyClaimedFiles();
              // Check if this user already has a pending or denied steward request
              try {
                const reqCheck = await invoke("check-steward-request", { spaceKey: realmKeyValue });
                if (reqCheck?.status === "pending") {
                  setStewardRequestSent(true);
                  setStewardRequestStatus("pending");
                } else if (reqCheck?.status === "denied") {
                  setStewardRequestStatus("denied");
                  setStewardRequestDeniedAt(reqCheck.deniedAt);
                }
              } catch (e) { /* non-critical */ }
            }
          } catch (err) {
            console.warn("Failed to check user role, defaulting to user");
            setUserRole("user");
            setActiveTab("my-claims");
          }

          // Fetch global settings to check auto-unlock status
          const globalSettings = await invoke("load-policy", {
            scope: "global",
          });
          setSystemExpiryAlertsActive(
            globalSettings?.autoUnlockEnabled !== false,
          );

          const settings = await invoke("load-policy", {
            scope: "space",
            key: realmKeyValue,
          });

          setRealmPrefs({
            activation: settings?.activation || "use-system-default",
            autoUnlockTimeoutHours: settings?.autoUnlockTimeoutHours || null,
            adminUsers: settings?.adminUsers || [],
            adminGroups: settings?.adminGroups || [],
            autoInsertMacro: settings?.autoInsertMacro !== false,
          });
          await fetchReservedFiles(realmKeyValue, realmIdValue);

          // AUTOMATICALLY fetch all teams from Confluence when page loads
          await fetchAllTeams();

          // Load initial operators for dropdown
          await fetchInitialOperators();

          // Check if steward override is enabled
          await checkStewardOverrideStatus();

          // Fetch my claimed files for default tab
          await fetchMyClaimedFiles();
        } else {
          console.error("No realm key found in context.extension.space.key");
          console.error("Extension object:", context?.extension);
          setMessage(
            "Unable to determine realm identifier. Review console for specifics.",
          );
          setMessageType("error");
        }
      } catch (err) {
        console.error("Failed to initialize realm console:", err);
        setMessage(`Realm settings could not be loaded: ${err.message}`);
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    };

    bootstrapRealm();
  }, []);

  const fetchAllTeams = async (append = false, startOverride = null) => {
    try {
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("enumerate-teams", {
        start,
        limit: 200,
      });

      if (append) {
        setTeamList((prev) => [...prev, ...(result.groups || [])]);
      } else {
        setTeamList(result.groups || []);
      }

      setHasMoreTeams(result.hasMore || false);
      setNextTeamsStart(result.nextStart || null);
    } catch (error) {
      setMessage(`Unable to fetch guild list: ${error.message}`);
      setMessageType("error");
    }
  };

  const fetchInitialOperators = async (append = false, startOverride = null) => {
    try {
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("enumerate-operators", {
        start,
        limit: 10,
      });

      if (append) {
        setOperatorResults((prev) => [...prev, ...(result.users || [])]);
      } else {
        setOperatorResults(result.users || []);
      }

      setHasMoreOperators(result.hasMore || false);
      setNextOperatorsStart(result.nextStart || null);
    } catch (error) {
      // Silent fail - operator can still search manually
    }
  };

  const checkStewardOverrideStatus = async () => {
    try {
      const result = await invoke("steward-override-enabled");
      setForceReleaseActive(result.enabled);
    } catch (error) {
      setForceReleaseActive(false);
    }
  };

  const fetchMyClaimedFiles = async () => {
    setMyClaimsLoading(true);
    try {
      const result = await invoke("enumerate-operator-seals", { cursor: null, limit: 50 });
      setMyClaimedFiles(result?.attachments || []);
    } catch (e) {
      console.error("Failed to fetch my claims:", e);
    } finally {
      setMyClaimsLoading(false);
    }
  };

  const [stewardRequestBusy, setStewardRequestBusy] = useState(false);

  const handleRequestSteward = async () => {
    setStewardRequestBusy(true);
    try {
      await invoke("request-steward-access", { spaceKey: realmKey });
      setStewardRequestSent(true);
    } catch (e) {
      console.error("Steward request failed:", e);
    } finally {
      setStewardRequestBusy(false);
    }
  };

  const fetchPendingRequests = async () => {
    if (!realmKey) return;
    setPendingRequestsLoading(true);
    try {
      const result = await invoke("list-steward-requests", { spaceKey: realmKey });
      setPendingRequests(result?.requests || []);
    } catch (e) {
      console.error("Failed to fetch steward requests:", e);
    } finally {
      setPendingRequestsLoading(false);
    }
  };

  const handleApproveRequest = async (requestAccountId) => {
    setRequestActionBusy({ id: requestAccountId, action: "approve" });
    try {
      const result = await invoke("approve-steward-request", { requestAccountId, spaceKey: realmKey });
      if (result?.success) {
        setPendingRequests((prev) => prev.filter((r) => r.accountId !== requestAccountId));
        // Reload realm settings so the new steward appears in the Stewards grid
        try {
          const refreshed = await invoke("load-policy", { scope: "space", key: realmKey });
          setRealmPrefs((prev) => ({ ...prev, adminUsers: refreshed?.adminUsers || prev.adminUsers }));
        } catch (e) { /* non-critical */ }
        setMessage("Steward access granted.");
        setMessageType("success");
      } else {
        setMessage(result?.reason || "Failed to approve request.");
        setMessageType("error");
      }
    } catch (e) {
      console.error("Approve request failed:", e);
      setMessage("Failed to approve request.");
      setMessageType("error");
    } finally {
      setRequestActionBusy(null);
    }
  };

  const handleDenyRequest = async (requestAccountId) => {
    setRequestActionBusy({ id: requestAccountId, action: "deny" });
    try {
      await invoke("deny-steward-request", { requestAccountId, spaceKey: realmKey });
      setPendingRequests((prev) => prev.filter((r) => r.accountId !== requestAccountId));
      setMessage("Request denied.");
      setMessageType("success");
    } catch (e) {
      console.error("Deny request failed:", e);
    } finally {
      setRequestActionBusy(null);
    }
  };

  // Infinite scroll detection for sealed artifacts with debouncing
  useEffect(() => {
    let scrollContainer = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!scrollContainer) return;
        if (!moreFilesAvailable || fetchingMoreFiles) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

        // Load more when operator scrolls within 100px of bottom
        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextFilePage();
        }
      }, 150);
    };

    // Use MutationObserver to detect when the scrollable div is added to DOM
    const observer = new MutationObserver(() => {
      const container = document.querySelector(".attachments-table");
      if (container && container !== scrollContainer) {
        if (scrollContainer) {
          scrollContainer.removeEventListener("scroll", handleScroll);
        }
        scrollContainer = container;
        scrollContainer.addEventListener("scroll", handleScroll);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    scrollContainer = document.querySelector(".attachments-table");
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
    };
  }, [moreFilesAvailable, fetchingMoreFiles, nextFileCursor]);

  // Infinite scroll detection for operators dropdown with debouncing
  useEffect(() => {
    let operatorDropdown = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      // Debounce scroll events to prevent rapid firing
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!operatorDropdown) {
          operatorDropdown = document.querySelector(
            ".search-dropdown.user-search-dropdown",
          );
          if (!operatorDropdown) return;
        }

        const scrollTop = operatorDropdown.scrollTop;
        const scrollHeight = operatorDropdown.scrollHeight;
        const clientHeight = operatorDropdown.clientHeight;

        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextOperatorPage();
        }
      }, 150); // 150ms debounce
    };

    // Use MutationObserver to detect when dropdown is added to DOM
    const observer = new MutationObserver(() => {
      const dropdown = document.querySelector(
        ".search-dropdown.user-search-dropdown",
      );
      if (dropdown && dropdown !== operatorDropdown) {
        if (operatorDropdown) {
          operatorDropdown.removeEventListener("scroll", handleScroll);
        }
        operatorDropdown = dropdown;
        operatorDropdown.addEventListener("scroll", handleScroll);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    operatorDropdown = document.querySelector(
      ".search-dropdown.user-search-dropdown",
    );
    if (operatorDropdown) {
      operatorDropdown.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (operatorDropdown) {
        operatorDropdown.removeEventListener("scroll", handleScroll);
      }
    };
  }, [hasMoreOperators, isLoadingMoreOperators, nextOperatorsStart, currentSearchQuery]);

  // Infinite scroll detection for teams dropdown with debouncing
  useEffect(() => {
    let teamDropdown = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      // Debounce scroll events to prevent rapid firing
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!teamDropdown) {
          teamDropdown = document.querySelector(".search-dropdown");
          if (!teamDropdown) return;
        }

        const scrollTop = teamDropdown.scrollTop;
        const scrollHeight = teamDropdown.scrollHeight;
        const clientHeight = teamDropdown.clientHeight;

        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextTeamPage();
        }
      }, 150); // 150ms debounce
    };

    // Use MutationObserver to detect when dropdown is added to DOM
    const observer = new MutationObserver(() => {
      const dropdown = document.querySelector(".search-dropdown");
      // We need to make sure this is the teams dropdown, not operators dropdown
      if (dropdown && !dropdown.classList.contains("user-search-dropdown")) {
        if (dropdown !== teamDropdown) {
          if (teamDropdown) {
            teamDropdown.removeEventListener("scroll", handleScroll);
          }
          teamDropdown = dropdown;
          teamDropdown.addEventListener("scroll", handleScroll);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    teamDropdown = document.querySelector(".search-dropdown");
    if (
      teamDropdown &&
      !teamDropdown.classList.contains("user-search-dropdown")
    ) {
      teamDropdown.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (teamDropdown) {
        teamDropdown.removeEventListener("scroll", handleScroll);
      }
    };
  }, [hasMoreTeams, isLoadingMoreTeams, nextTeamsStart]);

  const fetchReservedFiles = async (
    key,
    id,
    append = false,
    startOverride = null,
    pageSizeOverride = null,
  ) => {
    if (!key || !id) {
      return;
    }

    try {
      const cursor = startOverride !== null ? startOverride : null;
      const limit =
        pageSizeOverride !== null ? pageSizeOverride : artifactsPageSize;
      const result = await invoke("enumerate-realm-seals", {
        spaceKey: key,
        spaceId: id,
        cursor,
        limit,
      });

      if (append) {
        setReservedFiles((prev) => [
          ...prev,
          ...(result.attachments || []),
        ]);
      } else {
        setReservedFiles(result.attachments || []);
      }

      setMoreFilesAvailable(result.hasMore || false);
      setNextFileCursor(result.nextCursor || null);
    } catch (err) {
      setMessage(`Could not load sealed files: ${err.message}`);
      setMessageType("error");
    }
  };

  const onReconstructIndex = async () => {
    if (!realmKey || !realmId || isScanning) return;

    try {
      setIsScanning(true);
      setScanStatus("queued");
      setMessage("Reconstructing sealed files index in the background...");
      setMessageType("success");

      const result = await invoke("launch-realm-audit", {
        spaceKey: realmKey,
        spaceId: realmId,
      });

      if (result.status === "already-running") {
        setMessage("A scan is already underway. Please stand by...");
        setMessageType("success");
      }

      // Start polling for completion
      monitorScanProgress();
    } catch (err) {
      setIsScanning(false);
      setScanStatus("failed");
      setMessage(`Index reconstruction unsuccessful: ${err.message}`);
      setMessageType("error");
    }
  };

  const monitorScanProgress = () => {
    const interval = setInterval(async () => {
      try {
        const status = await invoke("check-audit-status", { spaceId: realmId });
        setScanStatus(status?.status || null);

        if (status?.status === "completed") {
          clearInterval(interval);
          setIsScanning(false);
          setMessage(
            `Index reconstruction finished! Located ${status.stats?.lockedFound || 0} sealed files.`,
          );
          setMessageType("success");
          // Reload the artifacts list with fresh data
          await fetchReservedFiles(realmKey, realmId);
        } else if (status?.status === "failed") {
          clearInterval(interval);
          setIsScanning(false);
          setMessage(
            `Index reconstruction unsuccessful: ${status.error || "Unknown error"}`,
          );
          setMessageType("error");
        }
      } catch (err) {
        console.error("Error polling scan status:", err);
      }
    }, 5000); // Poll every 5 seconds

    // Safety: stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      setIsScanning(false);
    }, 300000);
  };

  const onSaveRealmPrefs = async () => {
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);

      if (!realmKey) {
        throw new Error("Realm key is missing - cannot save settings");
      }

      await invoke("store-policy", {
        scope: "space",
        key: realmKey,
        data: realmPrefs,
      });

      setMessage("Realm preferences updated!");
      setMessageType("success");
    } catch (err) {
      console.error("Failed to save realm settings:", err);
      setMessage(`Could not save realm settings: ${err.message}`);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const onAddTeam = (group) => {
    if (!realmPrefs.adminGroups.includes(group)) {
      setRealmPrefs((prev) => ({
        ...prev,
        adminGroups: [...prev.adminGroups, group],
      }));
    }
  };

  const onRemoveTeam = (group) => {
    setRealmPrefs((prev) => ({
      ...prev,
      adminGroups: prev.adminGroups.filter((g) => g !== group),
    }));
  };

  const findOperators = async (
    searchTerm,
    append = false,
    startOverride = null,
  ) => {
    if (!searchTerm || searchTerm.length < 2) {
      setOperatorResults([]);
      setIsSearchingOperators(false);
      setShowOperatorDropdown(false);
      setHasMoreOperators(false);
      setNextOperatorsStart(null);
      setCurrentSearchQuery("");
      return;
    }

    // Reset pagination if search query changed
    if (searchTerm !== currentSearchQuery && !append) {
      setCurrentSearchQuery(searchTerm);
      setNextOperatorsStart(null);
      setHasMoreOperators(false);
    }

    try {
      setIsSearchingOperators(true);
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("search-operators", {
        query: searchTerm,
        start,
        limit: 10,
      });

      if (append) {
        setOperatorResults((prev) => [...prev, ...(result.users || [])]);
      } else {
        setOperatorResults(result.users || []);
      }

      setHasMoreOperators(result.hasMore || false);
      setNextOperatorsStart(result.nextStart || null);
      setShowOperatorDropdown(result.users && result.users.length > 0);
    } catch (error) {
      setOperatorResults([]);
      setShowOperatorDropdown(false);
      setError(`Operator search failed: ${error.message}`);
      setHasMoreOperators(false);
      setNextOperatorsStart(null);
    } finally {
      setIsSearchingOperators(false);
    }
  };

  const onOperatorSearch = (e) => {
    const term = e.target.value;
    setOperatorQuery(term);
    findOperators(term);
  };

  const fetchNextFilePage = async () => {
    if (
      !moreFilesAvailable ||
      fetchingMoreFiles ||
      !realmKey ||
      !realmId
    ) {
      return;
    }

    setFetchingMoreFiles(true);
    try {
      await fetchReservedFiles(
        realmKey,
        realmId,
        true,
        nextFileCursor,
      );
    } catch (error) {
      console.error("Error loading more artifacts:", error);
    } finally {
      setFetchingMoreFiles(false);
    }
  };

  const fetchNextOperatorPage = async () => {
    if (!hasMoreOperators || isLoadingMoreOperators || !nextOperatorsStart) {
      return;
    }

    setIsLoadingMoreOperators(true);
    try {
      if (currentSearchQuery) {
        await findOperators(currentSearchQuery, true, nextOperatorsStart);
      } else {
        await fetchInitialOperators(true, nextOperatorsStart);
      }
    } catch (error) {
      console.error("Error loading more operators:", error);
    } finally {
      setIsLoadingMoreOperators(false);
    }
  };

  const fetchNextTeamPage = async () => {
    if (!hasMoreTeams || isLoadingMoreTeams || !nextTeamsStart) {
      return;
    }

    setIsLoadingMoreTeams(true);
    try {
      await fetchAllTeams(true, nextTeamsStart);
    } catch (error) {
      console.error("Error loading more teams:", error);
    } finally {
      setIsLoadingMoreTeams(false);
    }
  };

  // Handle page size change for sealed artifacts
  const onResultsPerPageChange = async (newPageSize) => {
    setArtifactsPageSize(newPageSize);
    setReservedFiles([]);
    setMoreFilesAvailable(false);
    setNextFileCursor(null);
    await fetchReservedFiles(realmKey, realmId, false, null, newPageSize);
  };

  const onRealmSort = (field) => {
    if (realmSortField === field) {
      setRealmSortDir(realmSortDir === "asc" ? "desc" : "asc");
    } else {
      setRealmSortField(field);
      setRealmSortDir("asc");
    }
  };

  const onAddOperator = (operator) => {
    // Store operator object with accountId and displayName
    const operatorToAdd = {
      accountId: operator.accountId,
      displayName: operator.displayName,
    };

    // Check if operator is already added
    const isAlreadyAdded = realmPrefs.adminUsers.some(
      (existingOperator) =>
        (typeof existingOperator === "string"
          ? existingOperator
          : existingOperator.accountId) === operator.accountId,
    );

    if (!isAlreadyAdded) {
      setRealmPrefs((prev) => ({
        ...prev,
        adminUsers: [...prev.adminUsers, operatorToAdd],
      }));
    }

    // Clear search
    setOperatorQuery("");
    setOperatorResults([]);
    setShowOperatorDropdown(false);
  };

  const onRemoveOperator = (operatorToRemove) => {
    setRealmPrefs((prev) => ({
      ...prev,
      adminUsers: prev.adminUsers.filter((operator) => {
        const operatorId = typeof operator === "string" ? operator : operator.accountId;
        const removeId =
          typeof operatorToRemove === "string"
            ? operatorToRemove
            : operatorToRemove.accountId;
        return operatorId !== removeId;
      }),
    }));
  };

  const onTeamSearch = (e) => {
    const term = e.target.value;
    setTeamSearchTerm(term);
    setShowTeamDropdown(term.length > 0 || teamList.length > 0);
  };

  const filteredTeams = () => {
    if (!teamSearchTerm) {
      return teamList.filter(
        (group) => !realmPrefs.adminGroups.includes(group),
      );
    }
    return teamList.filter(
      (group) =>
        !realmPrefs.adminGroups.includes(group) &&
        group.toLowerCase().includes(teamSearchTerm.toLowerCase()),
    );
  };

  const onPickTeam = (group) => {
    onAddTeam(group);
    setTeamSearchTerm("");
    setShowTeamDropdown(false);
  };

  const activationChoices = [
    {
      value: "use-system-default",
      label: "Use System Default",
      description: "Follows the global system preferences.",
    },
    {
      value: "enabled",
      label: "Active",
      description: "Sentinel Vault is active for this realm.",
    },
    {
      value: "disabled",
      label: "Inactive",
      description: "Sentinel Vault is inactive for this realm.",
    },
  ];

  const onActivationPick = (value) => {
    setRealmPrefs((prev) => ({
      ...prev,
      activation: value,
    }));
    setShowActivationDropdown(false);
  };

  const activationDisplayText = (value) => {
    return (
      activationChoices.find((option) => option.value === value)?.label || value
    );
  };

  const formatCountdown = (expiresAt) => {
    if (!expiresAt) return "Never";

    const now = new Date();
    const expiry = new Date(expiresAt);
    const timeLeft = expiry - now;

    if (timeLeft <= 0) return "Overdue";

    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const onWatchToggle = async (artifactId) => {
    setBusyAction({ id: artifactId, action: "watch" });
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
    } finally {
      setBusyAction(null);
    }
  };

  // Check dispatch request status for sealed artifacts
  useEffect(() => {
    const checkDispatchStatus = async () => {
      for (const att of reservedFiles) {
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
    if (reservedFiles.length > 0) {
      checkDispatchStatus();
    }
  }, [reservedFiles]);

  const onForceRelease = async (artifactId) => {
    setBusyAction({ id: artifactId, action: "unseal" });
    try {
      setMessage(null);
      setMessageType(null);

      const result = await invoke("steward-unseal", {
        attachmentId: artifactId,
        spaceKey: realmKey,
        spaceId: realmId,
      });

      if (result.success) {
        setMessage("File seal cleared!");
        setMessageType("success");
        // Reload sealed artifacts to update the table
        if (realmKey && realmId) {
          await fetchReservedFiles(realmKey, realmId);
        }
      } else {
        setMessage(`Failed to unseal artifact: ${result.reason}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage(`Steward unseal failed: ${err.message}`);
      setMessageType("error");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Realm Settings</h2>
        <p className="loading-text">
          Retrieving realm preferences and sealed files...
        </p>
      </div>
    );
  }

  return (
    <div className="space-admin-container">
      <div className="space-admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src={logo}
            alt="Sentinel Vault Logo"
            style={{ height: "32px", width: "auto" }}
          />
          <div>
            <h1 className="space-admin-title">Realm Preferences</h1>
            <p className="space-admin-subtitle">
              Manage Sentinel Vault preferences and access control for this
              realm.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={
            messageType === "success" ? "alert-success" : "alert-error"
          }
        >
          {message}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tab-navigation">
        {userRole === "user" && (
          <button className={`tab-button ${activeTab === "my-claims" ? "active" : ""}`}
            onClick={() => { setActiveTab("my-claims"); fetchMyClaimedFiles(); }}>
            My Sealed Files
          </button>
        )}
        {userRole === "steward" && (
          <>
            <button className={`tab-button ${activeTab === "locked-attachments" ? "active" : ""}`}
              onClick={() => setActiveTab("locked-attachments")}>
              Realm Sealed Files
            </button>
            <button className={`tab-button ${activeTab === "permissions" ? "active" : ""}`}
              onClick={() => { setActiveTab("permissions"); fetchPendingRequests(); }}>
              Access Control{pendingRequests.length > 0 && (
                <span style={{
                  marginLeft: "6px",
                  background: "var(--sv-interactive-danger)",
                  color: "var(--sv-text-inverse)",
                  borderRadius: "9999px",
                  padding: "1px 7px",
                  fontSize: "10px",
                  fontWeight: 700,
                  minWidth: "18px",
                  textAlign: "center",
                  display: "inline-block",
                }}>{pendingRequests.length}</span>
              )}
            </button>
            <button className={`tab-button ${activeTab === "unlock-timeouts" ? "active" : ""}`}
              onClick={() => setActiveTab("unlock-timeouts")}>
              Reservation Duration
            </button>
            <button className={`tab-button ${activeTab === "macro-settings" ? "active" : ""}`}
              onClick={() => setActiveTab("macro-settings")}>
              Macro
            </button>
          </>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === "my-claims" && (
        <div className="tab-content">
          {userRole === "user" && stewardRequestStatus === "none" && !stewardRequestSent && (
            <div className="steward-request-banner">
              <div>
                <strong>Want to manage all sealed files in this space?</strong>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--sv-text-secondary)" }}>
                  As a steward you can view all sealed files and force unseal them when needed.
                </p>
              </div>
              <button className={`action-btn lock ${stewardRequestBusy ? "is-busy" : ""}`} onClick={handleRequestSteward} disabled={stewardRequestBusy} title="Ask a space admin to grant you steward permissions">
                {stewardRequestBusy ? <>Requesting<span className="btn-busy-bar" /></> : "Request Steward Access"}
              </button>
            </div>
          )}
          {(stewardRequestSent || stewardRequestStatus === "pending") && (
            <div className="steward-request-banner" style={{ borderLeftColor: "var(--sv-status-success)" }}>
              <span>Your steward access request has been submitted. A space admin or steward will review it.</span>
            </div>
          )}
          {stewardRequestStatus === "denied" && (
            <div className="steward-request-banner" style={{ borderLeftColor: "var(--sv-status-warning)" }}>
              <div>
                <strong>Your steward access request was denied.</strong>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--sv-text-secondary)" }}>
                  {stewardRequestDeniedAt ? (() => {
                    const deniedTime = new Date(stewardRequestDeniedAt).getTime();
                    const retryTime = deniedTime + (48 * 60 * 60 * 1000);
                    const remaining = retryTime - Date.now();
                    if (remaining <= 0) return "You can submit a new request now.";
                    const hours = Math.ceil(remaining / 3600000);
                    return `You can submit a new request in approximately ${hours} hour${hours !== 1 ? "s" : ""}.`;
                  })() : "You may submit a new request after 48 hours."}
                </p>
              </div>
            </div>
          )}

          {myClaimsLoading && (
            <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`my-skel-${i}`} />)}
            </div>
          )}

          {!myClaimsLoading && myClaimedFiles.length === 0 && (
            <div className="empty-state">You have no sealed files in this space.</div>
          )}

          {!myClaimsLoading && myClaimedFiles.length > 0 && (
            <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
              {myClaimedFiles.map(artifact => (
                <MyClaimedCard
                  key={artifact.id}
                  artifact={artifact}
                  busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                  onRelease={async (id) => {
                    setBusyAction({ id, action: "unseal" });
                    try {
                      await invoke("unseal-artifact", { attachmentId: id });
                      fetchMyClaimedFiles();
                    } catch (e) { console.error("Release failed:", e); }
                    finally { setBusyAction(null); }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "locked-attachments" && userRole === "steward" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">
              Realm Sealed Files in {realmName}
            </h3>
            <p className="space-admin-subtitle">
              Review and track all sealed files in this realm. Sealed
              files are shielded from unauthorized changes.
            </p>
          </div>

          <div className="overlay-toolbar">
            <ColumnPicker
              columns={REALM_COLUMNS}
              visible={realmVisibleColumns}
              onChange={(key) => setRealmVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))}
              isOpen={realmColumnPickerOpen}
              onToggle={setRealmColumnPickerOpen}
            />
            <SortPicker
              orderField={realmSortField}
              orderDir={realmSortDir}
              onSort={onRealmSort}
            />
            <span className="toolbar-file-count">{reservedFiles.length} sealed files</span>
          </div>

          {reservedFiles.length === 0 && !fetchingMoreFiles ? (
            <div className="empty-state">
              <p>No sealed files discovered in the index.</p>
            </div>
          ) : (
            <>
              <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                {[...reservedFiles].sort((a, b) => {
                  const aVal = a[realmSortField] || "";
                  const bVal = b[realmSortField] || "";
                  const cmp = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
                  return realmSortDir === "asc" ? cmp : -cmp;
                }).map(artifact => (
                  <RealmClaimedCard
                    key={artifact.id}
                    artifact={artifact}
                    onForceRelease={onForceRelease}
                    onWatch={(id) => onWatchToggle(id)}
                    isWatching={watchStatus[artifact.id]}
                    forceReleaseActive={forceReleaseActive}
                    visibleColumns={realmVisibleColumns}
                    busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                  />
                ))}
              </div>
              {fetchingMoreFiles && moreFilesAvailable && (
                <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                  {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
                </div>
              )}
              {moreFilesAvailable && !fetchingMoreFiles && (
                <div style={{ textAlign: "center", padding: "16px" }}>
                  <button
                    className="btn-primary"
                    onClick={fetchNextFilePage}
                    style={{ fontSize: "13px", padding: "8px 20px" }}
                  >
                    Show more
                  </button>
                </div>
              )}
              {!moreFilesAvailable && reservedFiles.length > 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px",
                    color: "var(--sv-text-subtle)",
                    fontStyle: "italic",
                  }}
                >
                  All sealed files shown
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "permissions" && userRole === "steward" && (
        <div className="tab-content">
          {/* Realm Activation */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3>Realm Activation</h3>
              <p className="settings-card-desc">Configure how Sentinel Vault operates within this realm.</p>
            </div>
            <div className="settings-card-body">
              <div className="custom-select-container">
                <div
                  className="custom-select"
                  onClick={() => setShowActivationDropdown(!showActivationDropdown)}
                  tabIndex={0}
                  onBlur={() => {
                    setTimeout(() => setShowActivationDropdown(false), 200);
                  }}
                >
                  <span className="select-value">
                    {activationDisplayText(realmPrefs.activation)}
                  </span>
                  <span className={`select-arrow ${showActivationDropdown ? "open" : ""}`}>
                    ▼
                  </span>
                </div>

                {showActivationDropdown && (
                  <div className="custom-select-dropdown">
                    {activationChoices.map((option) => (
                      <div
                        key={option.value}
                        className={`select-option ${realmPrefs.activation === option.value ? "selected" : ""}`}
                        onClick={() => onActivationPick(option.value)}
                      >
                        <div className="option-label">{option.label}</div>
                        <div className="option-description">{option.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stewards */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3>Stewards</h3>
              <p className="settings-card-desc">
                Operators with steward privileges can view all sealed files and force unseal them.
                Space admins and org admins are automatically stewards.
              </p>
            </div>
            <div className="settings-card-body">
              {/* Operators as mini-cards in a grid */}
              <div className="steward-grid">
                {realmPrefs.adminUsers.map((operator, index) => {
                  const accountId = typeof operator === "string" ? operator : operator.accountId;
                  const displayName = typeof operator === "string" ? `User ${accountId.slice(-4)}` : operator.displayName;
                  const initials = displayName.split(/\s+/).map(p => p[0]).join("").toUpperCase().slice(0, 2);
                  return (
                    <div key={accountId || index} className="steward-card">
                      <div className="steward-avatar">{initials}</div>
                      <span className="steward-name">{displayName}</span>
                      <button className="steward-remove" onClick={() => onRemoveOperator(operator)} title="Remove steward">&times;</button>
                    </div>
                  );
                })}
                {/* Add Operator card */}
                <div className="steward-card steward-card-add" onClick={() => { setShowOperatorSearch(!showOperatorSearch); }}>
                  <div className="steward-avatar steward-avatar-add">+</div>
                  <span className="steward-name">Add Operator</span>
                </div>
              </div>

              {/* Operator search (shown when add is clicked) */}
              {showOperatorSearch && (
                <div className="search-container" style={{ marginBottom: "16px" }}>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Type to search for operators..."
                    value={operatorQuery}
                    onChange={onOperatorSearch}
                    onFocus={() => {
                      setShowOperatorDropdown(true);
                      if (!operatorQuery && operatorResults.length === 0) {
                        fetchInitialOperators();
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowOperatorDropdown(false), 200);
                    }}
                  />

                  {isSearchingOperators && (
                    <div className="search-dropdown">
                      {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`op-skel-${i}`} />)}
                    </div>
                  )}

                  {showOperatorDropdown && !isSearchingOperators && operatorQuery && (
                    <div
                      className="search-dropdown user-search-dropdown"
                      style={{ maxHeight: "300px", overflowY: "auto" }}
                    >
                      {operatorResults.length > 0 ? (
                        <>
                          {operatorResults.map((operator) => {
                            const isAlreadyAdded = realmPrefs.adminUsers.some(
                              (existingOperator) =>
                                (typeof existingOperator === "string"
                                  ? existingOperator
                                  : existingOperator.accountId) === operator.accountId,
                            );
                            return (
                              <div
                                key={operator.accountId}
                                className={`search-result user-search-result ${isAlreadyAdded ? "disabled" : ""}`}
                                onClick={() => !isAlreadyAdded && onAddOperator(operator)}
                                style={{
                                  opacity: isAlreadyAdded ? 0.5 : 1,
                                  cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                                }}
                              >
                                <div className="user-name">
                                  {operator.displayName}
                                  {isAlreadyAdded && (
                                    <span style={{ marginLeft: "8px", fontSize: "10px" }}>(Already added)</span>
                                  )}
                                </div>
                                {operator.email && (
                                  <div className="user-email">{operator.email}</div>
                                )}
                              </div>
                            );
                          })}
                          {isLoadingMoreOperators && hasMoreOperators && (
                            <>
                              {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`op-more-skel-${i}`} />)}
                            </>
                          )}
                          {!isLoadingMoreOperators && !hasMoreOperators && (
                            <div className="search-result">
                              <div style={{ display: "flex", justifyContent: "center", padding: "12px", color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "12px" }}>
                                All operators loaded
                              </div>
                            </div>
                          )}
                        </>
                      ) : operatorQuery ? (
                        <div className="search-result">
                          <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic" }}>
                            No operators found for &quot;{operatorQuery}&quot;
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {showOperatorDropdown && !isSearchingOperators && !operatorQuery && operatorResults.length > 0 && (
                    <div className="search-dropdown">
                      <div className="search-result" style={{ backgroundColor: "var(--sv-bg-tertiary)", cursor: "default" }}>
                        <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "11px" }}>
                          Recent operators (type to search for more):
                        </span>
                      </div>
                      {operatorResults.map((operator) => {
                        const isAlreadyAdded = realmPrefs.adminUsers.some(
                          (existingOperator) =>
                            (typeof existingOperator === "string"
                              ? existingOperator
                              : existingOperator.accountId) === operator.accountId,
                        );
                        return (
                          <div
                            key={operator.accountId}
                            className={`search-result user-search-result ${isAlreadyAdded ? "disabled" : ""}`}
                            onClick={() => !isAlreadyAdded && onAddOperator(operator)}
                            style={{
                              opacity: isAlreadyAdded ? 0.5 : 1,
                              cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                            }}
                          >
                            <div className="user-name">
                              {operator.displayName}
                              {isAlreadyAdded && (
                                <span style={{ marginLeft: "8px", fontSize: "10px" }}>(Already added)</span>
                              )}
                            </div>
                            {operator.email && (
                              <div className="user-email">{operator.email}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Guilds section */}
              <div className="steward-guilds">
                <h4 className="steward-guilds-title">Guilds</h4>
                <p className="steward-guilds-desc">Members of these guilds are automatically stewards.</p>
                <div className="guild-chips">
                  {realmPrefs.adminGroups.map((group) => (
                    <span key={group} className="guild-chip">
                      {group}
                      <button className="guild-chip-remove" onClick={() => onRemoveTeam(group)}>&times;</button>
                    </span>
                  ))}
                  <button className="guild-chip guild-chip-add" onClick={() => { setShowGuildSearch(!showGuildSearch); }}>
                    + Add Guild
                  </button>
                </div>

                {/* Guild search dropdown (shown when add is clicked) */}
                {showGuildSearch && (
                  <div className="search-container" style={{ marginTop: "10px" }}>
                    {teamList.length === 0 ? (
                      <>
                        {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`guild-skel-${i}`} />)}
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          className="search-input"
                          placeholder="Type to search and select guilds..."
                          value={teamSearchTerm}
                          onChange={onTeamSearch}
                          onFocus={() => { setShowTeamDropdown(true); }}
                          onBlur={() => { setTimeout(() => setShowTeamDropdown(false), 200); }}
                        />

                        {showTeamDropdown && (
                          <div className="search-dropdown" style={{ maxHeight: "300px", overflowY: "auto" }}>
                            {filteredTeams().length === 0 ? (
                              <div className="search-result">
                                <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic" }}>
                                  {teamSearchTerm
                                    ? `No guilds found matching "${teamSearchTerm}"`
                                    : "All available guilds are already selected"}
                                </span>
                              </div>
                            ) : (
                              <>
                                {filteredTeams().map((group) => (
                                  <div key={group} className="search-result" onClick={() => onPickTeam(group)} style={{ cursor: "pointer" }}>
                                    <div className="user-name">{group}</div>
                                  </div>
                                ))}
                                {isLoadingMoreTeams && hasMoreTeams && (
                                  <>
                                    {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`guild-more-skel-${i}`} />)}
                                  </>
                                )}
                                {!isLoadingMoreTeams && !hasMoreTeams && filteredTeams().length > 0 && (
                                  <div className="search-result">
                                    <div style={{ display: "flex", justifyContent: "center", padding: "12px", color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "12px" }}>
                                      All guilds loaded
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pending Steward Requests */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3>Pending Access Requests</h3>
              <p className="settings-card-desc">
                Users who have requested steward access for this realm. Approve to grant steward privileges or deny to reject the request.
              </p>
            </div>
            <div className="settings-card-body">
              {pendingRequestsLoading && (
                <div style={{ color: "var(--sv-text-subtle)", fontSize: "12px", padding: "8px 0" }}>Loading requests...</div>
              )}
              {!pendingRequestsLoading && pendingRequests.length === 0 && (
                <div style={{ color: "var(--sv-text-subtle)", fontSize: "12px", padding: "8px 0", fontStyle: "italic" }}>No pending requests.</div>
              )}
              {!pendingRequestsLoading && pendingRequests.length > 0 && (
                <div className="steward-grid">
                  {pendingRequests.map((request) => {
                    const initials = (request.displayName || "??").split(/\s+/).map(p => p[0]).join("").toUpperCase().slice(0, 2);
                    const requestDate = request.requestedAt ? new Date(request.requestedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
                    return (
                      <div key={request.accountId} className="steward-card">
                        <div className="steward-avatar">{initials}</div>
                        <span className="steward-name">{request.displayName || "Unknown User"}</span>
                        {requestDate && <span style={{ fontSize: "10px", color: "var(--sv-text-subtle)" }}>{requestDate}</span>}
                        <span style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          {(!requestActionBusy || requestActionBusy.id !== request.accountId || requestActionBusy.action === "approve") && (
                            <button
                              className={`action-btn lock ${requestActionBusy?.id === request.accountId && requestActionBusy.action === "approve" ? "is-busy" : ""}`}
                              onClick={() => handleApproveRequest(request.accountId)}
                              disabled={!!requestActionBusy}
                              title="Grant steward access to this user"
                            >
                              {requestActionBusy?.id === request.accountId && requestActionBusy.action === "approve" ? <>Approving<span className="btn-busy-bar" /></> : "Approve"}
                            </button>
                          )}
                          {(!requestActionBusy || requestActionBusy.id !== request.accountId || requestActionBusy.action === "deny") && (
                            <button
                              className={`action-btn unlock ${requestActionBusy?.id === request.accountId && requestActionBusy.action === "deny" ? "is-busy" : ""}`}
                              onClick={() => handleDenyRequest(request.accountId)}
                              disabled={!!requestActionBusy}
                              title="Deny this steward access request"
                            >
                              {requestActionBusy?.id === request.accountId && requestActionBusy.action === "deny" ? <>Denying<span className="btn-busy-bar" /></> : "Deny"}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Note */}
          <div className="settings-note">
            <strong>Note:</strong> Realm Stewards and Confluence Administrators always have these privileges.
          </div>

          {/* Save button */}
          <div className="action-bar">
            <button className="btn-primary" onClick={onSaveRealmPrefs}>Apply Configuration</button>
          </div>
        </div>
      )}

      {activeTab === "unlock-timeouts" && userRole === "steward" && (
        <div className="tab-content">
          <div className="settings-panel">
            <div className="settings-row">
              <div className="settings-row-info">
                <p className="settings-row-label">Use System Default Timeouts</p>
                <p className="settings-row-description">
                  When enabled, this realm will inherit the global unlock timeout
                  settings configured by administrators.
                </p>
              </div>
              <div className="settings-row-control">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={realmPrefs.autoUnlockTimeoutHours === null}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setRealmPrefs((prev) => ({
                          ...prev,
                          autoUnlockTimeoutHours: null,
                        }));
                      } else {
                        setRealmPrefs((prev) => ({
                          ...prev,
                          autoUnlockTimeoutHours: 48,
                        }));
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {realmPrefs.autoUnlockTimeoutHours !== null && (
              <div className="nested-control">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">Custom Unlock Duration</p>
                    <p className="settings-row-description">
                      File seals lapse after{" "}
                      <span className="dynamic-value">
                        {realmPrefs.autoUnlockTimeoutHours} hours
                      </span>{" "}
                      of inactivity. This overrides the global system settings for
                      this realm only.
                    </p>
                  </div>
                  <div className="settings-row-control">
                    <div className="input-with-unit">
                      <input
                        className="form-input"
                        type="number"
                        value={realmPrefs.autoUnlockTimeoutHours}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);
                          if (!isNaN(value) && value > 0) {
                            setRealmPrefs((prev) => ({
                              ...prev,
                              autoUnlockTimeoutHours: value,
                            }));
                          }
                        }}
                        min="1"
                      />
                      <span className="input-unit">hrs</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "macro-settings" && userRole === "steward" && (
        <div className="tab-content">
          <div className="settings-panel">
            <div className="settings-row">
              <div className="settings-row-info">
                <p className="settings-row-label">Auto-Insert Macro</p>
                <p className="settings-row-description">
                  When enabled, the Sentinel Vault macro will be automatically
                  inserted into a page in this realm when a file is first sealed.
                  The macro shows seal status, labels, and actions for all
                  files on the page. Individual pages can override this setting.
                </p>
              </div>
              <div className="settings-row-control">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={realmPrefs.autoInsertMacro !== false}
                    onChange={(e) => {
                      setRealmPrefs((prev) => ({
                        ...prev,
                        autoInsertMacro: e.target.checked,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>

            <div
              style={{
                opacity: realmPrefs.autoInsertMacro === false ? 0.45 : 1,
                pointerEvents:
                  realmPrefs.autoInsertMacro === false ? "none" : "auto",
                transition: "opacity 0.2s",
              }}
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Macro Position</p>
                  <p className="settings-row-description">
                    Choose where the macro will be placed when it is automatically
                    inserted into a page. Moving an existing macro must be done
                    manually through the Confluence editor.
                  </p>
                </div>
                <div className="settings-row-control">
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label className="checkbox-control" style={{ marginBottom: 0 }}>
                      <input
                        type="radio"
                        name="panelInsertPosition"
                        value="top"
                        checked={realmPrefs.macroInsertPosition === "top"}
                        onChange={() => {
                          setRealmPrefs((prev) => ({
                            ...prev,
                            macroInsertPosition: "top",
                          }));
                        }}
                      />
                      <span className="checkbox-label">Top</span>
                    </label>
                    <label className="checkbox-control" style={{ marginBottom: 0 }}>
                      <input
                        type="radio"
                        name="panelInsertPosition"
                        value="bottom"
                        checked={realmPrefs.macroInsertPosition !== "top"}
                        onChange={() => {
                          setRealmPrefs((prev) => ({
                            ...prev,
                            macroInsertPosition: "bottom",
                          }));
                        }}
                      />
                      <span className="checkbox-label">Bottom</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {userRole === "steward" && (
        <div className="action-bar">
          <button
            className="btn-primary"
            onClick={onSaveRealmPrefs}
            disabled={loading}
          >
            {loading ? "Updating..." : "Apply Configuration"}
          </button>
        </div>
      )}
    </div>
  );
};

const App = () => {
  return <RealmPolicyDashboard />;
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
