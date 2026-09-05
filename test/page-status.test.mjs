// Where a page IS, classified from the two batch lookups (current+archived / trashed). The rule
// that matters: "missing" — the only answer that licenses a purge — needs BOTH calls to have
// succeeded; a failed call yields "unknown", never "missing".
import { classifyPageStatuses, PAGE_STATUS_BATCH } from "../src/server/shared/page-status.js";
import { eq, ok, report } from "./_assert.mjs";

const live = [{ id: "1", status: "current", title: "One", _links: { webui: "/x/1" } }, { id: 4, status: "archived", title: "Four" }];
const gone = [{ id: "2", status: "trashed", title: "Two" }];
const m = classifyPageStatuses(["1", "2", "3", 4], live, gone);
eq("current page", m.get("1"), { status: "current", title: "One", url: "/x/1" });
eq("trashed page keeps its title", m.get("2"), { status: "trashed", title: "Two", url: null });
eq("in neither list → missing (both calls ok)", m.get("3").status, "missing");
eq("archived counts as present, with its own status", m.get("4").status, "archived");
ok("numeric ids are keyed as strings", m.has("4") && !m.has(4));

const u1 = classifyPageStatuses(["3"], [], [], { liveOk: false, trashedOk: true });
eq("a failed LIVE call → unknown, never missing", u1.get("3").status, "unknown");
const u2 = classifyPageStatuses(["3"], [], [], { liveOk: true, trashedOk: false });
eq("a failed TRASHED call → unknown, never missing", u2.get("3").status, "unknown");
const u3 = classifyPageStatuses(["1"], live, [], { liveOk: true, trashedOk: false });
eq("…but a page the live call DID return is current even when the trashed call failed", u3.get("1").status, "current");
eq("batch size is the API's cap", PAGE_STATUS_BATCH, 250);
eq("empty input → empty map", classifyPageStatuses([], [], []).size, 0);
report("page-status");
