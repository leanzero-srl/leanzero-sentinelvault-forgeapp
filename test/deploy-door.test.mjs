// The production door (scripts/deploy-prod.sh), run for real in a throwaway clone with stand-ins for `forge` and
// `npm`, so no network and nothing is deployed. Pins two rules:
//  - rule zero: a production version that is not eligible for Runs on Atlassian FAILS the door (it used to end in
//    `forge eligibility ... || true` and exit 0);
//  - the licensing guard asks for --licensing-live only for the deploy that turns licensing on: when the last release
//    tag already shipped `licensing.enabled: true`, the door runs without the flag.
//  - release notes and the public tracker are AUTOMATIC (2026-10-20, owner: "the release notes in app need to be done
//    automatically"): a release with no in-app note gets one written from the commits since production (through a
//    stand-in model, and deterministically with the model off) and committed BEFORE the build; a note line with no
//    tracker row gets one instead of a refusal; a line naming an SVT key of a known bug closes it (KNOWN -> CLOSED,
//    and the tracker builds that issue as Done with the release); nothing about notes or the tracker ever refuses;
//    after an eligible deploy the door records the release and runs the tracker's apply, verify and public --reprove
//    itself, and a failing tracker step never changes the door's exit code.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ok, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-door-"));
const repo = path.join(tmp, "repo"), bin = path.join(tmp, "bin");
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=door-test", "-c", "user.email=door-test@invalid", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  execFileSync("git", ["clone", "-q", "--no-hardlinks", root, repo], { stdio: "ignore" });
  // The clone is on a branch whatever the checkout under test is: CI runs a tag on a DETACHED HEAD, and a detached
  // clone reads to the door as a rollback from a tag, so the note-writing cases would fail only there (v8.13.0, 2026-10-21).
  git("checkout", "-q", "-B", "main");
  // the working copy under test (the clone holds the last commit; the door is copied in as it is on disk now)
  for (const f of ["scripts/deploy-prod.sh", "scripts/strip-dev-modules.mjs", "manifest.yml", "scripts/public-tracker/coverage.mjs", "scripts/public-tracker/release-gate.mjs",
    "scripts/public-tracker/tracker.mjs", "scripts/release-autopilot.mjs"]) fs.copyFileSync(path.join(root, f), path.join(repo, f));
  // The tracker gate reads the clone's own rows, receipt and production-release.json: a row for every note line,
  // production recorded one release behind the one being cut, and a receipt verified through it.
  const { hashOf } = await import(pathToFileURL(path.join(root, "scripts/public-tracker/coverage.mjs")).href);
  const { RELEASE_NOTES, CURRENT_RELEASE } = await import(pathToFileURL(path.join(repo, "src/server/shared/release-notes.js")).href);
  const ENTRIES_F = path.join(repo, "scripts/public-tracker/entries.mjs"), RECEIPT_F = path.join(repo, "scripts/public-tracker/receipt-leanzero-demo.json");
  const PROD_F = path.join(repo, "scripts/public-tracker/production-release.json");
  const LIVE = RELEASE_NOTES[1].version, CUT = CURRENT_RELEASE.version; // production carries the release before the one being cut
  const allRows = Object.fromEntries(RELEASE_NOTES.flatMap((n) => [...(n.changes || []), ...(n.fixes || [])]).map((l) => [hashOf(l), ["fixture", "X"]]));
  const writeTracker = (rows, through, live = LIVE) => {
    fs.writeFileSync(ENTRIES_F, `export const ENTRIES = ${JSON.stringify(rows)};\n`);
    fs.writeFileSync(RECEIPT_F, JSON.stringify({ verified: { through, failures: 0 } }));
    fs.writeFileSync(PROD_F, JSON.stringify({ release: live }));
  };
  writeTracker(allRows, LIVE);
  git("add", "-A", "scripts");
  if (git("status", "--porcelain", "--untracked-files=no")) git("commit", "-qam", "door under test");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(repo, "node_modules"));
  for (const t of git("tag", "--list").split("\n").filter(Boolean)) git("tag", "-d", t);
  git("tag", "v98.0.0", "HEAD"); // a release that already shipped licensing (this manifest has it on) ...
  git("commit", "-q", "--allow-empty", "-m", "the change being deployed"); // ... and a newer commit to deploy

  fs.mkdirSync(bin);
  const FORGE_LOG = path.join(tmp, "forge.log");
  fs.writeFileSync(path.join(bin, "forge"), `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(FORGE_LOG)}
case "$1" in
  lint) echo "No issues found."; exit 0 ;;
  deploy) echo "Deployed to production"; exit 0 ;;
  eligibility) printf '%s\\n' "$FAKE_ELIG"; exit "\${FAKE_ELIG_RC:-0}" ;;
esac
exit 0
`, { mode: 0o755 });
  // npm run build: produce every static resource the manifest serves and stamp build-info with HEAD, as webpack would
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/bash
[[ "$1 $2" == "run build" ]] || exit 0
for p in $(sed -n 's/^ *path: *\\(static\\/[^ ]*\\).*/\\1/p' manifest.yml | sort -u); do mkdir -p "$p"; echo ok > "$p/index.html"; done
echo "export const BUILD = \\"$(git rev-parse --short HEAD)\\";" > src/build-info.js
# FAKE_SNEAK: something other than the door changes what Forge packages AFTER the start check and the build (a
# concurrent commit, an edit, a new file), so only the check right before \`forge deploy\` can see it
case "$FAKE_SNEAK" in
  commit) echo "export const sneak = 1;" > src/server/sneak.js; git add src/server/sneak.js; git commit -q -m "not the door" -- src/server/sneak.js ;;
  dirty) echo "// edited during the run" >> src/server/door-test-change.js ;;
  untracked) echo "export const sneak = 1;" > src/server/sneak.js ;;
esac
`, { mode: 0o755 });

  const ELIGIBLE = "The version of your app [98.1.0] that's deployed to [production] is eligible for the Runs on Atlassian program.";
  const NOT = "The version of your app [98.1.0] that's deployed to [production] is not eligible for the Runs on Atlassian program.\n  App is using a webtrigger module that can egress data";
  // The door commits (its note, its tracker rows, the production record after the deploy). The helper keeps what it
  // recorded and wrote in `last` and resets the clone to the commit the case started from, so every case starts clean.
  // The model is OFF (no `claude` call in a test) unless a case points RELEASE_AUTOPILOT_CLAUDE at the stand-in below;
  // the tracker driver is a stand-in that logs its argv; nothing is pushed.
  const TRK_LOG = path.join(tmp, "tracker.log");
  fs.writeFileSync(path.join(bin, "tracker-stub.mjs"), `import fs from "node:fs"; fs.appendFileSync(${JSON.stringify(TRK_LOG)}, process.argv.slice(2).join(" ") + "\\n"); process.exit(process.env.FAKE_TRACKER_FAIL === process.argv[2] ? 1 : 0);\n`);
  // The Marketplace "Try it first" hand-off kicks the workhorse watcher over ssh (or zsh -lc on the workhorse): both are
  // stand-ins here that log the command and print KICK=<code> + the watcher's state (FAKE_PUBLISHER=error: a failing
  // watcher, =gone: the agent is not loaded). Nothing real runs.
  const PUB_LOG = path.join(tmp, "publisher.log");
  for (const name of ["ssh", "zsh"]) fs.writeFileSync(path.join(bin, name), `#!/bin/bash
printf '%s\\n' "${name} $*" >> ${JSON.stringify(PUB_LOG)}
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [[ "$FAKE_PUBLISHER" == "error" ]]; then echo KICK=0; printf '{"lastTickAt":"%s","health":{"status":"fail","detail":"the vendor browser is not signed in"}}\\n' "$NOW";
elif [[ "$FAKE_PUBLISHER" == "gone" ]]; then echo KICK=113; echo '{}';
else echo KICK=0; printf '{"lastTickAt":"%s","health":{"status":"ok"},"apps":{"sv":{"appliedVersion":"98.0.0","appliedBuild":"499"}}}\\n' "$NOW"; fi
exit 0
`, { mode: 0o755 });
  const BASE_ENV = { RELEASE_GATE_MARKETPLACE_FAKE: JSON.stringify({ name: "98.1.0", buildNumber: 500 }), RELEASE_AUTOPILOT_MODEL: "off", RELEASE_GATE_TRACKER: path.join(bin, "tracker-stub.mjs"), RELEASE_GATE_NO_PUSH: "1",
    GIT_AUTHOR_NAME: "door-test", GIT_AUTHOR_EMAIL: "door-test@invalid", GIT_COMMITTER_NAME: "door-test", GIT_COMMITTER_EMAIL: "door-test@invalid" };
  let last = null;
  // Every real run names the commit being released (--sha); by default the commit the case starts from, i.e. the
  // checkout's own HEAD. `{ sha: null }` leaves the flag out, `{ sha: "<x>" }` names something else.
  const door = (env, args = [], { sha } = {}) => {
    const start = git("rev-parse", "HEAD");
    if (sha === undefined) args = [...args, "--sha", start];
    else if (sha !== null) args = [...args, "--sha", sha];
    for (const f of [TRK_LOG, PUB_LOG, FORGE_LOG]) { try { fs.rmSync(f); } catch { /* none */ } }
    const { RELEASE_AUTOPILOT_MODEL: _m, ...outer } = process.env;
    const r = spawnSync("bash", ["scripts/deploy-prod.sh", ...args], { cwd: repo, encoding: "utf8", env: { ...outer, PATH: `${bin}:${outer.PATH}`, ...BASE_ENV, ...env } });
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
    last = { recorded: read(PROD_F), entries: read(ENTRIES_F), notes: read(path.join(repo, "src/server/shared/release-notes.js")), doc: read(path.join(repo, "docs/RELEASE-NOTES.md")),
      tracker: (read(TRK_LOG) || "").trim().split("\n").filter(Boolean), publisher: (read(PUB_LOG) || "").trim().split("\n").filter(Boolean), log: git("log", "--format=%s", `${start}..HEAD`), build: read(path.join(repo, "src/build-info.js")), head: git("rev-parse", "--short", "HEAD"),
      forge: (read(FORGE_LOG) || "").trim().split("\n").filter(Boolean) };
    last.deployed = last.forge.some((l) => /^deploy\b/.test(l));
    last.desired = null;
    if (env.WANT_DESIRED) {
      // the tracker's own desired state in the clone, after the deploy (Marketplace read stubbed: everything is listed)
      const runner = path.join(tmp, "desired.mjs");
      fs.writeFileSync(runner, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ _embedded: { versions: ${JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ name: "", status: "public", release: { date: "2026-10-20" } })))}.map((v, i) => v) } }) });
process.argv[2] = "none";
const M = await import(${JSON.stringify(pathToFileURL(path.join(repo, "scripts/public-tracker/tracker.mjs")).href)});
const d = await M.desired();
console.log("DESIRED" + JSON.stringify(d.issues.filter((i) => i.id === ${JSON.stringify(env.WANT_DESIRED)})));
process.exitCode = 0;
`);
      const dr = spawnSync(process.execPath, [runner], { cwd: repo, encoding: "utf8" });
      const m = /DESIRED(.*)/.exec(dr.stdout || "");
      last.desired = m ? JSON.parse(m[1]) : { error: `${dr.stdout}\n${dr.stderr}`.slice(-600) };
    }
    if (process.env.DOOR_DEBUG) console.log(`---- door ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
    git("reset", "-q", "--hard", start);
    return r;
  };

  let r = door({ FAKE_ELIG: ELIGIBLE });
  ok("eligible production: the door passes", r.status === 0 && /Eligible for Runs on Atlassian/.test(r.stdout));
  ok("licensing already shipped in the last release tag: no flag needed", /production already runs with licensing \(release v98\.0\.0\)/.test(r.stdout));

  r = door({ FAKE_ELIG: NOT });
  ok("NOT eligible: the door fails", r.status === 1 && /FAILED: production was deployed but is NOT eligible/.test(r.stdout));
  ok("NOT eligible: the reason is printed", /webtrigger module that can egress data/.test(r.stdout));

  r = door({ FAKE_ELIG: "Something went wrong", FAKE_ELIG_RC: "1" });
  ok("eligibility command fails: the door fails", r.status === 1 && /FAILED/.test(r.stdout));

  r = door({ FAKE_ELIG: "" });
  ok("no eligibility verdict at all: the door fails", r.status === 1 && /FAILED: production was deployed/.test(r.stdout));

  // the last release ran WITHOUT licensing and the commit being deployed turns it on: the flag is required again
  const mf = path.join(repo, "manifest.yml"), on = fs.readFileSync(mf, "utf8");
  fs.writeFileSync(mf, on.replace(/(\n  licensing:\n    enabled:) true/, "$1 false"));
  git("commit", "-qam", "release without licensing"); git("tag", "v99.0.0", "HEAD");
  fs.writeFileSync(mf, on); git("commit", "-qam", "turn licensing on");
  r = door({ FAKE_ELIG: ELIGIBLE });
  ok("turning licensing on without the flag: the door refuses", r.status === 1 && /ABORT: manifest has app.licensing.enabled: true/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("turning licensing on with --licensing-live: the door passes", r.status === 0);

  // a licensed tag on the commit being deployed proves nothing about production: the flag is still required
  for (const t of git("tag", "--list").split("\n").filter(Boolean)) git("tag", "-d", t);
  git("tag", "v100.0.0", "HEAD");
  r = door({ FAKE_ELIG: ELIGIBLE });
  ok("a release tag on HEAD itself does not lift the licensing guard", r.status === 1 && /ABORT: manifest has app.licensing.enabled: true/.test(r.stdout));

  // RELEASE NOTES AND THE PUBLIC TRACKER, AUTOMATIC (2026-10-20). Licensing is acknowledged with the flag throughout.
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("covered release, caught-up tracker: the door passes", r.status === 0 && /Public tracker: every release-note line through/.test(r.stdout));
  ok("...records the deployed release (and its commit) in production-release.json and commits it", JSON.parse(last.recorded).release === CUT && /^[0-9a-f]{7,}$/.test(JSON.parse(last.recorded).sha) && /public tracker: .* in production/.test(last.log));
  ok("...and runs the tracker's apply, verify and public --reprove ITSELF, after the eligibility verdict", last.tracker.join("|") === "apply|verify|public --reprove"
    && /applied, verified and re-proved public/.test(r.stdout) && r.stdout.indexOf("Public tracker: " + CUT + " applied") > r.stdout.indexOf("Eligible for Runs on Atlassian"));
  ok("...and prints no manual tracker instructions", !/PUBLIC TRACKER \(required/.test(r.stdout) && !/then commit/.test(r.stdout));
  ok("...then hands the Marketplace \"Try it first\" message of the version the deploy reported to the workhorse watcher (one kick, no wait, never the publisher), after the tracker step",
    last.publisher.length === 1 && /launchctl kickstart gui\/\$\(id -u\)\/net\.leanzero\.tryfirst-watcher/.test(last.publisher[0]) && !/mp-more-details-try-first/.test(last.publisher[0])
    && /"Try it first" message is handed to the watcher on the workhorse \(kicked; last tick 0 min ago; sv last confirmed on 98\.0\.0 \(build 499\)\)\. It puts the message on 98\.1\.0/.test(r.stdout) && r.stdout.indexOf("Try it first\" message is handed") > r.stdout.indexOf(`Public tracker: ${CUT} applied`));
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_PUBLISHER: "error" }, ["--licensing-live"]);
  ok("a failing (signed-out) watcher is logged and does NOT fail the deploy", r.status === 0 && /"Try it first" message was NOT handed off \(the watcher is failing: the vendor browser is not signed in\)/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_PUBLISHER: "gone" }, ["--licensing-live"]);
  ok("a watcher that is not installed is logged with the install command, exit 0", r.status === 0 && /NOT handed off \(the watcher is not loaded on the workhorse \(launchctl kickstart exit 113\); install it/.test(r.stdout));

  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_TRACKER_FAIL: "verify" }, ["--licensing-live"]);
  ok("a tracker step that fails does NOT fail the deploy (exit 0), names the step and stops there", r.status === 0 && /stopped at tracker\.mjs verify/.test(r.stdout) && last.tracker.join("|") === "apply|verify"
    && JSON.parse(last.recorded).release === CUT);
  r = door({ FAKE_ELIG: NOT }, ["--licensing-live"]);
  ok("an ineligible deploy still fails, and runs no tracker step and no Marketplace step", r.status === 1 && last.tracker.length === 0 && last.publisher.length === 0);

  const firstLine = [...(CURRENT_RELEASE.changes || []), ...(CURRENT_RELEASE.fixes || [])][0];
  const missing = { ...allRows }; delete missing[hashOf(firstLine)];
  writeTracker(missing, LIVE); git("commit", "-qam", "a release line without a tracker row");
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("a release-note line with no tracker row is NOT refused: the door writes the row and deploys", r.status === 0 && /Deployed to production/.test(r.stdout)
    && last.entries.includes(`"${hashOf(firstLine)}"`) && /public tracker: rows for the release-note lines through/.test(last.log));
  ok("...committed before the build, so the build is of the commit that carries the row", r.stdout.indexOf("Public tracker rows committed") > 0 && r.stdout.indexOf("Public tracker rows committed") < r.stdout.indexOf("Building every bundle"));
  writeTracker(allRows, "1.0.0"); git("commit", "-qam", "tracker verified only through an older release");
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("a tracker not verified through the release production carries is NOT refused: logged, and this deploy's tracker step runs", r.status === 0 && /last clean verify reached 1\.0\.0/.test(r.stdout) && last.tracker.length === 3);
  fs.rmSync(PROD_F); git("commit", "-qam", "no production release recorded");
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("no production-release.json is NOT refused: the door deploys and records the release", r.status === 0 && /Deployed to production/.test(r.stdout) && JSON.parse(last.recorded).release === CUT);
  writeTracker(allRows, LIVE); git("add", "-A", "scripts"); git("commit", "-qq", "-m", "tracker caught up");

  // THE NOTE. Production carries the newest note (CUT) from an earlier commit, and HEAD has a customer-visible commit
  // after it, so the release being cut has no note. The real editorial file and receipt are used from here on.
  for (const f of ["scripts/public-tracker/entries.mjs", "scripts/public-tracker/receipt-leanzero-demo.json"]) fs.copyFileSync(path.join(root, f), path.join(repo, f));
  fs.writeFileSync(PROD_F, JSON.stringify({ release: CUT, at: "2026-10-18" }));
  git("add", "-A", "scripts"); git("commit", "-qm", "production carries the newest note");
  const prodSha = git("rev-parse", "--short=8", "HEAD");
  fs.writeFileSync(PROD_F, JSON.stringify({ release: CUT, at: "2026-10-18", sha: prodSha })); git("commit", "-qam", "production commit recorded");
  const [maj, min] = CUT.split(".").map(Number), NEXT = `${maj}.${min + 1}.0`, MAJOR = `${maj + 1}.0.0`;
  fs.writeFileSync(path.join(repo, "src/server/door-test-change.js"), "export const x = 1;\n"); git("add", "-A", "src"); git("commit", "-qm", "Approvers see the page's classification in the approval dialog");
  // a stand-in for `claude -p`: answers the note prompt, the rows prompt and the review prompt
  fs.writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
let p = ""; process.stdin.on("data", (d) => (p += d)); process.stdin.on("end", () => {
  if (/in-app release note/.test(p)) console.log(JSON.stringify({ headline: "Approvers see the page's classification", changes: [{ text: "New: the approval dialog shows the page's classification.", keys: [] }], fixes: [{ text: "Fixed something in src/server/x.js.", keys: [] }], action: null }));
  else if (/adversarial reviewer/.test(p)) { const rows = JSON.parse(p.slice(p.indexOf("[", p.indexOf("Rows (")), p.lastIndexOf("]", p.indexOf("Answer with ONLY")) + 1)); console.log(JSON.stringify({ verdicts: rows.map((r) => ({ h: r.h, verdict: "ok" })) })); }
  else if (/PUBLIC tracker/.test(p)) { const lines = JSON.parse(p.slice(p.indexOf("[", p.indexOf("Lines (")), p.lastIndexOf("]", p.indexOf("Answer with ONLY")) + 1)); console.log(JSON.stringify({ rows: lines.map((l) => ({ h: l.h, title: "The approval dialog shows the page's classification", c: "W", d: null, withhold: null })) })); }
  else process.exit(1);
});
`, { mode: 0o755 });
  r = door({ FAKE_ELIG: ELIGIBLE, RELEASE_AUTOPILOT_MODEL: "", RELEASE_AUTOPILOT_CLAUDE: path.join(bin, "claude") }, ["--licensing-live"]);
  ok(`no note for the release being cut: the door WRITES it (${NEXT}, from the model stand-in) and deploys`, r.status === 0 && /Deployed to production/.test(r.stdout)
    && last.notes.includes(`version: "${NEXT}"`) && last.notes.includes("New: the approval dialog shows the page's classification.") && JSON.parse(last.recorded).release === NEXT);
  ok("...drops a generated line that would turn the note gate red (a file name)", !last.notes.includes("src/server/x.js"));
  ok("...re-renders docs/RELEASE-NOTES.md and commits the note before the build", last.doc.includes(`## ${NEXT}`) && /release .*: in-app note written by the release door/.test(last.log)
    && r.stdout.indexOf(`Release note ${NEXT} written and committed`) < r.stdout.indexOf("Building every bundle"));
  ok("...and writes the new line's tracker row through the model and the review pass", /rows: model; review pass: model/.test(last.entries) && last.entries.includes("The approval dialog shows the page's classification"));
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live", "--approve-major"]);
  ok(`with the model off the note is written from the commit subjects; --approve-major cuts ${MAJOR}`, r.status === 0 && last.notes.includes(`version: "${MAJOR}"`) && /commit subjects/.test(last.notes)
    && last.notes.includes("Approvers see the page's classification in the approval dialog."));

  // A COMMIT NAMING AN SVT KEY OF A KNOWN BUG CLOSES IT. known-macro-position-focus is SVT-47 in the receipt.
  fs.writeFileSync(path.join(repo, "src/server/door-test-change.js"), "export const x = 2;\n");
  git("commit", "-qam", "Show the keyboard focus outline on the Top and Bottom switches (SVT-47)");
  r = door({ FAKE_ELIG: ELIGIBLE, WANT_DESIRED: "known-macro-position-focus" }, ["--licensing-live"]);
  const closedNote = (last.notes.match(/"[^"\n]*\(SVT-47\)\."/) || [""])[0];
  ok("the generated note line carries the key the commit names", r.status === 0 && !!closedNote);
  ok("...the row FOLDS into the known bug instead of a new issue, and the known bug moves from KNOWN to CLOSED",
    /"fold":"known-macro-position-focus"/.test(last.entries) && /closes SVT-47/.test(last.log)
    && last.entries.indexOf('k: "known-macro-position-focus"') > last.entries.indexOf("export const CLOSED"));
  const d = (last.desired || [])[0] || {};
  // the model is off here, so the fix text was never reviewed: the issue closes with a generic sentence, never the raw line
  ok(`...and the tracker builds SVT-47's issue as a Done Bug with ${NEXT} as its fix version (unreviewed text: the generic sentence) (${JSON.stringify(last.desired).slice(0, 300)})`,
    d.type === "Bug" && d.status === "Done" && d.version === NEXT && !d.known && d.text === "This problem is fixed." && !/SVT-47/.test(d.text));

  // THE DOOR RELEASES THE COMMIT IT IS TOLD TO, OR NOTHING (2026-10-22). A door packages the working tree of the
  // checkout it runs in; when that checkout's HEAD is not the commit that was tested (local main could not
  // fast-forward to the tested branch), it used to deploy the OLDER code with no warning (CogniRunner, two dev
  // redeploys). A real run must name the commit (--sha), HEAD must be exactly it, the packaged paths clean, and right
  // before `forge deploy` the only differences from it may be the files the door itself committed.
  const L = ["--licensing-live"];
  const full = (ref) => git("rev-parse", ref);
  const base = full("HEAD");
  // the stale checkout: `tested` has the newer, tested commit; main has an extra commit `tested` lacks
  git("checkout", "-q", "-b", "tested");
  fs.writeFileSync(path.join(repo, "src/server/door-test-change.js"), "export const x = 3; // the tested code\n"); git("commit", "-qam", "the tested change");
  const testedSha = full("HEAD");
  git("checkout", "-q", "main");
  fs.writeFileSync(path.join(repo, "src/server/main-only.js"), "export const y = 1;\n"); git("add", "-A", "src"); git("commit", "-qm", "a commit only main has");
  const mainSha = full("HEAD");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "tested" });
  ok("STALE CHECKOUT (main diverged from the tested branch), --sha tested: the door refuses and never reaches forge deploy", r.status === 1 && !last.deployed && /DIVERGED/.test(r.stdout));
  ok("...naming both full shas and the way out (merge, then fast-forward)", r.stdout.includes(testedSha) && r.stdout.includes(mainSha) && /merge/i.test(r.stdout) && /fast-forward/i.test(r.stdout));
  ok("...before anything was written, committed or built", last.log === "" && !/Building every bundle/.test(r.stdout) && !/Release notes and public tracker/.test(r.stdout) && last.forge.length === 0);
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: testedSha });
  ok("...the same with the tested commit's full sha", r.status === 1 && !last.deployed && /DIVERGED/.test(r.stdout));
  git("reset", "-q", "--hard", base); // main is now simply BEHIND tested
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "tested" });
  ok("main BEHIND the named commit: refused, says BEHIND and to fast-forward, names both shas", r.status === 1 && !last.deployed && /BEHIND/.test(r.stdout) && /fast-forward/i.test(r.stdout)
    && r.stdout.includes(testedSha) && r.stdout.includes(base));
  git("checkout", "-q", "tested");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: base });
  ok("checkout AHEAD of the named commit: refused, says AHEAD, names both shas", r.status === 1 && !last.deployed && /AHEAD/.test(r.stdout) && r.stdout.includes(testedSha) && r.stdout.includes(base));
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "tested" });
  ok("in the tested checkout, --sha tested (branch name): HEAD matches, the door deploys", r.status === 0 && last.deployed && /Deployed to production/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: testedSha.slice(0, 10) });
  ok("...and with a short hex sha", r.status === 0 && last.deployed);
  git("checkout", "-q", "main"); git("branch", "-q", "-D", "tested");

  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: null });
  ok("a real run with no --sha: refused before anything, says --sha is needed and prints HEAD", r.status === 1 && !last.deployed && last.forge.length === 0 && /--sha/.test(r.stdout) && r.stdout.includes(base));
  for (const bad of ["HEAD", "@", "HEAD~1", "HEAD^", "@~1", "@{-1}", "ORIG_HEAD", "main~1"]) {
    r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: bad });
    ok(`--sha ${bad}: refused (it means "whatever is checked out", or is not a sha or a branch)`, r.status === 1 && !last.deployed && last.forge.length === 0 && last.log === "");
  }
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "0123456789abcdef0123456789abcdef01234567" });
  ok("--sha that resolves to no commit: refused", r.status === 1 && !last.deployed && /does not resolve to a commit/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--sha"], { sha: null });
  ok("--sha with no value: refused", r.status === 1 && !last.deployed);
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "main" });
  ok("--sha main while main is HEAD: the door deploys", r.status === 0 && last.deployed);
  ok("...and --sha never reaches forge deploy's own arguments", last.forge.filter((l) => /^deploy\b/.test(l)).every((l) => !/--sha|main/.test(l)));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, `--sha=${base}`], { sha: null });
  ok("--sha=<commit> works too", r.status === 0 && last.deployed);

  fs.writeFileSync(path.join(repo, "src/server/untracked.js"), "export const z = 1;\n");
  r = door({ FAKE_ELIG: ELIGIBLE }, L);
  ok("an UNTRACKED file in a packaged path (src/): refused, named, nothing built", r.status === 1 && !last.deployed && /src\/server\/untracked\.js/.test(r.stdout) && !/Building every bundle/.test(r.stdout));
  fs.rmSync(path.join(repo, "src/server/untracked.js"));
  fs.writeFileSync(path.join(repo, "notes-outside.txt"), "scratch\n");
  r = door({ FAKE_ELIG: ELIGIBLE }, L);
  ok("an untracked file outside the packaged paths does not stop the door", r.status === 0 && last.deployed);
  fs.rmSync(path.join(repo, "notes-outside.txt"));

  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_SNEAK: "commit" }, L);
  ok("a NON-door file committed between the named commit and HEAD before the deploy: refused right before forge deploy, naming it", r.status === 1 && !last.deployed
    && /Building every bundle/.test(r.stdout) && /src\/server\/sneak\.js/.test(r.stdout) && !/not built from HEAD/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_SNEAK: "dirty" }, L);
  ok("a packaged file edited (uncommitted) during the run: refused before forge deploy", r.status === 1 && !last.deployed && /src\/server\/door-test-change\.js/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_SNEAK: "untracked" }, L);
  ok("a new untracked packaged file during the run: refused before forge deploy", r.status === 1 && !last.deployed && /src\/server\/sneak\.js/.test(r.stdout));
  try { fs.rmSync(path.join(repo, "src/server/sneak.js")); } catch { /* none */ }
  // The door's OWN commits (its note, its tracker rows) between the named commit and the deploy are allowed: the note
  // and tracker-row cases above commit them and deploy with --sha = the commit they started from.

  // DRY RUN: checks, writes nothing, builds nothing, deploys nothing
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--dry-run"], { sha: null });
  ok("--dry-run without --sha: exit 0, says a real run needs --sha <the commit being released> and prints HEAD", r.status === 0 && /needs --sha/.test(r.stdout) && r.stdout.includes(base)
    && last.forge.length === 0 && last.log === "" && !/Building every bundle/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--dry-run"]);
  ok("--dry-run --sha <HEAD>: exit 0, the check passes, nothing deployed", r.status === 0 && /matches/.test(r.stdout) && last.forge.length === 0 && last.log === "");
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--dry-run"], { sha: "HEAD" });
  ok("--dry-run --sha HEAD: refused (exit 1)", r.status === 1 && last.forge.length === 0);

  ok("the tree is clean after every run (manifest and build stamp restored)", git("status", "--porcelain", "--untracked-files=no") === "");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
report("deploy-door");
