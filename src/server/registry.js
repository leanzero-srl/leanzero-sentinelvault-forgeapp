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
import { CONFIG_WRITER_KEYS, scopeOfConfigWrite, refreshConfigMirror } from "./capsules/config-api/mirror.js";

const router = new Resolver();

export const allActions = [
  ...sealingActions,
  ...policyActions,
  ...realmActions,
  ...operatorActions,
  ...bulletinActions,
  ...entitlementActions,
  ...panelActions,
  ...editReqActions,
  ...sectionSealActions,
  ...validationActions,
  ...workflowActions,
  ...activityActions,
  ...classificationActions,
  ...pageDetailsActions,
  ...configApiActions,
];

// One home for "a config write refreshes the Confluence-side mirror": every UI save of site or
// space configuration passes through here, so the export a customer GETs over Confluence REST
// (`sentinel-vault-config`) is never stale. Best-effort — a mirror failure never fails the save.
const withConfigMirror = (key, fn) => async (req) => {
  const result = await fn(req);
  if (result && result.success !== false && result.ok !== false) {
    try { await refreshConfigMirror(scopeOfConfigWrite(key, req?.payload), req?.context?.accountId); }
    catch (e) { console.warn(`[CONFIG-API] mirror after ${key} failed:`, e?.message || e); }
  }
  return result;
};
// `wrappedActions` is what the router actually runs (mirror hook included); the dev hook's generic
// seam drives THIS map, not the raw list, so a seam-driven write behaves exactly like a UI write.
export const wrappedActions = allActions.map(([key, fn]) => [key, CONFIG_WRITER_KEYS.includes(key) ? withConfigMirror(key, fn) : fn]);
wrappedActions.forEach(([key, fn]) => router.define(key, fn));

router.define("heartbeat", async () => "Sentinel Vault operational");

export const actionRouter = router.getDefinitions();
