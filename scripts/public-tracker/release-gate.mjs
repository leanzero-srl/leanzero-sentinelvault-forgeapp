/*
 * Sentinel Vault - the production door's public tracker gate (baseline pillar 11).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// Run by scripts/deploy-prod.sh, offline (no Jira, no Marketplace, no credentials):
//
//   node scripts/public-tracker/release-gate.mjs check   # before the build: exit 1 + every missing line named
//   node scripts/public-tracker/release-gate.mjs post    # after an eligible production deploy: the step now required
//
// `check` refuses (exit 1) when any release-note line from 6.4.0 through the release being cut (the
// newest note, CURRENT_RELEASE) has no entries.mjs row, or when the receipt's last clean `tracker.mjs
// verify` does not reach the newest vX.Y.Z tag (the release production carries now). A file it cannot
// read refuses too: a production release is never let through on an absent check. The rules live in
// coverage.mjs, shared with tracker.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { newestReleaseTag, trackerReleaseRefusal, trackerPostDeploySteps } from "./coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const fail = (msg) => { console.log(`ABORT: the public tracker does not cover this production release:\n${msg}`); process.exit(1); };

const { RELEASE_NOTES, CURRENT_RELEASE } = await import(pathToFileURL(join(REPO, "src", "server", "shared", "release-notes.js")).href);
const release = CURRENT_RELEASE && CURRENT_RELEASE.version;
const cmd = process.argv[2];

if (cmd === "post") {
  console.log(trackerPostDeploySteps(release));
} else if (cmd === "check") {
  let entries, receipt, tags;
  try { ({ ENTRIES: entries } = await import(pathToFileURL(join(HERE, "entries.mjs")).href)); } catch (e) { fail(`could not read scripts/public-tracker/entries.mjs (${e && e.message})`); }
  if (!entries || typeof entries !== "object") fail("scripts/public-tracker/entries.mjs exports no ENTRIES");
  try { receipt = JSON.parse(readFileSync(join(HERE, "receipt-leanzero-demo.json"), "utf8")); } catch (e) { fail(`could not read scripts/public-tracker/receipt-leanzero-demo.json (${e && e.message})`); }
  try { tags = execFileSync("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"], { cwd: REPO, encoding: "utf8" }); } catch (e) { fail(`could not list the release tags (${e && e.message})`); }
  const why = trackerReleaseRefusal({ release, notes: RELEASE_NOTES, entries, live: newestReleaseTag(tags), receipt });
  if (why) fail(why);
  console.log(`==> Public tracker: every release-note line through ${release} has a tracker row, and the tracker is verified through the newest release tag`);
} else {
  console.log("usage: release-gate.mjs check | post");
  process.exit(2);
}
