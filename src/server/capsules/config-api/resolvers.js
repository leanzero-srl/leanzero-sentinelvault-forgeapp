/*
 * Config API — the resolver lookup. The consumer and the exporter run EVERY operation through
 * the same handler the UI's router calls, looked up by key from the capsules' registered
 * `actions` arrays (the src/test-hook.js byKey pattern) — never a copy, never KVS directly.
 *
 * The capsule arrays are imported here rather than registry.js's allActions to avoid a module
 * cycle (registry → config-api/actions → export → registry).
 */
import { actions as sealingActions } from "../sealing/actions.js";
import { actions as policyActions } from "../policies/actions.js";
import { actions as sectionSealActions } from "../section-seals/actions.js";
import { actions as validationActions } from "../validations/actions.js";
import { actions as workflowActions } from "../workflow/actions.js";
import { actions as classificationActions } from "../classification/actions.js";

const lists = [sealingActions, policyActions, sectionSealActions, validationActions, workflowActions, classificationActions];

export function handlerByKey(key) {
  for (const list of lists) {
    const hit = list.find(([k]) => k === key);
    if (hit) return hit[1];
  }
  return null;
}

/** Invoke a resolver as `accountId` with an optional page/space context (what the UI would carry). */
export async function invoke(key, payload, accountId, extension = {}) {
  const fn = handlerByKey(key);
  if (!fn) throw new Error(`No resolver "${key}"`);
  return fn({ payload: payload || {}, context: { accountId, extension: extension || {} } });
}
