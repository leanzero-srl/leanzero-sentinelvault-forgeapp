// The tracker's LISTED SYNC (2026-10-22): the door's `post` runs the tracker while a version still waits for Marketplace
// approval, so SVT-149 and SVT-150 kept saying "waiting for Marketplace approval" after the Marketplace listed 8.19.0.
// The try-first watcher now runs `release-gate.mjs listed <version>` once per newly listed build, and
// coverage.mjs listedSyncVerdict lets it write ONLY what a listing changes. Pinned here:
//  - the real 2026-10-22 plan (8.19.0 released + SVT-149/150 descriptions) passes, and names what it releases;
//  - an in-sync plan passes with nothing to write;
//  - a create, an adopt, another field, a version above the listed one, a description of an issue whose version is not
//    released by this listing, an unknown line, or a plan with no site check all REFUSE (nothing unreviewed is published);
//  - release-gate.mjs has the `listed` command, refuses off main or with dirty tracker files, and writes only after the verdict.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ok, eq, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = await import(pathToFileURL(path.join(root, "scripts/public-tracker/coverage.mjs")).href);
const V = C.listedSyncVerdict;

const HEAD = "versions (Marketplace) 8.18.0 released 2026-10-22, 8.19.0 released 2026-10-22\nWITHHELD 8.18.0 fixes 597ca43774416fb5: the review pass did not answer\nsite check (read-only): project SVT exists as \"Sentinel Vault Public Tracker\" (this tracker); scheme \"Sentinel Vault Public Tracker permissions\" exists (id 10265).\n";
const VER = "  version 8.19.0: update released,releaseDate,description -> \"Sentinel Vault 8.19.0\"\n";
const I150 = "  SVT-150 update    description                      8.19.0 A sealed file whose page was deleted from the trash disappears from your own list of sealed files\n";
const I149 = "  SVT-149 update    description                      8.19.0 On sites with many pages in workflows, the hourly workflow check can keep starting again at the same place\n";
const TAIL = "review file /x/scripts/public-tracker/review-2026-10-22-4.md\n";

const real = V(HEAD + VER + I150 + I149 + TAIL, "8.19.0");
ok("the real 8.19.0 listing diff (version released + SVT-149/150 descriptions) passes", real.ok === true);
eq("it names the version it releases", real.versions, ["8.19.0"]);
eq("it names the issues it updates", real.issues, ["SVT-150", "SVT-149"]);
eq("it counts the writes", real.changes, 3);
const quiet = V(HEAD + "  NOT WANTED (left as is): SVT-9 something\n" + TAIL, "8.19.0");
ok("an in-sync plan passes with nothing to write (NOT WANTED lines write nothing)", quiet.ok === true && quiet.changes === 0);
ok("an unlisted version reached via the listed one may go released with it",
  V(HEAD + "  version 8.18.0: update released,releaseDate,description -> \"Sentinel Vault 8.18.0 (not listed on the Marketplace; comes with 8.19.0)\"\n" + VER + I150, "8.19.0").ok === true);

const refuses = (label, text, listed = "8.19.0") => { const r = V(text, listed); ok(`refuses ${label}`, r.ok === false && typeof r.why === "string" && r.why.length > 0); };
refuses("a plan with no site check", VER + I150);
refuses("a new issue (an unreviewed row)", HEAD + VER + "  (new)   create    -                                8.19.0 Some new public text\n");
refuses("an adopt", HEAD + VER + "  SVT-151 adopt     summary                          8.19.0 X\n");
refuses("an issue field other than the description", HEAD + VER + "  SVT-150 update    summary,description              8.19.0 X\n");
refuses("a status transition", HEAD + VER + "  SVT-150 transition status                           8.19.0 X\n");
refuses("a description of an issue whose version this listing does not release", HEAD + I150);
refuses("an issue of another version than the one released", HEAD + VER + "  SVT-140 update    description                      8.14.0 X\n");
refuses("a version above the listed one", HEAD + "  version 8.20.0: update released,releaseDate,description -> \"Sentinel Vault 8.20.0\"\n");
refuses("a version that goes UNreleased", HEAD + "  version 8.19.0: update description -> \"Sentinel Vault 8.19.0 (waiting for Marketplace approval)\"\n");
refuses("a version create", HEAD + "  version 8.19.0: create  -> \"Sentinel Vault 8.19.0\"\n");
refuses("an unknown indented line", HEAD + VER + "  something the tracker never printed before\n");
refuses("another project's key", HEAD + VER + "  CRT-150 update    description                      8.19.0 X\n");
refuses("a bad listed version", HEAD + VER, "latest");

const gate = fs.readFileSync(path.join(root, "scripts/public-tracker/release-gate.mjs"), "utf8");
const at = gate.indexOf('cmd === "listed"');
const body = gate.slice(at, gate.indexOf('cmd === "check"'));
ok("release-gate.mjs has the `listed` command", at > 0);
ok("`listed` refuses off main and with dirty tracker files before reading anything",
  /branch !== "main"/.test(body) && /status", "--porcelain", "--", REL\(HERE\)/.test(body) && body.indexOf("branch !== \"main\"") < body.indexOf("plan\", \"--check-site\""));
ok("`listed` writes (apply) only after listedSyncVerdict passed",
  body.indexOf("listedSyncVerdict(") > 0 && body.indexOf("listedSyncVerdict(") < body.indexOf("[\"apply\"]") && /if \(!v\.ok\)[^\n]*process\.exit\(4\)/.test(body));
ok("`listed` deletes the review file its plan wrote (not a record of the sync)", /rmSync\(join\(HERE, f\)/.test(body));

report("tracker-listed-sync");
