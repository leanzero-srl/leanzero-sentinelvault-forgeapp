/*
 * Sentinel Vault - tests of the release autopilot core (scripts/release-autopilot.mjs).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// 2026-10-20 — THE RELEASE AUTOPILOT (scripts/release-autopilot.mjs), the shared core of every LeanZero
// production door's automatic release note and public tracker rows. Owner: "the release notes in app need
// to be done automatically". Pinned here, with a fake model (nothing calls `claude`):
//   1. commits since a sha are read oldest first, with files; internal-only commits are recognised;
//   2. the note: model lines that carry an id, a path or a backtick are dropped; a tracker key the commits
//      name rides on its line (and gets its own line when the model dropped it); no model = deterministic
//      note, never a refusal; sensitive subjects collapse into one generic line;
//   3. the tracker rows: the model writes them, the review pass withholds/rewrites, a row the review did
//      not answer is withheld, the net withholds sensitive or hazardous text whatever the model said, and
//      a line naming a KNOWN bug's key is folded into it (closed) instead of opening a new issue;
//   4. the KNOWN -> CLOSED text move keeps the module loadable and moves exactly one element;
//   5. post-deploy steps never throw and report the failing step;
//   6. the real model runner answers null (never throws) when the CLI is missing or turned off;
//   7. the Marketplace "Try it first" step waits for the new version, runs the publisher on the workhorse under
//      the vendor-browser lock, and reports (never throws) a late listing, a publisher error or a failed read-back.
// Run by npm test. Alone: node test/release-autopilot.test.mjs (the core is shared with the other LeanZero doors).
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const A = await import(pathToFileURL(path.join(repo, "scripts/release-autopilot.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const fake = (answers) => { const q = [...answers]; const seen = []; const f = async (p) => { seen.push(p); const a = q.shift(); return typeof a === "function" ? a(p) : a; }; f.seen = seen; return f; };

/* ── 1. commits ─────────────────────────────────────────────────────────────── */
const tmp = mkdtempSync(path.join(os.tmpdir(), "autopilot-"));
try {
  const g = (...args) => execFileSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(path.join(tmp, "src")); mkdirSync(path.join(tmp, "docs"));
  writeFileSync(path.join(tmp, "src", "a.js"), "1"); g("add", "."); g("commit", "-qm", "base");
  const base = g("rev-parse", "HEAD").trim();
  writeFileSync(path.join(tmp, "src", "a.js"), "2"); g("add", "."); g("commit", "-qm", "Validators stop blocking on a timeout", "-m", "Fixes CRT-12 for real.");
  writeFileSync(path.join(tmp, "docs", "x.md"), "d"); g("add", "."); g("commit", "-qm", "Write the design down");
  writeFileSync(path.join(tmp, "src", "a.js"), "3"); g("add", "."); g("commit", "-qm", "release 1.2.3: production predicted Forge 9.0.0");
  const git = async (args) => g(...args);
  const cs = await A.collectCommits({ git, from: base });
  ok(cs.length === 3 && cs[0].subject === "Validators stop blocking on a timeout" && cs[0].files.includes("src/a.js") && /CRT-12/.test(cs[0].body), `three commits since base, oldest first, with body and files (${JSON.stringify(cs.map((c) => c.subject))})`);
  const P = ["src", "static", "manifest.yml"];
  ok(!A.isInternalCommit(cs[0], P) && A.isInternalCommit(cs[1], P) && A.isInternalCommit(cs[2], P), "a src change is visible; a docs-only commit and release bookkeeping are internal");
  const d = await A.commitDiff({ git, sha: cs[0].sha, packagedPaths: P });
  ok(/a\.js/.test(d) && /\+2/.test(d), "the diff of a commit on the packaged paths is read");
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* ── 2. the note ────────────────────────────────────────────────────────────── */
{
  const commits = [
    { subject: "Validators stop blocking on a timeout", body: "Fixes CRT-12.", files: ["src/a.js"] },
    { subject: "Rules tab names each rule's field", body: "", files: ["static/x.jsx"] },
    { subject: "Close the cross-site token leak in the cache", body: "", files: ["src/c.js"] },
  ];
  const runner = fake([JSON.stringify({ headline: "Validators no longer block when the AI is slow.", changes: [{ text: "The Rules tab names each rule's field.", keys: [] }, { text: "See src/index.js for details.", keys: [] }], fixes: [{ text: "A validator blocked a transition when its check timed out.", keys: ["CRT-12"] }, { text: "Fixed F-1287 in `raceDeadline`.", keys: [] }], action: null })]);
  const r = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits, trackerKey: "CRT", runner });
  ok(r.source === "model", "the model's note is used");
  ok(r.note.fixes.includes("A validator blocked a transition when its check timed out (CRT-12).") , `the tracker key rides on its line (${JSON.stringify(r.note.fixes)})`);
  ok(!r.note.changes.some((l) => /src\//.test(l)) && !r.note.fixes.some((l) => /F-1287|`/.test(l)) && r.dropped.length === 2, `lines with a path, an id or a backtick are dropped (${JSON.stringify(r.dropped)})`);
  ok(/Commits since 1\.34\.0/.test(runner.seen[0]) && /Validators stop blocking/.test(runner.seen[0]), "the prompt carries the commits since the previous release");

  const r2 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits, trackerKey: "CRT", runner: fake([JSON.stringify({ headline: "x", changes: [{ text: "The Rules tab names each rule's field.", keys: [] }], fixes: [] })]) });
  ok(r2.note.fixes.some((l) => /\(CRT-12\)\.$/.test(l)), `a key the model dropped still gets its own fixes line (${JSON.stringify(r2.note.fixes)})`);

  const r3 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits, trackerKey: "CRT", runner: fake([null]) });
  ok(r3.source === "deterministic" && r3.note.changes.length >= 1 && r3.note.headline, "no model answer = the deterministic note (never a refusal)");
  ok(r3.note.changes.includes("Security and reliability improvements.") && !JSON.stringify(r3.note).includes("token leak"), `a sensitive subject collapses into one generic line (${JSON.stringify(r3.note)})`);
  ok([...r3.note.changes, ...r3.note.fixes].some((l) => /\(CRT-12\)\.$/.test(l)), "the deterministic note carries the key too");

  const r4 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits: [], trackerKey: "CRT", runner: fake([]) });
  ok(r4.note.changes.length === 1 && /Maintenance release/.test(r4.note.changes[0]), "no visible commit = a maintenance note, no model call");
  const leaky = [
    { subject: "Breaker round on wolfaenpak.atlassian.net: the harness found it for mihai@leanzero.net", body: "", files: ["src/a.js"] },
    { subject: "Validators name the field (src/shared/fields.js) in the log", body: "", files: ["src/b.js"] },
  ];
  const r6 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits: leaky, trackerKey: "CRT", runner: fake([null]) });
  const all6 = [...r6.note.changes, ...r6.note.fixes].join(" | ");
  ok(!/atlassian\.net|@leanzero|harness|src\//.test(all6) && r6.dropped.length >= 1 && /Validators name the field in the log\./.test(all6), `the deterministic note passes the hazard check too: a site, an email or an internal word drops the line; a path in parentheses is stripped (${all6})`);
  const r5 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits, trackerKey: "CRT", runner: fake(["not json at all"]) });
  ok(r5.source === "deterministic", "an answer that is not JSON falls back");
  // Sentinel Vault core additions (2026-10-20): one retry, the fallback's subject trimming
  const sv6 = await A.generateNote({ appName: "CogniRunner", version: "1.35.0", previous: "1.34.0", examples: [], commits, trackerKey: "CRT", runner: fake([null, JSON.stringify({ headline: "Validators no longer block when the AI is slow.", changes: [{ text: "The Rules tab names each rule's field.", keys: [] }], fixes: [] })]) });
  ok(sv6.source === "model", "a model call that answers nothing is tried once more before the fallback");
  const sv7 = A.deterministicNote({ commits: [{ subject: "Review round 2: when the sweep cannot judge who edited, it writes nothing; the memo is bounded", body: "" }], previous: "1", trackerKey: "CRT" });
  ok(sv7.changes[0] === "When the sweep cannot judge who edited, it writes nothing.", `the fallback drops a subject's label and keeps its first clause (${JSON.stringify(sv7)})`);
}

/* ── 3. tracker rows ────────────────────────────────────────────────────────── */
{
  const L = (line, kind = "fixes") => ({ version: "1.35.0", kind, h: A.hashOf(line), line });
  const lines = [
    L("The Rules tab names each rule's field.", "changes"),
    L("A validator blocked a transition when its check timed out (CRT-12)."),
    L("Projects no longer see each other's cached keys."),
    L("Explain answers faster.", "changes"),
    L("The audit log names the provider.", "changes"),
  ];
  const rows = lines.map((l, i) => ({ h: l.h, title: ["The Rules tab names each rule's field", "Validators blocked on a timeout", "Cache separation", "Explain is faster", "Audit log names the provider"][i], c: i === 0 ? "A" : "ZZ", d: null, withhold: null }));
  const verdicts = [
    { h: lines[0].h, verdict: "ok" },
    { h: lines[1].h, verdict: "rewrite", title: "Validators blocked a transition when the AI was slow", d: null },
    { h: lines[2].h, verdict: "ok" },
    { h: lines[3].h, verdict: "withhold", reason: "names a timing detail" },
    // lines[4] gets no verdict
  ];
  const runner = fake([JSON.stringify({ rows }), JSON.stringify({ verdicts })]);
  const receiptIssues = { "known-validator-timeout": { key: "CRT-12" }, [lines[0].h]: { key: "CRT-400" } };
  const out = await A.generateTrackerRows({ appName: "CogniRunner", trackerKey: "CRT", lines, components: { A: "Admin panel", W: "Workflow rules" }, defaultComponent: "W", examples: [], runner, receiptIssues, knownSlugs: ["known-validator-timeout"] });
  const by = Object.fromEntries(out.rows.map((r) => [r.h, r]));
  ok(out.source === "model" && out.reviewed, "rows written by the model and reviewed");
  ok(!by[lines[0].h].withhold && by[lines[0].h].c === "A" && by[lines[0].h].title === "The Rules tab names each rule's field", "an ok row is kept with its component");
  ok(by[lines[1].h].fold === "known-validator-timeout" && by[lines[1].h].key === "CRT-12" && !by[lines[1].h].withhold && out.closed.join() === "known-validator-timeout", `a line naming a KNOWN bug's key folds into it and closes it (${JSON.stringify(by[lines[1].h])})`);
  ok(!/CRT-12/.test(by[lines[1].h].d) && by[lines[1].h].title === "Validators blocked a transition when the AI was slow", "the rewrite applies and the public text carries no key");
  ok(/net/.test(by[lines[2].h].withhold || ""), `a sensitive line the model and the review let through is withheld by the net (${by[lines[2].h].withhold})`);
  ok(/review: names a timing/.test(by[lines[3].h].withhold || ""), "the review's withhold applies");
  ok(/no verdict/.test(by[lines[4].h].withhold || ""), "a row the review did not answer is withheld");
  ok(out.rows.every((r) => ["A", "W"].includes(r.c)), "an unknown component code falls back to the default");
  ok(A.netRow({ h: "x", line: "Activity names the person, not an account ID.", title: "Activity names the person, not an account ID", d: null }, "CRT").withhold == null
    && /id/.test(A.netRow({ h: "x", line: "x", title: "Reads accountId from the page", d: null }, "CRT").withhold || ""), "\"an account ID\" in plain words is published; the accountId field name is not");

  const det = await A.generateTrackerRows({ appName: "CogniRunner", trackerKey: "CRT", lines, components: { W: "Workflow rules" }, examples: [], runner: fake([null, null]), receiptIssues: {}, knownSlugs: [] });
  ok(det.source === "deterministic" && !det.reviewed, "no model = deterministic rows");
  ok(det.rows.every((r) => r.withhold) && /review pass did not answer/.test(det.rows.find((r) => r.h === lines[0].h).withhold), "no model = no review = every row withheld (doubt = withhold)");
  const half = await A.generateTrackerRows({ appName: "CogniRunner", trackerKey: "CRT", lines, components: { W: "Workflow rules" }, examples: [], runner: fake([JSON.stringify({ rows }), "not json"]), receiptIssues: {}, knownSlugs: [] });
  ok(half.rows.every((r) => r.withhold) && !half.reviewed, "rows written but the review answered nothing: every row withheld");
  // two lines naming the same key: the first closes the bug, the second gets an ordinary row (no double move)
  const twice = [L("Validators stopped blocking (CRT-12)."), L("The validator log names the timeout (CRT-12).")];
  const tw = await A.generateTrackerRows({ appName: "CogniRunner", trackerKey: "CRT", lines: twice, components: { W: "W" }, examples: [], runner: fake([JSON.stringify({ rows: twice.map((l) => ({ h: l.h, title: "t", c: "W", d: null, withhold: null })) }), JSON.stringify({ verdicts: twice.map((l) => ({ h: l.h, verdict: "ok" })) })]), receiptIssues: { "known-x": { key: "CRT-12" } }, knownSlugs: ["known-x"] });
  ok(tw.closed.join() === "known-x" && tw.rows.filter((r) => r.fold).length === 1 && !tw.rows[1].fold, "two lines naming one key: one fold, the second line gets its own row");
  const fill = await A.generateTrackerRows({ appName: "CogniRunner", trackerKey: "CRT", lines: [L("Maintenance release with no change you will notice.", "changes")], components: { W: "W" }, examples: [], runner: fake([JSON.stringify({ rows: [{ h: A.hashOf("Maintenance release with no change you will notice."), title: "Maintenance", c: "W", d: null, withhold: null }] }), JSON.stringify({ verdicts: [{ h: A.hashOf("Maintenance release with no change you will notice."), verdict: "ok" }] })]), receiptIssues: {}, knownSlugs: [] });
  ok(/filler/.test(fill.rows[0].withhold || ""), "a filler line is never a public issue");
  ok(det.rows.find((r) => r.h === lines[1].h).line === "A validator blocked a transition when its check timed out.", "a key with no KNOWN bug is stripped from the public line and the line gets its own issue");
}

/* ── 4. KNOWN -> CLOSED ─────────────────────────────────────────────────────── */
{
  const src = [
    "export const ENTRIES = {",
    '  "aaaa": ["T", "W"],',
    "};",
    "export const KNOWN = [",
    "  {",
    '    k: "known-one", t: "One", c: "W", // a comment with k: "known-two" in it',
    "  },",
    "  // the second known bug",
    "  {",
    '    k: "known-two", t: "Two, with [brackets] and {braces}", c: "A",',
    "  },",
    "  {",
    '    k: "known-three", t: "Three", c: "A",',
    "  },",
    "];",
    "",
  ].join("\n");
  const after = A.moveKnownToClosed(src, "known-two", { release: "1.35.0", key: "CRT-12", at: "2026-10-20" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "autopilot-known-"));
  try {
    writeFileSync(path.join(dir, "e.mjs"), after);
    const M = await import(pathToFileURL(path.join(dir, "e.mjs")).href);
    ok(M.KNOWN.map((k) => k.k).join() === "known-one,known-three" && M.CLOSED.map((k) => k.k).join() === "known-two" && M.CLOSED[0].t === "Two, with [brackets] and {braces}", `known-two moved to CLOSED, nothing else changed (${JSON.stringify({ K: M.KNOWN.map((k) => k.k), C: M.CLOSED })})`);
    ok(/closed by 1\.35\.0 \(CRT-12\)/.test(after) && /the second known bug/.test(after.slice(after.indexOf("export const CLOSED"))), "the move is dated and carries its comment");
    const again = A.moveKnownToClosed(after, "known-three", { release: "1.36.0", at: "2026-10-21" });
    writeFileSync(path.join(dir, "f.mjs"), again);
    const M2 = await import(pathToFileURL(path.join(dir, "f.mjs")).href);
    ok(M2.KNOWN.map((k) => k.k).join() === "known-one" && M2.CLOSED.map((k) => k.k).join() === "known-two,known-three", "a second close appends to the existing CLOSED");
    let threw = false; try { A.moveKnownToClosed(src, "known-nine", { release: "1", at: "x" }); } catch { threw = true; }
    ok(threw, "an unknown slug throws (the caller keeps the file as it was)");
    const ins = A.insertAtTop(src, "ENTRIES", '\n  "bbbb": ["U", "A"],');
    writeFileSync(path.join(dir, "g.mjs"), ins);
    const M3 = await import(pathToFileURL(path.join(dir, "g.mjs")).href);
    ok(Object.keys(M3.ENTRIES).join() === "bbbb,aaaa", "insertAtTop puts a row first in ENTRIES");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ── 5. post-deploy steps ───────────────────────────────────────────────────── */
{
  const calls = [];
  const run = async (cmd, args) => { calls.push(args[1]); return { code: args[1] === "verify" ? 1 : 0 }; };
  const r = await A.runPostDeploySteps({ run, steps: [["apply"], ["verify"], ["public"]].map(([m]) => ({ label: m, cmd: "node", args: ["t.mjs", m] })) });
  ok(!r.ok && r.failed === "verify" && calls.join() === "apply,verify", "the first failing step stops the run and is named");
  const r2 = await A.runPostDeploySteps({ run: async () => { throw new Error("boom"); }, steps: [{ label: "apply", cmd: "x", args: [] }] });
  ok(!r2.ok && r2.results[0].code === 127, "a runner that throws is a failure, never an exception");
}

/* ── 6. the real model runner degrades to null ──────────────────────────────── */
{
  ok(await A.claudeRunner({ bin: "/nonexistent/claude-binary" })("hi") === null, "a missing CLI answers null");
  ok(await A.claudeRunner({ model: "off" })("hi") === null, "RELEASE_AUTOPILOT_MODEL=off answers null");
  ok(A.parseModelJson("```json\n{\"a\":1}\n```") && A.parseModelJson("x {\"a\":2} y").a === 2 && A.parseModelJson("nope") === null, "JSON is read from a fenced or bare answer");
}

/* ── 7. the Marketplace "Try it first" step ─────────────────────────────────── */
{
  const mp = (seq) => { const q = [...seq]; return async () => { const v = q.length > 1 ? q.shift() : q[0]; return v ? { ok: true, json: async () => v } : { ok: false }; }; };
  const published = (app, extra) => JSON.stringify({ mode: "WRITE", apps: { [app]: { version: "7.17.0", build: "2001350", textEqual: false, linkPresent: false, ok: true, save: {}, ...extra } } }, null, 1);
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: published("cr"), stderr: "" }; };
  let slept = 0;
  const r = await A.tryFirstAfterDeploy({ app: "cr", addonKey: "k", forgeVersion: "7.17.0", run, fetchImpl: mp([{ buildNumber: 1, name: "7.16.0" }, { buildNumber: 1, name: "7.16.0" }, { buildNumber: 2, name: "7.17.0" }]), sleep: async () => { slept++; }, onWorkhorse: false });
  ok(r.ok && r.wrote && slept === 2, `waits until the Marketplace lists the new version, then publishes (${JSON.stringify(r)}, slept ${slept})`);
  ok(calls.length === 1 && calls[0][0] === "ssh" && calls[0].includes("workhorse") && /APPS=cr node .*mp-more-details-try-first\.mjs/.test(calls[0][calls[0].length - 1]) && /mkdir "\$L"/.test(calls[0][calls[0].length - 1]) && /rmdir "\$L"/.test(calls[0][calls[0].length - 1]), "runs the publisher for that app on the workhorse, holding the vendor-browser lock");
  const local = []; await A.tryFirstAfterDeploy({ app: "lzm", addonKey: "k", forgeVersion: "6.10.0", run: async (c, a) => { local.push([c, ...a]); return { code: 0, stdout: published("lzm"), stderr: "" }; }, fetchImpl: mp([{ buildNumber: 2, name: "6.10.0" }]), sleep: async () => {}, onWorkhorse: true });
  ok(local[0][0] === "zsh" && /APPS=lzm/.test(local[0][2]), "on the workhorse itself it runs locally");
  let t = 0;
  const late = await A.tryFirstAfterDeploy({ app: "cr", addonKey: "k", forgeVersion: "7.17.0", run, fetchImpl: mp([{ buildNumber: 1, name: "7.16.0" }]), sleep: async () => {}, waitMs: 0, onWorkhorse: false });
  ok(!late.ok && /did not list 7\.17\.0/.test(late.why) && calls.length === 1, "a version never listed in time is reported, the publisher is not run");
  const already = A.tryFirstVerdict(JSON.stringify({ apps: { sv: { version: "8.13.0", build: "9", textEqual: true, linkPresent: true } } }), "sv");
  ok(already.ok && !already.wrote, "a version that already carries the message is a pass with nothing written");
  ok(!A.tryFirstVerdict(JSON.stringify({ error: "Error: NOT SIGNED IN https://id.atlassian.com\n at x" }), "cr").ok && /NOT SIGNED IN/.test(A.tryFirstVerdict(JSON.stringify({ error: "Error: NOT SIGNED IN\nstack" }), "cr").why), "a publisher error is reported with its first line");
  ok(!A.tryFirstVerdict(JSON.stringify({ apps: { cr: { version: "1", build: "2", textEqual: false, linkPresent: false, ok: false, after: { textEqual: false } } } }), "cr").ok, "a write that did not read back fails");
  ok(!A.tryFirstVerdict("", "cr").ok && !A.tryFirstVerdict(JSON.stringify({ apps: {} }), "cr").ok, "no result, or no entry for the app, fails");
  const boom = await A.tryFirstAfterDeploy({ app: "cr", addonKey: "k", forgeVersion: "1.0.0", run: async () => { throw new Error("ssh exploded"); }, fetchImpl: mp([{ buildNumber: 2, name: "1.0.0" }]), sleep: async () => {}, onWorkhorse: false });
  ok(!boom.ok && /ssh exploded/.test(boom.why), "a runner that throws is a reported failure, never an exception");
  const noMp = await A.marketplaceLatest("k", async () => { throw new Error("offline"); });
  ok(noMp === null, "an unreadable Marketplace is null");
}

console.log(`release-autopilot: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
