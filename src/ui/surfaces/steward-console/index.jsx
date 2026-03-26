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
    allowSealRestore: false,
    allowSealPurge: false,
    enableContentProtection: true,
    reminderIntervalDays: 7,
    enableFlashMessages: true,
    enableDocRibbons: true,
    enableConfluenceDispatches: true,
    enableEmailDispatches: true,
    enableSealExpiryReminderEmail: true,
    enableAutoUnsealDispatchEmail: true,
    enablePeriodicReminderEmail: true,
    globalAutoInsertMacro: false,
    replaceAttachmentsMacro: false,
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
          allowSealRestore: globalSettings?.allowSealRestore === true,
          allowSealPurge: globalSettings?.allowSealPurge === true,
          enableContentProtection: globalSettings?.enableContentProtection !== false,
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
          globalAutoInsertMacro:
            globalSettings?.globalAutoInsertMacro === true,
          replaceAttachmentsMacro:
            globalSettings?.replaceAttachmentsMacro === true,
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
          allowSealRestore: settings.allowSealRestore,
          allowSealPurge: settings.allowSealPurge,
          enableContentProtection: settings.enableContentProtection,
          reminderIntervalDays: settings.reminderIntervalDays,
          enableFlashMessages: settings.enableFlashMessages,
          enableDocRibbons: settings.enableDocRibbons,
          enableConfluenceDispatches: settings.enableConfluenceDispatches,
          enableEmailDispatches: settings.enableEmailDispatches,
          enableSealExpiryReminderEmail: settings.enableSealExpiryReminderEmail,
          enableAutoUnsealDispatchEmail:
            settings.enableAutoUnsealDispatchEmail,
          enablePeriodicReminderEmail: settings.enablePeriodicReminderEmail,
          globalAutoInsertMacro: settings.globalAutoInsertMacro,
          replaceAttachmentsMacro: settings.replaceAttachmentsMacro,
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
              label="Default Seal Duration"
              description="How long attachments stay sealed by default (minimum 1 hour). Individual realms can override this with their own duration."
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
              label="Allow Steward Force-Unseal"
              description="Allow stewards to unseal attachments that were sealed by other users."
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
              label="Enable Seal Expiry Notifications"
              description={
                settings.autoUnsealEnabled
                  ? "Users will receive notifications when their seals expire, reminding them to unseal attachments. Attachments are not unsealed automatically."
                  : "Attachments stay sealed until manually unsealed. Seal timers will show 'Overdue' once the seal duration has passed."
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
              label="Allow Attachment Removal from Page"
              description="When enabled, users can delete unsealed attachments directly from the Sentinel Vault panel in the page banner. Deleted attachments are moved to the trash and can be recovered. Sealed attachments cannot be deleted."
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

            <SettingsRow
              label="Allow Attachment Restore from Page"
              description="When enabled, users and stewards can restore trashed attachments that still have seal data in Sentinel Vault. Permanently deleted attachments cannot be restored."
            >
              <Toggle
                checked={settings.allowSealRestore}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowSealRestore: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Allow Seal Cleanup from Page"
              description="When enabled, users and stewards can remove leftover seal entries for attachments that have been deleted from the page. This cleans up seal data that is no longer needed."
            >
              <Toggle
                checked={settings.allowSealPurge}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowSealPurge: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Protect Sealed Attachments in Page Body"
              description="Automatically undo page edits that remove sealed attachments embedded in the page content (such as images or files inserted into the body)."
            >
              <Toggle
                checked={settings.enableContentProtection}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableContentProtection: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Auto-Insert Macro on Seal"
              description="When enabled, the Sentinel Vault panel macro is automatically inserted into the page when an attachment is sealed. Individual realms can still disable this in their own settings. When disabled, no auto-insertion happens regardless of realm settings."
            >
              <Toggle
                checked={settings.globalAutoInsertMacro}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    globalAutoInsertMacro: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            {settings.globalAutoInsertMacro && (
              <div className="nested-control">
                <SettingsRow
                  label="Replace Attachments Macro"
                  description="When inserting the Sentinel Vault panel, replace the built-in Confluence Attachments macro instead of adding the panel alongside it. If no Attachments macro is found on the page, the panel is inserted at the position configured in realm settings."
                >
                  <Toggle
                    checked={settings.replaceAttachmentsMacro}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        replaceAttachmentsMacro: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>
              </div>
            )}

            {!settings.autoUnsealEnabled && (
              <SettingsRow
                label="Reminder Frequency"
                description={`Users receive a reminder email every ${settings.reminderIntervalDays} day${settings.reminderIntervalDays === 1 ? "" : "s"} about attachments they have sealed. This helps prevent forgotten seals when automatic expiry notifications are turned off.`}
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
              label="Enable Pop-up Notifications"
              description="Show brief pop-up notifications on the page when attachments are sealed, unsealed, or when someone attempts unauthorized access."
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
              label="Enable Page Status Banners"
              description="Display a status banner at the top of Confluence pages when attachments are sealed. The banner shows which attachments are sealed and when each seal expires."
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
              label="Enable Page Comments"
              description="Post a Confluence comment on the page when attachments are sealed, unsealed, or when someone attempts unauthorized access. Comments appear in the page's comment section."
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
              label="Enable Email Notifications"
              description="Send email notifications to users about their sealed attachments. This is the master switch — it must be on for any of the email options below to work."
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
                  description="Send an email to the user immediately after they seal an attachment, confirming the seal duration and when it expires."
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
                  label="Seal Expiry Reminder Emails"
                  description="Send a reminder email to the user when one of their attachment seals has expired, prompting them to unseal it."
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
                  description="Send recurring reminder emails about sealed attachments when automatic expiry notifications are turned off. Frequency is controlled by the Reminder Frequency setting in the General tab."
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
