import { keysetPage, encodeKeysetCursor, decodeKeysetCursor } from "../src/server/shared/pagination.js";
import { eq, ok, report } from "./_assert.mjs";

// it56: keyset pagination for "my sealed files" — stable under concurrent seal/unseal, where the old
// numeric-offset slicing dup'd or skipped items. Items sort by (lockedOn desc, id desc).
const mk = (id, t) => ({ id, lockedOn: new Date(t).toISOString() });
const A = mk("A", 10), B = mk("B", 20), C = mk("C", 30), D = mk("D", 40), E = mk("E", 50);
const all = [A, B, C, D, E]; // sorts desc → E,D,C,B,A

// basic paging covers every item exactly once
{
  const p1 = keysetPage(all, null, 2);
  eq("p1 ids", p1.page.map((x) => x.id).join(","), "E,D");
  ok("p1 hasMore", p1.hasMore);
  eq("p1 total", p1.total, 5);
  const p2 = keysetPage(all, p1.nextCursor, 2);
  eq("p2 ids", p2.page.map((x) => x.id).join(","), "C,B");
  const p3 = keysetPage(all, p2.nextCursor, 2);
  eq("p3 ids", p3.page.map((x) => x.id).join(","), "A");
  ok("p3 no more", !p3.hasMore);
  eq("p3 nextCursor null", p3.nextCursor, null);
}

// DUP prevention: a NEW seal inserted between pages must NOT re-show an already-returned item
{
  const p1 = keysetPage(all, null, 2); // [E,D], anchor D
  const withZ = [...all, mk("Z", 60)]; // Z is newest → sorts to the very top
  const p2 = keysetPage(withZ, p1.nextCursor, 2);
  const ids = p2.page.map((x) => x.id);
  ok("no re-show of already-returned E/D after an insert", !ids.includes("E") && !ids.includes("D"));
  ok("a seal newer than the anchor is not surfaced mid-scroll", !ids.includes("Z"));
  eq("page 2 continues correctly (was: offset shows D again)", ids.join(","), "C,B");
}

// SKIP prevention: an unseal (delete) above the window must NOT skip a still-present item
{
  const p1 = keysetPage(all, null, 2); // [E,D], anchor D
  const withoutE = all.filter((x) => x.id !== "E"); // E unsealed between pages
  const p2 = keysetPage(withoutE, p1.nextCursor, 2);
  ok("still-present C is NOT skipped after an unseal above the window", p2.page.map((x) => x.id).includes("C"));
  eq("page 2 after unseal (was: offset skips C)", p2.page.map((x) => x.id).join(","), "C,B");
}

// tiebreaker: equal timestamps, distinct ids → stable total order, no dup/skip
{
  const items = [mk("a1", 100), mk("a2", 100), mk("a3", 100)];
  const p1 = keysetPage(items, null, 2);
  const p2 = keysetPage(items, p1.nextCursor, 2);
  const seen = [...p1.page, ...p2.page].map((x) => x.id);
  eq("equal-timestamp paging covers all 3 once", [...new Set(seen)].length, 3);
  eq("equal-timestamp no dup (total returned == 3)", seen.length, 3);
}

// defensive: bad/absent lockedOn sorts to the end and doesn't crash
{
  const items = [mk("ok", 100), { id: "bad" }, mk("mid", 50)];
  const p = keysetPage(items, null, 10);
  eq("bad-lockedOn item sorts last, still returned", p.page.map((x) => x.id).join(","), "ok,mid,bad");
}

// cursor codec round-trip + old numeric cursor resets to page 1
{
  eq("encode", encodeKeysetCursor({ t: 40, id: "D" }), "40|D");
  eq("decode round-trip t", decodeKeysetCursor("40|D").t, 40);
  eq("decode round-trip id", decodeKeysetCursor("40|D").id, "D");
  eq("old numeric cursor -> null (one-time page-1 reset)", decodeKeysetCursor("10"), null);
  eq("null cursor -> null", decodeKeysetCursor(null), null);
  eq("encode null -> null", encodeKeysetCursor(null), null);
  eq("id containing a pipe still round-trips (split on FIRST |)", decodeKeysetCursor("40|att|weird").id, "att|weird");
}

report("pagination");
