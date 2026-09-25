import { groupSealedFiles, groupSealedSections, SEALED_GROUPS, capItems, GROUP_LIMIT } from "../src/ui/kit/sealed-groups.js";
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

// Folding a group at 12 (owner, 2026-09-24).
const many = Array.from({ length: 29 }, (_, i) => i);
eq("limit is 15", GROUP_LIMIT, 15);
eq("folded: first 15", capItems(many, false).visible, many.slice(0, 15));
eq("folded: 14 hidden", capItems(many, false).hidden, 14);
eq("expanded: all 29", capItems(many, true).visible.length, 29);
eq("expanded still reports what folding hides", capItems(many, true).hidden, 14);
eq("15 exactly: no toggle", capItems(many.slice(0, 15), false).hidden, 0);
eq("a custom limit (the panel's files-per-page)", capItems(many, false, 10).visible.length, 10);
eq("bad input", capItems(null, false), { visible: [], hidden: 0 });

eq("held file with a grant → others (grants frozen on an Approved page)", ids(groupSealedFiles([f("h", "HELD", { workflowHeld: true })], { h: { status: "granted" } }, now).others), ["h"]);
eq("held section with a grant → others", groupSealedSections([{ sectionId: "z", workflowHeld: true }], { z: { status: "granted" } }).others.length, 1);

report("sealed-groups");
