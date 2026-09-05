// A1: the activity formatter covers EVERY type string in the design contract, and the shared
// list here must equal the server's ACTIVITY_TYPES — a type added on one side without the other
// would render as a raw "seal.foo" string to users.
import { ACTIVITY_TYPES as SERVER_TYPES } from "../src/server/infra/activity-log.js";
import {
  ACTIVITY_CATEGORIES, ACTIVITY_TYPES, activityToCsv, categoryOf, formatActivity, pageTitleOf, relativeTime,
} from "../src/ui/kit/activity-format.js";
import { eq, ok, report } from "./_assert.mjs";

eq("UI and server type lists agree", [...ACTIVITY_TYPES].sort(), [...SERVER_TYPES].sort());
eq("five categories in display order", ACTIVITY_CATEGORIES.map((c) => c.label), ["Seals", "Sections", "Edit access", "Workflow", "Validation"]);
eq("no type maps to two categories", new Set(ACTIVITY_TYPES).size, ACTIVITY_TYPES.length);

const base = (type, extra = {}) => ({
  id: "x", ts: "2026-09-05T10:00:00.000Z", type, pageId: "100100", spaceKey: "SV",
  actor: { accountId: "a1", name: "Alice Stone" },
  target: { kind: "attachment", id: "att1", name: "Q3-budget.xlsx" },
  details: {}, version: 7, ...extra,
});

for (const type of ACTIVITY_TYPES) {
  const f = formatActivity(base(type));
  ok(`${type}: sentence is a real sentence`, typeof f.sentence === "string" && f.sentence.length > 12 && !f.sentence.includes(type));
  ok(`${type}: label`, typeof f.label === "string" && f.label.length > 2 && !f.label.includes("."));
  ok(`${type}: glyph`, typeof f.glyph === "string" && f.glyph.length > 0);
  ok(`${type}: tone is known`, ["seal", "positive", "caution", "critical", "info", "neutral"].includes(f.tone));
  eq(`${type}: category matches the chip mapping`, f.category, categoryOf(type));
  ok(`${type}: no internal vocabulary`, !/realm|guild|artifact|operator/i.test(f.sentence + f.label));
}

// The example sentences the design names.
const ext = formatActivity(base("seal.extended", { details: { expiresAt: "2026-09-12T14:30:00.000Z" } }));
ok("seal.extended names file, date and actor", /^Seal on Q3-budget\.xlsx extended to .*2026.* by Alice Stone$/.test(ext.sentence));
const dec = formatActivity(base("workflow.approval-decided", { details: { decision: "approved", toName: "Approved", versionAtDecision: 7 } }));
eq("approval-decided (approved)", dec.sentence, "Alice Stone approved moving to Approved (v7)");
const den = formatActivity(base("workflow.approval-decided", { details: { decision: "denied", toName: "Approved", versionAtDecision: 7 } }));
eq("approval-decided (denied)", den.sentence, "Alice Stone denied moving to Approved (v7)");
eq("denied is critical", den.tone, "critical");

// The app as actor.
const auto = formatActivity(base("seal.auto-released", { actor: { accountId: null, name: null } }));
ok("null actor never prints 'null'", !/null|undefined/.test(auto.sentence));
const sec = formatActivity(base("section.sealed", { target: { kind: "section", id: "s1", name: "Decision Log" } }));
eq("section title is quoted", sec.sentence, "Alice Stone sealed section “Decision Log”");
const gateOk = formatActivity(base("validation.gate", { details: { state: "passed" } }));
eq("gate passed is positive", gateOk.tone, "positive");
const gateBad = formatActivity(base("validation.gate", { details: { state: "failed", violations: ["Budget table required"] } }));
ok("gate failed lists violations", gateBad.sentence.includes("Budget table required"));
const unknown = formatActivity(base("seal.something-new"));
ok("unknown type degrades, never throws", unknown.sentence.length > 0 && unknown.category === "seals");
ok("missing everything degrades", formatActivity({}).sentence.length > 0);

// relativeTime
const now = Date.parse("2026-09-05T12:00:00.000Z");
eq("just now", relativeTime("2026-09-05T11:59:40.000Z", now), "just now");
eq("minutes", relativeTime("2026-09-05T11:35:00.000Z", now), "25m ago");
eq("hours", relativeTime("2026-09-05T09:00:00.000Z", now), "3h ago");
eq("days", relativeTime("2026-09-03T12:00:00.000Z", now), "2d ago");
eq("weeks", relativeTime("2026-08-15T12:00:00.000Z", now), "3w ago");
ok("old dates become a plain date", /2026/.test(relativeTime("2026-01-05T12:00:00.000Z", now)));
eq("future (clock skew)", relativeTime("2026-09-05T12:05:00.000Z", now), "in 5m");
eq("empty", relativeTime(null, now), "");

// pageTitleOf + CSV
eq("page-targeted event lends its name", pageTitleOf(base("workflow.transition", { target: { kind: "page", id: "100100", name: "Q3 Plan" } })), "Q3 Plan");
eq("explicit pageTitle wins", pageTitleOf({ pageTitle: "T", target: { kind: "page", name: "N" } }), "T");
const csv = activityToCsv([base("seal.created", { details: { expiresAt: "2026-09-12T00:00:00.000Z" } })]);
const [head, row] = csv.split("\r\n");
eq("csv header", head, '"ts","type","category","pageId","pageTitle","actorAccountId","actorName","targetKind","targetId","targetName","version","details"');
ok("csv row carries the details as escaped JSON", row.includes('"{""expiresAt"":""2026-09-12T00:00:00.000Z""}"') && row.startsWith('"2026-09-05T10:00:00.000Z","seal.created","seals","100100"'));

report("activity-format");
