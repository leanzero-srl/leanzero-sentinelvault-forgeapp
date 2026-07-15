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

// B14 (#7): a "dead-end" state is one a page can ENTER (it is the target of some transition) but can
// never LEAVE (it has no outgoing transition). A page that lands there is silently stranded — the ribbon
// shows a disabled state pill with no available move and no explanation. Returns the stuck state ids so
// storeWorkflowConfig can WARN the steward at save time (non-blocking: a truly terminal state may be
// intentional). The built-in DEFAULT_WORKFLOW has none — this only guards hand-authored custom defs.
export function findDeadEndStates(def) {
  if (!def || !Array.isArray(def.states) || !Array.isArray(def.transitions)) return [];
  const hasOutgoing = new Set(def.transitions.filter((t) => findState(def, t.to)).map((t) => t.from));
  const isTarget = new Set(def.transitions.filter((t) => findState(def, t.to)).map((t) => t.to));
  return def.states.filter((s) => isTarget.has(s.id) && !hasOutgoing.has(s.id)).map((s) => s.id);
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
  // B14 (#7): surface the "silent stuck" — warn (don't block) when the saved def has states a page can
  // enter but never leave, so the steward knows before pages strand there.
  const deadEnds = findDeadEndStates(def);
  if (deadEnds.length) {
    const names = deadEnds.map((id) => findState(def, id)?.name || id);
    return { success: true, warning: `These states have no way out — a page that reaches them will be stuck with no available transition: ${names.join(", ")}. Add an outgoing transition (e.g. back to Draft) unless a state is meant to be final.` };
  }
  return { success: true };
}

// --- Page-state storage ---

export async function readPageWorkflow(pageId) {
  if (!pageId) return null;
  return (await kvs.get(`workflow-state-${pageId}`)) || null;
}

// Live page version — the ONLY way #44 observes a version (never a pre-pass guess).
// Returns null on any failure; callers treat null as fail-closed, never "no drift".
export async function fetchLivePageVersion(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (res.ok) return (await res.json())?.version?.number ?? null;
  } catch (_) { /* fail-closed */ }
  return null;
}

// Forward-only re-stamp of approvedVersion (the ONE re-stamp primitive; #44 §1.3).
// Never drags the baseline backward on a late/re-delivered event.
export async function restampApprovedVersion(pageId, n) {
  if (!(typeof n === "number" && n >= 1)) return false;
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return false;
  if (record.approvedVersion != null && n <= record.approvedVersion) return false;
  // Re-read immediately before persist to shrink the lost-update window: a concurrent
  // demote / leave-enforce (separate invocation) may have flipped this record out of the
  // enforce state. Persist the FRESH record (mutating only approvedVersion) so we never
  // clobber a concurrent state change back to enforce with a stale copy.
  const fresh = await readPageWorkflow(pageId);
  if (!fresh?.enforce || fresh.stateId !== record.stateId) return false;
  if (fresh.approvedVersion != null && n <= fresh.approvedVersion) return false;
  fresh.approvedVersion = n;
  await persistState(pageId, fresh, fresh.stateId);
  return true;
}

// #44 §2.7: when a seal is created on an enforced page, advance the approved baseline to
// the live version so its body ⊇ the new seal (a whole-page revert then restores the seal
// instead of stripping it). Best-effort; the sweep reconciles a miss next tick.
export async function restampIfEnforced(pageId) {
  try {
    const wf = await readPageWorkflow(pageId);
    if (wf?.enforce) {
      const v = await fetchLivePageVersion(pageId);
      if (v) return await restampApprovedVersion(pageId, v);
    }
  } catch (_) { /* best-effort */ }
  return false;
}

async function writeStateContentProp(pageId, record) {
  const value = {
    workflowId: record.workflowId, stateId: record.stateId, enteredAt: record.enteredAt,
    enforce: record.enforce === true, approvedVersion: record.approvedVersion ?? null,
  };
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
  // audit C6: the #47 native content-status pill projection was REMOVED. Live-verified it was a SILENT
  // NO-OP: mirrorNativeState set nothing (a read-back always returned null) while swallowing every
  // error, and the underlying PUT that creates a per-space custom content state ("Draft/In Review/…")
  // 409-conflicts — so it could not be made reliable without pre-provisioning + failure surfacing, and
  // it needlessly writes app-specific custom states into a customer's space. It was also redundant with
  // the app's own authoritative doc-ribbon state chip. State stays fully visible via the ribbon +
  // content property. (The v1 content-state REST API is NOT gone — this is a reliability/UX call, not a
  // dead-endpoint one. If a native pill is wanted later, do it as a real feature: provision the space's
  // content states once, map to them, and surface failures instead of swallowing them.)
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

// Compute reviewDueAt (ISO) if the target state defines a review clock. #45: a per-space
// `overrideDays` (steward-configured) takes precedence over the state's built-in default.
function computeReviewDueAt(state, overrideDays) {
  const days = (typeof overrideDays === "number" && overrideDays > 0) ? overrideDays : state?.reviewAfterDays;
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
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

// #46: normalize the per-target-state transition-condition map. Only keeps a state's
// entry when it actually requires something (content rules and/or AI review).
function sanitizeEntryConditions(ec) {
  if (!ec || typeof ec !== "object") return {};
  const out = {};
  for (const [stateId, cond] of Object.entries(ec)) {
    if (!cond || typeof cond !== "object") continue;
    const clean = {
      requireRules: cond.requireRules === true,
      requireAi: cond.requireAi === true,
      aiThreshold: ["low", "medium", "high"].includes(cond.aiThreshold) ? cond.aiThreshold : "medium",
      onBudgetExhausted: cond.onBudgetExhausted === "allow" ? "allow" : "block",
    };
    if (clean.requireRules || clean.requireAi) out[stateId] = clean;
  }
  return out;
}

export async function setSpaceWorkflowSettings(spaceKey, settings) {
  if (!spaceKey) return { success: false, reason: "spaceKey required" };
  const clean = {
    enabled: !!settings?.enabled,
    autoAssignNew: !!settings?.autoAssignNew,
    workflowId: settings?.workflowId || "default",
    // #44: how an unapproved edit to an enforced Approved page is handled. Default DEMOTE
    // (provably non-destructive); "revert" (byte-freeze) is opt-in.
    enforceMode: settings?.enforceMode === "revert" ? "revert" : "demote",
    // #45: re-review an Approved page after N days (null = use the workflow default). The
    // sweep auto-transitions overdue Approved pages to Expired.
    reviewAfterDays: (typeof settings?.reviewAfterDays === "number" && settings.reviewAfterDays > 0)
      ? Math.round(settings.reviewAfterDays) : null,
    // #46: per-target-state transition conditions. { <stateId>: { requireRules, requireAi,
    // aiThreshold, onBudgetExhausted } } — reuses the space validation ruleset (rulesRef "space").
    entryConditions: sanitizeEntryConditions(settings?.entryConditions),
  };
  // Optional approval config for the enforce transition (#43). Shape:
  // { approvers: [{ type:"user"|"group", id, name }], mode:"any"|"all"|"min", min }.
  if (settings?.approval && Array.isArray(settings.approval.approvers)) {
    clean.approval = {
      approvers: settings.approval.approvers.filter((a) => a && a.id).map((a) => ({ type: a.type || "user", id: a.id, name: a.name || null })),
      mode: ["any", "all", "min"].includes(settings.approval.mode) ? settings.approval.mode : "any",
      min: Math.max(1, parseInt(settings.approval.min, 10) || 1),
    };
  }
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
export async function transitionPageWorkflow({ pageId, spaceKey, toStateId, actorAccountId, actorName, reason, approvers, approvedVersion }) {
  if (!pageId || !toStateId) return { success: false, reason: "pageId and toStateId required" };
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const def = await resolveWorkflowDef(spaceKey || current.spaceKey);
  const check = validateTransition(def, current.stateId, toStateId);
  if (!check.ok) return { success: false, reason: check.reason };
  const target = findState(def, toStateId);
  const enteredAt = new Date().toISOString();
  // #44: entering an enforce state records the approved baseline (the version the
  // authority reviewed) + the approver snapshot; leaving/never-entering it clears them.
  let enforceFields;
  if (target.enforce) {
    enforceFields = {
      enforce: true,
      approvedVersion: (typeof approvedVersion === "number" && approvedVersion >= 1) ? approvedVersion : null,
      approvers: Array.isArray(approvers) ? [...new Set(approvers)] : [],
      approvedAt: enteredAt,
      approvedBy: actorAccountId || null,
    };
  } else {
    enforceFields = { enforce: false, approvedVersion: null, approvers: [] };
  }
  // #45: a review clock uses the steward's per-space override when set (only read settings
  // when the target state actually has a review clock, to keep other transitions cheap).
  const reviewOverride = target?.reviewAfterDays
    ? (await getSpaceWorkflowSettings(current.spaceKey || spaceKey))?.reviewAfterDays
    : null;
  const record = {
    ...current,
    workflowId: def.id,
    stateId: toStateId,
    enteredAt,
    enteredBy: actorAccountId || null,
    enteredByName: actorName || null,
    spaceKey: current.spaceKey || spaceKey || null,
    reviewDueAt: computeReviewDueAt(target, reviewOverride),
    ...enforceFields,
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
