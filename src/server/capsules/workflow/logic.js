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
import { recordActivity } from "../../infra/activity-log.js";
import { syncStateLabel } from "./label-sync.js";
import { sanitizeReadConfirmation } from "./read-acks.js";
import { fetchPageLabels } from "../../infra/labels.js";
import { touchByline } from "../page-details/byline-touch.js"; // WF-6 (dynamic inside: no cycle)

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
    // WF-10: the id stays "expired" (the sweep, the transitions and stored records name it); the
    // WORD a Confluence admin reads is what the state means — a page whose approval lapsed.
    { id: "expired", name: "Needs re-review", color: "critical" },
  ],
  transitions: [
    { from: "draft", to: "in_review" },
    { from: "in_review", to: "approved" },
    { from: "in_review", to: "draft" },
    { from: "approved", to: "draft" },
    // A2 (2026-09-05): an Approved page can go BACK TO REVIEW — the Comala-shaped demote target
    // ("send it back for review rather than to the start"), and a steward's manual return.
    { from: "approved", to: "in_review" },
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

// --- A2: where a tampered enforced page goes ---

const enforceStateIds = (def) => (def?.states || []).filter((s) => s?.enforce).map((s) => s.id);

// PURE. { ok, reason } — may `stateId` be the space's demotion target for this definition?
// (a) it exists, (b) it is not itself an enforce state (demoting Approved to Approved is not a
// demotion), (c) it is reachable by a defined transition from EVERY enforce state — the demote
// runs from whichever enforce state the page is in, and a target one of them cannot reach would
// leave that page enforced-but-not-demoted. A definition with no enforce state has nothing to
// demote from, so no stateId is valid there ("initial" always is).
export function validateDemoteTarget(def, stateId, entryConditions = null) {
  if (!def || !Array.isArray(def.states)) return { ok: false, reason: "No workflow definition" };
  const target = findState(def, stateId);
  if (!target) return { ok: false, reason: `Unknown state: ${stateId}` };
  if (target.enforce) return { ok: false, reason: `"${target.name || stateId}" is an approved state — a page cannot be moved back to it` };
  // A demote is a SYSTEM move that skips the entry gate (rules / AI review) a human transition
  // would pay, so a state that has one cannot be the target (review finding 9): the page would
  // land past a gate nobody ran.
  const cond = entryConditions && typeof entryConditions === "object" ? entryConditions[stateId] : null;
  if (cond && (cond.requireRules || cond.requireAi)) {
    return { ok: false, reason: `"${target.name || stateId}" has an entry condition — a page moved back automatically would skip it. Pick a state without one, or remove the condition` };
  }
  const froms = enforceStateIds(def);
  if (!froms.length) return { ok: false, reason: "This workflow has no approved state to move pages back from" };
  const unreachable = froms.filter((from) => !validateTransition(def, from, stateId).ok);
  if (unreachable.length) {
    const names = unreachable.map((id) => findState(def, id)?.name || id).join(", ");
    return { ok: false, reason: `No transition from ${names} to "${target.name || stateId}" — add one to the workflow first` };
  }
  return { ok: true };
}

// PURE. The state an enforced page is demoted to after an unsanctioned edit: the space's
// `demoteTo` when it still names a valid target (see validateDemoteTarget — a re-saved definition
// may have dropped the state or the edge since the setting was saved), else the initial state
// (today's behaviour, and the "initial" setting). `fromStateId` (the page's current state) tightens
// the check to the edge that will actually be taken; without it the save-time rule applies.
export function resolveDemoteTarget(def, settings, fromStateId) {
  const initial = getInitialState(def);
  const want = settings?.demoteTo;
  if (typeof want !== "string" || !want || want === "initial") return initial;
  if (!validateDemoteTarget(def, want, settings?.entryConditions).ok) return initial;
  if (fromStateId && !validateTransition(def, fromStateId, want).ok) return initial;
  return findState(def, want);
}

// --- A5: review clocks ---

const isPositiveDays = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

// PURE. How many days a page may sit in `state` before it is due for review, or null. The order
// is: the per-state override in the space settings → the legacy `reviewAfterDays` setting, which
// stays what it always was, the override for the ENFORCE state only (#45; the settings editor
// labels it "re-review Approved pages after N days") → the state's own `reviewAfterDays` from the
// definition (any state may carry one; the built-in workflow gives one to Approved).
export function resolveReviewAfterDays(state, settings) {
  if (!state) return null;
  const byState = settings?.reviewAfterDaysByState?.[state.id];
  if (isPositiveDays(byState)) return byState;
  if (state.enforce && isPositiveDays(settings?.reviewAfterDays)) return settings.reviewAfterDays;
  return isPositiveDays(state.reviewAfterDays) ? state.reviewAfterDays : null;
}

// PURE. { ok, reason, value } — the stored shape of the per-state review overrides. Unknown state
// ids and non-positive values are REFUSED (a dead configuration must not be saved silently);
// null / "" / undefined entries mean "no override" and are dropped.
export function sanitizeReviewAfterDaysByState(input, def) {
  if (input == null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "reviewAfterDaysByState must be an object of { stateId: days }" };
  const out = {};
  for (const [stateId, raw] of Object.entries(input)) {
    if (raw == null || raw === "") continue;
    const state = findState(def, stateId);
    if (!state) return { ok: false, reason: `Unknown state "${stateId}" in review clocks` };
    const days = typeof raw === "number" ? raw : Number(raw);
    if (!isPositiveDays(days) || !Number.isInteger(days)) {
      return { ok: false, reason: `Review clock for "${state.name || stateId}" must be a whole number of days greater than zero` };
    }
    out[stateId] = days;
  }
  return { ok: true, value: out };
}

// PURE. A steward-set review date must parse and lie in the future (Comala 5.0.4 parity); null
// clears the clock. Returns { ok, reason, value } with `value` normalised to ISO (or null).
export function validateReviewDueAt(input, nowMs = Date.now()) {
  if (input == null || input === "") return { ok: true, value: null };
  const ms = typeof input === "number" ? input : Date.parse(String(input));
  // Finite is not enough: `new Date(1e18).toISOString()` throws a RangeError, and the payload is
  // attacker-controlled (review finding 5). Bound to what a Date can represent AND to a horizon a
  // review clock could plausibly mean (100 years).
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return { ok: false, reason: "That is not a valid date" };
  if (ms <= nowMs) return { ok: false, reason: "The review date must be in the future" };
  if (ms - nowMs > 100 * 365 * 24 * 3600 * 1000) return { ok: false, reason: "The review date is too far in the future" };
  return { ok: true, value: new Date(ms).toISOString() };
}

// --- Config (global + per-space fallback, mirrors resolveEffectiveConfig) ---

// B1: a space has ONE default definition (space → global → built-in) and any number of
// label-scoped extras, each stored under its own id. A page's record names its `workflowId`,
// and every caller that acts on a page passes it — a page assigned "fast-track" must never be
// judged by the default's states after the fact.
const extraDefKey = (spaceKey, workflowId) => `workflow-def-space-${sanitize(spaceKey)}-${workflowId}`;
export const WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

export async function resolveWorkflowDef(spaceKey, workflowId = null) {
  if (spaceKey && workflowId && workflowId !== "default" && WORKFLOW_ID_RE.test(workflowId)) {
    const extra = await kvs.get(extraDefKey(spaceKey, workflowId));
    if (extra && Array.isArray(extra.states) && extra.states.length) return extra;
  }
  const space = spaceKey ? await kvs.get(`workflow-def-space-${sanitize(spaceKey)}`) : null;
  if (space && Array.isArray(space.states) && space.states.length) return space;
  const global = await kvs.get("workflow-def-global");
  if (global && Array.isArray(global.states) && global.states.length) return global;
  return { ...DEFAULT_WORKFLOW };
}

export const WORKFLOW_COLORS = ["neutral", "info", "success", "caution", "critical"];
const STATE_ID_RE = /^[a-z0-9][a-z0-9_]{0,29}$/;

// PURE. A definition the engine can run: 1–20 states with unique ids, exactly one initial,
// known colours, transitions between known states (no self-loops, no duplicates). Returns
// { ok, reason, value } with `value` normalised (trimmed names, booleans, ints).
export function validateDefinition(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "No definition" };
  const states = Array.isArray(input.states) ? input.states : [];
  if (!states.length) return { ok: false, reason: "A workflow needs at least one state" };
  if (states.length > 20) return { ok: false, reason: "A workflow can have at most 20 states" };
  const seen = new Set(); const outStates = []; let initials = 0;
  for (const st of states) {
    const id = String(st?.id || "").trim();
    if (!STATE_ID_RE.test(id)) return { ok: false, reason: `State id "${id || "(empty)"}" must be 1–30 lowercase letters, digits or underscores` };
    if (seen.has(id)) return { ok: false, reason: `State id "${id}" is used twice` };
    seen.add(id);
    const name = String(st?.name || "").trim().slice(0, 60);
    if (!name) return { ok: false, reason: `State "${id}" needs a name` };
    const color = WORKFLOW_COLORS.includes(st?.color) ? st.color : "neutral";
    const days = st?.reviewAfterDays == null || st?.reviewAfterDays === "" ? null : parseInt(st.reviewAfterDays, 10);
    if (days != null && (!Number.isFinite(days) || days <= 0 || days > 3650)) return { ok: false, reason: `State "${name}": the review period must be a whole number of days (1–3650)` };
    const clean = { id, name, color };
    if (st?.initial === true) { clean.initial = true; initials++; }
    if (st?.enforce === true) clean.enforce = true;
    if (days != null) clean.reviewAfterDays = days;
    outStates.push(clean);
  }
  if (initials !== 1) return { ok: false, reason: initials === 0 ? "Mark exactly one state as the first state" : "Only one state can be the first state" };
  const transitions = Array.isArray(input.transitions) ? input.transitions : [];
  const edges = new Set(); const outT = [];
  for (const t of transitions) {
    const from = String(t?.from || ""); const to = String(t?.to || "");
    if (!seen.has(from) || !seen.has(to)) return { ok: false, reason: `Transition ${from || "?"} → ${to || "?"} names a state that does not exist` };
    if (from === to) continue;
    const k = `${from}>${to}`; if (edges.has(k)) continue; edges.add(k);
    outT.push({ from, to });
  }
  const id = String(input.id || "default").trim();
  if (!WORKFLOW_ID_RE.test(id)) return { ok: false, reason: `Workflow id "${id}" must be 1–30 lowercase letters, digits, dashes or underscores` };
  const name = String(input.name || "").trim().slice(0, 80) || "Workflow";
  return { ok: true, value: { id, name, states: outStates, transitions: outT } };
}

// PURE. Which label-scoped workflow a page with these labels gets: the highest priority whose
// labels intersect the page's; ties keep the earlier entry; null means "the default".
export function chooseWorkflowForLabels(labelWorkflows, pageLabels) {
  const have = new Set((pageLabels || []).map((l) => String(l).toLowerCase()));
  let best = null;
  for (const lw of Array.isArray(labelWorkflows) ? labelWorkflows : []) {
    if (!lw?.workflowId || !Array.isArray(lw.labels)) continue;
    if (!lw.labels.some((l) => have.has(String(l).toLowerCase()))) continue;
    const pr = Number.isFinite(lw.priority) ? lw.priority : 0;
    if (!best || pr > best.priority) best = { workflowId: lw.workflowId, priority: pr };
  }
  return best ? best.workflowId : null;
}

// PURE. The settings' label-workflow list, clean: ids valid, labels lowercase and bounded.
export function sanitizeLabelWorkflows(input) {
  if (!Array.isArray(input)) return [];
  const out = []; const seen = new Set();
  for (const lw of input) {
    const id = String(lw?.workflowId || "").trim();
    if (!WORKFLOW_ID_RE.test(id) || id === "default" || seen.has(id)) continue;
    seen.add(id);
    const labels = [...new Set((Array.isArray(lw?.labels) ? lw.labels : []).map((l) => String(l).trim().toLowerCase()).filter((l) => /^[a-z0-9][a-z0-9_.-]{0,60}$/.test(l)))].slice(0, 20);
    const priority = Math.max(0, Math.min(1000, parseInt(lw?.priority, 10) || 0));
    out.push({ workflowId: id, name: typeof lw?.name === "string" ? lw.name.slice(0, 80) : null, labels, priority });
  }
  return out.slice(0, 20);
}

// How many pages sit in a state of this space (first index page — enough to refuse a delete).
async function countPagesInState(spaceKey, stateId) {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`workflow-idx-${sanitize(spaceKey)}-${stateId}-`)).limit(100).getMany();
  return (results || []).length;
}

// The space's workflows as the editor sees them: the resolved default (with where it came from)
// and every label-scoped extra with its definition.
export async function listSpaceWorkflows(spaceKey) {
  const sk = sanitize(spaceKey);
  const space = await kvs.get(`workflow-def-space-${sk}`);
  const global = await kvs.get("workflow-def-global");
  const def = (space?.states?.length && space) || (global?.states?.length && global) || { ...DEFAULT_WORKFLOW };
  const source = space?.states?.length ? "space" : global?.states?.length ? "global" : "builtin";
  const settings = await getSpaceWorkflowSettings(spaceKey);
  const extras = [];
  for (const lw of settings.labelWorkflows || []) {
    const d = await kvs.get(extraDefKey(spaceKey, lw.workflowId));
    extras.push({ workflowId: lw.workflowId, labels: lw.labels, priority: lw.priority, def: d || null });
  }
  return { default: def, source, extras, colors: WORKFLOW_COLORS };
}

// Save the space default (workflowId absent / "default" / the default's own id) or a
// label-scoped extra. A state that still holds pages cannot be removed — those pages would be
// in a state the definition no longer knows.
export async function storeSpaceWorkflow(spaceKey, { workflowId, def, labels, priority }) {
  if (!spaceKey) return { success: false, reason: "spaceKey required" };
  const v = validateDefinition({ ...def, id: workflowId && workflowId !== "default" ? workflowId : (def?.id || "default") });
  if (!v.ok) return { success: false, reason: v.reason };
  const clean = v.value;
  const isExtra = !!workflowId && workflowId !== "default";
  const current = isExtra ? await kvs.get(extraDefKey(spaceKey, workflowId)) : await resolveWorkflowDef(spaceKey);
  const keep = new Set(clean.states.map((s) => s.id));
  for (const st of current?.states || []) {
    if (keep.has(st.id)) continue;
    if (!isExtra || current) {
      const n = await countPagesInState(spaceKey, st.id);
      if (n > 0) return { success: false, reason: `"${st.name || st.id}" still has ${n >= 100 ? "100+" : n} page${n === 1 ? "" : "s"} in it — move them first, then remove the state` };
    }
  }
  if (isExtra) {
    await kvs.set(extraDefKey(spaceKey, workflowId), clean);
    const settings = await getSpaceWorkflowSettings(spaceKey);
    const others = (settings.labelWorkflows || []).filter((lw) => lw.workflowId !== workflowId);
    const entry = sanitizeLabelWorkflows([{ workflowId, name: clean.name, labels, priority }])[0] || { workflowId, name: clean.name, labels: [], priority: 0 };
    await kvs.set(`workflow-settings-${sanitize(spaceKey)}`, { ...settings, labelWorkflows: [...others, entry] });
    const deadEnds = findDeadEndStates(clean);
    // Labels Confluence cannot carry (spaces, uppercase) are dropped by the sanitizer; say so
    // rather than saving "Workflow saved." over an empty list (review finding 15).
    const asked = (Array.isArray(labels) ? labels : []).map((l) => String(l).trim()).filter(Boolean);
    const dropped = asked.filter((l) => !entry.labels.includes(l.toLowerCase()));
    const warnings = [];
    if (deadEnds.length) warnings.push(`These states have no way out: ${deadEnds.map((id) => findState(clean, id)?.name || id).join(", ")}`);
    if (dropped.length) warnings.push(`These labels were not kept (labels are lowercase letters, digits, dots, dashes and underscores): ${dropped.join(", ")}`);
    return { success: true, def: clean, labels: entry.labels, warning: warnings.length ? warnings.join(". ") : null };
  }
  const r = await storeWorkflowConfig("space", spaceKey, clean);
  return { ...r, def: clean };
}

/** WF-11: put the space's DEFAULT definition back as it was — a copy, or no copy (the global / built-in one). */
export async function restoreSpaceDefaultWorkflow(spaceKey, prevSource, prevDef) {
  if (!spaceKey) return { success: false, reason: "spaceKey required" };
  if (prevSource === "space" && prevDef?.states?.length) return storeWorkflowConfig("space", spaceKey, prevDef);
  await kvs.delete(`workflow-def-space-${sanitize(spaceKey)}`).catch(() => {});
  return { success: true };
}

export async function deleteSpaceWorkflow(spaceKey, workflowId) {
  if (!spaceKey || !workflowId || workflowId === "default") return { success: false, reason: "Only a label-scoped workflow can be removed" };
  // Refuse while any page in the space still runs it: the WHOLE index (30 pages, ~3,000 rows,
  // like the dashboard) on the row's own `workflowId`; only a row written before the field
  // existed costs a record read. A partial scan let an extra with live pages be deleted and
  // their enforcement silently stop (review finding 10).
  let q = kvs.query().where("key", WhereConditions.beginsWith(`workflow-idx-${sanitize(spaceKey)}-`)).limit(100);
  for (let i = 0; i < 30; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const { value } of results || []) {
      let wid = value?.workflowId;
      if (wid === undefined && value?.pageId) wid = (await readPageWorkflow(value.pageId))?.workflowId;
      if (wid === workflowId) return { success: false, reason: "Pages in this space still run this workflow — move them to another workflow first" };
    }
    if (!nextCursor) break;
    q = kvs.query().where("key", WhereConditions.beginsWith(`workflow-idx-${sanitize(spaceKey)}-`)).limit(100).cursor(nextCursor);
  }
  await kvs.delete(extraDefKey(spaceKey, workflowId)).catch(() => {});
  const settings = await getSpaceWorkflowSettings(spaceKey);
  await kvs.set(`workflow-settings-${sanitize(spaceKey)}`, { ...settings, labelWorkflows: (settings.labelWorkflows || []).filter((lw) => lw.workflowId !== workflowId) });
  return { success: true };
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

// B4: mirror the state as a page label when the space asks for it, and stamp the record so the
// hourly sweep knows which rows still need the label (or need it removed). Best-effort.
// The stamp lives in its OWN key (`workflow-label-{pageId}`), never on the state record: the
// label round-trips take seconds, and writing the whole record back afterwards would clobber a
// transition that landed meanwhile (review finding 4 — an Approved/enforced record written over
// a legitimate move to Draft).
export const labelStampKey = (pageId) => `workflow-label-${pageId}`;
export async function readLabelStamp(pageId) { return (await kvs.get(labelStampKey(pageId)))?.stateId || null; }
export async function mirrorStateLabel(pageId, record, settings) {
  if (!record) return null;
  if (!settings?.syncLabels) return null;
  const r = await syncStateLabel(pageId, record.stateId);
  if (r.ok) await kvs.set(labelStampKey(pageId), { stateId: record.stateId, at: new Date().toISOString() }).catch(() => {});
  return r;
}
export async function clearStateLabel(pageId) {
  const r = await syncStateLabel(pageId, null);
  if (r.ok) await kvs.delete(labelStampKey(pageId)).catch(() => {});
  return r;
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
    workflowId: record.workflowId || null, // B1: the dashboard names the state from the page's own definition
    enteredAt: record.enteredAt,
    reviewDueAt: record.reviewDueAt || null,
  });
  await writeStateContentProp(pageId, record);
  // WF-6: the byline chip carries the state — refreshed on every persisted record.
  await touchByline(pageId);
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

// Every workflow key a page owns, gone — for a page Confluence itself has forgotten (purged from
// the trash: v2 GET 404s). Called by the hourly sweep once `fetchPageStatuses` says `missing`,
// never on `trashed` (a restored page keeps its state, as Comala does) and never on `unknown`.
// The approval records + inbox rows go through the approvals module's own teardown so the
// per-approver index stays consistent with the records.
export async function purgePageWorkflow(pageId, { clearApprovals } = {}) {
  const record = await readPageWorkflow(pageId);
  const sk = sanitize(record?.spaceKey || "_");
  const keys = [
    `workflow-state-${pageId}`, `workflow-pending-${pageId}`, `workflow-autoassigned-${pageId}`,
    `workflow-integrity-notified-${pageId}`, `workflow-review-notified-${pageId}`, `workflow-completing-${pageId}`,
    `workflow-label-${pageId}`,
  ];
  if (record?.stateId) keys.push(`workflow-idx-${sk}-${record.stateId}-${pageId}`);
  for (const k of keys) await kvs.delete(k).catch(() => {});
  // Index rows under other states (a record that moved while a write failed) and the log.
  for (const prefix of [`workflow-log-${pageId}-`]) {
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
    for (const { key } of results || []) await kvs.delete(key).catch(() => {});
  }
  if (typeof clearApprovals === "function") await clearApprovals(pageId, null, null).catch(() => {});
  return { purged: true, stateId: record?.stateId || null, spaceKey: record?.spaceKey || null };
}

export async function appendWorkflowLog(pageId, entry) {
  const ts = Date.now();
  await kvs.set(`workflow-log-${pageId}-${ts}`, { ts, ...entry }); // NO TTL — compliance history
  return ts;
}

// WF-3 (UX critique 2026-09-19): the LAST approval decision that still matters — the newest
// approval-denied / approval-stale entry, and only if nothing moved the page since (a later
// transition or re-request makes that decision history, not status). Pure; unit-tested.
// Answers { kind: "denied" | "stale", at, byName, reason, reviewedVersion, to } or null.
export function lastDecisionFrom(log) {
  const entries = Array.isArray(log) ? [...log].sort((a, b) => (a?.ts || 0) - (b?.ts || 0)) : [];
  const last = entries[entries.length - 1];
  if (!last) return null;
  if (last.kind !== "approval-denied" && last.kind !== "approval-stale") return null;
  const ar = last.details?.approvalRecord || null;
  if (last.kind === "approval-stale") {
    return { kind: "stale", at: last.ts, byName: last.byName || null, reason: null, reviewedVersion: ar?.pinnedVersion ?? null, to: last.to || null };
  }
  const denial = (ar?.decisions || []).find((d) => d?.decision === "denied");
  return {
    kind: "denied", at: last.ts,
    byName: denial?.name || last.byName || ar?.completedByName || null,
    reason: denial?.reason || null,
    reviewedVersion: denial?.versionAtDecision ?? ar?.pinnedVersion ?? null,
    to: last.to || null,
  };
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
// A5: callers pass `resolveReviewAfterDays(state, settings)` as the override, which already folds
// the per-state map and the legacy enforce-state setting in; the signature is unchanged.
export function computeReviewDueAt(state, overrideDays) {
  const days = (typeof overrideDays === "number" && overrideDays > 0) ? overrideDays : state?.reviewAfterDays;
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

// --- Orchestration (called by resolvers AND by the dev test-hook with explicit args) ---

// Assign a workflow to a page and set its initial state (idempotent-ish: re-assign resets to initial).
export async function assignPageWorkflow({ pageId, spaceKey, actorAccountId, actorName, workflowId, logReason }) {
  if (!pageId) return { success: false, reason: "pageId required" };
  // B1: "default" (or nothing) is the space default; any other id must be a stored extra.
  const def = await resolveWorkflowDef(spaceKey, workflowId);
  if (workflowId && workflowId !== "default" && def.id !== workflowId) {
    return { success: false, reason: `Workflow ${workflowId} not defined for this space` };
  }
  const initial = getInitialState(def);
  if (!initial) return { success: false, reason: "Workflow has no states" };
  const enteredAt = new Date().toISOString();
  const prev = await readPageWorkflow(pageId);
  // A5: the initial state may carry a review clock too (definition or per-state override).
  const settings = await getSpaceWorkflowSettings(spaceKey);
  const record = {
    workflowId: def.id,
    stateId: initial.id,
    enteredAt,
    enteredBy: actorAccountId || null,
    enteredByName: actorName || null,
    spaceKey: spaceKey || null,
    reviewDueAt: computeReviewDueAt(initial, resolveReviewAfterDays(initial, settings)),
  };
  await persistState(pageId, record, prev?.stateId);
  await mirrorStateLabel(pageId, record, settings).catch(() => {});
  await appendWorkflowLog(pageId, { from: null, to: initial.id, by: actorAccountId || null, byName: actorName || null, reason: logReason || "assigned" });
  return { success: true, record, state: initial, def };
}

// --- Per-space workflow activation settings (at-scale assignment) ---

const DEFAULT_SPACE_SETTINGS = { enabled: false, autoAssignNew: false, workflowId: "default", demoteTo: "initial", reviewAfterDaysByState: {}, syncLabels: false, labelWorkflows: [] };

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
  const existing = await getSpaceWorkflowSettings(spaceKey);
  // A2/A5: `demoteTo` and `reviewAfterDaysByState` name states, so they are validated against the
  // space's RESOLVED definition and a dead value is refused here rather than ignored at enforce time.
  const def = await resolveWorkflowDef(spaceKey);
  let demoteTo = "initial";
  if (typeof settings?.demoteTo === "string" && settings.demoteTo && settings.demoteTo !== "initial") {
    const check = validateDemoteTarget(def, settings.demoteTo, sanitizeEntryConditions(settings?.entryConditions));
    if (!check.ok) return { success: false, reason: check.reason };
    demoteTo = settings.demoteTo;
  }
  const byState = sanitizeReviewAfterDaysByState(settings?.reviewAfterDaysByState, def);
  if (!byState.ok) return { success: false, reason: byState.reason };
  const clean = {
    enabled: !!settings?.enabled,
    autoAssignNew: !!settings?.autoAssignNew,
    workflowId: settings?.workflowId || "default",
    // #44: how an unapproved edit to an enforced Approved page is handled. Default DEMOTE
    // (provably non-destructive); "revert" (byte-freeze) is opt-in.
    enforceMode: settings?.enforceMode === "revert" ? "revert" : "demote",
    // #45: re-review an Approved page after N days (null = use the workflow default). The
    // sweep auto-transitions overdue Approved pages to Expired.
    // A5: this legacy field stays the ENFORCE-state override (see resolveReviewAfterDays).
    reviewAfterDays: (typeof settings?.reviewAfterDays === "number" && settings.reviewAfterDays > 0)
      ? Math.round(settings.reviewAfterDays) : null,
    // A2: "initial" (today's behaviour) or a validated non-enforce state id reachable from the
    // enforce state — see validateDemoteTarget / resolveDemoteTarget.
    demoteTo,
    // A5: { <stateId>: days } review clocks for states other than (or including) the enforce
    // state; a per-state entry wins over the legacy `reviewAfterDays` above.
    reviewAfterDaysByState: byState.value,
    // #46: per-target-state transition conditions. { <stateId>: { requireRules, requireAi,
    // aiThreshold, onBudgetExhausted } } — reuses the space validation ruleset (rulesRef "space").
    entryConditions: sanitizeEntryConditions(settings?.entryConditions),
    // B4: mirror the state as `sv-state-{id}` so Content by Label / CQL can filter on it.
    syncLabels: settings?.syncLabels === true,
    // B2: read confirmations on approved pages — { enabled, audience: [{type,id,name}] } or null.
    readConfirmation: sanitizeReadConfirmation(settings?.readConfirmation),
    // B3: every approval decision must carry a TOTP from the approver's enrolled device.
    requireSignature: settings?.requireSignature === true,
    // B1: label-scoped workflows — [{ workflowId, name, labels, priority }], highest priority wins.
    // The settings editor does not own this field (the definition editor does), so a save that
    // omits it must keep what is stored — not wipe every mapping (Tier B review, finding 1).
    labelWorkflows: settings?.labelWorkflows === undefined ? (existing.labelWorkflows || []) : sanitizeLabelWorkflows(settings?.labelWorkflows),
  };
  // Optional approval config for the enforce transition (#43). Shape:
  // { approvers: [{ type:"user"|"group", id, name }], mode:"any"|"all"|"min", min }.
  if (settings?.approval && Array.isArray(settings.approval.approvers)) {
    clean.approval = {
      approvers: settings.approval.approvers.filter((a) => a && a.id).map((a) => ({ type: a.type || "user", id: String(a.id).slice(0, 200), name: typeof a.name === "string" ? a.name.slice(0, 120) : null, ...(typeof a.hint === "string" && a.hint ? { hint: a.hint.slice(0, 200) } : {}) })), // hint: email / public name, to tell namesakes apart
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
  // B1: a label-scoped workflow wins over the default when one of its labels is on the page.
  let workflowId = settings.workflowId;
  if ((settings.labelWorkflows || []).length) {
    const chosen = chooseWorkflowForLabels(settings.labelWorkflows, await fetchPageLabels(pageId));
    if (chosen) workflowId = chosen;
  }
  const res = await assignPageWorkflow({ pageId, spaceKey, actorAccountId, actorName, workflowId, logReason: workflowId !== settings.workflowId ? `auto-assigned on create (label workflow ${workflowId})` : "auto-assigned on create" });
  return { assigned: !!res.success, reason: res.success ? "auto-assigned" : res.reason, record: res.record, workflowId };
}

// Move a page to `toStateId` after validating the edge. Returns {success, reason?, record?}.
// `requireStewardForEnforce` is enforced by the caller (resolver) — logic stays authz-free & testable.
// `approvalRecord` (A4): the evidence snapshot built by approvals.js (buildApprovalRecord) — or,
// for a direct steward approval, the same shape with no decisions. Stored on the state record as
// `record.approvalRecord` and copied into the log entry's `details.approvalRecord`; cleared with
// the other enforce fields when the page leaves the enforce state.
export async function transitionPageWorkflow({ pageId, spaceKey, toStateId, actorAccountId, actorName, reason, approvers, approvedVersion, approvalRecord, activity = true }) {
  if (!pageId || !toStateId) return { success: false, reason: "pageId and toStateId required" };
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const def = await resolveWorkflowDef(spaceKey || current.spaceKey, current.workflowId);
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
      approvalRecord: approvalRecord && typeof approvalRecord === "object" ? approvalRecord : null,
    };
  } else {
    // `...current` is spread into the record below, so the previous approval's evidence would
    // survive a move out of Approved unless it is cleared here, with the rest of the enforce set.
    enforceFields = { enforce: false, approvedVersion: null, approvers: [], approvalRecord: null };
  }
  // #45/A5: a review clock on the entered state — per-state override, the legacy enforce-state
  // override, or the definition's own value (resolveReviewAfterDays). A per-state override can
  // put a clock on a state the definition gives none, so the settings are read on every move
  // (one KVS get).
  const settings = await getSpaceWorkflowSettings(current.spaceKey || spaceKey);
  const reviewOverride = resolveReviewAfterDays(target, settings);
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
  // SEC-2 (owner decision 2026-09-19): the workflow is the senior lock. Entering an enforced state
  // takes custody of every seal on the page (expiry paused, personal actions refused, the page's
  // privileged set is the only one that edits inside); leaving hands them back with their remaining
  // time. Best effort, after the state is persisted — the record is the truth the trigger reads.
  const enteringEnforce = !!target.enforce && !current.enforce;
  const leavingEnforce = !!current.enforce && !target.enforce;
  if (enteringEnforce || leavingEnforce) {
    try {
      const custody = await import("./seal-custody.js");
      if (enteringEnforce) await custody.holdPageSeals({ pageId, record, stateName: target.name || toStateId, actorAccountId, actorName });
      else await custody.handBackPageSeals({ pageId, record, actorAccountId, actorName, toStateName: target.name || toStateId });
    } catch (e) { console.warn("[SEAL-CUSTODY] transition hook failed:", e?.message || e); }
  }
  // Review #1: a transition that is NOT the completion of the page's pending approval (no
  // approvalRecord rides it: a plain request-transition to an open state, the review-clock
  // expiry, a re-assign) leaves that approval pointing at a page that is no longer where the
  // approvers reviewed it. Left in place it can never complete (finalize finds no edge from the
  // new state and keeps the record) and the ribbon shows "Awaiting approval" instead of the
  // state menu — nobody can move the page from the UI. Void it, with its inbox rows.
  if (!approvalRecord) {
    try {
      const pending = await kvs.get(`workflow-pending-${pageId}`);
      if (pending) {
        const { clearPageApprovals } = await import("./approvals.js");
        await clearPageApprovals(pageId, pending.toStateId, pending.approvers);
        console.warn(`[WORKFLOW] pending approval to ${pending.toStateId} voided: page ${pageId} moved ${current.stateId} → ${toStateId}`);
      }
    } catch (e) { console.warn("[WORKFLOW] could not void the pending approval:", e); }
  }
  await mirrorStateLabel(pageId, record, settings).catch(() => {});
  await appendWorkflowLog(pageId, {
    from: current.stateId,
    to: toStateId,
    by: actorAccountId || null,
    byName: actorName || null,
    reason: reason || null,
    // A4: the evidence rides the log entry of the transition it completed. `details` is only
    // added when there is something to put in it, so plain entries keep their flat shape.
    ...(enforceFields.approvalRecord ? { details: { approvalRecord: enforceFields.approvalRecord } } : {}),
  });
  // A1: the state is persisted — the transition is a fact. Beside the legacy workflow-log
  // (kept: get-workflow-log still reads it); this is the entry the unified activity feed shows.
  // `activity:false` is passed by the enforcement/expiry callers that record their own, more
  // specific row for the same event — one event, one row.
  if (activity) await recordActivity({
    type: "workflow.transition",
    pageId,
    spaceKey: record.spaceKey,
    actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: {
      from: current.stateId,
      to: toStateId,
      fromName: findState(def, current.stateId)?.name || current.stateId,
      toName: target?.name || toStateId,
      reason: reason || null,
      approvedVersion: enforceFields.approvedVersion ?? null,
      // A4: a SUMMARY only. The full approvalRecord (ids, names, free-text reasons) can pass the
      // 1 KB details cap with two approvers, and boundDetails then drops EVERY field to a marker
      // (A1 review F3) — from/to would vanish from the feed. The full record lives on the state
      // record and in the workflow-log entry above.
      approval: enforceFields.approvalRecord
        ? {
          outcome: enforceFields.approvalRecord.outcome,
          mode: enforceFields.approvalRecord.mode ?? null,
          decided: (enforceFields.approvalRecord.decisions || []).filter((d) => d.decision !== "pending").length,
          aiGate: enforceFields.approvalRecord.aiGate?.status ?? null,
        }
        : null,
    },
    version: enforceFields.approvedVersion ?? null,
  });
  return { success: true, record, state: target, def };
}

// A5: the steward-editable review date (Comala's clock icon). Authz is the resolver's job
// (canEditPage + authorizeSteward on the record's space); this layer validates the date, writes
// the record + by-state index row (the dashboard's overdue count reads it), appends the log
// entry and records the activity row. `null` clears the clock. The once-only overdue-notice
// marker is dropped so a date that later passes again is announced again.
export async function setPageReviewDue({ pageId, reviewDueAt, actorAccountId, actorName, reason }) {
  if (!pageId) return { success: false, reason: "pageId required" };
  const check = validateReviewDueAt(reviewDueAt);
  if (!check.ok) return { success: false, reason: check.reason };
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const from = current.reviewDueAt || null;
  const to = check.value;
  const record = { ...current, reviewDueAt: to };
  await persistState(pageId, record, current.stateId);
  await kvs.delete(`workflow-review-notified-${pageId}`).catch(() => {});
  await appendWorkflowLog(pageId, {
    kind: "review-due-set",
    stateId: current.stateId,
    by: actorAccountId || null,
    byName: actorName || null,
    reason: reason || null,
    details: { from, to },
  });
  const def = await resolveWorkflowDef(current.spaceKey, current.workflowId);
  await recordActivity({
    type: "workflow.review-due",
    pageId,
    spaceKey: record.spaceKey || null,
    actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: { from, to, stateId: current.stateId, stateName: findState(def, current.stateId)?.name || current.stateId, reason: reason || null },
    version: null,
  });
  return { success: true, reviewDueAt: to, record };
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
    // B1: the same label scoping the created-page path applies (review finding 12).
    let workflowId = settings.workflowId;
    if ((settings.labelWorkflows || []).length) workflowId = chooseWorkflowForLabels(settings.labelWorkflows, await fetchPageLabels(p.id)) || workflowId;
    const r = await assignPageWorkflow({ pageId: p.id, spaceKey, actorAccountId, workflowId, logReason: "bulk-assigned" });
    if (r.success) assigned += 1;
  }
  const nextLink = body?._links?.next;
  const nextCursor = nextLink ? new URLSearchParams(nextLink.split("?")[1] || "").get("cursor") : null;
  return { success: true, assigned, scanned: pages.length, capped: !!nextCursor, nextCursor };
}

// Read model for the UI: current record + available transitions + def.
export async function getPageWorkflow(pageId, spaceKey) {
  const record = await readPageWorkflow(pageId);
  const def = await resolveWorkflowDef(spaceKey || record?.spaceKey, record?.workflowId);
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
