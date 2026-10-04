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
  eq("approver list loses A, keeps the group", r2.value.approval.approvers.map((a) => a.type), ["group"]);
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
  ok("not-permitted is explained, not counted", /needs a permission this version does not have yet/.test(s) && !/checked 0/.test(s));
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
ok("401/403 from report-accounts is recorded as not-permitted", worker.includes("export const reportNotPermitted = (status) => status === 401 || status === 403;") && worker.includes('summary.accounts.reporting = "not-permitted"'));
report("privacy-accounts");
