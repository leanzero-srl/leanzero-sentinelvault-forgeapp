// The one-time scrub of the validation page properties written before 8.14.0 (8.14.1).
//
// Before 8.14.0 `sentinel-vault-validation` WAS the status and carried `checkedBy` / `approvedBy`
// (account ids). 8.14.0 moved the status to KVS and the mirror carries no ids, but an old property
// was rewritten only on its page's next stored status. The scrub rewrites every old one now: from
// the KVS status where there is one, else the old verdict minus the ids. It is resumable, budgeted,
// idempotent, finishes with a flag after which nothing runs, and an erasure is not complete while it
// is unfinished. Real modules, fake runtime.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const { kvs } = await import("@forge/kvs");
const scrub = await import("../src/server/capsules/validations/mirror-scrub.js");
const worker = await import("../src/server/capsules/privacy/worker.js");
const vActions = new Map((await import("../src/server/capsules/validations/actions.js")).actions);

const APP = "app-account";
const CHECKER = "712020:c0c0c0c0-1111-2222-3333-444444444444";
const ADMIN = "712020:adadadad-1111-2222-3333-444444444444";
const PROP = "sentinel-vault-validation";
const RULES = [{ id: "r1", type: "required-heading", severity: "block", enabled: true, config: { text: "Scope" } }];
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const old = (extra = {}) => ({ state: "passed", violations: [], version: 1, checkedAt: "2026-09-30T10:00:00.000Z", checkedBy: CHECKER, rulesFp: "x", ...extra });
const ids = (v) => [CHECKER, ADMIN].filter((id) => JSON.stringify(v ?? null).includes(id));

/**
 * A site: `n` current pages (every 3rd with an old property naming the checker, every 5th with an
 * Approve anyway naming the admin), page 10 also with a KVS status, page 11 clean, plus one archived
 * and one trashed page with an old property. Content search and the v2 lists are paginated.
 */
function site(n = 230) {
  resetFake();
  worker._resetScrubMemo();
  const w = createWorld({ appAccountId: APP, spaceKey: "WF" });
  w.readers.add("*");
  const current = [];
  for (let i = 1; i <= n; i++) {
    const id = String(1000 + i);
    w.addPage(id, { versions: [{ authorId: CHECKER, adf: { version: 1, type: "doc", content: [para("x")] } }] });
    current.push(id);
    if (i % 3 === 0) w.pages.get(id).props.set(PROP, { id: `9${id}`, version: 1, value: old(i % 5 === 0 ? { approvedBy: ADMIN, approvedAt: "2026-09-30T11:00:00.000Z" } : {}) });
  }
  if (n >= 11) w.pages.get("1011").props.set(PROP, { id: "91011", version: 3, value: { state: "failed", violations: [], version: 2, checkedAt: "2026-10-01T00:00:00.000Z", rulesFp: "x" } });
  if (n >= 10) w.pages.get("1010").props.set(PROP, { id: "91010", version: 1, value: old() });
  const extra = { archived: ["2001"], trashed: ["2002"] };
  for (const id of [...extra.archived, ...extra.trashed]) {
    w.addPage(id, { versions: [{ authorId: CHECKER, adf: { version: 1, type: "doc", content: [para("x")] } }] });
    w.pages.get(id).props.set(PROP, { id: `9${id}`, version: 1, value: old({ approvedBy: ADMIN }) });
  }
  const searchCalls = { n: 0 };
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const u = new URL(path, "https://x.invalid");
    if (method === "GET" && u.pathname === "/wiki/rest/api/content/search") {
      searchCalls.n += 1;
      const limit = Number(u.searchParams.get("limit")) || 25;
      const start = Number(u.searchParams.get("cursor") || 0);
      const slice = current.slice(start, start + limit);
      const expand = u.searchParams.get("expand") || "";
      const results = slice.map((id) => {
        const row = w.pages.get(id).props.get(PROP);
        const props = expand.includes(PROP) && row ? { [PROP]: { id: row.id, key: PROP, value: row.value, version: { number: row.version } } } : {};
        return { id, type: "page", status: "current", metadata: { properties: props } };
      });
      const next = start + limit < current.length ? `/rest/api/content/search?next=true&cursor=${start + limit}&limit=${limit}` : undefined;
      return { body: { results, size: results.length, _links: next ? { next } : {} } };
    }
    const m = u.pathname.match(/^\/wiki\/api\/v2\/(pages|blogposts)$/);
    if (method === "GET" && m) {
      const st = u.searchParams.get("status");
      const list = m[1] === "pages" ? extra[st] || [] : [];
      return { body: { results: list.map((id) => ({ id, status: st })), _links: {} } };
    }
    return undefined;
  });
  return { w, searchCalls };
}
const propOf = (w, id) => w.pages.get(id).props.get(PROP)?.value;
const allProps = (w) => [...w.pages.keys()].map((id) => propOf(w, id)).filter(Boolean);

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const lines = [];
console.info = console.warn = console.error = console.log = (...a) => { lines.push(a.join(" ")); };
try {
  // 1. A full run: no account id is left in any page property, verdicts and the KVS status survive.
  {
    const { w } = site();
    await kvs.set("validation-state-1010", { state: "failed", violations: [{ ruleId: "r1", message: "m" }], version: 1, checkedAt: "2026-10-21T00:00:00.000Z", checkedBy: CHECKER, approvedBy: ADMIN, rulesFp: "y" });
    ok("[1] before: old properties name people", allProps(w).some((v) => ids(v).length));
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[1] the scrub finished", r.done, true);
    eq("[1] no page property names anyone afterwards", allProps(w).filter((v) => ids(v).length).length, 0);
    eq("[1] an old Approve anyway keeps only that it was approved", propOf(w, "1015"), { state: "passed", violations: [], version: 1, checkedAt: "2026-09-30T10:00:00.000Z", approvedAt: "2026-09-30T11:00:00.000Z", rulesFp: "x", approved: true });
    eq("[1] a page with a KVS status is mirrored from it (the authority), not from the old property", propOf(w, "1010")?.state, "failed");
    eq("[1] ...still without ids", ids(propOf(w, "1010")).length, 0);
    eq("[1] the KVS status itself is untouched (erasure handles KVS)", (await kvs.get("validation-state-1010"))?.approvedBy, ADMIN);
    eq("[1] a clean property is not rewritten", w.pages.get("1011").props.get(PROP).version, 3);
    eq("[1] archived content is reached", ids(propOf(w, "2001")).length, 0);
    eq("[1] trashed content is reached", ids(propOf(w, "2002")).length, 0);
    eq("[1] the resume state is gone once done", await kvs.get(scrub.SCRUB_STATE_KEY), undefined);
    ok("[1] the counts add up (every current, archived and trashed page looked at)", r.pages === 232 && r.scrubbed === 79 && r.failed === 0);
  }
  // 2. Resumable under a budget: a run that stops after its first batch continues where it stopped.
  {
    const { w, searchCalls } = site();
    let t = 0;
    const now = () => t;
    const r1 = await scrub.runValidationMirrorScrub({ budgetMs: 5, now: () => { t += 3; return now(); } });
    eq("[2] a short budget stops before the end", r1.done, false);
    const st = await kvs.get(scrub.SCRUB_STATE_KEY);
    ok("[2] ...and saved where it stopped", st && st.phase === "cql" && st.cursor);
    const callsAfterFirst = searchCalls.n;
    const r2 = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[2] the next run finishes", r2.done, true);
    eq("[2] ...without re-reading the first batch (3 batches of 100 for 230 pages in all)", searchCalls.n, 3);
    ok("[2] ...the first run read exactly one batch", callsAfterFirst === 1);
    eq("[2] no ids left", allProps(w).filter((v) => ids(v).length).length, 0);
  }
  // 3. Idempotent: a second pass rewrites nothing.
  {
    const { w } = site(40);
    await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    const versions = [...w.pages.values()].map((p) => p.props.get(PROP)?.version);
    await kvs.delete(scrub.SCRUB_STATE_KEY);
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[3] a second pass scrubs nothing", r.scrubbed, 0);
    eq("[3] ...and writes no property", [...w.pages.values()].map((p) => p.props.get(PROP)?.version), versions);
  }
  // 4. A failed write is not the end: the pass starts again and finishes once the write goes through.
  {
    const { w } = site(30);
    let failOnce = true;
    onConfluence((method, rawPath) => {
      if (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/1006/properties/") && failOnce) { failOnce = false; return { status: 409, body: { message: "conflict" } }; }
      return undefined;
    });
    const r1 = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[4] a pass with a failed write is not done", r1.done, false);
    ok("[4] ...the page that failed still names someone", ids(propOf(w, "1006")).length > 0);
    const r2 = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[4] the next pass finishes", r2.done, true);
    eq("[4] ...and the page is clean", ids(propOf(w, "1006")).length, 0);
  }
  // 5. The locked runner records the flag; the five-minute kick then does nothing at all.
  {
    site(10);
    fake.queued = [];
    eq("[5] before the flag the kick queues the job", await worker.kickValidationMirrorScrub(), true);
    eq("[5] ...at most once per half hour", await worker.kickValidationMirrorScrub(), false);
    eq("[5] ...one event", (fake.queued || []).length, 1);
    const r = await worker.runValidationMirrorScrubLocked({ budgetMs: 60000 });
    eq("[5] the locked run finishes", r.done, true);
    ok("[5] ...and records validationMirrorV1", !!(await kvs.get("privacy-migrations"))?.[scrub.SCRUB_FLAG]);
    await kvs.delete("privacy-validation-scrub-kick");
    worker._resetScrubMemo();
    const reads = [];
    const realGet = kvs.get;
    kvs.get = async (k) => { reads.push(k); return realGet(k); };
    try {
      eq("[5] after the flag the kick queues nothing", await worker.kickValidationMirrorScrub(), false);
      eq("[5] ...and the next kick in the same instance reads nothing", (reads.length, await worker.kickValidationMirrorScrub(), reads.length), 1);
    } finally { kvs.get = realGet; }
    ok("[5] the log line holds counts only", lines.some((l) => /\[VALIDATION-MIRROR\] scrub pages=\d+ scrubbed=\d+ failed=0 done=true/.test(l)) && !lines.some((l) => l.includes(CHECKER) || l.includes(ADMIN)));
  }
  // 6. The consumer hands an unfinished job on, and stops handing on once it is done.
  {
    site(10);
    fake.queued = [];
    await worker.privacyConsumer({ body: { kind: "validation-scrub" } });
    eq("[6] a finished job queues nothing more", (fake.queued || []).length, 0);
    site(250);
    fake.queued = [];
    await kvs.set("privacy-validation-scrub", { phase: "cql", cursor: null, pages: 0, scrubbed: 0, failed: 0, passFailed: 0 });
    const realSet = kvs.set;
    let saves = 0;
    kvs.set = async (k, v) => { if (k === scrub.SCRUB_STATE_KEY && ++saves === 1) throw new Error("kvs down"); return realSet(k, v); };
    try { await worker.privacyConsumer({ body: { kind: "validation-scrub" } }); } finally { kvs.set = realSet; }
    eq("[6] an interrupted job hands itself on", (fake.queued || []).length, 1);
  }
  // 7. The panel reads the same before and after (it reads KVS, never the property).
  {
    const { w } = site(12);
    await kvs.set("validation-config-global", { enabled: true, modes: { advisory: false, gate: true, revert: false }, rules: RULES });
    await kvs.set("validation-state-1003", { state: "failed", violations: [{ ruleId: "r1", message: "Missing heading" }], version: 1, checkedAt: "2026-10-21T00:00:00.000Z", rulesFp: "y" });
    const ctx = (id) => ({ accountId: CHECKER, extension: { content: { id, type: "page", space: { key: "WF" } }, space: { key: "WF" } } });
    const read = async (id) => JSON.stringify(await vActions.get("get-validation-state")({ payload: { pageId: id }, context: ctx(id) }));
    const before = [await read("1003"), await read("1006"), await read("1001")];
    await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    const after = [await read("1003"), await read("1006"), await read("1001")];
    eq("[7] the panel answers exactly as before for a KVS status, an old-property-only page and a page with neither", after, before);
    ok("[7] ...and the KVS status still shows its violation", after[0].includes("Missing heading"));
    void w;
  }
  // 8. Erasure: a closed person is not marked erased while an old mirror may still name them.
  {
    site(9);
    await kvs.set("app-account-id", APP);
    await kvs.set("validation-state-1003", { state: "passed", violations: [], version: 1, checkedBy: ADMIN });
    // The scrub cannot finish (every property write fails) — the erasure must stay open.
    onConfluence((method, rawPath) => (method === "PUT" && decodeURIComponent(rawPath).includes("/properties/") ? { status: 500, body: {} } : undefined));
    const reportClosed = async (batch) => batch.map((a) => ({ accountId: a.accountId, status: a.accountId === ADMIN ? "closed" : "ok" }));
    const s1 = await worker.runPrivacySweep({ reason: "test", report: reportClosed });
    ok("[8] the sweep ran", s1.ok === true);
    ok("[8] ...and worked on the scrub, which could not finish", s1.validationMirror && s1.validationMirror.done === false);
    const idx1 = await kvs.get("privacy-accounts-0000");
    ok("[8] the closed person is marked closed", !!idx1?.[ADMIN]?.c);
    eq("[8] ...but NOT erased while the scrub is unfinished", idx1?.[ADMIN]?.x ?? null, null);
    // Writes work again: the next sweep finishes the scrub and the erasure.
    fake.handlers.pop();
    const s2 = await worker.runPrivacySweep({ reason: "test", report: reportClosed });
    ok("[8] the next sweep finishes the scrub", s2.validationMirror?.done === true);
    const idx2 = await kvs.get("privacy-accounts-0000");
    ok("[8] ...and only then is the person marked erased", !!idx2?.[ADMIN]?.x);
    ok("[8] ...with the flag recorded", !!(await kvs.get("privacy-migrations"))?.[scrub.SCRUB_FLAG]);
  }
  // 9. Pure helpers.
  {
    eq("[9] an old property needs the scrub", scrub.mirrorNeedsScrub(old()), true);
    eq("[9] a mirror does not", scrub.mirrorNeedsScrub({ state: "passed", violations: [], approved: true, rulesFp: "x" }), false);
    eq("[9] nothing to scrub in a non-object", [scrub.mirrorNeedsScrub(null), scrub.mirrorNeedsScrub([1]), scrub.mirrorNeedsScrub("x")], [false, false, false]);
    eq("[9] the cursor of a v1 next link", scrub.cursorOf("/rest/api/content/search?next=true&cursor=abc%3D&limit=100"), "abc=");
    eq("[9] no next link, no cursor", scrub.cursorOf(undefined), null);
  }
} finally {
  Object.assign(console, log);
}
report("validation-mirror-scrub");
