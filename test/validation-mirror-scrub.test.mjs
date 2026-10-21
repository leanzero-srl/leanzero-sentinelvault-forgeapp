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
  const inArchivedSpace = ["2003"]; // a current page in an archived space (a person who left)
  for (const id of [...extra.archived, ...extra.trashed, ...inArchivedSpace]) {
    w.addPage(id, { versions: [{ authorId: CHECKER, adf: { version: 1, type: "doc", content: [para("x")] } }] });
    w.pages.get(id).props.set(PROP, { id: `9${id}`, version: 1, value: old({ approvedBy: ADMIN }) });
  }
  const searchCalls = { n: 0, lists: 0 };
  const entry = (id, expandKey) => {
    const row = w.pages.get(id).props.get(PROP);
    return { id, type: "page", metadata: { properties: row && expandKey ? { [PROP]: { id: row.id, key: PROP, value: row.value, version: { number: row.version } } } : {} } };
  };
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const u = new URL(path, "https://x.invalid");
    if (method === "GET" && u.pathname === "/wiki/rest/api/search") {
      searchCalls.n += 1;
      const limit = Number(u.searchParams.get("limit")) || 25;
      const start = Number(u.searchParams.get("cursor") || 0);
      const archived = u.searchParams.get("includeArchivedSpaces") === "true";
      const pool = archived ? [...current, ...inArchivedSpace] : current;
      const slice = pool.slice(start, start + limit);
      const ex = (u.searchParams.get("expand") || "").includes(`content.metadata.properties.${PROP}`);
      const results = slice.map((id) => ({ content: entry(id, ex), title: id }));
      const next = start + limit < pool.length ? `/rest/api/search?next=true&cursor=${start + limit}&limit=${limit}` : undefined;
      return { body: { results, size: results.length, _links: next ? { next } : {} } };
    }
    if (method === "GET" && u.pathname === "/wiki/api/v2/pages") {
      searchCalls.lists += 1;
      const st = u.searchParams.get("status");
      const list = extra[st] || [];
      const limit = Number(u.searchParams.get("limit")) || 25;
      const start = Number(u.searchParams.get("cursor") || 0);
      const slice = list.slice(start, start + limit);
      return { body: { results: slice.map((id) => ({ id, status: st })), _links: start + limit < list.length ? { next: `/wiki/api/v2/pages?status=${st}&cursor=${start + limit}` } : {} } };
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
    const { w, searchCalls } = site();
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
    eq("[1] a page in an archived space is reached", ids(propOf(w, "2003")).length, 0);
    eq("[1] an archived page is reached", ids(propOf(w, "2001")).length, 0);
    eq("[1] a trashed page is reached", ids(propOf(w, "2002")).length, 0);
    eq("[1] the resume state is gone once done", await kvs.get(scrub.SCRUB_STATE_KEY), undefined);
    eq("[1] the counts add up (every page looked at, every old one rewritten)", [r.pages, r.scrubbed, r.failed], [233, 80, 0]);
    eq("[1] archived and trashed are listed with v2 (the v1 list answers 410 to an app)", searchCalls.lists, 2);
  }
  // 2. Resumable under a budget: a run that stops after its first batch continues where it stopped.
  {
    const { w, searchCalls } = site();
    let t = 0;
    const r1 = await scrub.runValidationMirrorScrub({ budgetMs: 5, now: () => (t += 3) });
    eq("[2] a short budget stops before the end", r1.done, false);
    eq("[2] ...and is not a wait (the consumer hands it on at once)", r1.waitUntil ?? null, null);
    const st = await kvs.get(scrub.SCRUB_STATE_KEY);
    ok("[2] ...and saved where it stopped", st && st.phase === "search" && st.cursor);
    const callsAfterFirst = searchCalls.n;
    const r2 = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[2] the next run finishes", r2.done, true);
    eq("[2] ...without re-reading the first batch (3 search batches for 231 pages in all)", searchCalls.n, 3);
    eq("[2] ...the first run read exactly one batch", callsAfterFirst, 1);
    eq("[2] no ids left", allProps(w).filter((v) => ids(v).length).length, 0);
  }
  // 3. Idempotent: a second pass rewrites nothing.
  {
    const { w } = site(40);
    await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    const versions = [...w.pages.values()].map((p) => p.props.get(PROP)?.version);
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[3] a second pass scrubs nothing", r.scrubbed, 0);
    eq("[3] ...and writes no property", [...w.pages.values()].map((p) => p.props.get(PROP)?.version), versions);
  }
  // 4. A lost version race (409) is re-read and retried once: no failure, no restart.
  {
    const { w, searchCalls } = site(30);
    let failOnce = true;
    onConfluence((method, rawPath) => {
      if (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/1006/properties/") && failOnce) { failOnce = false; return { status: 409, body: { message: "conflict" } }; }
      return undefined;
    });
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    eq("[4] a 409 does not stop the job", [r.done, r.failed], [true, 0]);
    eq("[4] ...the page is clean", ids(propOf(w, "1006")).length, 0);
    eq("[4] ...and the site was walked once", searchCalls.n, 1);
  }
  // 5. A page that can never be written: retried at most RETRY_ROUNDS times, an hour apart, never in a loop.
  {
    const { w, searchCalls } = site(30);
    onConfluence((method, rawPath) => (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/1009/properties/") ? { status: 403, body: {} } : undefined));
    let t = Date.parse("2026-10-22T08:00:00Z");
    const clock = () => t;
    const r1 = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: clock, rand: () => 0 });
    eq("[5] the first pass ends in a wait, not a restart", [r1.done, r1.failed], [false, 1]);
    eq("[5] ...an hour later", r1.waitUntil - t, scrub.RETRY_AFTER_MS);
    const r1b = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: clock });
    eq("[5] a run before the hour does nothing", [r1b.done, searchCalls.n], [false, 1]);
    let r;
    for (let round = 1; round <= scrub.RETRY_ROUNDS; round++) { t += scrub.RETRY_AFTER_MS + 1000; r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: clock }); }
    eq("[5] after the retry rounds the job ends with the page skipped", [r.done, r.skipped], [true, 1]);
    eq("[5] ...the lists were walked only once (retries read the one page)", searchCalls.n, 1);
    ok("[5] ...and the skip is logged with a count", lines.some((l) => /\[VALIDATION-MIRROR\] 1 page\(s\) could not be rewritten after 3 retries; skipped/.test(l)));
    eq("[5] every other page is clean", allProps(w).filter((v) => ids(v).length).length, 1);
  }
  // 6. A 429 waits for the next hour; a failed list backs off (5 min, doubling, at most an hour).
  {
    site(30);
    onConfluence((method, rawPath) => (method === "GET" && decodeURIComponent(rawPath).startsWith("/wiki/rest/api/search") ? { status: 429, body: {} } : undefined));
    const t = Date.parse("2026-10-22T08:20:00Z");
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0 });
    eq("[6] a 429 waits until the next hour", r.waitUntil, Date.parse("2026-10-22T09:00:00Z"));
    await kvs.delete(scrub.SCRUB_STATE_KEY);
    const rj = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0.5 });
    eq("[6] ...plus jitter, so waiting sites do not all start again together", rj.waitUntil, Date.parse("2026-10-22T09:07:30Z"));
    fake.handlers.pop();
    onConfluence((method, rawPath) => (method === "GET" && decodeURIComponent(rawPath).startsWith("/wiki/rest/api/search") ? { status: 500, body: {} } : undefined));
    await kvs.delete(scrub.SCRUB_STATE_KEY);
    let now = t; const waits = [];
    for (let i = 0; i < 6; i++) { const x = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => now }); waits.push((x.waitUntil - now) / 1000); now = x.waitUntil + 1; }
    eq("[6] failed lists back off 300, 600, 1200, 2400, 3600, 3600 s", waits, [300, 600, 1200, 2400, 3600, 3600]);
    eq("[6] pure: next hour", scrub.nextHour(Date.parse("2026-10-22T08:59:59Z")), Date.parse("2026-10-22T09:00:00Z"));
  }
  // 6b. Pacing: a site walks at most HOURLY_PAGES an hour, and stops early when Confluence says it is near the limit.
  {
    const { searchCalls } = site(230);
    const t = Date.parse("2026-10-22T08:00:00Z");
    const realCap = scrub.HOURLY_PAGES;
    ok("[6b] the hourly share is far below the shared pool", realCap <= 5000);
    // A near-limit answer on the first batch: the run stops after that batch and waits for the reset.
    const siteHandler = fake.handlers[fake.handlers.length - 1];
    let marked = false;
    onConfluence(async (m, pth, b, who) => {
      if (!marked && m === "GET" && decodeURIComponent(pth).startsWith("/wiki/rest/api/search")) { marked = true; const r = await siteHandler(m, pth, b, who); return { ...r, headers: { "X-RateLimit-NearLimit": "true" } }; }
      return undefined;
    });
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0 });
    eq("[6b] near the limit: one batch, then a wait for the reset", [searchCalls.n, r.done, r.waitUntil], [1, false, Date.parse("2026-10-22T09:00:00Z")]);
    eq("[6b] ...that batch is counted", r.pages, 100);
  }
  {
    // The hourly share: with a share smaller than the site, the walk waits for the next hour.
    site(30);
    const st0 = { phase: "search", cursor: null, pages: 0, scrubbed: 0, failedIds: [], overflow: 0, retryRound: 0, waitUntil: null, backoffS: 0, listFailures: 0, skippedPhases: [], hourStart: Date.parse("2026-10-22T08:00:00Z"), hourPages: scrub.HOURLY_PAGES };
    await kvs.set(scrub.SCRUB_STATE_KEY, st0);
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => Date.parse("2026-10-22T08:30:00Z"), rand: () => 0 });
    eq("[6b] the hour's share used: wait for the next hour", [r.done, r.waitUntil], [false, Date.parse("2026-10-22T09:00:00Z")]);
    const r2 = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => Date.parse("2026-10-22T09:00:01Z"), rand: () => 0 });
    eq("[6b] ...and goes on in the next hour", r2.done, true);
    // The share is per clock hour: a run that started at 10:50 and used its share wakes at 11:0x with a fresh one.
    site(30);
    await kvs.set(scrub.SCRUB_STATE_KEY, { ...st0, hourStart: Date.parse("2026-10-22T10:00:00Z") });
    const r3 = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => Date.parse("2026-10-22T11:03:00Z"), rand: () => 0 });
    eq("[6b] a wake after the top of the hour makes progress (no wasted hour)", r3.done, true);
    process.env.SV_SCRUB_HOURLY_PAGES = "1000000000";
    eq("[6b] the environment override is clamped", scrub.hourlyPages(), scrub.HOURLY_PAGES_MAX);
    process.env.SV_SCRUB_HOURLY_PAGES = "";
    eq("[6b] ...and absent it is the default", scrub.hourlyPages(), scrub.HOURLY_PAGES);
  }
  // 6c. A read that hits the rate limit in a retry round waits; it never turns a writable page into a skip.
  {
    const { w } = site(30);
    let putFails = 1;
    onConfluence((method, rawPath) => (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/1009/properties/") && putFails-- > 0 ? { status: 500, body: {} } : undefined));
    let t = Date.parse("2026-10-22T08:00:00Z");
    const clock = () => t;
    await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: clock, rand: () => 0 });
    let reads429 = 3;
    onConfluence((method, rawPath) => (method === "GET" && decodeURIComponent(rawPath).includes("/pages/1009/properties?") && reads429-- > 0 ? { status: 429, body: {} } : undefined));
    let r;
    for (let i = 0; i < 8; i++) { t += scrub.RETRY_AFTER_MS + 1000; r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: clock, rand: () => 0 }); if (r.done) break; }
    eq("[6c] after the limited reads the page is written, not skipped", [r.done, r.skipped], [true, 0]);
    eq("[6c] ...and is clean", ids(propOf(w, "1009")).length, 0);
  }
  // 6d. A list that never answers is given up after LIST_FAILURES_MAX tries and recorded; the job ends.
  {
    site(10);
    onConfluence((method, rawPath) => (method === "GET" && decodeURIComponent(rawPath).includes("/wiki/api/v2/pages?") && decodeURIComponent(rawPath).includes("status=trashed") ? { status: 403, body: {} } : undefined));
    let t = Date.parse("2026-10-22T08:00:00Z");
    let r; let runs = 0;
    for (; runs < 60; runs++) { r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0 }); if (r.done) break; t = (r.waitUntil || t) + 1000; }
    eq("[6d] the job ends", r.done, true);
    eq("[6d] ...with the trashed phase recorded as skipped", r.skippedPhases, ["trashed"]);
    eq("[6d] ...after exactly LIST_FAILURES_MAX attempts", runs + 1, scrub.LIST_FAILURES_MAX);
  }
  // 6e. A mid-batch 429 on a write is resumed without counting the batch twice.
  {
    site(33);
    let n429 = 1;
    onConfluence((method, rawPath) => (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/1015/properties/") && n429-- > 0 ? { status: 429, body: {} } : undefined));
    let t = Date.parse("2026-10-22T08:00:00Z");
    const r1 = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0 });
    t = r1.waitUntil + 1;
    const r2 = await scrub.runValidationMirrorScrub({ budgetMs: 60000, now: () => t, rand: () => 0 });
    eq("[6e] every page counted once (33 current + archived space + archived + trashed)", [r2.done, r2.pages], [true, 36]);
  }
  // 7. The locked runner, the kick and the consumer: one chain, no loop, nothing after the flag.
  {
    const { searchCalls } = site(10);
    fake.queued = [];
    eq("[7] before the flag the kick queues the job", await worker.kickValidationMirrorScrub(), true);
    eq("[7] ...not twice", await worker.kickValidationMirrorScrub(), false);
    eq("[7] ...one event", (fake.queued || []).length, 1);
    eq("[7] a Jira installation never runs it (kick)", await worker.kickValidationMirrorScrub({ installContext: "ari:cloud:jira::site/x" }), false);
    fake.queued = [];
    await worker.privacyConsumer({ body: { kind: "validation-scrub" } }, { installContext: "ari:cloud:jira::site/x" });
    eq("[7] ...nor the consumer", [searchCalls.n, (fake.queued || []).length], [0, 0]);
    const r = await worker.runValidationMirrorScrubLocked({ budgetMs: 60000 });
    eq("[7] the locked run finishes", r.done, true);
    ok("[7] ...records validationMirrorV1", !!(await kvs.get("privacy-migrations"))?.[scrub.SCRUB_FLAG]);
    ok("[7] ...and queues a sweep so open erasures finish now", (fake.queued || []).some((q) => JSON.stringify(q).includes('"sweep"')));
    const callsDone = searchCalls.n;
    await worker.privacyConsumer({ body: { kind: "validation-scrub" } }, null);
    eq("[7] a leftover event after the flag reads nothing", searchCalls.n, callsDone);
    await kvs.delete("privacy-validation-scrub-kick");
    worker._resetScrubMemo();
    const A = { installContext: "ari:cloud:confluence::site/A" }, B = { installContext: "ari:cloud:confluence::site/B" };
    const reads = [];
    const realGet = kvs.get;
    kvs.get = async (k) => { reads.push(k); return realGet(k); };
    try {
      eq("[7] after the flag the kick queues nothing", await worker.kickValidationMirrorScrub(A), false);
      const n = reads.length;
      await worker.kickValidationMirrorScrub(A);
      eq("[7] ...and the next kick for the same site reads nothing", reads.length, n);
    } finally { kvs.get = realGet; }
    // One Forge process serves several sites: site A's "done" must not stop site B's scrub.
    await kvs.set("privacy-migrations", {});
    await kvs.delete("privacy-validation-scrub-kick");
    fake.queued = [];
    eq("[7] another site served by the same instance still starts its own job", await worker.kickValidationMirrorScrub(B), true);
    eq("[7] ...and a second kick within the quarter hour queues nothing", await worker.kickValidationMirrorScrub(null), false);
    ok("[7] the log line holds counts only", lines.some((l) => /\[VALIDATION-MIRROR\] scrub pages=\d+ scrubbed=\d+ failed=0 done=true/.test(l)) && !lines.some((l) => l.includes(CHECKER) || l.includes(ADMIN)));
  }
  {
    // Hand-on rules: only a run that ran out of budget is handed on; a wait or a busy lock ends the chain.
    site(10);
    onConfluence((method, rawPath) => (method === "GET" && decodeURIComponent(rawPath).startsWith("/wiki/rest/api/search") ? { status: 429, body: {} } : undefined));
    fake.queued = [];
    await worker.privacyConsumer({ body: { kind: "validation-scrub" } }, null);
    eq("[7] a run that has to wait is NOT handed on (no loop on the shared rate limit)", (fake.queued || []).length, 0);
    const st = await kvs.get(scrub.SCRUB_STATE_KEY);
    ok("[7] ...it saved the wait", st?.waitUntil > Date.now());
    eq("[7] ...and the kick leaves a waiting job alone", await worker.kickValidationMirrorScrub(), false);
    await kvs.set(scrub.SCRUB_LOCK_KEY, { token: "other", at: new Date().toISOString() });
    await kvs.delete(scrub.SCRUB_STATE_KEY);
    fake.queued = [];
    await worker.privacyConsumer({ body: { kind: "validation-scrub" } }, null);
    eq("[7] a busy lock ends the chain too", (fake.queued || []).length, 0);
  }
  // 8. The panel reads the same before and after (it reads KVS, never the property).
  {
    site(12);
    await kvs.set("validation-config-global", { enabled: true, modes: { advisory: false, gate: true, revert: false }, rules: RULES });
    await kvs.set("validation-state-1003", { state: "failed", violations: [{ ruleId: "r1", message: "Missing heading" }], version: 1, checkedAt: "2026-10-21T00:00:00.000Z", rulesFp: "y" });
    const ctx = (id) => ({ accountId: CHECKER, extension: { content: { id, type: "page", space: { key: "WF" } }, space: { key: "WF" } } });
    const read = async (id) => JSON.stringify(await vActions.get("get-validation-state")({ payload: { pageId: id }, context: ctx(id) }));
    const before = [await read("1003"), await read("1006"), await read("1001")];
    await scrub.runValidationMirrorScrub({ budgetMs: 60000 });
    const after = [await read("1003"), await read("1006"), await read("1001")];
    eq("[8] the panel answers exactly as before for a KVS status, an old-property-only page and a page with neither", after, before);
    ok("[8] ...and the KVS status still shows its violation", after[0].includes("Missing heading"));
  }
  // 9. Erasure: a closed person is not marked erased while the scrub is unfinished; the sweep never runs it inline.
  {
    const { searchCalls } = site(9);
    await kvs.set("app-account-id", APP);
    await kvs.set("validation-state-1003", { state: "passed", violations: [], version: 1, checkedBy: ADMIN });
    const reportClosed = async (batch) => batch.map((a) => ({ accountId: a.accountId, status: a.accountId === ADMIN ? "closed" : "ok" }));
    const s1 = await worker.runPrivacySweep({ reason: "test", report: reportClosed });
    ok("[9] the sweep ran and reported", s1.ok === true && s1.accounts.reporting === "done");
    eq("[9] ...without walking the site itself", searchCalls.n, 0);
    const idx1 = await kvs.get("privacy-accounts-0000");
    ok("[9] the closed person is marked closed", !!idx1?.[ADMIN]?.c);
    eq("[9] ...but NOT erased while the scrub is unfinished", idx1?.[ADMIN]?.x ?? null, null);
    const r = await worker.runValidationMirrorScrubLocked({ budgetMs: 60000 });
    ok("[9] the scrub finishes in its own run", r.done === true);
    const s2 = await worker.runPrivacySweep({ reason: "test", report: reportClosed });
    ok("[9] the sweep after it", s2.ok === true && s2.validationMirror?.done === true);
    const idx2 = await kvs.get("privacy-accounts-0000");
    ok("[9] ...and only then is the person marked erased", !!idx2?.[ADMIN]?.x);
  }
  // 11. An archived page cannot be changed (Confluence answers 404/403): counted, no retry rounds, and
  // cleaned by the unarchive trigger the moment it is a page again.
  {
    const { w } = site(12);
    onConfluence((method, rawPath) => (method === "PUT" && decodeURIComponent(rawPath).includes("/pages/2001/properties/") ? { status: 404, body: {} } : undefined));
    const r = await scrub.runValidationMirrorScrub({ budgetMs: 60000, rand: () => 0 });
    eq("[11] the job finishes without retry rounds", [r.done, r.skipped, r.archivedLeft], [true, 0, 1]);
    ok("[11] ...the archived page still holds its old property (Confluence refused)", ids(propOf(w, "2001")).length > 0);
    fake.handlers.pop(); // the page left the archive
    const { pageUnarchivedTrigger } = await import("../src/boot.js");
    await pageUnarchivedTrigger({ eventType: "avi:confluence:unarchived:page", content: { id: "2001" } });
    eq("[11] the unarchive trigger cleans it", ids(propOf(w, "2001")).length, 0);
    eq("[11] ...and a clean page is left alone", await scrub.scrubOnePageMirror("2001"), "clean");
  }
  // 10. Pure helpers.
  {
    eq("[10] an old property needs the scrub", scrub.mirrorNeedsScrub(old()), true);
    eq("[10] a mirror does not", scrub.mirrorNeedsScrub({ state: "passed", violations: [], approved: true, rulesFp: "x" }), false);
    eq("[10] nothing to scrub in a non-object", [scrub.mirrorNeedsScrub(null), scrub.mirrorNeedsScrub([1]), scrub.mirrorNeedsScrub("x")], [false, false, false]);
    eq("[10] the cursor of a next link", scrub.cursorOf("/rest/api/search?next=true&cursor=abc%3D&limit=100"), "abc=");
    eq("[10] no next link, no cursor", scrub.cursorOf(undefined), null);
    eq("[10] back-off steps", [0, 300, 600, 2400, 3600].map(scrub.nextBackoffS), [300, 600, 1200, 3600, 3600]);
  }
} finally {
  Object.assign(console, log);
}
report("validation-mirror-scrub");
