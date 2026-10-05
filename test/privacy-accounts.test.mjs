// Personal data reporting + erasure, the pure half (2026-10-04). Record shapes below are copied
// from the writers (sealing/actions.js, section-seals/actions.js, editreq, workflow, read-acks,
// activity-log, admin settings) so a field-pairing mistake shows up here, not on a customer site.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import {
  extractAccountIds, rewriteAccount, removesFromLists, keyNamesAccount, stripLegacyEmail, planReport, batches,
  isAccountId, pairedFields, PSEUDONYM_ID, PSEUDONYM_NAME, CYCLE_MS, REPORT_BATCH,
} from "../src/server/capsules/privacy/accounts.js";

const A = "712020:aaaaaaaa-1111-2222-3333-444444444444"; // the closed account
const B = "712020:bbbbbbbb-1111-2222-3333-444444444444"; // someone else
const LEGACY = "5b10a2844c20165700ede21g".replace("g", "f"); // 24 hex

// ── finding ids ─────────────────────────────────────────────────────────────────────────────
eq("modern id anywhere", isAccountId(A, "whatever"), true);
eq("legacy id under a person field", isAccountId(LEGACY, "lockedBy"), true);
eq("legacy-shaped hex under a non-person field is NOT an account", isAccountId(LEGACY, "sha256"), false);
eq("a bare UUID (section id) is not an account", isAccountId("aaaaaaaa-1111-2222-3333-444444444444", "sectionId"), false);
const seal = { lockedBy: A, lockedByName: "Ann", timestamp: "t", extendedBy: B, contentId: "1", attachmentId: "att2" };
eq("seal record → both people", [...extractAccountIds("protection-att2", seal)].sort(), [A, B].sort());
eq("id in a key", [...extractAccountIds(`read-ack-123-${A}`, { at: "x" })], [A]);
eq("id inside text (a storage mention)", [...extractAccountIds("notification-1", { body: `<ac:link><ri:user ri:account-id="${A}"/></ac:link> was mentioned here` })], [A]);
eq("roster array", [...extractAccountIds("admin-settings-space-SV", { adminUsers: [A, { accountId: B, displayName: "Bo" }] })].sort(), [A, B].sort());
eq("nothing in a config without people", [...extractAccountIds("validation-config-global", { enabled: true, rules: [{ id: "r1" }] })], []);

// ── pairing ─────────────────────────────────────────────────────────────────────────────────
eq("lockedBy pairs lockedByName", pairedFields("lockedBy").names[0], "lockedByName");
eq("requesterAccountId pairs requesterName", pairedFields("requesterAccountId").names[0], "requesterName");
eq("accountId pairs name/displayName", pairedFields("accountId").names.slice(0, 2), ["name", "displayName"]);

// ── erase ───────────────────────────────────────────────────────────────────────────────────
{
  const r = rewriteAccount(seal, A, { mode: "erase" });
  eq("erase: id pseudonymised", r.value.lockedBy, PSEUDONYM_ID);
  eq("erase: paired name replaced", r.value.lockedByName, PSEUDONYM_NAME);
  eq("erase: the other person untouched", r.value.extendedBy, B);
  eq("erase: input not mutated", seal.lockedBy, A);
  ok("erase: changed", r.changed);
  ok("erase: id gone from the JSON", !JSON.stringify(r.value).includes(A));
}
{
  // A workflow-log entry: a transition by A, state names that must NOT be touched.
  const log = { ts: 1, kind: "transition", from: "draft", to: "approved", fromName: "Draft", toName: "Approved", by: A, byName: "Ann" };
  const r = rewriteAccount(log, A, { mode: "erase" });
  eq("state names are not person names", [r.value.fromName, r.value.toName], ["Draft", "Approved"]);
  eq("byName replaced", r.value.byName, PSEUDONYM_NAME);
}
{
  // Activity entry with a nested actor and an approval record with decisions (history → pseudonymise, keep the count).
  const act = { type: "workflow.approval-decided", actor: { accountId: A, name: "Ann" }, details: { approvalRecord: { decisions: [{ accountId: A, name: "Ann", decision: "approved" }, { accountId: B, name: "Bo", decision: "approved" }] } } };
  const r = rewriteAccount(act, A, { mode: "erase", removeFromLists: removesFromLists("activity-page-1-x") });
  eq("actor pseudonymised", r.value.actor, { accountId: PSEUDONYM_ID, name: PSEUDONYM_NAME });
  eq("history keeps both decisions", r.value.details.approvalRecord.decisions.length, 2);
  eq("the other decider untouched", r.value.details.approvalRecord.decisions[1].name, "Bo");
}
{
  // Configuration: A is REMOVED from rosters and approver lists.
  const space = { adminUsers: [A, B], adminGroups: ["g"] };
  const r1 = rewriteAccount(space, A, { mode: "erase", removeFromLists: removesFromLists("admin-settings-space-SV") });
  eq("roster loses A", r1.value.adminUsers, [B]);
  const def = { approval: { mode: "all", approvers: [{ type: "user", id: A, name: "Ann" }, { type: "group", id: "9b1bd7bc-281a-4bb5-8ba2-335f9c725833", name: "g" }] } };
  const r2 = rewriteAccount(def, A, { mode: "erase", removeFromLists: removesFromLists("workflow-def-space-SV") });
  // L1 (review 2026-10-04): an approver is NEVER removed — an empty approver list evaluates as
  // "approved". The entry stays, pseudonymised.
  eq("approver list keeps a pseudonymised entry", r2.value.approval.approvers.map((a) => [a.type, a.id, a.name]), [["user", PSEUDONYM_ID, PSEUDONYM_NAME], ["group", "9b1bd7bc-281a-4bb5-8ba2-335f9c725833", "g"]]);
  const settingsApprovers = { approval: { approvers: [{ type: "user", id: A, name: "Ann" }] }, readConfirmation: { audience: [{ type: "user", id: A, name: "Ann" }] } };
  const r3 = rewriteAccount(settingsApprovers, A, { mode: "erase", removeFromLists: removesFromLists("workflow-settings-SV") });
  eq("workflow settings: approver kept (pseudonymised)", r3.value.approval.approvers.length, 1);
  eq("workflow settings: read audience loses A", r3.value.readConfirmation.audience, []);
  const pending = { approvers: [A], mode: "all", min: 1, requestedBy: B };
  const r4 = rewriteAccount(pending, A, { mode: "erase", removeFromLists: removesFromLists("workflow-pending-1") });
  eq("a pending request's approver list never empties", r4.value.approvers, [PSEUDONYM_ID]);
  const { evaluateApproval } = await import("../src/server/capsules/workflow/approvals.js");
  eq("…and so cannot evaluate as approved with nobody deciding", evaluateApproval("all", 1, ["pending"], []), "pending");
  const aud = { readConfirmation: { enabled: true, audience: [{ type: "user", id: A, name: "Ann" }] } };
  eq("read audience loses A", rewriteAccount(aud, A, { mode: "erase", removeFromLists: removesFromLists("workflow-settings-SV") }).value.readConfirmation.audience, []);
  eq("a NON-config list keeps a pseudonymised element", rewriteAccount({ ids: [A] }, A, { mode: "erase", removeFromLists: removesFromLists("notification-1") }).value.ids, [PSEUDONYM_ID]);
}
{
  const legacyEmail = { lockedBy: A, lockedByName: "Ann", lockedByEmail: "ann@example.com" };
  const r = rewriteAccount(legacyEmail, A, { mode: "erase" });
  eq("erase nulls the paired email", r.value.lockedByEmail, null);
  eq("erase nulls the sealer's note", rewriteAccount({ lockedBy: A, note: "about the file" }, A, { mode: "erase" }).value.note, null);
  eq("rename keeps the note", rewriteAccount({ lockedBy: A, lockedByName: "x", note: "n" }, A, { mode: "rename", newName: "y" }).value.note, "n");
}

// ── rename (updated) ────────────────────────────────────────────────────────────────────────
{
  const r = rewriteAccount(seal, A, { mode: "rename", newName: "Ann Smith" });
  eq("rename keeps the id", r.value.lockedBy, A);
  eq("rename refreshes the paired name", r.value.lockedByName, "Ann Smith");
  eq("rename leaves other people alone", r.value.extendedBy, B);
  eq("rename with no name changes nothing", rewriteAccount(seal, A, { mode: "rename", newName: null }).changed, false);
}

// ── keys ────────────────────────────────────────────────────────────────────────────────────
eq("own row: read ack", keyNamesAccount(`read-ack-1-${A}`, A), true);
eq("own row: signature marker", keyNamesAccount(`sig-device-${A}`, A), true);
eq("someone else's row", keyNamesAccount(`read-ack-1-${B}`, A), false);
eq("a seal row is never 'own'", keyNamesAccount("protection-att2", A), false);

// ── personal spaces (L2) and page content (L4) ──────────────────────────────────────────────
{
  const L = "5b10a2844c20165700ede21f";
  eq("a personal-space key (~id sanitised to _id) is not the person's row", keyNamesAccount(`admin-settings-space-_${L}`, L), false);
  eq("…nor a workflow index keyed by it", keyNamesAccount(`workflow-idx-_${L}-approved-123`, L), false);
  eq("the person's own row still is", keyNamesAccount(`read-ack-123-${L}`, L), true);
  const rec = { spaceKey: `~${L}`, lockedBy: L, lockedByName: "Lee" };
  const r = rewriteAccount(rec, L, { mode: "erase" });
  eq("a ~id space key is left alone", r.value.spaceKey, `~${L}`);
  eq("the person in the same record is erased", [r.value.lockedBy, r.value.lockedByName], [PSEUDONYM_ID, PSEUDONYM_NAME]);
  const { holdsPageContent } = await import("../src/server/capsules/privacy/accounts.js");
  eq("section baselines hold page content", holdsPageContent("section-snapshot-abc"), true);
  eq("seal records do not", holdsPageContent("section-protection-abc"), false);
}

// ── the one-time email strip ────────────────────────────────────────────────────────────────
eq("strip email from a file seal", stripLegacyEmail("protection-1", { lockedBy: A, lockedByEmail: "x@y" }).value, { lockedBy: A });
eq("strip email from a section seal", stripLegacyEmail("section-protection-1", { lockedByEmail: "x@y", lockedBy: A }).changed, true);
eq("other families untouched", stripLegacyEmail("edit-request-1", { lockedByEmail: "x@y" }).changed, false);

// ── reporting plan: at most once per 7 days per account ─────────────────────────────────────
{
  const now = Date.parse("2026-10-04T00:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const index = {
    [A]: { u: iso(now - 30 * 86400000), r: iso(now - 2 * 86400000) },  // reported 2 days ago → not due
    [B]: { u: iso(now - 30 * 86400000), r: iso(now - CYCLE_MS) },       // exactly a cycle → due
    "712020:cccccccc-1111-2222-3333-444444444444": { u: "x", r: null }, // no longer stored → dropped
  };
  const C = "712020:dddddddd-1111-2222-3333-444444444444";
  const plan = planReport(index, new Set([A, B, C]), now);
  eq("due: the cycle-old and the new one", plan.due.map((d) => d.accountId).sort(), [B, C].sort());
  eq("updatedAt kept from first sight", plan.due.find((d) => d.accountId === B).updatedAt, iso(now - 30 * 86400000));
  eq("a new id's updatedAt is now", plan.due.find((d) => d.accountId === C).updatedAt, iso(now));
  eq("ids no longer stored leave the index", Object.keys(plan.index).sort(), [A, B, C].sort());
}
eq("batches of 90", batches(Array.from({ length: 181 }, (_, i) => i)).map((b) => b.length), [90, 90, 1]);
eq("batch size constant", REPORT_BATCH, 90);

// ── end to end over an in-memory site: what an erasure leaves behind ────────────────────────
{
  const site = new Map([
    ["protection-att2", { ...seal }],
    [`read-ack-1-${A}`, { at: "t", name: "Ann", accountId: A }],
    [`sig-device-${A}`, { enrolledAt: "t" }],
    [`editreq-mine-${A}-att2`, { attachmentId: "att2" }],
    ["admin-settings-space-SV", { adminUsers: [A, B] }],
    [`activity-page-1-0000000000001-abcdef`, { actor: { accountId: A, name: "Ann" }, type: "seal.created" }],
    ["workflow-log-1-1700000000000", { by: A, byName: "Ann", toName: "Approved" }],
  ]);
  for (const [key, value] of [...site]) {
    if (keyNamesAccount(key, A)) { site.delete(key); continue; }
    const r = rewriteAccount(value, A, { mode: "erase", removeFromLists: removesFromLists(key) });
    if (r.changed) site.set(key, r.value);
  }
  const dump = JSON.stringify([...site]);
  ok("no trace of the closed id anywhere", !dump.includes(A));
  ok("no trace of the closed name anywhere", !dump.includes("Ann"));
  eq("their own rows are gone", [...site.keys()].filter((k) => k.includes("read-ack") || k.includes("sig-device") || k.includes("editreq-mine")), []);
  eq("the seal survives, owned by a pseudonym", site.get("protection-att2").lockedBy, PSEUDONYM_ID);
  eq("the roster keeps the other steward", site.get("admin-settings-space-SV").adminUsers, [B]);
  ok("the other person is intact", dump.includes(B));
}

// ── rosters never keep an email (write guard + one-time strip) ──────────────────────────────
{
  const { stripRosterContact } = await import("../src/server/capsules/privacy/accounts.js");
  const { minimiseRoster, minimisePolicyWrite } = await import("../src/server/capsules/policies/settings-schema.js");
  const stored = { adminUsers: [A, { accountId: B, displayName: "Bo", email: "bo@example.com", profilePicture: "/p.png" }], adminGroups: ["g"] };
  const s = stripRosterContact("admin-settings-space-SV", stored);
  eq("strip: email and picture gone", s.value.adminUsers[1], { accountId: B, displayName: "Bo" });
  eq("strip: bare ids untouched", s.value.adminUsers[0], A);
  ok("strip: changed", s.changed);
  eq("strip: a clean roster is not rewritten", stripRosterContact("admin-settings-space-SV", { adminUsers: [{ accountId: B, displayName: "Bo" }] }).changed, false);
  eq("strip: only admin-settings rows", stripRosterContact("workflow-def-x", stored).changed, false);
  eq("write guard: same shape", minimiseRoster(stored.adminUsers), [A, { accountId: B, displayName: "Bo" }]);
  eq("write guard: an entry without an id is dropped", minimiseRoster([{ displayName: "x", email: "y" }]), []);
  eq("write guard: payload without a roster untouched", minimisePolicyWrite({ enableDocRibbons: true }), { enableDocRibbons: true });
  ok("write guard: never an email in the saved payload", !JSON.stringify(minimisePolicyWrite(stored)).includes("@"));
  const pol = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/server/capsules/policies/actions.js"), "utf8");
  ok("store-policy minimises before anything else reads data", /const data = minimisePolicyWrite\(req\.payload\?\.data\);/.test(pol));
}

// ── a refusal for want of the scope is a state, not a failure ───────────────────────────────
{
  const { describeSweep } = await import("../src/ui/kit/privacy-format.js");
  const s = describeSweep({ ok: true, retentionDays: 730, retention: {}, finishedAt: "2026-10-04T12:00:00Z", accounts: { reporting: "not-permitted", reported: 0 } });
  ok("not-permitted is explained, not counted", /Atlassian refused the account check this time, it is tried again the next day/.test(s) && !/checked 0/.test(s));
  ok("7.0 holds the scope: no sentence says the version lacks the permission", !/does not have yet|needs a permission/.test(s));
  const due0 = describeSweep({ ok: true, retentionDays: 0, retention: {}, finishedAt: "2026-10-04T12:00:00Z", accounts: { reporting: "done", stored: 12, due: 0, reported: 0 } });
  ok("nothing due reads as nothing due, not 'checked 0'", /no account was due/.test(due0) && !/checked 0/.test(due0));
  const done = describeSweep({ ok: true, retentionDays: 0, retention: {}, finishedAt: "2026-10-04T12:00:00Z", accounts: { reporting: "done", stored: 12, due: 12, reported: 12, closed: 1, updated: 2 } });
  ok("a real report is counted", /checked 12 accounts with Atlassian, erased 1 closed account, refreshed 2 changed names/.test(done));
}
// ── 7.0.0: the manifest holds the scope the sweep reports with ──────────────────────────────
{
  const manifest = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../manifest.yml"), "utf8");
  ok("manifest declares report:personal-data", /^\s*- report:personal-data\s*$/m.test(manifest));
}
{
  const { sweepDue, RETRY_REFUSED_MS, SWEEP_EVERY_MS } = await import("../src/server/capsules/privacy/accounts.js");
  const t = Date.parse("2026-10-05T12:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  eq("due: never run", sweepDue({}, t), true);
  eq("due: a week old", sweepDue({ lastRunAt: iso(t - SWEEP_EVERY_MS) }, t), true);
  eq("not due: a reported run a day ago", sweepDue({ lastRunAt: iso(t - 86400000), lastAttemptAt: iso(t - 86400000), last: { accounts: { reporting: "done" } } }, t), false);
  eq("due: a REFUSED run a day ago is retried (6.x → 7.0 upgrade)", sweepDue({ lastRunAt: iso(t - 86400000), lastAttemptAt: iso(t - 86400000), last: { accounts: { reporting: "not-permitted" } } }, t), true);
  eq("not due: a refused run an hour ago", sweepDue({ lastRunAt: iso(t - 3600000), lastAttemptAt: iso(t - 3600000), last: { accounts: { reporting: "not-permitted" } } }, t), false);
  eq("not due: a retry is already queued", sweepDue({ lastRunAt: iso(t - 86400000), lastAttemptAt: iso(t - 86400000), queuedAt: iso(t - 3600000), last: { accounts: { reporting: "not-permitted" } } }, t), false);
  eq("due: a queued retry that never ran is re-queued after the window", sweepDue({ lastRunAt: iso(t - 3 * 86400000), lastAttemptAt: iso(t - 3 * 86400000), queuedAt: iso(t - RETRY_REFUSED_MS - 1), last: { accounts: { reporting: "not-permitted" } } }, t), true);
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(resolve(here, "../src/server/capsules/privacy/worker.js"), "utf8");
ok("reports through @forge/api privacy", /privacy\.reportPersonalData\(b\)/.test(worker));
ok("honours a 429 Retry-After", /status === 429/.test(worker) && /Retry-After/.test(worker));
ok("a ttl'd row keeps its ttl when rewritten", /async function setPreserving/.test(worker) && !/await kvs\.set\(key, v\);/.test(worker));
ok("closed accounts lose their authenticator (secret namespace)", /eraseSignature\(id\)/.test(worker));
ok("the backup gets a scrubbed generation and older ones are purged", /runBackup\(\{ reason: "privacy"/.test(worker) && /purgeGenerationsMentioning\(closed\)/.test(worker));
ok("the status row stores counts, not account ids", !/summary\.[a-z]+\s*=\s*closed\b/.test(worker) && /summary\.accounts\.closed = closed\.length/.test(worker));
const engine = readFileSync(resolve(here, "../src/server/capsules/backup/engine.js"), "utf8");
const purge = engine.slice(engine.indexOf("export async function purgeGenerationsMentioning"), engine.indexOf("async function collectGarbage"));
ok("L3: an unreadable backup file aborts the purge (drops nothing)", /catch \(e\) \{\s*console\.warn\(`\[BACKUP\] privacy purge aborted, nothing dropped/.test(purge) && !/catch \(_\) \{ hit = true; \}/.test(purge));
ok("P2: the erase pass re-reads a row before rewriting it", /const value = await kvs\.get\(key\);/.test(worker));
ok("L4: page-content rows are skipped by the erase pass", /if \(holdsPageContent\(key\)\) return;/.test(worker));
const wfActions = readFileSync(resolve(here, "../src/server/capsules/workflow/actions.js"), "utf8");
ok("P1: a request is refused past MAX_REQUEST_APPROVERS", /\(spec\?\.approvers\?\.length \|\| 0\) > MAX_REQUEST_APPROVERS/.test(wfActions));
ok("401/403 from report-accounts is recorded as not-permitted", worker.includes("export const reportNotPermitted = (status) => status === 401 || status === 403;") && worker.includes('summary.accounts.reporting = "not-permitted"'));
// Approver namesake hints (review 2026-10-04): the picker stored the approver's EMAIL as `hint`.
{
  const { stripRosterContact, stripApproverEmailHints, pairedFields: pf } = await import("../src/server/capsules/privacy/accounts.js");
  const wf = { enabled: true, approval: { mode: "any", approvers: [
    { type: "user", id: "712020:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Ann", hint: "ann@example.com" },
    { type: "user", id: "712020:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Bo", hint: "account …bbbbbb" },
    { type: "group", id: "g1", name: "Approvers" },
  ] } };
  const s = stripApproverEmailHints(wf);
  eq("hint: an email hint is dropped", s.value.approval.approvers[0].hint, undefined);
  eq("hint: the entry keeps id and name", [s.value.approval.approvers[0].id, s.value.approval.approvers[0].name], ["712020:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Ann"]);
  eq("hint: a non-email hint is kept", s.value.approval.approvers[1].hint, "account …bbbbbb");
  eq("hint: the rest of the settings are kept", [s.value.enabled, s.value.approval.mode, s.value.approval.approvers.length], [true, "any", 3]);
  eq("hint: a clean list is not rewritten", stripApproverEmailHints(s.value).changed, false);
  eq("hint: the sweep's strip reaches workflow-settings rows", stripRosterContact("workflow-settings-SV", wf).changed, true);
  eq("hint: erasure clears the hint paired with an id", pf("id").contact.includes("hint"), true);
  const logic = readFileSync(resolve(here, "../src/server/capsules/workflow/logic.js"), "utf8");
  ok("hint: a new save drops an email hint", /a\.hint && !a\.hint\.includes\("@"\)/.test(logic));
  ok("hint: no stale V1 flag gates the roster strip", !worker.includes("rosterEmailV1"));
  ok("the email strips run on every sweep (a restored backup brings addresses back)", worker.includes("const stripEmail = true;") && worker.includes("const stripRoster = true;"));
}
report("privacy-accounts");
