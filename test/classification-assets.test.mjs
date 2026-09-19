// JSM Assets → classification levels: the pure mapper (owner go 2026-09-19).
import { levelsFromAssetsObjects, colourFromAssets, guessAssetsMapping, slugifyLevelId } from "../src/server/capsules/classification/logic.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) pass++; else { fail++; console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };
const ok = (name, c) => eq(name, !!c, true);

// The wolfaenpak "Classification Level" type, as the AQL answer shapes it (attribute ids 197 rank, 354 colour, 353 guidance).
const obj = (key, label, rank, colour, guidance) => ({
  id: key.split("-")[1], objectKey: key, label,
  attributes: [
    { objectTypeAttributeId: "192", objectAttributeValues: [{ value: label }] },
    { objectTypeAttributeId: "197", objectAttributeValues: [{ value: rank }] },
    { objectTypeAttributeId: "353", objectAttributeValues: [{ value: guidance }] },
    { objectTypeAttributeId: "354", objectAttributeValues: [{ value: colour }] },
  ],
});
const objects = [
  obj("IGOV-107", "CONFIDENTIAL", "3", "orange", "Named audience only."),
  obj("IGOV-106", "INTERNAL", "2", "blue", "Internal use only."),
  obj("IGOV-105", "PUBLIC", "1", "green", "Approved for public release."),
  obj("IGOV-108", "RESTRICTED", "4", "red", "Highest sensitivity."),
];
const mapping = { rank: "197", color: "354", description: "353" };

const r = levelsFromAssetsObjects(objects, mapping);
ok("maps", r.ok);
eq("four levels sorted by rank", r.levels.map((l) => [l.rank, l.name, l.id]), [[1, "PUBLIC", "public"], [2, "INTERNAL", "internal"], [3, "CONFIDENTIAL", "confidential"], [4, "RESTRICTED", "restricted"]]);
eq("colour words map onto the solid palette", r.levels.map((l) => l.color), ["#15803d", "#1d4ed8", "#b45309", "#b91c1c"]);
eq("descriptions ride along", r.levels[0].description, "Approved for public release.");
eq("object keys kept next to each level", r.levels.map((l) => l.assetsObjectKey), ["IGOV-105", "IGOV-106", "IGOV-107", "IGOV-108"]);
eq("no problems on clean data", r.problems, []);

// colour tolerance
eq("hex passes", colourFromAssets("#dc2626"), "#DC2626");
eq("bare hex passes", colourFromAssets("DC2626"), "#DC2626");
eq("unknown word → null", colourFromAssets("chartreuse"), null);
const bad = levelsFromAssetsObjects([obj("X-1", "One", "1", "chartreuse", ""), obj("X-2", "Two", "x", "", "")], mapping);
ok("still imports with problems", bad.ok);
eq("unknown colour → palette + a note", [bad.levels[0].color, bad.problems.length], ["#15803d", 2]);
ok("a non-numeric rank gets a position after the highest given rank", bad.levels[1].rank === 2 && /rank/.test(bad.problems[1]));

// no mapping at all: names from labels, ranks by position, palette colours
const plain = levelsFromAssetsObjects([{ label: "Low" }, { label: "High" }], {});
eq("no mapping → positions and palette", plain.levels.map((l) => [l.rank, l.name, l.color]), [[1, "Low", "#15803d"], [2, "High", "#1d4ed8"]]);

// the rules a hand-typed list obeys still apply
eq("empty type → error", levelsFromAssetsObjects([], mapping).error, "That object type has no objects to import");
ok("duplicate names are refused", !levelsFromAssetsObjects([{ label: "Same" }, { label: "same" }], {}).ok);
ok("duplicate ranks are refused", !levelsFromAssetsObjects([obj("A-1", "A", "1", "", ""), obj("A-2", "B", "1", "", "")], mapping).ok);
ok("more than the allowed number of levels is refused", !levelsFromAssetsObjects(Array.from({ length: 40 }, (_, i) => ({ label: `L${i}` })), {}).ok);

// ids
eq("slug", slugifyLevelId("Highly Confidential (PII)"), "highly-confidential-pii");
eq("slug never empty", slugifyLevelId("!!!"), "level");

// mapping guess from the attribute names
eq("guess", guessAssetsMapping([{ id: "1", name: "Key" }, { id: "2", name: "Rank" }, { id: "3", name: "Handling Guidance" }, { id: "4", name: "Colour" }]), { rank: "2", color: "4", description: "3" });
eq("guess (US spelling, no rank)", guessAssetsMapping([{ id: "9", name: "Color" }]), { rank: null, color: "9", description: null });

console.log(`classification-assets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
