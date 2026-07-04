/*
 * Workflow state engine (ledger #42) — resolver actions.
 * Thin adapters: pull pageId / spaceKey / accountId from `req`, apply authz,
 * delegate to logic.js. Enforcement (#44) and the approver model (#43) land later.
 */
import { asUser, route } from "@forge/api";

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
} from "./logic.js";

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
  const spaceKey = spaceKeyOf(req);
  const actorAccountId = req.context?.accountId;
  const toStateId = req.payload?.toStateId;
  if (!toStateId) return { success: false, reason: "toStateId required" };

  // Entering an `enforce`-marked state (e.g. Approved) is steward-gated until the
  // #43 approver model replaces this guard. Other transitions are open to any actor.
  const def = await resolveWorkflowDef(spaceKey);
  const target = findState(def, toStateId);
  if (target?.enforce && !(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: `Entering "${target.name}" requires steward approval` };
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

export const actions = [
  ["get-page-workflow", getWorkflow],
  ["get-workflow-log", getLog],
  ["assign-workflow", assignWorkflow],
  ["request-transition", requestTransition],
  ["load-workflow-config", loadConfig],
  ["store-workflow-config", storeConfig],
];
