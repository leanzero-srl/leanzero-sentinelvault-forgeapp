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
// verify` does not reach the release production carries now (production-release.json) on a forward cut.
// A file it cannot read refuses too: a production release is never let through on an absent check.
// `post` records the deployed release in production-release.json (only when it is newer than the one
// recorded: a rollback or an older hotfix leaves it), which the tracker's LAST_VERSION reads. The rules
// live in coverage.mjs, shared with tracker.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { productionRelease, trackerReleaseRefusal, trackerPostDeploySteps, vge, vparts } from "./coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const fail = (msg) => { console.log(`ABORT: the public tracker does not cover this production release:\n${msg}`); process.exit(1); };

const { RELEASE_NOTES, CURRENT_RELEASE } = await import(pathToFileURL(join(REPO, "src", "server", "shared", "release-notes.js")).href);
const release = CURRENT_RELEASE && CURRENT_RELEASE.version;
const cmd = process.argv[2];
const PRODUCTION_FILE = join(HERE, "production-release.json");
const readProduction = () => JSON.parse(readFileSync(PRODUCTION_FILE, "utf8"));

if (cmd === "post") {
  let recorded = null;
  try { recorded = productionRelease(readProduction()); } catch { recorded = null; }
  if (!recorded || !vge(recorded, vparts(release))) {
    writeFileSync(PRODUCTION_FILE, JSON.stringify({ release, at: new Date().toISOString().slice(0, 10), note: "The release production carries, written by scripts/deploy-prod.sh (release-gate.mjs post) after an eligible production deploy; the public tracker's LAST_VERSION." }, null, 2) + "\n");
    console.log(`==> Recorded ${release} in scripts/public-tracker/production-release.json`);
  } else console.log(`==> production-release.json already records ${recorded.join(".")} (not older than ${release}); left as it is`);
  console.log(trackerPostDeploySteps(release));
} else if (cmd === "check") {
  let entries, receipt, production;
  try { ({ ENTRIES: entries } = await import(pathToFileURL(join(HERE, "entries.mjs")).href)); } catch (e) { fail(`could not read scripts/public-tracker/entries.mjs (${e && e.message})`); }
  if (!entries || typeof entries !== "object") fail("scripts/public-tracker/entries.mjs exports no ENTRIES");
  try { receipt = JSON.parse(readFileSync(join(HERE, "receipt-leanzero-demo.json"), "utf8")); } catch (e) { fail(`could not read scripts/public-tracker/receipt-leanzero-demo.json (${e && e.message})`); }
  try { production = readProduction(); } catch (e) { fail(`could not read scripts/public-tracker/production-release.json (${e && e.message})`); }
  const why = trackerReleaseRefusal({ release, notes: RELEASE_NOTES, entries, live: productionRelease(production), receipt });
  if (why) fail(why);
  console.log(`==> Public tracker: every release-note line through ${release} has a tracker row, and the tracker is verified through the release production carries`);
} else {
  console.log("usage: release-gate.mjs check | post");
  process.exit(2);
}
