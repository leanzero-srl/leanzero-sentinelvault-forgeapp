// Confluence's rate limit (2026-10-18 incident, fixed in 8.12.0).
//
// Confluence meters apps in points per hour, and the default pool is SHARED by every site the app
// is on. 8.10.0's space-admin check read the space's whole permission list (~375 points on POLICY)
// from every one of the ~6 resolvers a banner refresh runs, so ~28 refreshes an hour spent the pool
// for every customer; then a 429 was read as "not a space admin", and the group list was fetched
// twice on failure. These scenarios drive the REAL server modules on the in-memory Forge fake and
// count what reaches Confluence:
//
//   A. one banner refresh asks Confluence for the space's admins at most once; the next refresh
//      inside a minute not at all; a minute later once again
//   B. a 429 is retried when Confluence says how long to wait, never waited out when the wait is a
//      spent hourly quota, and never turns into "not an admin": a gated action says "try again", the
//      Approve/Deny check says "couldn't check", an admin's edit to an Approved page is not undone,
//      the group list is asked once and says it could not load
//   C. the cache cannot grant what Confluence no longer says: never past 60 s, never from a time in
//      the future, never for another account or another space, never from a 429
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const { kvs } = await import("@forge/kvs");
const sc = await import("../src/server/shared/steward-checks.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const approvals = await import("../src/server/capsules/workflow/approvals.js");
const triggers = await import("../src/server/triggers.js");
const { wrappedActions } = await import("../src/server/registry.js");
// The door (8.12.0). Loaded softly so a run against the pre-fix tree reports every red line.
let door = {};
try { door = await import("../src/server/shared/confluence-call.js"); } catch (_) { door = {}; }

const actions = new Map(wrappedActions);
const call = (key, req) => {
  const fn = actions.get(key);
  return fn ? fn(req) : Promise.resolve(undefined);
};

const APP = "app-account";
const ADMIN = "acct-space-admin";
const PLAIN = "acct-plain-viewer";
const APPROVER = "acct-approver";
const REQUESTER = "acct-requester";
const SPACE = "WF";
const SPACE_ID = "9001";
const PAGE = "501";

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const warnings = [];
const quiet = () => { console.info = () => {}; console.log = () => {}; console.error = () => {}; console.warn = (...a) => warnings.push(a.join(" ")); };
quiet();

const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

const permissionReads = () => fake.calls.filter((c) => /^\/wiki\/api\/v2\/spaces\/[^/?]+\/permissions/.test(c.path)).length;
const keyLookups = () => fake.calls.filter((c) => c.path.startsWith("/wiki/api/v2/spaces?")).length;
const callsTo = (re) => fake.calls.filter((c) => re.test(decodeURIComponent(c.path))).length;

// 429 switches, checked AFTER the world's own routes (later handlers answer first).
let limit = { permissions: null, groups: null, picker: null, versions: null };
function installLimits() {
  // Handlers answer last-registered first: the plain answers go in first, the 429 switch last.
  onConfluence((method, rawPath) => {
    const base = decodeURIComponent(rawPath).split("?")[0];
    if (base === "/rest/api/group") return { body: { results: [{ name: "policy-owners" }], _links: {} } };
    if (base === "/wiki/rest/api/group/picker") return { body: { results: [{ id: "gid-x", name: "x" }] } };
    return undefined;
  });
  onConfluence((method, rawPath) => {
    const base = decodeURIComponent(rawPath).split("?")[0];
    const pick = /^\/wiki\/api\/v2\/spaces\/[^/]+\/permissions$/.test(base) ? "permissions"
      : base === "/rest/api/group" ? "groups"
        : base === "/wiki/rest/api/group/picker" ? "picker"
          : /^\/wiki\/api\/v2\/pages\/[^/]+\/versions$/.test(base) ? "versions" : null;
    if (!pick || !limit[pick]) return undefined;
    const l = limit[pick];
    if (typeof l.times === "number") { if (l.times <= 0) return undefined; l.times -= 1; }
    return { status: 429, body: "<!doctype html><html><head><title>HTTP Status 429 – Too Many Requests</title></head></html>", headers: l.headers || {} };
  });
}

/** A page with a workflow in In Review and an approval request open; ADMIN administers the space. */
async function bed({ pending = true } = {}) {
  resetFake();
  clockOffset = 0;
  limit = { permissions: null, groups: null, picker: null, versions: null };
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE, spaceId: SPACE_ID });
  w.addUser(APP, { displayName: "Sentinel Vault" })
    .addUser(ADMIN, { displayName: "Sam Admin" })
    .addUser(PLAIN, { displayName: "Pat Plain" })
    .addUser(APPROVER, { displayName: "Ana Approver" })
    .addUser(REQUESTER, { displayName: "Rae Requester" })
    .addPage(PAGE, { versions: [{ authorId: REQUESTER, text: "draft" }] });
  // The real list is long: the admins sit among a couple of hundred read/update rows.
  for (let i = 0; i < 180; i++) w.addUser(`reader-${i}`, { displayName: `Reader ${i}` });
  w.spaceAdmins.add(ADMIN);
  w.readers.add("*");
  installLimits();
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, autoAssignNew: false, workflowId: "default", demoteTo: "initial", enforceMode: "revert",
    approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1, adminsCanApprove: true },
    reviewAfterDaysByState: {}, syncLabels: false, labelWorkflows: [],
  });
  const asg = await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: REQUESTER, actorName: "Rae Requester", workflowId: "default" });
  if (!asg.success) throw new Error(`assign failed: ${asg.reason}`);
  const rev = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: REQUESTER, actorName: "Rae Requester" });
  if (!rev.success) throw new Error(`in_review failed: ${rev.reason}`);
  if (pending) {
    const r = await approvals.requestApprovalTransition({ pageId: PAGE, toStateId: "approved", toStateName: "Approved", spaceKey: SPACE, approvers: [APPROVER], mode: "any", min: 1, actorAccountId: REQUESTER, actorName: "Rae Requester", pinnedVersion: 1 });
    if (r && r.success === false) throw new Error(`request failed: ${r.reason}`);
  }
  fake.calls.length = 0;
  warnings.length = 0;
  return w;
}

const onPage = (accountId, payload = {}) => ({
  payload: { pageId: PAGE, spaceKey: SPACE, ...payload },
  context: { accountId, extension: { content: { id: PAGE, type: "page", space: { key: SPACE } }, space: { key: SPACE } } },
});

/** One banner refresh as the banner makes it: ribbon-evaluate (8.12.0), else the six parts it replaced. */
async function bannerRefresh(accountId) {
  const req = onPage(accountId);
  if (actions.has("ribbon-evaluate")) return call("ribbon-evaluate", req);
  const keys = ["ribbon-summary", "get-page-workflow", "get-page-approvals", "recent-dispatches", "get-validation-state", "get-ai-findings"];
  const out = await Promise.all(keys.map((k) => call(k, { ...req, payload: k === "get-page-workflow" || k === "get-page-approvals" ? req.payload : { pageId: PAGE } })));
  return { summary: out[0], workflow: out[1], approvals: out[2] };
}

try {
  // ── A. what one banner refresh costs ────────────────────────────────────────────────────────
  {
    await bed();
    ok("the banner has ONE resolver for its whole evaluation (ribbon-evaluate)", actions.has("ribbon-evaluate"));
    const r1 = await bannerRefresh(PLAIN);
    eq("refresh 1 (cold): the space's admin list is read at most once", permissionReads() <= 1, true);
    eq("refresh 1: the space key is looked up at most once", keyLookups() <= 1, true);
    eq("refresh 1: the workflow part answered", r1?.workflow?.assigned, true);
    eq("refresh 1: the approvals part answered (pending)", r1?.approvals?.pending, true);
    eq("refresh 1: a plain viewer may not decide", r1?.approvals?.adminCanDecide, false);
    eq("refresh 1: and that is a known no, not a couldn't-check", r1?.approvals?.adminCheck, undefined);
    fake.calls.length = 0;
    const r2 = await bannerRefresh(ADMIN);
    eq("refresh 2 (another viewer, inside a minute): the admin list is NOT read again", permissionReads(), 0);
    eq("refresh 2: the space admin may decide (from the cached list)", r2?.approvals?.adminCanDecide, true);
    eq("refresh 2: the space admin may set the review date", r2?.workflow?.canSetReviewDue, true);
    fake.calls.length = 0;
    await bannerRefresh(PLAIN);
    eq("refresh 3 inside a minute: still no admin-list read", permissionReads(), 0);
    clockOffset = 61_000;
    fake.calls.length = 0;
    await bannerRefresh(PLAIN);
    eq("a minute later the list is read again, once", permissionReads(), 1);
    // Six separate resolver calls (another surface, an old banner) share the cache across invocations.
    clockOffset = 200_000;
    fake.calls.length = 0;
    for (const k of ["get-page-workflow", "get-page-approvals", "get-page-workflow", "get-page-approvals"]) await call(k, onPage(PLAIN));
    eq("four separate resolver invocations: one admin-list read between them", permissionReads(), 1);
  }

  // ── B. a 429 is not a "no" ──────────────────────────────────────────────────────────────────
  {
    await bed();
    limit.permissions = { times: 1, headers: { "Retry-After": "1", "RateLimit-Reason": "confluence-quota-tenant-based" } };
    const t0 = realNow();
    const yes = await sc.isSpaceAdministrator(ADMIN, SPACE);
    eq("a short Retry-After is waited and the read retried: the admin is recognised", yes, true);
    eq("...after exactly two reads", permissionReads(), 2);
    ok("...having waited at least the Retry-After", realNow() - t0 >= 1000);
    ok("the 429 is logged with RateLimit-Reason", warnings.some((w) => w.includes("429") && w.includes("confluence-quota-tenant-based")));
  }
  {
    await bed();
    limit.permissions = { headers: { "Retry-After": "1800", "RateLimit-Reason": "confluence-quota-global-based", "X-RateLimit-Reset": new Date(realNow() + 1_800_000).toISOString() } };
    const t0 = realNow();
    const st = sc.spaceAdminStatus ? await sc.spaceAdminStatus(ADMIN, SPACE) : { admin: await sc.isSpaceAdministrator(ADMIN, SPACE) };
    eq("a spent hourly quota: the answer is UNKNOWN, not no", st, { admin: false, unknown: true });
    ok("...answered at once (an 1800 s Retry-After is not waited out)", realNow() - t0 < 1500);
    eq("...one read (no retry against a spent quota)", permissionReads(), 1);
    ok("...logged with the global-pool reason and the reset", warnings.some((w) => w.includes("confluence-quota-global-based") && w.includes("reset=")));
    eq("an unknown answer is never stored", fake.kvs.has(`authz-space-admins-${SPACE_ID}`), false);
    // A gated action as the space admin: refused (nothing granted), but told the truth.
    const before = JSON.stringify(await logic.readPageWorkflow(PAGE));
    const res = await call("set-review-due", onPage(ADMIN, { reviewDueAt: new Date(realNow() + 86_400_000).toISOString() }));
    eq("the gated action is refused (never granted on a 429)", res?.success, false);
    eq("...and says Confluence was busy", res?.busy, true);
    ok("...with a try-again message", /limiting requests/.test(res?.reason || "") && /Try again/.test(res?.reason || ""));
    ok("...never 'only a space admin'", !/Only a space admin/.test(res?.reason || ""));
    eq("...keeping the refusal it fell back to", res?.deniedReason, "Only a space admin can change the review date");
    eq("...and changing nothing", JSON.stringify(await logic.readPageWorkflow(PAGE)), before);
    // The display check: Approve/Deny for a space admin who is not a listed approver.
    const appr = await call("get-page-approvals", onPage(ADMIN));
    eq("Approve/Deny: not offered on a 429", appr?.adminCanDecide, false);
    eq("Approve/Deny: the banner is told the check could not run", appr?.adminCheck, "unknown");
    // Quota back: the next check reads again (no unknown was cached) and answers yes.
    limit.permissions = null;
    fake.calls.length = 0;
    eq("after the 429 clears, the admin is recognised", await sc.isSpaceAdministrator(ADMIN, SPACE), true);
    eq("...from a fresh read", permissionReads(), 1);
    // A plain viewer's refusal is a refusal, not "busy", when Confluence answered.
    const plainRes = await call("set-review-due", onPage(PLAIN, { reviewDueAt: new Date(realNow() + 86_400_000).toISOString() }));
    eq("a plain viewer is refused as before", [plainRes?.success, plainRes?.busy, plainRes?.reason], [false, undefined, "Only a space admin can change the review date"]);
  }
  {
    // The page trigger: a space admin edits an Approved page while Confluence answers 429.
    await bed({ pending: false });
    const w = await (async () => {
      const t = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver", approvers: [APPROVER], approvedVersion: 1,
        approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana Approver", pinnedVersion: 1, decisions: [] } });
      if (!t.success) throw new Error(`approve failed: ${t.reason}`);
      return null;
    })();
    void w;
    limit.permissions = { headers: { "Retry-After": "1800", "RateLimit-Reason": "confluence-quota-global-based" } };
    const probe = await triggers.collectWorkflowEnforcementForPage(PAGE, ADMIN, 2, APP, SPACE);
    eq("an admin's edit while Confluence is limiting: judged unknown (no revert, no demote)", probe?.action, "unknown");
    limit.permissions = null;
    const probe2 = await triggers.collectWorkflowEnforcementForPage(PAGE, ADMIN, 2, APP, SPACE);
    eq("...and privileged once Confluence answers", probe2?.action, "privileged");
    const plainProbe = await triggers.collectWorkflowEnforcementForPage(PAGE, PLAIN, 2, APP, SPACE);
    eq("a plain editor is still reverted when Confluence answered", plainProbe?.action, "revert");
  }
  {
    // The group list for the steward-groups picker: asked once, and a 429 is said as such.
    await bed();
    limit.groups = { headers: { "Retry-After": "1800" } };
    const r = await call("enumerate-teams", { payload: { start: 0, limit: 200 }, context: { accountId: ADMIN, extension: { space: { key: SPACE } } } });
    eq("the group list is requested ONCE on failure (no identical 'fallback')", callsTo(/^\/rest\/api\/group(\?|$)/), 1);
    eq("...and says it could not load", r?.unavailable, true);
    ok("...with a try-again message", /limiting requests/.test(r?.reason || ""));
    // The approver picker as the space admin while the steward check is rate-limited.
    limit.permissions = { headers: { "Retry-After": "1800" } };
    const p = await call("search-workflow-groups", { payload: { query: "pol" }, context: { accountId: ADMIN, extension: { space: { key: SPACE } } } });
    eq("approver picker: no results while the check could not run", p?.groups, []);
    eq("approver picker: says it could not search right now", p?.unavailable, true);
    eq("approver picker: no directory search was made without the check", callsTo(/^\/wiki\/rest\/api\/group\/picker/), 0);
  }

  // ── C. the cache never grants past what Confluence says ─────────────────────────────────────
  {
    const w = await bed();
    eq("admin: yes", await sc.isSpaceAdministrator(ADMIN, SPACE), true);
    eq("another account on the same cached list: no", await sc.isSpaceAdministrator(PLAIN, SPACE), false);
    w.spaceAdmins.delete(ADMIN);
    clockOffset = 30_000;
    eq("removed in Confluence, 30 s later: still yes (inside the documented minute)", await sc.isSpaceAdministrator(ADMIN, SPACE), true);
    clockOffset = 61_000;
    eq("removed in Confluence, 61 s later: no", await sc.isSpaceAdministrator(ADMIN, SPACE), false);
    // Stored answers that must not be trusted.
    const forge = async (value) => { await kvs.set(`authz-space-admins-${SPACE_ID}`, value); };
    clockOffset = 0;
    await forge({ spaceId: SPACE_ID, spaceKey: SPACE, users: [PLAIN], groups: [], at: Date.now() - 61_000 });
    eq("a stored list older than a minute is not used", await sc.isSpaceAdministrator(PLAIN, SPACE), false);
    await forge({ spaceId: SPACE_ID, spaceKey: SPACE, users: [PLAIN], groups: [], at: Date.now() + 3_600_000 });
    eq("a stored list dated in the future is not used", await sc.isSpaceAdministrator(PLAIN, SPACE), false);
    await forge({ spaceId: SPACE_ID, spaceKey: "OTHER", users: [PLAIN], groups: [], at: Date.now() });
    eq("a stored list for another space key is not used", await sc.isSpaceAdministrator(PLAIN, SPACE), false);
    await forge({ spaceId: SPACE_ID, spaceKey: SPACE, users: [PLAIN], groups: [] });
    eq("a stored list with no time is not used", await sc.isSpaceAdministrator(PLAIN, SPACE), false);
    // Groups: a cached group list for one account never answers for another.
    await kvs.set(`authz-groups-${sc.kvsPart ? sc.kvsPart(PLAIN) : PLAIN}`, { accountId: ADMIN, ids: ["gid-admins"], names: ["site-admins"], at: Date.now() });
    eq("a group list stored under one account but naming another is not used", await sc.isAccountStewardAsApp(PLAIN, SPACE), false);
  }
  {
    // Inside ONE long invocation (a 15-minute queue consumer) the memo is bounded the same way.
    const w = await bed();
    if (door.runInvocation) {
      const seen = await door.runInvocation(async () => {
        const a = await sc.isSpaceAdministrator(ADMIN, SPACE);
        w.spaceAdmins.delete(ADMIN);
        clockOffset = 61_000;
        const b = await sc.isSpaceAdministrator(ADMIN, SPACE);
        return [a, b];
      }, { budgetMs: 900_000 });
      eq("a long invocation re-asks after a minute", seen, [true, false]);
      // A cached list already 59 s old is not kept another minute by the memo (review 2026-10-18).
      const w2 = await bed();
      clockOffset = 0;
      await kvs.set(`authz-space-admins-${SPACE_ID}`, { spaceId: SPACE_ID, spaceKey: SPACE, users: [ADMIN], groups: [], at: Date.now() - 59_000 });
      w2.spaceAdmins.delete(ADMIN);
      const seen2 = await door.runInvocation(async () => {
        const a = await sc.isSpaceAdministrator(ADMIN, SPACE);
        clockOffset = 2_000;
        const b = await sc.isSpaceAdministrator(ADMIN, SPACE);
        return [a, b];
      }, { budgetMs: 900_000 });
      eq("the memo expires with the cached answer's own time (59 s + 2 s > 60 s)", seen2, [true, false]);
    } else ok("runInvocation exists", false);
  }

  // ── D. an Approved page while Confluence cannot say who edited in between (review 2026-10-18) ──
  {
    const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
    const SID = "sec-429";
    const KEY = "app/env/static/sentinel-vault-sealed-section";
    const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
    const pageAdf = (intro, inside) => ({ version: 1, type: "doc", content: [para(intro), wrapper([para(inside)])] });
    const textOf = (adf) => JSON.stringify(adf);
    const approvedBed = async () => {
      const w = await bed({ pending: false });
      const p = w.pages.get(PAGE);
      p.versions[0].adf = pageAdf("approved intro", "SEALED TEXT");
      const body = [para("SEALED TEXT")];
      p.props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
      await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, lockedBy: REQUESTER, lockedByName: "Rae", contentHash: hashAdf(body), sectionTitle: "Sealed", expiresAt: new Date(Date.now() + 864e5).toISOString() });
      await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(body), bodyContent: body, hash: hashAdf(body), version: 1, originalIndex: 1 });
      const t = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver", approvers: [APPROVER], approvedVersion: 1,
        approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana Approver", pinnedVersion: 1, decisions: [] } });
      if (!t.success) throw new Error(`approve failed: ${t.reason}`);
      const save = (author, adf) => { p.versions.push({ number: p.versions.length + 1, authorId: author, adf }); return p.versions.length; };
      return { w, p, save };
    };
    const ev = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });
    {
      const { w, save } = await approvedBed();
      save(ADMIN, pageAdf("ADMIN'S SANCTIONED INTRO", "SEALED TEXT")); // its event never lands
      const v3 = save(PLAIN, pageAdf("PLAIN TAMPER", "TAMPERED SECTION"));
      limit.versions = { headers: { "Retry-After": "1800" } };
      await triggers.pageContentTrigger(ev(PLAIN, v3));
      eq("versions unreadable (429): the app writes nothing (no section restore carrying the tamper)", w.live(PAGE).authorId, PLAIN);
      eq("...and the tamper does not become the approved baseline", (await logic.readPageWorkflow(PAGE))?.approvedVersion, 1);
      limit.versions = null;
      await triggers.workflowSweep();
      const live = w.live(PAGE);
      eq("the hourly sweep (Confluence answering again) reverts the tamper", live.authorId, APP);
      ok("...to the space admin's sanctioned version, not past it", textOf(live.adf).includes("ADMIN'S SANCTIONED INTRO") && !textOf(live.adf).includes("PLAIN TAMPER"));
    }
    {
      const { w, save } = await approvedBed();
      save(ADMIN, pageAdf("ADMIN'S SANCTIONED INTRO", "SEALED TEXT"));
      save(PLAIN, pageAdf("PLAIN TAMPER", "TAMPERED SECTION"));
      limit.versions = { headers: { "Retry-After": "1800" } };
      await triggers.workflowSweep();
      eq("the sweep while the versions cannot be read: no revert this run", w.live(PAGE).authorId, PLAIN);
    }
  }

  // ── pure parts of the door ──────────────────────────────────────────────────────────────────
  {
    const d = door;
    eq("Retry-After seconds", d.parseRetryAfter?.("30"), 30);
    eq("Retry-After HTTP date", d.parseRetryAfter?.(new Date(1_000_000 + 12_000).toUTCString(), 1_000_000) <= 12, true);
    eq("no Retry-After", d.parseRetryAfter?.(null), null);
    eq("wait = Retry-After plus at most 30 %", (() => { const w = d.retryWaitMs?.({ retryAfterSeconds: 2 }, 0, () => 1); return w >= 2000 && w <= 2600; })(), true);
    eq("no Retry-After: jittered doubling from 500 ms", [d.retryWaitMs?.({}, 0, () => 0), d.retryWaitMs?.({}, 1, () => 1)], [350, 1300]);
    ok("busy reason in seconds", /in 30 seconds/.test(d.busyReason?.(28) || ""));
    ok("busy reason in minutes", /in about 30 minutes/.test(d.busyReason?.(1790) || ""));
    eq("log paths drop the query (account ids)", d.pathForLog?.("/wiki/rest/api/user?accountId=712020:abc"), "/wiki/rest/api/user");
    eq("call kinds for the per-invocation count", ["/wiki/api/v2/spaces/9/permissions?limit=250", "/wiki/rest/api/user/memberof?accountId=a", "/wiki/rest/api/user?accountId=a", "/rest/api/group?start=0", "/wiki/api/v2/spaces?keys=X", "/wiki/api/v2/pages/1"].map((p) => d.callKind?.(p)), ["perms", "groups", "users", "groups", "spaces", "other"]);
    if (d.runInvocation) {
      const lines = [];
      const prev = console.info;
      console.info = (...a) => lines.push(a.join(" "));
      await bed();
      console.info = (...a) => lines.push(a.join(" "));
      await call("get-page-approvals", onPage(PLAIN));
      console.info = prev;
      quiet();
      ok("a resolver invocation ends with one [CONFLUENCE] count line", lines.some((l) => /^\[CONFLUENCE\] get-page-approvals calls=\d+ perms=1 /.test(l)));
    }
    eq("KVS key parts are injective", new Set(["~a", "_a", "#7e.a", "~A"].map((s) => d.kvsPart?.(s) ?? sc.kvsPart?.(s))).size, 4);
  }
  // ── one door: no Confluence call bypasses it (so a 429 is always retried, logged and noted) ──
  {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../src/", import.meta.url).pathname;
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "ui") walk(p); } else if (/\.(m?js|jsx)$/.test(f)) files.push(p); } };
    walk(root);
    const bypass = files.filter((p) => !p.endsWith("shared/confluence-call.js"))
      .filter((p) => /\.requestConfluence\s*\(/.test(readFileSync(p, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")));
    eq("every backend Confluence call goes through shared/confluence-call.js", bypass.map((p) => p.slice(root.length)), []);
  }
} finally {
  Date.now = realNow;
  Object.assign(console, realLog);
}
report("confluence-rate-limit");
