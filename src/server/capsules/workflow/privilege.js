// Is this page under an ENFORCED workflow state (Approved), and is this person one of the
// workflow's privileged editors? READ ONLY (owner, 2026-09-25).
//
// The same rule the page trigger's enforcement probe applies (collectWorkflowEnforcementForPage,
// steps 1–3: approver snapshot ∩ live config — trusting the snapshot when live group expansion
// failed — or a live steward), split out because the probe also DEMOTES the page as a side
// effect and so cannot be asked a question. Used where a seal is made or a held file is changed.
import { readPageWorkflow, resolveWorkflowDef } from "./logic.js";
import { recordAuthority } from "../../shared/content-access.js";
import { approvedPageJudge } from "./sanctioned.js"; // the ONE privileged-author rule
import { isEnforcedNow } from "./enforce-rules.js"; // the ONE "enforced right now" rule

/**
 * Reads the workflow RECORD (the source of truth), never the `sentinel-vault-workflow` page property
 * (a mirror for CQL and the UI that an editor can delete).
 * Throws when the record or the definition cannot be read — callers fail closed (sealGateForPage).
 * @returns {Promise<{ enforced: boolean, privileged: boolean, unknown?: boolean, record?: object }>}
 */
export async function workflowPrivilegeForPage(pageId, accountId) {
  if (!pageId) return { enforced: false, privileged: false };
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return { enforced: false, privileged: false };
  // Same as the trigger's probe: where the page is now decides who is a steward, a moved page keeps
  // the protection it was approved under, the approver arm needs no lookup, and a failed lookup
  // leaves only that arm (enforced, not privileged otherwise).
  const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null });
  const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
  if (!isEnforcedNow(record, def, auth)) return { enforced: false, privileged: false };
  // 8.12.0: a check a 429 left open is unknown, like a failed lookup: enforced, not privileged.
  const { judge } = await approvedPageJudge(record, { spaces: auth.known ? auth.spaces : null });
  const j = await judge(accountId);
  return j.unknown ? { enforced: true, privileged: false, unknown: true, record } : { enforced: true, privileged: j.privileged, record };
}

export const ENFORCED_SEAL_REFUSAL = "This page is Approved — only its approvers or a space admin can seal on it. Propose a change to its approvers instead.";
export const SEAL_CHECK_FAILED = "Could not check this page's approval right now. Nothing was changed. Try again in a minute.";

/**
 * SEC-2: the gate every NEW seal on a page passes (attachment and section seals): null to go on, or
 * the refusal to return. On an Approved page only the workflow's privileged set seals, and never over
 * a save the approval does not cover yet (workflow/sanctioned.js refuseSealOverPendingChange). A check
 * that throws, or a privileged check Confluence left open (429), refuses.
 */
export async function sealGateForPage(pageId, accountId) {
  let p;
  try { p = await workflowPrivilegeForPage(pageId, accountId); } catch (_) { return { success: false, busy: true, reason: SEAL_CHECK_FAILED }; }
  if (!p.enforced) return null;
  if (p.unknown) return { success: false, busy: true, reason: SEAL_CHECK_FAILED };
  if (!p.privileged) return { success: false, reason: ENFORCED_SEAL_REFUSAL };
  const { refuseSealOverPendingChange } = await import("./sanctioned.js");
  return refuseSealOverPendingChange(pageId, p.record);
}
