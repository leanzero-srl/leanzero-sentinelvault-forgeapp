import Resolver from "@forge/resolver";

import { actions as sealingActions } from "./capsules/sealing/actions.js";
import { actions as policyActions } from "./capsules/policies/actions.js";
import { actions as realmActions } from "./capsules/realms/actions.js";
import { actions as operatorActions } from "./capsules/operators/actions.js";
import { actions as bulletinActions } from "./capsules/bulletins/actions.js";
import { actions as entitlementActions } from "./capsules/entitlements/actions.js";
import { actions as panelActions } from "./capsules/panels/actions.js";

const router = new Resolver();

const allActions = [
  ...sealingActions,
  ...policyActions,
  ...realmActions,
  ...operatorActions,
  ...bulletinActions,
  ...entitlementActions,
  ...panelActions,
];

allActions.forEach(([key, fn]) => router.define(key, fn));

router.define("heartbeat", async () => "Sentinel Vault operational");

export const actionRouter = router.getDefinitions();
