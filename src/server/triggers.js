import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import {
  mailHalfwayReminder,
  mailPeriodicReminder,
  mailExpiryNotice,
  mailViolationAlert,
} from "./infra/mail-composer.js";

import { recordDispatch, postDocFootnote } from "./capsules/bulletins/logic.js";
import { resolveBulletinToggles } from "./shared/bulletin-flags.js";
import { touchSealTimestamp } from "./capsules/sealing/logic.js";

// --- Helpers ---

/**
 * Resolve the app's own Atlassian account ID (cached in KVS).
 * Used to prevent infinite loops when the app edits/restores artifacts.
 */
async function resolveAppAccountId() {
  let systemAccountId = await kvs.get("app-account-id");
  if (!systemAccountId) {
    try {
      const myselfResponse = await asApp().requestConfluence(
        route`/wiki/rest/api/user/current`,
      );
      if (myselfResponse.ok) {
        const myself = await myselfResponse.json();
        systemAccountId = myself.accountId;
        await kvs.set("app-account-id", systemAccountId);
      }
    } catch (e) {
      console.error("Error fetching App Account ID:", e);
    }
  }
  return systemAccountId;
}

// --- Artifact Event Trigger (Forge Trigger) ---
export async function artifactEventTrigger(event) {
  try {
    const { eventType, atlassianId, attachment } = event;

    if (!attachment || !attachment.id) {
      console.error("Invalid artifact event payload");
      return;
    }

    const artifactId = attachment.id;
    const contentId = attachment.container?.id;

    // Prevent infinite loops - ignore actions made by our own app
    const systemAccountId = await resolveAppAccountId();
    if (systemAccountId && atlassianId === systemAccountId) {
      return;
    }

    const sealRecord = await kvs.get(`protection-${artifactId}`);

    if (!sealRecord || !sealRecord.lockedBy) {
      return;
    }

    if (eventType === "avi:confluence:updated:attachment") {
      await handleSealedArtifactEdit(sealRecord, artifactId, contentId, atlassianId, attachment);
    } else if (eventType === "avi:confluence:trashed:attachment") {
      await handleSealedArtifactTrash(sealRecord, artifactId, contentId, atlassianId, attachment);
    }
  } catch (error) {
    console.error("Error in artifact event trigger:", error);
  }
}

// --- Handle unauthorized edit of a sealed artifact ---
async function handleSealedArtifactEdit(sealRecord, artifactId, contentId, atlassianId, attachment) {
  const currentVersion = attachment.version?.number;

  // Allow the seal owner to edit their own sealed artifact
  if (sealRecord.lockedBy === atlassianId) {
    return;
  }

  // Determine target version: prefer the exact version captured at seal time,
  // fall back to currentVersion - 1 for seals created before sealedVersion was tracked.
  const targetVersion = sealRecord.sealedVersion || (currentVersion ? currentVersion - 1 : null);

  if (!targetVersion || targetVersion < 1) {
    console.warn(
      `Cannot revert artifact ${artifactId} - no valid target version (sealedVersion=${sealRecord.sealedVersion}, current=${currentVersion})`,
    );
    return;
  }

  // If the current version already matches the sealed version, no revert needed
  if (currentVersion === targetVersion) {
    return;
  }

  // Get artifact details to obtain the filename for re-upload
  const artifactRoute = route`/wiki/api/v2/attachments/${artifactId}`;
  const artifactResponse = await asApp().requestConfluence(artifactRoute);

  if (!artifactResponse.ok) {
    console.error(
      `Failed to get artifact details: ${artifactResponse.status}`,
    );
    return;
  }

  const artifactDetails = await artifactResponse.json();

  // Download the sealed version
  const downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${targetVersion}`;
  const downloadResponse = await asApp().requestConfluence(downloadRoute);

  if (!downloadResponse.ok) {
    console.error(
      `Failed to download previous version: ${downloadResponse.status}`,
    );
    return;
  }

  // Re-upload the previous version
  const fileBuffer = await downloadResponse.arrayBuffer();
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), artifactDetails.title);
  formData.append(
    "comment",
    "(Sentinel Vault automatically reversed modifications)",
  );
  formData.append("minorEdit", "true");

  const updateRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/data`;
  const updateResponse = await asApp().requestConfluence(updateRoute, {
    method: "POST",
    headers: { "X-Atlassian-Token": "nocheck" },
    body: formData,
  });

  if (!updateResponse.ok) {
    console.error(`Failed to revert artifact: ${updateResponse.status}`);
    return;
  }

  console.warn(`[EDIT-REVERT] Reverted ${artifactDetails.title} to v${targetVersion}`);

  // Send seal violation email to the seal owner
  const artifactName = artifactDetails.title || attachment.fileName;
  await sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, "edit");
}

// --- Handle trashing of a sealed artifact — restore from trash ---
async function handleSealedArtifactTrash(sealRecord, artifactId, contentId, atlassianId, attachment) {
  // Restore even if seal owner trashed — seal contract prevents deletion while active
  const pageId = contentId || sealRecord.contentId;
  const currentVersion = attachment.version?.number;
  const attachmentTitle = attachment.title || sealRecord.attachmentName || "Unknown";

  if (!pageId) {
    console.error(`[TRASH-RESTORE] Cannot restore ${artifactId} — no pageId available`);
    return;
  }

  if (!currentVersion) {
    console.error(`[TRASH-RESTORE] Cannot restore ${artifactId} — no version number in event`);
    return;
  }

  console.warn(`[TRASH-RESTORE] Sealed artifact ${artifactId} trashed by ${atlassianId} — restoring`);

  // Use the v1 attachment properties endpoint with correct required fields
  const restoreRoute = route`/wiki/rest/api/content/${pageId}/child/attachment/${artifactId}`;
  const restoreResponse = await asApp().requestConfluence(restoreRoute, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: artifactId,
      type: "attachment",
      status: "current",
      title: attachmentTitle,
      version: { number: currentVersion + 1 },
    }),
  });

  if (!restoreResponse.ok) {
    const errorText = await restoreResponse.text();
    console.error(`[TRASH-RESTORE] Failed ${artifactId}: ${restoreResponse.status} — ${errorText}`);
    return;
  }

  console.warn(`[TRASH-RESTORE] Restored ${attachmentTitle} (${artifactId})`);

  // Touch seal timestamp so frontend polling picks up the change
  await touchSealTimestamp();

  // Send violation notifications
  await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, attachmentTitle, "delete");
}

// --- Shared violation notification logic ---
async function sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, actionVerb) {
  const bulletinToggles = await resolveBulletinToggles();

  if (bulletinToggles.ENABLE_EMAIL_BULLETINS) {
    try {
      const pageResponse = await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${contentId}`,
      );
      let docTitle = "Confluence Page";
      let pageUrl = "";
      if (pageResponse.ok) {
        const pageData = await pageResponse.json();
        docTitle = pageData.title || "Confluence Page";
        const baseUrl = pageData._links?.base || "";
        const webui = pageData._links?.webui || "";
        pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";
      }

      const emailResult = await mailViolationAlert(
        sealRecord.lockedBy,
        atlassianId,
        artifactId,
        artifactName,
        docTitle,
        pageUrl,
      );

      if (!emailResult.success) {
        console.warn(
          `Failed to send seal violation email: ${emailResult.reason}`,
        );
      }
    } catch (emailError) {
      console.error("Error sending seal violation email:", emailError);
    }
  }

  const dispatchType = actionVerb === "delete" ? "trash-restored" : "edit-reverted";
  const dispatchPayload = {
    id: `notification-${Date.now()}`,
    type: dispatchType,
    attachmentId: artifactId,
    attachmentName: artifactName,
    ownerAccountId: sealRecord.lockedBy,
    editorAccountId: atlassianId,
    timestamp: Date.now(),
    pageId: contentId,
  };

  await recordDispatch(dispatchPayload);

  // Send Confluence notification via comment
  await postDocFootnote(
    contentId,
    sealRecord.lockedBy,
    atlassianId,
    artifactName,
    artifactId,
    actionVerb,
  );

  if (bulletinToggles?.ENABLE_TOAST_DISPATCHES) {
    const violationKey = `violation-alert-${sealRecord.lockedBy}-${artifactId}-${Date.now()}`;
    await kvs.set(violationKey, dispatchPayload, {
      expiresAt: Date.now() + 3600000,
    });
  }
}

// --- Lifecycle Trigger (Forge Trigger) ---
export async function lifecycleTrigger(event) {
  try {
    if (event.eventType === "avi:forge:uninstalled:app") {
      const { results: keys } = await kvs.query().limit(1000).getMany();
      for (const { key } of keys) {
        await kvs.delete(key);
      }
    }
  } catch (error) {
    console.error("Error cleaning up storage:", error);
  }
}

// --- Expiry Sweep Task (Scheduled Job) ---
export async function expirySweepTask() {
  try {
    // Read policy and bulletin toggles once for the entire task
    const systemPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = systemPolicy?.autoUnlockEnabled !== false;
    const bulletinToggles = await resolveBulletinToggles(systemPolicy);

    if (!autoUnsealActive) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0 }),
      };
    }

    // Determine if halfway reminders should be sent
    const sendHalfwayAlerts =
      bulletinToggles.ENABLE_EMAIL_BULLETINS &&
      bulletinToggles.ENABLE_SEAL_EXPIRY_REMINDER_EMAIL;

    const { results: activeSeals } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100)
      .getMany();

    if (!activeSeals || activeSeals.length === 0) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0 }),
      };
    }

    const now = new Date();
    let notifiedCount = 0;
    let halfwayAlertsSent = 0;

    for (const { key, value } of activeSeals) {
      try {
        const artifactId = key.replace("protection-", "");

        if (!value || !value.timestamp || !value.expiresAt) {
          continue;
        }

        const expiresAt = new Date(value.expiresAt);

        // --- Notify on expired seals ---
        if (now >= expiresAt) {
          const dedupKey = `expiry-notified-${artifactId}`;
          const alreadyNotified = await kvs.get(dedupKey);

          if (alreadyNotified) {
            continue;
          }

          // Send expiry notification email
          if (
            bulletinToggles.ENABLE_EMAIL_BULLETINS &&
            bulletinToggles.ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL &&
            value.contentId
          ) {
            try {
              const pageResponse = await asApp().requestConfluence(
                route`/wiki/api/v2/pages/${value.contentId}`,
              );

              if (pageResponse.ok) {
                const pageData = await pageResponse.json();
                const docTitle = pageData.title || "Unknown Page";
                const baseUrl = pageData._links?.base || "";
                const webui = pageData._links?.webui || "";
                const pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";

                const expiryDate = now.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });

                const emailResult = await mailExpiryNotice(
                  value.lockedBy,
                  artifactId,
                  value.attachmentName || "Unknown Attachment",
                  docTitle,
                  pageUrl,
                  expiryDate,
                );

                if (!emailResult.success) {
                  console.warn(
                    `Failed to send expiry notification: ${emailResult.reason}`,
                  );
                }
              }
            } catch (emailError) {
              console.error(
                "Error sending expiry notification email:",
                emailError,
              );
            }
          }

          // Store dedup flag so we don't re-notify
          await kvs.set(dedupKey, {
            sentAt: now.toISOString(),
            attachmentId: artifactId,
          });

          // Store dispatch event for page banner
          await recordDispatch({
            id: `notification-${Date.now()}`,
            type: "reservation-expired",
            attachmentId: artifactId,
            attachmentName: value.attachmentName || "Unknown Attachment",
            ownerAccountId: value.lockedBy,
            timestamp: Date.now(),
            pageId: value.contentId,
          });

          notifiedCount++;
          continue;
        }

        // --- Halfway expiry reminder (only for non-expired seals) ---
        if (!sendHalfwayAlerts || !value.lockedBy || !value.contentId) {
          continue;
        }

        const sealCreatedAt = new Date(value.timestamp);
        const fullPeriod = expiresAt - sealCreatedAt;
        const midpointTime = sealCreatedAt.getTime() + fullPeriod * 0.5;

        if (now.getTime() >= midpointTime && now.getTime() < expiresAt.getTime()) {
          const halfwayKey = `fifty-percent-reminder-sent-${artifactId}`;
          const previouslySent = await kvs.get(halfwayKey);
          if (previouslySent) {
            continue;
          }

          try {
            const pageResponse = await asApp().requestConfluence(
              route`/wiki/api/v2/pages/${value.contentId}`,
            );

            if (pageResponse.ok) {
              const pageData = await pageResponse.json();
              const docTitle = pageData.title || "Unknown Page";
              const baseUrl = pageData._links?.base || "";
              const webui = pageData._links?.webui || "";
              const pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";

              const expiryDate = expiresAt.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              const result = await mailHalfwayReminder(
                value.lockedBy,
                artifactId,
                value.attachmentName || "Unknown Attachment",
                docTitle,
                pageUrl,
                expiryDate,
              );

              if (result.success) {
                await kvs.set(halfwayKey, {
                  sentAt: now.toISOString(),
                });
                halfwayAlertsSent++;
              } else {
                console.warn(
                  `Failed to send halfway reminder for ${artifactId}: ${result.reason}`,
                );
              }
            }
          } catch (emailError) {
            console.error("Error sending halfway reminder email:", emailError);
          }
        }
      } catch (error) {
        console.error(`Error processing seal ${key}:`, error);
      }
    }

    if (notifiedCount > 0 || halfwayAlertsSent > 0) {
      console.warn(`[EXPIRY-SWEEP] ${notifiedCount} expiry notifications, ${halfwayAlertsSent} reminders sent`);
    }
    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ notifiedCount, fiftyPctReminders: halfwayAlertsSent }),
    };
  } catch (error) {
    console.error("Error in expiry sweep task:", error);
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify({ notifiedCount: 0, error: error.message }),
    };
  }
}

/**
 * Recurring nudge task for sealed artifacts
 * Sends reminder emails every X days when auto-unseal is disabled
 */
export async function recurringNudgeTask(request, context) {
  try {
    const systemPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = systemPolicy?.autoUnlockEnabled !== false;
    const nudgeIntervalDays = systemPolicy?.reminderIntervalDays || 7;

    // Only send nudges if auto-unseal is DISABLED
    if (autoUnsealActive) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const bulletinToggles = await resolveBulletinToggles(systemPolicy);
    if (
      !bulletinToggles.ENABLE_PERIODIC_REMINDER_EMAIL ||
      !bulletinToggles.ENABLE_EMAIL_BULLETINS
    ) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const { results: activeSeals } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100)
      .getMany();

    if (activeSeals.length === 0) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const now = new Date();
    const nudgeTally = new Map();

    for (const { key, value } of activeSeals) {
      try {
        if (!value || !value.timestamp) {
          continue;
        }

        const artifactId = key.replace("protection-", "");
        const sealCreatedAt = new Date(value.timestamp);
        const daysHeld = Math.floor(
          (now - sealCreatedAt) / (1000 * 60 * 60 * 24),
        );

        // Check if we need to send a nudge
        const nudgeKey = `reminder-sent-${artifactId}`;
        const priorNudgeData = await kvs.get(nudgeKey);

        const nudgeDue =
          !priorNudgeData ||
          Math.floor(
            (now - new Date(priorNudgeData.sentAt)) / (1000 * 60 * 60 * 24),
          ) >= nudgeIntervalDays;

        if (!nudgeDue) {
          continue;
        }

        const artifactIdValue = value.attachmentId || artifactId;
        const artifactName = value.attachmentName || "Unknown Attachment";
        const contentId = value.contentId;

        if (contentId) {
          try {
            const pageResponse = await asApp().requestConfluence(
              route`/wiki/api/v2/pages/${contentId}`,
            );

            if (pageResponse.ok) {
              const pageData = await pageResponse.json();
              const docTitle = pageData.title || "Unknown Page";
              const baseUrl = pageData._links?.base || "";
              const webui = pageData._links?.webui || "";
              const pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";

              const sealDate = sealCreatedAt.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              });

              const result = await mailPeriodicReminder(
                value.lockedBy,
                artifactIdValue,
                artifactName,
                docTitle,
                pageUrl,
                sealDate,
                daysHeld,
              );
              if (result.success) {
                await kvs.set(nudgeKey, {
                  sentAt: now.toISOString(),
                  reminderNumber: (priorNudgeData?.reminderNumber || 0) + 1,
                });

                nudgeTally.set(
                  artifactId,
                  (nudgeTally.get(artifactId) || 0) + 1,
                );
              } else {
                console.warn(
                  `Failed to send nudge for artifact ${artifactId}: ${result.reason}`,
                );
              }
            }
          } catch (emailError) {
            console.error("Error sending recurring nudge email:", emailError);
          }
        }
      } catch (error) {
        console.error(`Error processing seal ${key} for nudge:`, error);
      }
    }

    const totalNudges = Array.from(nudgeTally.values()).reduce(
      (a, b) => a + b,
      0,
    );
    if (totalNudges > 0) {
      console.warn(`[NUDGE] ${totalNudges} reminder emails sent`);
    }
    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ reminderCount: totalNudges }),
    };
  } catch (error) {
    console.error("Error in recurring nudge task:", error);
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify({ reminderCount: 0, error: error.message }),
    };
  }
}

// halfwayCheckTask merged into expirySweepTask. Kept as no-op for manifest compatibility.
export async function halfwayCheckTask() {
  return { statusCode: 200, headers: {}, body: JSON.stringify({ reminderCount: 0 }) };
}
