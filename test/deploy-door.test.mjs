// The production door (scripts/deploy-prod.sh), run for real in a throwaway clone with stand-ins for `forge` and
// `npm`, so no network and nothing is deployed. Pins two rules:
//  - rule zero: a production version that is not eligible for Runs on Atlassian FAILS the door (it used to end in
//    `forge eligibility ... || true` and exit 0);
//  - the licensing guard asks for --licensing-live only for the deploy that turns licensing on: when the last release
//    tag already shipped `licensing.enabled: true`, the door runs without the flag.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-door-"));
const repo = path.join(tmp, "repo"), bin = path.join(tmp, "bin");
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=door-test", "-c", "user.email=door-test@invalid", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  execFileSync("git", ["clone", "-q", "--no-hardlinks", root, repo], { stdio: "ignore" });
  // the working copy under test (the clone holds the last commit; the door is copied in as it is on disk now)
  for (const f of ["scripts/deploy-prod.sh", "scripts/strip-dev-modules.mjs", "manifest.yml"]) fs.copyFileSync(path.join(root, f), path.join(repo, f));
  if (git("status", "--porcelain", "--untracked-files=no")) git("commit", "-qam", "door under test");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(repo, "node_modules"));
  for (const t of git("tag", "--list").split("\n").filter(Boolean)) git("tag", "-d", t);
  git("tag", "v98.0.0", "HEAD"); // a release that already shipped licensing (HEAD's manifest has it on)

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
  ok("no eligibility verdict at all: the door fails", r.status === 1);

  // a newer release tag WITHOUT licensing: this deploy turns licensing on, so the flag is required again
  const head = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "side");
  const m = fs.readFileSync(path.join(repo, "manifest.yml"), "utf8").replace(/(\n  licensing:\n    enabled:) true/, "$1 false");
  fs.writeFileSync(path.join(repo, "manifest.yml"), m);
  git("commit", "-qam", "licensing off"); git("tag", "v99.0.0", "HEAD"); git("checkout", "-q", head);
  r = door({ FAKE_ELIG: ELIGIBLE });
  ok("turning licensing on without the flag: the door refuses", r.status === 1 && /ABORT: manifest has app.licensing.enabled: true/.test(r.stdout));
  r = door({ FAKE_ELIG: ELIGIBLE }, ["--licensing-live"]);
  ok("turning licensing on with --licensing-live: the door passes", r.status === 0);

  ok("the tree is clean after every run (manifest and build stamp restored)", git("status", "--porcelain", "--untracked-files=no") === "");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
report("deploy-door");
