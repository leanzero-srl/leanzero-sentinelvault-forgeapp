import Resolver from "@forge/resolver";

import { actions as sealingActions } from "./capsules/sealing/actions.js";
import { actions as policyActions } from "./capsules/policies/actions.js";
import { actions as realmActions } from "./capsules/realms/actions.js";
import { actions as operatorActions } from "./capsules/operators/actions.js";
import { actions as bulletinActions } from "./capsules/bulletins/actions.js";
import { actions as entitlementActions } from "./capsules/entitlements/actions.js";
import { actions as panelActions } from "./capsules/panels/actions.js";
import { actions as editReqActions } from "./capsules/editreq/actions.js";
import { actions as sectionSealActions } from "./capsules/section-seals/actions.js";
import { actions as validationActions } from "./capsules/validations/actions.js";
import { actions as workflowActions } from "./capsules/workflow/actions.js";
import { actions as activityActions } from "./capsules/activity/actions.js";
import { actions as classificationActions } from "./capsules/classification/actions.js";
import { actions as pageDetailsActions } from "./capsules/page-details/actions.js";
import { actions as configApiActions } from "./capsules/config-api/actions.js";
import { actions as backupActions } from "./capsules/backup/actions.js";
import { actions as privacyActions } from "./capsules/privacy/actions.js";
import { actions as jiraSealActions } from "./capsules/jira-seals/actions.js";
import { actions as ribbonActions } from "./capsules/ribbon/actions.js";
import { WRITE_ACTIONS, withBackupHook } from "./capsules/backup/hook.js";
import { CONFIG_WRITER_KEYS, scopeOfConfigWrite, refreshConfigMirror } from "./capsules/config-api/mirror.js";
import { SIGNED_SEAL_ACTION_KEYS, signSealActionsOn } from "./shared/seal-signature.js";
import { verifySignature } from "./capsules/workflow/signature.js";
import { kvs } from "@forge/kvs";
import { runInvocation, authzUnknownOf, rateLimitOf, busyReason } from "./shared/confluence-call.js";
import { withActionLog, LOGGED } from "./shared/action-log.js";

const router = new Resolver();

// The capsule each action comes from names its area in the action log ("sealing.lock-attachment").
export const CAPSULES = Object.freeze([
  ["sealing", sealingActions],
  ["policies", policyActions],
  ["realms", realmActions],
  ["operators", operatorActions],
  ["bulletins", bulletinActions],
  ["entitlements", entitlementActions],
  ["panels", panelActions],
  ["editreq", editReqActions],
  ["section-seals", sectionSealActions],
  ["validations", validationActions],
  ["workflow", workflowActions],
  ["activity", activityActions],
  ["classification", classificationActions],
  ["page-details", pageDetailsActions],
  ["config-api", configApiActions],
  ["backup", backupActions],
  ["privacy", privacyActions],
  ["jira-seals", jiraSealActions],
  ["ribbon", ribbonActions],
]);
export const allActions = CAPSULES.flatMap(([, list]) => list);
const areaOf = new Map(CAPSULES.flatMap(([area, list]) => list.map(([key]) => [key, area])));

// One home for "a config write refreshes the Confluence-side mirror": every UI save of site or
// space configuration passes through here, so the export a customer GETs over Confluence REST
// (`sentinel-vault-config`) is never stale. Best-effort — a mirror failure never fails the save.
const withConfigMirror = (key, fn) => async (req) => {
  const result = await fn(req);
  if (result && result.success !== false && result.ok !== false) {
    try { await refreshConfigMirror(scopeOfConfigWrite(key, req?.payload, result), req?.context?.accountId); }
    catch (e) { console.warn(`[CONFIG-API] mirror after ${key} failed:`, e?.message || e); }
  }
  return result;
};
// Signed seal actions (shared/seal-signature.js): with the site setting on, the caller's current
// authenticator code must verify BEFORE the action runs. The code is consumed on success (no
// replay), so a refused action after a good code costs the user the next code — acceptable, the
// same trade the workflow decision makes. Fails CLOSED on a settings read error: an action that
// should have been signed must not run unsigned because KVS blinked.
const withSealSignature = (key, fn) => async (req) => {
  let settings;
  try { settings = await kvs.get("admin-settings-global"); }
  catch (e) { return { success: false, reason: "Could not read the site settings — try again", signatureRequired: false }; }
  if (!signSealActionsOn(settings)) return fn(req);
  const v = await verifySignature(req?.context?.accountId, typeof req?.payload?.code === "string" ? req.payload.code : null);
  if (!v.ok) return { success: false, reason: v.reason, signatureRequired: true, lockedOut: !!v.lockedOut };
  const result = await fn(req);
  if (result && typeof result === "object" && result.success !== false) result.signature = v.signature;
  return result;
};
// 8.12.0 — Confluence's rate limit is not a "no". Every resolver call runs as ONE invocation
// (shared/confluence-call.js runInvocation): a memo for the permission answers that do not change
// within it, a deadline for 429 retries inside the 25 s limit, and a note when a 429 left an
// authorization question unanswered. When that note is set and the action REFUSED, the answer says
// so ("Confluence is limiting requests … try again") instead of the refusal it fell back to; the
// refusal itself stands (nothing is granted on a 429) and its own wording is kept in deniedReason.
// Answers that succeeded are never touched.
export function busyAware(result) {
  if (!authzUnknownOf() || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const refused = result.success === false || (typeof result.error === "string" && result.success !== true);
  if (!refused) return result;
  const rl = rateLimitOf();
  const reason = busyReason(rl?.retryAfterSeconds ?? null);
  return {
    ...result,
    busy: true,
    retryAfterSeconds: rl?.retryAfterSeconds ?? null,
    deniedReason: result.reason ?? result.error ?? null,
    reason,
    ...(typeof result.error === "string" ? { error: reason } : {}),
  };
}
const withInvocation = (key, fn) => (req) => runInvocation(async () => busyAware(await fn(req)), { label: key });

// `wrappedActions` is what the router actually runs (mirror hook included); the dev hook's generic
// seam drives THIS map, not the raw list, so a seam-driven write behaves exactly like a UI write.
// Pillar 12: every write path schedules ONE debounced backup (capsules/backup/hook.js); the
// classification of each action key is pinned by test/backup-hook.test.mjs.
export const wrappedActions = allActions.map(([key, fn]) => {
  let wrapped = CONFIG_WRITER_KEYS.includes(key) ? withConfigMirror(key, fn) : fn;
  if (WRITE_ACTIONS.includes(key)) wrapped = withBackupHook(key, wrapped);
  if (SIGNED_SEAL_ACTION_KEYS.includes(key)) wrapped = withSealSignature(key, wrapped);
  // The action log is the OUTERMOST wrapper: it strips the UI trail before anything reads the payload,
  // and its one line sees the answer the caller gets (busyAware included) and the whole time taken.
  return [key, withActionLog(areaOf.get(key), key, withInvocation(key, wrapped))]; // the backup, mirror and signature wrappers run inside
});
// ONE door to the router: every definition goes through the action log (test/action-log.test.mjs).
const define = (key, fn) => router.define(key, fn[LOGGED] ? fn : withActionLog("app", key, fn));
wrappedActions.forEach(([key, fn]) => define(key, fn));

define("heartbeat", async () => "Sentinel Vault operational");

export const actionRouter = router.getDefinitions();
