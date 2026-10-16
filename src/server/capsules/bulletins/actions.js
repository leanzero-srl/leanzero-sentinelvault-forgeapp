import { kvs, WhereConditions } from "@forge/kvs";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { canReadPage } from "../../shared/content-access.js";
import { resolveActorName } from "../../infra/activity-log.js";

// The banner sentences that NAME a person (doc-ribbon alertSentence): "An edit to this Approved page
// by {editor} …" for the approver, and the legacy SEAL_CONFLICT line. The dispatch records carry
// account ids only — a name is personal data that would go stale in a stored record and is not
// covered by the privacy sweep there — so the name is looked up here, when a reader who may read
// the page asks, through the same app-side lookup the activity feed uses. Until 2026-10-16 nothing
// set it and the approver read "by someone outside the approvers".
const NAMES_EDITOR = new Set(["workflow-reverted", "workflow-demoted", "SEAL_CONFLICT"]);
const NAMES_OWNER = new Set(["SEAL_CONFLICT"]);
const MAX_NAME_LOOKUPS = 10;
async function withDisplayNames(events) {
  const want = new Set();
  for (const e of events) {
    if (NAMES_EDITOR.has(e?.type) && e.editorAccountId) want.add(e.editorAccountId);
    if (NAMES_OWNER.has(e?.type) && e.ownerAccountId) want.add(e.ownerAccountId);
  }
  if (!want.size) return events;
  const names = new Map();
  for (const id of [...want].slice(0, MAX_NAME_LOOKUPS)) names.set(id, await resolveActorName(id).catch(() => null));
  return events.map((e) => {
    const editorName = NAMES_EDITOR.has(e?.type) ? names.get(e.editorAccountId) : null;
    const ownerName = NAMES_OWNER.has(e?.type) ? names.get(e.ownerAccountId) : null;
    return editorName || ownerName
      ? { ...e, ...(editorName ? { editorDisplayName: editorName } : {}), ...(ownerName ? { ownerDisplayName: ownerName } : {}) }
      : e;
  });
}

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
      // SV-SEC-1: H1-F8 closed the no-pageId case (instance-wide feed) but left this one — a
      // payload-named pageId still returned that page's whole event feed, names and accountIds
      // included, to anyone. Filtering by a page you may not read is still reading it.
      if (!(await canReadPage(requesterAccountId, pageId))) {
        return { success: true, notifications: [] };
      }
      events = await withDisplayNames(events.filter((event) => event.pageId === pageId));
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

  // SV-SEC-1: a watch subscribes the caller to unseal events for a payload-named attachment,
  // so without this you could subscribe to activity on a file you cannot see.
  if (!(await canReadPage(accountId, attachmentId))) {
    return { success: false, error: "Not authorized" };
  }

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
