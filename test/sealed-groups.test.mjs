import { groupSealedFiles, groupSealedSections, SEALED_GROUPS, groupWindow, GROUP_LIMIT } from "../src/ui/kit/sealed-groups.js";
import { eq, report } from "./_assert.mjs";

const now = Date.parse("2026-09-24T12:00:00Z");
const f = (id, lockStatus, extra = {}) => ({ id, lockStatus, ...extra });
const files = [f("a", "HELD"), f("b", "HELD_BY_ACTOR"), f("c", "HELD"), f("d", "HELD"), f("e", "HELD_BY_ACTOR"), f("g", "HELD")];
const status = {
  a: { status: "granted", expiresAt: "2026-09-24T15:00:00Z" },
  c: { status: "pending" },
  d: { status: "granted", expiresAt: "2026-09-24T11:00:00Z" }, // ended an hour ago
  g: { status: "denied" },
};
const g = groupSealedFiles(files, status, now);
const ids = (xs) => xs.map((x) => x.id);
eq("order from the ticket", SEALED_GROUPS.map((x) => x.id), ["mine", "editNow", "others"]);
eq("mine: sealed by you, input order kept", ids(g.mine), ["b", "e"]);
eq("editNow: live grant only", ids(g.editNow), ["a"]);
eq("others: pending, lapsed grant, declined", ids(g.others), ["c", "d", "g"]);
eq("grant with no end → edit now", ids(groupSealedFiles([f("x", "HELD")], { x: { status: "granted" } }, now).editNow), ["x"]);
eq("unknown status → others (Request edit)", ids(groupSealedFiles([f("x", "HELD")], {}, now).others), ["x"]);
eq("every file lands exactly once", g.mine.length + g.editNow.length + g.others.length, files.length);
eq("empty / bad input", groupSealedFiles(null), { mine: [], editNow: [], others: [] });

// Sections: the same three groups, keyed by sectionId.
const secs = [{ sectionId: "s1", isMine: true }, { sectionId: "s2" }, { sectionId: "s3" }, { sectionId: "s4", isExpired: true }];
const sg = groupSealedSections(secs, { s2: { status: "granted" }, s3: { status: "pending" } });
eq("sections: mine", sg.mine.map((x) => x.sectionId), ["s1"]);
eq("sections: edit now", sg.editNow.map((x) => x.sectionId), ["s2"]);
eq("sections: others (pending, expired)", sg.others.map((x) => x.sectionId), ["s3", "s4"]);
eq("sections: bad input", groupSealedSections(undefined), { mine: [], editNow: [], others: [] });

// A group pages 5 at a time (owner, 2026-09-29).
const many = Array.from({ length: 16 }, (_, i) => i);
eq("limit is 5", GROUP_LIMIT, 5);
const w0 = groupWindow(many, 5);
eq("first window: 5 shown", w0.visible, many.slice(0, 5));
eq("first window: 11 hidden, next step 5", [w0.hidden, w0.more], [11, 5]);
eq("first window: Show all offered, Show fewer not", [w0.canAll, w0.canFewer], [true, false]);
const w1 = groupWindow(many, 15);
eq("third window: 15 shown, last step 1", [w1.visible.length, w1.more], [15, 1]);
eq("one step left: no Show all", w1.canAll, false);
const wAll = groupWindow(many, 16);
eq("all shown: nothing hidden, Show fewer", [wAll.hidden, wAll.canFewer], [0, true]);
eq("5 exactly: no footer actions", (({ hidden, canFewer }) => [hidden, canFewer])(groupWindow(many.slice(0, 5), 5)), [0, false]);
eq("custom step (the panel's items per page)", groupWindow(many, 10, 10).visible.length, 10);
eq("bad input", groupWindow(null, 5).visible, []);

report("sealed-groups");
