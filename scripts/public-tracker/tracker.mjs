/*
 * Sentinel Vault - the PUBLIC tracker driver (baseline pillar 11).
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// The Sentinel Vault PUBLIC tracker on leanzero-demo.atlassian.net (project SVT, a Jira project even
// though Sentinel Vault is a Confluence app). Ported from CogniRunner's
// test-harness/scripts/public-tracker/tracker.mjs (project CRT); the method is in the
// leanzero-forge-app-baseline skill, references/public-tracker.md.
//
//   node scripts/public-tracker/tracker.mjs plan [--check-site]  # lint + review file, NO writes
//   node scripts/public-tracker/tracker.mjs apply                # create what is missing (idempotent)
//   node scripts/public-tracker/tracker.mjs verify               # re-read every issue, counts, review file
//   node scripts/public-tracker/tracker.mjs public               # grant BROWSE_PROJECTS to anyone on SVT's OWN scheme, prove it
//
// `plan` writes review-<date>.md next to this file: every planned issue's exact public text. Nothing
// is applied or made public before an independent adversarial review of that file passes (the gate
// rule), and `public` runs only after `verify` and that review. `--check-site` adds READ-ONLY calls
// (is the key free, does the scheme exist); plan never writes to Jira.
//
// Source of truth: src/server/shared/release-notes.js (FIRST_VERSION .. LAST_VERSION), the editorial
// layer in entries.mjs (titles, components, public-safe rewrites, withheld and folded lines) and
// entries.mjs KNOWN (open bugs). Every issue is keyed by the first 16 hex of sha256(note line) (or
// the KNOWN slug), recorded in receipt-<site>.json AND as the issue property `svt.tracker`, so a
// rerun with a lost receipt adopts what exists instead of duplicating it.
//
// It NEVER edits anything it did not create: no shared scheme, no other project, no global setting.
// Credentials: JIRA_ADMIN_EMAIL + JIRA_API_TOKEN from the file named by PUBLIC_TRACKER_ENV, default
// ../CogniRunner/test-harness/.env beside this repo (never printed). Only apply/verify/public and
// plan --check-site read them.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRIES, KNOWN, COMPONENTS } from "./entries.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SITES = { "leanzero-demo": { url: "https://leanzero-demo.atlassian.net" } };
const siteArg = (process.argv.find((a) => a.startsWith("--site=")) || "--site=leanzero-demo").slice(7);
if (!SITES[siteArg]) throw new Error(`unknown --site ${siteArg}; one of ${Object.keys(SITES).join(", ")}`);
const SITE = SITES[siteArg].url;
const RECEIPT = join(HERE, `receipt-${siteArg}.json`);
const VERIFY_REVIEW = join(HERE, `review-${siteArg}.md`);
const APP = "Sentinel Vault";
const KEY = "SVT";
const NAME = "Sentinel Vault Public Tracker";
const DESCRIPTION = "The public list of known issues and fixes in Sentinel Vault for Confluence.";
const PERM_SCHEME_NAME = "Sentinel Vault Public Tracker permissions";
const TEMPLATE = "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic";
const PROP = "svt.tracker";
// 6.4.0 is the first version the in-app release notes carry. 6.8.0 has no note: it was the same
// evening's redeploy of 6.7.0 (built bundles), and carries no line of its own.
const FIRST_VERSION = [6, 4, 0];
// The newest version the tracker records. Raise it deliberately when a new release's lines are to be
// published (each needs an entries.mjs row first); main may already carry later notes.
const LAST_VERSION = [7, 1, 0];
// RELEASED = listed as "public" by the Marketplace's own versions endpoint (no login), and released in
// Jira on the Marketplace's release date. Sentinel Vault has no deploy ledger, so the Marketplace is
// the source; there is no hand-set constant to forget to raise or to raise too early (review
// 2026-10-09). A version the Marketplace does not list as public reads "in testing" and its Jira
// version stays unreleased. If the endpoint cannot be read, every mode refuses to run.
const MARKETPLACE_VERSIONS = "https://marketplace.atlassian.com/rest/2/addons/com.leanzero.confluence.sentinelvault/versions?limit=100";
// A Forge MAJOR (6.0.0 added the Assets read scopes, 7.0.0 the personal-data reporting scope) is not
// installed automatically: a site below it stays there until a site admin approves the update. So every
// issue of version M.x says that a site on version M-1 or earlier gets it only after that approval.
// The Marketplace number of a Forge app carries the Forge major, so M is the version's first number.
// Projects that may answer a logged-out read besides SVT: LeanZero's other PUBLIC trackers, by key.
// Anything else readable without a login is a leak and fails `public` (review 2026-10-09: deriving
// this from "its scheme grants anyone" switched the check off for every other project).
const EXPECTED_PUBLIC = new Set(["CRT"]);
const STATUS = { released: "Done", known: ["Backlog", "To Do", "Open"] };

const vparts = (v) => v.split(".").map(Number);
const vge = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; };
let MARKET = null; // version name -> { status, date } from the Marketplace
async function loadMarketplace() {
  if (MARKET) return MARKET;
  const r = await fetch(MARKETPLACE_VERSIONS, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Marketplace versions endpoint answered HTTP ${r.status}; refusing to guess what is released`);
  const body = await r.json();
  const list = (body._embedded && body._embedded.versions) || [];
  if (!list.length) throw new Error("Marketplace versions endpoint listed no versions; refusing to guess what is released");
  MARKET = new Map(list.map((v) => [v.name, { status: v.status, date: v.release && v.release.date }]));
  return MARKET;
}
const inProduction = (v) => {
  if (!MARKET) throw new Error("Marketplace versions not loaded");
  const m = MARKET.get(v);
  return !!(m && m.status === "public" && m.date);
};
const marketDate = (v) => (MARKET && MARKET.get(v) ? MARKET.get(v).date : null);
export const hashOf = (line) => createHash("sha256").update(line).digest("hex").slice(0, 16);

// ---------- credentials (lazy: plan without --check-site needs none) ----------
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); // the API token itself can contain '='
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}
let AUTH = null;
function auth() {
  if (AUTH) return AUTH;
  const path = process.env.PUBLIC_TRACKER_ENV || resolve(REPO, "..", "CogniRunner", "test-harness", ".env");
  if (!existsSync(path)) throw new Error(`no credentials file at ${path} (set PUBLIC_TRACKER_ENV)`);
  const env = parseEnv(readFileSync(path, "utf8"));
  if (!env.JIRA_ADMIN_EMAIL || !env.JIRA_API_TOKEN) throw new Error("credentials file lacks JIRA_ADMIN_EMAIL / JIRA_API_TOKEN");
  AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
  return AUTH;
}

async function jira(path, method = "GET", body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(SITE + path, {
      method,
      headers: { Authorization: auth(), Accept: "application/json", "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 429 && attempt < 5) {
      await new Promise((res) => setTimeout(res, Number(r.headers.get("retry-after") || 5) * 1000));
      continue;
    }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 400); }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, body: json };
  }
}
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
};

// ---------- the desired state ----------
async function loadNotes() {
  const { RELEASE_NOTES } = await import(join(REPO, "src", "server", "shared", "release-notes.js"));
  const notes = RELEASE_NOTES.filter((n) => vge(vparts(n.version), FIRST_VERSION) && vge(LAST_VERSION, vparts(n.version)));
  return [...notes].sort((a, b) => (vge(vparts(a.version), vparts(b.version)) ? 1 : -1)); // oldest first
}

// Drop the note's own "New: " / "Changed: " / "Improved: " label; the issue type says which.
const plainLine = (line) => line.replace(/^(New|Changed|Improved):\s+/, "").replace(/^./, (c) => c.toUpperCase());

const PUBLIC_LINT = [
  [/\b(SV-[A-Z0-9-]+|SEC-\d+|WF-\d+|CLS-\d+|BRK\d*-\d+|BN-\d+|BR-\d+|F-?\d{2,}|it\d{2,})\b/, "finding or iteration id"],
  [/wolfaenpak|leanzero-demo|test-easy-apps|leanzero-apps-demo|SVSEC1P|SVPLAIN|\bWFH\b/i, "tenant or test space name"],
  [/\b(Mihai|Gabriela|Perdum)\b/i, "person name"],
  [/\bsrc\/|\.jsx?\b|\.mjs\b|\.css\b|:\d{2,}\b/, "file path or line reference"],
  [/@[a-z0-9-]+\.[a-z]{2,}/i, "email address"],
  [/\b(accountId|712020|557058)\b/i, "account id"],
  [/api[_ -]?key\s*[:=]|token\s*[:=]|ATATT|svt_[A-Za-z0-9]/i, "secret-looking text"],
  [/inject|bypass|exploit|cross-tenant|confused deputy|\basApp\b|\basUser\b/i, "security wording"],
  [/\b(steward|realm|operator|resolver|KVS|webtrigger|test hook|harness|surgeon|breaker|ledger)s?\b/i, "internal word"],
  [/\b(Claude|Anthropic|OpenAI|Gemini|Bedrock|OpenRouter)\b/i, "model or provider name"],
];
const lint = (text) => PUBLIC_LINT.filter(([re]) => re.test(text)).map(([, why]) => why);

export async function desired() {
  await loadMarketplace();
  const notes = await loadNotes();
  const issues = [];
  const withheld = [];
  const problems = [];
  const folds = {};
  const seenRows = new Set();
  for (const n of notes) {
    for (const [kind, type] of [["changes", "Improvement"], ["fixes", "Bug"]]) {
      for (const line of n[kind] || []) {
        const h = hashOf(line);
        seenRows.add(h);
        const e = ENTRIES[h];
        if (!e) { problems.push(`no entries.mjs row for ${n.version} ${kind}: ${line.slice(0, 80)}`); continue; }
        const [title, code, over = {}] = e;
        if (over.withhold) { withheld.push({ h, version: n.version, kind, why: over.withhold, line }); continue; }
        if (over.fold) { folds[over.fold] = { h, version: n.version, line }; continue; }
        issues.push({
          id: over.id || h, type, version: n.version, date: n.date, component: COMPONENTS[code],
          summary: title, text: over.d || plainLine(line), sanitized: !!over.d, line,
          status: STATUS.released, released: inProduction(n.version),
        });
      }
    }
  }
  for (const h of Object.keys(ENTRIES)) if (!seenRows.has(h)) problems.push(`entries.mjs row ${h} matches no note line in ${FIRST_VERSION.join(".")}..${LAST_VERSION.join(".")} (reworded note?)`);
  for (const k of KNOWN) {
    issues.push({
      id: k.k, type: "Bug", affects: k.affects, component: COMPONENTS[k.c], summary: k.t,
      see: k.see, where: k.where, workaround: k.workaround, why: k.why || null,
      status: STATUS.known, known: true, text: [k.see, k.where, k.workaround, k.why || ""].join(" ").trim(),
    });
  }
  const byId = Object.fromEntries(issues.map((i) => [i.id, i]));
  for (const [target, f] of Object.entries(folds)) {
    if (!byId[target]) problems.push(`note line ${f.h} folds into ${target}, which is not an issue on the tracker`);
    else if (!byId[target].sanitized) problems.push(`note line ${f.h} folds into ${target}, whose description does not carry it (give ${target} a d)`);
  }
  for (const i of issues) {
    const bad = lint(`${i.summary} ${i.text}`);
    if (bad.length) problems.push(`${i.id} "${i.summary}": ${bad.join(", ")}`);
    if (!i.component) problems.push(`${i.id}: unknown component`);
    if (!i.summary) problems.push(`${i.id}: empty title`);
    if (i.summary.length > 200) problems.push(`${i.id}: summary too long`);
    if (i.known && !KNOWN_VERSION_OK(i.affects, notes)) problems.push(`${i.id}: affects ${i.affects} is not a tracked version`);
  }
  const versions = notes.map((n) => ({ name: n.version, date: inProduction(n.version) ? marketDate(n.version) : null, noteDate: n.date, released: inProduction(n.version) }));
  return { issues, withheld, problems, versions, folds, notes };
}
const KNOWN_VERSION_OK = (v, notes) => notes.some((n) => n.version === v);

// ---------- ADF and its plain-text twin (what a visitor reads) ----------
const p = (...content) => ({ type: "paragraph", content });
const t = (text, strong) => ({ type: "text", text, ...(strong ? { marks: [{ type: "strong" }] } : {}) });
function tailSentence(i) {
  const verb = i.type === "Improvement" ? "Added" : "Fixed";
  if (!inProduction(i.version)) return `${verb} in ${APP} ${i.version}, which is in testing and not yet in the Marketplace version.`;
  const base = `${verb} in ${APP} ${i.version}.`;
  // A site below this version's Forge major gets it only once a site admin approves the update.
  const major = vparts(i.version)[0];
  if (major > 1 && !/Manage apps/.test(i.text)) {
    return `${base} A site still on version ${major - 1} or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.`;
  }
  return base;
}
function paragraphs(i) {
  if (i.known) {
    return [
      ["What you see: ", i.see],
      ["Where: ", i.where],
      ["Workaround: ", i.workaround],
      ...(i.why ? [["Why: ", i.why]] : []),
      ["", `Confirmed on ${APP} ${i.affects}. Status: open.`],
    ];
  }
  return [["", i.text], ["", tailSentence(i)]];
}
const adf = (i) => ({ type: "doc", version: 1, content: paragraphs(i).map(([label, body]) => (label ? p(t(label, true), t(body)) : p(t(body)))) });
const plainText = (i) => paragraphs(i).map(([label, body]) => `${label}${body}`).join("\n");

// ADF as Jira stores it may carry extra attrs; compare text + marks only.
const stripAdf = (n) => (n && typeof n === "object" ? { t: n.type, x: n.text || "", m: (n.marks || []).map((m) => m.type), c: (n.content || []).map(stripAdf) } : n);

// ---------- receipt ----------
function readReceipt() {
  if (!existsSync(RECEIPT)) return { site: SITE, projectKey: KEY, components: {}, versions: {}, issues: {} };
  return JSON.parse(readFileSync(RECEIPT, "utf8"));
}
function writeReceipt(r) {
  r.updatedAt = new Date().toISOString();
  writeFileSync(RECEIPT, JSON.stringify(r, null, 2) + "\n");
}

// ---------- apply ----------
// A dedicated permission scheme: a copy of the Jira default scheme's grants (minus grant keys the
// platform no longer recognises, and minus any "anyone" grant), assigned to SVT only. The shared
// default scheme is never edited. Making the tracker public is the separate `public` step.
async function ensurePermissionScheme(rc) {
  if (!(rc.permissionScheme && rc.permissionScheme.id)) {
    const list = must(await jira("/rest/api/3/permissionscheme"), "list permission schemes");
    const mine = list.permissionSchemes.find((s) => s.name === PERM_SCHEME_NAME);
    if (mine) rc.permissionScheme = { id: mine.id, created: false };
    else {
      const known = new Set(Object.keys(must(await jira("/rest/api/3/permissions"), "permission keys").permissions));
      const def = must(await jira("/rest/api/3/permissionscheme/0?expand=permissions"), "read default scheme");
      const dropped = [...new Set(def.permissions.filter((g) => !known.has(g.permission)).map((g) => g.permission))];
      const grants = def.permissions.filter((g) => known.has(g.permission) && g.holder.type !== "anyone")
        .map((g) => ({ holder: { type: g.holder.type, ...(g.holder.value !== undefined ? { value: g.holder.value } : g.holder.parameter !== undefined ? { parameter: g.holder.parameter } : {}) }, permission: g.permission }));
      const made = await jira("/rest/api/3/permissionscheme", "POST", {
        name: PERM_SCHEME_NAME, description: `Dedicated to the ${NAME} (${KEY}).`, permissions: grants,
      });
      rc.permissionScheme = made.ok
        ? { id: made.body.id, created: true, grants: grants.length, droppedUnrecognised: dropped }
        : { id: null, refused: `HTTP ${made.status} ${JSON.stringify(made.body).slice(0, 300)}` };
    }
    writeReceipt(rc);
  }
  if (!rc.projectId || !rc.permissionScheme.id) return;
  const cur = await jira(`/rest/api/3/project/${KEY}/permissionscheme`);
  if (cur.ok && String(cur.body.id) !== String(rc.permissionScheme.id)) {
    const set = await jira(`/rest/api/3/project/${KEY}/permissionscheme`, "PUT", { id: Number(rc.permissionScheme.id) });
    rc.permissionScheme.assigned = set.ok ? true : `refused: HTTP ${set.status} ${JSON.stringify(set.body).slice(0, 300)}`;
    writeReceipt(rc);
  } else if (cur.ok) rc.permissionScheme.assigned = true;
}

// Every project on the site whose permission scheme is `schemeId` (the scheme must be SVT's alone).
async function schemeUsers(schemeId) {
  const users = [];
  let startAt = 0;
  for (;;) {
    const page = must(await jira(`/rest/api/3/project/search?startAt=${startAt}&maxResults=50`), "project search");
    for (const pr of page.values) {
      const ps = must(await jira(`/rest/api/3/project/${pr.key}/permissionscheme`), `scheme of ${pr.key}`);
      if (String(ps.id) === String(schemeId)) users.push(pr.key);
    }
    if (page.isLast || !page.values.length) break;
    startAt += page.values.length;
  }
  return users;
}

async function ensureProject(rc) {
  const existing = await jira(`/rest/api/3/project/${KEY}`);
  if (existing.ok) {
    if (existing.body.name !== NAME) throw new Error(`${KEY} exists and is "${existing.body.name}", not this tracker; refusing to touch it`);
    rc.projectId = existing.body.id;
    return existing.body;
  }
  const me = must(await jira("/rest/api/3/myself"), "myself");
  await ensurePermissionScheme(rc);
  const body = {
    key: KEY, name: NAME, description: DESCRIPTION, leadAccountId: me.accountId,
    projectTypeKey: "software", projectTemplateKey: TEMPLATE, assigneeType: "UNASSIGNED",
    ...(rc.permissionScheme && rc.permissionScheme.id ? { permissionScheme: Number(rc.permissionScheme.id) } : {}),
  };
  const made = must(await jira("/rest/api/3/project", "POST", body), "create project");
  rc.projectId = String(made.id);
  writeReceipt(rc);
  console.log(`created project ${KEY} id ${made.id}`);
  return must(await jira(`/rest/api/3/project/${KEY}`), "read project");
}

async function ensureIssueTypes(rc) {
  const proj = must(await jira(`/rest/api/3/project/${KEY}`), "read project");
  const have = Object.fromEntries(proj.issueTypes.map((x) => [x.name, x.id]));
  if (!have.Bug) throw new Error(`${KEY} has no Bug issue type (has: ${Object.keys(have).join(", ")})`);
  if (!have.Improvement) {
    const all = must(await jira("/rest/api/3/issuetype"), "issue types");
    let imp = all.find((x) => x.name === "Improvement" && !x.scope);
    if (!imp) {
      imp = must(await jira("/rest/api/3/issuetype", "POST", { name: "Improvement", type: "standard", description: "An improvement or new behaviour in a release." }), "create Improvement type");
      rc.createdIssueType = { id: imp.id, name: "Improvement" };
    }
    const its = must(await jira(`/rest/api/3/issuetypescheme/project?projectId=${rc.projectId}`), "issue type scheme of project");
    const scheme = its.values[0].issueTypeScheme;
    if (!new RegExp(`${KEY}|${NAME}`).test(scheme.name)) throw new Error(`issue type scheme "${scheme.name}" is not dedicated to ${KEY}; refusing to edit it`);
    must(await jira(`/rest/api/3/issuetypescheme/${scheme.id}/issuetype`, "PUT", { issueTypeIds: [String(imp.id)] }), `add Improvement to ${KEY} scheme`);
    rc.issueTypeScheme = { id: scheme.id, name: scheme.name };
    have.Improvement = String(imp.id);
  }
  rc.issueTypes = { Bug: have.Bug, Improvement: have.Improvement };
  writeReceipt(rc);
}

async function ensureComponents(rc) {
  const list = must(await jira(`/rest/api/3/project/${KEY}/components`), "components");
  for (const name of Object.values(COMPONENTS)) {
    const c = list.find((x) => x.name === name);
    rc.components[name] = c ? c.id : must(await jira("/rest/api/3/component", "POST", { name, project: KEY }), `component ${name}`).id;
  }
  writeReceipt(rc);
}

const versionWant = (v) => (v.released
  ? { description: `${APP} ${v.name}`, released: true, releaseDate: v.date }
  : { description: `${APP} ${v.name} (in testing, not yet in the Marketplace version)`, released: false });

async function ensureVersions(rc, versions) {
  const list = must(await jira(`/rest/api/3/project/${KEY}/versions`), "versions");
  for (const v of versions) {
    const found = list.find((x) => x.name === v.name);
    const want = versionWant(v);
    if (found) {
      rc.versions[v.name] = found.id;
      if (found.released !== want.released || (found.releaseDate || undefined) !== want.releaseDate || (found.description || "") !== want.description) {
        must(await jira(`/rest/api/3/version/${found.id}`, "PUT", want), `update version ${v.name}`);
        console.log(`version ${v.name} -> ${want.released ? `released ${want.releaseDate}` : "unreleased"}`);
      }
      continue;
    }
    rc.versions[v.name] = must(await jira("/rest/api/3/version", "POST", { name: v.name, projectId: Number(rc.projectId), ...want }), `version ${v.name}`).id;
  }
  writeReceipt(rc);
}

async function existingByProperty() {
  const out = {};
  let next;
  do {
    const r = must(await jira("/rest/api/3/search/jql", "POST", { jql: `project = ${KEY} ORDER BY key ASC`, fields: ["summary"], properties: [PROP], maxResults: 100, ...(next ? { nextPageToken: next } : {}) }), "search");
    for (const is of r.issues || []) {
      const id = is.properties && is.properties[PROP] && is.properties[PROP].id;
      if (id) out[id] = { key: is.key, id: is.id };
    }
    next = r.nextPageToken;
  } while (next);
  return out;
}

const statusNames = (s) => (Array.isArray(s) ? s : [s]);
async function moveTo(issueKey, statusName) {
  const names = statusNames(statusName);
  const cur = must(await jira(`/rest/api/3/issue/${issueKey}?fields=status`), "status");
  if (names.includes(cur.fields.status.name)) return "already";
  const tr = must(await jira(`/rest/api/3/issue/${issueKey}/transitions`), "transitions");
  const hit = names.map((n) => tr.transitions.find((x) => x.to && x.to.name === n)).find(Boolean);
  if (!hit) throw new Error(`${issueKey}: no transition to ${statusName} (${tr.transitions.map((x) => x.to.name).join(", ")})`);
  must(await jira(`/rest/api/3/issue/${issueKey}/transitions`, "POST", { transition: { id: hit.id } }), `transition ${issueKey}`);
  return "moved";
}

async function apply() {
  const want = await desired();
  if (want.problems.length) { console.log(want.problems.join("\n")); throw new Error("plan has problems; fix entries.mjs first"); }
  const rc = readReceipt();
  await ensureProject(rc);
  await ensurePermissionScheme(rc);
  await ensureIssueTypes(rc);
  await ensureComponents(rc);
  await ensureVersions(rc, want.versions);
  const adopted = await existingByProperty();
  let created = 0, adoptedN = 0, moved = 0, updated = 0;
  for (const i of want.issues) {
    if (!rc.issues[i.id] && adopted[i.id]) { rc.issues[i.id] = { ...adopted[i.id], adopted: true }; adoptedN++; writeReceipt(rc); }
    if (!rc.issues[i.id]) {
      const fields = {
        project: { id: rc.projectId }, issuetype: { id: rc.issueTypes[i.type] }, summary: i.summary,
        description: adf(i), components: [{ id: rc.components[i.component] }],
        ...(i.known ? { versions: [{ id: rc.versions[i.affects] }] } : {}),
        ...(i.version ? { fixVersions: [{ id: rc.versions[i.version] }] } : {}),
      };
      const made = must(await jira("/rest/api/3/issue", "POST", { fields, properties: [{ key: PROP, value: { id: i.id } }] }), `create ${i.id}`);
      rc.issues[i.id] = { key: made.key, id: made.id };
      writeReceipt(rc);
      created++;
      console.log(`created ${made.key} ${statusNames(i.status)[0].padEnd(8)} ${i.summary}`);
    } else {
      // Keep an existing issue's wording in step with the desired state, without notifying anyone.
      const cur = must(await jira(`/rest/api/3/issue/${rc.issues[i.id].key}?fields=summary,description,fixVersions`), `read ${rc.issues[i.id].key}`);
      const wantAdf = adf(i);
      const wantFix = i.version ? [String(rc.versions[i.version])] : [];
      const curFix = (cur.fields.fixVersions || []).map((v) => String(v.id));
      if (cur.fields.summary !== i.summary || JSON.stringify(stripAdf(cur.fields.description)) !== JSON.stringify(stripAdf(wantAdf)) || curFix.join() !== wantFix.join()) {
        must(await jira(`/rest/api/3/issue/${rc.issues[i.id].key}?notifyUsers=false`, "PUT", { fields: { summary: i.summary, description: wantAdf, fixVersions: wantFix.map((id) => ({ id })) } }), `update ${rc.issues[i.id].key}`);
        updated++;
        console.log(`updated ${rc.issues[i.id].key} ${i.summary}`);
      }
    }
    if ((await moveTo(rc.issues[i.id].key, i.status)) === "moved") moved++;
  }
  rc.withheld = want.withheld.map(({ h, version, kind, why }) => ({ h, version, kind, why }));
  rc.folds = Object.fromEntries(Object.entries(want.folds).map(([target, f]) => [f.h, { version: f.version, into: target, key: rc.issues[target] && rc.issues[target].key }]));
  writeReceipt(rc);
  console.log(`apply done: ${created} created, ${adoptedN} adopted, ${updated} updated, ${moved} transitioned, ${want.issues.length} wanted, ${want.withheld.length} withheld`);
}

// ---------- plan (no writes to Jira) ----------
function reviewMarkdown(want, siteCheck) {
  const done = want.issues.filter((i) => !i.known);
  const known = want.issues.filter((i) => i.known);
  const by = (list, f) => list.reduce((m, i) => ((m[f(i)] = (m[f(i)] || 0) + 1), m), {});
  const fmt = (m) => Object.entries(m).map(([a, b]) => `${a} ${b}`).join("; ");
  const quote = (s) => s.split("\n").map((l) => `> ${l}`).join("\n>\n");
  const out = [
    `# ${NAME} - planned public text (review file)`,
    "",
    `Generated ${new Date().toISOString()} by scripts/public-tracker/tracker.mjs plan. NOTHING here is in Jira yet: this is the draft for the adversarial review gate (security, accuracy, leakage, tone). Apply and make-public only after that review passes.`,
    "",
    `- Site: ${SITE}. Project ${KEY} "${NAME}" (company-managed Kanban), description: "${DESCRIPTION}"`,
    `- Permission scheme: its own, "${PERM_SCHEME_NAME}", a copy of the default scheme's grants (internal roles only); public = one BROWSE_PROJECTS grant to "anyone", nothing else, added only by the separate public step.`,
    `- Range: ${APP} ${want.versions[0].name} to ${want.versions[want.versions.length - 1].name} (every version the in-app release notes carry; 6.8.0 has no note of its own). Released state and dates read from the Marketplace versions endpoint: ${want.versions.map((v) => `${v.name} ${v.released ? `public ${v.date}` : "NOT public"}`).join(", ")}.`,
    `- Issues: ${want.issues.length} (${done.length} Done from release-note lines, ${known.length} open known bugs in Backlog). Withheld note lines: ${want.withheld.length}. Folded note lines: ${Object.keys(want.folds).length}.`,
    `- Done by type: ${fmt(by(done, (i) => i.type))}. By version: ${fmt(by(done, (i) => i.version))}.`,
    `- By component: ${fmt(by(want.issues, (i) => i.component))}.`,
    ...(siteCheck ? [`- Site check (read-only): ${siteCheck}`] : []),
    "",
    "## Versions",
    "",
    "| Version | Jira state | Release date (Marketplace) | Note date | Description |",
    "|---|---|---|---|---|",
    ...want.versions.map((v) => { const w = versionWant(v); return `| ${v.name} | ${w.released ? "released" : "unreleased"} | ${w.releaseDate || "-"} | ${v.noteDate} | ${w.description} |`; }),
    "",
    "## Components",
    "",
    ...Object.values(COMPONENTS).map((c) => `- ${c}`),
    "",
    `## Known open bugs (Backlog, type Bug, affects version ${[...new Set(known.map((i) => i.affects))].join(", ")})`,
    "",
    ...known.flatMap((i) => [`### ${i.summary}`, "", `- id ${i.id}; component: ${i.component}; status: Backlog; affects: ${i.affects}`, "", quote(plainText(i)), ""]),
  ];
  for (const v of [...want.versions].reverse()) {
    const rows = done.filter((i) => i.version === v.name);
    out.push(`## ${APP} ${v.name} (${v.date || `not public, note ${v.noteDate}`}) - ${rows.length} Done issue${rows.length === 1 ? "" : "s"}`, "");
    for (const i of rows) {
      out.push(`### [${i.type}] ${i.summary}`, "", `- id ${i.id}; component: ${i.component}; status: Done; fixVersion: ${i.version}${i.sanitized ? "; description REWRITTEN from the note line (see below)" : ""}`, "", quote(plainText(i)), "");
      if (i.sanitized) out.push(`  Note line as shipped in the app: "${i.line}"`, "");
    }
  }
  out.push("## Folded note lines (no issue of their own; carried in another issue's description)", "");
  for (const [target, f] of Object.entries(want.folds)) out.push(`- ${f.version} [${f.h}] into ${target}: "${f.line}"`);
  out.push("", "## Withheld note lines (not published)", "");
  for (const w of want.withheld) out.push(`- ${w.version} ${w.kind} [${w.h}]: ${w.why}`, `  - line: ${w.line}`);
  out.push("");
  return out.join("\n");
}

async function siteCheck() {
  const proj = await jira(`/rest/api/3/project/${KEY}`);
  const schemes = await jira("/rest/api/3/permissionscheme");
  const mine = schemes.ok ? schemes.body.permissionSchemes.find((s) => s.name === PERM_SCHEME_NAME) : null;
  const projectState = proj.status === 404 ? `key ${KEY} is free (GET project ${KEY} -> 404)`
    : proj.ok ? `project ${KEY} exists as "${proj.body.name}"${proj.body.name === NAME ? " (this tracker)" : " - NOT this tracker, apply would refuse"}`
      : `GET project ${KEY} -> HTTP ${proj.status}`;
  return `${projectState}; scheme "${PERM_SCHEME_NAME}" ${mine ? `exists (id ${mine.id})` : "does not exist yet"}.`;
}

async function plan() {
  const want = await desired();
  const rc = readReceipt();
  const missing = want.issues.filter((i) => !rc.issues[i.id]);
  const by = (f) => want.issues.reduce((m, i) => ((m[f(i)] = (m[f(i)] || 0) + 1), m), {});
  console.log(`site ${SITE}, receipt ${existsSync(RECEIPT) ? RECEIPT : "(none yet)"}`);
  console.log(`wanted ${want.issues.length} issues (${missing.length} not yet created), withheld ${want.withheld.length}, folded ${Object.keys(want.folds).length}`);
  console.log("by status", by((i) => statusNames(i.status)[0]));
  console.log("by type", by((i) => i.type));
  console.log("by component", by((i) => i.component));
  console.log("by version", by((i) => i.version || `affects ${i.affects}`));
  console.log("versions (Marketplace)", want.versions.map((v) => `${v.name}${v.released ? ` released ${v.date}` : " unreleased"}${v.released && v.date !== v.noteDate ? ` (note says ${v.noteDate})` : ""}`).join(", "));
  for (const w of want.withheld) console.log(`WITHHELD ${w.version} ${w.kind} ${w.h}: ${w.why}`);
  const check = process.argv.includes("--check-site") ? await siteCheck() : null;
  if (check) console.log(`site check (read-only): ${check}`);
  const date = new Date().toISOString().slice(0, 10);
  const file = join(HERE, `review-${date}.md`);
  writeFileSync(file, reviewMarkdown(want, check) + "\n");
  console.log(`review file ${file}`);
  if (want.problems.length) { console.log("PROBLEMS:\n" + want.problems.join("\n")); process.exitCode = 1; }
}

// ---------- verify ----------
async function verify() {
  const want = await desired();
  const rc = readReceipt();
  const rows = [];
  const fails = [];
  const count = { status: {}, version: {}, component: {}, type: {} };
  const inc = (m, k) => (m[k] = (m[k] || 0) + 1);
  const textOf = (node) => (node ? (node.text || "") + (node.content || []).map(textOf).join(node.type === "paragraph" ? "" : "\n") : "");
  for (const i of want.issues) {
    const ref = rc.issues[i.id];
    if (!ref) { fails.push(`${i.id} not created`); continue; }
    const r = await jira(`/rest/api/3/issue/${ref.key}?fields=summary,issuetype,status,resolution,fixVersions,versions,components,description,project&properties=${PROP}`);
    if (!r.ok) { fails.push(`${ref.key} GET ${r.status}`); continue; }
    const f = r.body.fields;
    const got = {
      key: ref.key, type: f.issuetype.name, status: f.status.name, resolution: f.resolution ? f.resolution.name : "",
      fixVersion: (f.fixVersions || []).map((v) => v.name).join(", "), affects: (f.versions || []).map((v) => v.name).join(", "),
      component: (f.components || []).map((c) => c.name).join(", "), summary: f.summary, description: textOf(f.description).trim(),
    };
    const exp = [
      [got.type, i.type, "type"], [statusNames(i.status).includes(got.status) ? i.status : got.status, i.status, "status"], [got.summary, i.summary, "summary"], [got.component, i.component, "component"],
      [got.fixVersion, i.version || "", "fixVersion"], ...(i.known ? [[got.affects, i.affects, "affects"]] : []), [f.project.key, KEY, "project"],
      [(r.body.properties || {})[PROP] && r.body.properties[PROP].id, i.id, "property"],
    ];
    for (const [a, b, what] of exp) if (a !== b) fails.push(`${ref.key} ${what}: got "${a}" want "${b}"`);
    if (got.description !== plainText(i)) fails.push(`${ref.key} description differs from the planned text`);
    if (i.status === STATUS.released && !got.resolution) fails.push(`${ref.key} Done without a resolution`);
    const bad = lint(`${got.summary} ${got.description}`);
    if (bad.length) fails.push(`${ref.key} public lint: ${bad.join(", ")}`);
    inc(count.status, got.status); inc(count.type, got.type); inc(count.component, got.component);
    inc(count.version, got.fixVersion || `open, affects ${got.affects}`);
    rows.push({ ...got, want: i });
  }
  const proj = await jira(`/rest/api/3/project/${KEY}`);
  const perm = await jira(`/rest/api/3/project/${KEY}/permissionscheme`);
  const grants = perm.ok ? await jira(`/rest/api/3/permissionscheme/${perm.body.id}?expand=permissions`) : null;
  const anon = grants && grants.ok ? grants.body.permissions.filter((g) => g.holder.type === "anyone") : [];
  const users = perm.ok ? await schemeUsers(perm.body.id) : [];
  if (users.join() !== KEY) fails.push(`permission scheme ${perm.ok ? perm.body.id : "?"} is used by ${users.join(", ") || "nothing"}, not ${KEY} alone`);
  for (const g of anon) if (g.permission !== "BROWSE_PROJECTS") fails.push(`anonymous holds ${g.permission}; only BROWSE_PROJECTS may`);
  const vers = must(await jira(`/rest/api/3/project/${KEY}/versions`), "versions");
  for (const v of vers) {
    const w = want.versions.find((x) => x.name === v.name);
    if (!w) { fails.push(`version ${v.name} is not a tracked version`); continue; }
    const wv = versionWant(w);
    if (wv.released && (!v.released || v.releaseDate !== wv.releaseDate)) fails.push(`version ${v.name} should be released ${wv.releaseDate}`);
    if (!wv.released && (v.released || v.releaseDate)) fails.push(`version ${v.name} reads as released`);
  }
  rows.sort((a, b) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]));
  const md = [
    `# ${NAME} - verify file`,
    "",
    `Generated ${new Date().toISOString()} by scripts/public-tracker/tracker.mjs verify.`,
    `Site ${SITE}. Project ${KEY} (id ${proj.ok ? proj.body.id : "?"}), permission scheme "${perm.ok ? perm.body.name : "?"}" (id ${perm.ok ? perm.body.id : "?"}, used by: ${users.join(", ")}), anonymous grants: ${anon.map((g) => g.permission).join(", ") || "none"}.`,
    `Issues checked: ${rows.length} of ${want.issues.length}. Verification failures: ${fails.length}. Withheld release-note lines: ${want.withheld.length}.`,
    "",
    "## Counts",
    "",
    ...Object.entries(count).map(([k, m]) => `- ${k}: ${Object.entries(m).map(([a, b]) => `${a} ${b}`).join("; ")}`),
    `- versions in Jira: ${vers.map((v) => `${v.name}${v.released ? ` released ${v.releaseDate}` : " unreleased"}`).join(", ")}`,
    "",
    ...(fails.length ? ["## Verification failures", "", ...fails.map((x) => `- ${x}`), ""] : []),
    "## Issues",
    "",
    ...rows.map((r) => [
      `### ${r.key} - ${r.summary}`, "",
      `- type: ${r.type}; status: ${r.status}${r.resolution ? ` (${r.resolution})` : ""}; ${r.want.known ? `affects: ${r.affects}` : `fixVersion: ${r.fixVersion}`}; component: ${r.component}`, "",
      r.description.split("\n").map((l) => `> ${l}`).join("\n"), "",
    ].join("\n")),
  ].join("\n");
  writeFileSync(VERIFY_REVIEW, md + "\n");
  console.log(JSON.stringify(count, null, 1));
  console.log(`verified ${rows.length}/${want.issues.length}, failures ${fails.length}, anonymous grants ${anon.length}; verify file ${VERIFY_REVIEW}`);
  if (fails.length) { console.log(fails.join("\n")); process.exitCode = 1; }
}

// ---------- public ----------
// Grants BROWSE_PROJECTS to holder type "anyone" (Jira's REST name for "anyone on the web") on SVT's
// OWN permission scheme, and nothing else; then proves it with unauthenticated reads.
async function makePublic() {
  const rc = readReceipt();
  const perm = must(await jira(`/rest/api/3/project/${KEY}/permissionscheme`), `${KEY} scheme`);
  const users = await schemeUsers(perm.id);
  if (users.join() !== KEY) throw new Error(`scheme ${perm.id} "${perm.name}" is used by ${users.join(", ")}; refusing to grant anonymous access on a shared scheme`);
  const full = must(await jira(`/rest/api/3/permissionscheme/${perm.id}?expand=permissions`), "grants");
  let grant = full.permissions.find((g) => g.holder.type === "anyone" && g.permission === "BROWSE_PROJECTS");
  if (!grant) grant = must(await jira(`/rest/api/3/permissionscheme/${perm.id}/permission`, "POST", { holder: { type: "anyone" }, permission: "BROWSE_PROJECTS" }), "grant anonymous browse");
  const after = must(await jira(`/rest/api/3/permissionscheme/${perm.id}?expand=permissions`), "grants");
  const anon = after.permissions.filter((g) => g.holder.type === "anyone");
  if (anon.some((g) => g.permission !== "BROWSE_PROJECTS")) throw new Error(`anonymous holds more than browse: ${anon.map((g) => g.permission).join(", ")}`);
  rc.public = { schemeId: perm.id, grantId: grant.id, grantedAt: new Date().toISOString(), undo: `DELETE /rest/api/3/permissionscheme/${perm.id}/permission/${grant.id}` };
  writeReceipt(rc);
  const anonGet = async (path) => (await fetch(SITE + path, { headers: { Accept: "application/json" } })).status;
  const firstKey = `${KEY}-1`;
  // A new grant takes ~20 s to reach Jira's permission cache (measured on CRT: 404 at once, then 200).
  for (let n = 0; n < 12 && (await anonGet(`/rest/api/3/issue/${firstKey}`)) !== 200; n++) await new Promise((res) => setTimeout(res, 10000));
  const first = rc.issues[Object.keys(rc.issues)[0]].key;
  const proof = { [`GET /rest/api/3/issue/${first}`]: await anonGet(`/rest/api/3/issue/${first}`), [`GET /rest/api/3/issue/${firstKey}`]: await anonGet(`/rest/api/3/issue/${firstKey}`) };
  // LeanZero's other public trackers (EXPECTED_PUBLIC, by key) may answer a logged-out read; any other
  // project that does, or whose scheme lets "anyone" browse it, is a leak and fails the proof.
  const others = must(await jira("/rest/api/3/project/search?maxResults=100"), "projects").values.filter((pr) => pr.key !== KEY);
  const alsoPublic = new Set();
  for (const pr of others) {
    const ps = must(await jira(`/rest/api/3/project/${pr.key}/permissionscheme`), `scheme of ${pr.key}`);
    const g = must(await jira(`/rest/api/3/permissionscheme/${ps.id}?expand=permissions`), `grants of ${pr.key}`);
    if (g.permissions.some((x) => x.holder.type === "anyone" && x.permission === "BROWSE_PROJECTS")) alsoPublic.add(pr.key);
    const s = must(await jira("/rest/api/3/search/jql", "POST", { jql: `project = ${pr.key} ORDER BY created DESC`, maxResults: 1, fields: ["summary"] }), `sample ${pr.key}`);
    const is = (s.issues || [])[0];
    if (is) proof[`GET /rest/api/3/issue/${is.key}`] = await anonGet(`/rest/api/3/issue/${is.key}`);
  }
  const all = await fetch(`${SITE}/rest/api/3/search/jql?jql=${encodeURIComponent("ORDER BY created DESC")}&maxResults=100&fields=project`, { headers: { Accept: "application/json" } });
  const allBody = all.ok ? await all.json() : { issues: [] };
  const seen = [...new Set((allBody.issues || []).map((x) => x.fields.project.key))];
  proof["anonymous site-wide search: projects returned"] = seen.join(",") || `HTTP ${all.status}`;
  proof["other projects whose scheme lets anyone browse"] = [...alsoPublic].join(",") || "none";
  proof["expected public (allowlist)"] = [...EXPECTED_PUBLIC].join(",");
  proof[`GET /jira/software/c/projects/${KEY}/issues`] = (await fetch(`${SITE}/jira/software/c/projects/${KEY}/issues`, { redirect: "manual" })).status;
  rc.public.proof = proof;
  writeReceipt(rc);
  console.log(JSON.stringify({ scheme: `${perm.id} ${perm.name}`, anonymous: anon.map((g) => `${g.id}:${g.permission}`), proof }, null, 1));
  const keyOf = (k) => (k.match(/\/issue\/([A-Z][A-Z0-9]*)-\d+$/) || [])[1];
  const leaks = Object.entries(proof).filter(([k, v]) => keyOf(k) && keyOf(k) !== KEY && !EXPECTED_PUBLIC.has(keyOf(k)) && v === 200);
  const searchLeak = seen.filter((k) => k !== KEY && !EXPECTED_PUBLIC.has(k));
  const schemeLeak = [...alsoPublic].filter((k) => !EXPECTED_PUBLIC.has(k));
  if (proof[`GET /rest/api/3/issue/${firstKey}`] !== 200 || leaks.length || searchLeak.length || schemeLeak.length) { console.log("PROOF FAILED", { leaks, searchLeak, schemeLeak }); process.exitCode = 1; }
}

const cmd = process.argv[2];
if (cmd === "plan") await plan();
else if (cmd === "apply") await apply();
else if (cmd === "verify") await verify();
else if (cmd === "public") await makePublic();
else { console.log("usage: tracker.mjs plan [--check-site] | apply | verify | public"); process.exitCode = 2; }
