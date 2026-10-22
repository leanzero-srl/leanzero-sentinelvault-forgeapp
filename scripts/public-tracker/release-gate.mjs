/*
 * Sentinel Vault - the production door's release notes and public tracker step (baseline pillars 4 and 11).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// Run by scripts/deploy-prod.sh. Owner, 2026-10-20: "no one needs to do that manually ... if we missed a release note
// it's fine. listen the release notes in app need to be done automatically please." So nothing here ever refuses a
// release or asks a person for anything:
//
//   node scripts/public-tracker/release-gate.mjs prepare [--approve-major]   # before the build
//   node scripts/public-tracker/release-gate.mjs post                        # after an ELIGIBLE production deploy
//   node scripts/public-tracker/release-gate.mjs check                       # a report only (exit 0)
//   node scripts/public-tracker/release-gate.mjs marketplace-latest          # the Marketplace's newest build (before the deploy)
//   node scripts/public-tracker/release-gate.mjs try-first <forge> <build>   # after `post`: the "Try it first" message
//
// `prepare` (scripts/release-autopilot.mjs does the writing):
//   1. THE NOTE. When the newest note in src/server/shared/release-notes.js is not newer than the release production
//      carries (production-release.json) and HEAD has commits after that release, the release being cut has no
//      note: it is written from those commits (messages and diffs; internal-only commits dropped) by one headless
//      model call, or from the commit subjects when the model is unavailable, as the next Forge version production
//      will get (minor + 1, or the next major with --approve-major). A newest note with no lines gets its lines the
//      same way. docs/RELEASE-NOTES.md is re-rendered, the module is re-imported and test/release-notes.test.mjs
//      must pass, else both files go back as they were (a missed note is fine). Committed on its own.
//   2. THE TRACKER ROWS. Every note line through the release being cut with no entries.mjs row gets one: written by
//      the model, reviewed by a second model pass (security/leakage), then the deterministic net and this tracker's
//      own public lint (coverage.mjs `lint`, the rules plan applies) withhold anything left that touches security,
//      permissions, isolation or keys, or carries an id or a path. A line naming an SVT key of a KNOWN bug folds into
//      it (the issue moves to Done with the release) and the known bug moves from KNOWN to CLOSED. Committed.
//   A rollback or a hotfix from an older tag (the production release's commit is not behind HEAD, or HEAD is
//   detached) writes nothing. Any failure is logged and the door goes on.
// `post` records the deployed release (and the commit) in production-release.json, the tracker's LAST_VERSION, then
// runs the tracker's apply, verify and public --reprove itself, commits what they wrote and pushes main. A failure
// there is logged and never changes the deploy's exit code; the daily digest's tracker check catches the drift.
// `try-first` (owner 2026-10-20; since 2026-10-22 release-autopilot 1.4.0 tryFirstHandOff) hands the "Try it first" top
// message of the new version's More details (a per-version field) to the watcher on the workhorse (forge-app-marketing
// apps/try-first/watcher.mjs, every 10 min, puts it on once the Marketplace lists the version): it kicks the watcher once
// and logs its heartbeat. It never waits for the listing. Logged only.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { productionRelease, trackerReleaseRefusal, missingRows, trackedNotes, vge, vparts, lint, plainLine } from "./coverage.mjs";
import * as A from "../release-autopilot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const NOTES_F = join(REPO, "src", "server", "shared", "release-notes.js");
const DOC_F = join(REPO, "docs", "RELEASE-NOTES.md");
const ENTRIES_F = join(HERE, "entries.mjs");
const RECEIPT_F = join(HERE, "receipt-leanzero-demo.json");
const PRODUCTION_FILE = join(HERE, "production-release.json");
const TRACKER = process.env.RELEASE_GATE_TRACKER || join(HERE, "tracker.mjs");
const REL = (f) => f.slice(REPO.length + 1);
const TRACKER_KEY = "SVT";
const MARKETPLACE_ADDON_KEY = "com.leanzero.confluence.sentinelvault";
const TRY_FIRST_APP = "sv";
// Test seams for the door test (a subprocess cannot be handed a fetch): a fixed Marketplace answer and a shorter wait.
const fetchImpl = process.env.RELEASE_GATE_MARKETPLACE_FAKE
  ? async () => ({ ok: true, json: async () => JSON.parse(process.env.RELEASE_GATE_MARKETPLACE_FAKE) })
  : globalThis.fetch;
const APP = "Sentinel Vault";
/** What Forge packages from this repo's source: a commit touching nothing here changes nothing a customer sees. */
const PACKAGED = ["src", "manifest.yml"];
/** The release-note gate's hazards (test/release-notes.test.mjs), so a generated line can never turn it red. */
const NOTE_HAZARDS = [[/\.(?:js|jsx|mjs)\b/, "a file name"], [/SV-SEC/, "a security id"], [/\bit\d{2}\b/, "an iteration id"]];

const log = (s) => console.log(s);
const git = (args, opts = {}) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const gitOk = (args) => { try { git(args); return true; } catch { return false; } };
let loads = 0;
const fresh = (f) => import(`${pathToFileURL(f).href}?gate=${Date.now()}-${++loads}`);
const readProduction = () => JSON.parse(readFileSync(PRODUCTION_FILE, "utf8"));
const today = () => new Date().toISOString().slice(0, 10);
const runner = A.claudeRunner();

/** The commit production runs: the v<release> tag, else the sha the door recorded, else the commit that recorded it. */
const productionCommit = (prod) => {
  const v = prod && prod.release;
  for (const ref of [v && `refs/tags/v${v}^{commit}`, prod && prod.sha && `${prod.sha}^{commit}`]) {
    if (!ref) continue;
    try { return git(["rev-parse", "-q", "--verify", ref]).trim(); } catch { /* next */ }
  }
  try { return git(["log", "-1", "--format=%H", "--", REL(PRODUCTION_FILE)]).trim() || null; } catch { return null; }
};

const noteText = (n, why) => [
  "",
  `  // ${n.version}: written by the release door (release-gate.mjs prepare) ${why}.`,
  "  note({",
  `    version: ${JSON.stringify(n.version)},`,
  `    date: ${JSON.stringify(n.date)},`,
  `    headline: ${JSON.stringify(n.headline)},`,
  "    changes: [",
  ...n.changes.map((l) => `      ${JSON.stringify(l)},`),
  "    ],",
  "    fixes: [",
  ...n.fixes.map((l) => `      ${JSON.stringify(l)},`),
  "    ],",
  `    action: ${JSON.stringify(n.action || "Nothing to do.")},`,
  "  }),",
].join("\n");

/** 1. The note for the release being cut, when it has none (or none with lines). Returns the release being cut. */
async function prepareNote({ approveMajor }) {
  const { RELEASE_NOTES } = await fresh(NOTES_F);
  const current = RELEASE_NOTES[0];
  let prod = null;
  try { prod = readProduction(); } catch { prod = null; }
  const live = prod && typeof prod.release === "string" && /^\d+\.\d+\.\d+$/.test(prod.release) ? prod.release : null;
  const lines = (n) => (n.changes || []).length + (n.fixes || []).length;
  if (!live) { log(`==> Release note: production-release.json records no release, so the door cannot tell which commits are new; ${current.version} is cut as written`); return current.version; }
  const forward = !vge(vparts(live), vparts(current.version));
  if (forward && lines(current)) { log(`==> Release note: ${current.version} has its note`); return current.version; }
  if (!gitOk(["symbolic-ref", "-q", "HEAD"])) { log("==> Release note: HEAD is detached (a rollback or a hotfix from a tag); nothing is written"); return current.version; }
  const base = productionCommit(prod);
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!base || !gitOk(["merge-base", "--is-ancestor", base, head])) { log(`==> Release note: the commit production runs (${live}) is not behind HEAD (a rollback or a hotfix); nothing is written`); return current.version; }
  if (!forward && base === head) { log(`==> Release note: HEAD is the commit production runs (${live}); a redeploy, nothing is written`); return current.version; }
  const [maj, min] = vparts(live);
  const version = forward ? current.version : (approveMajor ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`);
  const gitAsync = async (args) => git(args, { maxBuffer: 64 * 1024 * 1024 });
  const commits = await A.collectCommits({ git: gitAsync, from: base });
  for (const c of commits) {
    c.internal = A.isInternalCommit(c, PACKAGED);
    if (!c.internal) c.diff = await A.commitDiff({ git: gitAsync, sha: c.sha, packagedPaths: PACKAGED });
  }
  log(`==> Release note: ${version} has ${forward ? "a note with no lines" : "no note"}; writing it from ${commits.length} commit(s) since ${live} (${commits.filter((c) => !c.internal).length} customer-visible)`);
  const examples = RELEASE_NOTES.slice(0, 3).map((n) => ({ version: n.version, headline: n.headline, changes: n.changes, fixes: n.fixes, action: n.action }));
  const g = await A.generateNote({ appName: APP, version, previous: live, examples, commits, trackerKey: TRACKER_KEY, hazards: NOTE_HAZARDS, runner, log, requireChange: false,
    audience: "It is read by the Confluence site admin and space admins who run the app" });
  for (const d of g.dropped) log(`    dropped a generated line (${d.why}): ${d.line.slice(0, 120)}`);
  const n = { version, date: today(), headline: forward && current.headline && current.headline.length > 10 ? current.headline : g.note.headline, changes: g.note.changes, fixes: g.note.fixes, action: forward && current.action ? current.action : g.note.action };
  if (n.headline.length <= 10) n.headline = `${n.headline.replace(/\.$/, "")} in Sentinel Vault ${version}`;
  const why = `from the commits since ${live} (${g.source === "model" ? "headless model, checked line by line" : "the commit subjects, the model was unavailable"})`;
  const before = readFileSync(NOTES_F, "utf8"), docBefore = (() => { try { return readFileSync(DOC_F, "utf8"); } catch { return null; } })();
  const putBack = () => { writeFileSync(NOTES_F, before); if (docBefore !== null) writeFileSync(DOC_F, docBefore); };
  try {
    let after;
    if (forward) {
      const at = A.findExportLiteral(before, "RELEASE_NOTES");
      const el = A.arrayElements(before, at[0], at[1]).find((e) => e.text.includes(`version: ${JSON.stringify(current.version)}`));
      if (!el) throw new Error(`the note ${current.version} was not found in the module text`);
      after = before.slice(0, el.start) + noteText(n, why) + before.slice(el.end);
    } else after = A.insertAtTop(before, "RELEASE_NOTES", noteText(n, why));
    writeFileSync(NOTES_F, after);
    const M = await fresh(NOTES_F);
    if (M.CURRENT_RELEASE.version !== version || M.RELEASE_NOTES.length !== RELEASE_NOTES.length + (forward ? 0 : 1)) throw new Error("the module did not read back as the door wrote it");
    execFileSync(process.execPath, [join(REPO, "scripts", "render-release-notes.mjs")], { cwd: REPO, stdio: "ignore" });
    execFileSync(process.execPath, [join(REPO, "test", "release-notes.test.mjs")], { cwd: REPO, stdio: "pipe" });
    git(["commit", "-q", "-m", `release ${version}: in-app note written by the release door ${why}`, "--", REL(NOTES_F), REL(DOC_F)]);
    log(`==> Release note ${version} written and committed (${g.source}): ${n.headline}`);
    for (const l of [...n.changes, ...n.fixes]) log(`    ${l.length > 160 ? `${l.slice(0, 160)}...` : l}`);
    return version;
  } catch (e) {
    putBack();
    log(`==> Release note: could not write ${version} (${String(e && (e.stderr || e.message) || e).trim().split("\n").slice(-3).join(" ")}); the module was put back and the release goes on without it`);
    return current.version;
  }
}

const rowText = (r) => {
  const over = r.withhold ? { withhold: r.withhold } : r.fold ? { fold: r.fold, d: r.d } : r.d ? { d: r.d } : null;
  return `  ${JSON.stringify(r.h)}: [${JSON.stringify(r.title)}, ${JSON.stringify(r.c)}${over ? `, ${JSON.stringify(over)}` : ""}],`;
};

/** 2. A row for every note line through `release` that has none; KNOWN bugs closed by their SVT key move to CLOSED. */
async function prepareTracker(release) {
  const { RELEASE_NOTES } = await fresh(NOTES_F);
  const E = await fresh(ENTRIES_F);
  const missing = missingRows(trackedNotes(RELEASE_NOTES, vparts(release)), E.ENTRIES);
  if (!missing.length) { log(`==> Public tracker: every release-note line through ${release} has a row`); return; }
  let receipt = {};
  try { receipt = JSON.parse(readFileSync(RECEIPT_F, "utf8")); } catch { receipt = {}; }
  const examples = Object.entries(E.ENTRIES).slice(0, 8).map(([, row]) => row);
  log(`==> Public tracker: writing ${missing.length} row(s) for release-note lines through ${release}`);
  const out = await A.generateTrackerRows({ appName: APP, trackerKey: TRACKER_KEY, lines: missing, components: E.COMPONENTS, examples, runner, log,
    receiptIssues: receipt.issues || {}, knownSlugs: (E.KNOWN || []).map((k) => k.k) });
  const known = Object.fromEntries((E.KNOWN || []).map((k) => [k.k, k]));
  const rows = out.rows.map((r) => {
    const orig = missing.find((m) => m.h === r.h).line;
    let row = r;
    // the line carried a tracker key that is not a known bug: publish it without the key
    if (!row.withhold && !row.fold && !row.d && A.keysIn(orig, TRACKER_KEY).length) row = { ...row, d: plainLine(r.line) };
    // this tracker's own public lint (what plan checks): a row it would refuse is withheld instead
    const pub = row.fold ? `${known[row.fold].tf || known[row.fold].t} ${row.d}` : `${row.title} ${row.d || plainLine(orig)}`;
    const bad = lint(pub);
    if (bad.length && !row.withhold) row = row.fold ? { ...row, d: "This problem is fixed." } : { ...row, withhold: `the public lint found ${bad.join(", ")} (release door)` };
    return row;
  });
  const before = readFileSync(ENTRIES_F, "utf8");
  try {
    let src = A.insertAtTop(before, "ENTRIES", `\n  // ${release}: written by the release door on ${today()} (rows: ${out.source}; review pass: ${out.reviewed ? "model" : "none, deterministic net only"}).\n${rows.map(rowText).join("\n")}\n`);
    for (const slug of out.closed) {
      const r = rows.find((x) => x.fold === slug);
      src = A.moveKnownToClosed(src, slug, { release: r.version, key: r.key, at: today() });
    }
    writeFileSync(ENTRIES_F, src);
    const F = await fresh(ENTRIES_F);
    const lost = rows.filter((r) => !F.ENTRIES[r.h]);
    const stillKnown = out.closed.filter((s) => (F.KNOWN || []).some((k) => k.k === s) || !(F.CLOSED || []).some((k) => k.k === s));
    const keptAll = Object.keys(E.ENTRIES).every((h) => JSON.stringify(F.ENTRIES[h]) === JSON.stringify(E.ENTRIES[h]))
      && (F.KNOWN || []).length === (E.KNOWN || []).length - out.closed.length;
    if (lost.length || stillKnown.length || !keptAll) throw new Error("entries.mjs did not read back as the door wrote it");
    git(["commit", "-q", "-m", `public tracker: rows for the release-note lines through ${release}, written by the release door${out.closed.length ? `; closes ${rows.filter((r) => r.fold).map((r) => r.key).join(", ")}` : ""}`, "--", REL(ENTRIES_F)]);
    for (const r of rows) log(`    ${r.h} ${r.withhold ? `withheld (${r.withhold.slice(0, 90)})` : r.fold ? `closes ${r.key} (${r.fold})` : `"${r.title}"`}`);
    log(`==> Public tracker rows committed (${rows.filter((r) => !r.withhold).length} published, ${rows.filter((r) => r.withhold).length} withheld${out.closed.length ? `, ${out.closed.length} known bug(s) closed` : ""})`);
  } catch (e) {
    writeFileSync(ENTRIES_F, before);
    log(`==> Public tracker: could not write the rows (${e && e.message}); entries.mjs was put back and the release goes on (the tracker skips a line with no row)`);
  }
}

const run = (cmd, args, { cwd } = {}) => new Promise((resolve) => {
  let child;
  try { child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env }); } catch (e) { resolve({ code: 127 }); return; }
  child.on("error", () => resolve({ code: 127 }));
  child.on("close", (code) => resolve({ code: code == null ? 1 : code }));
});

/** A runner that captures what the command prints (the publisher's JSON verdict) and echoes it. */
const capture = (cmd, args) => new Promise((resolve) => {
  let stdout = "", stderr = "", child;
  try { child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env }); } catch (e) { resolve({ code: 127, stdout, stderr: String(e && e.message) }); return; }
  child.stdout.on("data", (d) => { stdout += d; process.stdout.write(d); });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + String(e && e.message) }));
  child.on("close", (code) => resolve({ code: code == null ? 1 : code, stdout, stderr }));
});

const cmd = process.argv[2];
if (cmd === "marketplace-latest") {
  const latest = await A.marketplaceLatest(MARKETPLACE_ADDON_KEY, fetchImpl);
  if (latest) console.log(latest.build);
  process.exit(0);
} else if (cmd === "try-first") {
  const forgeVersion = /^\d+\.\d+\.\d+$/.test(String(process.argv[3] || "")) ? process.argv[3] : null;
  const beforeBuild = process.argv[4] || null;
  void beforeBuild; // the build before the deploy only fed the old wait for the listing
  const r = await A.tryFirstHandOff({ app: TRY_FIRST_APP, forgeVersion, run: capture });
  log(r.ok
    ? `==> Marketplace: ${r.note}`
    : `==> Marketplace: the "Try it first" message was NOT handed off (${r.why}). The release stands; on the workhorse run node ~/Projects/forge-app-marketing/apps/try-first/watcher.mjs (one tick; it takes the vendor-browser lock itself).`);
  process.exit(0);
} else if (cmd === "prepare") {
  try {
    const release = await prepareNote({ approveMajor: process.argv.includes("--approve-major") });
    await prepareTracker(release);
    let live = null;
    try { live = productionRelease(readProduction()); } catch { live = null; }
    if (live) {
      let rc = {}; try { rc = JSON.parse(readFileSync(RECEIPT_F, "utf8")); } catch { rc = {}; }
      const v = rc.verified && rc.verified.failures === 0 ? rc.verified.through : null;
      if (!v || !vge(vparts(v), live)) log(`==> Public tracker: the last clean verify ${v ? `reached ${v}` : "is not recorded"}, behind ${live.join(".")} in production; this deploy's tracker step covers it`);
    }
  } catch (e) { log(`==> Release autopilot failed (${e && e.message}); the release goes on`); }
  process.exit(0);
} else if (cmd === "post") {
  const { CURRENT_RELEASE } = await fresh(NOTES_F);
  const release = CURRENT_RELEASE.version;
  try {
    let rec = null;
    try { rec = readProduction(); } catch { rec = null; }
    const recorded = productionRelease(rec);
    if (!recorded || !vge(recorded, vparts(release))) {
      writeFileSync(PRODUCTION_FILE, JSON.stringify({ release, at: today(), sha: git(["rev-parse", "--short=8", "HEAD"]).trim(), note: "The release production carries and the commit it was deployed from, written by scripts/deploy-prod.sh (release-gate.mjs post) after an eligible production deploy; the public tracker's LAST_VERSION." }, null, 2) + "\n");
      log(`==> Recorded ${release} in scripts/public-tracker/production-release.json`);
    } else log(`==> production-release.json already records ${recorded.join(".")} (not older than ${release}); left as it is`);
  } catch (e) { log(`==> Could not record ${release} in production-release.json (${e && e.message})`); }
  const steps = [["apply"], ["verify"], ["public", "--reprove"]].map((a) => ({ label: `tracker.mjs ${a.join(" ")}`, cmd: process.execPath, args: [TRACKER, ...a] }));
  const r = await A.runPostDeploySteps({ run, steps, cwd: REPO, log });
  log(r.ok ? `==> Public tracker: ${release} applied, verified and re-proved public` : `==> Public tracker: stopped at ${r.failed}; ${release} is deployed regardless (the daily digest's tracker check flags the drift)`);
  try {
    git(["add", "-A", "--", REL(HERE)]);
    if (!gitOk(["diff", "--cached", "--quiet"])) {
      git(["commit", "-q", "-m", `public tracker: ${release} in production${r.ok ? ", applied and verified" : ` (tracker step stopped at ${r.failed})`} by the release door`]);
      log("==> Committed the production record and the tracker receipt");
    }
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (branch === "main" && !process.env.RELEASE_GATE_NO_PUSH) {
      if (gitOk(["push", "-q", "origin", "HEAD:main"])) log("==> Pushed main");
      else log("==> Could not push main (pull and push it when convenient; nothing is lost)");
    }
  } catch (e) { log(`==> Could not commit the tracker step (${String(e && (e.stderr || e.message)).trim()})`); }
  process.exit(0);
} else if (cmd === "check") {
  // A report only (the door no longer refuses on it): what the tracker covers and what the next deploy will write.
  const { RELEASE_NOTES, CURRENT_RELEASE } = await fresh(NOTES_F);
  let entries = {}, receipt = {}, live = null;
  try { ({ ENTRIES: entries } = await fresh(ENTRIES_F)); } catch { entries = {}; }
  try { receipt = JSON.parse(readFileSync(RECEIPT_F, "utf8")); } catch { receipt = {}; }
  try { live = productionRelease(readProduction()); } catch { live = null; }
  const why = trackerReleaseRefusal({ release: CURRENT_RELEASE.version, notes: RELEASE_NOTES, entries, live, receipt });
  log(why ? `==> Public tracker (report; the door writes what is missing):\n${why}` : `==> Public tracker: every line through ${CURRENT_RELEASE.version} has a row and the tracker is verified`);
  process.exit(0);
} else {
  log("usage: release-gate.mjs prepare [--approve-major] | post | check | marketplace-latest | try-first <forge version> <build before>");
  process.exit(2);
}
