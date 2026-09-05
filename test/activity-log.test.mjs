// A1 (ledger #49): the pure core of the activity log — the key builder, the inverted timestamp,
// the type list and the filter predicate. @forge/kvs loads without a Forge runtime (its client
// is built lazily), so the module imports directly like every other suite here; the KVS-backed
// recordActivity/readActivity are proven live by activity-log.spec.ts in forge-live-harness.
import { eq, ok, report } from "./_assert.mjs";
import {
  ACTIVITY_TYPES,
  invertedTs,
  buildActivityKeys,
  matchesActivityFilter,
  activityPagePrefix,
  activitySpacePrefix,
  activitySpaceSegment,
} from "../src/server/infra/activity-log.js";

// --- invertedTs: a LATER event yields a lexicographically SMALLER key ---
const t1 = Date.parse("2026-09-05T10:00:00Z");
const t2 = t1 + 1;            // one millisecond later
const t3 = t1 + 86400000;     // one day later
ok("13-digit fixed width", invertedTs(t1).length === 13 && /^\d{13}$/.test(invertedTs(t1)));
ok("1 ms later sorts before", invertedTs(t2) < invertedTs(t1));
ok("1 day later sorts before", invertedTs(t3) < invertedTs(t2));
ok("string compare (what KVS does) agrees with numeric order",
  [invertedTs(t1), invertedTs(t3), invertedTs(t2)].sort()[0] === invertedTs(t3));
eq("epoch 0 is the ceiling (last)", invertedTs(0), "9999999999999");
eq("garbage timestamp clamps to the ceiling, never throws", invertedTs("nope"), "9999999999999");
eq("negative clamps to 0 → ceiling", invertedTs(-5), "9999999999999");
eq("above the ceiling clamps to 0 (never a negative or 14-digit string)", invertedTs(1e15), "0000000000000");

// --- key shapes for both prefixes ---
const keys = buildActivityKeys({ pageId: "123", spaceKey: "SVSEC1P", tsMs: t1, rand: "abc123" });
eq("page key shape", keys.pageKey, `activity-page-123-${invertedTs(t1)}-abc123`);
eq("space key shape", keys.spaceKey, `activity-space-SVSEC1P-${invertedTs(t1)}-abc123`);
eq("shared id is the key suffix", keys.id, `${invertedTs(t1)}-abc123`);
ok("page key starts with the page prefix", keys.pageKey.startsWith(activityPagePrefix("123")));
ok("space key starts with the space prefix", keys.spaceKey.startsWith(activitySpacePrefix("SVSEC1P")));
eq("no pageId → no page key (space-only event)",
  buildActivityKeys({ pageId: null, spaceKey: "X", tsMs: t1, rand: "r" }).pageKey, null);
eq("no spaceKey → no space key (page-only event)",
  buildActivityKeys({ pageId: "1", spaceKey: null, tsMs: t1, rand: "r" }).spaceKey, null);
eq("empty-string spaceKey counts as absent",
  buildActivityKeys({ pageId: "1", spaceKey: "", tsMs: t1, rand: "r" }).spaceKey, null);
// A personal space key (~accountId) is not a legal KVS key segment — sanitized, and the reader
// prefix sanitizes identically so the two always agree.
eq("personal space key sanitized", activitySpaceSegment("~712020:abc"), "_712020:abc");
ok("writer and reader agree on the sanitized segment",
  buildActivityKeys({ pageId: null, spaceKey: "~712020:abc", tsMs: t1, rand: "r" }).spaceKey
    .startsWith(activitySpacePrefix("~712020:abc")));
// Two events one ms apart on the same page: the newer one's key sorts first under the prefix.
const older = buildActivityKeys({ pageId: "9", spaceKey: "S", tsMs: t1, rand: "zzzzzz" }).pageKey;
const newer = buildActivityKeys({ pageId: "9", spaceKey: "S", tsMs: t2, rand: "aaaaaa" }).pageKey;
ok("newer event key sorts before the older one under the page prefix", newer < older);
ok("page prefixes of different pages never overlap ambiguously (12 vs 123)",
  !activityPagePrefix("123").startsWith(activityPagePrefix("12")));

// --- ACTIVITY_TYPES: frozen, non-empty, unique, dotted-namespaced ---
ok("frozen", Object.isFrozen(ACTIVITY_TYPES));
ok("has entries", ACTIVITY_TYPES.length >= 26);
ok("every type is a non-empty string", ACTIVITY_TYPES.every((t) => typeof t === "string" && t.length > 0));
eq("every type is unique", new Set(ACTIVITY_TYPES).size, ACTIVITY_TYPES.length);
ok("every type is namespace.event", ACTIVITY_TYPES.every((t) => /^[a-z]+\.[a-z-]+$/.test(t)));
for (const must of [
  "seal.created", "seal.released", "seal.forced", "seal.extended", "seal.auto-released",
  "seal.edit-reverted", "seal.trash-restored", "seal.embed-restored", "seal.presentation-restored",
  "seal.deleted", "seal.revert-failed",
  "section.sealed", "section.released", "section.restored", "section.reverted",
  "editreq.requested", "editreq.approved", "editreq.denied", "editreq.revoked",
  "workflow.transition", "workflow.approval-requested", "workflow.approval-decided",
  "workflow.enforced", "workflow.expired",
  "validation.reverted", "validation.gate",
]) ok(`design type present: ${must}`, ACTIVITY_TYPES.includes(must));

// --- matchesActivityFilter: each axis, then the combination ---
const entry = {
  id: "x", ts: "2026-09-05T10:00:00.000Z", type: "seal.created", pageId: "123", spaceKey: "S",
  actor: { accountId: "712020:me", name: "Me" }, target: { kind: "attachment", id: "att1", name: "a.txt" },
  details: {}, version: null,
};
ok("no filter matches", matchesActivityFilter(entry, {}));
ok("undefined filter matches", matchesActivityFilter(entry));
ok("non-entry never matches", !matchesActivityFilter(null, {}));
// types
ok("types: included", matchesActivityFilter(entry, { types: ["seal.created", "seal.released"] }));
ok("types: excluded", !matchesActivityFilter(entry, { types: ["seal.released"] }));
ok("types: empty array = no filter", matchesActivityFilter(entry, { types: [] }));
// since / until (inclusive, ISO or ms)
ok("since: before ts matches", matchesActivityFilter(entry, { since: "2026-09-01T00:00:00Z" }));
ok("since: equal ts matches (inclusive)", matchesActivityFilter(entry, { since: "2026-09-05T10:00:00.000Z" }));
ok("since: after ts excludes", !matchesActivityFilter(entry, { since: "2026-09-06T00:00:00Z" }));
ok("since: ms accepted", matchesActivityFilter(entry, { since: Date.parse("2026-09-01T00:00:00Z") }));
ok("until: after ts matches", matchesActivityFilter(entry, { until: "2026-09-06T00:00:00Z" }));
ok("until: equal ts matches (inclusive)", matchesActivityFilter(entry, { until: "2026-09-05T10:00:00.000Z" }));
ok("until: before ts excludes", !matchesActivityFilter(entry, { until: "2026-09-01T00:00:00Z" }));
ok("garbage since is ignored (no filter), never throws", matchesActivityFilter(entry, { since: "not a date" }));
ok("entry with no ts fails a since filter (fail-closed on bounds)",
  !matchesActivityFilter({ ...entry, ts: undefined }, { since: "2026-09-01T00:00:00Z" }));
// pageId
ok("pageId: match", matchesActivityFilter(entry, { pageId: "123" }));
ok("pageId: numeric vs string compares by value", matchesActivityFilter(entry, { pageId: 123 }));
ok("pageId: mismatch", !matchesActivityFilter(entry, { pageId: "124" }));
ok("pageId: empty string = no filter", matchesActivityFilter(entry, { pageId: "" }));
// actorAccountId
ok("actor: match", matchesActivityFilter(entry, { actorAccountId: "712020:me" }));
ok("actor: mismatch", !matchesActivityFilter(entry, { actorAccountId: "712020:you" }));
ok("actor: app-authored entry (null actor) does not match a named actor",
  !matchesActivityFilter({ ...entry, actor: { accountId: null, name: null } }, { actorAccountId: "712020:me" }));
// combination: every axis must hold at once
const all = { types: ["seal.created"], since: "2026-09-01T00:00:00Z", until: "2026-09-30T00:00:00Z", pageId: "123", actorAccountId: "712020:me" };
ok("combination: all axes pass", matchesActivityFilter(entry, all));
ok("combination: one failing axis (type) fails the whole", !matchesActivityFilter(entry, { ...all, types: ["seal.forced"] }));
ok("combination: one failing axis (page) fails the whole", !matchesActivityFilter(entry, { ...all, pageId: "999" }));
ok("combination: one failing axis (window) fails the whole", !matchesActivityFilter(entry, { ...all, until: "2026-09-02T00:00:00Z" }));
ok("combination: one failing axis (actor) fails the whole", !matchesActivityFilter(entry, { ...all, actorAccountId: "nobody" }));

report("activity-log");
