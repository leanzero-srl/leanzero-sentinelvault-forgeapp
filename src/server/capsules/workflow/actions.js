/*
 * Workflow state engine (ledger #42) — resolver actions.
 * Thin adapters: pull pageId / spaceKey / accountId from `req`, apply authz,
 * delegate to logic.js. Enforcement (#44) and the approver model (#43) land later.
 */
import { asApp, asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey } from "../../shared/content-access.js";
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
  sanitize,
} from "./logic.js";
import {
  extractApprovalConfig,
  resolveApproverIds,
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
  listMyApprovals,
  applyAiVerdict,
} from "./approvals.js";
import { enqueueAiGate, resolveRules } from "../validations/actions.js";
import { evaluateRules } from "../../infra/rules-engine.js";
import { readDocBody } from "../../infra/doc-surgery.js";
import { fetchPageLabels } from "../../infra/labels.js";

// #46 Part A: content-conditions gate — the space's block-severity validation rules must
// pass before the page may enter the target state. Reuses evaluateRules verbatim (sync).
// Returns a block result { success:false, ... } or null (allowed). Fail-closed on a read
// error (can't verify → don't let content through unchecked; the user can retry).
// Uses resolveRules (enabled-INDEPENDENT), NOT resolveEffectiveConfig — the transition
// condition is a deliberate steward action and must NOT silently no-op just because the
// separate space-wide post-save validation master switch happens to be off.
async function checkContentConditions(pageId, spaceKey) {
  const rules = await resolveRules(spaceKey);
  if (!rules.length) return null; // no authored rules → nothing to gate on
  let adfDoc;
  try { ({ adfDoc } = await readDocBody(pageId)); }
  catch (_) { return { success: false, blocked: true, reason: "Could not read the page to check content conditions — please retry." }; }
  const labels = await fetchPageLabels(pageId);
  const { passed, violations } = evaluateRules(adfDoc, labels, rules);
  if (passed) return null;
  return {
    success: false,
    blocked: true,
    reason: "This page doesn't yet meet the content requirements for that state.",
    violations: violations.filter((v) => v.severity === "block"),
  };
}

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

const ctxPageIdOf = (req) =>
  req.context?.extension?.content?.id ||
  req.context?.extension?.content?.content?.id ||
  null;

/**
 * SV-SEC-1. May this caller READ the page these actions are about?
 *
 * pageIdOf prefers req.payload.pageId, which is attacker-controlled, so every read-only
 * workflow action would otherwise hand back another page's state, history or approver list.
 * A context id is skipped: rendering the ribbon there already required read access.
 */
async function callerMayReadPage(req, pageId) {
  if (!mustVerify(req.payload?.pageId, ctxPageIdOf(req))) return true;
  return canReadPage(req.context?.accountId, pageId);
}

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
  if (!(await callerMayReadPage(req, pageId))) return { assigned: false, reason: "No page context" };
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
  // The log names who moved the page between states and when — history about a page the
  // caller may not be able to open.
  if (!(await callerMayReadPage(req, pageId))) return { log: [] };
  return { log: await getWorkflowLog(pageId) };
};

const assignWorkflow = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  if (!pageId) return { success: false, reason: "No page context" };
  // SV-SEC-1 (confused deputy). The gate used to name spaceKeyOf(req) — the payload's spaceKey —
  // while the mutation targeted the payload's pageId. Two different objects, so a steward of any
  // one space could reset the workflow state of ANY page on the site, wiping the enforce baseline
  // that powers approved-page protection. requestTransition below already states the doctrine:
  // the authoritative space is the PAGE's own, never a caller-supplied one. Same here — and the
  // resolved key is what gets stored, so the index row cannot be filed under a foreign space.
  const spaceKey = (await readPageWorkflow(pageId))?.spaceKey || await resolvePageSpaceKey(pageId);
  if (!spaceKey) return { success: false, reason: "Could not resolve this page's space" };
  // Assigning a workflow is a steward act in v1 (per-page-owner assignment arrives with #43).
  if (!(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: "Only a space steward can assign a workflow" };
  }
  return assignPageWorkflow({
    pageId,
    spaceKey,
    actorAccountId,
    actorName: await actorName(),
    workflowId: req.payload?.workflowId,
  });
};

export const requestTransition = async (req) => {
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

  // SV-SEC-1. The space was already derived correctly (above), but nothing checked the CALLER
  // against the page at all — so any logged-in user could move any workflow-assigned page to any
  // non-enforce state. Moving a page's governance state is changing the page, so the bar is being
  // able to change the page.
  if (!(await canEditPage(actorAccountId, pageId))) {
    return { success: false, reason: "You do not have permission to change this page's state" };
  }

  // Entering an `enforce`-marked state (e.g. Approved): if the space has approvers
  // configured (#43), open a multi-approver approval instead of transitioning now;
  // otherwise fall back to the #42 steward gate.
  const def = await resolveWorkflowDef(spaceKey);
  const target = findState(def, toStateId);

  // SV-SEC-1. Entering an enforce state is gated below; LEAVING one was not. Approved -> Draft
  // clears the enforce baseline, which is what makes the app revert unapproved edits — so the
  // cheapest way to switch protection off for a page was to walk it backwards out of Approved.
  // The exit deserves the same authority as the entry.
  const from = findState(def, current.stateId);
  if (from?.enforce && !target?.enforce
    && !(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: `Leaving "${from.name}" requires steward approval` };
  }

  // #46: transition conditions run BEFORE the enforce/approval branch. Content conditions
  // are checked synchronously here; if they fail, the move is blocked with the reasons.
  const wfSettings = await getSpaceWorkflowSettings(spaceKey);
  const entryCond = wfSettings.entryConditions?.[toStateId];
  if (entryCond?.requireRules) {
    const blocked = await checkContentConditions(pageId, spaceKey);
    if (blocked) return blocked;
  }

  const needsAi = !!entryCond?.requireAi;
  const spec = target?.enforce ? await resolveApproverIds(wfSettings.approval) : null;

  // Open a pending transition when there are human approvers (enforce + configured, #43)
  // AND/OR an AI review condition (#46). The AI rides the SAME pending record as a mandatory
  // review axis, AND-composed with the human quorum on one pinned version.
  if (spec || needsAi) {
    const check = validateTransition(def, current.stateId, toStateId);
    if (!check.ok) return { success: false, reason: check.reason };
    // #46 authority: the AI axis AUGMENTS, never replaces, enforce-state authority. An
    // enforce target with no human approvers still requires the requester to be a steward —
    // otherwise turning on "require AI review" would DOWNGRADE the gate to "anyone + AI".
    if (target?.enforce && !(spec?.approvers?.length) && !(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: `Entering "${target?.name || toStateId}" requires steward approval` };
    }
    // Don't let a re-request silently discard approvers' / the AI's in-flight review.
    const existing = await getPageApprovalStatus(pageId);
    if (existing?.pending && existing.requestedBy !== actorAccountId && !(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: "An approval is already pending for this page" };
    }
    const pinnedVersion = await fetchLivePageVersion(pageId);
    if (pinnedVersion == null) return { success: false, reason: "Could not verify the page version — please retry." };
    const names = {};
    (wfSettings.approval?.approvers || []).forEach((a) => { if (a.id) names[a.id] = a.name; });
    const result = await requestApprovalTransition({
      pageId, toStateId, toStateName: target?.name || toStateId, spaceKey,
      approvers: spec?.approvers || [], mode: spec?.mode || "any", min: spec?.min || 1,
      actorAccountId, actorName: await actorName(), pinnedVersion, approverNames: names,
      aiGate: needsAi ? { required: true, threshold: entryCond.aiThreshold } : null,
    });
    if (needsAi) {
      // Enqueue the async review; if it resolved without an LLM call (AI disabled / budget),
      // apply that verdict immediately so the gate can't hang — and REFLECT the outcome so the
      // ribbon doesn't show "review in progress" for a page that already moved (or was blocked).
      const enq = await enqueueAiGate({ pageId, spaceKey, pinnedVersion, threshold: entryCond.aiThreshold, onBudgetExhausted: entryCond.onBudgetExhausted });
      if (!enq.enqueued && enq.verdict) {
        const av = await applyAiVerdict(pageId, pinnedVersion, enq.verdict, enq.reason);
        if (av?.transitioned) return { success: true, transitioned: true, outcome: av.outcome, record: av.record };
        if (av?.status === "failed") return { success: false, blocked: true, reason: enq.reason || "AI content review did not pass." };
      }
    }
    return result;
  }

  if (target?.enforce) {
    // enforce, no approvers, no AI → #42/#44 direct steward gate. The steward IS the reviewing
    // authority acting on what they see now: capture approvedVersion, fail CLOSED on null.
    if (!(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: `Entering "${target.name}" requires steward approval` };
    }
    const approvedVersion = await fetchLivePageVersion(pageId);
    if (approvedVersion == null) {
      return { success: false, reason: "Could not verify the page version — please retry." };
    }
    const snap = (await resolveApproverIds(wfSettings.approval))?.approvers || [];
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
  // Exposes the approver roster and each approver's decision for the named page.
  if (!(await callerMayReadPage(req, pageId))) return { pending: false };
  return getPageApprovalStatus(pageId);
};

const listMyApprovalsAction = async (req) => {
  const raw = await listMyApprovals(req.context?.accountId);
  const out = [];
  for (const r of raw.slice(0, 25)) { // bounded — the inbox is a working list, not a report
    const pending = await kvs.get(`workflow-pending-${r.pageId}`);
    if (!pending) continue; // resolved since; skip stale record
    if (pending.aiGate?.status === "failed") continue; // #46: AI review blocked it — the
    // requester must revise + re-request; don't nag approvers with a currently-blocked item
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
  // Scope-tiered authz (mirrors store-validation-config, it17): a SPACE def needs a steward of
  // THAT space; the GLOBAL def needs a site admin — previously any space steward could invoke
  // with scope:"global" and overwrite the org-wide workflow definition.
  const caller = req.context?.accountId;
  const authorized = !!caller && ((scope === "space" && (key || spaceKeyOf(req)))
    ? await authorizeSteward(caller, key || spaceKeyOf(req))
    : await isOperatorSiteAdmin(caller));
  if (!authorized) {
    return { success: false, reason: scope === "space" ? "Only a space steward can edit workflow definitions" : "Only a site admin can edit the global workflow definition" };
  }
  return storeWorkflowConfig(scope || "global", key, def);
};

const getSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey) return { settings: {}, def: null };
  // SV-SEC-1: spaceKey is payload-supplied and the settings carry the space's approver roster
  // and enforcement configuration. Its only caller is the steward-only Workflow tab
  // (WorkflowSettingsEditor.jsx:163), so the server now enforces what the UI assumed.
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { settings: {}, def: null };
  }
  const settings = await getSpaceWorkflowSettings(spaceKey);
  const def = await resolveWorkflowDef(spaceKey);
  return { settings, def }; // def.states power the read-only preview chips in the config UI
};

const setSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a space steward can change workflow settings" };
  }
  return setSpaceWorkflowSettings(spaceKey, req.payload?.settings || {});
};

// Apply the space's workflow to existing pages without one (steward). Resolves the
// space id, then delegates the bounded scan+assign to the shared logic function.
const bulkAssign = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a space steward can apply workflows" };
  }
  const settings = await getSpaceWorkflowSettings(spaceKey);
  if (!settings.enabled) return { success: false, reason: "Enable workflow for this space first" };

  // SV-SEC-1. The steward check above is about spaceKey, but the scan used to run against
  // req.payload.spaceId — a different, unchecked object. A steward of any one space could
  // therefore have the app enumerate another space's pages with its own identity and write app
  // state and content properties onto them. Resolve the id from the key that was authorized,
  // and from nothing else.
  let spaceId = null;
  const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
  if (sres.ok) spaceId = (await sres.json())?.results?.[0]?.id;
  if (!spaceId) return { success: false, reason: "Could not resolve the space" };

  return bulkAssignPagesInSpace({ spaceKey, spaceId, cursor: req.payload?.cursor || null, actorAccountId: req.context?.accountId });
};

// #48: workflow dashboard for a space — state distribution + a recent-pages table.
// Counts + overdue are EXACT from the by-state index (which carries reviewDueAt); only
// titles are fetched (bounded + parallel). Read-only; the UI generates the CSV client-side.
const LIST_CAP = 100;
export const getWorkflowDashboard = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey) return { error: "No space context" };
  // SV-SEC-1: naming any space in the payload returned that space's whole workflow inventory —
  // up to 100 page titles and webui URLs fetched with the app's identity, per-state counts and
  // review-overdue flags. It is the steward-only dashboard (WorkflowDashboard.jsx:22).
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { error: "Only a space steward can view the workflow dashboard" };
  }
  const prefix = `workflow-idx-${sanitize(spaceKey)}-`;
  const entries = [];
  let cursor = null;
  for (let i = 0; i < 30; i++) { // bounded; ~3000 pages max
    let q = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results, nextCursor } = await q.getMany();
    for (const { value } of results || []) if (value?.pageId) entries.push(value);
    cursor = nextCursor;
    if (!cursor) break;
  }
  const now = Date.now();
  const def = await resolveWorkflowDef(spaceKey);
  const counts = {};
  let overdue = 0;
  for (const e of entries) {
    counts[e.stateId] = (counts[e.stateId] || 0) + 1;
    if (e.stateId === "approved" && e.reviewDueAt && new Date(e.reviewDueAt).getTime() < now) overdue++;
  }
  // Most-recently-changed first, bounded — then fetch titles in parallel.
  const list = entries
    .slice()
    .sort((a, b) => String(b.enteredAt || "").localeCompare(String(a.enteredAt || "")))
    .slice(0, LIST_CAP);
  const titles = await Promise.all(list.map(async (e) => {
    try {
      const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${e.pageId}`);
      if (res.ok) { const p = await res.json(); return { id: e.pageId, title: p?.title || null, url: p?._links?.webui || null }; }
    } catch (_) { /* best-effort */ }
    return { id: e.pageId, title: null, url: null };
  }));
  const titleMap = Object.fromEntries(titles.map((t) => [t.id, t]));
  const stateName = (id) => def?.states?.find((s) => s.id === id)?.name || id;
  const pages = list.map((e) => ({
    pageId: e.pageId,
    title: titleMap[e.pageId]?.title || `(page ${e.pageId})`,
    url: titleMap[e.pageId]?.url || null,
    stateId: e.stateId,
    stateName: stateName(e.stateId),
    enteredAt: e.enteredAt || null,
    reviewDueAt: e.reviewDueAt || null,
    overdue: e.stateId === "approved" && e.reviewDueAt && new Date(e.reviewDueAt).getTime() < now,
  }));
  return {
    spaceKey,
    total: entries.length,
    truncated: entries.length > LIST_CAP,
    listCap: LIST_CAP,
    overdue,
    states: (def?.states || []).map((s) => ({ id: s.id, name: s.name, color: s.color, count: counts[s.id] || 0 })),
    pages,
  };
};

export const actions = [
  ["get-page-workflow", getWorkflow],
  ["get-workflow-dashboard", getWorkflowDashboard],
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
