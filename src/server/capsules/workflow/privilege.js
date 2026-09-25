// Is this page under an ENFORCED workflow state (Approved), and is this person one of the
// workflow's privileged editors? READ ONLY (owner, 2026-09-25).
//
// The same rule the page trigger's enforcement probe applies (collectWorkflowEnforcementForPage,
// steps 1–3: approver snapshot ∩ live config — trusting the snapshot when live group expansion
// failed — or a live steward), split out because the probe also DEMOTES the page as a side
// effect and so cannot be asked a question. Used where a seal is made or a held file is changed.
import { asApp, route } from "@forge/api";
import { readPageWorkflow, resolveWorkflowDef, findState, getSpaceWorkflowSettings } from "./logic.js";
import { resolveApproverIds } from "./approvals.js";
import { isAccountStewardAsApp } from "../../shared/steward-checks.js";

/** @returns {Promise<{ enforced: boolean, privileged: boolean, record?: object }>} */
export async function workflowPrivilegeForPage(pageId, accountId) {
  if (!pageId) return { enforced: false, privileged: false };
  let prop = null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=sentinel-vault-workflow`);
    if (res.ok) prop = (await res.json())?.results?.[0]?.value;
  } catch (_) { return { enforced: false, privileged: false }; }
  if (!prop || prop.enforce !== true) return { enforced: false, privileged: false };
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return { enforced: false, privileged: false };
  const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
  if (!findState(def, record.stateId)?.enforce) return { enforced: false, privileged: false };
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  const liveSpec = await resolveApproverIds(settings.approval);
  const liveApprovers = liveSpec?.approvers || [];
  const privileged =
    (Array.isArray(record.approvers) && record.approvers.includes(accountId) && (liveApprovers.includes(accountId) || !!liveSpec?.unresolved))
    || await isAccountStewardAsApp(accountId, record.spaceKey);
  return { enforced: true, privileged: !!privileged, record };
}

export const ENFORCED_SEAL_REFUSAL = "This page is Approved — only its approvers or a space admin can seal on it. Propose a change to its approvers instead.";
