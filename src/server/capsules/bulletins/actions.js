import { kvs, WhereConditions } from "@forge/kvs";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";

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
const recentDispatches = async (req) => {
  const { pageId } = req.payload;

  try {
    const recentNotifications = (await kvs.get("recent-notifications")) || {
      events: [],
    };

    let events = recentNotifications.events || [];
    if (pageId) {
      events = events.filter((event) => event.pageId === pageId);
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
const operatorDispatches = async (req) => {
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
const acknowledgeDispatch = async (req) => {
  const { notificationId } = req.payload;

  try {
    const recentNotifications = (await kvs.get("recent-notifications")) || {
      events: [],
    };

    recentNotifications.events = recentNotifications.events.filter(
      (event) => event.id !== notificationId,
    );

    await kvs.set("recent-notifications", recentNotifications);

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
const watchArtifact = async (req) => {
  const { attachmentId } = req.payload;
  const { accountId } = req.context;

  try {
    const watchKey = `notify-request-${attachmentId}-${accountId}`;
    const watchData = {
      attachmentId,
      accountId,
      requestedAt: Date.now(),
    };

    await kvs.set(watchKey, watchData, {
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    });

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
const checkWatch = async (req) => {
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
const unwatchArtifact = async (req) => {
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
    const alertPrefix = `alert-${operatorAccountId}-`;
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
const listBreachDispatches = async (req) => {
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
