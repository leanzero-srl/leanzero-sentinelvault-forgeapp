/*
 * The workflow state machine's pure rules — ZERO imports, so the engine (logic.js, triggers.js),
 * the save paths and the browser (the Workflow tab's live check) read ONE copy.
 * logic.js re-exports everything here; test/workflow-engine.test.mjs and
 * test/workflow-demote-fallback.test.mjs pin it.
 */

export function findState(def, stateId) {
  if (!def || !Array.isArray(def.states)) return null;
  return def.states.find((s) => s.id === stateId) || null;
}

export function getInitialState(def) {
  if (!def || !Array.isArray(def.states) || def.states.length === 0) return null;
  return def.states.find((s) => s.initial) || def.states[0];
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

export const enforceStateIds = (def) => (def?.states || []).filter((s) => s?.enforce).map((s) => s.id);

// The rules a demote target must meet on its own, whatever state the page leaves: not an enforce
// state (demoting Approved to Approved is not a demotion) and no entry gate. A demote is a SYSTEM
// move that skips the entry gate (rules / AI review) a human transition would pay, so a state that
// has one cannot be the target (review finding 9): the page would land past a gate nobody ran.
// Null when the target is fine, else { code, reason }.
function targetProblem(target, stateId, entryConditions) {
  if (target.enforce) return { code: "approved-target", reason: `"${target.name || stateId}" is an approved state — a page cannot be moved back to it` };
  const cond = entryConditions && typeof entryConditions === "object" ? entryConditions[target.id] : null;
  if (cond && (cond.requireRules || cond.requireAi)) {
    return { code: "entry-condition", reason: `"${target.name || stateId}" has an entry condition, and a page moved back automatically would skip it. Remove the condition, or choose another state to move pages back to, or choose Revert` };
  }
  return null;
}

// PURE. { ok, reason } — may `stateId` be the space's demotion target for this definition?
// (a) it exists, (b) it is not itself an enforce state, (c) it has no entry gate, (d) it is reachable
// by a defined transition from EVERY enforce state — the demote runs from whichever enforce state
// the page is in, and a target one of them cannot reach would leave that page enforced-but-not-
// demoted. A definition with no enforce state has nothing to demote from, so no stateId is valid.
export function validateDemoteTarget(def, stateId, entryConditions = null) {
  if (!def || !Array.isArray(def.states)) return { ok: false, reason: "No workflow definition" };
  const target = findState(def, stateId);
  if (!target) return { ok: false, reason: `Unknown state: ${stateId}` };
  const own = targetProblem(target, stateId, entryConditions);
  if (own) return { ok: false, reason: own.reason };
  const froms = enforceStateIds(def);
  if (!froms.length) return { ok: false, reason: "This workflow has no approved state to move pages back from" };
  const unreachable = froms.filter((from) => !validateTransition(def, from, stateId).ok);
  if (unreachable.length) {
    const names = unreachable.map((id) => findState(def, id)?.name || id).join(", ");
    return { ok: false, reason: `No transition from ${names} to "${target.name || stateId}" — add one to the workflow first` };
  }
  return { ok: true };
}

// PURE. The state an enforced page is MEANT to go to after an unsanctioned edit: the space's
// `demoteTo` when it still names a valid target (a re-saved definition may have dropped the state
// or the edge since the setting was saved), else the initial state (the "initial" setting).
// `fromStateId` tightens the custom target to the edge that will actually be taken. This is the
// intent only — it says nothing about whether the initial state can be reached: planDemote does.
export function resolveDemoteTarget(def, settings, fromStateId) {
  const initial = getInitialState(def);
  const want = settings?.demoteTo;
  if (typeof want !== "string" || !want || want === "initial") return initial;
  if (!validateDemoteTarget(def, want, settings?.entryConditions).ok) return initial;
  if (fromStateId && !validateTransition(def, fromStateId, want).ok) return initial;
  return findState(def, want);
}

/**
 * PURE. Can the app's demote actually be made? `{ ok: true, target }` or `{ ok: false, code, reason }`.
 * The demote follows the space's own workflow: the target (resolveDemoteTarget) must meet the
 * target rules AND be reachable by a defined transition — from `fromStateId` (the page's state, at
 * run time) or, without it, from every enforce state (the save-time check) — "the first state"
 * included. Every caller treats `ok: false` as "the demote cannot run": the engine reverts instead
 * (enforce-rules.js enforcementPlan), the saves refuse.
 *
 * Why the demote keeps needing an edge instead of the app moving the page anywhere it likes: the
 * workflow is the space admin's statement of which moves exist, and the app's demote is a move
 * like any other (it is logged as one, it hands seals back, it lands under the state's review clock).
 * A system move the workflow forbids would put pages in states the admin never connected — and
 * would still have no answer when the target is itself an enforce state. The revert needs no edge.
 *
 * codes: "no-target" (empty definition), "approved-target", "entry-condition", "same-state",
 * "no-transition", "unknown-state" (the page's state is gone from the definition).
 */
export function planDemote(def, settings, fromStateId = null) {
  const target = resolveDemoteTarget(def, settings, fromStateId);
  if (!target) return { ok: false, code: "no-target", reason: "This workflow has no state to move pages back to" };
  // The FIRST state's entry condition does not block the move back: every page starts there with no
  // gate run (assignPageWorkflow), so landing there skips nothing a new page does not skip — and the
  // move back to it is what such spaces always did. A chosen state's condition still does (it falls
  // back to the first state in resolveDemoteTarget, and the save refuses it).
  const isFirst = getInitialState(def)?.id === target.id;
  const own = targetProblem(target, target.id, isFirst ? null : settings?.entryConditions);
  const remedy = "Choose another state to move pages back to, or choose Revert";
  if (own) return { ok: false, code: own.code, reason: `${own.reason}. ${remedy}` };
  if (fromStateId && !findState(def, fromStateId)) return { ok: false, code: "unknown-state", reason: `This workflow no longer has the state "${fromStateId}" the page is in. ${remedy}` };
  const froms = fromStateId ? [fromStateId] : enforceStateIds(def);
  for (const from of froms) {
    if (from === target.id) return { ok: false, code: "same-state", reason: `A page in "${target.name || target.id}" cannot be moved back to the state it is in. ${remedy}` };
    if (!validateTransition(def, from, target.id).ok) {
      return { ok: false, code: "no-transition", reason: `No transition from ${findState(def, from)?.name || from} to "${target.name || target.id}" — add one to the workflow, or ${remedy[0].toLowerCase()}${remedy.slice(1)}` };
    }
  }
  return { ok: true, target };
}
