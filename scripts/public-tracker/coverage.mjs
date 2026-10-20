/*
 * Sentinel Vault - the public tracker's COVERAGE rules (baseline pillar 11).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// One dependency-free home (node:crypto only: no Jira, no Marketplace, no credentials) for the rules
// the tracker driver (tracker.mjs) and the production door (scripts/deploy-prod.sh, through
// release-gate.mjs) share. Owner, 2026-10-20: "the release notes should always get updated" - so the
// door refuses to cut a production release whose note lines have no tracker row, and the range the
// tracker publishes follows the cut release (its vX.Y.Z tag) instead of a constant raised by hand.
//
//   hashOf(line)               the row key: first 16 hex of sha256(note line) (receipt + issue property)
//   newestReleaseTag(text)     the highest vX.Y.Z in `git tag --list` output: the release production
//                              carries (a tag is cut after every production deploy - release checklist)
//   trackedNotes(notes, thr)   the release notes the tracker covers, FIRST_VERSION .. thr
//   missingRows(notes, rows)   every note line in those notes with no entries.mjs row
//   trackerReleaseRefusal(..)  the door's verdict: null, or the refusal naming each missing line
//   receiptVerifiedThrough(rc) the release the last clean `tracker.mjs verify` covered

import { createHash } from "node:crypto";

// 6.4.0 is the first version the in-app release notes carry.
export const FIRST_VERSION = [6, 4, 0];
export const vparts = (v) => String(v).split(".").map(Number);
export const vge = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; };
const SEMVER = /^\d+\.\d+\.\d+$/;

export const hashOf = (line) => createHash("sha256").update(line).digest("hex").slice(0, 16);

/** The highest release tag (vX.Y.Z) in `git tag --list` output, as [major, minor, patch], or null. */
export const newestReleaseTag = (text) => {
  const tags = String(text || "").split(/\s+/).map((t) => /^v(\d+\.\d+\.\d+)$/.exec(t.trim())).filter(Boolean).map((m) => vparts(m[1]));
  tags.sort((a, b) => (vge(a, b) ? -1 : 1));
  return tags[0] || null;
};

/** The notes the tracker covers: FIRST_VERSION .. `through` (both included), oldest first. */
export const trackedNotes = (notes, through) => [...(notes || [])]
  .filter((n) => n && SEMVER.test(n.version) && vge(vparts(n.version), FIRST_VERSION) && vge(through, vparts(n.version)))
  .sort((a, b) => (vge(vparts(a.version), vparts(b.version)) ? 1 : -1));

/** Every note line of `notes` with no row in `entries` (a rewrite, a withhold, a fold or the line as written). */
export const missingRows = (notes, entries) => {
  const out = [];
  for (const n of notes || []) {
    for (const kind of ["changes", "fixes"]) {
      for (const line of n[kind] || []) {
        const h = hashOf(line);
        if (!Object.prototype.hasOwnProperty.call(entries || {}, h)) out.push({ version: n.version, kind, h, line });
      }
    }
  }
  return out;
};

/** The release the last clean `verify` covered (written into the receipt only when verify found no failure). */
export const receiptVerifiedThrough = (rc) => {
  const v = rc && rc.verified && rc.verified.through;
  return typeof v === "string" && SEMVER.test(v) && rc.verified.failures === 0 ? v : null;
};

/**
 * THE DOOR'S VERDICT before a production deploy of `release` (the newest release note). null = go on;
 * else the refusal sentence. Two rules:
 *  1. every note line from FIRST_VERSION through `release` has an entries.mjs row (a public-safe
 *     rewrite, { withhold: "<why>" }, a fold, or the line as written) - named one by one;
 *  2. the release production carries NOW (`live`, the newest vX.Y.Z tag) has been applied and verified
 *     on the public tracker: the receipt's clean verify reaches it. The door prints those commands
 *     after every production deploy; this makes the next production deploy wait for them.
 */
export const trackerReleaseRefusal = ({ release, notes, entries, live, receipt }) => {
  if (!SEMVER.test(String(release || ""))) return `the release being deployed (${release}) is not a version number, so its tracker rows cannot be checked`;
  if (!(notes || []).some((n) => n && n.version === release)) return `release ${release} has no release note, so its tracker rows cannot be checked`;
  const why = [];
  const missing = missingRows(trackedNotes(notes, vparts(release)), entries);
  if (missing.length) {
    why.push([
      `${missing.length} release-note line(s) up to ${release} have no public tracker row in scripts/public-tracker/entries.mjs (give each a title and component, a public-safe rewrite { d } or { withhold: "<why>" }, then run tracker.mjs plan and the review gate):`,
      ...missing.map((m) => `  ${m.version} ${m.kind} ${m.h}: ${m.line.length > 140 ? `${m.line.slice(0, 140)}...` : m.line}`),
    ].join("\n"));
  }
  const verified = receiptVerifiedThrough(receipt);
  if (live && !(verified && vge(vparts(verified), live))) {
    why.push(`the public tracker was not applied and verified for ${live.join(".")}, the release production carries now (its tag; the receipt's last clean verify ${verified ? `reached ${verified}` : "is not recorded"}). Run, then commit the receipt:\n  node scripts/public-tracker/tracker.mjs apply && node scripts/public-tracker/tracker.mjs verify && node scripts/public-tracker/tracker.mjs public --reprove`);
  }
  return why.length ? why.join("\n") : null;
};

/** What the door prints after a production deploy of `release`: the release tag and the tracker step it now requires. */
export const trackerPostDeploySteps = (release) => [
  `PUBLIC TRACKER (required before the next production deploy): ${release} is in production. Cut its tag first - the tracker's range follows the newest release tag:`,
  `  git tag -a v${release} -m "Sentinel Vault ${release}" && git push origin v${release}`,
  "  node scripts/public-tracker/tracker.mjs apply",
  "  node scripts/public-tracker/tracker.mjs verify",
  "  node scripts/public-tracker/tracker.mjs public --reprove",
  "  then commit scripts/public-tracker/receipt-leanzero-demo.json (the next production deploy refuses until its clean verify reaches the newest release tag)",
].join("\n");
