// src/ui/surfaces/realm-console/index.jsx

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import logo from "../../assets/icons/icon.png";

const RealmPolicyDashboard = () => {
  const [activeTab, setActiveTab] = useState("locked-attachments");
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
      setMessage(`Unable to fetch team list: ${error.message}`);
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
      setMessage(`Could not load claimed files: ${err.message}`);
      setMessageType("error");
    }
  };

  const onReconstructIndex = async () => {
    if (!realmKey || !realmId || isScanning) return;

    try {
      setIsScanning(true);
      setScanStatus("queued");
      setMessage("Reconstructing claimed files index in the background...");
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
            `Index reconstruction finished! Located ${status.stats?.lockedFound || 0} claimed files.`,
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
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);

      const result = await invoke("steward-unseal", {
        attachmentId: artifactId,
        spaceKey: realmKey,
        spaceId: realmId,
      });

      if (result.success) {
        setMessage("File claim cleared!");
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
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Realm Settings</h2>
        <p className="loading-text">
          Retrieving realm preferences and claimed files...
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
        <button
          className={`tab-button ${activeTab === "locked-attachments" ? "active" : ""}`}
          onClick={() => setActiveTab("locked-attachments")}
        >
          Claimed Files
        </button>
        <button
          className={`tab-button ${activeTab === "permissions" ? "active" : ""}`}
          onClick={() => setActiveTab("permissions")}
        >
          Access Control
        </button>
        <button
          className={`tab-button ${activeTab === "unlock-timeouts" ? "active" : ""}`}
          onClick={() => setActiveTab("unlock-timeouts")}
        >
          Reservation Duration
        </button>
        <button
          className={`tab-button ${activeTab === "macro-settings" ? "active" : ""}`}
          onClick={() => setActiveTab("macro-settings")}
        >
          Panel
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "locked-attachments" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">
              Claimed Files in {realmName}
            </h3>
            <p className="space-admin-subtitle">
              Review and track all claimed files in this realm. Claimed
              files are shielded from unauthorized changes.
            </p>
          </div>

          <div
            style={{
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <label style={{ marginRight: "8px", fontWeight: "500" }}>
                Results per page:
              </label>
              <select
                value={artifactsPageSize}
                onChange={(e) => onResultsPerPageChange(Number(e.target.value))}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "1px solid var(--sv-border-secondary)",
                  backgroundColor: "var(--sv-bg-primary)",
                  color: "var(--sv-text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <button
              onClick={onReconstructIndex}
              disabled={isScanning}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid var(--sv-border-secondary)",
                backgroundColor: isScanning
                  ? "var(--sv-bg-tertiary)"
                  : "var(--sv-bg-primary)",
                color: isScanning
                  ? "var(--sv-text-disabled)"
                  : "var(--sv-text-primary)",
                fontSize: "13px",
                cursor: isScanning ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
              title="Scan pages to locate claimed files not yet in the index"
            >
              {isScanning ? "Scanning..." : "Reconstruct Index"}
            </button>
            {isScanning && (
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--sv-text-subtle)",
                  fontStyle: "italic",
                }}
              >
                Background scan running. Results will appear when complete.
              </span>
            )}
          </div>

          {reservedFiles.length === 0 && !fetchingMoreFiles ? (
            <div className="empty-state">
              <p>No claimed files discovered in the index.</p>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--sv-text-subtle)",
                  marginTop: "8px",
                }}
              >
                If you recently claimed files or this is an initial
                setup, click <strong>Reconstruct Index</strong> above to scan all
                pages.
              </p>
            </div>
          ) : (
            <div
              className="attachments-table"
              style={{ maxHeight: "600px", overflowY: "auto" }}
            >
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Creator</th>
                    <th>Location</th>
                    <th>Claimed by</th>
                    <th>Claimed on</th>
                    <th>Lapses</th>
                    <th>Watch for Relinquish</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reservedFiles.map((artifact) => (
                    <tr key={artifact.id}>
                      <td className="table-cell-name">{artifact.title}</td>
                      <td>{artifact.fileSize}</td>
                      <td>{artifact.creator}</td>
                      <td className="table-cell-page-static">
                        {artifact.pageTitle}
                      </td>
                      <td className="table-cell-locked-by">
                        {artifact.lockedBy}
                      </td>
                      <td>
                        {new Date(artifact.lockedOn).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            color: systemExpiryAlertsActive
                              ? formatCountdown(artifact.expiresAt) ===
                                "Overdue"
                                ? "var(--sv-status-warning)"
                                : "var(--sv-text-subtle)"
                              : "var(--sv-text-disabled)",
                            fontWeight: systemExpiryAlertsActive
                              ? formatCountdown(artifact.expiresAt) ===
                                "Overdue"
                                ? "600"
                                : "400"
                              : "400",
                            fontStyle: !systemExpiryAlertsActive
                              ? "italic"
                              : "normal",
                          }}
                        >
                          {!systemExpiryAlertsActive
                            ? "Auto-unlock disabled"
                            : formatCountdown(artifact.expiresAt)}
                        </span>
                      </td>
                      <td>
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
                              : "Alerted when relinquished"
                          }
                        >
                          {watchStatus[artifact.id]
                            ? "Watching"
                            : "Watch"}
                        </button>
                      </td>
                      <td>
                        {forceReleaseActive ? (
                          <button
                            className="btn btn-warning"
                            onClick={() => onForceRelease(artifact.id)}
                          >
                            Force Release
                          </button>
                        ) : (
                          <button
                            className="btn btn-subtle disabled-unlock-btn"
                            disabled={true}
                            data-tooltip="Steward override is disabled in Global Configuration"
                          >
                            Force Release
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fetchingMoreFiles && moreFilesAvailable && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    padding: "20px",
                    color: "var(--sv-text-subtle)",
                  }}
                >
                  <div
                    className="loading-spinner"
                    style={{
                      width: "20px",
                      height: "20px",
                      margin: "0 8px 0 0",
                    }}
                  ></div>
                  Resolving more artifacts...
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
                  All claimed files shown
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "permissions" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">Realm-Level Activation</h3>
            <p className="space-admin-subtitle">
              Configure how Sentinel Vault operates within this realm:
            </p>

            <div className="form-control">
              <div className="custom-select-container">
                <div
                  className="custom-select"
                  onClick={() =>
                    setShowActivationDropdown(!showActivationDropdown)
                  }
                  tabIndex={0}
                  onBlur={() => {
                    setTimeout(() => setShowActivationDropdown(false), 200);
                  }}
                >
                  <span className="select-value">
                    {activationDisplayText(realmPrefs.activation)}
                  </span>
                  <span
                    className={`select-arrow ${showActivationDropdown ? "open" : ""}`}
                  >
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
                        <div className="option-description">
                          {option.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="permission-section">
            <h4>Authorized Teams:</h4>

            {/* Selected steward teams display */}
            <div className="admin-list">
              {realmPrefs.adminGroups.length === 0 ? (
                <span className="admin-empty">No teams assigned</span>
              ) : (
                realmPrefs.adminGroups.map((group) => (
                  <span
                    key={group}
                    className="admin-tag admin-tag-group selected"
                  >
                    {group}
                    <button
                      className="admin-tag-remove"
                      onClick={() => onRemoveTeam(group)}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Team selection - custom dropdown */}
            <div className="group-selector">
              <h5>Add Team:</h5>
              {teamList.length === 0 ? (
                <p className="loading-text">
                  Loading teams from Confluence...
                </p>
              ) : (
                <div className="search-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Type to search and select teams..."
                    value={teamSearchTerm}
                    onChange={onTeamSearch}
                    onFocus={() => {
                      setShowTeamDropdown(true);
                    }}
                    onBlur={() => {
                      // Delay hiding to allow clicking on results
                      setTimeout(() => setShowTeamDropdown(false), 200);
                    }}
                  />

                  {showTeamDropdown && (
                    <div
                      className="search-dropdown"
                      style={{ maxHeight: "300px", overflowY: "auto" }}
                    >
                      {filteredTeams().length === 0 ? (
                        <div className="search-result">
                          <span
                            style={{
                              color: "var(--sv-text-subtle)",
                              fontStyle: "italic",
                            }}
                          >
                            {teamSearchTerm
                              ? `No teams found matching "${teamSearchTerm}"`
                              : "All available teams are already selected"}
                          </span>
                        </div>
                      ) : (
                        <>
                          {filteredTeams().map((group) => (
                            <div
                              key={group}
                              className="search-result"
                              onClick={() => onPickTeam(group)}
                              style={{ cursor: "pointer" }}
                            >
                              <div className="user-name">{group}</div>
                            </div>
                          ))}
                          {isLoadingMoreTeams && hasMoreTeams && (
                            <div className="search-result">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "8px",
                                  padding: "12px",
                                }}
                              >
                                <div
                                  className="loading-spinner"
                                  style={{
                                    width: "16px",
                                    height: "16px",
                                    margin: "0",
                                  }}
                                ></div>
                                <span>Loading more teams...</span>
                              </div>
                            </div>
                          )}
                          {!isLoadingMoreTeams &&
                            !hasMoreTeams &&
                            filteredTeams().length > 0 && (
                              <div className="search-result">
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    padding: "12px",
                                    color: "var(--sv-text-subtle)",
                                    fontStyle: "italic",
                                    fontSize: "12px",
                                  }}
                                >
                                  All teams loaded
                                </div>
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  )}

                  <p className="form-help form-help-highlight">
                    Browse teams from your Confluence instance. Selected teams
                    will appear above. Scroll down or type to filter teams.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="permission-section">
            <h4>Authorized Operators:</h4>

            {/* Selected steward operators display */}
            <div className="admin-list">
              {realmPrefs.adminUsers.length === 0 ? (
                <span className="admin-empty">No operators assigned</span>
              ) : (
                realmPrefs.adminUsers.map((operator, index) => {
                  // Handle both old format (string) and new format (object)
                  const displayName =
                    typeof operator === "string"
                      ? `User ${operator.slice(-4)}`
                      : operator.displayName;
                  const accountId =
                    typeof operator === "string" ? operator : operator.accountId;

                  return (
                    <span
                      key={accountId || index}
                      className="admin-tag admin-tag-user"
                    >
                      {displayName}
                      <button
                        className="admin-tag-remove"
                        onClick={() => onRemoveOperator(operator)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            {/* Operator search and selection */}
            <div className="group-selector">
              <h5>Add Operator:</h5>
              <div className="search-container">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Type to search for operators..."
                  value={operatorQuery}
                  onChange={onOperatorSearch}
                  onFocus={() => {
                    setShowOperatorDropdown(true);
                    // Load initial operators if search is empty
                    if (!operatorQuery && operatorResults.length === 0) {
                      fetchInitialOperators();
                    }
                  }}
                  onBlur={() => {
                    // Delay hiding to allow clicking on results
                    setTimeout(() => setShowOperatorDropdown(false), 200);
                  }}
                />

                {isSearchingOperators && (
                  <div className="search-dropdown">
                    <div className="search-result">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <div
                          className="loading-spinner"
                          style={{ width: "16px", height: "16px", margin: "0" }}
                        ></div>
                        <span>Searching operators...</span>
                      </div>
                    </div>
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
                          // Check if operator is already added
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
                              onClick={() =>
                                !isAlreadyAdded && onAddOperator(operator)
                              }
                              style={{
                                opacity: isAlreadyAdded ? 0.5 : 1,
                                cursor: isAlreadyAdded
                                  ? "not-allowed"
                                  : "pointer",
                              }}
                            >
                              <div className="user-name">
                                {operator.displayName}
                                {isAlreadyAdded && (
                                  <span
                                    style={{
                                      marginLeft: "8px",
                                      fontSize: "10px",
                                    }}
                                  >
                                    (Already added)
                                  </span>
                                )}
                              </div>
                              {operator.email && (
                                <div className="user-email">{operator.email}</div>
                              )}
                            </div>
                          );
                        })}
                        {isLoadingMoreOperators && hasMoreOperators && (
                          <div className="search-result">
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                padding: "12px",
                              }}
                            >
                              <div
                                className="loading-spinner"
                                style={{
                                  width: "16px",
                                  height: "16px",
                                  margin: "0",
                                }}
                              ></div>
                              <span>Loading more operators...</span>
                            </div>
                          </div>
                        )}
                        {!isLoadingMoreOperators && !hasMoreOperators && (
                          <div className="search-result">
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                padding: "12px",
                                color: "var(--sv-text-subtle)",
                                fontStyle: "italic",
                                fontSize: "12px",
                              }}
                            >
                              All operators loaded
                            </div>
                          </div>
                        )}
                      </>
                    ) : operatorQuery ? (
                      <div className="search-result">
                        <span
                          style={{
                            color: "var(--sv-text-subtle)",
                            fontStyle: "italic",
                          }}
                        >
                          No operators found for "{operatorQuery}"
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}

                {showOperatorDropdown &&
                  !isSearchingOperators &&
                  !operatorQuery &&
                  operatorResults.length > 0 && (
                    <div className="search-dropdown">
                      <div
                        className="search-result"
                        style={{
                          backgroundColor: "var(--sv-bg-tertiary)",
                          cursor: "default",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--sv-text-subtle)",
                            fontStyle: "italic",
                            fontSize: "11px",
                          }}
                        >
                          Recent operators (type to search for more):
                        </span>
                      </div>
                      {operatorResults.map((operator) => {
                        // Check if operator is already added
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
                            onClick={() =>
                              !isAlreadyAdded && onAddOperator(operator)
                            }
                            style={{
                              opacity: isAlreadyAdded ? 0.5 : 1,
                              cursor: isAlreadyAdded
                                ? "not-allowed"
                                : "pointer",
                            }}
                          >
                            <div className="user-name">
                              {operator.displayName}
                              {isAlreadyAdded && (
                                <span
                                  style={{
                                    marginLeft: "8px",
                                    fontSize: "10px",
                                  }}
                                >
                                  (Already added)
                                </span>
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

              <p className="form-help">
                Search for operators by name or email. Type at least{" "}
                <span className="dynamic-value">2 characters</span> to start
                searching. Selected operators will appear above.
              </p>
            </div>
          </div>

          <p className="form-help">
            <strong>Note:</strong> Realm Stewards and Confluence Administrators
            always have these privileges.
          </p>
        </div>
      )}

      {activeTab === "unlock-timeouts" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">Reservation Duration Settings</h3>
            <p className="space-admin-subtitle">
              Configure when file claims should automatically lapse
              in this realm.
            </p>

            <div className="form-control">
              <label className="checkbox-control">
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
                <span className="checkbox-label">
                  Use system default unlock timeouts
                </span>
              </label>

              <p className="form-help">
                When enabled, this realm will inherit the global unlock timeout
                settings configured by administrators.
              </p>

              {realmPrefs.autoUnlockTimeoutHours !== null && (
                <div className="nested-control">
                  <h4>Custom Unlock Schedule</h4>

                  <div className="input-group">
                    <label>Automatically unlock after:</label>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <input
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
                        style={{ width: "80px" }}
                      />
                      <span
                        style={{
                          color: "var(--sv-text-primary)",
                          fontWeight: "500",
                        }}
                      >
                        hours
                      </span>
                    </div>
                  </div>

                  <p className="form-help form-help-highlight">
                    File claims lapse after{" "}
                    <span className="dynamic-value">
                      {realmPrefs.autoUnlockTimeoutHours} hours
                    </span>{" "}
                    of inactivity. This overrides the global system settings for
                    this realm only.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "macro-settings" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">Panel Auto-Insert</h3>
            <p className="space-admin-subtitle">
              Control whether the Sentinel Vault panel is automatically
              inserted at the bottom of pages when the first file is claimed.
            </p>

            <div className="form-control">
              <label className="checkbox-control">
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
                <span className="checkbox-label">
                  Auto-insert panel when a claim is first added
                </span>
              </label>

              <p className="form-help">
                When enabled, the Sentinel Vault panel will be automatically
                added to a page in this realm when a file is first claimed.
                The panel shows claim status, labels, and actions for all
                files on the page. Individual pages can override this
                setting.
              </p>
            </div>
          </div>

          <div
            className="form-section"
            style={{
              opacity: realmPrefs.autoInsertMacro === false ? 0.45 : 1,
              pointerEvents:
                realmPrefs.autoInsertMacro === false ? "none" : "auto",
              transition: "opacity 0.2s",
            }}
          >
            <h3 className="section-header">Panel Position</h3>
            <p className="space-admin-subtitle">
              Choose where the panel will be placed when it is automatically
              inserted into a page.
            </p>

            <div className="form-control">
              <label className="checkbox-control">
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
                <span className="checkbox-label">Top of page</span>
              </label>

              <label className="checkbox-control" style={{ marginTop: "6px" }}>
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
                <span className="checkbox-label">Bottom of page</span>
              </label>

              <p className="form-help">
                This only affects where the panel is placed when it is first
                auto-inserted. Moving an existing panel on a page must be done
                manually through the Confluence editor.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="action-section">
        <button
          className="btn-primary"
          onClick={onSaveRealmPrefs}
          disabled={loading}
        >
          {loading ? "Updating..." : "Apply Configuration"}
        </button>
      </div>
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
