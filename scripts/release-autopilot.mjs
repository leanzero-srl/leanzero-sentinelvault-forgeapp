/*
 * Sentinel Vault - the RELEASE AUTOPILOT (LeanZero Forge baseline pillars 4 and 11).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

/*
 * WHY THIS FILE EXISTS. Owner, 2026-10-20: "no one needs to do that manually ... if we missed a
 * release note it's fine. listen the release notes in app need to be done automatically please."
 * So a production release needs ZERO human steps for its in-app release note and its public
 * tracker rows. Each app's production door calls this module:
 *
 *   1. NOTE. When the release being cut has no note (or a note with no lines), the door reads the
 *      commits since the previous production release (messages AND diffs), drops the internal-only
 *      ones, and writes the note: one headless model call (`claude -p`, Anthropic) in the app's own
 *      note style, checked line by line against the app's hazards; a deterministic note from the
 *      commit subjects when the model is unavailable or answers nothing usable. A release never
 *      waits on the model.
 *   2. TRACKER ROWS. Every note line with no public tracker row gets one: a model pass writes the
 *      public title and a public-safe rewrite (or withholds the line), a SECOND model pass reviews
 *      the rows through a security/leakage lens, and a deterministic net withholds anything that
 *      still touches security, permissions, isolation, keys or tokens, or carries an id or a path.
 *      A line that names one of the tracker's own keys (e.g. "(LZMT-308)") closes THAT issue
 *      instead of opening a new one: it is folded into the known bug the key belongs to, which the
 *      tracker then moves to Done with the release as its fix version, and the known bug is moved
 *      out of KNOWN into CLOSED in entries.mjs.
 *   3. AFTER THE DEPLOY the door runs the tracker's apply / verify / public --reprove itself and
 *      commits the receipt. A failure there is logged and never blocks (the daily digest's tracker
 *      check catches the drift next morning).
 *   4. AFTER THE DEPLOY (CogniRunner, LeanZero Management, Sentinel Vault; not Cost Slasher) the
 *      "Try it first" top message of the new Marketplace version's More details (a VERSION field, so
 *      every production deploy needs it again) is put on by the WATCHER on the workhorse
 *      (forge-app-marketing apps/try-first/watcher.mjs, launchd net.leanzero.tryfirst-watcher, every
 *      10 min). Since core 1.4.0 the door does not wait for the listing: tryFirstHandOff kicks the
 *      watcher once, reads its heartbeat and returns. Logged, never blocks, never needs a person.
 *
 * A missed line is fine: nothing here refuses a release. Dependency-free (node builtins only); the
 * model is reached through the `claude` CLI on the machine running the door (laptop or workhorse).
 * Tests inject `runner` so nothing calls a model.
 *
 * The canonical copy lives in CogniRunner (scripts/release-autopilot.mjs) and is copied verbatim
 * into LeanZero Management, Sentinel Vault and Cost Slasher; change it there and copy it on.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";

export const AUTOPILOT_VERSION = "1.4.0";

export const hashOf = (line) => createHash("sha256").update(line).digest("hex").slice(0, 16);
const SEMVER = /^\d+\.\d+\.\d+$/;
export const isSemver = (v) => SEMVER.test(String(v || ""));
export const vcmp = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
export const nextPatch = (v) => { const [a, b, c] = String(v).split(".").map(Number); return `${a}.${b}.${c + 1}`; };

/* ── what counts as sensitive, and what must never reach a public or admin-facing line ───────── */

/** The owner's withhold rule (pillar 11): anything touching security, permissions, isolation or keys. */
export const SENSITIVE_RE = /\b(?:secur\w*|permission\w*|isolat\w*|credential\w*|secrets?|tokens?|api[- ]keys?|keys?|inject\w*|vulnerab\w*|exploit\w*|leak\w*|expos\w*|bypass\w*|authori[sz]\w*|authenticat\w*|encrypt\w*|decrypt\w*|passwords?|sandbox\w*|escap\w*|privilege\w*|access control|xss|csrf|ssrf|forg(?:e|ed|ery) request|cross-site|tamper\w*|spoof\w*|impersonat\w*|unauthori[sz]ed|attacker|malicious|harden\w*|guard\w*|protection)\b/i;

/** Text no admin-facing or public line may carry, whatever the app. Apps add their own. */
export const GENERIC_HAZARDS = Object.freeze([
  [/`/, "a backtick"],
  [/\$\{/, "a template placeholder"],
  [/(?:^|[\s(])(?:src|static|scripts|test|tests|docs|apps|packages)\/\S/, "a source path"],
  [/\b(?!(?:Node|Next|Vue|React|Nuxt|Express)\.js\b)[\w-]+\.(?:js|jsx|mjs|cjs|ts|tsx|mts|json|ya?ml|css|md|sh)\b/, "a file name"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/, "an email address"],
  [/\b[a-z0-9-]+\.atlassian\.net\b/i, "a site name"],
  [/\b(?:harness|surgeon|breaker|FRAME \d|backlog row|red-team|redteam|CI run|worktree)\b/i, "an internal process word"],
]);

/** Ids that are never a tracker key: finding ids, backlog rows, security ids (F-1287, B-738, SV-SEC-1, AMS-62653). */
export const idPattern = (trackerKey) => new RegExp(`\\b(?!${trackerKey}-\\d|(?:UTF|SHA|ISO|RFC|AES|TLS|HTTP|WCAG|ES|IPv)-\\d)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\\d+\\b`, "g");
export const keyPattern = (trackerKey) => new RegExp(`\\b${trackerKey}-(\\d+)\\b`, "g");
export const keysIn = (text, trackerKey) => [...new Set([...String(text || "").matchAll(keyPattern(trackerKey))].map((m) => `${trackerKey}-${m[1]}`))];
export const stripKeys = (text, trackerKey) => String(text || "")
  .replace(new RegExp(`\\s*\\((?:\\s*(?:${trackerKey}-\\d+)\\s*,?)+\\)`, "g"), "")
  .replace(new RegExp(`\\s*\\b(?:fixes|closes|for)?\\s*${trackerKey}-\\d+\\b`, "gi"), "")
  .replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();

/** Lines the door writes when it has nothing to say: never a public tracker issue. */
export const FILLER_LINES = Object.freeze(["Maintenance release with no change you will notice.", "This release fixes the problems listed below.", "Security and reliability improvements."]);

export const hazardsOf = (text, hazards) => (hazards || []).filter(([re]) => { re.lastIndex = 0; return re.test(String(text || "")); }).map(([, what]) => what);

/** A commit subject made into a plain sentence: ids, paths and code marks out, capital first, full stop. */
export const plainSentence = (s, trackerKey = "ZZZZ") => {
  let t = String(s || "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\s*\((?:src|static|scripts|test|tests|docs|apps|packages)\/[^)]*\)/g, "")
    .replace(/(?:^|\s)(?:src|static|scripts|test|tests|docs|apps|packages)\/[^\s)]+/g, " ")
    .replace(/\(((?:src|static|scripts|test|tests|docs|apps|packages)\/[^\s)]+)/g, "(")
    .replace(/\b(?!(?:Node|Next|Vue|React|Nuxt|Express)\.js\b)[\w-]+\.(?:js|jsx|mjs|cjs|ts|tsx|mts|json|ya?ml|css|md|sh)\b/g, "")
    .replace(idPattern(trackerKey), "")
    .replace(/\(\s*[,;]\s*/g, "(").replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:;,.-]+|[\s:;,-]+$/g, "")
    .trim();
  if (!t) return "";
  t = t[0].toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
};

/* ── git: the commits since the previous production release ────────────────────────────────── */

/**
 * `git(args)` resolves to stdout (and throws on a non-zero exit). Returns oldest-first
 * [{ sha, subject, body, files[] }], merges left out. `from` null = the last 200 commits.
 */
export const collectCommits = async ({ git, from, to = "HEAD", limit = 200 }) => {
  const range = from ? `${from}..${to}` : to;
  const out = await git(["log", "--no-merges", `-n${limit}`, "--name-only", "--format=%x1e%H%x1f%s%x1f%b%x1f", range]);
  const commits = [];
  for (const rec of String(out).split("\x1e")) {
    if (!rec.trim()) continue;
    const [sha, subject, body, files] = rec.split("\x1f");
    if (!sha || !sha.trim()) continue;
    commits.push({ sha: sha.trim(), subject: (subject || "").trim(), body: (body || "").trim(), files: String(files || "").split("\n").map((f) => f.trim()).filter(Boolean) });
  }
  return commits.reverse();
};

/** Release bookkeeping, tracker and skill commits: never a customer-visible change. */
export const INTERNAL_SUBJECT = /^(?:release \S+:|public tracker|skill\b|skills?:|docs?:|test(?:s|ing)?:|harness|ci:|chore|merge |revert "release |tracker\b|records?:|evidence|wip\b)/i;

/** A commit is internal when nothing it touched is packaged, or its subject is bookkeeping. */
export const isInternalCommit = (c, packagedPaths) => {
  if (INTERNAL_SUBJECT.test(c.subject || "")) return true;
  const files = c.files || [];
  if (!files.length) return true;
  return !files.some((f) => packagedPaths.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`)));
};

/** The diff of one commit on the packaged paths, cut to `max` characters (the model reads it). */
export const commitDiff = async ({ git, sha, packagedPaths, max = 4000 }) => {
  try {
    const d = await git(["show", "--format=", "--stat", "--patch", "--unified=2", sha, "--", ...packagedPaths]);
    // build output and lockfiles say nothing a customer reads
    const kept = String(d).split(/^diff --git /m).filter((chunk) => !/\b(?:build|dist|node_modules)\/|package-lock\.json|\.min\.js|bundle\.[0-9a-f]+\.js/.test(chunk.split("\n")[0] || "")).join("diff --git ");
    return kept.length > max ? `${kept.slice(0, max)}\n[... diff cut at ${max} characters]` : kept;
  } catch { return ""; }
};

/* ── the model ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The headless model call: `claude -p` (Anthropic), no tools, one turn, the prompt on stdin.
 * Resolves to the text, or null on any failure or timeout (a release never waits on it).
 * RELEASE_AUTOPILOT_MODEL=off turns it off; RELEASE_AUTOPILOT_MODEL=<name> picks the model.
 */
export const claudeRunner = ({ bin = process.env.RELEASE_AUTOPILOT_CLAUDE || "claude", model = process.env.RELEASE_AUTOPILOT_MODEL, timeoutMs = 240000 } = {}) => {
  if (model === "off") return async () => null;
  return (prompt) => new Promise((resolve) => {
    const args = ["-p", "--output-format", "text", "--max-turns", "1", "--tools", ""];
    if (model) args.push("--model", model);
    let out = "", done = false, child;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    try { child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } finish(null); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 && out.trim() ? out : null));
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
};

/** The first JSON object in a model's answer (fenced or bare), or null. */
export const parseModelJson = (text) => {
  if (typeof text !== "string") return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
};

/** One model call, tried twice (a headless call fails now and then: measured 2026-10-20 in Sentinel Vault, one null in four on the same prompt). */
const callModel = async (runner, prompt, log, what) => {
  if (typeof runner !== "function") return null;
  let text = null, json = null;
  for (let attempt = 1; attempt <= 2 && !json; attempt++) {
    try { text = await runner(prompt); } catch (e) { text = null; log(`[autopilot] ${what}: the model call failed (${e && e.message})`); }
    json = parseModelJson(text);
    if (!json && attempt === 1 && text !== undefined) log(`[autopilot] ${what}: ${text == null ? "no model answer" : "the model's answer was not JSON"}; trying once more`);
  }
  if (!json) log(`[autopilot] ${what}: ${text == null ? "no model answer" : "the model's answer was not JSON"}; the deterministic fallback is used`);
  return json;
};

/* ── 1. the release note ───────────────────────────────────────────────────────────────────── */

const isFixSubject = (s) => /\b(?:fix(?:es|ed)?|bug|broke|broken|crash\w*|wrong|no longer|regression|error|fail\w*|stuck|missing|lost)\b/i.test(s);

/**
 * The deterministic note, from the subjects of the customer-visible commits. Used when the model is
 * off or unusable; never refuses. Sensitive subjects collapse into one generic line.
 */
export const deterministicNote = ({ commits, previous, trackerKey, requireChange = true }) => {
  const changes = [], fixes = [];
  let sensitive = false;
  for (const c of commits) {
    const keys = keysIn(`${c.subject}\n${c.body}`, trackerKey);
    // a subject's leading label ("Activity:", "Review round 2:", "8.12.0:") and everything after its first clause go
    const first = stripKeys(c.subject, trackerKey).replace(/^[\w .()/-]{1,32}:\s+/, "").split(/;\s/)[0];
    const text = first.length > 180 ? "" : plainSentence(first, trackerKey);
    if (SENSITIVE_RE.test(c.subject)) {
      if (keys.length) fixes.push(`A problem reported on the public tracker is fixed (${keys.join(", ")}).`);
      else sensitive = true;
      continue;
    }
    if (text.length < 12) continue;
    const line = keys.length ? `${text.replace(/[.!?]$/, "")} (${keys.join(", ")}).` : text;
    (isFixSubject(c.subject) ? fixes : changes).push(line);
  }
  if (sensitive) changes.push("Security and reliability improvements.");
  const uniq = (a) => [...new Set(a)].slice(0, 12);
  const out = { changes: uniq(changes), fixes: uniq(fixes) };
  if (!out.changes.length && !out.fixes.length) out.changes = ["Maintenance release with no change you will notice."];
  if (requireChange && !out.changes.length) out.changes = ["This release fixes the problems listed below."];
  out.headline = out.fixes.length && out.changes.length <= 1
    ? `Fixes${previous ? ` since ${previous}` : ""}.`
    : `Improvements and fixes${previous ? ` since ${previous}` : ""}.`;
  return out;
};

export const notePrompt = ({ appName, version, previous, examples, commits, trackerKey, audience }) => [
  `You write the in-app release note for ${appName} ${version}. ${audience || "It is read by the Atlassian site admin who runs the app"}, in the app's What's new dialog.`,
  "",
  "Copy the voice, length and shape of these earlier notes of the same app (JSON):",
  JSON.stringify(examples || [], null, 1),
  "",
  "Rules:",
  "- Plain sentences an admin understands: what is new or different, and why it matters to them. Not how the code does it.",
  "- changes = new or different behaviour. fixes = something that was broken and is not any more (say what the admin saw go wrong, like the examples).",
  "- Leave out commits that change nothing a customer can see: tests, documentation, tooling, build, release bookkeeping, internal refactors.",
  "- Describe the END STATE against the previous release. A commit that corrects or reworks an earlier commit in this same list (a review round, a follow-up fix) is part of that change, not a separate fix: never write a fix line for a problem no released version had, and never say an older version did something unless the diff shows that older behaviour.",
  `- No ids of any kind except public tracker keys (${trackerKey}-<number>), no file names, paths, function or variable names, backticks, "\${", emails, site names, people's names, or internal words (harness, ledger, finding, gate, CI, worktree, surgeon, breaker, FRAME).`,
  "- A security, permission, isolation, credential or key change: say only what the admin will notice, never how an older version could be attacked or what it lacked.",
  `- When a commit names a public tracker key (${trackerKey}-<number>), list that key in "keys" of the line it produced.`,
  "- action = what the admin must do after updating (re-save, re-consent, re-run), or null when nothing.",
  "- If no commit changes anything a customer can see, return one change line saying it is a maintenance release.",
  "",
  `Commits since ${previous || "the previous production release"} (oldest first; message and diff):`,
  ...commits.map((c, i) => `--- commit ${i + 1}\n${c.subject}\n${c.body ? `${c.body.slice(0, 1500)}\n` : ""}${c.diff ? `diff:\n${c.diff}` : ""}`),
  "",
  'Answer with ONLY this JSON: {"headline":"one line","changes":[{"text":"...","keys":[]}],"fixes":[{"text":"...","keys":[]}],"action":null}',
].join("\n");

/**
 * THE NOTE for `version`. Returns { note: {headline, changes[], fixes[], action?}, source, dropped[] }.
 * Every line is checked against the app's hazards (plus the generic ones); a line that fails is dropped,
 * and a note with nothing left falls back to the deterministic note. Tracker keys named by the commits
 * ride on the line that produced them, and a key no line carries gets its own fixes line.
 */
export const generateNote = async ({ appName, version, previous, examples, commits, trackerKey, hazards = [], runner, log = () => {}, requireChange = true, audience }) => {
  const all = [...GENERIC_HAZARDS, ...hazards];
  const dropped = [];
  const visible = commits.filter((c) => !c.internal);
  const commitKeys = [...new Set(visible.flatMap((c) => keysIn(`${c.subject}\n${c.body}`, trackerKey)))];
  const clean = (t, keys) => {
    const base = stripKeys(String(t || "").trim(), trackerKey);
    const one = new RegExp(`^${trackerKey}-\\d+$`);
    const ks = [...new Set([...(Array.isArray(keys) ? keys : []).map((k) => String(k).trim()), ...keysIn(t, trackerKey)])].filter((k) => one.test(k));
    if (!base) return null;
    const line = ks.length ? `${base.replace(/[.!?]$/, "")} (${ks.join(", ")}).` : (/[.!?]$/.test(base) ? base : `${base}.`);
    const bad = hazardsOf(line.replace(keyPattern(trackerKey), ""), all);
    if (bad.length) { dropped.push({ line, why: bad.join(", ") }); return null; }
    if (idPattern(trackerKey).test(line)) { dropped.push({ line, why: "an id" }); return null; }
    return line;
  };
  let note = null, source = "deterministic";
  if (visible.length) {
    const json = await callModel(runner, notePrompt({ appName, version, previous, examples, commits: visible, trackerKey, audience }), log, `release note ${version}`);
    if (json && typeof json === "object") {
      const lines = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (typeof x === "string" ? clean(x, []) : clean(x && x.text, x && x.keys))).filter(Boolean);
      const changes = lines(json.changes), fixes = lines(json.fixes);
      const headline = typeof json.headline === "string" && json.headline.trim() && !hazardsOf(json.headline, all).length && !idPattern(trackerKey).test(json.headline) ? json.headline.trim() : null;
      if (changes.length || fixes.length) {
        note = { headline: headline || (fixes.length ? `Fixes since ${previous || "the previous release"}.` : `Improvements since ${previous || "the previous release"}.`), changes, fixes };
        const action = typeof json.action === "string" && json.action.trim() ? clean(json.action, []) : null;
        if (action) note.action = action;
        source = "model";
      }
    }
  }
  if (!note) {
    // the deterministic note passes the same hazard check as the model's (a subject can carry a site, an email, a path)
    const d = deterministicNote({ commits: visible, previous, trackerKey, requireChange });
    note = { ...d, changes: d.changes.map((l) => clean(l, [])).filter(Boolean), fixes: d.fixes.map((l) => clean(l, [])).filter(Boolean) };
    if (!note.changes.length && !note.fixes.length) note.changes = [FILLER_LINES[0]];
  }
  // every tracker key the commits name rides on some line
  const carried = new Set([...note.changes, ...note.fixes].flatMap((l) => keysIn(l, trackerKey)));
  for (const k of commitKeys) {
    if (carried.has(k)) continue;
    const c = visible.find((x) => keysIn(`${x.subject}\n${x.body}`, trackerKey).includes(k));
    const base = c && !SENSITIVE_RE.test(c.subject) ? plainSentence(stripKeys(c.subject, trackerKey), trackerKey) : "";
    const line = base.length >= 12 ? clean(`${base.replace(/[.!?]$/, "")} (${k}).`, [k]) : null;
    note.fixes.push(line || `A problem reported on the public tracker is fixed (${k}).`);
  }
  if (requireChange && !note.changes.length) note.changes.push("This release fixes the problems listed below.");
  note.changes = [...new Set(note.changes)];
  note.fixes = [...new Set(note.fixes)];
  return { note, source, dropped };
};

/* ── 2. the public tracker rows ────────────────────────────────────────────────────────────── */

export const TRACKER_HAZARDS = Object.freeze([
  ...GENERIC_HAZARDS,
  // "accountId" (the field name) or a raw id; "an account ID" in plain words is customer language (Sentinel Vault, 2026-10-20)
  [/\baccountId\b|\b[0-9a-f]{24}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-/, "an account or object id"],
]);

export const trackerRowsPrompt = ({ appName, trackerKey, lines, components, examples }) => [
  `You prepare rows for ${appName}'s PUBLIC tracker: an anonymous-read Jira project (key ${trackerKey}) anyone on the web can read without logging in. Each release-note line becomes one Done issue (a fix line is a Bug, a change line an Improvement).`,
  "",
  "For each line return:",
  '- "title": the issue summary, at most 90 characters, in customer words. For a fix line, name the problem that was fixed in the past tense (e.g. "The Rules tab printed a rule\'s field as its id").',
  '- "c": the component code that fits best, from: ' + JSON.stringify(components),
  '- "d": a public-safe rewrite of the line when the line itself carries detail that must not be on a public page, otherwise null (the line is published as written).',
  '- "withhold": a short reason when the line must NOT be published, otherwise null.',
  "",
  "WITHHOLD a line that touches security, permissions, access, isolation between sites or users, credentials, keys or tokens, injection, data exposure, or a guard/protection mechanism, and any line that says or implies an older version lacked a protection: a site keeps an older version until its admin approves an update, so such a line maps a hole those sites still have. Withhold development-only or internal lines too.",
  "Nothing internal may appear: no ids, file paths, function names, site or tenant names, people's names, emails, customer names, process words (harness, ledger, surgeon, breaker, finding).",
  "",
  "Existing rows of this tracker, for style ([title, component, override]):",
  JSON.stringify(examples || [], null, 1),
  "",
  "Lines (h = the row key, keep it exactly):",
  JSON.stringify(lines.map((l) => ({ h: l.h, version: l.version, kind: l.kind, line: l.line })), null, 1),
  "",
  'Answer with ONLY this JSON: {"rows":[{"h":"...","title":"...","c":"...","d":null,"withhold":null}]}',
].join("\n");

export const trackerReviewPrompt = ({ appName, trackerKey, rows }) => [
  `You are an adversarial reviewer. These rows are about to be published on ${appName}'s PUBLIC tracker (Jira project ${trackerKey}, readable by anyone on the web, including attackers). Try to prove each row unsafe or wrong.`,
  "",
  "Lenses:",
  "1. security: does the title or text tell an attacker how to trigger or exploit something, or reveal that older versions lack a protection, a permission check, an isolation, or a key/token/credential safeguard? Those rows are withheld.",
  "2. leakage: ids, file paths, function names, site/tenant names, people, emails, customer names, internal process words.",
  "3. accuracy: does the title claim more than the line says?",
  "",
  'For each row answer "ok", "withhold" (with a reason) or "rewrite" (with a safe title and/or d). Doubt = withhold: a missed public line is fine, a leaked one is not.',
  "",
  "Rows (line = the in-app release-note line; title/d = what would be published; d null = the line as written):",
  JSON.stringify(rows.map((r) => ({ h: r.h, line: r.line, title: r.title, d: r.d || null })), null, 1),
  "",
  'Answer with ONLY this JSON: {"verdicts":[{"h":"...","verdict":"ok","reason":null,"title":null,"d":null}]}',
].join("\n");

const shortTitle = (line) => {
  const first = String(line).replace(/^(?:New|Changed|Improved|Fixed|Fix)\s*:\s*/i, "").replace(/^./, (c) => c.toUpperCase()).split(/(?<=[.;:])\s/)[0].replace(/[.;:]$/, "");
  return first.length > 90 ? `${first.slice(0, 87).replace(/\s+\S*$/, "")}...` : first;
};

/** The deterministic row for one line: withheld when sensitive, else published as written. */
export const deterministicRow = (l, defaultComponent) => (SENSITIVE_RE.test(l.line)
  ? { ...l, title: shortTitle(l.line), c: defaultComponent, withhold: "touches security, permissions, isolation or keys (release door, deterministic rule)" }
  : { ...l, title: shortTitle(l.line), c: defaultComponent, d: null, withhold: null });

/** The net every row passes last, whatever the model said: sensitive or hazardous text is withheld. */
export const netRow = (r, trackerKey) => {
  if (r.withhold) return r;
  const pub = [r.title, r.d || stripKeys(r.line, trackerKey)];
  if (SENSITIVE_RE.test(r.line) || pub.some((t) => SENSITIVE_RE.test(t))) return { ...r, withhold: "touches security, permissions, isolation or keys (release door net)" };
  const bad = pub.flatMap((t) => hazardsOf(t, TRACKER_HAZARDS));
  if (pub.some((t) => idPattern(trackerKey).test(t))) bad.push("an id");
  return bad.length ? { ...r, withhold: `public text would carry ${[...new Set(bad)].join(", ")} (release door net)` } : r;
};

/**
 * Which existing tracker issue a key belongs to: the receipt maps row ids (a note-line hash or a KNOWN
 * slug) to { key }. Returns the KNOWN slug the key belongs to, or null.
 */
export const knownSlugForKey = (key, receiptIssues, knownSlugs) => {
  for (const [id, v] of Object.entries(receiptIssues || {})) {
    if (v && v.key === key && knownSlugs.includes(id)) return id;
  }
  return null;
};

/**
 * THE ROWS for every missing line. `lines` = [{ version, kind, h, line }]. Returns
 * { rows: [{ h, version, kind, line, title, c, d, withhold, fold }], closed: [slug], source, reviewed, log[] }.
 * A line naming a tracker key that belongs to a KNOWN bug is folded into it (that issue moves to Done
 * with this release) and the slug is returned in `closed` so the caller moves it out of KNOWN.
 */
export const generateTrackerRows = async ({ appName, trackerKey, lines, components, defaultComponent, examples, runner, receiptIssues, knownSlugs = [], log = () => {} }) => {
  const comps = components || {};
  const codes = Object.keys(comps);
  const dflt = defaultComponent && codes.includes(defaultComponent) ? defaultComponent : codes[0];
  const out = { rows: [], closed: [], source: "deterministic", reviewed: false };
  if (!lines.length) return out;
  const asLine = (l) => ({ ...l, line: stripKeys(l.line, trackerKey) || l.line });
  let rows = null;
  const json = await callModel(runner, trackerRowsPrompt({ appName, trackerKey, lines: lines.map(asLine), components: comps, examples }), log, "public tracker rows");
  if (json && Array.isArray(json.rows)) {
    const byH = new Map(json.rows.filter((r) => r && typeof r.h === "string").map((r) => [r.h, r]));
    rows = lines.map((l) => {
      const m = byH.get(l.h);
      if (!m) return deterministicRow(asLine(l), dflt);
      const title = typeof m.title === "string" && m.title.trim() ? m.title.trim().slice(0, 120) : shortTitle(asLine(l).line);
      const c = codes.includes(m.c) ? m.c : dflt;
      if (typeof m.withhold === "string" && m.withhold.trim()) return { ...asLine(l), title, c, withhold: m.withhold.trim() };
      return { ...asLine(l), title, c, d: typeof m.d === "string" && m.d.trim() ? m.d.trim() : null, withhold: null };
    });
    out.source = "model";
  }
  if (!rows) rows = lines.map((l) => deterministicRow(asLine(l), dflt));
  rows = rows.map((r) => (FILLER_LINES.includes(r.line) ? { ...r, withhold: "a filler line the door writes when there is nothing to say (release door)" } : r));
  // the review pass: one adversarial model read of what would be published (security/leakage lens)
  const toReview = rows.filter((r) => !r.withhold);
  if (toReview.length) {
    const rv = await callModel(runner, trackerReviewPrompt({ appName, trackerKey, rows: toReview }), log, "public tracker review");
    if (rv && Array.isArray(rv.verdicts)) {
      out.reviewed = true;
      const byH = new Map(rv.verdicts.filter((v) => v && typeof v.h === "string").map((v) => [v.h, v]));
      rows = rows.map((r) => {
        if (r.withhold) return r;
        const v = byH.get(r.h);
        if (!v) return { ...r, withhold: "the review pass returned no verdict for it (release door)" };
        if (v.verdict === "withhold") return { ...r, withhold: `review: ${String(v.reason || "withheld by the review pass").slice(0, 300)}` };
        if (v.verdict === "rewrite") return { ...r, title: typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, 120) : r.title, d: typeof v.d === "string" && v.d.trim() ? v.d.trim() : r.d };
        return r;
      });
    } else {
      // doubt = withhold: no review, no publication (a missed public line is fine, a leaked one is not)
      log("[autopilot] public tracker review: no usable verdicts, so every row it would have reviewed is withheld");
      rows = rows.map((r) => (r.withhold ? r : { ...r, withhold: "the review pass did not answer (release door: no review, no publication)" }));
    }
  }
  rows = rows.map((r) => netRow(r, trackerKey));
  // a line naming the tracker's own key closes that issue
  for (let i = 0; i < rows.length; i++) {
    const keys = keysIn(lines[i].line, trackerKey);
    for (const k of keys) {
      const slug = knownSlugForKey(k, receiptIssues, knownSlugs);
      if (!slug) { log(`[autopilot] ${lines[i].h} names ${k}, which is not a known bug on the tracker; the line gets its own issue`); continue; }
      if (out.closed.includes(slug)) { log(`[autopilot] ${lines[i].h} names ${k} too; that bug is already closed by an earlier line, so this one gets its own row`); continue; }
      const r = rows[i];
      rows[i] = { ...r, fold: slug, withhold: null, d: r.withhold ? "This problem is fixed." : (r.d || r.line), key: k };
      if (!out.closed.includes(slug)) out.closed.push(slug);
      break;
    }
  }
  out.rows = rows;
  return out;
};

/* ── editing a JavaScript module's text (entries.mjs, release-notes modules) ───────────────── */

/** Index just past the string, comment or template literal starting at `i`, or `i` when none starts there. */
export const skipNonCode = (src, i) => {
  const c = src[i], n = src[i + 1];
  if (c === "/" && n === "/") { const e = src.indexOf("\n", i); return e < 0 ? src.length : e; }
  if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); return e < 0 ? src.length : e + 2; }
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  return i;
};

/** The [open, close] indices of the first `{` or `[` literal after `export const <name> =` (through Object.freeze( too). */
export const findExportLiteral = (src, name) => {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < src.length && src[i] !== "{" && src[i] !== "[") { const j = skipNonCode(src, i); i = j > i ? j : i + 1; }
  if (i >= src.length) return null;
  const open = i;
  let depth = 0;
  for (; i < src.length;) {
    const j = skipNonCode(src, i);
    if (j > i) { i = j; continue; }
    const ch = src[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") { depth--; if (depth === 0) return [open, i]; }
    i++;
  }
  return null;
};

/** The top-level elements of the array literal at [open, close]: [{ start, end, text }] where end includes a trailing comma. */
export const arrayElements = (src, open, close) => {
  const out = [];
  let depth = 0, start = open + 1;
  for (let i = open + 1; i < close;) {
    const j = skipNonCode(src, i);
    if (j > i) { i = j; continue; }
    const ch = src[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) { out.push({ start, end: i + 1, text: src.slice(start, i + 1) }); start = i + 1; }
    i++;
  }
  if (src.slice(start, close).trim()) out.push({ start, end: close, text: src.slice(start, close) });
  return out;
};

/** Insert `text` right after the opening brace/bracket of `export const <name>`. */
export const insertAtTop = (src, name, text) => {
  const at = findExportLiteral(src, name);
  if (!at) throw new Error(`no export const ${name} literal`);
  return src.slice(0, at[0] + 1) + text + src.slice(at[0] + 1);
};

/**
 * Move the KNOWN element whose `k` is `slug` into `export const CLOSED = [...]` (created at the end of
 * the file when absent), with a dated comment saying which release closed it. Returns the new text.
 */
export const moveKnownToClosed = (src, slug, { release, key, at, knownName = "KNOWN", closedName = "CLOSED" }) => {
  const k = findExportLiteral(src, knownName);
  if (!k) throw new Error(`no export const ${knownName}`);
  const els = arrayElements(src, k[0], k[1]);
  const re = new RegExp(`\\bk\\s*:\\s*(["'])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  const el = els.find((e) => re.test(e.text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")));
  if (!el) throw new Error(`${knownName} has no element with k: "${slug}"`);
  let body = el.text.replace(/^\s*\n/, "").replace(/\s+$/, "");
  if (!body.endsWith(",")) body += ",";
  const without = src.slice(0, el.start) + src.slice(el.end);
  const comment = `\n  // closed by ${release}${key ? ` (${key})` : ""}, moved out of ${knownName} by the release door on ${at}`;
  const c = findExportLiteral(without, closedName);
  if (c) return without.slice(0, c[1]) + `${comment}\n${body.startsWith("  ") ? body : `  ${body.trim()}`}\n` + without.slice(c[1]);
  return `${without.replace(/\s*$/, "\n")}\n// Known bugs a release closed (folded into that release's note line, so the issue is Done with it).\n// Moved out of ${knownName} by the release door (scripts/release-autopilot.mjs); the tracker still builds their issues.\nexport const ${closedName} = [${comment}\n${body.startsWith("  ") ? body : `  ${body.trim()}`}\n];\n`;
};

/* ── 3. after the deploy ───────────────────────────────────────────────────────────────────── */

/**
 * Run the tracker's post-deploy steps in order ([{ label, cmd, args }]), stopping at the first that
 * fails. NEVER throws and never decides the door's exit code: the caller logs the outcome.
 * Returns { ok, failed: label|null, results[] }.
 */
export const runPostDeploySteps = async ({ run, steps, cwd, log = () => {} }) => {
  const results = [];
  for (const s of steps) {
    log(`[autopilot] public tracker: ${s.label}`);
    let r;
    try { r = await run(s.cmd, s.args, { cwd, stream: true }); } catch (e) { r = { code: 127, stdout: "", stderr: String(e && e.message) }; }
    results.push({ label: s.label, code: r.code });
    if (r.code !== 0) { log(`[autopilot] public tracker: "${s.label}" exited ${r.code}; the release stands (the daily digest's tracker check flags the drift)`); return { ok: false, failed: s.label, results }; }
  }
  return { ok: true, failed: null, results };
};

/* ── 4. the Marketplace "Try it first" message (owner 2026-10-20; CogniRunner, LeanZero Management, Sentinel Vault) ── */

/**
 * More details is per Marketplace VERSION, so the top "Try <app> first, no install" paragraph has to be put on every
 * new version a production deploy creates. The publisher (forge-app-marketing apps/try-first) drives the vendor
 * Chrome on the workhorse (CDP 9333, signed in as office@leanzero.net), reads versions/latest, types only when the
 * text or link differs, saves and reads back; it prints one JSON result and always exits 0.
 */
export const TRY_FIRST = Object.freeze({
  script: "/Users/workhorse/Projects/forge-app-marketing/apps/try-first/mp-more-details-try-first.mjs",
  lock: "/private/tmp/claude-501/mp-vendor.lock",
  host: "workhorse",
});

/** The Marketplace's newest version of an app ({ build, name }), or null. Public endpoint, cache-busted. */
export const marketplaceLatest = async (addonKey, fetchImpl = globalThis.fetch) => {
  try {
    const r = await fetchImpl(`https://marketplace.atlassian.com/rest/2/addons/${addonKey}/versions/latest?nc=${Date.now()}`);
    if (!r || !r.ok) return null;
    const v = await r.json();
    return v && v.buildNumber != null ? { build: String(v.buildNumber), name: String(v.name || "") } : null;
  } catch { return null; }
};

/** The publisher's verdict for one app, from its printed JSON. */
export const tryFirstVerdict = (text, app) => {
  const j = parseModelJson(String(text || ""));
  if (!j) return { ok: false, why: "the publisher printed no result" };
  if (j.error) return { ok: false, why: String(j.error).split("\n")[0].slice(0, 300) };
  const r = j.apps && j.apps[app];
  if (!r) return { ok: false, why: `the publisher's result has no entry for ${app}` };
  if (r.ok === true) return { ok: true, wrote: true, version: r.version, build: r.build };
  if (r.ok === undefined && r.textEqual && r.linkPresent) return { ok: true, wrote: false, version: r.version, build: r.build };
  return { ok: false, why: `${app} ${r.version || ""} (build ${r.build || "?"}) did not read back with the message (${JSON.stringify(r.after || { textEqual: r.textEqual, linkPresent: r.linkPresent })})` };
};

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** The shell line that takes the vendor-browser lock, runs the publisher for one app, and gives the lock back. */
export const tryFirstCommand = (app, { dry = false } = {}) => [
  `L=${TRY_FIRST.lock}; got=0; mkdir -p "$(dirname "$L")"`,
  `for i in $(seq 1 60); do if mkdir "$L" 2>/dev/null; then got=1; break; fi; sleep 10; done`,
  `if [ "$got" != 1 ]; then echo '{"error":"the vendor browser lock was busy for 10 minutes"}'; exit 0; fi`,
  `cd /tmp && ${dry ? "DRY=1 " : ""}APPS=${app} node ${TRY_FIRST.script}; s=$?; rmdir "$L"; exit $s`,
].join("; ");

/**
 * After a production deploy: wait (up to `waitMs`) for the Marketplace to list the new version (`forgeVersion`
 * when known, else any build newer than `beforeBuild`), then run the publisher for `app` (cr | lzm | sv) on the
 * workhorse. NEVER throws; returns { ok, why?, wrote?, version?, build? } for the caller to log.
 */
export const tryFirstAfterDeploy = async ({ app, addonKey, forgeVersion, beforeBuild, run, log = () => {}, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 20 * 60000, everyMs = 30000, onWorkhorse = /works-mac-studio|worksmacstudio/i.test(os.hostname()) }) => {
  try {
    log(`[autopilot] marketplace: waiting for ${forgeVersion || "the new version"} of ${addonKey} to be listed, then re-applying the "Try it first" message`);
    let latest = null;
    const started = Date.now();
    for (;;) {
      latest = await marketplaceLatest(addonKey, fetchImpl);
      const listed = latest && (forgeVersion ? latest.name === forgeVersion : beforeBuild ? latest.build !== String(beforeBuild) : true);
      if (listed) break;
      if (Date.now() - started >= waitMs) return { ok: false, why: `the Marketplace did not list ${forgeVersion || "a new version"} within ${Math.round(waitMs / 60000)} minutes (latest: ${latest ? `${latest.name} build ${latest.build}` : "unreadable"}); the next production deploy re-applies the message` };
      await sleep(everyMs);
    }
    const cmd = tryFirstCommand(app);
    const r = onWorkhorse ? await run("zsh", ["-lc", cmd], {}) : await run("ssh", ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", TRY_FIRST.host, `zsh -lc ${shq(cmd)}`], {});
    if (r.code !== 0 && !String(r.stdout || "").includes("{")) return { ok: false, why: `the publisher could not run (exit ${r.code}: ${String(r.stderr || "").trim().slice(0, 200)})` };
    return { ...tryFirstVerdict(r.stdout, app), listed: latest };
  } catch (e) { return { ok: false, why: String(e && e.message) }; }
};

/**
 * Core 1.4.0 (2026-10-22): the door no longer waits up to 20 minutes for the listing. The watcher on the workhorse
 * (forge-app-marketing apps/try-first/watcher.mjs, LaunchAgent net.leanzero.tryfirst-watcher, every 10 min) puts the
 * message on every newly listed version, typing only when its DRY read differs. tryFirstAfterDeploy above stays for a
 * by-hand run; the doors call tryFirstHandOff.
 */
export const TRY_FIRST_WATCHER = Object.freeze({
  label: "net.leanzero.tryfirst-watcher",
  state: "/Users/workhorse/.local/state/leanzero-tryfirst/state.json",
  staleMs: 60 * 60000, // a worst-case watcher tick lasts ~40 min
});

/** The shell line that kicks the watcher (launchd starts no second copy while one runs) and prints its state. */
export const tryFirstHandOffCommand = () =>
  `launchctl kickstart gui/$(id -u)/${TRY_FIRST_WATCHER.label} >/dev/null 2>&1; echo "KICK=$?"; cat ${TRY_FIRST_WATCHER.state} 2>/dev/null || echo "{}"`;

/**
 * After a production deploy: kick the watcher once and read its heartbeat, so a watcher that is not installed,
 * stopped, or signed out shows in the release log. Never waits for the listing, NEVER throws; returns
 * { ok, deferred: true, note | why, lastTickAt?, applied? } for the caller to log.
 */
export const tryFirstHandOff = async ({ app, forgeVersion, run, now = () => Date.now(), onWorkhorse = /works-mac-studio|worksmacstudio/i.test(os.hostname()) }) => {
  try {
    const cmd = tryFirstHandOffCommand();
    const r = onWorkhorse ? await run("zsh", ["-lc", cmd], {}) : await run("ssh", ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", TRY_FIRST.host, `zsh -lc ${shq(cmd)}`], {});
    const out = String((r && r.stdout) || "");
    const kick = /KICK=(\d+)/.exec(out);
    if (!kick) return { ok: false, deferred: true, why: `the workhorse could not be reached (exit ${r && r.code}: ${String((r && r.stderr) || "").trim().slice(0, 200)})` };
    // 0 = kicked; 37 = a tick is already running. Anything else: the agent is not loaded.
    if (kick[1] !== "0" && kick[1] !== "37") return { ok: false, deferred: true, why: `the watcher is not loaded on the workhorse (launchctl kickstart exit ${kick[1]}); install it: zsh ~/Projects/forge-app-marketing/apps/try-first/install-watcher.sh` };
    let st = null;
    try { st = JSON.parse(out.slice(out.indexOf("{"))); } catch { st = null; }
    const last = st && Date.parse(st.lastTickAt || "");
    if (!last) return { ok: false, deferred: true, why: "the watcher has no recorded tick yet (its state file is missing or unreadable)" };
    const mins = Math.max(0, Math.round((now() - last) / 60000));
    if (now() - last > TRY_FIRST_WATCHER.staleMs) return { ok: false, deferred: true, lastTickAt: st.lastTickAt, why: `the watcher last ran ${mins} min ago (every 10 min expected)` };
    const h = st.health || {};
    if (h.status === "fail") return { ok: false, deferred: true, lastTickAt: st.lastTickAt, why: `the watcher is failing: ${String(h.detail || "").slice(0, 300)}` };
    const a = (st.apps && st.apps[app]) || {};
    const applied = a.appliedVersion ? `${a.appliedVersion} (build ${a.appliedBuild})` : "nothing yet";
    return { ok: true, deferred: true, lastTickAt: st.lastTickAt, applied, note: `the "Try it first" message is handed to the watcher on the workhorse (kicked; last tick ${mins} min ago; ${app} last confirmed on ${applied}). It puts the message on ${forgeVersion || "the new version"} within ~10 min of the Marketplace listing it; nothing waits here.` };
  } catch (e) { return { ok: false, deferred: true, why: String(e && e.message) }; }
};
