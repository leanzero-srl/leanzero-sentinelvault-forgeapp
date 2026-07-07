/*
 * Approval notification comments (#43). Posts a Confluence footer comment that
 * @mentions the relevant people, so Confluence's own notification engine emails
 * them — no external egress. Mirrors validation-blueprints.js.
 */
import { postCommentWithMention } from "./outbound-notify.js";

const HEADER = "🛡️ Sentinel Vault";

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function mention(accountId) {
  return `<ac:link><ri:user ri:account-id="${escapeXml(accountId)}" /></ac:link>`;
}

// Notify the approvers that they have a pending sign-off. `approvers` = [{ id, name }].
export async function notifyApprovalRequested({ pageId, targetName, approvers, requestedByName, mode, min }) {
  if (!pageId || !approvers || !approvers.length) return { success: false };
  const mentions = approvers.filter((a) => a.id).map((a) => mention(a.id)).join(" ");
  const rule = mode === "all" ? "all of you must approve" : mode === "min" ? `at least ${min} of you must approve` : "any one of you can approve";
  const storageBody = `
<p>${HEADER} — <strong>Approval requested</strong></p>
<p>${mentions} — ${escapeXml(requestedByName || "A colleague")} requested approval to move this page to <strong>${escapeXml(targetName || "the next state")}</strong> (${rule}). Open the Sentinel Vault ribbon at the top of this page to Approve or Deny.</p>
`.trim();
  try {
    return await postCommentWithMention({ pageId, storageBody });
  } catch (e) {
    console.error("[APPROVAL-NOTICE] request notify failed:", e);
    return { success: false };
  }
}

// #44: enforcement notice. `kind` = "revert" | "demote" | "revert-failed". Every revert
// notice carries a one-click page-history recovery link (CL-6) and mentions the editor.
// Claim discipline: "reverted + attested", never "the badge can't be wrong".
export async function postEnforceComment(pageId, editorId, kind, opts = {}) {
  if (!pageId) return { success: false };
  const historyUrl = `/wiki/pages/viewpreviousversions.action?pageId=${pageId}`;
  const m = editorId ? mention(editorId) + " — " : "";
  let body;
  if (kind === "demote") {
    body = `<p>${HEADER} — <strong>Moved back to Draft</strong></p>
<p>${m}this page was edited after it was Approved, so Sentinel Vault moved it back to Draft. Re-submit it for approval when the changes are ready.</p>`;
  } else if (kind === "revert-failed") {
    body = `<p>${HEADER} — <strong>Enforcement pending</strong></p>
<p>Sentinel Vault could not re-apply the approved version of this page and will retry automatically. The current content is in the page history — <a href="${escapeXml(historyUrl)}">view previous versions</a>.</p>`;
  } else {
    body = `<p>${HEADER} — <strong>Enforced Approved state</strong></p>
<p>${m}this page is in an enforced Approved state, so your change was reverted to the approved version${opts.approvedVersion ? ` (v${opts.approvedVersion})` : ""}, verified by structural compare. Your edit is preserved in the page history — <a href="${escapeXml(historyUrl)}">view previous versions</a>. To edit an approved page, first request a transition out of Approved.</p>`;
  }
  try {
    return await postCommentWithMention({ pageId, storageBody: body.trim() });
  } catch (e) {
    console.error("[APPROVAL-NOTICE] enforce comment failed:", e);
    return { success: false };
  }
}

// Notify the requester that their request was approved or denied.
export async function notifyApprovalResolved({ pageId, requestedBy, outcome, targetName, deciderName }) {
  if (!pageId || !requestedBy) return { success: false };
  const verb = outcome === "approved" ? "approved" : "declined";
  const tail = outcome === "approved" ? " The page has moved." : " The page stays in its current state.";
  const storageBody = `
<p>${HEADER} — <strong>Approval ${verb}</strong></p>
<p>${mention(requestedBy)} — your request to move this page to <strong>${escapeXml(targetName || "the next state")}</strong> was <strong>${verb}</strong>${deciderName ? ` by ${escapeXml(deciderName)}` : ""}.${tail}</p>
`.trim();
  try {
    return await postCommentWithMention({ pageId, storageBody });
  } catch (e) {
    console.error("[APPROVAL-NOTICE] resolve notify failed:", e);
    return { success: false };
  }
}
