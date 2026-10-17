import { asUser, asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";

/**
 * Check if the operator is a realm steward
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key to check
 * @returns {Promise<boolean>} - True if operator is realm steward
 */
// Trigger/scheduled-safe steward check (#44). Inside a Forge trigger there is NO
// asUser() context, so isOperatorSteward (which relies on asUser) can't evaluate an
// arbitrary EDITOR. This uses asApp() + the explicit steward list, and is account-specific
// (the space ADMINISTER check names the subject), so it works in triggers and the sweep.
/** PURE. Confluence Cloud's built-in admin groups (site-admins, confluence-admins-<site>, …). */
export const isAdminGroupName = (name) => /^(site-admins|administrators|system-administrators|confluence-admins(-.+)?)$/i.test(String(name || ""));

/**
 * A memo for ONE invocation that checks one account against many spaces (a list of spaces, the
 * authors of a page's versions): the account's user record and group list are read once. Create it
 * inside the handler and drop it with the invocation. NEVER keep it at module level: a warm Forge
 * container can serve more than one site, and account ids repeat across sites.
 */
export const newStewardMemo = () => ({ user: new Map(), groups: new Map() });
const memoized = (memo, bucket, key, load) => {
  if (!memo) return load();
  if (!memo[bucket].has(key)) {
    // A failed read (null) is not kept: the next space asks again instead of inheriting the miss.
    const p = load().then((v) => { if (v == null) memo[bucket].delete(key); return v; });
    memo[bucket].set(key, p);
  }
  return memo[bucket].get(key);
};
const readUserAsApp = async (accountId) => {
  const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}&expand=groups,operations`);
  return res.ok ? await res.json() : null;
};
const readGroupsAsApp = async (accountId) => {
  const res = await asApp().requestConfluence(route`/wiki/rest/api/user/memberof?accountId=${accountId}&limit=200`);
  return res.ok ? ((await res.json())?.results || []) : null;
};

/**
 * `opts.memo` (newStewardMemo) shares the account reads across calls in one invocation;
 * `opts.spaceId` skips the key → id lookup and may ONLY be passed with the id and key of the same
 * space object the caller read from Confluence itself.
 */
export async function isAccountStewardAsApp(accountId, realmKey, { memo = null, spaceId = null } = {}) {
  if (!accountId) return false;
  let realmConfig = null;
  let globalConfig = null;
  // 1. Explicitly-listed steward (KVS; works everywhere).
  try {
    const sanitized = String(realmKey || "").replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    realmConfig = await kvs.get(`admin-settings-space-${sanitized}`);
    globalConfig = await kvs.get("admin-settings-global");
    const list = realmConfig?.adminUsers || globalConfig?.adminUsers || [];
    if (list.some((o) => (typeof o === "string" ? o : o?.accountId) === accountId)) return true;
  } catch (_) { /* fall through */ }
  // 2. Steward GROUP cohorts + site/org-admin — mirrors isOperatorSteward's cohort + site-admin
  //    arms, but via asApp() (no asUser context in a trigger). One user GET, expanded twice.
  try {
    const data = await memoized(memo, "user", accountId, () => readUserAsApp(accountId).catch(() => null));
    if (data) {
      const stewardGroups = realmConfig?.adminGroups || globalConfig?.adminGroups || [];
      if (stewardGroups.length > 0) {
        const userGroups = (data.groups?.results || []).map((g) => g.name);
        if (stewardGroups.some((g) => userGroups.includes(g))) return true;
      }
      const ops = data.operations || [];
      if (ops.some((op) => op.operation === "administer" && op.targetType === "application")) return true;
      // Asked as the app, `operations` can describe the APP's rights, not this account's, so a site
      // admin read as "no" (tester 2026-09-30: an admin got no Approve/Deny in a personal space).
      // Confluence's own admin groups name the account itself.
      if ((data.groups?.results || []).some((g) => isAdminGroupName(g.name))) return true;
    }
  } catch (_) { /* fall through */ }
  // 2b. The user's group list read on its own (the expand above can come back empty for an app).
  //     Its ids are kept for arm 3, which matches group principals by id.
  let groupIds = null;
  try {
    const groups = await memoized(memo, "groups", accountId, () => readGroupsAsApp(accountId).catch(() => null));
    if (groups) {
      if (groups.some((g) => isAdminGroupName(g?.name))) return true;
      groupIds = groups.map((g) => g?.id).filter(Boolean);
    }
  } catch (_) { /* fall through */ }
  // 3. The space's own admins: Confluence lists the account (or one of its groups) with
  //    administer/space on the space: a direct permission, a group's, or a space ROLE where
  //    Confluence lists the role's holders as users and groups (it does on both measured sites).
  //    A `role` principal itself is never resolved (see below).
  return isSpaceAdministrator(accountId, realmKey, { groupIds, spaceId, memo });
}

// ── Space admin, as Confluence itself lists it ──────────────────────────────────────────────────
//
// WHY (2026-10-17). Arm 3 above and isOperatorRealmSteward used to POST
// /wiki/rest/api/space/{key}/permission/check. Confluence has no such endpoint: it is not in the v1
// spec, and the path answers 405 for every method (measured on wolfaenpak and leanzero-demo; 401 in
// an earlier measurement). Both failed CLOSED, so nobody was ever recognised through them: a person
// who administers a space only through the space's permissions (directly, through a group that is
// not a Confluence admin group, or through the space ROLE "Admin") was an ordinary user to the app.
// The in-memory test fake answered that endpoint as if it worked, which is how it went unseen.
//
// The current API: GET /wiki/api/v2/spaces/{id}/permissions (scope read:space:confluence, held)
// lists every assignment as { principal: { type: user|group|role, id }, operation: { key,
// targetType } }. On a site in role mode (space-role-mode ROLES_TRANSITION, both sites 2026-10-17)
// the Admin role's holders appear there as USER or GROUP principals with administer/space (measured:
// a user given the role, and a group given the role). A `role` principal is never resolved: that
// needs /spaces/{id}/role-assignments and the scope read:space.permission:confluence, which this
// app does not hold. It grants nothing (fail closed). Also "no": more than 20 pages of assignments,
// and a group beyond the account's first 200 groups.

const SPACE_PERMISSION_PAGE = 250;
const SPACE_PERMISSION_MAX_PAGES = 20; // 5,000 assignments; beyond that the answer is "no"

/**
 * PURE. Does one page of /wiki/api/v2/spaces/{id}/permissions give `accountId` administer on the
 * space, directly or through one of `groupIds`? Only an exact administer/space assignment counts;
 * a role principal, a malformed row or another operation never does.
 */
export function grantsSpaceAdminister(assignments, accountId, groupIds = []) {
  if (!accountId || !Array.isArray(assignments)) return false;
  const groups = new Set((Array.isArray(groupIds) ? groupIds : []).filter(Boolean).map(String));
  return assignments.some((a) => {
    if (a?.operation?.key !== "administer" || a?.operation?.targetType !== "space") return false;
    const type = a?.principal?.type;
    const id = a?.principal?.id;
    if (!id) return false;
    if (type === "user") return String(id) === String(accountId);
    if (type === "group") return groups.has(String(id));
    return false;
  });
}

/** PURE. Does this page hold any administer/space assignment to a GROUP (so group ids are needed)? */
export const hasGroupSpaceAdmin = (assignments) => Array.isArray(assignments)
  && assignments.some((a) => a?.principal?.type === "group" && a?.operation?.key === "administer" && a?.operation?.targetType === "space");

/** PURE. The cursor in a v2 list's `_links.next`, or null when there is no next page. */
export function nextCursorOf(body) {
  const next = body?._links?.next;
  if (typeof next !== "string") return null;
  const m = /[?&]cursor=([^&]+)/.exec(next);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Is `accountId` an administrator of the space `spaceKey`, as Confluence lists it?
 *
 * Runs as asApp() with the subject named, like content-access.js: callers pass a Forge-supplied
 * account (req.context, or the author Confluence recorded on a version), and the space is the
 * OBJECT's space, never one the caller named for a different object. `groupIds` (the account's
 * group ids) is read here when not supplied and only when a group holds administer.
 *
 * Fails CLOSED on every path: unknown space, a key that does not match exactly, any non-2xx, a
 * thrown error, too many pages.
 */
export async function isSpaceAdministrator(accountId, spaceKey, { groupIds = null, spaceId = null, memo = null } = {}) {
  if (!accountId || !spaceKey) return false;
  const JH = { headers: { Accept: "application/json" } };
  try {
    let space = spaceId ? { id: String(spaceId), key: spaceKey } : null;
    if (!space) {
      const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`, JH);
      if (!sres.ok) {
        console.warn(`[AUTHZ] space lookup ${spaceKey} → ${sres.status}; not a space admin`);
        return false;
      }
      space = (await sres.json())?.results?.[0];
      if (!space?.id || space.key !== spaceKey) return false;
    }
    let ids = groupIds;
    let cursor = null;
    const seen = new Set();
    for (let page = 0; page < SPACE_PERMISSION_MAX_PAGES; page++) {
      const res = await asApp().requestConfluence(
        cursor
          ? route`/wiki/api/v2/spaces/${space.id}/permissions?limit=${SPACE_PERMISSION_PAGE}&cursor=${cursor}`
          : route`/wiki/api/v2/spaces/${space.id}/permissions?limit=${SPACE_PERMISSION_PAGE}`,
        JH,
      );
      if (!res.ok) {
        console.warn(`[AUTHZ] space permissions ${spaceKey} → ${res.status}; not a space admin`);
        return false;
      }
      const body = await res.json();
      const rows = body?.results || [];
      if (grantsSpaceAdminister(rows, accountId)) return true;
      if (hasGroupSpaceAdmin(rows)) {
        if (ids == null) ids = await groupIdsOf(accountId, memo);
        if (grantsSpaceAdminister(rows, accountId, ids)) return true;
      }
      cursor = nextCursorOf(body);
      if (!cursor || seen.has(cursor)) return false; // the end, or a cursor that does not advance
      seen.add(cursor);
    }
    console.warn(`[AUTHZ] space permissions ${spaceKey}: more than ${SPACE_PERMISSION_MAX_PAGES} pages; not a space admin`);
    return false;
  } catch (e) {
    console.error("[AUTHZ] space admin check threw; not a space admin:", e);
    return false;
  }
}

/** The account's group ids (asApp, subject named). [] on any failure: no group then grants. */
async function groupIdsOf(accountId, memo = null) {
  try {
    const groups = await memoized(memo, "groups", accountId, () => readGroupsAsApp(accountId).catch(() => null));
    return (groups || []).map((g) => g?.id).filter(Boolean);
  } catch (_) { return []; }
}

/**
 * Is the operator an administrator of the space? The space's own permissions, read as the app with
 * the operator named (isSpaceAdministrator). It used to ask asUser() the dead space
 * permission/check endpoint (see above), which answered "no" for everyone.
 */
export async function isOperatorRealmSteward(operatorAccountId, realmKey, opts = {}) {
  return isSpaceAdministrator(operatorAccountId, realmKey, opts);
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
 * Check if operator is a Confluence site or org administrator.
 * Org admins, site admins, and application-level admins are all covered —
 * the Confluence REST API exposes their privileges as operations with
 * operation === "administer" or targetType === "application".
 * @param {string} operatorAccountId - The operator's account ID
 * @returns {Promise<boolean>} - True if operator is site/org admin
 */
export async function isOperatorSiteAdmin(operatorAccountId) {
  if (!operatorAccountId) return false;
  try {
    let response = null;
    try {
      response = await asUser().requestConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=operations`,
      );
    } catch (_) { response = null; }
    // No user session (the config-api queue consumer acting as the token's minter — see
    // shared/user-or-app.js): the same question, as the app, naming the SAME subject. That is
    // exactly isAccountStewardAsApp's arm 2, so it grants nothing that arm does not already.
    if (!response || !response.ok) {
      response = await asApp().requestConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=operations`,
      );
    }

    if (response.ok) {
      const operatorData = await response.json();
      const operations = operatorData.operations || [];

      const hasStewardOps = operations.some(
        (op) =>
          op.operation === "administer" && op.targetType === "application",
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
 * Check if operator holds the steward role (site admin, realm admin, or in steward cohorts).
 * This check is independent of the allowAdminOverride toggle — it determines
 * whether the user should see steward UI (tabs, settings), not whether force-unseal is allowed.
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key
 * @returns {Promise<boolean>} - True if operator is a steward
 */
export async function isOperatorSteward(operatorAccountId, realmKey) {
  const isSiteAdmin = await isOperatorSiteAdmin(operatorAccountId);
  if (isSiteAdmin) {
    return true;
  }

  const isRealmSteward = await isOperatorRealmSteward(operatorAccountId, realmKey);

  const isInStewardCohorts = await isOperatorInStewardCohorts(operatorAccountId, realmKey);

  return isRealmSteward || isInStewardCohorts;
}

/**
 * Check if operator is authorized to perform steward override actions (e.g. force unseal).
 * This is gated by the global allowAdminOverride toggle.
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} realmKey - The realm key
 * @returns {Promise<boolean>} - True if operator has steward override permission
 */
export async function authorizeSteward(operatorAccountId, realmKey) {
  const globalConfig = await kvs.get("admin-settings-global");

  const allowStewardOverride = globalConfig?.allowAdminOverride !== false;

  if (!allowStewardOverride) {
    return false;
  }

  return isOperatorSteward(operatorAccountId, realmKey);
}
