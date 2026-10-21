import { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { appConfluence } from "./confluence-call.js";
import { errText } from "./action-log.js";

/**
 * Resolve the app's own Atlassian account ID (cached in KVS `app-account-id`).
 * Used to tell the app's own page versions from a person's (loop guards, the baseline rules in
 * capsules/workflow/sanctioned.js). Null when it cannot be resolved: callers fail closed.
 */
export async function resolveAppAccountId() {
  let systemAccountId = await kvs.get("app-account-id");
  if (!systemAccountId) {
    try {
      const myselfResponse = await appConfluence(
        route`/wiki/rest/api/user/current`,
      );
      if (myselfResponse.ok) {
        const myself = await myselfResponse.json();
        systemAccountId = myself.accountId;
        await kvs.set("app-account-id", systemAccountId);
      } else {
        // SV-M3: surface a non-ok /user/current so a persistent 401/403/429 is visible.
        console.error(`[APP-ACCOUNT] /user/current returned ${myselfResponse.status} — app account id unresolved`);
      }
    } catch (e) {
      console.error("[APP-ACCOUNT] lookup failed:", errText(e));
    }
  }
  return systemAccountId;
}
