import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import logo from "../../assets/icons/icon.png";

const SettingsRow = ({ label, description, children }) => (
  <div className="settings-row">
    <div className="settings-row-info">
      <p className="settings-row-label">{label}</p>
      <p className="settings-row-description">{description}</p>
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <label className="form-checkbox">
    <input type="checkbox" checked={checked} onChange={onChange} />
  </label>
);

const GlobalPolicyEditor = () => {
  const [activeTab, setActiveTab] = useState("general");
  const [settings, setSettings] = useState({
    defaultSealDurationHours: 24,
    allowStewardOverride: false,
    autoUnsealEnabled: true,
    allowArtifactDelete: false,
    reminderIntervalDays: 7,
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
  const [messageType, setMessageType] = useState(null);
  const [currentRealmKey, setCurrentRealmKey] = useState(null);
  const [currentRealmName, setCurrentRealmName] = useState("Current Realm");

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
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
          ),
          allowStewardOverride: globalSettings?.allowStewardOverride || false,
          autoUnsealEnabled: globalSettings?.autoUnsealEnabled !== false,
          allowArtifactDelete: globalSettings?.allowArtifactDelete === true,
          reminderIntervalDays: globalSettings?.reminderIntervalDays || 7,
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
          defaultSealDuration: settings.defaultSealDurationHours * 3600,
          allowStewardOverride: settings.allowStewardOverride,
          autoUnsealEnabled: settings.autoUnsealEnabled,
          allowArtifactDelete: settings.allowArtifactDelete,
          reminderIntervalDays: settings.reminderIntervalDays,
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

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          General
        </button>
        <button
          className={`tab-button ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => setActiveTab("alerts")}
        >
          Alerts
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === "general" && (
          <div className="settings-panel">
            <SettingsRow
              label="Standard Seal Period"
              description="How long artifacts are sealed by default (minimum 1 hour). Realms may set their own values."
            >
              <div className="input-with-unit">
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
                />
                <span className="input-unit">hrs</span>
              </div>
            </SettingsRow>

            <SettingsRow
              label="Permit Steward Force-Unseal"
              description="Let stewards unseal artifacts held by other operators."
            >
              <Toggle
                checked={settings.allowStewardOverride}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowStewardOverride: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Expiry Dispatches"
              description={
                settings.autoUnsealEnabled
                  ? "Operators will receive periodic dispatches when their seals expire, reminding them to unseal artifacts. Artifacts will not be unsealed automatically."
                  : "Artifacts stay sealed until manually unsealed. Timers display 'Overdue' once the seal period ends."
              }
            >
              <Toggle
                checked={settings.autoUnsealEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    autoUnsealEnabled: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Allow Artifact Removal via Inline Panel"
              description="When active, operators may remove unsealed artifacts directly from the Sentinel Vault panel on the page. Removed artifacts go to trash and can be recovered. Sealed artifacts cannot be removed."
            >
              <Toggle
                checked={settings.allowArtifactDelete}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowArtifactDelete: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            {!settings.autoUnsealEnabled && (
              <SettingsRow
                label="Dispatch Recurrence"
                description={`Operators receive periodic reminder emails every ${settings.reminderIntervalDays} day${settings.reminderIntervalDays === 1 ? "" : "s"} about their sealed artifacts. This prevents forgotten seals when timed unseal is turned off.`}
              >
                <div className="input-with-unit">
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
                  />
                  <span className="input-unit">days</span>
                </div>
              </SettingsRow>
            )}
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="settings-panel">
            <SettingsRow
              label="Enable Transient Notices"
              description="Show brief transient notices to operators when artifact seals are created, unsealed, or when unauthorized access is attempted."
            >
              <Toggle
                checked={settings.enableFlashMessages}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableFlashMessages: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Document Ribbons"
              description="Display informational ribbons at the top of Confluence pages when artifacts are sealed, showing seal status and expiry details."
            >
              <Toggle
                checked={settings.enableDocRibbons}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableDocRibbons: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Confluence Comments"
              description="Post native Confluence comment dispatches when artifact seals are created, unsealed, or when unauthorized access is attempted."
            >
              <Toggle
                checked={settings.enableConfluenceDispatches}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableConfluenceDispatches: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Email Alerts"
              description="Send email alerts to operators regarding artifact seals. This master toggle must be on for any email alerts to function."
            >
              <Toggle
                checked={settings.enableEmailDispatches}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableEmailDispatches: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            {settings.enableEmailDispatches && (
              <div className="nested-control">
                <SettingsRow
                  label="Seal Confirmation Emails"
                  description="Email operators right after they seal an artifact, confirming the seal period and expiry time."
                >
                  <Toggle
                    checked={settings.enableSealExpiryReminderEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enableSealExpiryReminderEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>

                <SettingsRow
                  label="Expiry Dispatch Emails"
                  description="Send email dispatches to operators when their artifact seals expire, prompting them to unseal the artifact."
                >
                  <Toggle
                    checked={settings.enableAutoUnsealDispatchEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enableAutoUnsealDispatchEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>

                <SettingsRow
                  label="Recurring Reminder Emails"
                  description="Send recurring reminder emails about sealed artifacts when timed unseal is turned off. Frequency is controlled by the Dispatch Recurrence setting."
                >
                  <Toggle
                    checked={settings.enablePeriodicReminderEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enablePeriodicReminderEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="action-bar">
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
