import { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { appConfluence, userConfluence, isRateLimited, invocationMemo, noteAuthzUnknown } from "./confluence-call.js";
import { setWithTtl } from "./kvs-ttl.js";

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
  // Without an explicit memo the invocation's own memo (confluence-call.js runInvocation) shares the
  // read with every other check in this resolver call; outside a resolver it just loads.
  if (!memo) return invocationMemo(`steward-${bucket}|${key}`, load);
  if (!memo[bucket].has(key)) {
    // A failed read (null) is not kept: the next space asks again instead of inheriting the miss.
    const p = load().then((v) => { if (v == null) memo[bucket].delete(key); return v; });
    memo[bucket].set(key, p);
  }
  return memo[bucket].get(key);
};

// A read Confluence refused with 429 (after the door's retries): told apart from "no" everywhere
// below, so a spent rate limit is never read as "not an admin" (8.12.0).
const RATE_LIMITED = Object.freeze({ rateLimited: true });
const isLimited = (v) => v === RATE_LIMITED;

const readUserAsApp = async (accountId) => {
  const res = await appConfluence(route`/wiki/rest/api/user?accountId=${accountId}&expand=groups,operations`);
  if (isRateLimited(res)) return RATE_LIMITED;
  return res.ok ? await res.json() : null;
};

// ── Short-lived answers shared across invocations (8.12.0) ──────────────────────────────────────
//
// WHY. The same few facts were re-read from Confluence by every resolver a banner refresh runs
// (~6 per refresh, ~375 points each on a space with 186 permission rows), and the app's hourly
// points pool is shared by every site the app is on. These facts are now kept in the app's own
// storage for a short time:
//
//   authz-space-id-<key>        the space id for a key                         10 minutes
//   authz-space-admins-<id>     who Confluence lists with administer/space      60 seconds
//                               (user ids and group ids; a role row never counts)
//   authz-groups-<accountId>    the account's group ids and names               60 seconds
//
// SECURITY. A cached fact can GRANT (an admin, a member of an admin group), so: every fact that can
// grant lives at most CACHE_GRANT_TTL_MS (60 s) after Confluence said it, checked on READ against
// the time stored with it (never trusting the store's own expiry alone; a time in the future is not
// trusted either). A failed or rate-limited read is never stored. Forge storage belongs to ONE
// installation, so an answer never crosses sites; the account id is part of the key, so it never
// crosses accounts; the admin set is keyed by space id and carries its key, so it never crosses
// spaces. The family is runtime (backup/families.js): never backed up, never restored. Consequence,
// documented for admins: a permission removed in Confluence takes up to a minute to reach Sentinel
// Vault (a new one too).

export const CACHE_GRANT_TTL_MS = 60_000;
export const SPACE_ID_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const MAX_CACHED_ENTRIES = 1_000;

/** PURE. A KVS-safe, injective encoding of a key part (space keys like "~abc" have characters KVS refuses). */
export const kvsPart = (s) => String(s ?? "").replace(/[^A-Za-z0-9-]/g, (c) => `#${c.codePointAt(0).toString(16)}.`);
export const spaceIdCacheKey = (spaceKey) => `authz-space-id-${kvsPart(spaceKey)}`;
export const spaceAdminsCacheKey = (spaceId) => `authz-space-admins-${kvsPart(spaceId)}`;
export const groupsCacheKey = (accountId) => `authz-groups-${kvsPart(accountId)}`;

/** PURE. Is a cached value fresh: stored with a time, not older than `ttlMs`, not from the future. */
export function freshCached(v, ttlMs, now = Date.now()) {
  const at = Number(v?.at);
  return !!v && Number.isFinite(at) && at <= now + CLOCK_SKEW_MS && now - at <= ttlMs;
}

const cacheGet = async (key) => { try { return await kvs.get(key); } catch (_) { return null; } };
const cachePut = async (key, value, ttlMs) => {
  try { await setWithTtl(key, { ...value, at: Date.now() }, ttlMs); } catch (e) { console.warn(`[AUTHZ] cache write ${key.split("-").slice(0, 3).join("-")} failed:`, e?.message || e); }
};

/** The account's groups ({ ids, names }), RATE_LIMITED, or null when Confluence would not say. */
async function accountGroupsOf(accountId, memo = null) {
  return memoized(memo, "groups", accountId, async () => {
    const key = groupsCacheKey(accountId);
    const hit = await cacheGet(key);
    if (freshCached(hit, CACHE_GRANT_TTL_MS) && hit.accountId === accountId && Array.isArray(hit.ids) && Array.isArray(hit.names)) return { ids: hit.ids, names: hit.names };
    const res = await appConfluence(route`/wiki/rest/api/user/memberof?accountId=${accountId}&limit=200`).catch(() => null);
    if (isRateLimited(res)) return RATE_LIMITED;
    if (!res?.ok) return null;
    const rows = (await res.json())?.results || [];
    const out = { ids: rows.map((g) => g?.id).filter(Boolean).map(String), names: rows.map((g) => g?.name).filter(Boolean).map(String) };
    if (out.ids.length <= MAX_CACHED_ENTRIES) await cachePut(key, { accountId, ...out }, CACHE_GRANT_TTL_MS);
    return out;
  });
}

/** `{ id, key }` of the space with exactly this key, RATE_LIMITED, or null (no such space, a failed read). */
async function spaceRefOf(spaceKey) {
  return invocationMemo(`space-ref|${spaceKey}`, async () => {
    const key = spaceIdCacheKey(spaceKey);
    const hit = await cacheGet(key);
    if (freshCached(hit, SPACE_ID_TTL_MS) && hit.key === spaceKey && hit.id) return { id: String(hit.id), key: spaceKey };
    const sres = await appConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`, { headers: { Accept: "application/json" } });
    if (isRateLimited(sres)) { console.warn(`[AUTHZ] space lookup ${spaceKey} -> 429; could not check (nothing granted)`); return RATE_LIMITED; }
    if (!sres.ok) { console.warn(`[AUTHZ] space lookup ${spaceKey} -> ${sres.status}; not a space admin`); return null; }
    const space = (await sres.json())?.results?.[0];
    if (!space?.id || space.key !== spaceKey) return null;
    await cachePut(key, { id: String(space.id), key: spaceKey }, SPACE_ID_TTL_MS);
    return { id: String(space.id), key: spaceKey };
  });
}

/**
 * Who Confluence lists with administer/space on this space: `{ users: [ids], groups: [ids] }`,
 * RATE_LIMITED, or null (any other failure, more than SPACE_PERMISSION_MAX_PAGES pages, a cursor
 * that does not advance before the end: "no" for everyone, as before).
 */
async function spaceAdminSetOf(space) {
  return invocationMemo(`space-admins|${space.id}`, async () => {
    const key = spaceAdminsCacheKey(space.id);
    const hit = await cacheGet(key);
    if (freshCached(hit, CACHE_GRANT_TTL_MS) && String(hit.spaceId) === String(space.id) && hit.spaceKey === space.key
      && Array.isArray(hit.users) && Array.isArray(hit.groups)) return { users: hit.users, groups: hit.groups };
    const JH = { headers: { Accept: "application/json" } };
    const users = new Set();
    const groups = new Set();
    let cursor = null;
    const seen = new Set();
    for (let page = 0; page < SPACE_PERMISSION_MAX_PAGES; page++) {
      const res = await appConfluence(
        cursor
          ? route`/wiki/api/v2/spaces/${space.id}/permissions?limit=${SPACE_PERMISSION_PAGE}&cursor=${cursor}`
          : route`/wiki/api/v2/spaces/${space.id}/permissions?limit=${SPACE_PERMISSION_PAGE}`,
        JH,
      );
      if (isRateLimited(res)) { console.warn(`[AUTHZ] space permissions ${space.key} -> 429; could not check (nothing granted)`); return RATE_LIMITED; }
      if (!res.ok) { console.warn(`[AUTHZ] space permissions ${space.key} -> ${res.status}; not a space admin`); return null; }
      const body = await res.json();
      for (const a of body?.results || []) {
        if (a?.operation?.key !== "administer" || a?.operation?.targetType !== "space" || !a?.principal?.id) continue;
        if (a.principal.type === "user") users.add(String(a.principal.id));
        else if (a.principal.type === "group") groups.add(String(a.principal.id));
        // a `role` principal is never resolved (see above): it grants nothing
      }
      cursor = nextCursorOf(body);
      if (!cursor) {
        const out = { users: [...users], groups: [...groups] };
        if (out.users.length + out.groups.length <= MAX_CACHED_ENTRIES) await cachePut(key, { spaceId: String(space.id), spaceKey: space.key, ...out }, CACHE_GRANT_TTL_MS);
        return out;
      }
      if (seen.has(cursor)) return null; // a cursor that does not advance: the list cannot be read whole
      seen.add(cursor);
    }
    console.warn(`[AUTHZ] space permissions ${space.key}: more than ${SPACE_PERMISSION_MAX_PAGES} pages; not a space admin`);
    return null;
  });
}

/**
 * `opts.memo` (newStewardMemo) shares the account reads across calls in one invocation;
 * `opts.spaceId` skips the key → id lookup and may ONLY be passed with the id and key of the same
 * space object the caller read from Confluence itself.
 */
export async function isAccountStewardAsApp(accountId, realmKey, opts = {}) {
  const s = await accountStewardStatusAsApp(accountId, realmKey, opts);
  if (s.unknown) noteAuthzUnknown();
  return s.steward;
}

/**
 * The same question with "could not tell" kept apart: `{ steward: boolean, unknown: boolean }`.
 * `unknown` is true only when the answer is no AND a read that could have said yes was refused with
 * 429. Callers that ACT on a "no" against someone (the page trigger reverting an edit) must treat
 * unknown as "judge nothing now"; nothing is ever granted on unknown.
 */
export async function accountStewardStatusAsApp(accountId, realmKey, { memo = null, spaceId = null } = {}) {
  if (!accountId) return NO_ANSWER;
  let realmConfig = null;
  let globalConfig = null;
  let limited = false;
  // 1. Explicitly-listed steward (KVS; works everywhere).
  try {
    const sanitized = String(realmKey || "").replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    realmConfig = await kvs.get(`admin-settings-space-${sanitized}`);
    globalConfig = await kvs.get("admin-settings-global");
    const list = realmConfig?.adminUsers || globalConfig?.adminUsers || [];
    if (list.some((o) => (typeof o === "string" ? o : o?.accountId) === accountId)) return YES_ANSWER;
  } catch (_) { /* fall through */ }
  // 2. Steward GROUP cohorts + site/org-admin — mirrors isOperatorSteward's cohort + site-admin
  //    arms, but via asApp() (no asUser context in a trigger). One user GET, expanded twice.
  try {
    const data = await memoized(memo, "user", accountId, () => readUserAsApp(accountId).catch(() => null));
    if (isLimited(data)) limited = true;
    else if (data) {
      const stewardGroups = realmConfig?.adminGroups || globalConfig?.adminGroups || [];
      if (stewardGroups.length > 0) {
        const userGroups = (data.groups?.results || []).map((g) => g.name);
        if (stewardGroups.some((g) => userGroups.includes(g))) return YES_ANSWER;
      }
      const ops = data.operations || [];
      if (ops.some((op) => op.operation === "administer" && op.targetType === "application")) return YES_ANSWER;
      // Asked as the app, `operations` can describe the APP's rights, not this account's, so a site
      // admin read as "no" (tester 2026-09-30: an admin got no Approve/Deny in a personal space).
      // Confluence's own admin groups name the account itself.
      if ((data.groups?.results || []).some((g) => isAdminGroupName(g.name))) return YES_ANSWER;
    }
  } catch (_) { /* fall through */ }
  // 2b. The user's group list read on its own (the expand above can come back empty for an app).
  //     Its ids are kept for arm 3, which matches group principals by id.
  let groupIds = null;
  try {
    const groups = await accountGroupsOf(accountId, memo);
    if (isLimited(groups)) limited = true;
    else if (groups) {
      if (groups.names.some((n) => isAdminGroupName(n))) return YES_ANSWER;
      groupIds = groups.ids;
    }
  } catch (_) { /* fall through */ }
  // 3. The space's own admins: Confluence lists the account (or one of its groups) with
  //    administer/space on the space: a direct permission, a group's, or a space ROLE where
  //    Confluence lists the role's holders as users and groups (it does on both measured sites).
  //    A `role` principal itself is never resolved (see below).
  const s = await spaceAdminStatus(accountId, realmKey, { groupIds: groupIds ?? (limited ? [] : null), spaceId, memo });
  if (s.admin) return YES_ANSWER;
  return limited || s.unknown ? UNKNOWN_ANSWER : NO_ANSWER;
}

const YES_ANSWER = Object.freeze({ steward: true, unknown: false });
const NO_ANSWER = Object.freeze({ steward: false, unknown: false });
const UNKNOWN_ANSWER = Object.freeze({ steward: false, unknown: true });

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
//
// 8.12.0: the list is read ONCE per space per minute for every account (spaceAdminSetOf, cached as
// the set of admin user and group ids), not once per account per check, and a 429 is "unknown".

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
 * thrown error, too many pages. A 429 is also "no" here, and is noted on the invocation so the
 * resolver says "try again" instead of "not allowed" (spaceAdminStatus tells them apart).
 */
export async function isSpaceAdministrator(accountId, spaceKey, opts = {}) {
  const s = await spaceAdminStatus(accountId, spaceKey, opts);
  if (s.unknown) noteAuthzUnknown();
  return s.admin;
}

/** `{ admin: boolean, unknown: boolean }`: unknown when a 429 kept Confluence from answering (admin is then false). */
export async function spaceAdminStatus(accountId, spaceKey, { groupIds = null, spaceId = null, memo = null } = {}) {
  if (!accountId || !spaceKey) return { admin: false, unknown: false };
  try {
    const space = spaceId ? { id: String(spaceId), key: spaceKey } : await spaceRefOf(spaceKey);
    if (isLimited(space)) return { admin: false, unknown: true };
    if (!space) return { admin: false, unknown: false };
    const set = await spaceAdminSetOf(space);
    if (isLimited(set)) return { admin: false, unknown: true };
    if (!set) return { admin: false, unknown: false };
    if (set.users.includes(String(accountId))) return { admin: true, unknown: false };
    if (!set.groups.length) return { admin: false, unknown: false };
    let ids = groupIds;
    if (ids == null) {
      const g = await accountGroupsOf(accountId, memo);
      if (isLimited(g)) return { admin: false, unknown: true };
      ids = g?.ids || []; // no group list: no group then grants
    }
    const mine = new Set(ids.filter(Boolean).map(String));
    return { admin: set.groups.some((gid) => mine.has(String(gid))), unknown: false };
  } catch (e) {
    console.error("[AUTHZ] space admin check threw; not a space admin:", e);
    return { admin: false, unknown: false };
  }
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
      const operatorResponse = await userConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=groups`,
      );
      if (isRateLimited(operatorResponse)) noteAuthzUnknown();

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
  // One answer per account per invocation (confluence-call.js): a banner refresh asks it from
  // several parts of the same resolver call.
  const s = await invocationMemo(`site-admin|${operatorAccountId}`, () => siteAdminStatus(operatorAccountId));
  if (s.unknown) noteAuthzUnknown();
  return s.admin;
}

async function siteAdminStatus(operatorAccountId) {
  try {
    let response = null;
    try {
      response = await userConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=operations`,
      );
    } catch (_) { response = null; }
    // No user session (the config-api queue consumer acting as the token's minter — see
    // shared/user-or-app.js): the same question, as the app, naming the SAME subject. That is
    // exactly isAccountStewardAsApp's arm 2, so it grants nothing that arm does not already.
    // A 429 is not asked again as the app: the pool is the app's either way.
    if (!response || (!response.ok && !isRateLimited(response))) {
      response = await appConfluence(
        route`/wiki/rest/api/user?accountId=${operatorAccountId}&expand=operations`,
      );
    }
    if (isRateLimited(response)) return { admin: false, unknown: true };

    if (response.ok) {
      const operatorData = await response.json();
      const operations = operatorData.operations || [];

      const hasStewardOps = operations.some(
        (op) =>
          op.operation === "administer" && op.targetType === "application",
      );

      return { admin: hasStewardOps, unknown: false };
    }

    return { admin: false, unknown: false };
  } catch (error) {
    console.error("Failed to check site admin status:", error);
    return { admin: false, unknown: false };
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

  // 8.12.0: the app's own lists first (storage, no points), the space's permissions only when they
  // do not already say yes.
  if (await isOperatorInStewardCohorts(operatorAccountId, realmKey)) return true;
  return isOperatorRealmSteward(operatorAccountId, realmKey);
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
