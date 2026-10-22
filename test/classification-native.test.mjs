// Confluence's own classification levels (the native scheme), driven through the real resolvers
// against a fake that answers the way Confluence Cloud answered on a test site (2026-10-23):
//  - PUT /wiki/api/v2/pages/{id}/classification-level needs { id, status }; without status:
//    400 INVALID_REQUEST_BODY "status: must not be null". POST .../reset needs { status } (400 too).
//    The space default PUT takes { id } alone (204).
//  - GET /wiki/api/v2/pages/{id}/classification-level answers the level the page SHOWS: its own
//    level, else the space default (404 only when neither is set).
//  - Levels carry `order`, where 1 is the MOST sensitive (Atlassian: "The most sensitive
//    classification level should be ranked 1"), and `color` as a name (RED, BLUE, ...), not a hex.
// Before this file, setting or resetting a page's level on such a site always failed with HTTP 400,
// raising a level asked for a lowering reason (and lowering one did not), chips had no colour, and
// every page read "set on this page" even when it only followed the space default.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const actions = new Map((await import("../src/server/capsules/classification/actions.js")).actions);
const { createNativeProvider, isDowngrade } = await import("../src/server/capsules/classification/logic.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const ADMIN = "acct-site-admin";
const tag = (n) => `ari:cloud:platform::classification-tag/${n}`;
const HR = tag("hr"), R = tag("r"), I = tag("i"), P = tag("p");
// The test site's scheme, in the order Confluence returned it (not sorted).
const LEVELS = [
  { id: I, status: "PUBLISHED", name: "Internal", order: 3, description: "", color: "BLUE" },
  { id: R, status: "PUBLISHED", name: "Restricted", order: 2, description: "", color: "ORANGE" },
  { id: HR, status: "PUBLISHED", name: "Highly restricted", order: 1, description: "", color: "RED" },
  { id: P, status: "PUBLISHED", name: "Public", order: 4, description: "", color: "GREEN" },
];
const full = (id) => ({ ...LEVELS.find((l) => l.id === id) });
let spaceDefault = I; // the space's default level id, or null
let pageOwn = null; // the page's own level id, or null
const bad = (title) => ({ status: 400, body: { errors: [{ status: 400, code: "INVALID_REQUEST_BODY", title, detail: null }] } });

function world() {
  resetFake();
  spaceDefault = I; pageOwn = null;
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base] = path.split("?");
    if (base === "/wiki/rest/api/user" && path.includes(ADMIN)) return { body: { accountId: ADMIN, operations: [{ operation: "administer", targetType: "application" }] } };
    if (base === "/wiki/api/v2/classification-levels") return { body: LEVELS };
    if (base === "/wiki/api/v2/spaces/11/classification-level/default") {
      if (method === "GET") return spaceDefault ? { body: full(spaceDefault) } : { status: 404, body: { errors: [{ status: 404, code: "NOT_FOUND" }] } };
      if (method === "DELETE") { spaceDefault = null; return { status: 204 }; }
      if (method === "PUT") { if (!body?.id) return bad("id: must not be null"); spaceDefault = body.id; return { status: 204 }; }
    }
    if (base === "/wiki/api/v2/pages/900/classification-level") {
      if (method === "GET") { const id = pageOwn || spaceDefault; return id ? { body: full(id) } : { status: 404, body: { errors: [{ status: 404, code: "NOT_FOUND" }] } }; }
      if (method === "PUT") {
        if (body?.status == null) return bad("status: must not be null");
        if (body.status !== "current") return bad("status: unexpected");
        // Measured: a level less sensitive (higher order) than the space default is refused.
        const rank = (id) => LEVELS.find((l) => l.id === id)?.order;
        if (spaceDefault && rank(body.id) > rank(spaceDefault)) return { status: 400, body: { errors: [{ status: 400, code: "BAD_REQUEST", title: `Level with ID ${body.id} is not permitted for the content`, detail: null }] } };
        pageOwn = body.id; return { status: 204 };
      }
    }
    if (base === "/wiki/api/v2/pages/900/classification-level/reset" && method === "POST") {
      if (body == null) return { status: 400, body: { errors: [{ status: 400, code: "INVALID_MESSAGE", title: "Invalid message" }] } };
      if (body.status == null) return bad("status: must not be null");
      pageOwn = null; return { status: 204 };
    }
    if (base === "/wiki/api/v2/spaces/11") return { body: { id: "11", key: "KEY", name: "Key space" } };
    if (base === "/wiki/api/v2/spaces" && path.includes("keys=KEY")) return { body: { results: [{ id: "11", key: "KEY" }] } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: [{ id: "11", key: "KEY", name: "Key space", type: "global" }], _links: {} } };
    if (base === "/wiki/api/v2/pages/900") return { body: { id: "900", spaceId: "11", title: "P", status: "current" } };
    if (base === "/wiki/rest/api/content/900/permission/check") return { body: { hasPermission: true } };
    return undefined;
  });
}
const call = (key, payload) => runInvocation(() => actions.get(key)({ context: { accountId: ADMIN }, payload }));
const setup = async () => { world(); await kvs.set("admin-settings-global", { classificationEnabled: true }); };
const writes = () => fake.calls.filter((c) => c.method !== "GET" && c.path.includes("classification-level"));

{
  // The reported defect: picking Restricted on a page.
  await setup();
  const r = await call("classification-set-page", { pageId: "900", levelId: R });
  eq("setting a page to Restricted succeeds", [r.ok, r.reason ?? null], [true, null]);
  eq("... Confluence now holds the page's own level", pageOwn, R);
  eq("... the page shows Restricted, set on this page", [r.effective?.level?.name, r.effective?.source], ["Restricted", "page"]);
  eq("... the write carried the content status Confluence requires", writes().map((c) => c.body), [{ id: R, status: "current" }]);
}
{
  // "Use space default" on a page that has its own level.
  await setup();
  pageOwn = HR;
  const r = await call("classification-set-page", { pageId: "900", levelId: null, reason: "back to the space's level" });
  eq("resetting a page to the space default succeeds", [r.ok, r.reason ?? null], [true, null]);
  eq("... the page's own level is gone", pageOwn, null);
  eq("... the reset carried the content status", writes().map((c) => c.body), [{ status: "current" }]);
  eq("... the page now shows the space default as the space default", [r.effective?.level?.name, r.effective?.source], ["Internal", "space"]);
}
{
  // Raising is not lowering (order 1 = most sensitive): Internal -> Restricted needs no reason.
  await setup();
  const r = await call("classification-set-page", { pageId: "900", levelId: R });
  eq("raising Internal to Restricted needs no reason", [r.ok, r.needsReason ?? false], [true, false]);
  await setup();
  pageOwn = R;
  const low = await call("classification-set-page", { pageId: "900", levelId: I });
  eq("lowering Restricted to Internal asks for a reason", [low.ok, low.needsReason], [false, true]);
  eq("... and nothing was written", writes().length, 0);
  await setup();
  const d = await call("classification-set-space-default", { spaceId: "11", levelId: P });
  eq("lowering the space default Internal to Public asks for a reason", [d.results?.[0]?.ok, d.results?.[0]?.needsReason], [false, true]);
  await setup();
  const up = await call("classification-set-space-default", { spaceId: "11", levelId: HR });
  eq("raising the space default to Highly restricted needs none", [up.results?.[0]?.ok, spaceDefault], [true, HR]);
}
{
  // A page that only follows the space default.
  await setup();
  const g = await call("classification-get-page", { pageId: "900" });
  eq("a page with no level of its own reads 'from space default'", [g.effective?.level?.name, g.effective?.source, g.pageLevelId], ["Internal", "space", null]);
  pageOwn = R;
  const g2 = await call("classification-get-page", { pageId: "900" });
  eq("a page with its own level reads 'set on this page'", [g2.effective?.level?.name, g2.effective?.source, g2.pageLevelId], ["Restricted", "page", R]);
  spaceDefault = null; pageOwn = null;
  const g3 = await call("classification-get-page", { pageId: "900" });
  eq("neither set: no level", [g3.effective?.level, g3.effective?.source], [null, "none"]);
}
{
  // Picking the space's own level for a page that follows it pins it on the page.
  await setup();
  const r = await call("classification-set-page", { pageId: "900", levelId: I });
  eq("pinning the space's level on a page writes it", [r.ok, pageOwn], [true, I]);
  // "Use space default" when the page already follows it: the reset still goes out (harmless,
  // Confluence answers 204), so a page level equal to the default can never stay pinned.
  await setup();
  const n = await call("classification-set-page", { pageId: "900", levelId: null });
  eq("'use space default' on a following page is ok", n.ok, true);
}
{
  // Levels: ranks follow sensitivity, colours are solid hex values the chips and icons can use.
  await setup();
  const p = createNativeProvider({ request: async (path) => (await import("./_forge-fake/state.mjs")).dispatchConfluence(path) });
  const levels = await p.listLevels();
  eq("levels come least sensitive first", levels.map((l) => l.name), ["Public", "Internal", "Restricted", "Highly restricted"]);
  eq("... ranked 1 (least) to 4 (most)", levels.map((l) => l.rank), [1, 2, 3, 4]);
  ok("every colour is a hex value", levels.every((l) => /^#[0-9A-F]{6}$/i.test(l.color)));
  eq("Internal to Restricted is not a downgrade", isDowngrade(I, R, levels), false);
  eq("Highly restricted to Public is a downgrade", isDowngrade(HR, P, levels), true);
}
{
  // A refusal Confluence gives anyway reaches the person in words, never a bare status.
  await setup();
  onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/api/v2/pages/900/classification-level" && method === "PUT"
    ? { status: 400, body: { errors: [{ status: 400, code: "INVALID_REQUEST_BODY", title: "level not allowed" }] } } : undefined));
  const r = await call("classification-set-page", { pageId: "900", levelId: R });
  eq("a level Confluence refuses is reported, not claimed", r.ok, false);
  ok("... in words that say Confluence refused it and nothing changed", /Confluence did not accept/.test(String(r.reason)) && /Nothing was changed/.test(String(r.reason)));
  ok("... without Confluence's raw text", !/level not allowed|INVALID_REQUEST_BODY/.test(String(r.reason)));
}
{
  // Confluence refuses a page level below the space default (measured on the test site): the app says
  // so with the way out, and sends no write Confluence would refuse.
  await setup();
  const before = writes().length;
  const r = await call("classification-set-page", { pageId: "900", levelId: P, reason: "public now" });
  eq("a page level below the space default is refused", [r.ok, r.belowSpaceDefault], [false, true]);
  ok("... naming the space default and what to do", /below its space's default level \(Internal\)/.test(String(r.reason)) && /Choose Internal or higher/.test(String(r.reason)));
  eq("... and no write is sent", writes().length, before);
  eq("the page keeps following the space", pageOwn, null);
  const same = await call("classification-set-page", { pageId: "900", levelId: R });
  eq("a level above the default still works", [same.ok, pageOwn], [true, R]);
  // Once the space default is lowered, the same level is allowed.
  await setup();
  spaceDefault = P;
  const ok2 = await call("classification-set-page", { pageId: "900", levelId: P });
  eq("with a Public space default, Public on the page is allowed", [ok2.ok, pageOwn], [true, P]);
  // A space default Confluence cannot read right now: busy, not "no default".
  await setup();
  onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/api/v2/spaces/11/classification-level/default" && method === "GET" ? { status: 503, body: {} } : undefined));
  const busy = await call("classification-set-page", { pageId: "900", levelId: P, reason: "x" });
  eq("an unreadable space default answers busy and writes nothing", [busy.ok, busy.busy, pageOwn], [false, true, null]);
}
{
  // "Use space default" on a page pinned at the space's own level (it reads as following): the pin is
  // removed and the removal is kept in the page's activity.
  await setup();
  pageOwn = I;
  const r = await call("classification-set-page", { pageId: "900", levelId: null });
  eq("the pin equal to the space default is removed", [r.ok, pageOwn], [true, null]);
  const rows = [...fake.kvs.entries()].filter(([k]) => k.startsWith("activity-page-900-")).map(([, v]) => v);
  eq("... and the page's activity records it", rows.map((v) => [v.type, v.details?.source]), [["classification.page-set", "space"]]);
}

{
  // A scheme row stored before 8.21.0 (Confluence's order as the rank, colour names, no version). It is
  // never reused as FRESH (its ranks are reversed), but when Confluence is busy it still says the site
  // uses Confluence's own levels: re-ranked, never the App's levels, never "rate limited" for want of it.
  const { getClassificationProvider } = await import("../src/server/capsules/classification/provider.js");
  const v1Row = (age) => ({ name: "native", at: Date.now() - age, levels: LEVELS.map((l) => ({ id: l.id, name: l.name, color: l.color, rank: l.order, description: "" })) });
  const busyLevels = (status) => onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/api/v2/classification-levels" ? { status, body: "busy", headers: { "Retry-After": "0" } } : undefined));
  for (const status of [503, 429]) {
    await setup();
    await kvs.set("classification-scheme-cache", v1Row(3_600_000)); // an hour old: past the minute, within the day
    busyLevels(status);
    let got = null, code = null;
    try { got = await runInvocation(() => getClassificationProvider()); } catch (e) { code = e?.code || "threw"; }
    eq(`levels call ${status} with a pre-8.21 stored choice: still Confluence's own levels`, [got?.provider?.name ?? null, code], ["native", null]);
    eq(`... re-ranked least sensitive first (${status})`, (got?.levels || []).map((l) => `${l.name}:${l.rank}`), ["Public:1", "Internal:2", "Restricted:3", "Highly restricted:4"]);
    ok(`... with hex colours (${status})`, (got?.levels || []).length === 4 && got.levels.every((l) => /^#[0-9A-F]{6}$/i.test(l.color)));
  }
  await setup();
  await kvs.set("classification-scheme-cache", v1Row(1_000)); // fresh by age, but the old shape
  const before = fake.calls.length;
  const fresh = await runInvocation(() => getClassificationProvider());
  ok("a fresh pre-8.21 row is not reused: Confluence is asked again", fake.calls.slice(before).some((c) => c.path.includes("/wiki/api/v2/classification-levels")));
  eq("... and the levels come ranked the new way", fresh.levels.map((l) => l.rank), [1, 2, 3, 4]);
  eq("... and the stored row is the new shape", (await kvs.get("classification-scheme-cache"))?.v, 2);
}

report("classification-native");
