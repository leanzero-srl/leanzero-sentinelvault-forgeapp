// 8.0 — Jira attachment seals: the pure rules (src/server/capsules/jira-seals/logic.js).
// docs/JIRA-SEALS.md is the design record; every decision the trigger and resolvers take is here.
import { eq, ok, report } from "./_assert.mjs";
import {
  buildSealRecord, decideDeletion, movedRecord, noticeDue, restoreNoticePlan, restoreCommentAdf, lapseCommentAdf,
  viewerPowers, rowFor, isJiraId, normId, isIssueRef, sealIdOf, jiraCopyKey, isExpired, JIRA_NOTICE_WINDOW_MS,
} from "../src/server/capsules/jira-seals/logic.js";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const OWNER = "712020:owner";
const OTHER = "712020:other";
const APP = "712020:app";
const rec = buildSealRecord({
  attachment: { id: "14731", filename: "spec.pdf", size: 500, mimeType: "application/pdf" },
  issue: { id: "45526", key: "SVJ-1" }, project: { id: 12587, key: "SVJ" },
  owner: { accountId: OWNER, name: "Owner" }, holdSeconds: 3600, sha256: "abc", copyKey: jiraCopyKey("14731"), note: "  keep  ", nowMs: NOW,
});

// ── the record ──
eq("record: ids are strings", [rec.attachmentId, rec.issueId, rec.projectId], ["14731", "45526", "12587"]);
eq("record: expiry = now + hold", rec.expiresAt, "2026-10-11T11:00:00.000Z");
eq("record: note trimmed", rec.note, "keep");
eq("record: original id kept", rec.originalAttachmentId, "14731");
eq("record: copy key by first id", rec.copyKey, "jira-seal/14731");
eq("record: blank note is null", buildSealRecord({ ...{ attachment: { id: "1" }, issue: { id: "2" }, owner: { accountId: OWNER }, holdSeconds: 1, nowMs: NOW }, note: "   " }).note, null);
eq("record: product", rec.product, "jira");

// ── who deleted it ──
eq("delete: no record", decideDeletion({ record: null, actorId: OTHER, nowMs: NOW }), "ignore");
eq("delete: ownerless record", decideDeletion({ record: { ...rec, lockedBy: null }, actorId: OTHER, nowMs: NOW }), "ignore");
eq("delete: the app's own event", decideDeletion({ record: rec, actorId: OTHER, selfGenerated: true, nowMs: NOW }), "ignore");
eq("delete: the app's account", decideDeletion({ record: rec, actorId: APP, appAccountId: APP, nowMs: NOW }), "ignore");
eq("delete: the owner ends the seal", decideDeletion({ record: rec, actorId: OWNER, appAccountId: APP, nowMs: NOW }), "release-owner");
eq("delete: someone else → restore", decideDeletion({ record: rec, actorId: OTHER, appAccountId: APP, nowMs: NOW }), "restore");
eq("delete: unknown actor → restore (never assume consent)", decideDeletion({ record: rec, actorId: null, appAccountId: APP, nowMs: NOW }), "restore");
eq("delete: lapsed seal → no restore", decideDeletion({ record: rec, actorId: OTHER, appAccountId: APP, nowMs: NOW + 3600001 }), "release-expired");
eq("delete: the owner on a lapsed seal is still the owner", decideDeletion({ record: rec, actorId: OWNER, nowMs: NOW + 9e9 }), "release-owner");
eq("delete: app id unknown → still restores", decideDeletion({ record: rec, actorId: OTHER, appAccountId: null, nowMs: NOW }), "restore");

// ── the move after a restore ──
const moved = movedRecord(rec, { id: "14799", filename: "spec.pdf" }, { actorId: OTHER, nowMs: NOW });
eq("move: new id", moved.attachmentId, "14799");
eq("move: original id stays", moved.originalAttachmentId, "14731");
eq("move: counted", moved.restoreCount, 1);
eq("move: second restore counted", movedRecord(moved, { id: "14800" }, { actorId: OTHER, nowMs: NOW }).restoreCount, 2);
eq("move: who deleted", moved.lastDeletedBy, OTHER);
eq("move: copy unchanged", moved.copyKey, rec.copyKey);
eq("move: seal identity unchanged", sealIdOf(moved), sealIdOf(rec));
eq("move: owner and expiry unchanged", [moved.lockedBy, moved.expiresAt], [rec.lockedBy, rec.expiresAt]);

// ── one comment per window ──
ok("notice: first is due", noticeDue(null, NOW));
ok("notice: inside the window is not", !noticeDue({ at: new Date(NOW - 1000).toISOString() }, NOW));
ok("notice: after the window is", noticeDue({ at: new Date(NOW - JIRA_NOTICE_WINDOW_MS).toISOString() }, NOW));
ok("notice: unreadable marker → due", noticeDue({ at: "garbage" }, NOW));

// ── who the comment names ──
eq("plan: everything off → no comment", restoreNoticePlan({}, { actorId: OTHER, ownerId: OWNER }), { post: false, mention: [] });
eq("plan: editor carve-out only → the deleter", restoreNoticePlan({ NOTIFY_EDITOR_ON_REVERT: true }, { actorId: OTHER, ownerId: OWNER }), { post: true, mention: [OTHER] });
eq("plan: all on → deleter and owner", restoreNoticePlan({ NOTIFY_EDITOR_ON_REVERT: true, ENABLE_NATIVE_NOTIFICATIONS: true }, { actorId: OTHER, ownerId: OWNER }), { post: true, mention: [OTHER, OWNER] });
eq("plan: master on, carve-out off → still both", restoreNoticePlan({ ENABLE_NATIVE_NOTIFICATIONS: true }, { actorId: OTHER, ownerId: OWNER }), { post: true, mention: [OTHER, OWNER] });
eq("plan: no actor, carve-out only → nobody to tell", restoreNoticePlan({ NOTIFY_EDITOR_ON_REVERT: true }, { actorId: null, ownerId: OWNER }), { post: false, mention: [] });
const adf = restoreCommentAdf({ actorId: OTHER, ownerId: OWNER, ownerName: "Owner", fileName: "spec.pdf", mentionOwner: false });
const flat = JSON.stringify(adf);
ok("comment: mentions the deleter", flat.includes(`"id":"${OTHER}"`));
ok("comment: names the owner in text when not mentioned", flat.includes("Owner") && !flat.includes(`"id":"${OWNER}"`));
ok("comment: names the file", flat.includes("spec.pdf"));
ok("comment with owner mention", JSON.stringify(restoreCommentAdf({ actorId: OTHER, ownerId: OWNER, fileName: "f", mentionOwner: true })).includes(`"id":"${OWNER}"`));
eq("comment: ADF doc", [adf.type, adf.version, adf.content[0].type], ["doc", 1, "paragraph"]);
ok("lapse comment: countdown names the date", JSON.stringify(lapseCommentAdf({ ownerId: OWNER, fileName: "f", noticeNumber: 1, noticeLimit: 3, releaseDate: "October 14, 2026" })).includes("October 14, 2026"));
ok("lapse comment: release", JSON.stringify(lapseCommentAdf({ ownerId: OWNER, fileName: "f", noticeLimit: 3, released: true })).includes("released after 3 reminders"));
ok("lapse comment: no release configured", !JSON.stringify(lapseCommentAdf({ ownerId: OWNER, fileName: "f", noticeNumber: 1, noticeLimit: 0 })).includes("released on"));

// ── the viewer's powers (Jira's own answer) ──
const P = (...keys) => Object.fromEntries(keys.map((k) => [k, { havePermission: true }]));
eq("powers: nothing", viewerPowers({}), { canSee: false, canEdit: false, isSteward: false });
eq("powers: browse only", viewerPowers(P("BROWSE_PROJECTS")), { canSee: true, canEdit: false, isSteward: false });
eq("powers: edit without browse is nothing", viewerPowers(P("EDIT_ISSUES")), { canSee: false, canEdit: false, isSteward: false });
eq("powers: editor", viewerPowers(P("BROWSE_PROJECTS", "EDIT_ISSUES")), { canSee: true, canEdit: true, isSteward: false });
eq("powers: project admin", viewerPowers(P("BROWSE_PROJECTS", "ADMINISTER_PROJECTS")), { canSee: true, canEdit: false, isSteward: true });
eq("powers: Jira admin", viewerPowers(P("BROWSE_PROJECTS", "ADMINISTER", "EDIT_ISSUES")).isSteward, true);
eq("powers: admin override off → no steward", viewerPowers(P("BROWSE_PROJECTS", "ADMINISTER_PROJECTS"), { allowAdminOverride: false }).isSteward, false);
eq("powers: havePermission false is no", viewerPowers({ BROWSE_PROJECTS: { havePermission: false } }).canSee, false);
eq("powers: a malformed answer is no", viewerPowers(null), { canSee: false, canEdit: false, isSteward: false });

// ── one row rule ──
const editor = { canSee: true, canEdit: true, isSteward: false };
const steward = { canSee: true, canEdit: true, isSteward: true };
const viewer = { canSee: true, canEdit: false, isSteward: false };
eq("row: open, editor → Seal", rowFor({ record: null, viewerId: OTHER, powers: editor, nowMs: NOW }), { state: "open", primary: "seal", menu: [] });
eq("row: open, viewer → nothing", rowFor({ record: null, viewerId: OTHER, powers: viewer, nowMs: NOW }), { state: "open", primary: null, menu: [] });
eq("row: mine → Release, Extend", rowFor({ record: rec, viewerId: OWNER, powers: editor, nowMs: NOW }), { state: "mine", primary: "release", menu: ["extend"] });
eq("row: someone else's, editor → no action", rowFor({ record: rec, viewerId: OTHER, powers: editor, nowMs: NOW }), { state: "held", primary: null, menu: [] });
eq("row: someone else's, steward → Extend + Force", rowFor({ record: rec, viewerId: OTHER, powers: steward, nowMs: NOW }), { state: "held", primary: null, menu: ["extend", "force-release"] });
eq("row: my lapsed seal", rowFor({ record: rec, viewerId: OWNER, powers: editor, nowMs: NOW + 9e6 }).state, "expired");
eq("row: a steward on their own seal gets no Force", rowFor({ record: rec, viewerId: OWNER, powers: steward, nowMs: NOW }).menu, ["extend"]);

// ── ids ──
ok("id: digits", isJiraId("14731") && isJiraId(14731));
ok("id: refuses paths", !isJiraId("147/../1") && !isJiraId("") && !isJiraId("att123") && !isJiraId(-1) && !isJiraId(1.5));
eq("normId", [normId("12"), normId(12), normId("x")], ["12", "12", null]);
ok("issue ref: key or id", isIssueRef("SVJ-1") && isIssueRef("45526") && !isIssueRef("svj-1") && !isIssueRef("SVJ-1/../x"));
ok("expired: no date is not expired", !isExpired({}, NOW));

report("jira-seals");
