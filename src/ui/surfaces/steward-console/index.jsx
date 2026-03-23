import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import logo from "../../assets/icons/icon.png";

const GlobalPolicyEditor = () => {
  const [settings, setSettings] = useState({
    defaultSealDurationHours: 24, // Store in hours instead of seconds - ALSO used for auto-unseal timeout
    allowStewardOverride: false,
    autoUnsealEnabled: true,
    allowArtifactDelete: false,
    reminderIntervalDays: 7, // Default: remind operators every 7 days when auto-unseal is off
    // Dispatch settings
    enableFlashMessages: true,
    enableDocRibbons: true,
    enableConfluenceDispatches: true,
    enableEmailDispatches: true,
    enableSealExpiryReminderEmail: true,
    enableAutoUnsealDispatchEmail: true,
    enablePeriodicReminderEmail: true,
  });

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [currentRealmKey, setCurrentRealmKey] = useState(null);
  const [currentRealmName, setCurrentRealmName] = useState("Current Realm");

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        // Initialize palette detection
        await enablePaletteSync();

        setLoading(true);
        setMessage(null);
        setMessageType(null);

        const globalSettings = await invoke("load-policy", {
          scope: "global",
        });

        const context = await view.getContext();
        const realmKey = context.extension?.content?.space?.key;

        if (realmKey) {
          setCurrentRealmKey(realmKey);
          setCurrentRealmName(
            context.extension.content.space?.name || "Current Realm",
          );
        }

        setSettings({
          defaultSealDurationHours: Math.round(
            (globalSettings?.defaultSealDuration || 86400) / 3600,
          ), // Convert seconds to hours
          allowStewardOverride: globalSettings?.allowStewardOverride || false,
          autoUnsealEnabled: globalSettings?.autoUnsealEnabled !== false,
          allowArtifactDelete: globalSettings?.allowArtifactDelete === true,
          reminderIntervalDays: globalSettings?.reminderIntervalDays || 7, // Default: 7 days
          // Dispatch settings - default to true if not set
          enableFlashMessages:
            globalSettings?.enableFlashMessages !== false,
          enableDocRibbons: globalSettings?.enableDocRibbons !== false,
          enableConfluenceDispatches:
            globalSettings?.enableConfluenceDispatches !== false,
          enableEmailDispatches:
            globalSettings?.enableEmailDispatches !== false,
          enableSealExpiryReminderEmail:
            globalSettings?.enableSealExpiryReminderEmail !== false,
          enableAutoUnsealDispatchEmail:
            globalSettings?.enableAutoUnsealDispatchEmail !== false,
          enablePeriodicReminderEmail:
            globalSettings?.enablePeriodicReminderEmail !== false,
        });
      } catch (err) {
        setMessage(
          "Unable to load preferences. Verify your access rights.",
        );
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  const onSavePreferences = async () => {
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);

      await invoke("store-policy", {
        scope: "global",
        data: {
          defaultSealDuration: settings.defaultSealDurationHours * 3600, // Convert hours to seconds - ALSO used for auto-unseal timeout
          allowStewardOverride: settings.allowStewardOverride,
          autoUnsealEnabled: settings.autoUnsealEnabled,
          allowArtifactDelete: settings.allowArtifactDelete,
          reminderIntervalDays: settings.reminderIntervalDays,
          // Dispatch settings
          enableFlashMessages: settings.enableFlashMessages,
          enableDocRibbons: settings.enableDocRibbons,
          enableConfluenceDispatches: settings.enableConfluenceDispatches,
          enableEmailDispatches: settings.enableEmailDispatches,
          enableSealExpiryReminderEmail: settings.enableSealExpiryReminderEmail,
          enableAutoUnsealDispatchEmail:
            settings.enableAutoUnsealDispatchEmail,
          enablePeriodicReminderEmail: settings.enablePeriodicReminderEmail,
        },
      });

      setMessage("Preferences updated successfully!");
      setMessageType("success");
    } catch (err) {
      setMessage(
        "Unable to save preferences. Verify your access rights.",
      );
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const renderTimespan = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Settings</h2>
        <p className="loading-text">
          Retrieving system preferences...
        </p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src={logo}
            alt="Sentinel Vault Logo"
            style={{ height: "32px", width: "auto" }}
          />
          <div>
            <h1 className="admin-title">System-Wide Preferences</h1>
            <p className="admin-subtitle">
              Manage global preferences for Sentinel Vault across every
              realm
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

      <h3 className="section-header">General Preferences</h3>

      <div className="form-group">
        <label className="form-label">Standard Seal Period (Hours)</label>
        <input
          className="form-input"
          type="number"
          value={settings.defaultSealDurationHours}
          onChange={(e) => {
            const value = parseInt(e.target.value);
            if (!isNaN(value)) {
              setSettings((prev) => ({
                ...prev,
                defaultSealDurationHours: Math.max(1, value),
              }));
            }
          }}
          min="1"
          style={{ width: "120px" }}
        />
        <p className="form-help">
          How long artifacts are sealed by default (minimum 1 hour). Realms may
          set their own values.
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.allowStewardOverride}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                allowStewardOverride: e.target.checked,
              }))
            }
          />
          Permit Steward Force-Unseal
        </label>
        <p className="form-help">
          Let stewards unseal artifacts held by other operators.
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.autoUnsealEnabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                autoUnsealEnabled: e.target.checked,
              }))
            }
          />
          Enable Expiry Dispatches
        </label>

        <p className="form-help">
          {settings.autoUnsealEnabled
            ? "Operators will receive periodic dispatches when their seals expire, reminding them to unseal artifacts. Artifacts will not be unsealed automatically."
            : "Artifacts stay sealed until manually unsealed. Timers display 'Overdue' once the seal period ends."}
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.allowArtifactDelete}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                allowArtifactDelete: e.target.checked,
              }))
            }
          />
          Allow Artifact Removal via Inline Panel
        </label>
        <p className="form-help">
          When active, operators may remove unsealed artifacts directly from the
          Sentinel Vault panel on the page. Removed artifacts go to trash and
          can be recovered. Sealed artifacts cannot be removed.
        </p>
      </div>

      {!settings.autoUnsealEnabled && (
        <div className="form-group">
          <label className="form-label">Dispatch Recurrence (Days)</label>
          <input
            className="form-input"
            type="number"
            value={settings.reminderIntervalDays}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value)) {
                setSettings((prev) => ({
                  ...prev,
                  reminderIntervalDays: Math.max(1, value),
                }));
              }
            }}
            min="1"
            style={{ width: "120px" }}
          />
          <p className="form-help">
            Operators receive periodic reminder emails every{" "}
            {settings.reminderIntervalDays} day
            {settings.reminderIntervalDays === 1 ? "" : "s"} about their sealed
            artifacts. This prevents forgotten seals when timed unseal is
            turned off.
          </p>
        </div>
      )}

      <h3 className="section-header">Alert Preferences</h3>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.enableFlashMessages}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                enableFlashMessages: e.target.checked,
              }))
            }
          />
          Enable Transient Notices
        </label>
        <p className="form-help">
          Show brief transient notices to operators when artifact seals are created,
          unsealed, or when unauthorized access is attempted.
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.enableDocRibbons}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                enableDocRibbons: e.target.checked,
              }))
            }
          />
          Enable Document Ribbons
        </label>
        <p className="form-help">
          Display informational ribbons at the top of Confluence pages when
          artifacts are sealed, showing seal status and expiry details.
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.enableConfluenceDispatches}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                enableConfluenceDispatches: e.target.checked,
              }))
            }
          />
          Enable Confluence Comments
        </label>
        <p className="form-help">
          Post native Confluence comment dispatches when artifact seals
          are created, unsealed, or when unauthorized access is attempted.
        </p>
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.enableEmailDispatches}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                enableEmailDispatches: e.target.checked,
              }))
            }
          />
          Enable Email Alerts
        </label>
        <p className="form-help">
          Send email alerts to operators regarding artifact seals. This master
          toggle must be on for any email alerts to function.
        </p>
      </div>

      {settings.enableEmailDispatches && (
        <div className="nested-control">
          <div className="form-group">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={settings.enableSealExpiryReminderEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableSealExpiryReminderEmail: e.target.checked,
                  }))
                }
              />
              Seal Confirmation Emails
            </label>
            <p className="form-help">
              Email operators right after they seal an artifact, confirming the
              seal period and expiry time.
            </p>
          </div>

          <div className="form-group">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={settings.enableAutoUnsealDispatchEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableAutoUnsealDispatchEmail: e.target.checked,
                  }))
                }
              />
              Expiry Dispatch Emails
            </label>
            <p className="form-help">
              Send email dispatches to operators when their artifact seals
              expire, prompting them to unseal the artifact.
            </p>
          </div>

          <div className="form-group">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={settings.enablePeriodicReminderEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enablePeriodicReminderEmail: e.target.checked,
                  }))
                }
              />
              Recurring Reminder Emails
            </label>
            <p className="form-help">
              Send recurring reminder emails about sealed artifacts when timed
              unseal is turned off. Frequency is controlled by the
              Dispatch Recurrence setting.
            </p>
          </div>
        </div>
      )}

      <div className="action-section">
        <button className="btn-primary" onClick={onSavePreferences} disabled={loading}>
          {loading ? "Updating..." : "Apply Configuration"}
        </button>
      </div>
    </div>
  );
};

const RootFrame = () => {
  return <GlobalPolicyEditor />;
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <RootFrame />
  </React.StrictMode>,
);
