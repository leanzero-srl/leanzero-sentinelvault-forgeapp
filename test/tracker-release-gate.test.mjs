// The public tracker gate's rules (scripts/public-tracker/coverage.mjs), which scripts/deploy-prod.sh applies through
// scripts/public-tracker/release-gate.mjs before a production release (owner 2026-10-20: "the release notes should
// always get updated"). The door itself is run end to end in test/deploy-door.test.mjs. Pinned here:
//  - a note line with no entries.mjs row is named (version, kind, key, line); a withheld, rewritten or folded row
//    covers its line; an earlier untagged release shipped with this one is checked too; lines before 6.4.0 are not;
//  - a release with no note refuses; the receipt's CLEAN verify must reach the newest release tag (none, an older
//    one, or a verify with failures refuses);
//  - newestReleaseTag reads `git tag --list` numerically and ignores anything that is not vX.Y.Z;
//  - the real repository: every note line through the newest release tag has a row, and the tracker's
//    LAST_VERSION is derived from the tags (no hand-raised constant).
import { execFileSync } from "node:child_process";
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
ok("a receipt verified only through an older release refuses, naming the newest tag", /not applied and verified for 9\.0\.0/.test(verdict({ receipt: { verified: { through: "8.12.0", failures: 0 } } }) || ""));
ok("no clean verify recorded refuses", /is not recorded/.test(verdict({ receipt: {} }) || ""));
ok("a verify that found failures does not count", /is not recorded/.test(verdict({ receipt: { verified: { through: "9.0.0", failures: 1 } } }) || ""));
ok("the refusal says what to run", /tracker\.mjs apply && .*verify && .*public --reprove/.test(verdict({ receipt: {} }) || ""));
eq("newestReleaseTag: numeric, vX.Y.Z only", C.newestReleaseTag("v8.9.0\nv8.12.0\nv8.10.0\napache-2.0\nv9.0.0-rc1\n"), [8, 12, 0]);
eq("newestReleaseTag: no tag = null, never a guess", C.newestReleaseTag(""), null);
ok("the post-deploy text names the tag to cut, the commands and the receipt", /git tag -a v9\.1\.0/.test(C.trackerPostDeploySteps("9.1.0")) && /tracker\.mjs verify/.test(C.trackerPostDeploySteps("9.1.0")) && /receipt-leanzero-demo\.json/.test(C.trackerPostDeploySteps("9.1.0")));

// the real repository
const { RELEASE_NOTES } = await import(pathToFileURL(path.join(root, "src/server/shared/release-notes.js")).href);
const { ENTRIES } = await import(pathToFileURL(path.join(root, "scripts/public-tracker/entries.mjs")).href);
const tags = execFileSync("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"], { cwd: root, encoding: "utf8" });
const through = C.newestReleaseTag(tags);
if (through) {
  const miss = C.missingRows(C.trackedNotes(RELEASE_NOTES, through), ENTRIES);
  ok(`every note line through ${through.join(".")} (the newest release tag) has a tracker row; missing: ${miss.map((m) => `${m.version} ${m.h}`).join(", ")}`, miss.length === 0);
} else {
  console.log("tracker-release-gate: no release tags in this checkout (shallow CI clone); the real-repository coverage check is skipped");
}
const src = fs.readFileSync(path.join(root, "scripts/public-tracker/tracker.mjs"), "utf8");
ok("the tracker's LAST_VERSION follows the newest release tag, not a hand-raised constant", /const LAST_VERSION = newestReleaseTag\(/.test(src) && !/const LAST_VERSION = \[\d/.test(src));
const door = fs.readFileSync(path.join(root, "scripts/deploy-prod.sh"), "utf8");
ok("the production door runs the gate before the build and prints the tracker step after eligibility",
  door.indexOf("release-gate.mjs check") > 0 && door.indexOf("release-gate.mjs check") < door.indexOf("npm run build")
  && door.indexOf("release-gate.mjs post") > door.indexOf("Eligible for Runs on Atlassian"));

report("tracker-release-gate");
