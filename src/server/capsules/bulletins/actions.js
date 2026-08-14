import { kvs, WhereConditions } from "@forge/kvs";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { setWithTtl } from "../../shared/kvs-ttl.js";

/**
 * Get bulletin toggle flags
 */
const loadBulletinToggles = async () => {
  const flags = await resolveBulletinToggles();
  return {
    success: true,
    flags: flags,
  };
};

/**
 * Get recent dispatches for page banner
 */
export const recentDispatches = async (req) => {
  const { pageId } = req.payload;
  const requesterAccountId = req.context.accountId;

  try {
    const recentNotifications = (await kvs.get("recent-notifications")) || {
      events: [],
    };

    let events = recentNotifications.events || [];
    if (pageId) {
      events = events.filter((event) => event.pageId === pageId);
    } else {
      // Hunt H1-F8: without a pageId this would hand any authenticated user the
      // instance-wide feed (names, page ids, accountIds). Scope to the requester's
      // own events, mirroring operatorDispatches.
      events = events.filter(
        (event) =>
          event.ownerAccountId === requesterAccountId ||
          event.editorAccountId === requesterAccountId,
      );
    }

    return {
      success: true,
      notifications: events,
    };
  } catch (error) {
    console.error("Error fetching recent dispatches:", error);
    return {
      success: false,
      notifications: [],
    };
  }
};

/**
 * Get dispatches for current operator
 */
export const operatorDispatches = async (req) => {
  const operatorAccountId = req.context.accountId;

  try {
    const recentNotifications = (await kvs.get("recent-notifications")) || {
      events: [],
    };

    const operatorNotifications = recentNotifications.events.filter(
      (event) =>
        event.ownerAccountId === operatorAccountId ||
        event.editorAccountId === operatorAccountId,
    );

    return {
      success: true,
      notifications: operatorNotifications,
    };
  } catch (error) {
    console.error("Error fetching operator dispatches:", error);
    return {
      success: false,
      notifications: [],
    };
  }
};

/**
 * Acknowledge (dismiss) a specific dispatch
 */
export const acknowledgeDispatch = async (req) => {
  // Hunt H1-F3: the ribbon sends dispatchId, older callers notificationId — accept both.
  const { notificationId, dispatchId } = req.payload;
  const targetId = notificationId || dispatchId;
  const requesterAccountId = req.context.accountId;

  if (!targetId) {
    return { success: false };
  }

  try {
    const recentNotifications = (await kvs.get("recent-notifications")) || {
      events: [],
    };

    // Hunt H1-F8 (dismissal half): only the event's owner/editor may dismiss it —
    // keep everything else, including a matching id the requester doesn't own.
    recentNotifications.events = recentNotifications.events.filter(
      (event) =>
        event.id !== targetId ||
        (event.ownerAccountId !== requesterAccountId &&
          event.editorAccountId !== requesterAccountId),
    );

    // Re-apply recordDispatch's 1h retention — a plain set would make the dismissal
    // rewrite permanent (H1-F3).
    await setWithTtl("recent-notifications", recentNotifications, 3600000);

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error acknowledging dispatch:", error);
    return {
      success: false,
    };
  }
};

/**
 * Request notification when artifact is unsealed (watch)
 */
export const watchArtifact = async (req) => {
  const { attachmentId } = req.payload;
  const { accountId } = req.context;

  try {
    const watchKey = `notify-request-${attachmentId}-${accountId}`;
    const watchData = {
      attachmentId,
      accountId,
      requestedAt: Date.now(),
    };

    await setWithTtl(watchKey, watchData, 7 * 24 * 3600 * 1000);

    return {
      success: true,
      message: "Notification request saved",
    };
  } catch (error) {
    console.error("Error requesting watch:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Check if operator has requested notification for an artifact
 */
export const checkWatch = async (req) => {
  const { attachmentId } = req.payload;
  const { accountId } = req.context;

  try {
    const watchKey = `notify-request-${attachmentId}-${accountId}`;
    const watchData = await kvs.get(watchKey);

    return {
      success: true,
      requested: !!watchData,
    };
  } catch (error) {
    console.error("Error checking watch:", error);
    return {
      success: false,
      requested: false,
    };
  }
};

/**
 * Cancel watch request for an artifact
 */
export const unwatchArtifact = async (req) => {
  const { attachmentId } = req.payload;
  const { accountId } = req.context;

  try {
    const watchKey = `notify-request-${attachmentId}-${accountId}`;
    await kvs.delete(watchKey);

    return {
      success: true,
      message: "Notification request cancelled",
    };
  } catch (error) {
    console.error("Error cancelling watch:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Clear operator alert dispatches from storage
 */
const flushOperatorDispatches = async (req) => {
  const operatorAccountId = req.context.accountId;

  try {
    // Hunt H1-F9: alert keys are written as violation-alert-{accountId}-… (triggers.js) —
    // the old `alert-` prefix matched nothing, making this action a permanent no-op.
    const alertPrefix = `violation-alert-${operatorAccountId}-`;
    const { results: alerts } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith(alertPrefix))
      .limit(50)
      .getMany();

    for (const { key } of alerts) {
      await kvs.delete(key);
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error clearing operator alerts:", error);
    return {
      success: false,
    };
  }
};

/**
 * List breach dispatches for the current operator
 */
export const listBreachDispatches = async (req) => {
  const operatorAccountId = req.context.accountId;

  try {
    const alertPrefix = `violation-alert-${operatorAccountId}-`;
    const { results: alerts } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith(alertPrefix))
      .limit(50)
      .getMany();

    const alertData = [];
    for (const { key, value } of alerts) {
      alertData.push(value);
      await kvs.delete(key);
    }

    return alertData;
  } catch (error) {
    console.error("Failed to get breach dispatches:", error);
    return [];
  }
};

export const actions = [
  ["load-bulletin-toggles", loadBulletinToggles],
  ["recent-dispatches", recentDispatches],
  ["operator-dispatches", operatorDispatches],
  ["acknowledge-dispatch", acknowledgeDispatch],
  ["watch-artifact", watchArtifact],
  ["check-watch", checkWatch],
  ["unwatch-artifact", unwatchArtifact],
  ["flush-operator-dispatches", flushOperatorDispatches],
  ["list-breach-dispatches", listBreachDispatches],
];
