/*
 * Workflow state engine (ledger #42) — pure state-machine helpers + KVS storage.
 *
 * Storage (all KVS, `storage:app`; mirrors the seal realm-index convention rather
 * than Custom Entity Store — see iterations/01-workflow-state-engine.md):
 *   workflow-def-global | workflow-def-space-{sanitizedKey}   workflow definition (fallback → DEFAULT_WORKFLOW)
 *   workflow-state-{pageId}                                    full page-state record (source of truth)
 *   workflow-idx-{sanitizedSpaceKey}-{stateId}-{pageId}        by-state index (F7 dashboard)
 *   workflow-log-{pageId}-{ts}                                 transition log, NO TTL (compliance artifact)
 * Content property `sentinel-vault-workflow` mirrors {workflowId,stateId,enteredAt} for CQL + cheap trigger probe.
 * NEVER overload `sentinel-vault-validation` (separate subsystem, separate rewrite cadence).
 */
import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

export const WORKFLOW_STATE_PROP = "sentinel-vault-workflow";

// Same sanitize regex the sealing/validation capsules use for space-key segments.
export const sanitize = (key) => String(key).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");

// Built-in default workflow used when no def is stored (steward-editable later, #42 follow-up).
// `color` is a SEMANTIC token key (frontend maps to brand tokens) — never a hex here.
export const DEFAULT_WORKFLOW = {
  id: "default",
  name: "Document Approval",
  states: [
    { id: "draft", name: "Draft", color: "neutral", initial: true },
    { id: "in_review", name: "In Review", color: "info" },
    { id: "approved", name: "Approved", color: "success", enforce: true, reviewAfterDays: 150 },
    { id: "expired", name: "Expired", color: "critical" },
  ],
  transitions: [
    { from: "draft", to: "in_review" },
    { from: "in_review", to: "approved" },
    { from: "in_review", to: "draft" },
    { from: "approved", to: "draft" },
    { from: "approved", to: "expired" },
    { from: "expired", to: "in_review" },
    { from: "expired", to: "draft" },
  ],
};

// --- Pure state-machine helpers (unit-tested; no I/O) ---

export function findState(def, stateId) {
  if (!def || !Array.isArray(def.states)) return null;
  return def.states.find((s) => s.id === stateId) || null;
}

export function getInitialState(def) {
  if (!def || !Array.isArray(def.states) || def.states.length === 0) return null;
  return def.states.find((s) => s.initial) || def.states[0];
}

// State ids reachable from `fromStateId` via a defined transition edge.
export function listTransitions(def, fromStateId) {
  if (!def || !Array.isArray(def.transitions)) return [];
  return def.transitions
    .filter((t) => t.from === fromStateId && findState(def, t.to))
    .map((t) => t.to);
}

// { ok, reason } — is moving from→to allowed by this definition?
export function validateTransition(def, fromStateId, toStateId) {
  if (!def) return { ok: false, reason: "No workflow definition" };
  if (!findState(def, fromStateId)) return { ok: false, reason: `Unknown current state: ${fromStateId}` };
  if (!findState(def, toStateId)) return { ok: false, reason: `Unknown target state: ${toStateId}` };
  if (fromStateId === toStateId) return { ok: false, reason: "Already in that state" };
  const edge = def.transitions?.some((t) => t.from === fromStateId && t.to === toStateId);
  if (!edge) return { ok: false, reason: `No transition ${fromStateId} → ${toStateId}` };
  return { ok: true };
}

// --- Config (global + per-space fallback, mirrors resolveEffectiveConfig) ---

export async function resolveWorkflowDef(spaceKey) {
  const space = spaceKey ? await kvs.get(`workflow-def-space-${sanitize(spaceKey)}`) : null;
  if (space && Array.isArray(space.states) && space.states.length) return space;
  const global = await kvs.get("workflow-def-global");
  if (global && Array.isArray(global.states) && global.states.length) return global;
  return { ...DEFAULT_WORKFLOW };
}

export async function loadWorkflowConfig(scope, key) {
  const storeKey = scope === "space" ? `workflow-def-space-${sanitize(key)}` : "workflow-def-global";
  return (await kvs.get(storeKey)) || (scope === "space" ? null : { ...DEFAULT_WORKFLOW });
}

export async function storeWorkflowConfig(scope, key, def) {
  if (!def || !Array.isArray(def.states) || !def.states.length) {
    return { success: false, reason: "Definition needs at least one state" };
  }
  const storeKey = scope === "space" ? `workflow-def-space-${sanitize(key)}` : "workflow-def-global";
  await kvs.set(storeKey, def);
  return { success: true };
}

// --- Page-state storage ---

export async function readPageWorkflow(pageId) {
  if (!pageId) return null;
  return (await kvs.get(`workflow-state-${pageId}`)) || null;
}

async function writeStateContentProp(pageId, record) {
  const value = { workflowId: record.workflowId, stateId: record.stateId, enteredAt: record.enteredAt };
  try {
    const getRes = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${WORKFLOW_STATE_PROP}`,
    );
    if (!getRes.ok) return;
    const body = await getRes.json();
    const existing = body.results?.[0];
    if (existing) {
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: WORKFLOW_STATE_PROP, value, version: { number: (existing.version?.number || 1) + 1 } }),
        },
      );
    } else {
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: WORKFLOW_STATE_PROP, value }),
        },
      );
    }
  } catch (e) {
    console.error("[WORKFLOW-STATE] content-property write failed:", e);
  }
}

// Persist a state record: KVS record (source of truth) → by-state index → content property (best-effort).
// `prevStateId` lets us drop the stale index entry on transition.
async function persistState(pageId, record, prevStateId) {
  await kvs.set(`workflow-state-${pageId}`, record);
  const sk = sanitize(record.spaceKey || "_");
  if (prevStateId && prevStateId !== record.stateId) {
    await kvs.delete(`workflow-idx-${sk}-${prevStateId}-${pageId}`).catch(() => {});
  }
  await kvs.set(`workflow-idx-${sk}-${record.stateId}-${pageId}`, {
    pageId,
    stateId: record.stateId,
    enteredAt: record.enteredAt,
    reviewDueAt: record.reviewDueAt || null,
  });
  await writeStateContentProp(pageId, record);
}

export async function appendWorkflowLog(pageId, entry) {
  const ts = Date.now();
  await kvs.set(`workflow-log-${pageId}-${ts}`, { ts, ...entry }); // NO TTL — compliance history
  return ts;
}

export async function getWorkflowLog(pageId) {
  if (!pageId) return [];
  const out = [];
  const prefix = `workflow-log-${pageId}-`;
  // Bounded cursor scan (mirrors listMyEditRequests): first query has no cursor;
  // only subsequent pages add .cursor(nextCursor). Log volume per page is small.
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value } of results || []) out.push(value);
    if (!nextCursor || ++iterations >= 20) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  } while (true);
  return out.sort((a, b) => a.ts - b.ts);
}

// Compute reviewDueAt (ISO) if the target state defines a review clock.
function computeReviewDueAt(state) {
  if (!state || !state.reviewAfterDays) return null;
  return new Date(Date.now() + state.reviewAfterDays * 24 * 3600 * 1000).toISOString();
}

// --- Orchestration (called by resolvers AND by the dev test-hook with explicit args) ---

// Assign a workflow to a page and set its initial state (idempotent-ish: re-assign resets to initial).
export async function assignPageWorkflow({ pageId, spaceKey, actorAccountId, actorName, workflowId, logReason }) {
  if (!pageId) return { success: false, reason: "pageId required" };
  const def = await resolveWorkflowDef(spaceKey);
  if (workflowId && def.id !== workflowId) {
    return { success: false, reason: `Workflow ${workflowId} not defined for this space` };
  }
  const initial = getInitialState(def);
  if (!initial) return { success: false, reason: "Workflow has no states" };
  const enteredAt = new Date().toISOString();
  const prev = await readPageWorkflow(pageId);
  const record = {
    workflowId: def.id,
    stateId: initial.id,
    enteredAt,
    enteredBy: actorAccountId || null,
    enteredByName: actorName || null,
    spaceKey: spaceKey || null,
    reviewDueAt: computeReviewDueAt(initial),
  };
  await persistState(pageId, record, prev?.stateId);
  await appendWorkflowLog(pageId, { from: null, to: initial.id, by: actorAccountId || null, byName: actorName || null, reason: logReason || "assigned" });
  return { success: true, record, state: initial, def };
}

// --- Per-space workflow activation settings (at-scale assignment) ---

const DEFAULT_SPACE_SETTINGS = { enabled: false, autoAssignNew: false, workflowId: "default" };

export async function getSpaceWorkflowSettings(spaceKey) {
  if (!spaceKey) return { ...DEFAULT_SPACE_SETTINGS };
  return (await kvs.get(`workflow-settings-${sanitize(spaceKey)}`)) || { ...DEFAULT_SPACE_SETTINGS };
}

export async function setSpaceWorkflowSettings(spaceKey, settings) {
  if (!spaceKey) return { success: false, reason: "spaceKey required" };
  const clean = {
    enabled: !!settings?.enabled,
    autoAssignNew: !!settings?.autoAssignNew,
    workflowId: settings?.workflowId || "default",
  };
  await kvs.set(`workflow-settings-${sanitize(spaceKey)}`, clean);
  return { success: true, settings: clean };
}

// Pure decision (unit-tested): should a page in this space be auto-assigned now?
export function shouldAutoAssign(settings, hasWorkflow) {
  return !!(settings?.enabled && settings?.autoAssignNew && !hasWorkflow);
}

// Trigger-callable: auto-assign the space's workflow to a page that has none, if the
// space is configured for it. Idempotent (no-op when a workflow already exists).
export async function autoAssignOnEvent({ pageId, spaceKey, actorAccountId, actorName }) {
  if (!pageId || !spaceKey) return { assigned: false, reason: "missing page/space" };
  const settings = await getSpaceWorkflowSettings(spaceKey);
  if (!settings.enabled || !settings.autoAssignNew) return { assigned: false, reason: "space not auto-assigning" };
  const existing = await readPageWorkflow(pageId);
  if (!shouldAutoAssign(settings, !!existing)) return { assigned: false, reason: existing ? "already has workflow" : "disabled" };
  // Claim a one-shot marker BEFORE the assignment so a duplicate/concurrent created-event
  // delivery (Forge events are at-least-once) can't double-append to the no-TTL compliance
  // log. Mirrors the markVersionChecked-before-side-effects pattern the contract requires
  // for the validation phase (T6/SV-m1). KVS has no CAS, so this narrows the double-fire
  // window to a single get→set (matching the validation phase's residual limit), not zero.
  const claimKey = `workflow-autoassigned-${pageId}`;
  if (await kvs.get(claimKey)) return { assigned: false, reason: "already auto-assigned" };
  await kvs.set(claimKey, { at: new Date().toISOString(), spaceKey });
  const res = await assignPageWorkflow({ pageId, spaceKey, actorAccountId, actorName, workflowId: settings.workflowId, logReason: "auto-assigned on create" });
  return { assigned: !!res.success, reason: res.success ? "auto-assigned" : res.reason, record: res.record };
}

// Move a page to `toStateId` after validating the edge. Returns {success, reason?, record?}.
// `requireStewardForEnforce` is enforced by the caller (resolver) — logic stays authz-free & testable.
export async function transitionPageWorkflow({ pageId, spaceKey, toStateId, actorAccountId, actorName, reason }) {
  if (!pageId || !toStateId) return { success: false, reason: "pageId and toStateId required" };
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const def = await resolveWorkflowDef(spaceKey || current.spaceKey);
  const check = validateTransition(def, current.stateId, toStateId);
  if (!check.ok) return { success: false, reason: check.reason };
  const target = findState(def, toStateId);
  const enteredAt = new Date().toISOString();
  const record = {
    ...current,
    workflowId: def.id,
    stateId: toStateId,
    enteredAt,
    enteredBy: actorAccountId || null,
    enteredByName: actorName || null,
    spaceKey: current.spaceKey || spaceKey || null,
    reviewDueAt: computeReviewDueAt(target),
  };
  await persistState(pageId, record, current.stateId);
  await appendWorkflowLog(pageId, {
    from: current.stateId,
    to: toStateId,
    by: actorAccountId || null,
    byName: actorName || null,
    reason: reason || null,
  });
  return { success: true, record, state: target, def };
}

// Bulk-assign the space's workflow to pages that don't have one (one result page
// per call, ≤25, to stay inside the 25s function budget). Callable by the resolver
// (after authz) and the dev test-hook. Idempotent: skips pages that already have a workflow.
export async function bulkAssignPagesInSpace({ spaceKey, spaceId, cursor, actorAccountId }) {
  if (!spaceKey || !spaceId) return { success: false, reason: "spaceKey and spaceId required" };
  const listRes = cursor
    ? await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=25&cursor=${cursor}`)
    : await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=25`);
  if (!listRes.ok) return { success: false, reason: `Could not list pages (${listRes.status})` };
  const body = await listRes.json();
  const pages = body?.results || [];
  const settings = await getSpaceWorkflowSettings(spaceKey);
  let assigned = 0;
  for (const p of pages) {
    if (await readPageWorkflow(p.id)) continue; // idempotent
    const r = await assignPageWorkflow({ pageId: p.id, spaceKey, actorAccountId, workflowId: settings.workflowId, logReason: "bulk-assigned" });
    if (r.success) assigned += 1;
  }
  const nextLink = body?._links?.next;
  const nextCursor = nextLink ? new URLSearchParams(nextLink.split("?")[1] || "").get("cursor") : null;
  return { success: true, assigned, scanned: pages.length, capped: !!nextCursor, nextCursor };
}

// Read model for the UI: current record + available transitions + def.
export async function getPageWorkflow(pageId, spaceKey) {
  const record = await readPageWorkflow(pageId);
  const def = await resolveWorkflowDef(spaceKey || record?.spaceKey);
  if (!record) return { assigned: false, def };
  const state = findState(def, record.stateId);
  return {
    assigned: true,
    record,
    state,
    available: listTransitions(def, record.stateId).map((id) => findState(def, id)),
    def,
  };
}
