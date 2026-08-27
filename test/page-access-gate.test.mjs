// SV-SEC-1 — the gate on privileged writes to a CALLER-SUPPLIED pageId.
//
// This suite drives the REAL resolvers (sealSection, unsealSection, injectPanel, extractPanel,
// storeDocPanelPrefs) with @forge/api and @forge/kvs redirected to in-process stubs, so what is
// asserted is the resolver's actual behaviour and not a re-implementation of it.
//
// The load-bearing assertions are the NEGATIVE ones: an unentitled caller must be refused AND must
// leave behind zero page PUTs and zero KVS writes. A happy-path assertion proves nothing here, so
// every deny case checks the side effects, not just the returned `reason`.

import { register } from "node:module";
register("./stubs/forge-loader.mjs", import.meta.url);

const { eq, ok, report } = await import("./_assert.mjs");

const PAGE = "111111";           // the page under attack / under test
const FOREIGN_PAGE = "999999";   // a page the caller has no rights to
const GOOD_ACC = "acc-entitled";
const BAD_ACC = "acc-unentitled";
const SPACE_ID = "555";
const SPACE_KEY = "DOCS";

const ADF = { type: "doc", version: 1, content: [
  { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Section One" }] },
  { type: "paragraph", content: [{ type: "text", text: "body" }] },
] };

// A document that already carries the panel, so removePanelNode actually reaches its write instead
// of short-circuiting on "no panel here" — otherwise the extract-panel write assertion would pass
// even with the gate removed, and would be proving nothing.
const ADF_WITH_PANEL = { type: "doc", version: 1, content: [
  ...ADF.content,
  { type: "extension", attrs: { extensionType: "com.atlassian.ecosystem", extensionKey: "app123/env456/static/sentinel-vault-panel" } },
] };

/**
 * Build the Confluence stub. Everything defaults to the SAFE answer (deny / not found); each test
 * opts in to what it needs, so a scenario can never accidentally pass because a default said yes.
 */
function scenario(opts = {}) {
  const {
    permission = () => ({ kind: "deny" }),   // content permission/check outcome per subject
    userOps = [],                            // ops returned by /pages/{id}/operations (asUser)
    currentUser = null,                      // asUser /user/current
    pageGet = { status: 200 },               // resolvePageRealm's page GET
    spaceGet = { status: 200 },              // resolvePageRealm's space GET
    spaceKey = SPACE_KEY,
    pageVersion = 3,
    adf = ADF,
  } = opts;

  let pageGetCalls = 0;
  let spaceGetCalls = 0;

  globalThis.__FORGE__ = {
    calls: [],
    kvs: new Map(),
    kvsWrites: [],
    kvsDeletes: [],
    appContext: { appAri: { appId: "app123" }, environmentAri: { environmentId: "env456" } },
    handle: async ({ as, method, url }) => {
      // ---- the WRITE we are trying to prevent -------------------------------------------------
      if (method === "PUT" && /^\/wiki\/api\/v2\/pages\/\d+$/.test(url)) {
        return { status: 200, body: { id: PAGE, version: { number: pageVersion + 1 } } };
      }
      // ---- page body read ---------------------------------------------------------------------
      if (method === "GET" && url.includes("body-format=atlas_doc_format")) {
        return { status: 200, body: {
          id: PAGE, status: "current", title: "Test Page", spaceId: SPACE_ID,
          version: { number: pageVersion },
          body: { atlas_doc_format: { value: JSON.stringify(adf) } },
        } };
      }
      // ---- content properties (tail-end bookkeeping; benign) ----------------------------------
      if (url.includes("/properties")) {
        return method === "GET" ? { status: 200, body: { results: [] } } : { status: 200, body: {} };
      }
      // ---- resolvePageRealm: page GET ---------------------------------------------------------
      if (method === "GET" && /^\/wiki\/api\/v2\/pages\/\d+$/.test(url)) {
        pageGetCalls++;
        const st = Array.isArray(pageGet.status) ? pageGet.status[pageGetCalls - 1] : pageGet.status;
        if (st !== 200) return { status: st, body: { message: "nope" } };
        return { status: 200, body: { id: PAGE, spaceId: SPACE_ID, title: "Test Page" } };
      }
      // ---- resolvePageRealm: space GET --------------------------------------------------------
      if (method === "GET" && /^\/wiki\/api\/v2\/spaces\/\d+$/.test(url)) {
        spaceGetCalls++;
        const st = Array.isArray(spaceGet.status) ? spaceGet.status[spaceGetCalls - 1] : spaceGet.status;
        if (st !== 200) return { status: st, body: { message: "nope" } };
        return { status: 200, body: { id: SPACE_ID, key: spaceKey } };
      }
      // ---- L2b: page operations as the ambient user -------------------------------------------
      if (method === "GET" && /\/wiki\/api\/v2\/pages\/\d+\/operations$/.test(url)) {
        if (as !== "user") return { status: 403, body: {} };
        return { status: 200, body: { operations: userOps } };
      }
      // ---- ambient user ------------------------------------------------------------------------
      if (url.startsWith("/wiki/rest/api/user/current")) {
        if (as !== "user" || !currentUser) return { status: 401, body: {} };
        return { status: 200, body: currentUser };
      }
      // ---- L2a: content permission check -------------------------------------------------------
      if (method === "POST" && /\/wiki\/rest\/api\/content\/\d+\/permission\/check$/.test(url)) {
        const body = JSON.parse(globalThis.__FORGE__.calls.at(-1).body);
        const subject = body.subject.identifier;
        const out = permission(subject, body.operation, url);
        if (out.kind === "allow") return { status: 200, body: { hasPermission: true, errors: [] } };
        if (out.kind === "deny") return { status: 200, body: { hasPermission: false, errors: [] } };
        if (out.kind === "status") return { status: out.status, body: { message: "x" } };
        return { status: 404, body: { message: "no such user" } };
      }
      // ---- steward arms: everything denies unless a test says otherwise -------------------------
      if (url.startsWith("/wiki/rest/api/user?")) return { status: 200, body: { groups: { results: [] }, operations: [] } };
      if (url.includes("/permission/check")) return { status: 200, body: { hasPermission: false } };
      return { status: 404, body: { message: "unstubbed" } };
    },
  };
}

const putCount = () =>
  globalThis.__FORGE__.calls.filter(
    (c) => c.method === "PUT" && /^\/wiki\/api\/v2\/pages\/\d+$/.test(c.url),
  ).length;

const sealWrites = () =>
  globalThis.__FORGE__.kvsWrites.filter((k) => k.startsWith("section-protection-") || k.startsWith("section-snapshot-")).length;

const req = ({ accountId, pageId, ctxPageId, payload = {} }) => ({
  payload: { pageId, ...payload },
  context: {
    accountId,
    extension: ctxPageId ? { content: { id: ctxPageId, space: { key: payload.__ctxSpaceKey || SPACE_KEY } } } : undefined,
  },
});

const { sealSection, unsealSection } = await import("../src/server/capsules/section-seals/actions.js");
const { actions: panelActions } = await import("../src/server/capsules/panels/actions.js");
const panel = Object.fromEntries(panelActions);

// ═══ 1. THE DEFECT: an unentitled caller aims sealSection at a page they cannot edit ═══════════
// Every arm says no: the app-authority probe denies, there is no matching ambient user, and the
// caller is not a steward of the page's own space.
{
  scenario({ permission: () => ({ kind: "deny" }) });
  const res = await sealSection(req({ accountId: BAD_ACC, pageId: FOREIGN_PAGE, payload: { headingIndex: 0 } }));
  eq("NEGATIVE seal: refused", res.success, false);
  ok("NEGATIVE seal: reason names permission", /permission/i.test(res.reason));
  eq("NEGATIVE seal: ZERO page writes", putCount(), 0);
  eq("NEGATIVE seal: ZERO seal records written", sealWrites(), 0);
}

// ═══ 2. The positive case still works — do not fix it into uselessness ═════════════════════════
// Decided by the as-user arm (L2b), which is what carries a resolver once the L2a control is
// honest about being inconclusive.
{
  scenario({
    permission: (s) => (s === "anonymous" ? { kind: "deny" } : { kind: "deny" }),
    currentUser: { accountId: GOOD_ACC, displayName: "Good User", email: "g@example.com" },
    userOps: [{ operation: "update", targetType: "page" }],
  });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: PAGE, ctxPageId: PAGE, payload: { headingIndex: 0 } }));
  eq("POSITIVE seal: succeeded", res.success, true);
  ok("POSITIVE seal: returned a sectionId", typeof res.sectionId === "string" && res.sectionId.length > 0);
  eq("POSITIVE seal: exactly one page write", putCount(), 1);
  const rec = globalThis.__FORGE__.kvs.get(`section-protection-${res.sectionId}`);
  ok("POSITIVE seal: wrote a seal record", !!rec);
  eq("POSITIVE seal: record stamps the PAGE's own space key", rec.spaceKey, SPACE_KEY);
  eq("POSITIVE seal: record stamps the PAGE's own space id", rec.spaceId, SPACE_ID);
}

// ═══ 3. F2 — the control probe must not be satisfiable by a non-answer ═════════════════════════
// A subject-IGNORING endpoint: it returns 200/true for any real accountId, and 404 "no such user"
// for the literal "anonymous". Before the fix, that 404 mapped to `false`, endpointDiscriminates
// read `false` as "yes it discriminates", and the attacker's `true` was trusted. Now the control
// demands a DEFINITE deny, so the app arm goes indeterminate and the other arms decide.
{
  scenario({
    permission: (s) => (s === "anonymous" ? { kind: "404" } : { kind: "allow" }),
    // no ambient user, not a steward
  });
  const res = await sealSection(req({ accountId: BAD_ACC, pageId: FOREIGN_PAGE, payload: { headingIndex: 0 } }));
  eq("F2 subject-ignoring endpoint: refused", res.success, false);
  eq("F2 subject-ignoring endpoint: ZERO page writes", putCount(), 0);
  eq("F2 subject-ignoring endpoint: ZERO seal records", sealWrites(), 0);
}

// ...and the same endpoint shape must not let the app arm grant on its own even for a real caller:
// only a genuine 200/hasPermission:false control unlocks the L2a affirmative.
{
  scenario({ permission: (s) => (s === "anonymous" ? { kind: "deny" } : { kind: "allow" }) });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("F2 control passes: L2a may grant", res.success, true);
}

// ═══ 4. F3a — an unresolved space key must be fatal to the seal ════════════════════════════════
// resolvePageRealm treats a failed space GET as non-fatal and returns spaceKey:null. A record
// written with a null spaceKey is what let unsealSection go looking for a caller-supplied space.
{
  scenario({
    spaceGet: { status: [404, 404] },
    currentUser: { accountId: GOOD_ACC, displayName: "Good User" },
    userOps: [{ operation: "update", targetType: "page" }],
  });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("F3a null spaceKey: seal refused", res.success, false);
  eq("F3a null spaceKey: ZERO page writes", putCount(), 0);
  eq("F3a null spaceKey: ZERO seal records", sealWrites(), 0);
}

// ═══ 5. F3b — unsealSection must never consult a caller-supplied space ═════════════════════════
// A legacy record with a null spaceKey. An unrelated account calls unseal while claiming, through
// the extension context, to be in a space they steward. The steward arm must resolve the realm
// from the RECORD's pageId instead, and refuse.
{
  scenario({ spaceKey: SPACE_KEY });
  globalThis.__FORGE__.kvs.set("section-protection-legacy1", {
    sectionId: "legacy1", pageId: PAGE, spaceId: SPACE_ID, spaceKey: null, lockedBy: GOOD_ACC,
  });
  // The attacker is a steward of ATTACKER-SPACE only — grant ADMINISTER there and nowhere else.
  const base = globalThis.__FORGE__.handle;
  globalThis.__FORGE__.handle = async (c) => {
    if (c.url.startsWith("/wiki/rest/api/space/ATTACKER-SPACE/permission/check")) {
      return { status: 200, body: { hasPermission: true } };
    }
    return base(c);
  };
  const res = await unsealSection({
    payload: { sectionId: "legacy1" },
    context: { accountId: BAD_ACC, extension: { content: { id: PAGE, space: { key: "ATTACKER-SPACE" } } } },
  });
  eq("F3b caller-supplied space: unseal refused", res.success, false);
  eq("F3b caller-supplied space: ZERO page writes", putCount(), 0);
  eq("F3b caller-supplied space: record NOT deleted", globalThis.__FORGE__.kvsDeletes.length, 0);
}

// ═══ 6. F4 — a transient failure on the realm GET must retry, not refuse a legitimate seal ═════
{
  scenario({
    pageGet: { status: [429, 200] },
    currentUser: { accountId: GOOD_ACC, displayName: "Good User" },
    userOps: [{ operation: "update", targetType: "page" }],
  });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("F4 429 then 200: seal succeeds after retry", res.success, true);
}
{
  scenario({
    pageGet: { status: [500, 500] },
    currentUser: { accountId: GOOD_ACC, displayName: "Good User" },
    userOps: [{ operation: "update", targetType: "page" }],
  });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("F4 persistent 5xx: still fails CLOSED", res.success, false);
  eq("F4 persistent 5xx: ZERO page writes", putCount(), 0);
}

// ═══ 7. F1 — the same write primitive reached through the panel resolvers on the same router ═══
for (const key of ["inject-panel", "extract-panel"]) {
  scenario({ permission: () => ({ kind: "deny" }), adf: ADF_WITH_PANEL });
  const res = await panel[key]({ payload: { pageId: FOREIGN_PAGE }, context: { accountId: BAD_ACC } });
  eq(`F1 ${key}: refused`, res.success, false);
  eq(`F1 ${key}: ZERO page writes`, putCount(), 0);
  eq(`F1 ${key}: ZERO page reads either`, globalThis.__FORGE__.calls.filter((c) => c.url.includes("body-format")).length, 0);
}
{
  scenario({ permission: () => ({ kind: "deny" }), adf: ADF_WITH_PANEL });
  const res = await panel["store-doc-panel-prefs"]({
    payload: { pageId: FOREIGN_PAGE, macroDisabled: true }, context: { accountId: BAD_ACC },
  });
  eq("F1 store-doc-panel-prefs: refused", res.success, false);
  eq("F1 store-doc-panel-prefs: ZERO page writes", putCount(), 0);
  eq("F1 store-doc-panel-prefs: ZERO property writes",
    globalThis.__FORGE__.calls.filter((c) => c.url.includes("/properties") && c.method !== "GET").length, 0);
}

// ═══ 8. Depth checks — payload/context disagreement, bad ids, missing caller ═══════════════════
{
  scenario({ currentUser: { accountId: GOOD_ACC }, userOps: [{ operation: "update", targetType: "page" }] });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: FOREIGN_PAGE, ctxPageId: PAGE, payload: { headingIndex: 0 } }));
  eq("depth: payload/context pageId mismatch refused", res.success, false);
  eq("depth: mismatch did no page write", putCount(), 0);
}
{
  scenario({ currentUser: { accountId: GOOD_ACC }, userOps: [{ operation: "update", targetType: "page" }] });
  const res = await sealSection(req({ accountId: GOOD_ACC, pageId: "not-a-page-id", payload: { headingIndex: 0 } }));
  eq("depth: implausible pageId refused", res.success, false);
  eq("depth: implausible pageId did no page write", putCount(), 0);
}
{
  scenario({ currentUser: { accountId: GOOD_ACC }, userOps: [{ operation: "update", targetType: "page" }] });
  const res = await sealSection(req({ accountId: undefined, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("depth: no caller accountId refused", res.success, false);
  eq("depth: no caller accountId did no page write", putCount(), 0);
}
{
  // The as-user arm must not be usable to launder one account's entitlement into a decision about
  // another: ambient identity != declared caller means the arm is skipped entirely.
  scenario({
    currentUser: { accountId: GOOD_ACC },
    userOps: [{ operation: "update", targetType: "page" }],
  });
  const res = await sealSection(req({ accountId: BAD_ACC, pageId: PAGE, payload: { headingIndex: 0 } }));
  eq("depth: ambient != declared caller refused", res.success, false);
  eq("depth: ambient mismatch did no page write", putCount(), 0);
}

report("page-access-gate");
