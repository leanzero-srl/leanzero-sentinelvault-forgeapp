// The public tracker's coverage rules (scripts/public-tracker/coverage.mjs). Since 2026-10-20 (owner: "the release notes
// in app need to be done automatically") the production door no longer refuses on them: release-gate.mjs prepare WRITES
// what is missing and `check` only reports. The door itself is run end to end in test/deploy-door.test.mjs. Pinned here:
//  - a note line with no entries.mjs row is named (version, kind, key, line); a withheld, rewritten or folded row
//    covers its line; an earlier untagged release shipped with this one is checked too; lines before 6.4.0 are not;
//  - a release with no note refuses; on a FORWARD cut the receipt's CLEAN verify must reach the release production
//    carries (none, an older one, or a verify with failures refuses); a redeploy or rollback is not held; no
//    recorded production release refuses;
//  - productionRelease / newestReleaseTag parse strictly;
//  - the real repository: every note line through the recorded production release has a row, and the tracker's
//    LAST_VERSION is read from production-release.json (no hand-raised constant).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ok, eq, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = await import(pathToFileURL(path.join(root, "scripts/public-tracker/coverage.mjs")).href);

const notes = [
  { version: "9.1.0", changes: ["Changed: A."], fixes: ["B was wrong."] },
  { version: "9.0.0", changes: ["New: C."], fixes: [] },
  { version: "6.3.0", changes: ["Before the notes began."], fixes: [] },
];
const all = { [C.hashOf("Changed: A.")]: ["A", "X"], [C.hashOf("B was wrong.")]: ["B", "X", { withhold: "guard topic" }], [C.hashOf("New: C.")]: ["C", "X", { d: "rewrite" }] };
const receipt = { verified: { through: "9.0.0", failures: 0 } };
const verdict = (o) => C.trackerReleaseRefusal({ release: "9.1.0", notes, entries: all, live: [9, 0, 0], receipt, ...o });

eq("covered (written, withheld, rewritten) and caught up: passes", verdict({}), null);
const noB = { ...all }; delete noB[C.hashOf("B was wrong.")];
ok("a missing row is refused, naming version, kind, key and line", /9\.1\.0 fixes [0-9a-f]{16}: B was wrong\./.test(verdict({ entries: noB }) || ""));
const noC = { ...all }; delete noC[C.hashOf("New: C.")];
ok("a missing row in an earlier release shipped with this one is refused too", /9\.0\.0 changes [0-9a-f]{16}: New: C\./.test(verdict({ entries: noC }) || ""));
ok("a line before 6.4.0 is not asked for", !C.missingRows(C.trackedNotes(notes, [9, 1, 0]), all).length);
ok("a release with no note refuses", /has no release note/.test(verdict({ release: "9.2.0" }) || ""));
ok("no release refuses", /not a version number/.test(verdict({ release: undefined }) || ""));
ok("a REDEPLOY of the live release is not held by the receipt", verdict({ release: "9.0.0", live: [9, 0, 0], receipt: {} }) === null);
ok("nor a hotfix or rollback older than production", verdict({ release: "9.0.0", live: [9, 1, 0], receipt: {} }) === null);
ok("no recorded production release refuses (the check is never skipped)", /records no production release/.test(verdict({ live: null }) || ""));
eq("productionRelease: parses the recorded release", C.productionRelease({ release: "8.12.0" }), [8, 12, 0]);
eq("productionRelease: anything else is null", C.productionRelease({ release: "v8.12.0" }), null);
ok("a receipt verified only through an older release refuses, naming the live release", /not applied and verified for 9\.0\.0/.test(verdict({ receipt: { verified: { through: "8.12.0", failures: 0 } } }) || ""));
ok("no clean verify recorded refuses", /is not recorded/.test(verdict({ receipt: {} }) || ""));
ok("a verify that found failures does not count", /is not recorded/.test(verdict({ receipt: { verified: { through: "9.0.0", failures: 1 } } }) || ""));
ok("the refusal says what to run", /tracker\.mjs apply && .*verify && .*public --reprove/.test(verdict({ receipt: {} }) || ""));
eq("newestReleaseTag: numeric, vX.Y.Z only", C.newestReleaseTag("v8.9.0\nv8.12.0\nv8.10.0\napache-2.0\nv9.0.0-rc1\n"), [8, 12, 0]);
eq("newestReleaseTag: no tag = null, never a guess", C.newestReleaseTag(""), null);
ok("the post-deploy text names the recorded release file, the commands and the receipt", /production-release\.json/.test(C.trackerPostDeploySteps("9.1.0")) && /tracker\.mjs verify/.test(C.trackerPostDeploySteps("9.1.0")) && /receipt-leanzero-demo\.json/.test(C.trackerPostDeploySteps("9.1.0")));

// the real repository
const { RELEASE_NOTES } = await import(pathToFileURL(path.join(root, "src/server/shared/release-notes.js")).href);
const { ENTRIES } = await import(pathToFileURL(path.join(root, "scripts/public-tracker/entries.mjs")).href);
const through = C.productionRelease(JSON.parse(fs.readFileSync(path.join(root, "scripts/public-tracker/production-release.json"), "utf8")));
ok("production-release.json records a release", !!through);
const miss = C.missingRows(C.trackedNotes(RELEASE_NOTES, through || [0, 0, 0]), ENTRIES);
ok(`every note line through ${(through || []).join(".")} (the release production carries) has a tracker row; missing: ${miss.map((m) => `${m.version} ${m.h}`).join(", ")}`, miss.length === 0);
const src = fs.readFileSync(path.join(root, "scripts/public-tracker/tracker.mjs"), "utf8");
ok("the tracker's LAST_VERSION is read from production-release.json, not a hand-raised constant", /const LAST_VERSION = productionRelease\(/.test(src) && !/const LAST_VERSION = \[\d/.test(src));
const door = fs.readFileSync(path.join(root, "scripts/deploy-prod.sh"), "utf8");
ok("the production door writes the note and the tracker rows (prepare) before the build, never refusing on them, and runs the tracker step (post) after eligibility",
  door.indexOf("release-gate.mjs prepare") > 0 && door.indexOf("release-gate.mjs prepare") < door.indexOf("npm run build")
  && door.indexOf("release-gate.mjs post") > door.indexOf("Eligible for Runs on Atlassian")
  && !/release-gate\.mjs check/.test(door) && /release-gate\.mjs prepare[^\n]*\|\| echo/.test(door) && /release-gate\.mjs post[^\n]*\|\| echo/.test(door));

report("tracker-release-gate");
