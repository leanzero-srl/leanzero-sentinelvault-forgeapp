// The production door (scripts/deploy-prod.sh), run for real in a throwaway clone with stand-ins for `forge` and
// `npm`, so no network and nothing is deployed. Pins two rules:
//  - rule zero: a production version that is not eligible for Runs on Atlassian FAILS the door (it used to end in
//    `forge eligibility ... || true` and exit 0);
//  - the licensing guard asks for --licensing-live only for the deploy that turns licensing on: when the last release
//    tag already shipped `licensing.enabled: true`, the door runs without the flag.
//  - the public tracker gate (2026-10-20): a release-note line through the release being cut with no tracker row,
//    or a tracker not verified through the newest release tag, ABORTS before the build and the deploy, naming the
//    line; a covered release deploys and the door prints the tracker step it now requires.
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
  // the working copy under test (the clone holds the last commit; the door is copied in as it is on disk now)
  for (const f of ["scripts/deploy-prod.sh", "scripts/strip-dev-modules.mjs", "manifest.yml", "scripts/public-tracker/coverage.mjs", "scripts/public-tracker/release-gate.mjs"]) fs.copyFileSync(path.join(root, f), path.join(repo, f));
  // The tracker gate reads the clone's own rows and receipt: a row for every note line, and a receipt verified
  // through the highest tag this test makes (v100.0.0), so the cases below test what they name.
  const { hashOf } = await import(pathToFileURL(path.join(root, "scripts/public-tracker/coverage.mjs")).href);
  const { RELEASE_NOTES, CURRENT_RELEASE } = await import(pathToFileURL(path.join(repo, "src/server/shared/release-notes.js")).href);
  const ENTRIES_F = path.join(repo, "scripts/public-tracker/entries.mjs"), RECEIPT_F = path.join(repo, "scripts/public-tracker/receipt-leanzero-demo.json");
  const allRows = Object.fromEntries(RELEASE_NOTES.flatMap((n) => [...(n.changes || []), ...(n.fixes || [])]).map((l) => [hashOf(l), ["fixture", "X"]]));
  const writeTracker = (rows, through) => {
    fs.writeFileSync(ENTRIES_F, `export const ENTRIES = ${JSON.stringify(rows)};\n`);
    fs.writeFileSync(RECEIPT_F, JSON.stringify({ verified: { through, failures: 0 } }));
  };
  writeTracker(allRows, "100.0.0");
  git("add", "-A", "scripts");
  if (git("status", "--porcelain", "--untracked-files=no")) git("commit", "-qam", "door under test");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(repo, "node_modules"));
  for (const t of git("tag", "--list").split("\n").filter(Boolean)) git("tag", "-d", t);
  git("tag", "v98.0.0", "HEAD"); // a release that already shipped licensing (this manifest has it on) ...
  git("commit", "-q", "--allow-empty", "-m", "the change being deployed"); // ... and a newer commit to deploy

  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "forge"), `#!/bin/bash
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
`, { mode: 0o755 });

  const ELIGIBLE = "The version of your app [98.1.0] that's deployed to [production] is eligible for the Runs on Atlassian program.";
  const NOT = "The version of your app [98.1.0] that's deployed to [production] is not eligible for the Runs on Atlassian program.\n  App is using a webtrigger module that can egress data";
  const door = (env, args = []) => spawnSync("bash", ["scripts/deploy-prod.sh", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } });

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

  // THE PUBLIC TRACKER GATE (2026-10-20). Licensing is acknowledged with the flag so only the tracker decides.
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("covered release, caught-up tracker: the door passes", r.status === 0 && /Public tracker: every release-note line through/.test(r.stdout));
  ok("...and prints the tracker step it now requires, after the eligibility verdict", /PUBLIC TRACKER \(required before the next production deploy\)/.test(r.stdout) && /tracker\.mjs public --reprove/.test(r.stdout)
    && r.stdout.indexOf("PUBLIC TRACKER") > r.stdout.indexOf("Eligible for Runs on Atlassian"));
  const firstLine = [...(CURRENT_RELEASE.changes || []), ...(CURRENT_RELEASE.fixes || [])][0];
  const missing = { ...allRows }; delete missing[hashOf(firstLine)];
  writeTracker(missing, "100.0.0"); git("commit", "-qam", "a release line without a tracker row");
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("a release-note line with no tracker row: the door refuses, naming it", r.status === 1 && /ABORT: the public tracker does not cover this production release/.test(r.stdout)
    && r.stdout.includes(hashOf(firstLine)) && r.stdout.includes(firstLine.slice(0, 60)));
  ok("...before the build and before any deploy", !/Building every bundle/.test(r.stdout) && !/Deployed to production/.test(r.stdout));
  writeTracker(allRows, "99.0.0"); git("commit", "-qam", "tracker verified only through an older tag");
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("a tracker not verified through the newest release tag: the door refuses", r.status === 1 && /not applied and verified for 100\.0\.0/.test(r.stdout) && !/Deployed to production/.test(r.stdout));
  writeTracker(allRows, "100.0.0"); git("commit", "-qam", "tracker caught up");

  ok("the tree is clean after every run (manifest and build stamp restored)", git("status", "--porcelain", "--untracked-files=no") === "");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
report("deploy-door");
