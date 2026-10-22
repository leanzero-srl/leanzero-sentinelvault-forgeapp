// SVT-148: an activity row keeps the title its page had when the event happened, so the space's
// Activity report (and its CSV export, built from the same answer) still names a page deleted from
// the trash. Who may see a RECORDED title, and when:
//   - only when Confluence answered a real 404 for the page (as a page AND as a blog post); a 429, a
//     5xx or a thrown read is "could not tell" and shows the page's id;
//   - only to a Confluence site admin or an admin of the space (a steward the app's own lists name
//     gets the id, and the title is not in the answer at all);
//   - never for a page that now lives in another space, and never when the report's own space could
//     not be looked up (a move cannot be ruled out then);
//   - rows written before titles were recorded have none: they keep showing "Page <id>".
// Runs on the in-memory Forge fake, inside an invocation as registry.js runs every resolver.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const { kvs } = await import("@forge/kvs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const { recordActivity } = await import("../src/server/infra/activity-log.js");
const { getSpaceActivity, getPageActivity } = await import("../src/server/capsules/activity/actions.js");
const { pageTitleOf, activityToCsv } = await import("../src/ui/kit/activity-format.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const APP = "app-account";
const ADMIN = "acct-space-admin";
const SITE_ADMIN = "acct-site-admin";
const NAMED = "acct-named-steward"; // on the app's own steward list, not a Confluence admin
const SPACE = "WF";
const PAGE = "501";
const BLOG = "777";

async function world() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" })
    .addUser(ADMIN, { displayName: "Sam Admin" })
    .addUser(SITE_ADMIN, { displayName: "Sita Site", siteAdmin: true })
    .addUser(NAMED, { displayName: "Nat Named" })
    .addPage(PAGE, { title: "Travel policy", versions: [{ authorId: ADMIN, text: "v1" }] });
  w.spaceAdmins.add(ADMIN);
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set(`admin-settings-space-${SPACE}`, { adminUsers: [NAMED] });
  return w;
}

const event = (pageId = PAGE) => ({ type: "seal.created", pageId, spaceKey: SPACE, actor: { accountId: ADMIN, name: "Sam Admin" }, target: { kind: "attachment", id: "att-1", name: "file.pdf" } });
const record = (pageId) => runInvocation(() => recordActivity(event(pageId)));
const reportFor = async (accountId) => (await runInvocation(() => getSpaceActivity({ payload: { spaceKey: SPACE }, context: { accountId } }))).entries;
const shown = async (accountId) => [...new Set((await reportFor(accountId)).map(pageTitleOf))];
const carriesTitle = async (accountId) => (await reportFor(accountId)).some((e) => "pageTitle" in e);
const spaceRows = () => [...kvsMap().entries()].filter(([k]) => k.startsWith(`activity-space-${SPACE}-`)).map(([, v]) => v);
const kvsMap = () => globalThis.__svForgeFake.kvs;
// Answer `status` for one path from now on (a later handler wins in the fake).
const answer = (re, status) => onConfluence((method, path) => (method === "GET" && re.test(decodeURIComponent(path).split("?")[0]) ? { status, body: {}, headers: { "Retry-After": "0" } } : undefined));
const answerSpaces = (status) => onConfluence((method, path) => (method === "GET" && decodeURIComponent(path).startsWith("/wiki/api/v2/spaces?") ? { status, body: {} } : undefined));

// ── 1. The write: the row keeps the title Confluence gave for the page ──────────────────────────────
{
  const w = await world();
  await record();
  eq("[1] the row keeps the page's title", spaceRows().map((r) => r.pageTitle), ["Travel policy"]);
  w.pages.get(PAGE).title = "T".repeat(400);
  await record();
  ok("[1] a long title is kept to 255 characters", spaceRows().some((r) => r.pageTitle === "T".repeat(255)));
  w.pages.delete(PAGE);
  await record();
  ok("[1] a page the app cannot read when the event happens gets no title", spaceRows().some((r) => !("pageTitle" in r)));
}

// ── 2. Deleted from the trash (404 as a page and as a blog post) ────────────────────────────────────
{
  const w = await world();
  await record();
  eq("[2] while the page exists, every steward sees its current title", [await shown(ADMIN), await shown(NAMED)], [["Travel policy"], ["Travel policy"]]);
  w.pages.get(PAGE).title = "Travel policy 2027";
  eq("[2] a renamed live page shows its current title, not the recorded one", await shown(NAMED), ["Travel policy 2027"]);
  w.pages.delete(PAGE);
  eq("[2] the space admin still sees the deleted page's name", await shown(ADMIN), ["Travel policy"]);
  eq("[2] so does a site admin", await shown(SITE_ADMIN), ["Travel policy"]);
  const csv = activityToCsv(await reportFor(ADMIN)).split("\r\n").slice(1).map((r) => r.split(",")[4]);
  eq("[2] and the CSV's title column", [...new Set(csv)], ['"Travel policy"']);
  eq("[2] a steward the app names sees only the page's id", await shown(NAMED), [`Page ${PAGE}`]);
  eq("[2] ... and the title is not in that steward's answer at all", await carriesTitle(NAMED), false);
}

// ── 3. Confluence did not answer: never the recorded title ─────────────────────────────────────────
for (const status of [429, 500, 503]) {
  const w = await world();
  await record();
  w.pages.delete(PAGE);
  answer(new RegExp(`^/wiki/api/v2/pages/${PAGE}$`), status);
  eq(`[3] page read ${status}: the space admin sees the id`, await shown(ADMIN), [`Page ${PAGE}`]);
  eq(`[3] page read ${status}: no title in the answer`, await carriesTitle(ADMIN), false);
}
{
  // A 404 as a page, but the blog post read fails: still "could not tell".
  const w = await world();
  await record();
  w.pages.delete(PAGE);
  answer(new RegExp(`^/wiki/api/v2/blogposts/${PAGE}$`), 503);
  eq("[3] blog post read 503 after a page 404: the id", await shown(ADMIN), [`Page ${PAGE}`]);
}
{
  // A page that moved away and whose read now fails (the case the review found): no title.
  const w = await world();
  await record();
  w.pages.get(PAGE).spaceId = "7777";
  eq("[3] a moved page is not named", await shown(ADMIN), [`Page ${PAGE}`]);
  answer(new RegExp(`^/wiki/api/v2/pages/${PAGE}$`), 429);
  eq("[3] a moved page whose read is rate limited is not named either", await shown(ADMIN), [`Page ${PAGE}`]);
  eq("[3] ... and its title is not in the answer", await carriesTitle(ADMIN), false);
}

// ── 4. The report's own space could not be looked up: no title can be shown safely ──────────────────
// (A site admin reads the report here: the space-admin check needs the same lookup.)
for (const status of [429, 503]) {
  const w = await world();
  await record();
  answerSpaces(status);
  ok(`[4] space lookup ${status}: the site admin still gets the rows`, (await reportFor(SITE_ADMIN)).length > 0);
  eq(`[4] space lookup ${status}: a live page is not named (a move cannot be ruled out)`, await shown(SITE_ADMIN), [`Page ${PAGE}`]);
  w.pages.delete(PAGE);
  eq(`[4] space lookup ${status}: a deleted page's recorded title is hidden`, await shown(SITE_ADMIN), [`Page ${PAGE}`]);
  eq(`[4] space lookup ${status}: no title in the answer`, await carriesTitle(SITE_ADMIN), false);
}

// ── 5. Rows written before titles were recorded ─────────────────────────────────────────────────────
{
  const w = await world();
  await record();
  for (const [k, v] of kvsMap()) if (k.startsWith("activity-")) { const old = { ...v }; delete old.pageTitle; kvsMap().set(k, old); }
  w.pages.delete(PAGE);
  eq("[5] a row from before the fix still reads Page <id>", await shown(ADMIN), [`Page ${PAGE}`]);
  const csv = activityToCsv(await reportFor(ADMIN)).split("\r\n").slice(1).map((r) => r.split(",")[4]);
  eq("[5] ... and its CSV title cell stays empty", [...new Set(csv)], ['""']);
}

// ── 6. Blog posts: a live post in this space is named; a deleted one like a page ────────────────────
{
  const w = await world();
  let blog = { id: BLOG, spaceId: w.spaceId, title: "Release diary", status: "current" };
  onConfluence((method, path) => {
    const base = decodeURIComponent(path).split("?")[0];
    if (method === "GET" && base === `/wiki/api/v2/blogposts/${BLOG}`) return blog ? { body: blog } : { status: 404, body: {} };
    return undefined;
  });
  await record(BLOG);
  eq("[6] the row keeps the blog post's title", spaceRows().map((r) => r.pageTitle), ["Release diary"]);
  eq("[6] a live blog post in this space is named for every steward", await shown(NAMED), ["Release diary"]);
  blog = null;
  eq("[6] a deleted blog post is named for the space admin", await shown(ADMIN), ["Release diary"]);
  eq("[6] ... and only its id for a steward the app names", await shown(NAMED), [`Page ${BLOG}`]);
}

// ── 7. The page feed is gated on reading the page, as before ────────────────────────────────────────
{
  const w = await world();
  await record();
  w.pages.delete(PAGE);
  w.readers.clear();
  const r = await runInvocation(() => getPageActivity({ payload: { pageId: PAGE }, context: { accountId: NAMED } }));
  eq("[7] a deleted page's feed is not handed to someone who cannot read it", [r.entries.length, r.reason], [0, "Not authorized"]);
}

{
  // The page feed (shown on the page itself) never hands out a recorded title: a page renamed since
  // must not show its old title there.
  const w = await world();
  await record();
  w.pages.get(PAGE).title = "Renamed";
  const r = await runInvocation(() => getPageActivity({ payload: { pageId: PAGE }, context: { accountId: NAMED } }));
  ok("[7] a reader of the page gets its feed", r.entries.length > 0);
  eq("[7] ... without the title the rows recorded", r.entries.some((e) => "pageTitle" in e), false);
}

report("activity-recorded-title");
