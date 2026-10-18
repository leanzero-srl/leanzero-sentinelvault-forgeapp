// Is this page under an ENFORCED workflow state (Approved), and is this person one of the
// workflow's privileged editors? READ ONLY (owner, 2026-09-25).
//
// The same rule the page trigger's enforcement probe applies (collectWorkflowEnforcementForPage,
// steps 1–3: approver snapshot ∩ live config — trusting the snapshot when live group expansion
// failed — or a live steward), split out because the probe also DEMOTES the page as a side
// effect and so cannot be asked a question. Used where a seal is made or a held file is changed.
import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { readPageWorkflow, resolveWorkflowDef, findState, getSpaceWorkflowSettings } from "./logic.js";
import { resolveApproverIds } from "./approvals.js";
import { accountStewardStatusAsApp } from "../../shared/steward-checks.js";
import { recordAuthority, stewardOfSpacesStatus } from "../../shared/content-access.js";

/** @returns {Promise<{ enforced: boolean, privileged: boolean, record?: object }>} */
export async function workflowPrivilegeForPage(pageId, accountId) {
  if (!pageId) return { enforced: false, privileged: false };
  let prop = null;
  try {
    const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=sentinel-vault-workflow`);
    if (res.ok) prop = (await res.json())?.results?.[0]?.value;
  } catch (_) { return { enforced: false, privileged: false }; }
  if (!prop || prop.enforce !== true) return { enforced: false, privileged: false };
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return { enforced: false, privileged: false };
  // Same as the trigger's probe: where the page is now decides who is a steward, a moved page keeps
  // the protection it was approved under, the approver arm needs no lookup, and a failed lookup
  // leaves only that arm (enforced, not privileged otherwise).
  const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null });
  const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
  if (!findState(def, record.stateId)?.enforce && !((auth.moved || !auth.known) && record.enforce === true)) return { enforced: false, privileged: false };
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  const liveSpec = await resolveApproverIds(settings.approval);
  const liveApprovers = liveSpec?.approvers || [];
  if (Array.isArray(record.approvers) && record.approvers.includes(accountId) && (liveApprovers.includes(accountId) || !!liveSpec?.unresolved)) {
    return { enforced: true, privileged: true, record };
  }
  if (!auth.known) return { enforced: true, privileged: false, unknown: true, record };
  // 8.12.0: a check a 429 left open is unknown, like a failed lookup: enforced, not privileged.
  const st = await stewardOfSpacesStatus(accountStewardStatusAsApp, accountId, auth.spaces);
  return st.unknown ? { enforced: true, privileged: false, unknown: true, record } : { enforced: true, privileged: st.steward, record };
}

export const ENFORCED_SEAL_REFUSAL = "This page is Approved — only its approvers or a space admin can seal on it. Propose a change to its approvers instead.";
