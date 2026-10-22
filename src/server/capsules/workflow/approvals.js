/*
 * Workflow approvals engine (ledger #43) — multi-approver transitions.
 *
 * A transition into an approval-gated state (v1: the enforce state, In Review →
 * Approved) does not happen immediately: it opens a pending transition and one
 * approval record per approver. Approvers decide; when the decision mode's
 * threshold is met the transition completes, on denial it is cleared.
 *
 * Storage (KVS; deliberately NOT under the edit-request or edit-grant prefixes, so
 * seal-teardown sweeps never touch them and they don't pollute the edit-request inbox):
 *   workflow-approval-{pageId}-{stateId}-{approvalId}-{approverAccountId}
 *        = { status: pending|approved|denied, requestedAt, decidedAt, reason, pinnedVersion, approverName }
 *   workflow-pending-{pageId}
 *        = { toStateId, approvalId, requestedBy, requestedByName, requestedAt, pinnedVersion, approvers[], mode, min }
 *   workflow-inbox-{approverAccountId}-{pageId}
 *        = { pageId, stateId, requestedAt }
 *        The per-approver INDEX the inbox reads. Added 2026-09-05: listMyApprovals used to scan
 *        every workflow-approval-* record on the site (cap 1,500) and pick out the caller's —
 *        on a site with a few hundred orphaned records from deleted pages the scan never
 *        reached a freshly opened approval, so "Approvals waiting on you" rendered nothing while
 *        the page banner still showed the request. Written with the approval records, deleted
 *        with them, backfilled hourly by workflowSweep for approvals opened before this shipped.
 */
import { route } from "@forge/api";
import { appConfluence, rateLimitOf, noteAuthzUnknown } from "../../shared/confluence-call.js";
import { kvs, WhereConditions } from "@forge/kvs";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { transitionPageWorkflow, readPageWorkflow, fetchLivePageVersion, appendWorkflowLog, getSpaceWorkflowSettings, getPageWorkflow, getWorkflowLog, lastDecisionFrom } from "./logic.js";
import { myRequestKey, MY_REQUEST_PREFIX, classifyMyApprovalRequest } from "./my-requests.js"; // WF-3 (c)
import { workflowStatus, approvalSummary } from "./status.js";
import { touchByline } from "../page-details/byline-touch.js"; // WF-6
import { notifyApprovalRequested, notifyApprovalResolved } from "../../infra/approval-blueprints.js";
import { recordActivity } from "../../infra/activity-log.js";
import { isAccountStewardAsApp, accountStewardStatusAsApp } from "../../shared/steward-checks.js";
import { isStewardOfRecord, recordAuthority, stewardOfSpacesStatus, canReadPage, accountContentAccessStatus, READ } from "../../shared/content-access.js";
import { movedPageHold } from "./moved-hold.js";
import { verifySignature } from "./signature.js";
import { errText } from "../../shared/action-log.js";

const APPROVAL_ID = "approval"; // v1 single default round; schema carries the segment for future named rounds
// 8.16: the one refusal for a decider who cannot view the page (approval requests and proposals). A
// literal `reason:` so the action log can name it (scripts/gen-action-names.mjs).
export const cannotViewToDecide = () => ({ success: false, reason: "You don't have access to view this page, so you can't decide on it. Nothing was recorded." });
/**
 * 8.16: the view check before a decision (approval requests, proposals, Approve anyway): null when
 * the decider can view the page, else the refusal. A Confluence answer that could not be had (5xx, a
 * thrown call) is "try again", never "you don't have access"; a 429 is noted, so the resolver says
 * Confluence is limiting requests (registry.js busyAware).
 */
export async function viewToDecideRefusal(accountId, pageId) {
  const st = await accountContentAccessStatus(accountId, pageId, READ);
  if (st.allowed) return null;
  if (st.unknown) return { success: false, reason: "Your access to this page could not be checked right now. Nothing was recorded. Try again in a moment." };
  return cannotViewToDecide();
}

// --- Pure decision (unit-tested). decisions: array of "approved"|"denied"|"pending". ---
// `adminDecisions` (owner, 2026-09-25): space admins may decide without being listed, and count
// like an approver — an admin approval completes "any" and is one of N for "min"; "all" still
// needs every LISTED approver, and an admin's denial closes it like any approver's. Admin
// denials never make "any"/"min" unreachable on their own: the listed approvers still decide.
export function evaluateApproval(mode, min, decisions, adminDecisions = [], { adminOnly = false } = {}) {
  const extra = Array.isArray(adminDecisions) ? adminDecisions : [];
  // Every listed approver is the requester (who never decides their own request): only a space
  // admin can settle it — their approval completes it, their denial closes it (tester 2026-09-30:
  // a request whose only approver was its requester stayed open after an admin denied it).
  // A denial wins over an approval here, as in "all": a "no" never turns into an approval.
  if (adminOnly) {
    if (extra.includes("denied")) return "denied";
    if (extra.includes("approved")) return "approved";
    return "pending";
  }
  const adminApproved = extra.filter((d) => d === "approved").length;
  const adminDenied = extra.filter((d) => d === "denied").length;
  const approved = decisions.filter((d) => d === "approved").length;
  const denied = decisions.filter((d) => d === "denied").length;
  const total = decisions.length;
  const pending = total - approved - denied;
  if (total === 0) return "approved"; // no approvers required → auto-approve
  if (mode === "all") {
    if (denied > 0 || adminDenied > 0) return "denied"; // one denial kills an all-of
    return approved === total ? "approved" : "pending";
  }
  if (mode === "min") {
    const need = Math.max(1, min || 1);
    if (approved + adminApproved >= need) return "approved";
    if (approved + adminApproved + pending < need) return "denied"; // threshold no longer reachable
    return "pending";
  }
  // "any" (default): first approval wins; only all-denied rejects.
  if (approved + adminApproved >= 1) return "approved";
  if (denied === total) return "denied";
  return "pending";
}

/**
 * PURE. The listed decisions that can still arrive: in "any" and "all" the requester's own slot is
 * dropped (they can never decide it — "all" could never complete and "any" never close). "min"
 * keeps it, so the count stays reachable for a space admin's approval. `adminOnly` when nobody
 * else is listed. `records` are per-approver records ({ approverAccountId, status }).
 */
export function listedDecisionsFor(pending, records) {
  const all = (records || []).map((r) => ({ id: r.approverAccountId, status: r.status || "pending" }));
  if (pending?.mode === "min" || !pending?.requestedBy) return { decisions: all.map((d) => d.status), adminOnly: false };
  const others = all.filter((d) => d.id !== pending.requestedBy);
  return { decisions: others.map((d) => d.status), adminOnly: all.length > 0 && others.length === 0 };
}

/**
 * PURE (8.14). The request's quorum over the approvers who are approvers NOW. `effective` is the
 * request's approver list ∩ the space's current list (approvals.js currentApproverStatus "yes");
 * `listedRecords` are their per-approver records, `adminRecords` the records of admins who decided
 * (and are not in `effective`). Only these votes count: the vote of a person off the current list
 * does not. When approvers are off the list, "min" re-clamps to the approvers left who can decide
 * (the requester never decides their own request; never below 1: never an auto-approve); with
 * nobody off the list the minimum is the request's own.
 * When nobody on the request other than its requester is an approver any more, `needsRerequest`:
 * only a space admin can still settle it (adminOnly), otherwise it must be re-requested, which
 * takes the current list. An AI-only request (no approvers at all) keeps its old meaning.
 * `rejudged` when approvers on the request are off the list (the quorum is judged on fewer people
 * than were asked): the AI pass then never completes the request on its own (humanQuorumMet).
 * Returns { outcome: "approved"|"denied"|"pending", needsRerequest, min, rejudged }.
 */
export function quorumOutcome(pending, effective, listedRecords, adminRecords, { adminsMay = true } = {}) {
  const snapshot = Array.isArray(pending?.approvers) ? pending.approvers : [];
  const adminDecisions = (adminRecords || []).map((r) => r?.status || "pending");
  if (!snapshot.length) {
    const { decisions, adminOnly } = listedDecisionsFor(pending, []);
    return { outcome: evaluateApproval(pending?.mode, pending?.min, decisions, adminDecisions, { adminOnly }), needsRerequest: false, min: pending?.min ?? 1, rejudged: false };
  }
  const eff = (effective || []).filter((id) => snapshot.includes(id));
  const needsRerequest = eff.filter((id) => id !== pending?.requestedBy).length === 0;
  const removed = snapshot.length - eff.length;
  // The request judged as asked (its own mode and minimum) with the removed approvers counted as
  // still pending and only current votes: when that already says "approved", the removal changed
  // nothing about the outcome (humanQuorumMet lets the AI pass complete it then).
  const asAsked = snapshot.map((id) => (eff.includes(id) ? ((listedRecords || []).find((r) => r?.approverAccountId === id) || { approverAccountId: id, status: "pending" }) : { approverAccountId: id, status: "pending" }));
  const askedView = listedDecisionsFor(pending, asAsked);
  const withRemovedPending = evaluateApproval(pending?.mode, pending?.min, askedView.decisions, adminDecisions, { adminOnly: askedView.adminOnly });
  if (!eff.length) return { outcome: evaluateApproval(pending?.mode, 1, [], adminDecisions, { adminOnly: true }), needsRerequest: true, min: 1, rejudged: true, withRemovedPending };
  // The minimum after a removal: at most the approvers left who can reach it — with admins allowed
  // to decide, the requester's slot stays (an admin fills it, as when the request opened); without,
  // only the others count — and never lower than the request's own minimum less the number removed.
  const asked = Math.max(1, pending?.min || 1);
  const deciders = eff.filter((id) => id !== pending?.requestedBy).length;
  const reach = adminsMay ? eff.length : deciders;
  const min = removed <= 0 ? asked : Math.max(1, Math.min(asked, reach), asked - removed);
  const records = (listedRecords || []).filter((r) => eff.includes(r?.approverAccountId));
  const { decisions, adminOnly } = listedDecisionsFor({ ...pending, approvers: eff, min }, records);
  return { outcome: evaluateApproval(pending?.mode, min, decisions, adminDecisions, { adminOnly }), needsRerequest, min, rejudged: removed > 0, withRemovedPending };
}

/**
 * PURE (8.16). Would a request asking `approvers` (mode/min, opened by `requestedBy`) be one nobody can
 * finish, given the approvers who cannot view the page (`cannotView`)? Deciding needs read access to
 * the page (decideApproval), so: "all" needs every listed approver but the requester to see it (a space
 * admin never stands in for a listed approver there); "any"/"min" are stuck only when the approvers who
 * can see it cannot reach the count and space admins may not decide (an admin fills a slot otherwise).
 */
export function unreachableByView({ approvers = [], mode = "any", min = 1, requestedBy = null, adminsMay = true } = {}, cannotView = []) {
  const deciders = (approvers || []).filter((id) => id && id !== requestedBy);
  const viewers = deciders.filter((id) => !(cannotView || []).includes(id));
  if (!deciders.length) return false; // admin-only requests: settled by a space admin (who can view it)
  if (mode === "all") return viewers.length < deciders.length;
  if (adminsMay) return false;
  if (mode === "min") return viewers.length < Math.max(1, min || 1);
  return viewers.length === 0;
}

/**
 * 8.16: which of `approvers` cannot view the page (Confluence, per account). `{ unknown, ids, unknownIds }`
 * — `unknown` when any answer could not be had (a 429); `unknownIds` are those people.
 */
export async function approversWhoCannotView(pageId, approvers) {
  const ids = [];
  let unknown = false;
  const unknownIds = [];
  const list = [...new Set((approvers || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += 10) { // at most 50 people (MAX_REQUEST_APPROVERS), ten at a time
    const chunk = list.slice(i, i + 10);
    const answers = await Promise.all(chunk.map((id) => accountContentAccessStatus(id, pageId, READ)));
    answers.forEach((st, k) => { if (st.unknown) { unknown = true; unknownIds.push(chunk[k]); } else if (!st.allowed) ids.push(chunk[k]); });
  }
  return { unknown, ids, unknownIds };
}

/**
 * 8.16: the request-time check: refuse a request (or re-request) that could never be finished because
 * approvers cannot view the page, naming them; "try again" when it could not be checked. null = fine.
 */
export async function viewReachabilityRefusal(pageId, { approvers, mode, min, requestedBy, spaceKey, names = {} }) {
  if (!approvers?.length) return null;
  const adminsMay = (await getSpaceWorkflowSettings(spaceKey))?.approval?.adminsCanApprove !== false;
  const shape = { approvers, mode, min, requestedBy, adminsMay };
  // Nothing to check when access cannot change the answer: any-of/min-of with space admins allowed to
  // decide (an admin who can view it fills the slot), or a request already unreachable for another
  // reason (not this check's to refuse, and never with a wrong reason).
  if (!unreachableByView(shape, approvers)) return null; // even with nobody able to view it, it can finish
  if (unreachableByView(shape, [])) return null;
  const cv = await approversWhoCannotView(pageId, approvers.filter((id) => id !== requestedBy));
  if (cv.unknown) {
    // Refuse on "could not check" only when the people who could not be checked could make it unreachable.
    if (!unreachableByView(shape, [...cv.ids, ...cv.unknownIds])) return null;
    return { success: false, reason: "Could not check who can view this page right now. Nothing was changed — try again in a moment." };
  }
  if (!cv.ids.length || !unreachableByView(shape, cv.ids)) return null;
  const who = cv.ids.map((id) => names[id]).filter(Boolean);
  const list = who.length === cv.ids.length ? `: ${who.join(", ")}` : "";
  return { success: false, cannotView: cv.ids.length, reason: `${cv.ids.length === 1 ? "One approver can't" : `${cv.ids.length} approvers can't`} view this page${list}. Approvers decide only pages they can view, so this request could never be completed. Give them access to the page, or a space admin can change the approvers in the space's Workflow settings.` };
}

/** Everyone whose decision record may exist for a pending request: listed approvers + admins who decided. */
export const deciderIds = (pending) => [...(pending?.approvers || []), ...((pending?.adminDeciders || []).filter((id) => !(pending?.approvers || []).includes(id)))];

// --- Pure (unit-tested; no I/O). A4: the approval EVIDENCE snapshot. ---
// The per-approver records are deleted the moment an approval resolves (clearPageApprovals),
// so this is built from them BEFORE that delete and stored on the workflow state record
// (`record.approvalRecord`) and in the transition's workflow-log entry (`details.approvalRecord`).
// `records` are the strong per-key approval records over the known approver list — EVERY
// approver is listed, so an "any"-mode approval still shows who was asked and never answered
// (decision "pending"). `versionAtDecision` is the record's pinnedVersion: the version the
// approver actually reviewed. A direct steward approval (no approvers, no pending) passes
// `pending: { pinnedVersion }` and `records: []`, so the page carries the same shape once approved.
const MAX_DECISION_ROWS = 50;   // decided rows first; the rest are counted, not listed
const MAX_NAME = 120;
const bound = (v, n) => (typeof v === "string" ? v.slice(0, n) : (v ?? null));
export function buildApprovalRecord({ pending, records, outcome, completedBy, completedByName, nowIso, quorum = null }) {
  const p = pending || {};
  // 8.14: `quorum` ({ counted: [accountId], effective: [accountId], min }) says which decisions
  // COUNTED: the request's approvers on the space's list at completion, plus the admins who
  // decided. Each row then carries `counted`, and the record names the approver set and minimum
  // the outcome was judged on. Without it (unknown, or a direct steward approval) neither is set.
  const counted = Array.isArray(quorum?.counted) ? new Set(quorum.counted) : null;
  const all = (Array.isArray(records) ? records : []).map((r) => ({
    accountId: r?.approverAccountId ?? null,
    name: bound(r?.approverName, MAX_NAME),
    decision: r?.status || "pending",
    decidedAt: r?.decidedAt ?? null,
    reason: bound(r?.reason, 300),
    // The version the approver actually decided on (stamped at decide time); the request-time
    // pin only when the decision predates that stamp.
    versionAtDecision: typeof r?.decidedVersion === "number" ? r.decidedVersion : (typeof r?.pinnedVersion === "number" ? r.pinnedVersion : null),
    // B3: the decision was signed with the approver's enrolled device (enrolledAt says how old
    // that device was at the time — a device enrolled a minute before the decision is visible).
    signed: !!r?.signature,
    signedWithDeviceEnrolledAt: r?.signature?.enrolledAt || null,
    ...(counted ? { counted: counted.has(r?.approverAccountId) } : {}),
  }));
  // A 100-approver roster with reasons would push the state record toward the KVS value cap
  // and make the page permanently un-approvable; keep the record bounded and say what was cut.
  const decided = all.filter((d) => d.decision !== "pending");
  const undecided = all.filter((d) => d.decision === "pending");
  const decisions = [...decided, ...undecided].slice(0, MAX_DECISION_ROWS);
  return {
    outcome: outcome === "denied" ? "denied" : outcome === "stale" ? "stale" : outcome === "withdrawn" ? "withdrawn" : "approved",
    approverCount: all.length,
    omitted: Math.max(0, all.length - decisions.length),
    mode: p.mode ?? null,
    min: p.min ?? null,
    ...(counted ? (quorum.listUnknown ? { approverListUnknown: true } : { effectiveApprovers: (quorum.effective || []).slice(0, MAX_DECISION_ROWS), effectiveMin: quorum.min ?? null }) : {}),
    requestedBy: p.requestedBy ?? null,
    requestedByName: p.requestedByName ?? null,
    requestedAt: p.requestedAt ?? null,
    pinnedVersion: typeof p.pinnedVersion === "number" ? p.pinnedVersion : null,
    completedAt: nowIso || new Date().toISOString(),
    completedBy: completedBy ?? null,
    completedByName: completedByName ?? null,
    aiGate: p.aiGate?.required ? { status: p.aiGate.status ?? null, reason: bound(p.aiGate.reason, 320) } : null,
    // B3: a signature on the REQUEST (direct steward approval, or the AI-only gate's requester).
    requestSignature: p.requestSignature ? { method: p.requestSignature.method || "totp", verifiedAt: p.requestSignature.verifiedAt || null, enrolledAt: p.requestSignature.enrolledAt || null } : null,
    decisions,
  };
}

// Normalize a settings.approval block → { approvers: [accountId], mode, min } or null if none.
export function resolveApprovers(approval) {
  if (!approval) return null;
  const approvers = (approval.approvers || [])
    .filter((a) => a && a.id && (a.type || "user") === "user") // v1: user approvers (group expansion → #43 iter 6)
    .map((a) => a.id);
  if (!approvers.length) return null;
  const uniq = [...new Set(approvers)];
  // Clamp min to the resolved approver count — otherwise min > approvers (e.g. after
  // group approvers are filtered out) makes evaluateApproval deny on the first vote.
  return { approvers: uniq, mode: approval.mode || "any", min: Math.min(uniq.length, Math.max(1, approval.min || 1)) };
}

// Split an approval config into user approvers + group approvers (groups are expanded
// to member account ids by the caller, which has REST access). Returns null if neither.
export function extractApprovalConfig(approval) {
  if (!approval || !Array.isArray(approval.approvers)) return null;
  const userIds = [...new Set(approval.approvers.filter((a) => a && a.id && (a.type || "user") === "user").map((a) => a.id))];
  const groups = approval.approvers.filter((a) => a && a.id && a.type === "group").map((a) => ({ id: a.id, name: a.name || a.id }));
  if (!userIds.length && !groups.length) return null;
  return { userIds, groups, mode: approval.mode || "any", min: Math.max(1, approval.min || 1) };
}

// Expand a group to its member account ids (best-effort — an unresolvable group adds
// no approvers; user approvers are unaffected). Lifted here (#44 §1.5) so the trigger
// can compute the live-config approver intersection too.
// Group expansion bounds (2026-10-04). Until this version a group approver never expanded (the
// endpoint answered 401), so these limits are new behaviour, not a reduction: members read per
// group, and the approvers ONE request may open records for (2 KVS writes + an @mention each,
// inside a 25 s resolver). A larger request is refused with a reason (workflow/actions.js).
export const MAX_GROUP_MEMBERS_READ = 2000;
export const MAX_REQUEST_APPROVERS = 50;

// PURE. A Confluence group id (the picker's `id`) — a UUID. Older configs may carry the name in `id`.
export const isGroupId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

// The group's id: the stored one, else the picker's exact (case-insensitive) name match.
// `{ id }`, or `{}` when it is not known: the picker is a SEARCH (50 results), so a miss there is
// not proof that the group is gone, and an unanswered call proves nothing either. Only an id that
// Confluence answers 404 for counts as a deleted group (fetchGroupMembers).
async function resolveGroupId(group) {
  if (isGroupId(group?.id)) return { id: group.id };
  const name = String(group?.name || group?.id || "");
  if (!name) return { missing: true };
  const res = await appConfluence(route`/wiki/rest/api/group/picker?query=${name}&limit=50`);
  if (!res.ok) return {};
  const hit = ((await res.json())?.results || []).find((g) => String(g?.name || "").toLowerCase() === name.toLowerCase());
  return hit?.id ? { id: hit.id } : {};
}

export async function fetchGroupMembers(group) {
  const ids = [];
  try {
    // 2026-10-04: GET /wiki/rest/api/group/member?name= answers 401 "scope does not match" for
    // this app (measured, dev hook endpointProbe) and is gone from Atlassian's v1 spec, so every
    // group approver and read-confirmation group resolved to nobody. The id-based
    // /group/{groupId}/membersByGroupId is in the current spec under read:confluence-groups and
    // answered 200 in the same probe.
    // A group id Confluence answers 404 for (a deleted group) has no members: resolved as EMPTY,
    // not unknown, so decisions on it do not wait forever. A by-name lookup that finds no exact
    // match, a 429, a 5xx or a thrown call is unknown.
    const g = await resolveGroupId(group);
    if (g.missing) return { ids, ok: true, missing: true };
    const groupId = g.id;
    if (!groupId) return { ids, ok: false };
    // Paginated (Tier B review, finding 9): a 140-member group was silently a 100-member one.
    // Paged by what the server returns (it may cap a page below the 200 asked for) and stopped by
    // the absence of `_links.next`, never by a short page alone (review 2026-10-04, P5).
    for (let start = 0, i = 0; start < MAX_GROUP_MEMBERS_READ && i < 50; i++) {
      const res = await appConfluence(route`/wiki/rest/api/group/${groupId}/membersByGroupId?limit=200&start=${start}`);
      if (res.status === 404 && start === 0) return { ids, ok: true, missing: true }; // the group is gone
      if (!res.ok) return { ids, ok: false }; // non-ok — distinguish an outage from a genuinely empty group
      const body = await res.json();
      const page = body?.results || [];
      for (const u of page) if (u.accountId) ids.push(u.accountId);
      if (!page.length || !body?._links?.next) break;
      start += page.length;
    }
    return { ids, ok: true };
  } catch (_) {
    return { ids, ok: false };
  }
}

// The effective approver id list (users + expanded group members) for a config.
// `unresolved: true` when a group expansion FAILED (vs a legitimately empty group) — the
// enforce path (#44) then trusts the snapshot rather than reverting a real approver's edit
// during a group-service outage.
export async function resolveApproverIds(approval) {
  const plan = extractApprovalConfig(approval);
  if (!plan) return null;
  const memberIds = [];
  const unresolvedGroups = [];
  for (const g of plan.groups) {
    const r = await fetchGroupMembers(g);
    memberIds.push(...r.ids);
    if (!r.ok) unresolvedGroups.push(String(g.name || g.id || "").slice(0, 120));
  }
  const unresolved = unresolvedGroups.length > 0;
  const allIds = [...new Set([...plan.userIds, ...memberIds])];
  if (!allIds.length && !unresolved) return null;
  return { approvers: allIds, mode: plan.mode, min: Math.min(allIds.length || plan.min, plan.min), unresolved, ...(unresolved ? { unresolvedGroups } : {}) };
}

// ── Is this person an approver NOW? (the ONE rule; 8.14) ──────────────────────────────────────
// A request, an Approved page's record and a proposal each keep the approver list they were made
// with (the SNAPSHOT). Approver power is the snapshot AND the space's current approver setting
// (users + the members of its groups, read now): someone the space admin has since taken off the
// list, or out of the group, no longer has it. Answers:
//   "yes"      in the snapshot and in the current list;
//   "no"       not in the snapshot, or the current list was read and does not name them;
//   "unknown"  in the snapshot, not among the members that could be read, and a group (or the
//              settings) could not be read right now (an outage, Confluence limiting requests).
// What "unknown" means is the CALLER's: a DECISION (approve/deny a request or a proposal, re-pin a
// request) refuses and asks to try again — never a yes; an EDIT on an Approved page keeps trusting
// the snapshot (triggers.js, privilege.js), so a group outage never reverts a real approver's edit.
// Space admins are checked separately (they decide as admins, not through this list).

/** PURE. `liveSpec` is resolveApproverIds(settings.approval) (null when the space names nobody). */
export function currentApproverStatus(snapshot, accountId, liveSpec) {
  if (!accountId || !Array.isArray(snapshot) || !snapshot.includes(accountId)) return "no";
  if (Array.isArray(liveSpec?.approvers) && liveSpec.approvers.includes(accountId)) return "yes";
  return liveSpec?.unresolved ? "unknown" : "no";
}

/**
 * A checker for one invocation: the space's approver list is read (and its groups expanded) once
 * per space, however many records it is asked about. `check(snapshot, accountId, spaceKey)`.
 * `{ expandGroups: false }` is for hot DISPLAY paths (the ribbon's "waiting on you" count runs on
 * every page view): only the stored setting is read, no Confluence call — a person named on it is
 * "yes", and anyone else is "unknown" when the setting has groups (a decision then checks fully).
 */
export function newApproverCheck({ expandGroups = true } = {}) {
  const memo = new Map();
  const liveSpecOf = (spaceKey) => {
    const k = String(spaceKey || "");
    if (!memo.has(k)) {
      memo.set(k, (async () => {
        const approval = (await getSpaceWorkflowSettings(spaceKey))?.approval;
        if (expandGroups) return resolveApproverIds(approval);
        const plan = extractApprovalConfig(approval);
        return plan ? { approvers: plan.userIds, unresolved: plan.groups.length > 0 } : null;
      })());
    }
    return memo.get(k);
  };
  const check = async (snapshot, accountId, spaceKey) => {
    if (currentApproverStatus(snapshot, accountId, { approvers: [accountId] }) === "no") return "no"; // not in the snapshot: no read
    if (!spaceKey) return "unknown"; // no space to read the list from: judged nothing
    try { return currentApproverStatus(snapshot, accountId, await liveSpecOf(spaceKey)); } catch (_) { return "unknown"; }
  };
  /** The groups of that space's list that could not be read (names), from the same read. */
  check.unreadGroups = async (spaceKey) => { try { return spaceKey ? ((await liveSpecOf(spaceKey))?.unresolvedGroups || []) : []; } catch (_) { return []; } };
  return check;
}
export const approverStatusNow = (snapshot, accountId, spaceKey) => newApproverCheck()(snapshot, accountId, spaceKey);

/**
 * The refusal for a decision whose approver arm did not answer "yes". On "unknown" a 429 that stood
 * in this invocation is noted, so the resolver's answer becomes "Confluence is limiting requests …
 * try again" (registry.js busyAware); otherwise the plain try-again text.
 */
export function approverRefusal(status, extra = {}, { unreadGroups = [] } = {}) {
  if (status === "unknown") {
    if (rateLimitOf()) noteAuthzUnknown();
    // A group that cannot be read is named, with where to fix it when it was deleted or renamed
    // (a group named in the settings that Confluence's search does not find stays unreadable).
    if (unreadGroups.length) {
      const names = unreadGroups.map((n) => `"${n}"`).join(", ");
      return { ...extra, success: false, reason: `The approver group ${names} could not be read right now, so nothing was recorded. Try again in a moment; if the group was deleted or renamed, a space admin can update the approvers in the space's Workflow settings.`, approverUnknown: true };
    }
    return { ...extra, success: false, reason: "Your approver rights could not be checked right now. Nothing was recorded — try again in a moment.", approverUnknown: true };
  }
  return { ...extra, success: false, reason: "You are no longer one of this space's approvers, so you can't decide this request.", approverRemoved: true };
}

const approvalKey = (pageId, stateId, accountId) => `workflow-approval-${pageId}-${stateId}-${APPROVAL_ID}-${accountId}`;
const pendingKey = (pageId) => `workflow-pending-${pageId}`;
export const inboxKey = (accountId, pageId) => `workflow-inbox-${accountId}-${pageId}`;

// Pure (unit-tested). An approval record is an ORPHAN when its page has no pending transition
// any more (page deleted mid-approval, or a teardown path that cleared the pending record by
// query and missed a key) — but only once it is old enough that it cannot be the record of a
// request that is being opened right now: requestApprovalTransition writes the approval
// records BEFORE the pending record, and the sweep must never eat that window.
export const ORPHAN_APPROVAL_MIN_AGE_MS = 60 * 60 * 1000;
export function isOrphanApproval(record, pendingExists, nowMs = Date.now()) {
  if (pendingExists) return false;
  const at = Date.parse(record?.requestedAt || "");
  if (!Number.isFinite(at)) return true; // no provenance at all: nothing can be waiting on it
  return nowMs - at >= ORPHAN_APPROVAL_MIN_AGE_MS;
}

// Open a pending transition + one approval record per approver.
export async function requestApprovalTransition({ pageId, toStateId, toStateName, spaceKey, approvers, mode, min, actorAccountId, actorName, pinnedVersion, approverNames, aiGate, requestSignature = null }) {
  const requestedAt = new Date().toISOString();
  for (const acc of approvers) {
    await kvs.set(approvalKey(pageId, toStateId, acc), {
      pageId, stateId: toStateId, approverAccountId: acc, approverName: (approverNames && approverNames[acc]) || null,
      status: "pending", requestedAt, decidedAt: null, reason: null, pinnedVersion,
    });
    await kvs.set(inboxKey(acc, pageId), { pageId, stateId: toStateId, requestedAt });
  }
  await kvs.set(pendingKey(pageId), {
    toStateId, toStateName: toStateName || null, approvalId: APPROVAL_ID, requestedBy: actorAccountId || null, requestedByName: actorName || null,
    requestedAt, pinnedVersion, approvers, mode, min, spaceKey: spaceKey || null,
    // #46: the AI review axis, AND-composed with the human quorum on the same pinned version.
    aiGate: aiGate?.required ? { required: true, status: "pending", threshold: aiGate.threshold || "medium", reviewedVersion: null, reason: null, enqueuedAt: Date.now() } : null,
    // B3: with no human approvers the requester (a steward) is the signing authority; their
    // signature at request time is what the AI-only completion carries (review finding 11).
    requestSignature: requestSignature || null,
  });
  // WF-3 (c): the requester's own index row ("Approvals you asked for" on My work).
  if (actorAccountId) await kvs.set(myRequestKey(actorAccountId, pageId), { requesterAccountId: actorAccountId, pageId: String(pageId), spaceKey: spaceKey || null, toStateId, toStateName: toStateName || null, requestedAt }).catch((e) => console.warn("[WORKFLOW] my-request index", errText(e)));
  // A1: the pending record is written — the request is open from here on.
  await recordActivity({
    type: "workflow.approval-requested",
    pageId,
    spaceKey: spaceKey || null,
    actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: {
      to: toStateId,
      toName: toStateName || toStateId,
      approverCount: approvers.length,
      approvers: approvers.slice(0, 10), // ids are ~47 bytes each; 22 would breach the 1 KB details cap (A1 review F3)
      mode,
      min,
      pinnedVersion: pinnedVersion ?? null,
      aiGate: aiGate?.required ? true : false,
    },
    version: pinnedVersion ?? null,
  });
  // Best-effort: @mention the approvers in a page comment so Confluence emails them.
  if (approvers.length) {
    await notifyApprovalRequested({
      pageId, targetName: toStateName, requestedByName: actorName, mode, min,
      approvers: approvers.map((id) => ({ id, name: (approverNames && approverNames[id]) || null })),
    }).catch(() => {});
  }
  await touchByline(pageId); // WF-6: "Awaiting approval 0 of N"
  return { pending: true, approvers, mode, min, aiGate: aiGate?.required ? true : false };
}

/**
 * WF-6. Everything the always-present surfaces (byline chip, details modal) say about a page's
 * workflow, in one read: the record + state, the open request with how many have decided, the
 * last decision where it still matters (not enforced, nothing pending — the WF-3 rule), the
 * composed status and the approval sentence. `null` when the page has no workflow.
 */
export async function describeWorkflowForPage(pageId, { spaceKey = null, log = null } = {}) {
  const wf = await getPageWorkflow(pageId, spaceKey);
  if (!wf?.assigned) return null;
  const pending = (await kvs.get(pendingKey(pageId)).catch(() => null)) || null;
  let pendingDecided = 0;
  if (pending?.toStateId && Array.isArray(pending.approvers) && pending.approvers.length) {
    const records = await readApprovalRecords(pageId, pending.toStateId, pending.approvers);
    pendingDecided = records.filter((r) => r?.status && r.status !== "pending").length;
  }
  const enforced = !!wf.record?.enforce && wf.record?.approvedVersion != null;
  const lastDecision = !enforced && !pending ? lastDecisionFrom(log || await getWorkflowLog(pageId)) : null;
  const status = workflowStatus({ record: wf.record, state: wf.state, pending, pendingDecided, lastDecision });
  return { ...wf, pending, pendingDecided, lastDecision, status, approvalSummary: approvalSummary(wf.record) };
}

// Strongly-consistent read of the approval records over the KNOWN approver list —
// never kvs.query() (eventually consistent: could miss a just-written vote or return
// empty and mis-resolve the quorum).
async function readApprovalRecords(pageId, stateId, approvers) {
  return Promise.all((approvers || []).map(async (acc) =>
    (await kvs.get(approvalKey(pageId, stateId, acc))) || { approverAccountId: acc, status: "pending" }));
}

export async function clearPageApprovals(pageId, stateId, approvers) {
  await kvs.delete(pendingKey(pageId)).catch(() => {});
  await touchByline(pageId); // WF-6: the request is gone from the chip
  if (Array.isArray(approvers) && approvers.length) {
    // Delete the exact keys the engine created (strongly consistent) — don't leak
    // phantom-pending records into listMyApprovals via an eventually-consistent query.
    for (const acc of approvers) {
      await kvs.delete(approvalKey(pageId, stateId, acc)).catch(() => {});
      await kvs.delete(inboxKey(acc, pageId)).catch(() => {});
    }
    return;
  }
  // Fallback for a sweep with no known list (e.g. workflow unassign): best-effort query.
  const prefix = stateId ? `workflow-approval-${pageId}-${stateId}-` : `workflow-approval-${pageId}-`;
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
  for (const { key, value } of results || []) {
    await kvs.delete(key).catch(() => {});
    if (value?.approverAccountId) await kvs.delete(inboxKey(value.approverAccountId, pageId)).catch(() => {});
  }
}

// Complete an approved transition — shared by the human path (decideApproval) and the AI
// path (applyAiVerdict) once BOTH the human quorum AND the AI gate are satisfied. Carries the
// full #44 anchor rule (fail-closed on null / stale version) so it can't be bypassed.
const completingKey = (pageId) => `workflow-completing-${pageId}`;

async function finalizeApprovedTransition(pageId, stateId, pending, actorAccountId, actorName, voteSummary, { holdChecked = false, quorum = null } = {}) {
  // The backstop for every completion (the last vote, an AI verdict): a page that moved to another
  // space since the request does not move (moved-hold.js); the request stays open. A caller that
  // asked already (decide-approval before the vote was recorded, the AI verdict before it was
  // consumed) says so: one lookup, and never a vote or verdict used up by a second failed lookup.
  if (!holdChecked) {
    const hold = await movedPageHold(pageId, { actorAccountId, storedKey: pending?.spaceKey || null });
    if (hold) return { success: false, reason: hold.reason, moved: !!hold.moved, transitioned: false };
  }
  const approvers = deciderIds(pending); // records to snapshot and clear: listed + admins who decided
  // One-shot completion CLAIM (dedup concurrent finalizers: duplicate AI delivery, and the
  // AI-verdict-vs-last-human-vote race). KVS has no CAS, so this narrows the window; the
  // DURABLE backstop is gating every side-effect on the transition actually happening below.
  if (await kvs.get(completingKey(pageId))) {
    return { success: true, outcome: "approved", transitioned: false, alreadyCompleting: true };
  }
  await setWithTtl(completingKey(pageId), { stateId, at: new Date().toISOString() }, 120000);
  try {
    const live = await fetchLivePageVersion(pageId);
    if (live == null) {
      return { success: false, reason: "Could not verify the page version — approval not applied, please retry." };
    }
    // 8.14: the evidence names what counted (buildApprovalRecord `quorum`).
    const qz = quorum || await quorumNow(pageId, pending).catch(() => ({ unknown: true }));
    // The list could not be read (only an admin's "any" approval completes then): the admins who
    // decided are what counted, and the record says the approver list was not readable.
    // 8.16: only the admins who are admins NOW (adminsNow) are named as counted.
    const evidenceQuorum = quorum || (qz && !qz.unknown ? { counted: qz.counted, effective: qz.effective, min: qz.min } : await listUnknownEvidence(pageId, pending));
    if (pending.pinnedVersion != null && live !== pending.pinnedVersion) {
      // WF-1: decideApproval refuses a stale approve BEFORE recording it (see there), so this
      // branch is only the race (the page changed between that check and here) and the AI path.
      // The request is closed and the requester is told the truth: nobody declined it.
      // A4: the decisions are about to be deleted; a stale outcome must not erase who said what.
      try {
        const staleRecord = buildApprovalRecord({
          pending, records: await readApprovalRecords(pageId, stateId, approvers), outcome: "stale", quorum: evidenceQuorum,
          completedBy: actorAccountId || null, completedByName: actorName || null,
        });
        const current = await readPageWorkflow(pageId);
        await appendWorkflowLog(pageId, {
          kind: "approval-stale", from: current?.stateId ?? null, to: stateId,
          by: actorAccountId || null, byName: actorName || null,
          reason: `page changed since review (reviewed v${pending.pinnedVersion}, now v${live})`,
          details: { approvalRecord: staleRecord },
        });
      } catch (e) { console.warn("[APPROVALS] stale trace failed:", errText(e)); }
      await clearPageApprovals(pageId, stateId, approvers);
      await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "stale", targetName: pending.toStateName || stateId, pinnedVersion: pending.pinnedVersion, liveVersion: live }).catch(() => {});
      return { success: true, outcome: "stale", transitioned: false, stale: true, pinnedVersion: pending.pinnedVersion, liveVersion: live, reason: describeStaleClosed(pending.pinnedVersion, live) };
    }
    // A4: snapshot the evidence from the strong per-key records NOW — clearPageApprovals below
    // deletes them, and the snapshot is what the page keeps (record.approvalRecord + the log).
    const approvalRecord = buildApprovalRecord({
      pending, records: await readApprovalRecords(pageId, stateId, approvers), outcome: "approved", quorum: evidenceQuorum,
      completedBy: actorAccountId || null, completedByName: actorName || null,
    });
    const res = await transitionPageWorkflow({
      pageId, spaceKey: pending.spaceKey, toStateId: stateId,
      actorAccountId: actorAccountId || pending.requestedBy || null, actorName,
      reason: voteSummary || "approved",
      approvers: pending.approvers, approvedVersion: pending.pinnedVersion,
      approvalRecord,
    });
    // Gate side-effects on the transition ACTUALLY happening. A finalizer that lost the race
    // gets res.success=false (validateTransition no-ops on the already-left source state) and
    // must NOT re-clear/re-notify — that would double-email or resurrect a phantom pending.
    if (res.success) {
      await clearPageApprovals(pageId, stateId, approvers);
      await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "approved", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
      return { success: true, outcome: "approved", transitioned: true, record: res.record };
    }
    return { success: true, outcome: "approved", transitioned: false, alreadyCompleted: true };
  } finally {
    await kvs.delete(completingKey(pageId)).catch(() => {});
  }
}

/**
 * 8.14: the request's quorum NOW — which of its approvers are still approvers (one read of the
 * space's list per `check`), their records and the deciding admins' records, and the outcome
 * (quorumOutcome). `{ unknown: true }` when any of its approvers could not be judged (a group could
 * not be read): nothing may be decided or completed on that, the caller says "try again".
 */
async function quorumNow(pageId, pending, check = newApproverCheck(), { judgeAdmins = true, knownAdmins = [], knownNotAdmins = [], assume = null, forAi = false } = {}) {
  const snapshot = pending?.approvers || [];
  let effective = [];
  const space = pending?.spaceKey || (await readPageWorkflow(pageId))?.spaceKey || null;
  if (snapshot.length) {
    const statuses = await Promise.all(snapshot.map((id) => check(snapshot, id, space)));
    if (statuses.includes("unknown")) return { unknown: true, unknownCause: "list", space };
    effective = snapshot.filter((_, i) => statuses[i] === "yes");
  }
  const adminsMay = (await getSpaceWorkflowSettings(space))?.approval?.adminsCanApprove !== false;
  let adminIds = (pending?.adminDeciders || []).filter((id) => !effective.includes(id));
  // 8.16: an admin's vote counts only while that person is an admin NOW (adminsNow), the rule the
  // listed approvers follow since 8.14. `judgeAdmins: false` is for the banner's read model, which
  // shows no outcome and must not spend a role check per admin on every page view. `knownAdmins`
  // are people this invocation already proved admins (the deciding admin): not asked again.
  let unsure = [];
  let notAdmins = [];
  if (judgeAdmins && adminIds.length) {
    const now = await adminsNow(pageId, pending, adminIds, { adminsMay, known: knownAdmins, knownNo: knownNotAdmins });
    adminIds = now.ids;
    unsure = now.unknownIds;
    notAdmins = now.noIds;
  }
  // `assume` ({ accountId, status }): judge as if that person's decision were already recorded (the
  // decide path asks BEFORE recording a vote whether its outcome can be told at all).
  const as = (list) => (assume ? list.map((r) => (r?.approverAccountId === assume.accountId ? { ...r, status: assume.status } : r)) : list);
  const [listedRecords, adminRecords, unsureRecords] = (await Promise.all([
    readApprovalRecords(pageId, pending.toStateId, effective),
    adminIds.length ? readApprovalRecords(pageId, pending.toStateId, adminIds) : [],
    unsure.length ? readApprovalRecords(pageId, pending.toStateId, unsure) : [],
  ])).map(as);
  const out = quorumOutcome(pending, effective, listedRecords, adminRecords, { adminsMay });
  // An admin whose role could not be checked (a 429) is left out. That only matters when their
  // approval would change the outcome: an admin's denial counts only in all-of and admin-only
  // requests, where it closes the request the moment it is given, so none counts on an open one.
  // Then the outcome is unknown and nothing is decided on it ("try again"; the AI pass waits). A vote
  // reads `outcome` only; the AI pass also reads `withRemovedPending` (humanQuorumState), so `forAi`
  // compares that too.
  if (unsure.length && unsureRecords.some((r) => r?.status === "approved")) {
    const withThem = quorumOutcome(pending, effective, listedRecords, [...adminRecords, ...unsureRecords.filter((r) => r?.status === "approved")], { adminsMay });
    if (withThem.outcome !== out.outcome || (forAi && withThem.withRemovedPending !== out.withRemovedPending)) return { unknown: true, unknownCause: "admins", space };
  }
  // `admins` / `notAdmins`: the role answers this judgement rests on (proven, never unknown), so a
  // second judgement in the same decision reuses them; `unsure` those that could not be told.
  return { unknown: false, effective, listedRecords, adminRecords, ...out, counted: [...effective, ...adminIds], admins: adminIds, notAdmins, unsure, adminsMay };
}

/**
 * 8.16: the evidence quorum when the approver list could not be read (only an admin's "any" approval
 * completes then): the deciding admins who are admins NOW, and the record says the list was not
 * readable. `known` names people already proven admins in this call (the deciding admin), kept when
 * the others cannot be judged.
 */
async function listUnknownEvidence(pageId, pending, known = []) {
  const now = await adminsNow(pageId, pending, pending?.adminDeciders || [], { known }).catch(() => ({ ids: [...known] }));
  return { counted: [...new Set([...now.ids, ...known])], listUnknown: true };
}

/**
 * 8.16: which of `ids` (people who decided as a space admin) are admins of the page's space NOW: the
 * same test decideApproval's admin arm uses (isStewardOfRecord over the space the page is in now and,
 * if it moved since the request, the request's space; isAccountStewardAsApp), with "could not tell"
 * kept apart. None while the space does not let admins decide. `{ unknown: true }` when any of them
 * could not be judged (a 429): nothing may be decided or completed on that, the caller says "try
 * again". Never counts a vote on unknown.
 */
async function adminsNow(pageId, pending, ids, { adminsMay = null, known = [], knownNo = [] } = {}) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return { ids: [], unknownIds: [], noIds: [] };
  const may = adminsMay ?? ((await getSpaceWorkflowSettings(pending?.spaceKey || (await readPageWorkflow(pageId))?.spaceKey || null))?.approval?.adminsCanApprove !== false);
  if (!may) return { ids: [], unknownIds: [], noIds: list };
  // `known` / `knownNo`: answers this call already has (the deciding admin; an earlier judgement in
  // the same decision) — never asked again, so two judgements in one decision cannot disagree.
  const proven = list.filter((id) => (known || []).includes(id));
  const provenNo = list.filter((id) => !proven.includes(id) && (knownNo || []).includes(id));
  const ask = list.filter((id) => !proven.includes(id) && !provenNo.includes(id));
  if (!ask.length) return { ids: proven, unknownIds: [], noIds: provenNo };
  const auth = await recordAuthority({ contentId: pageId, storedKey: pending?.spaceKey || null });
  if (!auth.known) { if (auth.rateLimited) noteAuthzUnknown(); return { ids: proven, unknownIds: ask, noIds: provenNo }; }
  // strict: a read with no answer at all (5xx, a throw) is "could not tell", never "no longer an
  // admin" — dropping someone's vote needs a proven negative.
  const statuses = await Promise.all(ask.map((id) => stewardOfSpacesStatus((a, k) => accountStewardStatusAsApp(a, k, { strict: true }), id, auth.spaces)));
  if (statuses.some((st) => st.unknown)) noteAuthzUnknown();
  return {
    ids: [...proven, ...ask.filter((_, i) => statuses[i].steward === true)],
    unknownIds: ask.filter((_, i) => statuses[i].unknown === true),
    noIds: [...provenNo, ...ask.filter((_, i) => statuses[i].steward !== true && statuses[i].unknown !== true)],
  };
}

// Whether the human approval axis is satisfied for the AI pass (vacuously true for an AI-only
// gate). Counted over the approvers who are approvers NOW (quorumNow). When approvers on the
// request are off the list (`rejudged`) and the outcome depends on that, the AI pass does not
// complete it: an explicit human approval completes it (decideApproval, which finalizes once the
// AI has passed) or it is re-requested — a quorum met only because approvers were removed, or one
// standing next to a denial, is never turned into an approval by the AI pass.
/**
 * 8.16, the ONE rule for "a former admin's approval is holding this request back" (the banner's
 * listChanged and the re-request reset both read it): approvals (never denials) recorded by people
 * who decided as admins, are not on the request's current approver list, are PROVEN no longer admins
 * (or the space stopped letting admins decide), and whose approvals would change the outcome if they
 * still counted. In an all-of request admin approvals never count, so it never matters there.
 * `{ matters, ids }`; "could not tell" never matters.
 */
async function formerAdminApprovals(pageId, pending, check = newApproverCheck()) {
  if (!(pending?.adminDeciders || []).length || (pending?.mode || "any") === "all") return { matters: false, ids: [] };
  const q = await quorumNow(pageId, pending, check);
  if (q.unknown || !q.notAdmins?.length) return { matters: false, ids: [] };
  const former = (await readApprovalRecords(pageId, pending.toStateId, q.notAdmins)).filter((r) => r?.status === "approved");
  if (!former.length) return { matters: false, ids: [] };
  const withThem = quorumOutcome(pending, q.effective, q.listedRecords, [...q.adminRecords, ...former], { adminsMay: true });
  // `cause`: "setting" when the space no longer lets admins decide (every admin's approval stopped
  // counting), else "role" (the people are no longer admins).
  return { matters: withThem.outcome !== q.outcome, ids: former.map((r) => r.approverAccountId), cause: q.adminsMay === false ? "setting" : "role" };
}

// 8.16: `{ met, unknown }` — `unknown` when it could not be told (the approver list or a deciding
// admin's role could not be read); never met on unknown. humanQuorumMet is the boolean.
async function humanQuorumState(pageId, pending) {
  if (!pending.approvers || pending.approvers.length === 0) return { met: true, unknown: false };
  const q = await quorumNow(pageId, pending, newApproverCheck(), { forAi: true });
  if (q.unknown) {
    // While the list cannot be read, an "any" request a space admin approved is met: the admin's
    // approval decides it whatever the listed approvers say (the decide path's rule).
    // 8.16: only the approval of someone who is an admin NOW (adminsNow); "could not tell" is a no.
    if (q.unknownCause !== "list" || (pending.mode || "any") !== "any" || !(pending.adminDeciders || []).length) return { met: false, unknown: true };
    const admins = await adminsNow(pageId, pending, pending.adminDeciders);
    const adminRecords = admins.ids.length ? await readApprovalRecords(pageId, pending.toStateId, admins.ids) : [];
    if (adminRecords.some((r) => r?.status === "approved")) return { met: true, unknown: false, quorum: { counted: admins.ids, listUnknown: true } };
    return { met: false, unknown: true };
  }
  if (q.outcome !== "approved") return { met: false, unknown: false };
  // After a removal: met only when the request judged as asked (removed approvers still pending)
  // is already met — the removal changed nothing; otherwise an explicit approval or a re-request.
  // `quorum` is what counted, handed to the finalizer so the evidence is the judgement just made.
  return { met: !q.rejudged || q.withRemovedPending === "approved", unknown: false, quorum: { counted: q.counted, effective: q.effective, min: q.min } };
}
async function humanQuorumMet(pageId, pending) { return (await humanQuorumState(pageId, pending)).met; }

// #46 Part B: the AI review verdict lands here (from aiValidationConsumer's gate branch, or a
// simulated verdict / the reaper). Writes the verdict onto the SAME pending record as an
// `aiGate` axis, then completes the transition iff the human quorum is also met. CAS-guarded:
// only flips aiGate from "pending", so a duplicate delivery or a reaper/worker race is a no-op.
export async function applyAiVerdict(pageId, reviewedVersion, status, reason) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending?.aiGate?.required) return { applied: false, reason: "no AI gate pending" };
  if (pending.aiGate.status !== "pending") return { applied: false, reason: "already resolved" }; // CAS: only from pending
  // Version pin: if the AI scored a different version than the humans reviewed, it's stale → fail.
  const stale = reviewedVersion != null && pending.pinnedVersion != null && reviewedVersion !== pending.pinnedVersion;
  // A pass that would COMPLETE the request (the human quorum is met already) on a page that moved
  // spaces, or whose space cannot be read right now, is not consumed: the request stays open and
  // the page holds still (moved-hold.js). A pass that still waits for the humans is recorded as
  // before; the last vote is held (decide-approval) if the page moved by then.
  let quorumAlready = null;
  if (!stale && status === "passed") {
    quorumAlready = await humanQuorumMet(pageId, pending);
    if (quorumAlready) {
      const hold = await movedPageHold(pageId, { actorAccountId: pending.requestedBy || null, storedKey: pending.spaceKey || null });
      if (hold) return { applied: false, reason: hold.reason, moved: !!hold.moved };
    }
  }
  pending.aiGate.status = stale ? "failed" : (status === "passed" ? "passed" : "failed");
  pending.aiGate.reviewedVersion = reviewedVersion ?? null;
  pending.aiGate.reason = stale ? "Page changed during AI review — re-request." : (reason ?? null);
  // Re-read immediately before the write: don't resurrect a pending record that a concurrent
  // completion or denial (clearPageApprovals) just deleted (best-effort narrowing; no KVS CAS).
  const still = await kvs.get(pendingKey(pageId));
  if (!still || still.aiGate?.status !== "pending") return { applied: false, reason: "resolved concurrently" };
  await kvs.set(pendingKey(pageId), pending);
  if (pending.aiGate.status !== "passed") return { applied: true, status: pending.aiGate.status };
  // AI passed — complete iff the human axis is also met (else wait for the last human vote).
  const humans = await humanQuorumState(pageId, pending);
  if (!humans.met) {
    // 8.16: the human axis could not be told (a group or a deciding admin's role unreadable): the
    // verdict is kept and the request is marked, so the hourly sweep finishes it once it can be told
    // (completeWhenKnown). Without that a request whose approvers had all voted stayed open for good.
    if (humans.unknown) await markQuorumUnknown(pageId);
    return { applied: true, status: "passed", waiting: "humans", ...(humans.unknown ? { humansUnknown: true } : {}) };
  }
  // The AI was a CONDITION; the authority was the steward who requested the transition. The hold was
  // asked above only if the quorum was met then; otherwise the finalizer asks it now.
  const res = await finalizeApprovedTransition(pageId, pending.toStateId, pending, pending.requestedBy || null, pending.requestedByName || "Sentinel Vault", "approved (AI review + approvals)", { holdChecked: quorumAlready === true, quorum: humans.quorum || null });
  return { applied: true, status: "passed", ...res };
}

// 8.16: an AI-passed request whose human quorum could not be told when the verdict landed carries
// `quorumUnknownAt`; the hourly sweep finishes it (completeWhenKnown). Votes are never deferred: the
// decide path refuses up front ("try again") when the outcome of the vote could not be told.
// Read-modify-write like every pending write (KVS has no compare-and-set): skipped while a completion
// holds its claim, and re-read right before the write so a closed request is not brought back.
async function markQuorumUnknown(pageId) {
  try {
    if (await kvs.get(completingKey(pageId))) return;
    const cur = await kvs.get(pendingKey(pageId));
    if (!cur || cur.quorumUnknownAt || cur.aiGate?.status !== "passed") return;
    await kvs.set(pendingKey(pageId), { ...cur, quorumUnknownAt: Date.now() });
  } catch (e) { console.warn("[APPROVALS] quorum-unknown mark failed:", errText(e)); }
}
async function clearQuorumUnknown(pageId) {
  if (await kvs.get(completingKey(pageId))) return;
  const cur = await kvs.get(pendingKey(pageId));
  if (cur?.quorumUnknownAt) { const { quorumUnknownAt, ...rest } = cur; await kvs.set(pendingKey(pageId), rest); }
}

/**
 * 8.16 (hourly, workflowSweep): finish a marked request (markQuorumUnknown) once its quorum can be told.
 * Met: completed exactly as the AI pass would have (the requester's authority, the AI as condition,
 * the finalizer's version and moved-page guards). Known not met, or the AI review no longer passed:
 * the mark is cleared (the next vote judges it as usual). Still unknown: kept for the next run.
 */
export async function completeWhenKnown(pageId) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending?.quorumUnknownAt) return { done: false, reason: "not waiting" };
  if (pending.aiGate?.required && pending.aiGate.status !== "passed") { await clearQuorumUnknown(pageId); return { done: false, reason: "ai review" }; }
  const humans = await humanQuorumState(pageId, pending);
  if (humans.unknown) return { done: false, reason: "still unknown" };
  if (!humans.met) { await clearQuorumUnknown(pageId); return { done: false, reason: "not met" }; }
  const res = await finalizeApprovedTransition(pageId, pending.toStateId, pending, pending.requestedBy || null, pending.requestedByName || "Sentinel Vault", "approved (AI review + approvals)", { quorum: humans.quorum || null });
  return { done: res?.transitioned === true, ...res };
}

// An approver records a decision; if the threshold resolves, complete or clear the transition.
export async function decideApproval({ pageId, approverAccountId, decision, reason, actorName, signatureCode }) {
  // 8.16: a decision is about content the decider can SEE. Asked of Confluence for this account
  // (content-access.js canReadPage, fails closed; a 429 answers "try again" via busyAware) before
  // anything is read or recorded (no answer about whether a request exists on a page you cannot
  // see), for every kind of decider: a listed approver and a space admin alike. The
  // page id may come from the payload (the approvals inbox, a REST client), so nothing else proves it.
  const viewRefusal = await viewToDecideRefusal(approverAccountId, pageId);
  if (viewRefusal) return viewRefusal;
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { success: false, reason: "No approval is pending for this page" };
  // Segregation of duties: the requester cannot approve their own transition.
  if (pending.requestedBy && approverAccountId === pending.requestedBy) {
    return { success: false, reason: "You cannot approve a transition you requested" };
  }
  const stateId = pending.toStateId;
  const approvers = pending.approvers || [];
  const key = approvalKey(pageId, stateId, approverAccountId);
  let record = await kvs.get(key);
  const spaceSettings = await getSpaceWorkflowSettings(pending.spaceKey);
  const adminsMay = spaceSettings?.approval?.adminsCanApprove !== false;
  // An admin of the space the page is in NOW and, if it moved since the request, of the space the
  // request was made in (content-access.js recordAuthoritySpaces) — never the stored space alone.
  const isAdmin = async () => adminsMay && await isStewardOfRecord(isAccountStewardAsApp, approverAccountId, { contentId: pageId, storedKey: pending.spaceKey || null });
  // A listed approver decides only while still one of the space's approvers (approverStatusNow):
  // the request's snapshot alone is not authority. Someone taken off the list (or out of the group)
  // since the request decides only as a space admin; a list that cannot be read is "unknown" —
  // nothing is recorded and they are asked to try again.
  const space = pending.spaceKey || (await readPageWorkflow(pageId))?.spaceKey || null;
  const check = newApproverCheck(); // one read of the space's approver list for this decision
  let asAdmin = false; // a listed approver taken off the list who decides as a space admin
  if (record && !record.admin) {
    const now = await check(approvers, approverAccountId, space);
    if (now !== "yes") {
      if (!(await isAdmin())) return approverRefusal(now, {}, { unreadGroups: now === "unknown" ? await check.unreadGroups(space) : [] });
      asAdmin = true;
    }
  } else if (record?.admin && record.status === "pending" && !(await isAdmin())) {
    // An admin's record made by an earlier call that never recorded a vote: still an admin's act.
    return { success: false, reason: "You are not an approver for this transition" };
  }
  if (!record) {
    // Space admins may decide without being listed (owner, 2026-09-25; on unless the space turns
    // it off). The record is made now and the admin is added to the request's decider list, so
    // every read, the evidence snapshot and the cleanup see it.
    if (!(await isAdmin())) {
      // A current approver who is not on this (older) request: it was opened before the list
      // changed, so it must be re-requested to reach them.
      if ((await check([approverAccountId], approverAccountId, space)) === "yes") {
        return { success: false, needsRerequest: true, reason: "This request was made before the space's approvers changed, so you're not on it. The requester or a space admin can re-request it." };
      }
      return { success: false, reason: "You are not an approver for this transition" };
    }
    record = { approverAccountId, status: "pending", admin: true, approverName: actorName || null, createdAt: new Date().toISOString() };
    await kvs.set(key, record);
    const fresh = (await kvs.get(pendingKey(pageId))) || pending;
    fresh.adminDeciders = [...new Set([...(fresh.adminDeciders || []), approverAccountId])];
    await kvs.set(pendingKey(pageId), fresh);
    pending.adminDeciders = fresh.adminDeciders;
  }
  if (record.status && record.status !== "pending") {
    return { success: false, reason: "Your decision has already been recorded" };
  }
  if (decision !== "approved" && decision !== "denied") return { success: false, reason: "Invalid decision" };
  // 8.14: the quorum is counted over the request's approvers who are approvers NOW. When one of them
  // cannot be judged (a group could not be read) the outcome is unknown: nothing is recorded.
  // One exception: in "any", a space admin's own decision does not depend on the listed approvers
  // (an admin's approval completes it, an admin's "no" leaves it open), so it proceeds.
  const byAdmin = asAdmin || record.admin === true;
  // 8.16: the deciding admin was proved an admin above (isAdmin): not asked again in this call.
  const knownAdmins = byAdmin ? [approverAccountId] : [];
  // 8.16: judged as if this decision were already recorded, so a vote whose outcome cannot be told
  // (it would hinge on an admin whose role could not be read) is refused before anything is recorded.
  // A listed approver taken off the list who decides as an admin is added to the deciding admins only
  // when the vote is recorded below: judged here as one already.
  const pendingAsIfRecorded = byAdmin && !(pending.adminDeciders || []).includes(approverAccountId) ? { ...pending, adminDeciders: [...(pending.adminDeciders || []), approverAccountId] } : pending;
  const q0 = await quorumNow(pageId, pendingAsIfRecorded, check, { knownAdmins, assume: (decision === "approved" || decision === "denied") ? { accountId: approverAccountId, status: decision } : null });
  // Only an unreadable approver LIST lets an admin's own any-of decision through (it does not depend
  // on the listed approvers).
  const adminDespiteUnknown = q0.unknown && q0.unknownCause === "list" && byAdmin && (pending.mode || "any") === "any";
  if (q0.unknown && !adminDespiteUnknown) return approverRefusal("unknown", {}, { unreadGroups: q0.unknownCause === "list" ? await check.unreadGroups(space) : [] });
  // An approval of a page that moved to another space since the request is held (moved-hold.js) —
  // before anything is recorded. A "no" still closes the request.
  if (decision === "approved") {
    const hold = await movedPageHold(pageId, { actorAccountId: approverAccountId, storedKey: pending.spaceKey || null });
    if (hold) return { success: false, reason: hold.reason, moved: !!hold.moved };
  }
  // WF-1 (UX critique 2026-09-19): an approval of a version nobody reviewed is refused UP FRONT —
  // nothing recorded, the request stays open, no comment. Before this the vote was recorded, the
  // finalizer threw the whole request away as "stale" and the requester read "declined by <the
  // approver>". A denial is still accepted: "no" to a page that changed is still "no". Checked
  // before the signature so a refused decision never burns the approver's code.
  if (decision === "approved" && pending.pinnedVersion != null) {
    const live = await fetchLivePageVersion(pageId);
    if (live != null && live !== pending.pinnedVersion) {
      return { success: false, stale: true, pinnedVersion: pending.pinnedVersion, liveVersion: live, reason: describeStaleRequest(pending.pinnedVersion, live, pending.requestedByName) };
    }
  }
  // B3: a space can require every decision to be SIGNED — a TOTP from the approver's enrolled
  // device. Verified AFTER every validity check above (review finding 14): a refused decision
  // must not burn the approver's current code, and a failed code leaves no trace.
  let signature = null;
  if (spaceSettings?.requireSignature) {
    const v = await verifySignature(approverAccountId, signatureCode);
    if (!v.ok) return { success: false, reason: v.reason, signatureRequired: true };
    signature = v.signature;
  }

  record.status = decision;
  record.decidedAt = new Date().toISOString();
  record.reason = reason || null;
  if (signature) record.signature = signature;
  // A4: the version this approver decided on (the request pin is the version they were ASKED
  // about; a denial after an interim save is about what they actually saw).
  try { const lv = await fetchLivePageVersion(pageId); if (typeof lv === "number") record.decidedVersion = lv; } catch (_) { /* best-effort */ }
  if (actorName && !record.approverName) record.approverName = actorName;
  if (asAdmin) {
    // Their listed slot no longer counts (they are off the list); the vote counts as an admin's.
    record.admin = true;
    const fresh = (await kvs.get(pendingKey(pageId))) || pending;
    fresh.adminDeciders = [...new Set([...(fresh.adminDeciders || []), approverAccountId])];
    await kvs.set(pendingKey(pageId), fresh);
    pending.adminDeciders = fresh.adminDeciders;
  }
  await kvs.set(key, record);

  // Aggregate from strongly-consistent per-key gets over the approvers who are approvers NOW
  // (quorumNow; the list read above is reused) plus the admins who decided.
  const q = adminDespiteUnknown
    ? { listedRecords: [], adminRecords: [record], outcome: decision === "approved" ? "approved" : "pending", counted: null }
    : await quorumNow(pageId, pending, check, { knownAdmins: [...knownAdmins, ...(q0.admins || [])], knownNotAdmins: q0.notAdmins || [] });
  // 8.16: the outcome was told before the vote was recorded (q0, judged with it). Should it turn
  // unknown in between (a 429 starting within this call), nothing completes on it: the vote stands and
  // the request stays open for the next decision.
  const later = q.unknown === true;
  const records = later ? [] : [...q.listedRecords, ...q.adminRecords]; // the vote summary names every counted decider
  // A "no" never completes a request: when the quorum reads "approved" after a DENIAL (the approvals
  // already in meet a minimum that re-clamped when approvers left the list), the request stays
  // open; an approver's or admin's next approval completes it, or it is re-requested.
  const outcome = later ? "pending" : (decision === "denied" && q.outcome === "approved" ? "pending" : q.outcome);
  const evidenceQuorum = later ? null : (q.counted ? { counted: q.counted, effective: q.effective, min: q.min } : await listUnknownEvidence(pageId, pending, [approverAccountId]));

  // A1: the vote is recorded (kvs.set above) — witness it with the outcome the vote produced.
  // `outcome` here is what the quorum says; the finalizer may still turn "approved" into
  // "stale" (page changed) or a no-op, so the result's own outcome wins when it has one.
  const decided = async (result) => {
    await touchByline(pageId); // WF-6: "Awaiting approval 1 of 2", or the state the finalizer moved to
    await recordActivity({
      type: "workflow.approval-decided",
      pageId,
      spaceKey: pending.spaceKey || null,
      actor: { accountId: approverAccountId, name: actorName || record.approverName || null },
      target: { kind: "page", id: pageId, name: null },
      details: {
        decision,
        reason: reason || null,
        to: stateId,
        toName: pending.toStateName || stateId,
        versionAtDecision: await fetchLivePageVersion(pageId),
        outcome: result?.outcome || outcome,
        transitioned: result?.transitioned === true,
      },
      version: pending.pinnedVersion ?? null,
    });
    return result;
  };

  if (later) return decided({ success: true, outcome: "pending" });
  if (outcome === "approved") {
    // #46: the human quorum is met — the transition completes only when the AI axis (if
    // required) has also passed. RE-READ the pending fresh so a verdict that landed AFTER our
    // initial read isn't missed (else a lost-wakeup: AI just passed, our stale snapshot still
    // says pending, we'd hold with the quorum already met and neither path would finalize).
    const freshPending = (await kvs.get(pendingKey(pageId))) || pending;
    if (freshPending.aiGate?.required && freshPending.aiGate.status !== "passed") {
      if (freshPending.aiGate.status === "failed") {
        return decided({ success: true, outcome: "ai-blocked", transitioned: false, reason: "AI content review did not pass — revise and re-request." });
      }
      return decided({ success: true, outcome: "pending-ai", transitioned: false, reason: "Approvals complete — waiting on the AI content review." });
    }
    const voteSummary = `approved (${records.filter((r) => r.status === "approved").length}/${records.length})`;
    return decided(await finalizeApprovedTransition(pageId, stateId, freshPending, approverAccountId, actorName, voteSummary, { holdChecked: decision === "approved", quorum: evidenceQuorum }));
  }
  if (outcome === "denied") {
    // A4 §3: a denial used to leave NO durable trace once the records were deleted. Snapshot
    // the evidence (from `records`, read above — before the clear) into a workflow-log entry
    // FIRST, so the trace exists even if the clear below fails midway. Shape mirrors a
    // transition entry (from/to/by/byName/reason) plus `kind` so readers can tell it apart:
    // the page did NOT move, it stays in `from`.
    const approvalRecord = buildApprovalRecord({
      // The evidence names everyone asked (a removed approver's earlier vote included), as before.
      pending, records: await readApprovalRecords(pageId, stateId, deciderIds(pending)), outcome: "denied", quorum: evidenceQuorum,
      completedBy: approverAccountId, completedByName: actorName || record.approverName || null,
    });
    await appendWorkflowLog(pageId, {
      kind: "approval-denied",
      from: (await readPageWorkflow(pageId))?.stateId ?? null,
      to: stateId,
      by: approverAccountId,
      byName: actorName || record.approverName || null,
      reason: "approval denied",
      details: { approvalRecord },
    });
    await clearPageApprovals(pageId, stateId, deciderIds(pending));
    // WF-3: the approver's reason travels with the denial — it is the point of Deny + reason.
    await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "denied", targetName: pending.toStateName || stateId, deciderName: actorName, reason: record.reason || null }).catch(() => {});
    return decided({ success: true, outcome: "denied" });
  }
  return decided({ success: true, outcome: "pending" });
}

// The requester takes their request back (or a space admin closes it without a decision): no vote,
// the page stays where it is, the approvers' inbox rows go, a "withdrawn" log entry + activity
// remain (tester 2026-09-30: a requester had no way to cancel their own request).
export async function withdrawApproval({ pageId, actorAccountId, actorName, isSteward = false }) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { success: false, reason: "No approval is waiting on this page." };
  if (!(actorAccountId && (actorAccountId === pending.requestedBy || isSteward))) {
    return { success: false, reason: "Only the person who asked, or a space admin, can withdraw this request." };
  }
  const records = await readApprovalRecords(pageId, pending.toStateId, deciderIds(pending));
  const approvalRecord = buildApprovalRecord({ pending, records, outcome: "withdrawn", completedBy: actorAccountId, completedByName: actorName || null });
  await appendWorkflowLog(pageId, {
    kind: "approval-withdrawn",
    from: (await readPageWorkflow(pageId))?.stateId ?? null,
    to: pending.toStateId,
    by: actorAccountId,
    byName: actorName || null,
    reason: "approval request withdrawn",
    details: { approvalRecord },
  }).catch(() => {});
  await clearPageApprovals(pageId, pending.toStateId, deciderIds(pending));
  await recordActivity({
    type: "workflow.approval-withdrawn",
    pageId,
    spaceKey: pending.spaceKey || null,
    actor: { accountId: actorAccountId, name: actorName || null },
    target: { kind: "page", id: pageId, name: null },
    details: { to: pending.toStateId, toName: pending.toStateName || pending.toStateId, requestedBy: pending.requestedBy || null, byRequester: actorAccountId === pending.requestedBy },
    version: pending.pinnedVersion ?? null,
  }).catch(() => {});
  return { success: true, outcome: "withdrawn" };
}

// Read model for the page/panel: the pending transition + per-approver statuses + staleness.
export async function getPageApprovalStatus(pageId) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { pending: false };
  const records = await readApprovalRecords(pageId, pending.toStateId, deciderIds(pending));
  const current = await readPageWorkflow(pageId);
  // #44: staleness — the page changed since the approvers reviewed it, so a completion
  // now would be blocked at decideApproval (§1.5). Surface it in the inbox/panel.
  const liveVersion = await fetchLivePageVersion(pageId);
  const stale = pending.pinnedVersion != null && liveVersion !== pending.pinnedVersion;
  // 8.14: which of the request's approvers are approvers NOW (their decisions are the ones that
  // count) and whether it must be re-requested to reach the space's current approvers. The banner
  // reads this on every view of the page: no group is read here (Confluence points), so with an
  // approver GROUP the flags stay unset and the decision itself checks fully.
  const q = await quorumNow(pageId, pending, newApproverCheck({ expandGroups: false }), { judgeAdmins: false });
  // 8.16: an admin's approval that would count toward the ribbon's "min" sum is judged NOW (adminsNow)
  // so the ribbon does not count a former admin's vote. Only admins' approvals in requests where they
  // can count (not all-of) are asked about, and only when there is one: an open request holds such a
  // record only in min mode or while an AI review is pending, so the common case spends nothing.
  const adminApproved = (pending.mode || "any") === "all" ? [] : records.filter((r) => r.admin === true && r.status === "approved" && !(pending.approvers || []).includes(r.approverAccountId)).map((r) => r.approverAccountId);
  const adminNow = adminApproved.length ? await adminsNow(pageId, pending, adminApproved).catch(() => ({ ids: [], unknownIds: adminApproved, noIds: [] })) : { ids: [], unknownIds: [], noIds: [] };
  const currentOf = (id) => {
    if (adminApproved.includes(id)) return adminNow.ids.includes(id) ? true : (adminNow.unknownIds.includes(id) ? undefined : false);
    return q.unknown || !(pending.approvers || []).includes(id) ? undefined : q.effective.includes(id);
  };
  // listChanged: the space's approver list differs from the request's (someone on the request is
  // off it, or someone named on it is not on the request): the requester or a space admin is
  // offered a re-request, which asks the current list and resets every decision. `listCheck`
  // "unknown" when that cannot be told without reading a group (the re-request is still offered).
  const snapshot = pending.approvers || [];
  let listChanged; let listCheck = "known"; let formerAdmin = false;
  if (snapshot.length) {
    const plan = extractApprovalConfig((await getSpaceWorkflowSettings(pending.spaceKey || current?.spaceKey || null))?.approval);
    const added = (plan?.userIds || []).some((id) => !snapshot.includes(id));
    // 8.16: the re-request's own rule (formerAdminApprovals), asked only when a proven former admin's
    // approval is on the request, so the banner offers exactly the re-request the server performs.
    const fa = adminNow.noIds.length > 0 ? await formerAdminApprovals(pageId, pending).catch(() => ({ matters: false })) : { matters: false };
    formerAdmin = fa.matters ? (fa.cause || "role") : false;
    if (added || formerAdmin || (!q.unknown && q.effective.length < snapshot.length)) listChanged = true;
    else if (q.unknown || (plan?.groups?.length || 0) > 0) listCheck = "unknown";
    else listChanged = false;
  }
  return {
    pending: true, toStateId: pending.toStateId, mode: pending.mode, min: q.unknown ? pending.min : q.min,
    needsRerequest: !q.unknown && q.needsRerequest === true,
    ...(snapshot.length ? { listChanged: listChanged === true, listCheck: listChanged === true ? "known" : listCheck } : {}),
    ...(formerAdmin ? { formerAdminApproval: formerAdmin } : {}),
    requestedBy: pending.requestedBy, requestedByName: pending.requestedByName, requestedAt: pending.requestedAt,
    pinnedVersion: pending.pinnedVersion, stale, liveVersion, currentStateId: current?.stateId || null,
    approvers: records.map((r) => ({ accountId: r.approverAccountId, name: r.approverName, status: r.status, reason: r.reason, decidedAt: r.decidedAt, signed: !!r.signature, admin: r.admin === true, current: currentOf(r.approverAccountId) })),
    // #46: the AI review axis, if this transition requires one.
    aiGate: pending.aiGate?.required ? { status: pending.aiGate.status, reason: pending.aiGate.reason || null } : null,
  };
}

// WF-1: the two stale sentences, pure (unit-tested). The refusal names both versions and what to
// do; the closed notice names the versions and that nobody declined.
export function describeStaleRequest(pinnedVersion, liveVersion, requestedByName) {
  const ask = requestedByName ? `, or ask ${requestedByName} to` : "";
  return `This page changed after the request (reviewed v${pinnedVersion}, now v${liveVersion}). Approving would not move it — re-request approval for v${liveVersion}${ask}.`;
}
export function describeStaleClosed(pinnedVersion, liveVersion) {
  return `The page changed after the request (v${pinnedVersion} → v${liveVersion}), so the request was closed — nobody declined it. Re-request approval when the page is ready.`;
}

// WF-1: re-pin the OPEN request to the live version, keeping the original requester (so the
// approver who noticed the change can bring the request up to date and still decide on it —
// re-requesting under their own name would trip segregation of duties). Every recorded decision
// was about the old version, so all go back to pending. No-op when nothing changed. Authority is
// the caller's: an approver on the request, its requester, or a steward (checked by the action).
export async function rerequestApproval({ pageId, actorAccountId, actorName, isSteward = false }) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { success: false, reason: "No approval is pending for this page" };
  const approvers = pending.approvers || [];
  const allowed = isSteward || actorAccountId === pending.requestedBy || approvers.includes(actorAccountId);
  if (!allowed) return { success: false, reason: "Only an approver, the requester or a space admin can re-request this approval" };
  const space = pending.spaceKey || (await readPageWorkflow(pageId))?.spaceKey || null;
  // The approver arm is an approver's act NOW (approverStatusNow), like a decision: re-pinning
  // resets every recorded decision, so someone taken off the list since the request may not.
  if (!isSteward && actorAccountId !== pending.requestedBy) {
    const now = await approverStatusNow(approvers, actorAccountId, space);
    if (now !== "yes") return approverRefusal(now);
  }
  const live = await fetchLivePageVersion(pageId);
  if (live == null) return { success: false, reason: "Could not verify the page version — please retry." };
  // 8.14: a re-request asks the space's CURRENT approvers (the request's own list may name people
  // taken off it since, or miss people added). Never on a list that could not be read, never onto
  // nobody (that would be an approval no human decides), never past the per-request cap.
  let next = { approvers: [], mode: pending.mode, min: pending.min };
  let names = {};
  if (approvers.length) {
    const settings = await getSpaceWorkflowSettings(space);
    const spec = await resolveApproverIds(settings?.approval);
    if (spec?.unresolved) return approverRefusal("unknown", {}, { unreadGroups: spec.unresolvedGroups || [] });
    if (!spec?.approvers?.length) return { success: false, reason: "This space has no approvers now, so the request can't be re-requested. A space admin can name approvers in the space's Workflow settings, or the request can be withdrawn." };
    if (spec.approvers.length > MAX_REQUEST_APPROVERS) return { success: false, reason: `The approvers for this step expand to ${spec.approvers.length} people (groups included); one request can ask at most ${MAX_REQUEST_APPROVERS}. A space admin can name fewer people or a smaller group in the space's Workflow settings.` };
    next = { approvers: spec.approvers, mode: spec.mode || "any", min: spec.min || 1 };
    (settings?.approval?.approvers || []).forEach((a) => { if (a?.id) names[a.id] = a.name || null; });
  }
  // 8.16: never re-open onto approvers who cannot view the page when that leaves it unfinishable.
  if (next.approvers.length) {
    const refusal = await viewReachabilityRefusal(pageId, { approvers: next.approvers, mode: next.mode, min: next.min, requestedBy: pending.requestedBy, spaceKey: space, names });
    if (refusal) return refusal;
  }
  const sameList = next.approvers.length === approvers.length && next.approvers.every((id) => approvers.includes(id)) && next.mode === pending.mode && next.min === pending.min;
  const versionChanged = pending.pinnedVersion !== live;
  // 8.16: when a former admin's approval is holding the request back (formerAdminApprovals, the rule
  // the banner shows), the requester or a space admin may re-ask with nothing else changed, so the
  // request can always be finished; otherwise one whose approvers had all voted could only be
  // withdrawn. Never an approver's call (it resets everyone's decisions), never on "could not tell".
  let formerAdminVote = false;
  if (!versionChanged && sameList && (isSteward || actorAccountId === pending.requestedBy)) {
    formerAdminVote = (await formerAdminApprovals(pageId, pending)).matters;
  }
  if (!versionChanged && sameList && !formerAdminVote) return { success: true, changed: false, pinnedVersion: live };
  // An approver (not the requester, not a space admin) re-requests to bring the request to a new
  // version, or when someone on it is off the space's list; a list that only GAINED people is the
  // requester's or a space admin's call (a re-request resets the decisions already made).
  const someoneRemoved = approvers.some((id) => !next.approvers.includes(id));
  if (!versionChanged && !someoneRemoved && !isSteward && actorAccountId !== pending.requestedBy) {
    return { success: false, reason: "Only the requester or a space admin can re-request this approval to ask the space's new approvers." };
  }
  const from = pending.pinnedVersion;
  const requestedAt = new Date().toISOString();
  // Every recorded decision was about the old request: the dropped approvers' and the admins'
  // records go, every current approver starts again at pending.
  const dropped = [...approvers.filter((id) => !next.approvers.includes(id)), ...(pending.adminDeciders || []).filter((id) => !next.approvers.includes(id))];
  for (const acc of new Set(dropped)) {
    await kvs.delete(approvalKey(pageId, pending.toStateId, acc)).catch(() => {});
    await kvs.delete(inboxKey(acc, pageId)).catch(() => {});
  }
  for (const acc of next.approvers) {
    const key = approvalKey(pageId, pending.toStateId, acc);
    const rec = (await kvs.get(key)) || { pageId, stateId: pending.toStateId, approverAccountId: acc, approverName: names[acc] || null };
    await kvs.set(key, { ...rec, admin: undefined, status: "pending", requestedAt, decidedAt: null, reason: null, signature: undefined, decidedVersion: undefined, pinnedVersion: live });
    await kvs.set(inboxKey(acc, pageId), { pageId, stateId: pending.toStateId, requestedAt });
  }
  const { quorumUnknownAt: _mark, ...rest } = pending; // 8.16: the votes are reset, so is the sweep's mark
  const updated = { ...rest, approvers: next.approvers, mode: next.mode, min: next.min, adminDeciders: [], pinnedVersion: live, rerequestedAt: requestedAt, rerequestedBy: actorAccountId || null, rerequestedByName: actorName || null };
  if (versionChanged && updated.aiGate?.required) updated.aiGate = { ...updated.aiGate, status: "pending", reviewedVersion: null, reason: null, enqueuedAt: Date.now() };
  await kvs.set(pendingKey(pageId), updated);
  await touchByline(pageId); // WF-6: decisions were reset → "Awaiting approval 0 of N"
  await appendWorkflowLog(pageId, {
    kind: "approval-rerequested", from: (await readPageWorkflow(pageId))?.stateId ?? null, to: pending.toStateId,
    by: actorAccountId || null, byName: actorName || null,
    reason: versionChanged ? `re-requested for v${live} (was v${from})` : "re-requested with the space's current approvers",
  }).catch(() => {});
  await recordActivity({
    type: "workflow.approval-rerequested",
    pageId,
    spaceKey: pending.spaceKey || null,
    actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: { to: pending.toStateId, toName: pending.toStateName || pending.toStateId, fromVersion: from, pinnedVersion: live, aiGate: !!updated.aiGate?.required, approverCount: next.approvers.length, approversRefreshed: !sameList },
    version: live,
  }).catch(() => {});
  // People newly asked are told, like on a new request (best-effort).
  const added = next.approvers.filter((id) => !approvers.includes(id));
  if (added.length) {
    await notifyApprovalRequested({
      pageId, targetName: pending.toStateName, requestedByName: pending.requestedByName, mode: next.mode, min: next.min,
      approvers: added.map((id) => ({ id, name: names[id] || null })),
    }).catch(() => {});
  }
  return { success: true, changed: true, pinnedVersion: live, fromVersion: from, aiGate: versionChanged && !!updated.aiGate?.required, approversRefreshed: !sameList, spaceKey: pending.spaceKey || null };
}

// Inbox: the caller's pending approval records, read through the per-approver index
// (workflow-inbox-{account}-*) and confirmed per key against the approval record itself —
// a strongly-consistent get, so a decision recorded a moment ago is never listed again.
// An index row whose approval record is gone is stale (cleared by a path that predates the
// index, or a lost delete) and is removed on the way past.
export async function listMyApprovals(accountId) {
  if (!accountId) return [];
  const out = [];
  const prefix = `workflow-inbox-${accountId}-`;
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  let iterations = 0;
  const approverNow = newApproverCheck({ expandGroups: false }); // the ribbon count: no group reads
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value: row } of results || []) {
      if (!row?.pageId || !row?.stateId) { await kvs.delete(key).catch(() => {}); continue; }
      const record = await kvs.get(approvalKey(row.pageId, row.stateId, accountId));
      if (record?.status === "pending") {
        // Your OWN request is not waiting on you — you cannot decide it (segregation of duties);
        // it counted as "Waiting for you" on the ribbon and in My work (tester 2026-09-29).
        const pending = await kvs.get(pendingKey(row.pageId));
        if (pending?.requestedBy === accountId) continue;
        // Taken off the space's approver list since the request: not waiting on you any more (the
        // decision would be refused). The index row stays: being put back on the list brings it
        // back. "unknown" still lists it (the decision then says to try again). An admin's own
        // record (made when they decided) is not an approver-list entry.
        if (pending && !record.admin && (await approverNow(pending.approvers, accountId, pending.spaceKey || null)) === "no") continue;
        out.push(record); continue;
      }
      if (!record) await kvs.delete(key).catch(() => {});
    }
    if (!nextCursor || ++iterations >= 15) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  } while (true);
  return out;
}

// Hourly housekeeping (called from workflowSweep):
//   (a) BACKFILL — every pending transition's approvers get an index row if they lack one, so
//       approvals opened before the index existed reach the inbox within an hour of upgrade.
//   (b) ORPHANS — a bounded page of workflow-approval-* records whose page has no pending
//       transition (and that are old enough not to be one being opened right now) is deleted
//       together with their index rows. Without this the record population only ever grows:
//       a page deleted mid-approval leaves its records behind forever.
export async function sweepApprovalIndex({ nowMs = Date.now(), maxOrphanPages = 5 } = {}) {
  const stats = { backfilled: 0, orphansRemoved: 0 };
  let pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100);
  let piter = 0;
  do {
    const { results, nextCursor } = await pq.getMany();
    for (const { key, value: pend } of results || []) {
      const pageId = String(key).replace(/^workflow-pending-/, "");
      for (const acc of pend?.approvers || []) {
        try {
          if (!(await kvs.get(inboxKey(acc, pageId)))) {
            await kvs.set(inboxKey(acc, pageId), { pageId, stateId: pend.toStateId, requestedAt: pend.requestedAt || null });
            stats.backfilled++;
          }
        } catch (e) { console.warn("[WORKFLOW-SWEEP] inbox backfill", errText(e)); }
      }
    }
    if (!nextCursor || ++piter >= 20) break;
    pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100).cursor(nextCursor);
  } while (true);

  let aq = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100);
  let aiter = 0;
  const pendingSeen = new Map(); // pageId -> boolean, one strong get per page per run
  do {
    const { results, nextCursor } = await aq.getMany();
    for (const { key, value: rec } of results || []) {
      try {
        const pageId = rec?.pageId || String(key).split("-")[2];
        if (!pendingSeen.has(pageId)) pendingSeen.set(pageId, !!(await kvs.get(pendingKey(pageId))));
        if (!isOrphanApproval(rec, pendingSeen.get(pageId), nowMs)) continue;
        await kvs.delete(key);
        if (rec?.approverAccountId) await kvs.delete(inboxKey(rec.approverAccountId, pageId)).catch(() => {});
        stats.orphansRemoved++;
      } catch (e) { console.warn("[WORKFLOW-SWEEP] orphan approval", errText(e)); }
    }
    if (!nextCursor || ++aiter >= maxOrphanPages) break;
    aq = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100).cursor(nextCursor);
  } while (true);
  return stats;
}

// WF-3 (c): the caller's OWN approval requests — pending (n of m decided), approved, declined
// (with the approver's reason) or refused as stale — read from wfreq-mine-{me}-* and confirmed
// against the pending record, the page's record and its log. A row that says nothing any more
// (the page moved on, or the decision is older than two weeks) is dropped on the way past.
export async function listMyApprovalRequests(accountId, now = Date.now()) {
  if (!accountId) return [];
  const out = [];
  const prefix = `${MY_REQUEST_PREFIX}-${accountId}-`;
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value: row } of results || []) {
      if (!row?.pageId) { await kvs.delete(key).catch(() => {}); continue; }
      try {
        const pending = await kvs.get(pendingKey(row.pageId));
        let decided = 0;
        if (pending && pending.requestedBy === accountId) {
          for (const acc of pending.approvers || []) {
            const r = await kvs.get(approvalKey(row.pageId, pending.toStateId, acc)).catch(() => null);
            if (r && r.status !== "pending") decided++;
          }
        }
        const record = pending ? null : await readPageWorkflow(row.pageId);
        const lastDecision = pending ? null : lastDecisionFrom(await getWorkflowLog(row.pageId));
        const c = classifyMyApprovalRequest({ row: { ...row, requesterAccountId: accountId }, pending, record, lastDecision, decided, now });
        if (!c.keep) { await kvs.delete(key).catch(() => {}); continue; }
        // 8.16: the title and decisions are read as the app; a page the requester can no longer view
        // is not listed (the index row stays: access given back brings it back).
        if (!(await canReadPage(accountId, row.pageId))) continue;
        let pageTitle = null;
        try {
          const pr = await appConfluence(route`/wiki/api/v2/pages/${row.pageId}`);
          if (pr.ok) pageTitle = (await pr.json())?.title || null;
        } catch (_) { /* the row lists without a title */ }
        out.push({ ...c, pageTitle });
      } catch (e) { console.warn(`[WORKFLOW] my-request row for page ${row?.pageId ?? "?"}`, errText(e)); }
    }
    if (!nextCursor || ++iterations >= 15) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  } while (true);
  out.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  return out;
}
