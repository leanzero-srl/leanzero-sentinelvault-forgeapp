// The production door (scripts/deploy-prod.sh), run for real in a throwaway clone with stand-ins for `forge` and
// `npm`, so no network and nothing is deployed. Pins two rules:
//  - rule zero: a production version that is not eligible for Runs on Atlassian FAILS the door (it used to end in
//    `forge eligibility ... || true` and exit 0);
//  - the licensing guard asks for --licensing-live only for the deploy that turns licensing on: when the last release
//    tag already shipped `licensing.enabled: true`, the door runs without the flag.
//  - release notes and the public tracker are AUTOMATIC (2026-10-20, owner: "the release notes in app need to be done
//    automatically"): a release with no in-app note gets one written from the commits since production and committed
//    BEFORE the build; a note line with no tracker row gets one instead of a refusal; a line naming an SVT key of a
//    known bug closes it (KNOWN -> CLOSED, and the tracker builds that issue as Done with the release); after an
//    eligible deploy the door records the release and runs the tracker's apply, verify and public --reprove itself,
//    and a failing tracker step never changes the door's exit code.
//  - THE WORDS COME FROM THE VISIBLE SESSION'S AGENT, NEVER A MODEL PROCESS (2026-11-17, autopilot core 1.5.0): the
//    door writes a request file and stops with NOTE PENDING, exit 3, before anything is written, committed, built or
//    deployed; a result with the wrong id or no JSON stays pending and the door says why; answered, the same command
//    goes on. Pending is never a pass and no fallback text stands in. A note carrying a filler line is REFUSED
//    (exit 2). The helper below plays the session's agent by answering request files; nothing stands in for a binary.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ok, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The clone links THIS checkout's node_modules, and the door refuses dependencies that do not match package-lock.json
// (scripts/check-installed-deps.mjs). So a checkout whose node_modules is stale fails most cases for a reason that is
// not the door's: the workhorse's primary checkout, fast-forwarded to a lock with markdown-it 14.3.3 while 14.3.2 was
// still installed, gave 37/78 with nothing but "expected truthy" (2026-10-22). Name the cause once and stop.
{
  const { installedDepsProblems } = await import(pathToFileURL(path.join(root, "scripts/check-installed-deps.mjs")).href);
  let problems;
  try { problems = installedDepsProblems(root); } catch (e) { problems = [e.message]; }
  if (problems.length) {
    throw new Error(`deploy-door: cannot test the door here: ${root}'s node_modules does not match its package-lock.json `
      + `(${problems.join("; ")}). The door would refuse every deploy for that reason alone. Run \`npm ci\` in this checkout, then run the test again.`);
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-door-"));
const repo = path.join(tmp, "repo"), bin = path.join(tmp, "bin");
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=door-test", "-c", "user.email=door-test@invalid", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  execFileSync("git", ["clone", "-q", "--no-hardlinks", root, repo], { stdio: "ignore" });
  // origin is a throwaway bare repository, NEVER the checkout under test: the push cases below really push.
  const origin = path.join(tmp, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin], { stdio: "ignore" });
  // CI checks out a SHALLOW clone (so the clone above is shallow too); a bare repo refuses a push that needs new
  // shallow roots ("shallow update not allowed") unless told it may take them.
  execFileSync("git", ["-C", origin, "config", "receive.shallowUpdate", "true"], { stdio: "ignore" });
  git("remote", "set-url", "origin", origin);
  // The clone is on a branch whatever the checkout under test is: CI runs a tag on a DETACHED HEAD, and a detached
  // clone reads to the door as a rollback from a tag, so the note-writing cases would fail only there (v8.13.0, 2026-10-21).
  git("checkout", "-q", "-B", "main");
  // the working copy under test (the clone holds the last commit; the door is copied in as it is on disk now)
  for (const f of ["scripts/deploy-prod.sh", "scripts/check-installed-deps.mjs", "scripts/strip-dev-modules.mjs", "manifest.yml", "scripts/public-tracker/coverage.mjs", "scripts/public-tracker/release-gate.mjs",
    "scripts/public-tracker/tracker.mjs", "scripts/public-tracker/credentials.mjs", "scripts/release-autopilot.mjs", "test/release-notes.test.mjs", ".gitignore"]) fs.copyFileSync(path.join(root, f), path.join(repo, f));
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
  // node_modules: a REAL directory whose entries link to the checkout's packages (the door refuses a symlinked root
  // node_modules, and checks every locked non-dev package is installed at its version). Never write through these links.
  fs.mkdirSync(path.join(repo, "node_modules"));
  for (const e of fs.readdirSync(path.join(root, "node_modules"))) fs.symlinkSync(path.join(root, "node_modules", e), path.join(repo, "node_modules", e));
  for (const t of git("tag", "--list").split("\n").filter(Boolean)) git("tag", "-d", t);
  git("tag", "v98.0.0", "HEAD"); // a release that already shipped licensing (this manifest has it on) ...
  git("commit", "-q", "--allow-empty", "-m", "the change being deployed"); // ... and a newer commit to deploy

  fs.mkdirSync(bin);
  const FORGE_LOG = path.join(tmp, "forge.log");
  fs.writeFileSync(path.join(bin, "forge"), `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(FORGE_LOG)}
case "$1" in
  lint) if [[ -n "$FAKE_LINT_RC" ]]; then echo "1 error"; exit "$FAKE_LINT_RC"; fi; echo "No issues found."; exit 0 ;;
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
  // The tracker driver is a stand-in that logs its argv; nothing is pushed.
  // THE MODEL IS THE VISIBLE SESSION'S AGENT (2026-11-17): the door asks through a request file under
  // test-harness/results/release-requests/ and stops with exit 3 (NOTE PENDING). `agent` plays that agent: given the
  // request it returns the JSON the prompt asks for; the helper writes <id>.result.json and runs the SAME command
  // again, as a session does. `{ answer: null }` leaves a request unanswered; an answer function that returns
  // undefined stops answering there. Answers stay in the requests dir between cases (same prompt = same id), so a
  // case about pending clears it first (clearRequests).
  const REQ_DIR = path.join(repo, "test-harness/results/release-requests");
  const clearRequests = () => fs.rmSync(REQ_DIR, { recursive: true, force: true });
  const pendingOf = (out) => {
    const m = /^\s*request: (.+)$/m.exec(out || "");
    if (!m || !/NOTE PENDING \(exit 3\)/.test(out)) return null;
    return { ...JSON.parse(fs.readFileSync(m[1].trim(), "utf8")), path: m[1].trim() };
  };
  const listIn = (p, from) => JSON.parse(p.slice(p.indexOf("[", p.indexOf(from)), p.lastIndexOf("]", p.indexOf("Answer with ONLY")) + 1));
  const NOTE_ANSWER = { headline: "Approvers see the page's classification", changes: [{ text: "New: the approval dialog shows the page's classification.", keys: [] }], fixes: [{ text: "Fixed something in src/server/x.js.", keys: [] }], action: null };
  const agent = (q, { note = NOTE_ANSWER, review = "ok" } = {}) => {
    const p = q.prompt;
    if (/in-app release note/.test(p)) return note;
    if (/adversarial reviewer/.test(p)) return { verdicts: listIn(p, "Rows (").map((row) => ({ h: row.h, verdict: review, reason: review === "ok" ? null : "the test's reviewer withholds it" })) };
    if (/PUBLIC tracker/.test(p)) return { rows: listIn(p, "Lines (").map((l) => ({ h: l.h, title: "The approval dialog shows the page's classification", c: "W", d: null, withhold: null })) };
    throw new Error(`deploy-door: a request the test's agent does not know: ${q.what}`);
  };
  const TRK_LOG = path.join(tmp, "tracker.log"), TRK_ENV_LOG = path.join(tmp, "tracker-env.log");
  fs.writeFileSync(path.join(bin, "tracker-stub.mjs"), `import fs from "node:fs"; fs.appendFileSync(${JSON.stringify(TRK_LOG)}, process.argv.slice(2).join(" ") + "\\n"); fs.appendFileSync(${JSON.stringify(TRK_ENV_LOG)}, (process.env.PUBLIC_TRACKER_ENV || "(unset)") + "\\n"); process.exit(process.env.FAKE_TRACKER_FAIL === process.argv[2] ? 1 : 0);\n`);
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
  // The door refuses before anything else when the tracker's credentials cannot be found (2026-11-03); a fixture file
  // with stand-in keys (never read by the stub tracker) stands for them in every case that is not about them.
  const TRK_CRED = path.join(tmp, "tracker.env");
  fs.writeFileSync(TRK_CRED, "JIRA_ADMIN_EMAIL=door-test@invalid\nJIRA_API_TOKEN=not-a-token\n");
  const BASE_ENV = { PUBLIC_TRACKER_ENV: TRK_CRED, RELEASE_GATE_MARKETPLACE_FAKE: JSON.stringify({ name: "98.1.0", buildNumber: 500 }), RELEASE_GATE_TRACKER: path.join(bin, "tracker-stub.mjs"), RELEASE_GATE_NO_PUSH: "1",
    GIT_AUTHOR_NAME: "door-test", GIT_AUTHOR_EMAIL: "door-test@invalid", GIT_COMMITTER_NAME: "door-test", GIT_COMMITTER_EMAIL: "door-test@invalid" };
  let last = null;
  // Every real run names the commit being released (--sha); by default the commit the case starts from, i.e. the
  // checkout's own HEAD. `{ sha: null }` leaves the flag out, `{ sha: "<x>" }` names something else.
  const door = (env, args = [], { sha, keep, answer = agent } = {}) => {
    const start = git("rev-parse", "HEAD");
    if (sha === undefined) args = [...args, "--sha", start];
    else if (sha !== null) args = [...args, "--sha", sha];
    for (const f of [TRK_LOG, TRK_ENV_LOG, PUB_LOG, FORGE_LOG]) { try { fs.rmSync(f); } catch { /* none */ } }
    const outer = process.env;
    // the same command again after each answered request (at most the note, the rows and their review, plus one)
    let r, out = "";
    const asked = [];
    for (let i = 0; i < 5; i++) {
      r = spawnSync("bash", ["scripts/deploy-prod.sh", ...args], { cwd: repo, encoding: "utf8", env: { ...outer, PATH: `${bin}:${outer.PATH}`, ...BASE_ENV, ...env } });
      out += r.stdout;
      const q = r.status === 3 && answer ? pendingOf(r.stdout) : null;
      const a = q ? answer(q) : undefined;
      if (a === undefined) break;
      asked.push(q.what);
      fs.writeFileSync(q.result_path, JSON.stringify({ request_id: q.id, output: a }));
    }
    r.stdout = out;
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
    last = { recorded: read(PROD_F), entries: read(ENTRIES_F), notes: read(path.join(repo, "src/server/shared/release-notes.js")), doc: read(path.join(repo, "docs/RELEASE-NOTES.md")),
      tracker: (read(TRK_LOG) || "").trim().split("\n").filter(Boolean), trackerEnv: (read(TRK_ENV_LOG) || "").trim().split("\n").filter(Boolean), publisher: (read(PUB_LOG) || "").trim().split("\n").filter(Boolean), log: git("log", "--format=%s", `${start}..HEAD`), build: read(path.join(repo, "src/build-info.js")), head: git("rev-parse", "--short", "HEAD"),
      forge: (read(FORGE_LOG) || "").trim().split("\n").filter(Boolean) };
    last.deployed = last.forge.some((l) => /^deploy\b/.test(l));
    last.asked = asked;
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
    if (!keep) git("reset", "-q", "--hard", start);
    return r;
  };

  let r = door({ FAKE_ELIG: ELIGIBLE });
  ok("eligible production: the door passes", r.status === 0 && /Eligible for Runs on Atlassian/.test(r.stdout));
  ok("licensing already shipped in the last release tag: no flag needed", /production already runs with licensing \(release v98\.0\.0\)/.test(r.stdout));
  ok("...and the tracker step after the deploy reads the credentials file the door checked", last.trackerEnv.length === 3 && last.trackerEnv.every((e) => e === TRK_CRED));

  // THE TRACKER'S CREDENTIALS ARE CHECKED BEFORE THE DEPLOY (2026-11-03, 8.25.0 on Gabee's MacBook: deployed, then the
  // tracker step failed on "no credentials file at ../CogniRunner/test-harness/.env"). A HOME with none of the known
  // files and PUBLIC_TRACKER_ENV unset: refused with the fix, nothing committed, built or deployed.
  const credHome = path.join(tmp, "home");
  fs.mkdirSync(credHome);
  const harnessEnv = path.join(credHome, "Projects", "forge-live-harness", ".env");
  r = door({ FAKE_ELIG: ELIGIBLE, PUBLIC_TRACKER_ENV: "", HOME: credHome });
  ok("no tracker credentials anywhere: the door refuses (exit 1) BEFORE anything is committed, built or deployed",
    r.status === 1 && /ABORT: the public tracker's credentials were not found/.test(r.stdout) && !last.deployed && last.forge.length === 0
    && last.log === "" && last.tracker.length === 0 && !/Building every bundle/.test(r.stdout));
  ok("...naming every place it looked and the exact fix", r.stdout.includes(harnessEnv) && r.stdout.includes("export PUBLIC_TRACKER_ENV="));
  r = door({ FAKE_ELIG: ELIGIBLE, PUBLIC_TRACKER_ENV: path.join(tmp, "no-such.env") });
  ok("PUBLIC_TRACKER_ENV naming a missing file: refused before the deploy, the file named", r.status === 1 && !last.deployed && r.stdout.includes(`PUBLIC_TRACKER_ENV=${path.join(tmp, "no-such.env")} does not exist`));
  r = door({ FAKE_ELIG: ELIGIBLE, PUBLIC_TRACKER_ENV: "", HOME: credHome }, ["--dry-run"]);
  ok("a dry run without tracker credentials says so too (exit 1)", r.status === 1 && /credentials were not found/.test(r.stdout));
  fs.mkdirSync(path.dirname(harnessEnv), { recursive: true });
  fs.writeFileSync(harnessEnv, "JIRA_ADMIN_EMAIL=door-test@invalid\nJIRA_API_TOKEN=not-a-token\n");
  r = door({ FAKE_ELIG: ELIGIBLE, PUBLIC_TRACKER_ENV: "", HOME: credHome });
  ok("PUBLIC_TRACKER_ENV unset, the forge-live-harness .env present: the door finds it itself, deploys, and hands it to the tracker step",
    r.status === 0 && last.deployed && r.stdout.includes(`Public tracker credentials: ${harnessEnv}`) && last.trackerEnv.length === 3 && last.trackerEnv.every((e) => e === harnessEnv)
    && r.stdout.indexOf("Public tracker credentials:") < r.stdout.indexOf("Deploying to production"));

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
  // NOTE PENDING (2026-11-17). The release being cut has no note, so the door ASKS for it: a request file, exit 3,
  // and nothing written, committed, built or deployed. No model process is started and no fallback text is written.
  const { FILLER_LINES, REQUEST_PROTOCOL, requestId } = await import(pathToFileURL(path.join(root, "scripts/release-autopilot.mjs")).href);
  const NOTES_PATH = path.join(repo, "src/server/shared/release-notes.js");
  const notesBefore = fs.readFileSync(NOTES_PATH, "utf8");
  const NL = ["--licensing-live"];
  clearRequests();
  r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: null });
  let q = pendingOf(r.stdout);
  ok("no note for the release being cut and no answer yet: the door stops with NOTE PENDING, exit 3, and names the request file",
    r.status === 3 && !!q && /Pending is not a pass/.test(r.stdout) && r.stdout.includes(path.join("test-harness", "results", "release-requests")));
  ok("...before anything is written, committed, built or deployed (no fallback note)", !last.deployed && last.forge.length === 0 && last.log === "" && last.notes === notesBefore
    && !/Building every bundle/.test(r.stdout) && last.tracker.length === 0 && git("status", "--porcelain", "--untracked-files=no") === "");
  ok(`...the request file carries what is asked (release note ${NEXT}), the full prompt, its id and where the answer goes`, !!q && q.protocol === REQUEST_PROTOCOL && q.what === `release note ${NEXT}`
    && q.id === requestId(q.prompt) && q.prompt.length > 200 && fs.realpathSync(path.dirname(q.result_path)) === fs.realpathSync(REQ_DIR) && path.basename(q.result_path) === `${q.id}.result.json`);
  ok("...and the requests dir is gitignored, so a pending request never dirties the checkout", git("status", "--porcelain", "--untracked-files=all", "--", "test-harness") === "");
  if (q) {
    fs.writeFileSync(q.result_path, JSON.stringify({ request_id: "0000000000000000", output: NOTE_ANSWER }));
    r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: null });
    ok("a result that names another request is not used: still exit 3, the door says why, nothing written or deployed",
      r.status === 3 && /not used: the result names request/.test(r.stdout) && !last.deployed && last.log === "" && last.notes === notesBefore);
    fs.writeFileSync(q.result_path, JSON.stringify({ request_id: q.id, output: "I could not write it." }));
    r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: null });
    ok("a result whose output is not the asked JSON is not used either: still exit 3, no note written",
      r.status === 3 && /not used: the result's output is not the JSON object/.test(r.stdout) && !last.deployed && last.log === "" && last.notes === notesBefore);
  }
  // the note answered, the tracker rows not yet: the door commits the note and stops again, still before the build
  clearRequests();
  r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: (x) => (/^release note /.test(x.what) ? agent(x) : undefined) });
  q = pendingOf(r.stdout.slice(r.stdout.lastIndexOf("NOTE PENDING (exit 3)")));
  ok("the note answered, the tracker rows not: exit 3 on \"public tracker rows\", the note committed, nothing built or deployed",
    r.status === 3 && !!q && q.what === "public tracker rows" && /in-app note written by the release door/.test(last.log) && !/public tracker: rows/.test(last.log)
    && !last.deployed && last.forge.length === 0 && !/Building every bundle/.test(r.stdout));

  // A FILLER NOTE IS REFUSED (2026-11-17: CogniRunner 1.37.4 shipped "This release fixes the problems listed below.")
  for (const filler of FILLER_LINES) {
    clearRequests();
    r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: (x) => (/^release note /.test(x.what) ? { headline: "Fixes in the approval dialog", changes: [{ text: filler, keys: [] }], fixes: [{ text: "The approval dialog showed no classification.", keys: [] }], action: null } : undefined) });
    ok(`a note carrying the filler line "${filler}" is refused (exit 2): nothing written, committed, built or deployed`,
      r.status === 2 && /does not publish filler/.test(r.stdout) && r.stdout.includes(filler) && !last.deployed && last.forge.length === 0 && last.log === "" && last.notes === notesBefore && !/Building every bundle/.test(r.stdout));
  }
  // a fix-only answer: the fix is the note, and no filler line is added to give it a "change"
  clearRequests();
  r = door({ FAKE_ELIG: ELIGIBLE }, NL, { answer: (x) => agent(x, { note: { headline: "The approval dialog shows the classification again", changes: [], fixes: [{ text: "The approval dialog showed no classification.", keys: [] }], action: null } }) });
  ok("a fix-only note is written with its fix and no filler line, and deploys", r.status === 0 && last.deployed && last.notes.includes(`version: "${NEXT}"`) && last.notes.includes("The approval dialog showed no classification.")
    && FILLER_LINES.every((f) => !last.notes.includes(f)));

  // EVERY REQUEST ANSWERED: the same command, run again after each answer, writes the note and the rows and deploys
  clearRequests();
  r = door({ FAKE_ELIG: ELIGIBLE }, NL);
  ok(`the door asked for the note, the tracker rows and their review, one at a time (${JSON.stringify(last.asked)})`, JSON.stringify(last.asked) === JSON.stringify([`release note ${NEXT}`, "public tracker rows", "public tracker review"]));
  ok(`no note for the release being cut: the door WRITES it (${NEXT}, from the session agent's answer) and deploys`, r.status === 0 && /Deployed to production/.test(r.stdout)
    && last.notes.includes(`version: "${NEXT}"`) && last.notes.includes("New: the approval dialog shows the page's classification.") && JSON.parse(last.recorded).release === NEXT);
  ok("...says in the note's comment and commit who wrote it (the session's agent, on the door's request), never a headless model", /written by the session's agent on the door's request/.test(last.notes) && /written by the session's agent/.test(last.log) && !/headless/.test(last.notes + last.log));
  ok("...drops a generated line that would turn the note gate red (a file name)", !last.notes.includes("src/server/x.js"));
  ok("...re-renders docs/RELEASE-NOTES.md and commits the note before the build", last.doc.includes(`## ${NEXT}`) && /release .*: in-app note written by the release door/.test(last.log)
    && r.stdout.indexOf(`Release note ${NEXT} written and committed`) < r.stdout.indexOf("Building every bundle"));
  ok("...and writes the new line's tracker row through the agent's rows and the review pass", /rows: model; review pass: model/.test(last.entries) && last.entries.includes("The approval dialog shows the page's classification"));
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live", "--approve-major"]);
  ok(`--approve-major cuts ${MAJOR}: a different release is a different request, asked and answered the same way`, r.status === 0 && last.deployed && last.notes.includes(`version: "${MAJOR}"`) && last.asked[0] === `release note ${MAJOR}`
    && last.notes.includes("New: the approval dialog shows the page's classification."));
  // no model process anywhere: the door's own files start none, and this test puts no stand-in binary on the PATH
  {
    const core = fs.readFileSync(path.join(root, "scripts/release-autopilot.mjs"), "utf8"), gate = fs.readFileSync(path.join(root, "scripts/public-tracker/release-gate.mjs"), "utf8");
    ok("the release door starts no model process: the core imports no child_process and no headless runner is left in it or in release-gate.mjs",
      !/claudeRunner|child_process/.test(core) && !/claudeRunner/.test(gate) && /A\.requestRunner\(/.test(gate) && !fs.existsSync(path.join(bin, "claude")));
  }

  // A COMMIT NAMING AN SVT KEY OF A KNOWN BUG CLOSES IT. known-macro-position-focus is SVT-47 in the receipt. The log
  // line lists every key the run closes ("closes SVT-150, SVT-149, SVT-47" when the real newest note names others).
  fs.writeFileSync(path.join(repo, "src/server/door-test-change.js"), "export const x = 2;\n");
  git("commit", "-qam", "Show the keyboard focus outline on the Top and Bottom switches (SVT-47)");
  r = door({ FAKE_ELIG: ELIGIBLE, WANT_DESIRED: "known-macro-position-focus" }, ["--licensing-live"], { answer: (x) => agent(x, { review: "withhold" }) });
  const closedNote = (last.notes.match(/"[^"\n]*\(SVT-47\)\."/) || [""])[0];
  ok("the generated note line carries the key the commit names", r.status === 0 && !!closedNote);
  ok("...the row FOLDS into the known bug instead of a new issue, and the known bug moves from KNOWN to CLOSED",
    /"fold":"known-macro-position-focus"/.test(last.entries) && /closes [^\n]*\bSVT-47\b/.test(last.log)
    && last.entries.indexOf('k: "known-macro-position-focus"') > last.entries.indexOf("export const CLOSED"));
  const d = (last.desired || [])[0] || {};
  // the review pass withheld the row here, so its text is not public: the issue closes with a generic sentence, never the raw line
  ok(`...and the tracker builds SVT-47's issue as a Done Bug with ${NEXT} as its fix version (withheld text: the generic sentence) (${JSON.stringify(last.desired).slice(0, 300)})`,
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
  ok("...and the recovery command it prints carries --sha", /deploy-prod\.sh --sha /.test(r.stdout));
  // git merge-base failing for another reason (exit 128: missing objects, a shallow clone) is said as such, not as BEHIND/DIVERGED
  const bin2 = path.join(tmp, "bin2"); fs.mkdirSync(bin2);
  const realGit = execFileSync("bash", ["-lc", "command -v git"], { encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(bin2, "git"), `#!/bin/bash\nif [[ "$1" == merge-base && -n "$FAKE_MB_RC" ]]; then exit "$FAKE_MB_RC"; fi\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_MB_RC: "128", PATH: `${bin2}:${bin}:${process.env.PATH}` }, L, { sha: "tested" });
  ok("git merge-base exiting 128: refused, says git could not compare (exit 128), not BEHIND/AHEAD/DIVERGED, recovery carries --sha", r.status === 1 && !last.deployed
    && /could not compare.*exit 128/.test(r.stdout) && !/BEHIND|AHEAD|DIVERGED/.test(r.stdout) && /deploy-prod\.sh --sha /.test(r.stdout));
  git("checkout", "-q", "tested");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: base });
  ok("checkout AHEAD of the named commit: refused, says AHEAD, names both shas, lists the change and a --sha recovery", r.status === 1 && !last.deployed && /AHEAD/.test(r.stdout) && r.stdout.includes(testedSha) && r.stdout.includes(base)
    && /src\/server\/door-test-change\.js/.test(r.stdout) && /deploy-prod\.sh --sha /.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "tested" });
  ok("--sha <the branch checked out HERE> (tested, run in the tested checkout): refused, it always equals HEAD", r.status === 1 && !last.deployed && last.forge.length === 0
    && /checked out in THIS checkout/.test(r.stdout) && /rev-parse HEAD/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: testedSha.slice(0, 10) });
  ok("...a (short) hex sha in the tested checkout is accepted (it cannot be told apart from a copied one; docs say where to take it)", r.status === 0 && last.deployed);
  git("checkout", "-q", "main"); git("merge", "-q", "--ff-only", "tested");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "tested" });
  ok("THE INTENDED FLOW: main fast-forwarded to the tested branch, door run in main with --sha tested: deploys", r.status === 0 && last.deployed && /Deployed to production/.test(r.stdout));
  git("reset", "-q", "--hard", base); git("branch", "-q", "-D", "tested");

  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: null });
  ok("a real run with no --sha: refused before anything, says --sha is needed and prints HEAD", r.status === 1 && !last.deployed && last.forge.length === 0 && /--sha/.test(r.stdout) && r.stdout.includes(base));
  for (const bad of ["HEAD", "head", "@", "HEAD~1", "HEAD^", "@~1", "@{-1}", "ORIG_HEAD", "FETCH_HEAD", "main~1", "main^", "main:src"]) {
    r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: bad });
    ok(`--sha ${bad}: refused (it means "whatever is checked out", or is not a sha or a branch)`, r.status === 1 && !last.deployed && last.forge.length === 0 && last.log === "");
  }
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "0123456789abcdef0123456789abcdef01234567" });
  ok("--sha that resolves to no commit: refused", r.status === 1 && !last.deployed && /does not resolve to a commit/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--sha"], { sha: null });
  ok("--sha with no value: refused", r.status === 1 && !last.deployed);
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: "main" });
  ok("--sha main run in a main checkout (the stale-main case's vacuous form): refused", r.status === 1 && !last.deployed && /checked out in THIS checkout/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, `--sha=${base}`], { sha: null });
  ok("--sha=<commit> works too", r.status === 0 && last.deployed);
  ok("...and --sha never reaches forge deploy's own arguments", last.forge.filter((l) => /^deploy\b/.test(l)).every((l) => !/--sha/.test(l) && !l.includes(base)));
  for (const name of ["head-fix", "fix@2"]) {
    git("branch", name, "HEAD");
    r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: name });
    ok(`a legal branch name that only looks special (${name}), not checked out here: accepted, deploys`, r.status === 0 && last.deployed);
    git("branch", "-q", "-D", name);
  }
  // every recovery command the door prints names --sha (a hint without it would be refused anyway)
  const doorSrc = fs.readFileSync(path.join(root, "scripts/deploy-prod.sh"), "utf8");
  const hints = doorSrc.split("\n").filter((l) => /\becho\b/.test(l) && /deploy-prod\.sh|\$\{CMD\}/.test(l));
  ok(`every printed door command carries --sha (${hints.length} lines)`, hints.length >= 8 && hints.every((l) => /--sha/.test(l)));

  // node_modules must be the locked one: Forge bundles the root node_modules
  const nmDir = path.join(repo, "node_modules"), nmAside = path.join(tmp, "nm-aside");
  fs.renameSync(nmDir, nmAside); fs.symlinkSync(path.join(root, "node_modules"), nmDir);
  r = door({ FAKE_ELIG: ELIGIBLE }, L);
  ok("a SYMLINKED node_modules (another checkout's dependencies): refused before anything, says npm ci", r.status === 1 && !last.deployed && last.forge.length === 0 && /symlink/.test(r.stdout) && /npm ci/.test(r.stdout));
  fs.rmSync(nmDir); fs.renameSync(nmAside, nmDir);
  const lockPkgs = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8")).packages;
  const shipped = Object.keys(lockPkgs).find((k) => /^node_modules\/[^@/][^/]*$/.test(k) && !lockPkgs[k].dev && !lockPkgs[k].devOptional && !lockPkgs[k].optional);
  const shippedLink = path.join(repo, shipped), shippedTarget = fs.readlinkSync(shippedLink);
  fs.unlinkSync(shippedLink);
  r = door({ FAKE_ELIG: ELIGIBLE }, L);
  ok(`a locked shipped package not installed (${shipped}): refused, named, says npm ci`, r.status === 1 && !last.deployed && r.stdout.includes(shipped) && /npm ci/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, [...L, "--dry-run"], { sha: null });
  ok("...a dry run says the same (exit 1)", r.status === 1 && r.stdout.includes(shipped));
  fs.symlinkSync(shippedTarget, shippedLink);

  // A RUN THAT STOPPED after the door committed its note / tracker rows, re-run naming the SAME tested commit: accepted
  const S = full("HEAD");
  r = door({ FAKE_ELIG: ELIGIBLE, FAKE_LINT_RC: "1" }, L, { keep: true });
  ok("a run that stops at forge lint AFTER the door committed (note / tracker rows)", r.status === 1 && !last.deployed && full("HEAD") !== S && /written by the release door|release door/.test(last.log));
  const afterStop = full("HEAD");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: S, keep: true });
  ok("...re-run naming the same tested sha: accepted (HEAD = it plus only the door's own commits) and deploys", r.status === 0 && last.deployed && /only this door's own commits \(a re-run\); accepted/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: S });
  ok("...and a redeploy of it after that deploy's own record commit (production-release.json, receipt) is accepted too", r.status === 0 && last.deployed);
  // until 2026-11-17 that redeploy wrote a note for the NEXT version whose only line was the filler "Maintenance release
  // with no change you will notice."; nothing customer-visible changed, so no note is asked for and none is written
  ok("...and writes no note for it: production's commit plus only the door's own tracker record is a redeploy", /plus only the door's own tracker record; a redeploy, nothing is written/.test(r.stdout)
    && !/in-app note written by the release door/.test(last.log) && !/Maintenance release/.test(last.notes) && last.asked.length === 0);
  git("reset", "-q", "--hard", afterStop);
  fs.writeFileSync(path.join(repo, "src/server/door-test-change.js"), "export const x = 4; // not tested\n"); git("commit", "-qam", "a change after the stopped run");
  r = door({ FAKE_ELIG: ELIGIBLE }, L, { sha: S });
  ok("...but a re-run with any NON-door commit on top is refused as AHEAD, naming the file", r.status === 1 && !last.deployed && /AHEAD/.test(r.stdout) && /src\/server\/door-test-change\.js/.test(r.stdout));
  git("reset", "-q", "--hard", S);

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

  // THE DOOR PUTS ITS COMMITS ON origin/main FROM ANY CHECKOUT (2026-11-03). `post` pushed only when the checked-out
  // branch was literally `main`: from a release worktree on a detached HEAD (8.25.0, 8.26.0) it committed the receipt,
  // exited 0 and said nothing, and both releases were pushed by hand. Now it pushes HEAD to origin/main fast-forward only
  // from anywhere, and when that cannot happen the door exits 6 with the exact git command (production stays deployed).
  {
    const before = full("HEAD");
    // production recorded one release back, so every run here has a receipt commit to land (post records CUT)
    fs.writeFileSync(PROD_F, JSON.stringify({ release: LIVE })); git("commit", "-qam", "production one release back (push cases)");
    const P = full("HEAD");
    const originMain = () => execFileSync("git", ["-C", origin, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
    const PUSH = { FAKE_ELIG: ELIGIBLE, RELEASE_GATE_NO_PUSH: "" };
    git("push", "-q", "-f", "origin", `${P}:refs/heads/main`);
    git("checkout", "-q", "--detach", P);
    r = door(PUSH, L, { keep: true });
    let after = full("HEAD");
    ok("DETACHED HEAD release worktree: the door deploys AND pushes its receipt commit to origin/main (fast-forward), exit 0",
      r.status === 0 && last.deployed && after !== P && /public tracker: .* in production/.test(last.log) && originMain() === after && /Pushed [0-9a-f]{12} to origin\/main \(fast-forward, from a detached HEAD\)/.test(r.stdout));
    r = door(PUSH, L, { sha: P, keep: true });
    ok("...a redeploy with nothing new to commit: exit 0, says origin/main already holds HEAD", r.status === 0 && /origin\/main already holds/.test(r.stdout) && originMain() === full("HEAD"));
    git("reset", "-q", "--hard", P);
    git("push", "-q", "-f", "origin", `${P}:refs/heads/main`);
    git("checkout", "-q", "-b", "release-x", P);
    r = door(PUSH, L, { keep: true });
    after = full("HEAD");
    ok("a release checkout on ANOTHER branch: pushed to origin/main too, exit 0",
      r.status === 0 && last.deployed && originMain() === after && /from branch release-x/.test(r.stdout));
    git("checkout", "-q", "--detach", P); git("branch", "-q", "-D", "release-x");
    // origin/main moved on meanwhile: never forced; deployed, exit 6, the merge-then-push command printed
    git("commit", "-q", "--allow-empty", "-m", "someone else's commit on main");
    const other = full("HEAD");
    git("push", "-q", "-f", "origin", `${other}:refs/heads/main`);
    git("reset", "-q", "--hard", P);
    r = door(PUSH, L, { keep: true });
    ok("origin/main has commits the checkout lacks: NOT forced, origin/main untouched, door exits 6 (deployed, ACTION NEEDED; 3 is NOTE PENDING, nothing deployed) with the merge-then-push command",
      r.status === 6 && last.deployed && originMain() === other && /NOT PUSHED/.test(r.stdout) && /ACTION NEEDED: production is deployed and eligible/.test(r.stdout)
      && r.stdout.includes("merge --no-edit FETCH_HEAD") && r.stdout.includes("push origin HEAD:refs/heads/main"));
    git("reset", "-q", "--hard", P);
    // origin unreachable: exit 6 with the exact push command naming the receipt commit
    git("remote", "set-url", "origin", path.join(tmp, "no-such-origin.git"));
    r = door(PUSH, L, { keep: true });
    after = full("HEAD");
    ok("origin unreachable: exit 6, NOT PUSHED, prints `git push origin <receipt sha>:refs/heads/main`",
      r.status === 6 && last.deployed && /NOT PUSHED/.test(r.stdout) && r.stdout.includes(`push origin ${after}:refs/heads/main`));
    git("remote", "set-url", "origin", origin);
    git("reset", "-q", "--hard", P);
    // the tracker step failing still never fails the deploy, and the receipt still lands on main
    git("push", "-q", "-f", "origin", `${P}:refs/heads/main`);
    r = door({ ...PUSH, FAKE_TRACKER_FAIL: "verify" }, L, { keep: true });
    ok("a failing tracker step from a detached HEAD: exit 0, and the receipt is on origin/main", r.status === 0 && originMain() === full("HEAD"));
    git("checkout", "-q", "main"); git("reset", "-q", "--hard", before);
  }

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
