// 8.6 — Jira attachment seals, the FLOWS (trigger.js, actions.js, store.js) run against an in-memory
// Forge (test/_forge-fake.mjs). Each block pins a defect found by the code read of 2026-10-16:
//   1. "Put it back" recorded the person who clicked it as the one who deleted the file
//   2. an admin's force release of a file that is not on the issue deleted the last copy unannounced
//   3. a sealed file missing from the issue read "Not put back" before the delete trigger had written
//      anything (the panel's read raced the trigger)
//   4. My work's "Download the copy" saved a nameless, extension-less file
//   6. a deleted issue's copy could not be let go by its owner before its 30 days ran out
// New modules are imported defensively so this file still RUNS on the code before the fix and reports
// each defect as a failed assertion instead of crashing on an import.
import { eq, ok, report } from "./_assert.mjs";
import { installFakeForge } from "./_forge-fake.mjs";
import { createHash } from "node:crypto";

const F = installFakeForge();
const trigger = await import("../src/server/capsules/jira-seals/trigger.js");
const actions = await import("../src/server/capsules/jira-seals/actions.js");
const { formatActivity } = await import("../src/ui/kit/activity-format.js");
const releaseCopy = await import("../src/ui/kit/jira-release-copy.js").catch(() => null);
const copyDl = await import("../src/ui/kit/jira-copy-download.js").catch(() => null);
const { SIGNED_SEAL_ACTION_KEYS } = await import("../src/server/shared/seal-signature.js");
const { WRITE_ACTIONS, READ_ACTIONS } = await import("../src/server/capsules/backup/hook.js");

const APP = "712020:app";
const OWNER = "712020:owner";
const DELETER = "712020:deleter";
const CLICKER = "712020:clicker";
const ADMIN = "712020:admin";
F.store.set("app-account-id", APP);
F.users.set(OWNER, "Olivia Owner");
const editor = { canSee: true, canEdit: true, isSteward: false };
const steward = { canSee: true, canEdit: true, isSteward: true };
const handler = (key) => (actions.actions.find(([k]) => k === key) || [])[1];
const call = async (key, accountId, payload) => {
  const h = handler(key);
  if (!h) return { success: false, reason: `no resolver ${key}` };
  return h({ payload, context: { accountId, extension: {} } });
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const mentionsOf = (adf) => JSON.stringify(adf).match(/"id":"712020:[a-z]+"/g)?.map((s) => s.slice(6, -1)) || [];
const ofType = (t) => F.activity().filter((e) => e.type === t);

async function sealFile(issueId, id, filename, bytes, mimeType = "application/pdf") {
  F.attach(issueId, { id, filename, bytes, mimeType });
  const r = await actions.sealJiraAttachment({ accountId: OWNER, issueId, attachmentId: id, powers: editor });
  if (!r.success) throw new Error(`seal ${id}: ${r.reason}`);
  return r.seal;
}
const PDF = Buffer.from("%PDF-1.4\n" + "x".repeat(4000) + "\n%%EOF\n");

// ── 1. "Put it back" keeps the real deleter ─────────────────────────────────────────────────────
{
  F.addIssue("45526", "SVJ-1");
  await sealFile("45526", "100", "spec.pdf", PDF);
  // three put-backs inside the hour already: the next delete trips the loop breaker (a lost row)
  const rec = F.store.get("jira-protection-100");
  rec.restores = [1, 2, 3].map((m) => new Date(Date.now() - m * 60000).toISOString());
  F.store.set("jira-protection-100", rec);
  F.detach("45526", "100");
  const del = await trigger.handleJiraAttachmentDeleted({ attachment: { id: "100" }, atlassianId: DELETER });
  eq("bug1: the 4th delete stops at the breaker", del.outcome, "loop-stopped");
  eq("bug1: the lost row remembers who deleted it", F.store.get("jira-seal-lost-100")?.deletedBy, DELETER);

  const before = F.comments.length;
  const retry = await actions.retryJiraRestore({ accountId: CLICKER, issueId: "45526", attachmentId: "100", powers: editor });
  ok("bug1: Put it back restores", retry.success === true && !!retry.attachmentId);
  const moved = F.store.get(`jira-protection-${retry.attachmentId}`) || {};
  eq("bug1: lastDeletedBy stays the deleter, not the clicker", moved.lastDeletedBy, DELETER);
  eq("bug1: the clicker is recorded as who asked for the put-back", moved.lastPutBackBy, CLICKER);
  const act = ofType("jira.restored").pop() || {};
  eq("bug1: the history entry is the clicker's act (they asked)", act.actor?.accountId, CLICKER);
  eq("bug1: …marked as asked for, with the deleter kept", [act.details?.requested, act.details?.deletedBy], [true, DELETER]);
  const asClicker = formatActivity({ ...act, actor: { ...act.actor, name: "You" } }).sentence;
  ok(`bug1: history never says the clicker deleted it (got "${asClicker}")`, !/You deleted/.test(asClicker) && /put back/.test(asClicker));
  const comment = F.comments.slice(before).pop();
  ok("bug1: a put-back comment went out", !!comment);
  const m = comment ? mentionsOf(comment.body) : [];
  ok(`bug1: the comment addresses the deleter, never the clicker as the deleter (mentions ${JSON.stringify(m)})`, m.includes(DELETER) && !m.includes(CLICKER));

  // the sweep's retry (no person) names the deleter from the lost row, never the app
  await sealFile("45526", "200", "plan.pdf", PDF);
  F.detach("45526", "200");
  const copy = F.objects.get("jira-seal/200");
  F.objects.delete("jira-seal/200"); // the copy is unreachable for the first try
  await trigger.jiraRestoreConsumer({ body: { attachmentId: "200", actorId: DELETER } });
  eq("bug1: a failed put-back is lost / failed", F.store.get("jira-seal-lost-200")?.reason, "failed");
  F.objects.set("jira-seal/200", copy);
  const swept = await trigger.restoreWithClaim("200");
  eq("bug1: the retry restores", swept.outcome, "restored");
  const sAct = ofType("jira.restored").pop() || {};
  eq("bug1: the sweep's put-back is written for the real deleter", sAct.actor?.accountId, DELETER);
  ok("bug1: never 'Sentinel Vault deleted sealed file'", !/^Sentinel Vault deleted/.test(formatActivity(sAct).sentence));
  ok("bug1: no actor known → no one is named as the deleter", /^Sealed file .* was deleted — Sentinel Vault put it back$/.test(formatActivity({ type: "jira.restored", actor: null, target: { name: "a.pdf" }, details: {} }).sentence));
}

// ── 2. force release of a file that is not on the issue says it deletes the last copy ──────────
{
  F.store.set("admin-settings-global", { enableEmailDispatches: true });
  F.addIssue("45527", "SVJ-2");
  await sealFile("45527", "301", "terms.pdf", PDF);
  // a put-back that fails (the copy unreachable for that one try), so the file is "Not put back"
  const copy301 = F.objects.get("jira-seal/301");
  F.objects.delete("jira-seal/301");
  F.detach("45527", "301");
  await trigger.jiraRestoreConsumer({ body: { attachmentId: "301", actorId: DELETER } });
  F.objects.set("jira-seal/301", copy301); // the app still holds the copy: the LAST one
  ok("bug2: the file is lost", !!F.store.get("jira-seal-lost-301"));
  const view = await actions.issueSealsView({ issueId: "45527", viewerId: ADMIN, powers: steward });
  const row = (view.attachments || []).find((a) => a.id === "301");
  eq("bug2: a steward is still offered force release on a lost row (decided: kept)", row?.row?.menu, ["force-release"]);
  const before = F.comments.length;
  const r = await actions.releaseJiraAttachment({ accountId: ADMIN, issueId: "45527", attachmentId: "301", reason: "Owner left the team", powers: steward, stewardOfProject: async () => true });
  ok("bug2: force release works", r.success === true);
  ok("bug2: the copy is gone", !F.objects.has("jira-seal/301"));
  const forced = ofType("jira.forced").pop() || {};
  eq("bug2: the record says the copy was deleted", forced.details?.copyDeleted, true);
  ok("bug2: the history sentence says so", /copy was deleted/.test(formatActivity(forced).sentence));
  const c = F.comments.slice(before).pop();
  ok("bug2: the owner's comment says the copy was deleted and the file cannot be put back", !!c && /deleted its copy/.test(JSON.stringify(c.body)) && /can no longer be put back/.test(JSON.stringify(c.body)));
  const fc = releaseCopy?.forceReleaseCopy?.({ fileName: "terms.pdf", ownerName: "Olivia Owner", lost: true });
  ok("bug2: the force dialog for a lost row warns about the last copy", !!fc && /last one it holds/.test(fc.message) && /cannot be put back/.test(fc.message));
  ok("bug2: …and no longer claims anyone can delete it from the issue", !!fc && !/anyone who can edit/.test(fc.message));
  eq("bug2: …its button says what it does", fc?.confirmLabel, "Delete the copy");
  const live = releaseCopy?.forceReleaseCopy?.({ fileName: "a.pdf", ownerName: "O", lost: false });
  ok("bug2: the force dialog for a file still on the issue is unchanged", !!live && /anyone who can edit the issue can delete it/.test(live.message));
  const own = releaseCopy?.ownerReleaseCopy?.({ fileName: "a.pdf", lost: true });
  ok("bug2: the owner's lost-row wording is the same warning", !!own && /last one it holds/.test(own.message) && own.confirmLabel === "Delete the copy");
  F.store.delete("admin-settings-global");
}

// ── 3. a file missing from the issue with nothing recorded yet reads "Being put back" ───────────
{
  F.addIssue("45528", "SVJ-3");
  await sealFile("45528", "500", "draft.pdf", PDF);
  F.detach("45528", "500"); // deleted; the trigger has not run yet: no queued marker, no lost row
  const rowOf = async (id, viewer = OWNER) => ((await actions.issueSealsView({ issueId: "45528", viewerId: viewer, powers: editor })).attachments || []).find((a) => a.id === id);
  let row = await rowOf("500");
  eq("bug3: nothing recorded yet → restoring, no button", [row?.row?.state, row?.row?.primary], ["restoring", null]);
  eq("bug3: …marked pending (the line does not promise more than it knows)", row?.pending, true);
  row = await rowOf("500", CLICKER);
  eq("bug3: same for another editor", row?.row?.state, "restoring");
  // the grace runs from the FIRST read that saw it missing
  const seen = F.store.get("jira-seal-missing-500");
  ok("bug3: the first sighting is remembered", !!seen?.at);
  F.store.set("jira-seal-missing-500", { at: new Date(Date.now() - 5 * 60000).toISOString() });
  row = await rowOf("500");
  eq("bug3: after the grace with still nothing recorded → Not put back with Put it back", [row?.row?.state, row?.row?.primary], ["lost", "retry"]);
  // a queued marker keeps it restoring whatever the grace says
  F.store.set("jira-seal-queued-500", { at: new Date().toISOString() });
  eq("bug3: queued → restoring", (await rowOf("500"))?.row?.state, "restoring");
  F.store.delete("jira-seal-queued-500");
  // the real Not-put-back cases still render
  for (const [reason, extra] of [["loop", { nextAt: null }], ["failed", { nextAt: Date.now() + 3600000, attempts: 1, error: "Jira said 500" }], ["failed", { nextAt: null, attempts: 10 }]]) {
    F.store.set("jira-seal-lost-500", { attachmentId: "500", reason, ...extra });
    F.store.set("jira-seal-missing-500", { at: new Date().toISOString() }); // fresh sighting must not hide a recorded failure
    const r = await rowOf("500");
    eq(`bug3: a recorded ${reason}${extra.nextAt ? " (retrying)" : ""} still reads Not put back`, [r?.row?.state, r?.row?.primary, r?.lostInfo?.reason], ["lost", "retry", reason]);
  }
  F.store.delete("jira-seal-lost-500");
  // a LAPSED seal deleted by anyone ends; it must not read "Being put back"
  await sealFile("45528", "501", "old.pdf", PDF);
  const lapsed = F.store.get("jira-protection-501");
  lapsed.expiresAt = new Date(Date.now() - 1000).toISOString();
  F.store.set("jira-protection-501", lapsed);
  F.detach("45528", "501");
  const r501 = await rowOf("501");
  ok("bug3: a lapsed seal's deleted file is not shown as being put back", !r501 || r501.row.state !== "restoring");
}

// ── 4 + 6. a deleted issue's copy: downloaded under its own name and type; let go by its owner ──
{
  F.addIssue("45529", "SVJ-4");
  const big = Buffer.alloc(5 * 1024 * 1024 + 1234);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
  await sealFile("45529", "600", "Quarterly report.pdf", big, "application/pdf");
  eq("bug4: the copy is stored with the file's own type", F.objects.get("jira-seal/600")?.contentType, "application/pdf");
  await sealFile("45529", "601", "notes.txt", Buffer.from("hello"), "text/plain");
  await trigger.handleJiraIssueDeleted({ issue: { id: "45529" }, atlassianId: DELETER });
  F.issues.delete("45529");
  ok("the seals became orphans", !!F.store.get("jira-protection-600")?.issueDeletedAt);

  const head = await call("jira-copy-download", OWNER, { attachmentId: "600" });
  eq("bug4: the head names the file and its type", [head.success, head.fileName, head.mimeType], [true, "Quarterly report.pdf", "application/pdf"]);
  eq("bug4: in parts that fit a 5 MB answer", head.parts, 3);
  const parts = [];
  let biggest = 0;
  for (let i = 0; i < (head.parts || 0); i++) {
    const p = await call("jira-copy-part", OWNER, { attachmentId: "600", index: i });
    ok(`bug4: part ${i} read`, p.success === true);
    biggest = Math.max(biggest, JSON.stringify(p).length);
    parts.push(p.data);
  }
  ok(`bug4: every answer stays under 5 MB (largest ${biggest} bytes)`, biggest > 0 && biggest < 5 * 1024 * 1024);
  ok("bug4: parts are asked by byte range", F.fetches.some((f) => f.op === "down" && /^bytes=\d+-\d+$/.test(f.headers.range || "")));
  const file = copyDl ? await copyDl.assembleCopy(parts, head) : { ok: false };
  ok("bug4: the assembled copy is byte-identical to the sealed file", file.ok && sha(Buffer.from(file.bytes)) === sha(big));
  const wrong = copyDl ? await copyDl.assembleCopy(parts.slice(0, 2), head) : { ok: true };
  ok("bug4: a short copy is never saved", wrong.ok === false);
  const forged = copyDl ? await copyDl.assembleCopy(parts, { ...head, sha256: "00".repeat(32) }) : { ok: true };
  ok("bug4: a copy that does not match the seal's hash is never saved", forged.ok === false);
  // a copy stored before 8.6 (as application/octet-stream) still downloads under the right name and type
  F.objects.get("jira-seal/601").contentType = "application/octet-stream";
  const old = await call("jira-copy-download", OWNER, { attachmentId: "601" });
  eq("bug4: an old copy gets its name and type from the seal record", [old.fileName, old.mimeType, old.parts], ["notes.txt", "text/plain", 1]);
  const oldPart = await call("jira-copy-part", OWNER, { attachmentId: "601", index: 0 });
  eq("bug4: …and its bytes", Buffer.from(oldPart.data || "", "base64").toString(), "hello");
  // the gate, on every call
  eq("bug4: someone else cannot read a part", (await call("jira-copy-part", CLICKER, { attachmentId: "600", index: 0 })).success, false);
  eq("bug4: no part beyond the last", (await call("jira-copy-part", OWNER, { attachmentId: "600", index: 3 })).success, false);
  eq("bug4: no negative part", (await call("jira-copy-part", OWNER, { attachmentId: "600", index: -1 })).success, false);

  // 6. Let it go
  eq("bug6: someone else cannot let the copy go", (await call("jira-copy-letgo", CLICKER, { attachmentId: "600" })).success, false);
  ok("bug6: …and the copy is still there", F.objects.has("jira-seal/600") && !!F.store.get("jira-protection-600"));
  F.addIssue("45530", "SVJ-5");
  await sealFile("45530", "700", "live.pdf", PDF);
  eq("bug6: a seal whose issue still exists is not let go from My work", (await call("jira-copy-letgo", OWNER, { attachmentId: "700" })).success, false);
  const listedBefore = (await call("list-my-jira-seals", OWNER, {})).seals?.some((s) => s.attachmentId === "600");
  ok("bug6: My work lists the orphan before", listedBefore === true);
  const go = await call("jira-copy-letgo", OWNER, { attachmentId: "600" });
  eq("bug6: the owner lets it go", go.success, true);
  ok("bug6: the seal and the copy are gone", !F.store.get("jira-protection-600") && !F.objects.has("jira-seal/600"));
  ok("bug6: My work no longer lists it", !(await call("list-my-jira-seals", OWNER, {})).seals?.some((s) => s.attachmentId === "600"));
  const ended = ofType("jira.ended").filter((e) => e.details?.why === "owner-let-go").pop();
  ok("bug6: the history records the owner letting it go", ended?.actor?.accountId === OWNER && /let go of the kept copy/.test(formatActivity(ended).sentence));
  eq("bug6: a second let-go finds nothing", (await call("jira-copy-letgo", OWNER, { attachmentId: "600" })).success, false);
  ok("bug6: let-go is a signed seal action", SIGNED_SEAL_ACTION_KEYS.includes("jira-copy-letgo"));
  ok("bug6: let-go schedules a backup (a write)", WRITE_ACTIONS.includes("jira-copy-letgo"));
  ok("bug4: the part read is a read", READ_ACTIONS.includes("jira-copy-part"));
  const lg = releaseCopy?.orphanLetGoCopy?.({ fileName: "Quarterly report.pdf", issueKey: "SVJ-4" });
  ok("bug6: the dialog warns it deletes the last copy for good", !!lg && /last one it holds/.test(lg.message) && lg.confirmLabel === "Delete the copy" && lg.title === "Let this file go?");
}

report("jira-seal-flows");
