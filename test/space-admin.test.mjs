// Space admins as Confluence lists them (2026-10-17). The app's space-admin arm used to POST
// /wiki/rest/api/space/{key}/permission/check, which Confluence does not have (405 on every
// method), so a person who administers a space only through its permissions (directly, by a group,
// or by the space ROLE Admin) was an ordinary user: "Request admin access", no Approve as a space
// admin, edits to an Approved page treated like anyone's. Now: v2 /spaces/{id}/permissions.
//
// Every refusal below matters as much as the grants: this check GRANTS rights, so it must never
// read a role principal, another space, another operation, a failed call or a key mismatch as yes.
import "./_forge-fake/install.mjs";
import { eq, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const sc = await import("../src/server/shared/steward-checks.js");
const { kvs } = await import("@forge/kvs");
const { checkUserRole } = await import("../src/server/capsules/realms/actions.js");

const quiet = () => { console.warn = () => {}; console.error = () => {}; console.info = () => {}; };
quiet();

const ROLE_ADMIN = "acct-role-admin";
const GROUP_ADMIN = "acct-group-admin";
const EDITOR = "acct-collaborator";
const OTHER_ADMIN = "acct-admin-of-other-space";
const SPACE = { key: "POL", id: "77" };
const OTHER = { key: "OTH", id: "88" };
const row = (type, id, key = "administer", targetType = "space") => ({ id: `${type}-${id}-${key}`, principal: { type, id }, operation: { key, targetType } });

// ── pure core ──────────────────────────────────────────────────────────────────────────────────
// (fallbacks only so a run against the pre-fix module reports every red line instead of crashing)
const g = sc.grantsSpaceAdminister || (() => null);
eq("user principal with administer/space grants", g([row("user", "u1")], "u1"), true);
eq("another user's administer does not", g([row("user", "u2")], "u1"), false);
eq("group administer grants a member", g([row("group", "g1")], "u1", ["g1"]), true);
eq("group administer does not grant a non-member", g([row("group", "g1")], "u1", ["g2"]), false);
eq("a role principal never grants (not resolvable without a scope we lack)", g([row("role", "u1")], "u1", ["u1"]), false);
eq("read/update rows never grant", g([row("user", "u1", "read"), row("user", "u1", "update")], "u1"), false);
eq("administer on another target type does not grant", g([row("user", "u1", "administer", "application")], "u1"), false);
eq("malformed rows do not grant", g([null, {}, { principal: { type: "user" }, operation: { key: "administer", targetType: "space" } }], "u1"), false);
eq("no account never grants", g([row("user", "")], ""), false);
eq("not an array never grants", g({ results: [row("user", "u1")] }, "u1"), false);
eq("next cursor read from _links.next", (sc.nextCursorOf || (() => undefined))({ _links: { next: "/wiki/api/v2/spaces/1/permissions?limit=250&cursor=abc%3D%3D" } }), "abc==");
eq("no next link, no cursor", (sc.nextCursorOf || (() => undefined))({ _links: {} }), null);

// ── a Confluence like the real one ─────────────────────────────────────────────────────────────
function world({ permissionsStatus = 200, spaceLookupStatus = 200, keyCase = null, roleOnly = false, stuckCursor = false, endless = false } = {}) {
  resetFake();
  const filler = Array.from({ length: 300 }, (_, i) => row("user", `reader-${i}`, "read"));
  const lists = {
    [SPACE.id]: roleOnly
      ? [...filler, row("role", ROLE_ADMIN), row("role", "6820786b"), row("user", EDITOR, "update")]
      : [...filler, row("user", EDITOR, "update"), row("user", ROLE_ADMIN), row("group", "gid-policy-owners")],
    [OTHER.id]: [row("user", OTHER_ADMIN)],
  };
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, qs = ""] = path.split("?");
    const q = Object.fromEntries(qs.split("&").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    let m;
    if (/^\/wiki\/rest\/api\/space\/[^/]+\/permission\/check$/.test(base)) return { status: 405, body: {} }; // measured
    if (base === "/wiki/rest/api/user") return { body: { accountId: q.accountId, groups: { results: [] }, operations: [] } };
    if (base === "/wiki/rest/api/user/memberof") {
      return { body: { results: q.accountId === GROUP_ADMIN ? [{ name: "policy-owners", id: "gid-policy-owners" }] : [{ name: "confluence-users", id: "gid-users" }] } };
    }
    if (base === "/wiki/api/v2/spaces" && method === "GET") {
      if (spaceLookupStatus !== 200) return { status: spaceLookupStatus, body: {} };
      const s = [SPACE, OTHER].find((x) => x.key === q.keys);
      return { body: { results: s ? [{ id: s.id, key: keyCase ? s.key.toLowerCase() : s.key }] : [] } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)\/permissions$/)) && method === "GET") {
      if (permissionsStatus !== 200) return { status: permissionsStatus, body: {} };
      const rows = lists[m[1]] || [];
      const limit = Number(q.limit) || 25;
      const from = Number(q.cursor) || 0;
      if (endless) return { body: { results: [row("user", `x-${from}`, "read")], _links: { next: `/wiki/api/v2/spaces/${m[1]}/permissions?limit=${limit}&cursor=${from + 1}` } } };
      const next = stuckCursor ? `/wiki/api/v2/spaces/${m[1]}/permissions?limit=${limit}&cursor=0`
        : from + limit < rows.length ? `/wiki/api/v2/spaces/${m[1]}/permissions?limit=${limit}&cursor=${from + limit}` : null;
      return { body: { results: rows.slice(from, from + limit), _links: next ? { next } : {} } };
    }
    return undefined;
  });
}

world();
// RED before the fix: the old arm asked the 405 endpoint, so all of these were false.
eq("a space-role admin is a steward to the trigger/sweep check (admin listed on page 2)", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), true);
eq("a space-role admin is a realm steward", await sc.isOperatorRealmSteward(ROLE_ADMIN, SPACE.key), true);
eq("a space-role admin is a steward (site admin no, cohorts no, space yes)", await sc.isOperatorSteward(ROLE_ADMIN, SPACE.key), true);
eq("check-user-role answers steward (no 'Request admin access')", (await checkUserRole({ payload: { spaceKey: SPACE.key }, context: { accountId: ROLE_ADMIN } }))?.role, "steward");
eq("an admin through a group that holds administer is a steward", await sc.isAccountStewardAsApp(GROUP_ADMIN, SPACE.key), true);
eq("the dead endpoint is not called any more", fake.calls.some((c) => c.path.includes("/permission/check") && c.path.includes("/space/")), false);
// Refusals.
eq("a collaborator (update only) is not", await sc.isAccountStewardAsApp(EDITOR, SPACE.key), false);
eq("check-user-role answers user for a collaborator", (await checkUserRole({ payload: { spaceKey: SPACE.key }, context: { accountId: EDITOR } }))?.role, "user");
eq("an admin of ANOTHER space is not an admin here", await sc.isAccountStewardAsApp(OTHER_ADMIN, SPACE.key), false);
eq("...and is one there (the check is per space)", await sc.isAccountStewardAsApp(OTHER_ADMIN, OTHER.key), true);
eq("the role admin of POL is not an admin of OTH", await sc.isOperatorRealmSteward(ROLE_ADMIN, OTHER.key), false);
eq("an unknown space key is no", await (sc.isSpaceAdministrator || (async () => null))(ROLE_ADMIN, "NOPE"), false);
eq("no space key is no", await (sc.isSpaceAdministrator || (async () => null))(ROLE_ADMIN, ""), false);
eq("no account is no", await sc.isAccountStewardAsApp("", SPACE.key), false);
world({ permissionsStatus: 401 });
eq("permissions 401 → no", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
world({ permissionsStatus: 500 });
eq("permissions 500 → no", await sc.isOperatorRealmSteward(ROLE_ADMIN, SPACE.key), false);
world({ spaceLookupStatus: 403 });
eq("space lookup refused → no", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
world({ keyCase: true });
eq("a space whose key does not match exactly → no", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
world({ roleOnly: true });
eq("a role principal is never resolved into a yes", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
world({ stuckCursor: true });
eq("a cursor that does not advance ends the walk with no (admin sits past it)", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
world({ endless: true });
eq("more than 20 pages → no", await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), false);
eq("...after at most 20 permission pages", fake.calls.filter((c) => c.path.includes("/permissions")).length, 20);
// One invocation, many spaces: the memo reads the account once; spaceId skips the key lookup.
world();
const memo = sc.newStewardMemo ? sc.newStewardMemo() : null;
const many = [];
for (let i = 0; i < 5; i++) many.push(await sc.isAccountStewardAsApp(GROUP_ADMIN, SPACE.key, { memo, spaceId: SPACE.id }));
eq("memo: the answer is the same every time", many, [true, true, true, true, true]);
eq("memo: the user record is read once", fake.calls.filter((c) => c.path.startsWith("/wiki/rest/api/user?")).length, 1);
eq("memo: the group list is read once", fake.calls.filter((c) => c.path.startsWith("/wiki/rest/api/user/memberof")).length, 1);
eq("spaceId given: no key lookup", fake.calls.filter((c) => c.path.startsWith("/wiki/api/v2/spaces?")).length, 0);
world();
eq("without spaceId the key is looked up", (await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key), fake.calls.filter((c) => c.path.startsWith("/wiki/api/v2/spaces?")).length), 1);
// A failed read is not memoized: the next space asks again.
{
  resetFake();
  let groupCalls = 0;
  onConfluence((method, rawPath) => {
    const [base] = decodeURIComponent(rawPath).split("?");
    if (base === "/wiki/rest/api/user") return { status: 500, body: {} };
    if (base === "/wiki/rest/api/user/memberof") { groupCalls++; return groupCalls === 1 ? { status: 429, body: {} } : { body: { results: [{ name: "policy-owners", id: "gid-policy-owners" }] } }; }
    if (/\/wiki\/api\/v2\/spaces\/77\/permissions$/.test(base)) return { body: { results: [row("group", "gid-policy-owners")], _links: {} } };
    return undefined;
  });
  const m2 = sc.newStewardMemo ? sc.newStewardMemo() : null;
  const first = await sc.isAccountStewardAsApp(GROUP_ADMIN, SPACE.key, { memo: m2, spaceId: SPACE.id });
  const second = await sc.isAccountStewardAsApp(GROUP_ADMIN, SPACE.key, { memo: m2, spaceId: SPACE.id });
  eq("memo: a 429 on the group read is not kept: the next read retries and the group admin is recognised", [first, second], [true, true]);
  eq("memo: two group reads (the failed one, then one shared by everything after)", groupCalls, 2);
}
// mapLimited (the one shared copy)
const { mapLimited } = await import("../src/server/shared/map-limited.js");
let inFlight = 0, peak = 0;
const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n, i) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, n)); inFlight--; return `${i}:${n}`; });
eq("mapLimited keeps input order", out, ["0:5", "1:1", "2:4", "3:2", "4:3"]);
eq("mapLimited never exceeds the limit", peak <= 2, true);
eq("mapLimited of nothing", await mapLimited([], 3, async () => 1), []);
// The app's own admin list and group arms are unchanged.
world();
await kvs.set(`admin-settings-space-${SPACE.key}`, { adminUsers: [{ accountId: EDITOR }] });
eq("a listed Sentinel Vault admin still is one", await sc.isAccountStewardAsApp(EDITOR, SPACE.key), true);
// 8.16: a read with no answer (5xx) is "no" for the ordinary check, as before, but is NOT kept: the
// next check in the same invocation asks again (review round 4: a kept failure turned every space
// admin into "no" for a minute). Strict mode reports it as unknown, never as a proven "no"; a 4xx is
// still a definite "no" even in strict mode.
{
  const { runInvocation } = await import("../src/server/shared/confluence-call.js");
  const { cacheKeyOf } = sc;
  // The first `n` matching calls answer 503 (a 5xx is not retried by the door).
  const failOnce = (match, n = 1) => { let left = n; onConfluence((method, rawPath) => (left > 0 && match(decodeURIComponent(rawPath)) ? ((left -= 1), { status: 503, body: {} }) : undefined)); };
  const clearCache = async () => { for (const k of await kvs.query().where("key", (await import("@forge/kvs")).WhereConditions.beginsWith("authz-")).limit(100).getMany().then((r) => (r.results || []).map((x) => x.key)).catch(() => [])) await kvs.delete(k); };
  world(); await clearCache();
  failOnce((p) => /\/wiki\/api\/v2\/spaces\/\d+\/permissions/.test(p));
  const [a, b] = await runInvocation(async () => [await sc.isAccountStewardAsApp(EDITOR, SPACE.key), await sc.isAccountStewardAsApp(ROLE_ADMIN, SPACE.key)]);
  eq("a 503 on the space's permission list is not kept: the next admin checked in the same call is still an admin", b, true);
  eq("(and the collaborator checked during the 503 is still not one)", a, false);
  world(); await clearCache();
  failOnce((p) => p.startsWith("/wiki/rest/api/user/memberof") && p.includes(GROUP_ADMIN), 2); // both reads of the first check
  const memo = sc.newStewardMemo();
  const first = await sc.accountStewardStatusAsApp(GROUP_ADMIN, SPACE.key, { memo });
  const second = await sc.accountStewardStatusAsApp(GROUP_ADMIN, SPACE.key, { memo });
  eq("a 503 on the group list is not kept in an explicit memo: the next check finds the group admin", second.steward, true);
  eq("(the check during the 503 was a plain no, not a yes)", first.steward, false);
  world({ permissionsStatus: 503 }); await clearCache();
  eq("strict: a 503 is 'could not tell'", (await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key, { strict: true })).unknown, true);
  eq("non-strict: a 503 is still a plain no", (await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key)).unknown, false);
  world({ endless: true }); await clearCache();
  eq("strict: a permission list too long to read whole is 'could not tell'", (await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key, { strict: true })).unknown, true);
  eq("non-strict: the same is still a plain no", JSON.stringify(await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key)), JSON.stringify({ steward: false, unknown: false }));
  world({ stuckCursor: true }); await clearCache();
  eq("strict: a cursor that does not advance is 'could not tell'", (await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key, { strict: true })).unknown, true);
  world(); await clearCache();
  onConfluence((method, rawPath) => (decodeURIComponent(rawPath).startsWith("/wiki/rest/api/user/memberof") ? { body: { results: Array.from({ length: 200 }, (_, i) => ({ name: `g${i}`, id: `gid-${i}` })) } } : undefined));
  eq("strict: a full page of 200 groups without the admin group is 'could not tell'", (await sc.accountStewardStatusAsApp(EDITOR, SPACE.key, { strict: true })).unknown, true);
  world({ permissionsStatus: 403 }); await clearCache();
  eq("strict: a 403 is still a definite no", JSON.stringify(await sc.accountStewardStatusAsApp(ROLE_ADMIN, SPACE.key, { strict: true })), JSON.stringify({ steward: false, unknown: false }));
}
report("space-admin");
