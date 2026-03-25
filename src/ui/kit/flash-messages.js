/**
 * Flash Message Utilities
 *
 * This module provides flash message functionality using
 * Atlassian Forge's showFlag API.
 *
 * To disable: Set ENABLE_TOAST_DISPATCHES = false in src/resolvers/index.js
 */

import { showFlag } from "@forge/bridge";
import { invoke } from "@forge/bridge";

/**
 * Check if flash messages are enabled
 * @returns {Promise<boolean>} - True if flash messages are enabled
 */
export async function flashMessagesEnabled() {
  try {
    const result = await invoke("load-bulletin-toggles");
    return result?.flags?.ENABLE_TOAST_DISPATCHES === true;
  } catch (error) {
    console.error("Error checking notification flags:", error);
    return false;
  }
}

/**
 * Show notification when user tries to edit sealed artifact
 * This notification is shown to the EDITOR (person who tried to edit)
 * @param {string} sealerName - Name of the user who sealed the artifact
 * @param {string} artifactName - Name of the sealed artifact
 */
export function flashSealConflict(sealerName, artifactName) {
  return showFlag({
    id: "seal-conflict-" + Date.now(),
    title: "File currently reserved",
    description: `"${artifactName}" is held by ${sealerName}. Your modifications will not persist.`,
    type: "warning",
    appearance: "warning",
    isAutoDismiss: false,
    actions: [
      {
        text: "Acknowledged",
        onClick: () => {},
      },
    ],
  });
}

/**
 * Show notification when edit is rolled back
 * This notification is shown to the EDITOR (person whose edit was rolled back)
 * @param {string} artifactName - Name of the artifact that was rolled back
 * @param {string} sealerName - Name of the user who sealed the artifact
 */
export function flashEditRolledBack(artifactName, sealerName) {
  return showFlag({
    id: "edit-rolled-back-" + Date.now(),
    title: "Modifications rolled back",
    description: `Your changes to "${artifactName}" were reversed. ${sealerName} holds this file.`,
    type: "error",
    appearance: "error",
    isAutoDismiss: false,
    actions: [
      {
        text: "Understood",
        onClick: () => {},
      },
    ],
  });
}

/**
 * Show notification to seal owner when someone tries to edit
 * This notification is shown to the SEAL OWNER
 * @param {string} editorName - Name of the user who tried to edit
 * @param {string} artifactName - Name of the artifact being edited
 */
export function flashEditBlocked(editorName, artifactName) {
  return showFlag({
    id: "seal-attempt-" + Date.now(),
    title: "Modification intercepted",
    description: `${editorName} attempted to modify "${artifactName}". The changes were reversed.`,
    type: "info",
    appearance: "info",
    isAutoDismiss: true,
  });
}

/**
 * Show success notification when seal is released
 * @param {string} artifactName - Name of the unsealed artifact
 */
export function flashArtifactUnsealed(artifactName) {
  return showFlag({
    id: "seal-released-" + Date.now(),
    title: "Reservation cleared",
    description: `"${artifactName}" is now open for modifications.`,
    type: "success",
    appearance: "success",
    isAutoDismiss: true,
  });
}

/**
 * Show success notification when seal is acquired
 * @param {string} artifactName - Name of the sealed artifact
 */
export function flashArtifactSealed(artifactName) {
  return showFlag({
    id: "seal-acquired-" + Date.now(),
    title: "File reserved",
    description: `"${artifactName}" is now under your exclusive control.`,
    type: "success",
    appearance: "success",
    isAutoDismiss: true,
  });
}

/**
 * Check for and display notifications for the current user
 * Call this when page/modal loads
 *
 * NOTE: Conflict notifications removed - page refresh prevents flash messages from showing.
 * Use Page Banner (Option 2) and Confluence Comments (Option 3) for conflict notifications instead.
 * This function is kept for potential future use but not currently called.
 *
 * @param {string} userAccountId - The user's account ID
 * @returns {Promise<void>}
 */
export async function checkAndDisplayUserAlerts(userAccountId) {
  return;
}

/**
 * Export all flash message functions
 */
export default {
  flashMessagesEnabled,
  flashSealConflict,
  flashEditRolledBack,
  flashEditBlocked,
  flashArtifactUnsealed,
  flashArtifactSealed,
  checkAndDisplayUserAlerts,
};
