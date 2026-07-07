/*
 * Workflow state engine (ledger #42) — resolver actions.
 * Thin adapters: pull pageId / spaceKey / accountId from `req`, apply authz,
 * delegate to logic.js. Enforcement (#44) and the approver model (#43) land later.
 */
import { asApp, asUser, route } from "@forge/api";
import { kvs } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
import {
  resolveWorkflowDef,
  loadWorkflowConfig,
  storeWorkflowConfig,
  getPageWorkflow,
  getWorkflowLog,
  assignPageWorkflow,
  transitionPageWorkflow,
  findState,
  getSpaceWorkflowSettings,
  setSpaceWorkflowSettings,
  bulkAssignPagesInSpace,
  readPageWorkflow,
  validateTransition,
  fetchLivePageVersion,
} from "./logic.js";
import {
  extractApprovalConfig,
  resolveApproverIds,
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
  listMyApprovals,
} from "./approvals.js";

const pageIdOf = (req) =>
  req.payload?.pageId ||
  req.context?.extension?.content?.id ||
  req.context?.extension?.content?.content?.id ||
  null;

const spaceKeyOf = (req) =>
  req.payload?.spaceKey ||
  req.context?.extension?.content?.space?.key ||
  req.context?.extension?.space?.key ||
  null;

async function actorName() {
  try {
    const res = await asUser().requestConfluence(route`/wiki/rest/api/user/current`);
    if (res.ok) return (await res.json()).displayName || null;
  } catch (_) { /* best-effort */ }
  return null;
}

const getWorkflow = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { assigned: false, reason: "No page context" };
  const result = await getPageWorkflow(pageId, spaceKeyOf(req));
  // Flag which available transitions require approval (enforce state + approvers
  // configured) so the ribbon can say "Request approval" instead of "Move to".
  if (result?.assigned && Array.isArray(result.available)) {
    const settings = await getSpaceWorkflowSettings(result.record?.spaceKey || spaceKeyOf(req));
    const hasApprovers = !!extractApprovalConfig(settings.approval);
    result.available = result.available.map((s) => ({ ...s, requiresApproval: !!(s.enforce && hasApprovers) }));
  }
  if (req.payload?.withLog) result.log = await getWorkflowLog(pageId);
  return result;
};

const getLog = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { log: [] };
  return { log: await getWorkflowLog(pageId) };
};

const assignWorkflow = async (req) => {
  const pageId = pageIdOf(req);
  const spaceKey = spaceKeyOf(req);
  const actorAccountId = req.context?.accountId;
  // Assigning a workflow is a steward act in v1 (per-page-owner assignment arrives with #43).
  if (!(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: "Only a realm steward can assign a workflow" };
  }
  return assignPageWorkflow({
    pageId,
    spaceKey,
    actorAccountId,
    actorName: await actorName(),
    workflowId: req.payload?.workflowId,
  });
};

const requestTransition = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  const toStateId = req.payload?.toStateId;
  if (!pageId || !toStateId) return { success: false, reason: "pageId and toStateId required" };

  // Authoritative space = the page's OWN workflow record, never a caller-supplied
  // spaceKey (else a steward of space X could drive an enforce transition on a page in
  // space Y). A transition requires the page to already have a workflow.
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const spaceKey = current.spaceKey || spaceKeyOf(req);

  // Entering an `enforce`-marked state (e.g. Approved): if the space has approvers
  // configured (#43), open a multi-approver approval instead of transitioning now;
  // otherwise fall back to the #42 steward gate.
  const def = await resolveWorkflowDef(spaceKey);
  const target = findState(def, toStateId);
  if (target?.enforce) {
    const settings = await getSpaceWorkflowSettings(spaceKey);
    const spec = await resolveApproverIds(settings.approval);
    if (spec) {
      const check = validateTransition(def, current.stateId, toStateId);
      if (!check.ok) return { success: false, reason: check.reason };
      // Don't let a re-request silently discard approvers' already-recorded decisions.
      const existing = await getPageApprovalStatus(pageId);
      if (existing?.pending && existing.requestedBy !== actorAccountId && !(await authorizeSteward(actorAccountId, spaceKey))) {
        return { success: false, reason: "An approval is already pending for this page" };
      }
      const names = {};
      (settings.approval.approvers || []).forEach((a) => { if (a.id) names[a.id] = a.name; });
      return requestApprovalTransition({
        pageId, toStateId, toStateName: target.name, spaceKey, approvers: spec.approvers, mode: spec.mode, min: spec.min,
        actorAccountId, actorName: await actorName(), pinnedVersion: await fetchLivePageVersion(pageId), approverNames: names,
      });
    }
    if (!(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: `Entering "${target.name}" requires steward approval` };
    }
    // #44 direct steward path (no approvers configured): the steward IS the reviewing
    // authority acting on what they see now. Capture approvedVersion = live version and
    // fail CLOSED on null (don't enter a half-enforced state). Snapshot the current
    // configured approver set (may be []) so the enforce pass knows who may edit.
    const approvedVersion = await fetchLivePageVersion(pageId);
    if (approvedVersion == null) {
      return { success: false, reason: "Could not verify the page version — please retry." };
    }
    const snap = (await resolveApproverIds(settings.approval))?.approvers || [];
    return transitionPageWorkflow({
      pageId, spaceKey, toStateId, actorAccountId, actorName: await actorName(),
      reason: req.payload?.reason, approvers: snap, approvedVersion,
    });
  }
  return transitionPageWorkflow({
    pageId,
    spaceKey,
    toStateId,
    actorAccountId,
    actorName: await actorName(),
    reason: req.payload?.reason,
  });
};

const decideApprovalAction = async (req) => {
  const pageId = pageIdOf(req);
  const { decision, reason } = req.payload || {};
  if (!pageId) return { success: false, reason: "No page context" };
  return decideApproval({ pageId, approverAccountId: req.context?.accountId, decision, reason, actorName: await actorName() });
};

const getPageApprovals = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { pending: false };
  return getPageApprovalStatus(pageId);
};

const listMyApprovalsAction = async (req) => {
  const raw = await listMyApprovals(req.context?.accountId);
  const out = [];
  for (const r of raw.slice(0, 25)) { // bounded — the inbox is a working list, not a report
    const pending = await kvs.get(`workflow-pending-${r.pageId}`);
    if (!pending) continue; // resolved since; skip stale record
    let pageTitle = null;
    let spaceKey = null;
    try {
      const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${r.pageId}`);
      if (res.ok) { const p = await res.json(); pageTitle = p?.title; spaceKey = p?.spaceId; }
    } catch (_) { /* best-effort */ }
    out.push({
      pageId: r.pageId,
      pageTitle: pageTitle || `Page ${r.pageId}`,
      spaceKey,
      toStateName: pending.toStateName || r.stateId,
      requestedByName: pending.requestedByName || null,
      requestedAt: r.requestedAt,
      mode: pending.mode || "any",
    });
  }
  return { approvals: out };
};

// User search for the approver picker (steward config). Confluence user search.
const searchUsers = async (req) => {
  const q = (req.payload?.query || "").trim();
  if (q.length < 2) return { users: [] };
  try {
    const cql = `user.fullname~"${q.replace(/"/g, "")}"`;
    const res = await asApp().requestConfluence(route`/wiki/rest/api/search/user?cql=${cql}&limit=8`);
    if (!res.ok) return { users: [] };
    const body = await res.json();
    const users = (body?.results || [])
      .map((r) => ({ accountId: r.user?.accountId, name: r.user?.displayName || r.user?.publicName }))
      .filter((u) => u.accountId);
    return { users };
  } catch (_) {
    return { users: [] };
  }
};

// Group search for the approver picker (any member of a chosen group can approve).
const searchGroups = async (req) => {
  const q = (req.payload?.query || "").trim();
  if (q.length < 1) return { groups: [] };
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/group/picker?query=${q}&limit=8`);
    if (!res.ok) return { groups: [] };
    const body = await res.json();
    const groups = (body?.results || []).map((g) => ({ id: g.id || g.name, name: g.name })).filter((g) => g.name);
    return { groups };
  } catch (_) {
    return { groups: [] };
  }
};

const loadConfig = async (req) => {
  const { scope, key } = req.payload || {};
  return loadWorkflowConfig(scope || "global", key);
};

const storeConfig = async (req) => {
  const { scope, key, def } = req.payload || {};
  const realmKey = key || spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, realmKey))) {
    return { success: false, reason: "Only a realm steward can edit workflow definitions" };
  }
  return storeWorkflowConfig(scope || "global", key, def);
};

const getSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  const settings = await getSpaceWorkflowSettings(spaceKey);
  const def = await resolveWorkflowDef(spaceKey);
  return { settings, def }; // def.states power the read-only preview chips in the config UI
};

const setSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a realm steward can change workflow settings" };
  }
  return setSpaceWorkflowSettings(spaceKey, req.payload?.settings || {});
};

// Apply the space's workflow to existing pages without one (steward). Resolves the
// space id, then delegates the bounded scan+assign to the shared logic function.
const bulkAssign = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a realm steward can apply workflows" };
  }
  const settings = await getSpaceWorkflowSettings(spaceKey);
  if (!settings.enabled) return { success: false, reason: "Enable workflow for this space first" };

  let spaceId = req.payload?.spaceId
    || req.context?.extension?.space?.id
    || req.context?.extension?.content?.space?.id;
  if (!spaceId) {
    const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (sres.ok) spaceId = (await sres.json())?.results?.[0]?.id;
  }
  if (!spaceId) return { success: false, reason: "Could not resolve the space" };

  return bulkAssignPagesInSpace({ spaceKey, spaceId, cursor: req.payload?.cursor || null, actorAccountId: req.context?.accountId });
};

export const actions = [
  ["get-page-workflow", getWorkflow],
  ["get-workflow-log", getLog],
  ["assign-workflow", assignWorkflow],
  ["request-transition", requestTransition],
  ["load-workflow-config", loadConfig],
  ["store-workflow-config", storeConfig],
  ["get-space-workflow-settings", getSpaceSettings],
  ["set-space-workflow-settings", setSpaceSettings],
  ["bulk-assign-workflow", bulkAssign],
  ["decide-approval", decideApprovalAction],
  ["get-page-approvals", getPageApprovals],
  ["list-my-approvals", listMyApprovalsAction],
  ["search-workflow-users", searchUsers],
  ["search-workflow-groups", searchGroups],
];
