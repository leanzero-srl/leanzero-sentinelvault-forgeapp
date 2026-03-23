import { asUser, asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";

/**
 * Check if the operator is a realm steward
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key to check
 * @returns {Promise<boolean>} - True if operator is realm steward
 */
export async function isOperatorRealmSteward(operatorAccountId, realmKey) {
  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/space/${realmKey}/permission/check`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: {
            type: "user",
            identifier: operatorAccountId,
          },
          permission: "ADMINISTER",
        }),
      },
    );

    if (response.ok) {
      const result = await response.json();
      return result.hasPermission === true;
    }

    console.warn(`Failed to check realm steward permission: ${response.status}`);
    return false;
  } catch (error) {
    console.error("Error checking realm steward permission:", error);
    return false;
  }
}

/**
 * Check if operator is in configured steward groups or listed as steward
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key
 * @returns {Promise<boolean>} - True if operator is in steward groups/operators
 */
export async function isOperatorInStewardCohorts(operatorAccountId, realmKey) {
  try {
    const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmConfig = await kvs.get(
      `admin-settings-space-${sanitizedRealmKey}`,
    );
    const globalConfig = await kvs.get("admin-settings-global");

    const stewardGroups =
      realmConfig?.adminGroups || globalConfig?.adminGroups || [];
    const stewardOperators =
      realmConfig?.adminUsers || globalConfig?.adminUsers || [];

    const isDirectSteward = stewardOperators.some((stewardOperator) => {
      if (typeof stewardOperator === "string") {
        return stewardOperator === operatorAccountId;
      } else if (stewardOperator && stewardOperator.accountId) {
        return stewardOperator.accountId === operatorAccountId;
      }
      return false;
    });

    if (isDirectSteward) {
      return true;
    }

    if (stewardGroups.length > 0) {
      const operatorResponse = await asUser().requestConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=groups`,
      );

      if (operatorResponse.ok) {
        const operatorData = await operatorResponse.json();
        const operatorGroups = operatorData.groups?.results?.map((g) => g.name) || [];

        return stewardGroups.some((stewardGroup) =>
          operatorGroups.includes(stewardGroup),
        );
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking steward groups:", error);
    return false;
  }
}

/**
 * Check if operator is a Confluence site administrator
 * @param {string} operatorAccountId - The operator's account ID
 * @returns {Promise<boolean>} - True if operator is site admin
 */
export async function isOperatorSiteAdmin(operatorAccountId) {
  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=operations`,
    );

    if (response.ok) {
      const operatorData = await response.json();
      const operations = operatorData.operations || [];

      const hasStewardOps = operations.some(
        (op) =>
          op.operation === "administer" || op.targetType === "application",
      );

      return hasStewardOps;
    }

    return false;
  } catch (error) {
    console.error("Failed to check site admin status:", error);
    return false;
  }
}

/**
 * Check if operator has steward permission based on global config and operator roles
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key
 * @returns {Promise<boolean>} - True if operator has steward permission
 */
export async function authorizeSteward(operatorAccountId, realmKey) {
  const globalConfig = await kvs.get("admin-settings-global");

  const allowStewardOverride = globalConfig?.allowAdminOverride !== false;

  if (!allowStewardOverride) {
    return false;
  }

  const isSiteAdmin = await isOperatorSiteAdmin(operatorAccountId);
  if (isSiteAdmin) {
    return true;
  }

  const isRealmSteward = await isOperatorRealmSteward(operatorAccountId, realmKey);

  const isInStewardCohorts = await isOperatorInStewardCohorts(operatorAccountId, realmKey);

  const result = isRealmSteward || isInStewardCohorts;
  return result;
}
