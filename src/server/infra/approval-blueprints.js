/*
 * Approval notification comments (#43). Posts a Confluence footer comment that
 * @mentions the relevant people, so Confluence's own notification engine emails
 * them — no external egress. Mirrors validation-blueprints.js.
 */
import { postCommentWithMention } from "./outbound-notify.js";
import { restoredLabel } from "../capsules/workflow/baseline.js"; // B2: one wording for what a revert gave back
import { NOTICE_EDITOR_REVERT } from "../shared/notice-policy.js";

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

// #44: enforcement notice. `kind` = "revert" | "demote" | "revert-failed" | "expired". The body is
// pure (enforceCommentBody, unit-tested). WF-2 (UX critique 2026-09-19): the revert and demote
// notices are addressed to the EDITOR whose published work was undone, so they ride the
// editor_revert carve-out (posted even on a site that never opted into the comment channel, own
// switch notifyEditorOnRevert, still yields to a quiet space) — and they say what happened in the
// editor's words: which version holds their text, and what to do next. Never "structural compare",
// never "request a transition".
export function enforceCommentBody(pageId, editorId, kind, opts = {}) {
  const historyUrl = `/wiki/pages/viewpreviousversions.action?pageId=${pageId}`;
  const m = editorId ? mention(editorId) + " — " : "";
  if (kind === "expired" && opts.noTransition) {
    // A5: the review date passed but the page's state has no transition to Expired — it stays
    // where it is, overdue. Posted ONCE per due date (`workflow-review-notified-{pageId}` keeps
    // the announced date, no TTL): a re-set date that passes again is announced again.
    return `<p>${HEADER} — <strong>Review overdue</strong></p>
<p>${m}this page's review date has passed${opts.stateName ? ` and it is still ${escapeXml(opts.stateName)}` : ""}. Review it and move it on, or set a new review date.</p>`;
  }
  if (kind === "expired") {
    const to = escapeXml(opts.toName || "Needs re-review"); // WF-10: the state's own name
    return `<p>${HEADER} — <strong>Approval expired</strong></p>
<p>${m}this page's review period has elapsed, so Sentinel Vault moved it to ${to}. Re-submit it for review to approve it again.</p>`;
  }
  if (kind === "demote") {
    // A2: the target is the space's configured demote state (opts.demotedToName); Draft is the default.
    const to = escapeXml(opts.demotedToName || "Draft");
    return `<p>${HEADER} — <strong>Moved back to ${to}</strong></p>
<p>${m}this page was Approved, so your edit moved it back to ${to} for a new review. Nothing was lost: your change is still on the page. Request approval when the changes are ready, or ask an approver or space admin to review them.</p>`;
  }
  if (kind === "revert-failed") {
    return `<p>${HEADER} — <strong>Approved version not restored yet</strong></p>
<p>Sentinel Vault could not restore the approved version of this page yet — it will retry automatically. The current content is in the page history — <a href="${escapeXml(historyUrl)}">view previous versions</a>.</p>`;
  }
  // B2: what came back. "the approved version (v7)", or after an approver's later save "v8, the last
  // version kept after approval v7" (baseline.js restoredLabel — one wording for every surface).
  const label = restoredLabel(opts.approvedVersion, opts.reviewedVersion);
  const backTo = label && !label.startsWith("approved ") ? escapeXml(label) : `the approved version${opts.approvedVersion != null ? ` (v${escapeXml(opts.approvedVersion)})` : ""}`;
  const myVersion = opts.revertedVersion != null
    ? `<a href="${escapeXml(`/wiki/pages/viewpage.action?pageId=${pageId}&pageVersion=${opts.revertedVersion}`)}">open your version (v${escapeXml(opts.revertedVersion)})</a>`
    : `<a href="${escapeXml(historyUrl)}">view previous versions</a>`;
  return `<p>${HEADER} — <strong>Reverted to the approved version</strong></p>
<p>${m}this page is Approved and protected, so your change was reverted to ${backTo}. Your text is not lost: it is kept in the page history — ${myVersion}. To change an approved page, ask an approver or space admin to move it out of Approved first, or request approval for your version.</p>`;
}

export async function postEnforceComment(pageId, editorId, kind, opts = {}) {
  if (!pageId) return { success: false };
  const body = enforceCommentBody(pageId, editorId, kind, opts);
  const noticeType = (kind === "revert" || kind === "demote") && editorId ? NOTICE_EDITOR_REVERT : null;
  try {
    return await postCommentWithMention({ pageId, storageBody: body.trim(), noticeType });
  } catch (e) {
    console.error("[APPROVAL-NOTICE] enforce comment failed:", e);
    return { success: false };
  }
}

// WF-2: the dispatch record behind the ribbon's pill for a workflow enforcement — the editor and
// the approver are the parties (recent-dispatches filters on either), the versions let the ribbon
// link to the version holding the editor's text. Pure; unit-tested.
export function buildWorkflowEnforcementDispatch({ pageId, mode, editorAccountId, approverAccountId, approvedVersion, reviewedVersion, revertedVersion, demotedToName, via }) {
  return {
    id: `notification-${Date.now()}`,
    type: mode === "revert" ? "workflow-reverted" : "workflow-demoted",
    pageId,
    ownerAccountId: approverAccountId || null,
    editorAccountId: editorAccountId || null,
    approvedVersion: approvedVersion ?? null, // what came back (a revert's restored content)
    reviewedVersion: reviewedVersion ?? null, // the version that was approved
    revertedVersion: mode === "revert" ? (revertedVersion ?? null) : null,
    demotedToName: mode === "revert" ? null : (demotedToName || "Draft"),
    via: via || "event",
    timestamp: Date.now(),
  };
}

// The requester's comment body — pure, so the copy is unit-tested (test/approval-notice.test.mjs).
// `outcome` = "approved" | "denied" | "stale". WF-1 (UX critique 2026-09-19): a STALE close (the page
// changed after the request, so an approval could not be applied) used to be posted as "declined by
// <the approver>" — the approver had approved. It now says what happened and names no decider.
// WF-3: a denial carries the approver's reason — the whole point of Deny + reason is to tell the
// author what to fix.
export function approvalResolvedBody({ requestedBy, outcome, targetName, deciderName, reason, pinnedVersion, liveVersion, approvals }) {
  const target = `<strong>${escapeXml(targetName || "the next state")}</strong>`;
  const who = mention(requestedBy);
  if (outcome === "stale") {
    const versions = pinnedVersion != null && liveVersion != null ? ` (v${escapeXml(pinnedVersion)} → v${escapeXml(liveVersion)})` : "";
    return `
<p>${HEADER} — <strong>Approval request closed</strong></p>
<p>${who} — the page changed after you asked for approval to move it to ${target}${versions}, so the request was closed. Nobody declined it. Re-request approval when the page is ready.</p>
`.trim();
  }
  if (outcome === "approved") return approvedBody({ who, target, pinnedVersion, deciderName, reason, approvals });
  const verb = outcome === "approved" ? "approved" : "declined";
  const tail = outcome === "approved" ? " The page has moved." : " The page stays in its current state.";
  // The reason on its own labelled line, like the other notices (owner, 2026-09-25) — tucked in
  // after a colon it read as part of the sentence.
  const why = reason ? `\n<p><strong>Reason:</strong> <em>“${escapeXml(reason)}”</em></p>` : "";
  return `
<p>${HEADER} — <strong>Approval ${verb}</strong></p>
<p>${who} — your request to move this page to ${target} was <strong>${verb}</strong>${deciderName ? ` by ${escapeXml(deciderName)}` : ""}.${tail}</p>${why}
`.trim();
}

// 2026-10-18 (content pilot two-seats-2): a completed approval was titled "Approval approved" and
// dropped the reason the approver typed. The title now says what happened ("Approved v7 by Lena
// Steward"; every approver who said yes, the version they approved) and each typed reason follows on
// its own line, named when more than one approver gave one. `approvals` = [{ name, reason }] from the
// approval record (buildApprovalRecord: names and reasons already bounded); `deciderName` / `reason`
// are the fallback for a caller that has no record.
const joinNames = (names) => {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} other${more === 1 ? "" : "s"}`;
  return shown.length <= 1 ? (shown[0] || "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};
function approvedBody({ who, target, pinnedVersion, deciderName, reason, approvals }) {
  const list = Array.isArray(approvals)
    ? approvals.filter((a) => a && (a.name || a.reason)).map((a) => ({ name: a.name ? String(a.name) : null, reason: a.reason ? String(a.reason).trim() : null }))
    : (deciderName || reason ? [{ name: deciderName || null, reason: reason || null }] : []);
  const names = [...new Set(list.map((a) => a.name).filter(Boolean))];
  const by = names.length ? ` by ${escapeXml(joinNames(names))}` : "";
  const version = typeof pinnedVersion === "number" ? ` v${escapeXml(pinnedVersion)}` : "";
  const reasons = list.filter((a) => a.reason);
  const why = reasons.length === 1 && names.length <= 1
    ? `\n<p><strong>Reason:</strong> <em>“${escapeXml(reasons[0].reason)}”</em></p>`
    : reasons.map((a) => `\n<p><strong>${escapeXml(a.name || "Approver")}:</strong> <em>“${escapeXml(a.reason)}”</em></p>`).join("");
  return `
<p>${HEADER} — <strong>Approved${version}${by}</strong></p>
<p>${who} — your request to move this page to ${target} was <strong>approved</strong>${by}. The page has moved.</p>${why}
`.trim();
}

// Notify the requester that their request was approved, denied, or closed because the page changed.
export async function notifyApprovalResolved({ pageId, requestedBy, outcome, targetName, deciderName, reason, pinnedVersion, liveVersion, approvals }) {
  if (!pageId || !requestedBy) return { success: false };
  const storageBody = approvalResolvedBody({ requestedBy, outcome, targetName, deciderName, reason, pinnedVersion, liveVersion, approvals });
  try {
    return await postCommentWithMention({ pageId, storageBody });
  } catch (e) {
    console.error("[APPROVAL-NOTICE] resolve notify failed:", e);
    return { success: false };
  }
}
