// A page's workflow record, its approval request and the seals on it keep the space they were made
// in. After the page moves to another space, steward power over them belongs to the space the page
// is in NOW — and, because the record came from elsewhere, to the space it was made in as well:
// the old space's admins no longer run a page that left them, and moving a page into a space you
// administer does not hand you its records. A site admin passes both. An unmoved page is unchanged.
//
// A moved page's workflow holds still until an admin of both spaces re-assigns it (its rules are the
// old space's), it keeps the protection it was approved under, and a failed lookup never demotes a
// steward's edit. The old space's Seals tab and new activity no longer show it.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url"; // a path, not a %20-encoded URL: the checkout path has a space

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const sealing = byKey((await import("../src/server/capsules/sealing/actions.js")).actions);
const sections = byKey((await import("../src/server/capsules/section-seals/actions.js")).actions);
const editreq = byKey((await import("../src/server/capsules/editreq/actions.js")).actions);
const realms = byKey((await import("../src/server/capsules/realms/actions.js")).actions);
const { workflowPrivilegeForPage } = await import("../src/server/capsules/workflow/privilege.js");
const { collectWorkflowEnforcementForPage, workflowSweep } = await import("../src/server/triggers.js");
const { applyAiVerdict } = await import("../src/server/capsules/workflow/approvals.js");
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
const { recordActivity, activitySpacePrefix } = await import("../src/server/infra/activity-log.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const SITE_ADMIN = "acct-site-admin";
const ADMIN_A = "acct-admin-of-A"; // on Sentinel Vault's Space admins list of AAA only
const ADMIN_B = "acct-admin-of-B"; // ... of BBB only
const ADMIN_AB = "acct-admin-of-both";
const OWNER = "acct-seal-owner";
const REQUESTER = "acct-requester";
const PLAIN = "acct-plain";
const SPACES = { AAA: "101", BBB: "202" };
const MOVED = "5001"; // made in AAA, now in BBB
const STAY = "5002"; // made in AAA, still there
const BLOG = "7001"; // a blog post in BBB
const PAGES = { [MOVED]: { space: "202", title: "Moved page" }, [STAY]: { space: "101", title: "Staying page" } };
const BLOGS = { [BLOG]: { space: "202", title: "A blog post" } };
const APPROVED = DEFAULT_WORKFLOW.states.find((s) => s.enforce)?.id || "approved";
const DRAFT = DEFAULT_WORKFLOW.states[0].id;
const REASON = "Releasing for the audit, agreed with the owner";

let propWrites = [];
async function world({ stateId = DRAFT } = {}) {
  resetFake();
  propWrites = [];
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") {
      const acct = qs.get("accountId");
      return { body: { accountId: acct, displayName: acct, groups: { results: [] }, operations: acct === SITE_ADMIN ? [{ operation: "administer", targetType: "application" }] : [] } };
    }
    // Confluence's own space-permission check is the 405 endpoint on 8.8.0: only the app's lists count.
    if (/^\/wiki\/rest\/api\/space\/[^/]+\/permission\/check$/.test(base)) return { status: 405, body: {} };
    // Everyone may read and edit both pages: the tests are about steward power, not content rights.
    if (/^\/wiki\/rest\/api\/content\/[^/]+\/permission\/check$/.test(base)) return { body: { hasPermission: true } };
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const p = PAGES[m[1]];
      return p ? { body: { id: m[1], status: "current", title: p.title, spaceId: p.space, version: { number: 3, authorId: OWNER } } } : { status: 404 };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/blogposts\/(\d+)$/))) {
      const b = BLOGS[m[1]];
      return b ? { body: { id: m[1], status: "current", title: b.title, spaceId: b.space, version: { number: 1 } } } : { status: 404 };
    }
    if (base === "/wiki/api/v2/pages" && method === "GET") {
      const ids = String(qs.get("id") || "").split(",");
      const statuses = String(qs.get("status") || "current").split(",");
      return { body: { results: statuses.includes("current") ? ids.filter((id) => PAGES[id]).map((id) => ({ id, status: "current", title: PAGES[id].title, spaceId: PAGES[id].space, _links: { webui: `/p/${id}` } })) : [] } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) { const key = Object.keys(SPACES).find((k) => SPACES[k] === m[1]); return key ? { body: { id: m[1], key } } : { status: 404 }; }
    if (base === "/wiki/api/v2/spaces") { const k = qs.get("keys"); return { body: { results: SPACES[k] ? [{ id: SPACES[k], key: k }] : [] } }; }
    if ((m = base.match(/^\/wiki\/api\/v2\/(pages|blogposts)\/(\d+)\/properties(?:\/(\d+))?$/))) {
      if (method === "GET") {
        if (m[1] === "pages" && qs.get("key") === "sentinel-vault-workflow" && stateId === APPROVED) return { body: { results: [{ id: "900", value: { enforce: true }, version: { number: 1 } }] } };
        return { body: { results: [] } };
      }
      propWrites.push({ coll: m[1], id: m[2], method });
      return { body: { id: "901", version: { number: 1 } } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/attachments\/([^/]+)$/))) {
      const id = m[1];
      if (id === "att-blog") return { body: { id, status: "current", title: "blog.pdf", blogPostId: BLOG, fileId: "f-blog", version: { number: 1, authorId: PLAIN } } };
      if (id === "att-custom") return { body: { id, status: "current", title: "custom.pdf", customContentId: "8001", fileId: "f-c", version: { number: 1 } } };
      if (id === "att-moved") return { body: { id, status: "current", title: "moved.pdf", pageId: MOVED, fileId: "f-m", version: { number: 1 } } };
      if (id === "att-misfiled") return { body: { id, status: "current", title: "misfiled.pdf", pageId: MOVED, fileId: "f-x", version: { number: 1 } } };
      if (id === "att-trashed") return { body: { id, status: "trashed", title: "trashed.pdf", pageId: MOVED, fileId: "f-t", version: { number: 2 } } };
      if (id === "att-stay") return { body: { id, status: "current", title: "stay.pdf", pageId: STAY, fileId: "f-s", version: { number: 1 } } };
      return { status: 404 };
    }
    if (method !== "GET") return { body: {} }; // body writes, comments, labels: accepted
    if (/\/labels$/.test(base)) return { body: { results: [] } };
    return undefined;
  });
  await kvs.set("admin-settings-global", { allowAdminOverride: true, allowSealPurge: true, allowSealRestore: true });
  await kvs.set("admin-settings-space-AAA", { adminUsers: [{ accountId: ADMIN_A }, { accountId: ADMIN_AB }] });
  await kvs.set("admin-settings-space-BBB", { adminUsers: [{ accountId: ADMIN_B }, { accountId: ADMIN_AB }] });
  for (const pageId of [MOVED, STAY]) {
    await kvs.set(`workflow-state-${pageId}`, {
      workflowId: "default", stateId, spaceKey: "AAA", enteredAt: "2026-10-01T00:00:00.000Z",
      enforce: stateId === APPROVED, approvedVersion: stateId === APPROVED ? 3 : null, approvers: [],
    });
    await kvs.set(`workflow-idx-AAA-${stateId}-${pageId}`, { pageId, stateId, workflowId: "default", enteredAt: "2026-10-01T00:00:00.000Z" });
  }
  await kvs.set("workflow-settings-AAA", { enabled: true, readConfirmation: { enabled: true } });
  const future = new Date(Date.now() + 86400000).toISOString();
  await kvs.set("protection-att-moved", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: MOVED, attachmentId: "att-moved", attachmentName: "moved.pdf", expiresAt: future, timestamp: "2026-10-01T00:00:00.000Z" });
  await kvs.set("protection-att-stay", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: STAY, attachmentId: "att-stay", attachmentName: "stay.pdf", expiresAt: future, timestamp: "2026-10-01T00:00:00.000Z" });
  await kvs.set("edit-request-att-moved-" + REQUESTER, { requesterAccountId: REQUESTER, requesterName: "Req", status: "pending", requestedAt: "2026-10-02T00:00:00.000Z" });
  await kvs.set("edit-request-att-stay-" + REQUESTER, { requesterAccountId: REQUESTER, requesterName: "Req", status: "pending", requestedAt: "2026-10-02T00:00:00.000Z" });
  // A seal whose record names the wrong page (made before 8.9.0 while viewing another page): the file is on MOVED.
  await kvs.set("protection-att-misfiled", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: STAY, attachmentId: "att-misfiled", attachmentName: "misfiled.pdf", expiresAt: future, timestamp: "2026-10-01T00:00:00.000Z" });
  await kvs.set("protection-att-trashed", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: MOVED, attachmentId: "att-trashed", attachmentName: "trashed.pdf", expiresAt: future, timestamp: "2026-10-01T00:00:00.000Z" });
  await kvs.set("section-edit-request-sec-moved-" + REQUESTER, { requesterAccountId: REQUESTER, requesterName: "Req", status: "pending", requestedAt: "2026-10-02T00:00:00.000Z" });
  await kvs.set("space-protection-101-att-moved", { attachmentId: "att-moved", attachmentName: "moved.pdf", contentId: MOVED, spaceKey: "AAA", pageTitle: "Moved page", lockedBy: OWNER });
  await kvs.set("space-protection-101-att-stay", { attachmentId: "att-stay", attachmentName: "stay.pdf", contentId: STAY, spaceKey: "AAA", pageTitle: "Staying page", lockedBy: OWNER });
  await kvs.set("section-protection-sec-moved", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", pageId: MOVED, sectionId: "sec-moved", sectionTitle: "Terms", expiresAt: future });
  await kvs.set("section-protection-sec-stay", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: "AAA", pageId: STAY, sectionId: "sec-stay", sectionTitle: "Terms", expiresAt: future });
}
const as = (fn, accountId, payload, extension = {}) => fn({ payload, context: { accountId, extension } });
const said = (r, s) => JSON.stringify(r ?? null).includes(s);

// ── workflow: take a page out ──────────────────────────────────────────────────────────────────
const NOT_ADMIN_REMOVE = "Only a space admin can take a page out of the workflow";
for (const [who, acct] of [["admin of the old space", ADMIN_A], ["admin of the new space only", ADMIN_B], ["plain user", PLAIN]]) {
  await world();
  const r = await as(workflow.get("remove-workflow"), acct, { pageId: MOVED });
  eq(`remove-workflow, moved page, ${who}: refused`, r?.success, false);
  ok(`remove-workflow, moved page, ${who}: record kept`, !!(await kvs.get(`workflow-state-${MOVED}`)));
}
await world();
eq("remove-workflow, moved page, admin of both spaces: done", (await as(workflow.get("remove-workflow"), ADMIN_AB, { pageId: MOVED }))?.success, true);
await world();
eq("remove-workflow, moved page, site admin: done", (await as(workflow.get("remove-workflow"), SITE_ADMIN, { pageId: MOVED }))?.success, true);
await world();
eq("remove-workflow, unmoved page, admin of its space: done (control)", (await as(workflow.get("remove-workflow"), ADMIN_A, { pageId: STAY }))?.success, true);

// ── workflow: assign (re-assigning brings a moved page under its new space) ────────────────────
await world();
eq("assign-workflow, moved page, admin of the old space: refused", (await as(workflow.get("assign-workflow"), ADMIN_A, { pageId: MOVED }))?.success, false);
await world();
eq("assign-workflow, moved page, admin of the new space only: refused", (await as(workflow.get("assign-workflow"), ADMIN_B, { pageId: MOVED }))?.success, false);
await world();
const reassigned = await as(workflow.get("assign-workflow"), ADMIN_AB, { pageId: MOVED });
eq("assign-workflow, moved page, admin of both: done", reassigned?.success, true);
eq("assign-workflow, moved page, admin of both: record filed under the new space", (await kvs.get(`workflow-state-${MOVED}`))?.spaceKey, "BBB");
ok("assign-workflow, moved page: the old space's index row is gone", !(await kvs.get(`workflow-idx-AAA-${DRAFT}-${MOVED}`)));
await world();
eq("assign-workflow, unmoved page, admin of its space: done (control)", (await as(workflow.get("assign-workflow"), ADMIN_A, { pageId: STAY }))?.success, true);

// ── workflow: review date, read report, page details flag ─────────────────────────────────────
await world();
const due = new Date(Date.now() + 7 * 86400000).toISOString();
ok("set-review-due, moved page, admin of the old space: refused", said(await as(workflow.get("set-review-due"), ADMIN_A, { pageId: MOVED, reviewDueAt: due }), "Only a space admin"));
ok("set-review-due, moved page, admin of the new space only: refused", said(await as(workflow.get("set-review-due"), ADMIN_B, { pageId: MOVED, reviewDueAt: due }), "Only a space admin"));
ok("set-review-due, moved page, admin of both: allowed", !said(await as(workflow.get("set-review-due"), ADMIN_AB, { pageId: MOVED, reviewDueAt: due }), "Only a space admin"));
ok("set-review-due, unmoved page, admin of its space: allowed (control)", !said(await as(workflow.get("set-review-due"), ADMIN_A, { pageId: STAY, reviewDueAt: due }), "Only a space admin"));
ok("get-read-report, moved page, admin of the old space: refused", said(await as(workflow.get("get-read-report"), ADMIN_A, { pageId: MOVED }), "Only a space admin"));
ok("get-read-report, moved page, admin of both: allowed", !said(await as(workflow.get("get-read-report"), ADMIN_AB, { pageId: MOVED }), "Only a space admin"));
ok("get-read-report, unmoved page, admin of its space: allowed (control)", !said(await as(workflow.get("get-read-report"), ADMIN_A, { pageId: STAY }), "Only a space admin"));
const onMoved = { content: { id: MOVED, space: { key: "BBB" } } };
eq("get-page-workflow on the moved page, admin of the old space: no review-date button", (await as(workflow.get("get-page-workflow"), ADMIN_A, { pageId: MOVED }, onMoved))?.canSetReviewDue, false);
eq("get-page-workflow on the moved page, admin of both: review-date button", (await as(workflow.get("get-page-workflow"), ADMIN_AB, { pageId: MOVED }, onMoved))?.canSetReviewDue, true);

// ── workflow: leaving Approved is a steward act ────────────────────────────────────────────────
const LEAVE = "Only a space admin can move a page out of";
await world({ stateId: APPROVED });
{ const r = await as(workflow.get("request-transition"), ADMIN_A, { pageId: MOVED, toStateId: DRAFT }); ok("request-transition out of Approved, moved page, admin of the old space: refused", r?.success === false && (said(r, LEAVE) || said(r, "moved to another space"))); }
await world({ stateId: APPROVED });
{ const r = await as(workflow.get("request-transition"), ADMIN_B, { pageId: MOVED, toStateId: DRAFT }); ok("request-transition out of Approved, moved page, admin of the new space only: refused", r?.success === false && (said(r, LEAVE) || said(r, "moved to another space"))); }
await world({ stateId: APPROVED });
ok("request-transition out of Approved, moved page, admin of both: not refused as a non-admin", !said(await as(workflow.get("request-transition"), ADMIN_AB, { pageId: MOVED, toStateId: DRAFT }), LEAVE));
await world({ stateId: APPROVED });
ok("request-transition out of Approved, unmoved page, admin of its space: not refused (control)", !said(await as(workflow.get("request-transition"), ADMIN_A, { pageId: STAY, toStateId: DRAFT }), LEAVE));

// ── workflow: an Approved page's privileged editors (the trigger's and the seal gate's rule) ──
await world({ stateId: APPROVED });
eq("privilege on the moved Approved page, admin of the old space: not privileged", (await workflowPrivilegeForPage(MOVED, ADMIN_A))?.privileged, false);
eq("privilege on the moved Approved page, admin of the new space only: not privileged", (await workflowPrivilegeForPage(MOVED, ADMIN_B))?.privileged, false);
eq("privilege on the moved Approved page, admin of both: privileged", (await workflowPrivilegeForPage(MOVED, ADMIN_AB))?.privileged, true);
eq("privilege on the unmoved Approved page, admin of its space: privileged (control)", (await workflowPrivilegeForPage(STAY, ADMIN_A))?.privileged, true);
// The page trigger's probe: an edit by someone privileged advances the approved baseline; anyone
// else's edit is undone (or the page demoted). Same rule.
await world({ stateId: APPROVED });
ok("page trigger, moved Approved page edited by an admin of the old space: not a privileged edit", (await collectWorkflowEnforcementForPage(MOVED, ADMIN_A, 4, "app-account"))?.action !== "privileged");
await world({ stateId: APPROVED });
ok("page trigger, moved Approved page edited by an admin of the new space only: not a privileged edit", (await collectWorkflowEnforcementForPage(MOVED, ADMIN_B, 4, "app-account"))?.action !== "privileged");
await world({ stateId: APPROVED });
eq("page trigger, moved Approved page edited by an admin of both: privileged edit", (await collectWorkflowEnforcementForPage(MOVED, ADMIN_AB, 4, "app-account"))?.action, "privileged");
await world({ stateId: APPROVED });
eq("page trigger, unmoved Approved page edited by an admin of its space: privileged edit (control)", (await collectWorkflowEnforcementForPage(STAY, ADMIN_A, 4, "app-account"))?.action, "privileged");

// ── workflow: approvals (an admin decides without being listed; withdraw) ─────────────────────
async function pendingOn(pageId) {
  await kvs.set(`workflow-pending-${pageId}`, { pageId, toStateId: APPROVED, toStateName: "Approved", requestedBy: REQUESTER, requestedByName: "Req", requestedAt: "2026-10-02T00:00:00.000Z", pinnedVersion: 3, approvers: ["acct-listed"], mode: "any", min: 1, spaceKey: "AAA" });
  await kvs.set(`workflow-approval-${pageId}-${APPROVED}-approval-acct-listed`, { approverAccountId: "acct-listed", status: "pending" });
  // "acct-listed" is still one of the space's approvers (a decision needs the snapshot AND the
  // current list: test/approver-revocation.test.mjs).
  const ws = await kvs.get("workflow-settings-AAA");
  await kvs.set("workflow-settings-AAA", { ...ws, approval: { approvers: [{ id: "acct-listed", type: "user", name: "Listed" }], mode: "any" } });
}
const NOT_APPROVER = "You are not an approver for this transition";
await world(); await pendingOn(MOVED);
ok("decide-approval, moved page, admin of the old space: not an approver", said(await as(workflow.get("decide-approval"), ADMIN_A, { pageId: MOVED, decision: "denied", reason: "no" }), NOT_APPROVER));
await world(); await pendingOn(MOVED);
ok("decide-approval, moved page, admin of the new space only: not an approver", said(await as(workflow.get("decide-approval"), ADMIN_B, { pageId: MOVED, decision: "denied", reason: "no" }), NOT_APPROVER));
await world(); await pendingOn(MOVED);
ok("decide-approval, moved page, admin of both: decides", !said(await as(workflow.get("decide-approval"), ADMIN_AB, { pageId: MOVED, decision: "denied", reason: "no" }), NOT_APPROVER));
await world(); await pendingOn(STAY);
ok("decide-approval, unmoved page, admin of its space: decides (control)", !said(await as(workflow.get("decide-approval"), ADMIN_A, { pageId: STAY, decision: "denied", reason: "no" }), NOT_APPROVER));
await world(); await pendingOn(MOVED);
eq("withdraw-approval, moved page, admin of the old space: refused", (await as(workflow.get("withdraw-approval"), ADMIN_A, { pageId: MOVED }))?.success, false);
ok("withdraw-approval, moved page, admin of the old space: request still open", !!(await kvs.get(`workflow-pending-${MOVED}`)));
await world(); await pendingOn(MOVED);
eq("withdraw-approval, moved page, admin of both: withdrawn", (await as(workflow.get("withdraw-approval"), ADMIN_AB, { pageId: MOVED }))?.success, true);
await world(); await pendingOn(MOVED);
const pa = await as(workflow.get("get-page-approvals"), ADMIN_A, { pageId: MOVED }, onMoved);
eq("get-page-approvals, moved page, admin of the old space: no Approve/Deny offered", pa?.adminCanDecide === true, false);

// ── workflow: the dashboard does not list a page that left the space ──────────────────────────
await world();
const dash = await as(workflow.get("get-workflow-dashboard"), ADMIN_A, { spaceKey: "AAA" });
ok("dashboard of the old space: the moved page is not listed", !said(dash?.pages, MOVED) && !said(dash, "Moved page"));
ok("dashboard of the old space: the page that stayed is listed (control)", said(dash?.pages, STAY));

// ── attachment seals: force-release, extend, edit requests, steward-unseal ────────────────────
const DENIED = "Admin override denied";
for (const [who, acct] of [["admin of the old space", ADMIN_A], ["admin of the new space only", ADMIN_B]]) {
  await world();
  ok(`unseal-artifact override, moved page, ${who}: refused`, said(await as(sealing.get("unseal-artifact"), acct, { attachmentId: "att-moved", adminOverride: true, reason: REASON }), DENIED));
  ok(`unseal-artifact override, moved page, ${who}: seal kept`, !!(await kvs.get("protection-att-moved")));
  ok(`extend-seal, moved page, ${who}: refused`, said(await as(sealing.get("extend-seal"), acct, { attachmentId: "att-moved", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));
  ok(`approve-edit-request, moved page, ${who}: refused`, said(await as(editreq.get("approve-edit-request"), acct, { attachmentId: "att-moved", requesterAccountId: REQUESTER }), "Not the seal owner"));
  ok(`list-edit-requests, moved page, ${who}: refused`, said(await as(editreq.get("list-edit-requests"), acct, { attachmentId: "att-moved" }), "Not authorized"));
  ok(`steward-unseal, moved page, ${who}: refused`, said(await as(realms.get("steward-unseal"), acct, { attachmentId: "att-moved", reason: REASON }), DENIED));
}
await world();
ok("unseal-artifact override, moved page, admin of both: allowed", !said(await as(sealing.get("unseal-artifact"), ADMIN_AB, { attachmentId: "att-moved", adminOverride: true, reason: REASON }), DENIED));
await world();
ok("extend-seal, moved page, admin of both: allowed", !said(await as(sealing.get("extend-seal"), ADMIN_AB, { attachmentId: "att-moved", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));
await world();
ok("approve-edit-request, moved page, admin of both: allowed", !said(await as(editreq.get("approve-edit-request"), ADMIN_AB, { attachmentId: "att-moved", requesterAccountId: REQUESTER }), "Not the seal owner"));
await world();
ok("unseal-artifact override, unmoved page, admin of its space: allowed (control)", !said(await as(sealing.get("unseal-artifact"), ADMIN_A, { attachmentId: "att-stay", adminOverride: true, reason: REASON }), DENIED));
await world();
ok("approve-edit-request, unmoved page, admin of its space: allowed (control)", !said(await as(editreq.get("approve-edit-request"), ADMIN_A, { attachmentId: "att-stay", requesterAccountId: REQUESTER }), "Not the seal owner"));
await world();
eq("unseal-artifact, moved page, the owner: still the owner's to release", (await as(sealing.get("unseal-artifact"), OWNER, { attachmentId: "att-moved" }))?.success, true);

// ── section seals ──────────────────────────────────────────────────────────────────────────────
for (const [who, acct] of [["admin of the old space", ADMIN_A], ["admin of the new space only", ADMIN_B]]) {
  await world();
  eq(`unseal-section, moved page, ${who}: refused`, (await as(sections.get("unseal-section"), acct, { sectionId: "sec-moved", reason: REASON }))?.success, false);
  ok(`unseal-section, moved page, ${who}: seal kept`, !!(await kvs.get("section-protection-sec-moved")));
  ok(`extend-section, moved page, ${who}: refused`, said(await as(sections.get("extend-section"), acct, { sectionId: "sec-moved", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));
  ok(`list-section-edit-grants, moved page, ${who}: refused`, said(await as(editreq.get("list-section-edit-grants"), acct, { sectionId: "sec-moved" }), "Not authorized"));
}
await world();
ok("extend-section, moved page, admin of both: allowed", !said(await as(sections.get("extend-section"), ADMIN_AB, { sectionId: "sec-moved", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));
await world();
ok("extend-section, unmoved page, admin of its space: allowed (control)", !said(await as(sections.get("extend-section"), ADMIN_A, { sectionId: "sec-stay", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));

// ── a failed lookup of where the page is denies; it never falls back to the stored space ──────
await world();
onConfluence((method, rawPath) => (/^\/wiki\/api\/v2\/pages\/5001$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
eq("remove-workflow, page lookup failing, admin of the stored space: refused", (await as(workflow.get("remove-workflow"), ADMIN_A, { pageId: MOVED }))?.success, false);


// ── more record paths (each in its own world) ─────────────────────────────────────────────────
await world(); await pendingOn(MOVED);
{ const r = await as(workflow.get("rerequest-approval"), ADMIN_A, { pageId: MOVED }); ok("rerequest-approval, moved page, admin of the old space: refused", r?.success === false); }
await world(); await pendingOn(MOVED);
ok("rerequest-approval, moved page, admin of both: allowed", !said(await as(workflow.get("rerequest-approval"), ADMIN_AB, { pageId: MOVED }), "Only an approver, the requester or a space admin"));
await world(); await pendingOn(MOVED);
eq("withdraw-approval, moved page, admin of the new space only: refused", (await as(workflow.get("withdraw-approval"), ADMIN_B, { pageId: MOVED }))?.success, false);
await world();
ok("purge-seal-record, moved page, admin of the old space: refused", said(await as(sealing.get("purge-seal-record"), ADMIN_A, { attachmentId: "att-moved" }), "Only the seal owner or a space admin can purge"));
ok("purge-seal-record, moved page, admin of the old space: seal kept", !!(await kvs.get("protection-att-moved")));
await world();
ok("purge-seal-record, moved page, admin of both: allowed", !said(await as(sealing.get("purge-seal-record"), ADMIN_AB, { attachmentId: "att-moved" }), "Only the seal owner or a space admin can purge"));
// restore: nobody here may edit the moved page, so only the owner or a steward of the record restores
const noEdits = () => onConfluence((method, rawPath, body) => (/\/content\/[^/]+\/permission\/check$/.test(decodeURIComponent(rawPath).split("?")[0]) && body?.operation === "update" ? { body: { hasPermission: false } } : undefined));
await world(); noEdits();
ok("restore-sealed-artifact, moved page, admin of the old space: refused", said(await as(sealing.get("restore-sealed-artifact"), ADMIN_A, { attachmentId: "att-trashed" }), "You do not have permission to restore this file"));
await world(); noEdits();
ok("restore-sealed-artifact, moved page, admin of both: allowed", !said(await as(sealing.get("restore-sealed-artifact"), ADMIN_AB, { attachmentId: "att-trashed" }), "You do not have permission to restore this file"));
await world();
ok("deny-edit-request, moved page, admin of the old space: refused", said(await as(editreq.get("deny-edit-request"), ADMIN_A, { attachmentId: "att-moved", requesterAccountId: REQUESTER }), "Not the seal owner"));
await world();
ok("approve-section-edit, moved page, admin of the old space: refused", said(await as(editreq.get("approve-section-edit"), ADMIN_A, { sectionId: "sec-moved", requesterAccountId: REQUESTER }), "Not the section owner"));
await world();
ok("deny-section-edit, moved page, admin of the old space: refused", said(await as(editreq.get("deny-section-edit"), ADMIN_A, { sectionId: "sec-moved", requesterAccountId: REQUESTER }), "Not the section owner"));
await world();
ok("list-section-edit-requests, moved page, admin of the old space: refused", said(await as(editreq.get("list-section-edit-requests"), ADMIN_A, { sectionId: "sec-moved" }), "Not authorized"));
await world();
ok("approve-section-edit, moved page, admin of both: allowed", !said(await as(editreq.get("approve-section-edit"), ADMIN_AB, { sectionId: "sec-moved", requesterAccountId: REQUESTER }), "Not the section owner"));

// A seal's page is the one its file is on NOW, not the page its record names.
await world();
ok("extend-seal, record names another page, file on the moved page, admin of the old space: refused", said(await as(sealing.get("extend-seal"), ADMIN_A, { attachmentId: "att-misfiled", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));
await world();
ok("extend-seal, record names another page, file on the moved page, admin of both: allowed", !said(await as(sealing.get("extend-seal"), ADMIN_AB, { attachmentId: "att-misfiled", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));

// ── a moved page's workflow holds still; its rules are the old space's ──────────────────────
const FROZEN = "moved to another space after its workflow started";
await world();
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: [{ id: ADMIN_A, type: "user", name: "A" }], mode: "any" } });
ok("request-transition, moved page, an editor: held until re-assigned", said(await as(workflow.get("request-transition"), PLAIN, { pageId: MOVED, toStateId: APPROVED }), FROZEN));
ok("request-transition, moved page, an editor: no request opened for the old space's approvers", !(await kvs.get(`workflow-pending-${MOVED}`)));
await world();
ok("request-transition, moved page, admin of the old space: held", said(await as(workflow.get("request-transition"), ADMIN_A, { pageId: MOVED, toStateId: DRAFT === "draft" ? "in_review" : DRAFT }), FROZEN));
await world();
ok("request-transition, moved page, admin of both: not held", !said(await as(workflow.get("request-transition"), ADMIN_AB, { pageId: MOVED, toStateId: "in_review" }), FROZEN));
await world();
ok("request-transition, unmoved page, an editor: not held (control)", !said(await as(workflow.get("request-transition"), PLAIN, { pageId: STAY, toStateId: "in_review" }), FROZEN));
// The old space switches Approved off in its own definition: the moved page stays protected.
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => ({ ...st, enforce: false })) });
const unlocked = await collectWorkflowEnforcementForPage(MOVED, PLAIN, 4, "app-account");
ok("page trigger, moved Approved page, old space unlocks Approved: an editor's edit is still enforced", unlocked != null && unlocked.action !== "privileged");
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => ({ ...st, enforce: false })) });
eq("privilege, moved Approved page, old space unlocks Approved: still enforced", (await workflowPrivilegeForPage(MOVED, PLAIN))?.enforced, true);
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => ({ ...st, enforce: false })) });
eq("page trigger, unmoved page whose space unlocked Approved: not enforced (control)", await collectWorkflowEnforcementForPage(STAY, PLAIN, 4, "app-account"), null);

// ── a failed lookup never demotes or undoes a steward's edit ─────────────────────────────────
const outage = () => onConfluence((method, rawPath) => (/^\/wiki\/api\/v2\/(pages|blogposts)\/\d+$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
await world({ stateId: APPROVED }); outage();
eq("page trigger, lookup failing, steward edits the unmoved Approved page: not judged (no demote)", (await collectWorkflowEnforcementForPage(STAY, ADMIN_A, 4, "app-account"))?.action, "unknown");
eq("page trigger, lookup failing: the page is still Approved", (await kvs.get(`workflow-state-${STAY}`))?.stateId, APPROVED);
await world({ stateId: APPROVED }); outage();
eq("page trigger, lookup failing but the event names the space: a privileged edit", (await collectWorkflowEnforcementForPage(STAY, ADMIN_A, 4, "app-account", "AAA"))?.action, "privileged");


// ── round 2: nothing moves a moved page's workflow; outages never cost an approver ────────────
const HOLD = "moved to another space after its workflow started";
// A request opened in the old space before the move, decided after it by a LISTED approver.
await world(); await pendingOn(MOVED);
{ const r = await as(workflow.get("decide-approval"), "acct-listed", { pageId: MOVED, decision: "approved" }); ok("decide-approval, moved page, a listed approver approves: held", said(r, HOLD)); }
ok("decide-approval, moved page, a listed approver approves: the page did not move", (await kvs.get(`workflow-state-${MOVED}`))?.stateId === DRAFT);
await world(); await pendingOn(MOVED);
ok("decide-approval, moved page, a listed approver declines: a no is still taken", !said(await as(workflow.get("decide-approval"), "acct-listed", { pageId: MOVED, decision: "denied", reason: "no" }), HOLD));
await world(); await pendingOn(STAY);
ok("decide-approval, unmoved page, a listed approver approves: not held (control)", !said(await as(workflow.get("decide-approval"), "acct-listed", { pageId: STAY, decision: "approved" }), HOLD));
await world(); await pendingOn(MOVED);
ok("rerequest-approval, moved page, a listed approver: held", said(await as(workflow.get("rerequest-approval"), "acct-listed", { pageId: MOVED }), HOLD));
// An AI verdict completing the request after the move.
await world(); await pendingOn(MOVED);
{ const p = await kvs.get(`workflow-pending-${MOVED}`); await kvs.set(`workflow-pending-${MOVED}`, { ...p, approvers: [], aiGate: { required: true, status: "pending" } }); }
{ const rec = await kvs.get(`workflow-state-${MOVED}`); await kvs.set(`workflow-state-${MOVED}`, { ...rec, stateId: "in_review" }); }
const ai = await applyAiVerdict(MOVED, 3, "passed", "ok");
ok("AI verdict on a moved page: does not move it", ai?.transitioned !== true && (await kvs.get(`workflow-state-${MOVED}`))?.stateId === "in_review");
await world(); await pendingOn(STAY);
{ const p = await kvs.get(`workflow-pending-${STAY}`); await kvs.set(`workflow-pending-${STAY}`, { ...p, approvers: [], aiGate: { required: true, status: "pending" } }); const rec = await kvs.get(`workflow-state-${STAY}`); await kvs.set(`workflow-state-${STAY}`, { ...rec, stateId: "in_review" }); }
eq("AI verdict on an unmoved page: completes (control)", (await applyAiVerdict(STAY, 3, "passed", "ok"))?.transitioned, true);
// A proposal accepted after the move (the page is Approved, the seal held by the approval).
await world({ stateId: APPROVED });
{ const sr = await kvs.get("protection-att-moved"); await kvs.set("protection-att-moved", { ...sr, workflowHeld: { pageId: MOVED, stateId: APPROVED } }); }
await kvs.set("edit-request-att-moved-" + REQUESTER, { requesterAccountId: REQUESTER, requesterName: "Req", status: "pending", proposal: true, approvers: ["acct-listed"], requestedAt: "2026-10-02T00:00:00.000Z" });
{ const ws = await kvs.get("workflow-settings-AAA"); await kvs.set("workflow-settings-AAA", { ...ws, approval: { approvers: [{ id: "acct-listed", type: "user", name: "Listed" }], mode: "any" } }); }
ok("approve-edit-request (a proposal), moved page, a listed approver: held", said(await as(editreq.get("approve-edit-request"), "acct-listed", { attachmentId: "att-moved", requesterAccountId: REQUESTER }), HOLD));
ok("approve-edit-request (a proposal), moved page: still Approved", (await kvs.get(`workflow-state-${MOVED}`))?.stateId === APPROVED);
// The old space empties Approved's exits (demote cannot apply): a moved page is reverted instead.
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => (st.id === APPROVED ? { ...st, transitions: [] } : st)) });
eq("page trigger, moved Approved page, an editor's edit: reverted, whatever the old space's mode", (await collectWorkflowEnforcementForPage(MOVED, PLAIN, 4, "app-account"))?.action, "revert");
// An outage of the page lookup never costs an approver; a steward is "unknown" (nothing done).
async function approvedWithApprover(pageId) {
  const r = await kvs.get(`workflow-state-${pageId}`); await kvs.set(`workflow-state-${pageId}`, { ...r, approvers: ["acct-listed"] });
  await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: [{ id: "acct-listed", type: "user", name: "Listed" }], mode: "any" } });
}
await world({ stateId: APPROVED }); await approvedWithApprover(STAY); outage();
eq("page trigger, lookup failing, a listed approver's edit: privileged", (await collectWorkflowEnforcementForPage(STAY, "acct-listed", 4, "app-account"))?.action, "privileged");
eq("privilege, lookup failing, a listed approver: privileged", (await workflowPrivilegeForPage(STAY, "acct-listed"))?.privileged, true);
eq("privilege, lookup failing, a steward: not privileged (cannot be judged)", (await workflowPrivilegeForPage(STAY, ADMIN_A))?.privileged, false);
// Re-assigning is refused while Approved or while a request waits (it would strand the held seals).
await world({ stateId: APPROVED });
eq("assign-workflow, Approved page, admin of both: refused (move it out of Approved first)", (await as(workflow.get("assign-workflow"), ADMIN_AB, { pageId: MOVED }))?.success, false);
await world({ stateId: APPROVED });
eq("assign-workflow, unmoved Approved page, admin of its space: refused too", (await as(workflow.get("assign-workflow"), ADMIN_A, { pageId: STAY }))?.success, false);
await world(); await pendingOn(MOVED);
eq("assign-workflow, open request, admin of both: refused", (await as(workflow.get("assign-workflow"), ADMIN_AB, { pageId: MOVED }))?.success, false);
// The banner offers no move on a held page.
await world();
{ const g = await as(workflow.get("get-page-workflow"), PLAIN, { pageId: MOVED }, onMoved); ok("get-page-workflow, moved page, an editor: no moves offered", g?.movedHold === true && (g?.available || []).length === 0); }
{ const g = await as(workflow.get("get-page-workflow"), ADMIN_AB, { pageId: MOVED }, onMoved); ok("get-page-workflow, moved page, admin of both: moves offered", (g?.available || []).length > 0); }
// A failed read of where a seal's file is denies the steward arm (never the record's page alone).
await world();
onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/api/v2/attachments/att-moved" ? { status: 503, body: {} } : undefined));
ok("extend-seal, file read failing, admin of both: refused (cannot be judged)", said(await as(sealing.get("extend-seal"), ADMIN_AB, { attachmentId: "att-moved", additionalSeconds: 3600 }), "Only the seal owner or a space admin"));

// ── round 3: the words follow the engine; nothing strands held seals; outages consume nothing ──
await world({ stateId: APPROVED });
eq("get-page-workflow, moved Approved page: says edits are undone (the engine reverts a moved page)", (await as(workflow.get("get-page-workflow"), PLAIN, { pageId: MOVED }, onMoved))?.enforceMode, "revert");
await world({ stateId: APPROVED });
eq("get-page-workflow, unmoved Approved page: the space's own mode (control)", (await as(workflow.get("get-page-workflow"), PLAIN, { pageId: STAY }, { content: { id: STAY, space: { key: "AAA" } } }))?.enforceMode, "demote");
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => ({ ...st, enforce: false })) });
eq("remove-workflow, Approved record whose definition was unlocked since, admin of both: refused", (await as(workflow.get("remove-workflow"), ADMIN_AB, { pageId: MOVED }))?.success, false);
await world({ stateId: APPROVED });
await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, states: DEFAULT_WORKFLOW.states.map((st) => ({ ...st, enforce: false })) });
eq("remove-workflow, unmoved Approved record whose definition was unlocked since: refused too", (await as(workflow.get("remove-workflow"), ADMIN_A, { pageId: STAY }))?.success, false);
await world(); await pendingOn(STAY);
{ const p = await kvs.get(`workflow-pending-${STAY}`); await kvs.set(`workflow-pending-${STAY}`, { ...p, approvers: [], aiGate: { required: true, status: "pending" } }); const rec = await kvs.get(`workflow-state-${STAY}`); await kvs.set(`workflow-state-${STAY}`, { ...rec, stateId: "in_review" }); }
onConfluence((method, rawPath) => (/^\/wiki\/api\/v2\/spaces\/\d+$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
const aiOut = await applyAiVerdict(STAY, 3, "passed", "ok");
ok("AI verdict during a space-read outage: not applied", aiOut?.applied === false);
eq("AI verdict during a space-read outage: the request still waits for it", (await kvs.get(`workflow-pending-${STAY}`))?.aiGate?.status, "pending");
async function overdue(pageId) { const r = await kvs.get(`workflow-state-${pageId}`); await kvs.set(`workflow-state-${pageId}`, { ...r, reviewDueAt: "2026-01-01T00:00:00.000Z" }); }
await world({ stateId: APPROVED }); await overdue(MOVED); await overdue(STAY);
await workflowSweep();
eq("hourly sweep, moved Approved page past its review date: not moved", (await kvs.get(`workflow-state-${MOVED}`))?.stateId, APPROVED);
ok("hourly sweep, unmoved Approved page past its review date: expired (control)", (await kvs.get(`workflow-state-${STAY}`))?.stateId !== APPROVED);

{ const trig = readFileSync(new URL("../src/server/triggers.js", import.meta.url), "utf8");
  ok("page trigger: an \"unknown\" probe stands the seal passes down (no write carries an unjudged version)", /judgeLater = lateForLiveBody \|\| enforcement\?\.action === "unknown"/.test(trig) && (trig.match(/!judgeLater &&/g) || []).length === 3 && !/!lateForLiveBody &&/.test(trig)); }

// ── round 4: a pass still waiting for the humans is recorded; an outage posts no overdue notice ──
await world(); await pendingOn(STAY);
{ const p = await kvs.get(`workflow-pending-${STAY}`); await kvs.set(`workflow-pending-${STAY}`, { ...p, aiGate: { required: true, status: "pending" } }); const rec = await kvs.get(`workflow-state-${STAY}`); await kvs.set(`workflow-state-${STAY}`, { ...rec, stateId: "in_review" }); }
onConfluence((method, rawPath) => (/^\/wiki\/api\/v2\/spaces\/\d+$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
const aiWait = await applyAiVerdict(STAY, 3, "passed", "ok");
ok("AI pass during an outage, humans still to vote: recorded and waiting", aiWait?.applied === true && aiWait?.waiting === "humans");
eq("AI pass during an outage, humans still to vote: the gate reads passed", (await kvs.get(`workflow-pending-${STAY}`))?.aiGate?.status, "passed");
await world({ stateId: APPROVED });
{ const r = await kvs.get(`workflow-state-${STAY}`); await kvs.set(`workflow-state-${STAY}`, { ...r, reviewDueAt: "2026-01-01T00:00:00.000Z" }); }
onConfluence((method, rawPath) => (/^\/wiki\/api\/v2\/spaces\/\d+$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
const sw = await workflowSweep();
ok("hourly sweep during an outage, page past its review date: no overdue notice this tick", !(await kvs.get(`workflow-review-notified-${STAY}`)));
eq("hourly sweep during an outage: the page is left as it was", (await kvs.get(`workflow-state-${STAY}`))?.stateId, APPROVED);

// ── the old space's Seals tab and new activity ───────────────────────────────────────────────
await world();
const tab = await as(realms.get("enumerate-realm-seals"), ADMIN_A, { spaceKey: "AAA" });
ok("old space's Seals tab: the moved page's seal is not listed", !said(tab?.attachments, "att-moved"));
ok("old space's Seals tab: the unmoved page's seal is listed (control)", said(tab?.attachments, "att-stay"));
await world();
await recordActivity({ type: "seal.created", pageId: MOVED, spaceKey: "AAA", actor: { accountId: OWNER, name: "Owner" }, target: { kind: "attachment", id: "att-moved", name: "moved.pdf" }, details: {}, version: null });
const actKeys = [...fake.kvs.keys()];
ok("new activity on the moved page: filed under the space it is in now", actKeys.some((k) => k.startsWith(activitySpacePrefix("BBB"))));
ok("new activity on the moved page: not filed under the space it left", !actKeys.some((k) => k.startsWith(activitySpacePrefix("AAA"))));
await recordActivity({ type: "seal.created", pageId: STAY, spaceKey: "AAA", actor: { accountId: OWNER, name: "Owner" }, target: { kind: "attachment", id: "att-stay", name: "stay.pdf" }, details: {}, version: null });
ok("activity on an unmoved page: its own space (control)", [...fake.kvs.keys()].some((k) => k.startsWith(activitySpacePrefix("AAA"))));

// ── ONE rule: no steward check on a stored record's space alone ──────────────────────────────
// Every steward check about a record goes through content-access.js isStewardOfRecord /
// isStewardOfSpaces. In the files that only handle records there is no direct check at all; in
// workflow/actions.js only the resolvers about a SPACE (settings, definitions, pickers, dashboard,
// bulk apply) call one directly.
const SRC = fileURLToPath(new URL("../src/server/", import.meta.url));
const DIRECT = /\b(authorizeSteward|isAccountStewardAsApp|isOperatorSteward|isOperatorRealmSteward)\(/;
const RECORD_ONLY = ["capsules/editreq/actions.js", "capsules/section-seals/actions.js", "capsules/sealing/actions.js", "capsules/workflow/approvals.js", "capsules/workflow/privilege.js", "triggers.js"];
const strict = RECORD_ONLY.flatMap((f) => readFileSync(SRC + f, "utf8").split("\n").map((l, i) => [f, i + 1, l]).filter(([, , l]) => DIRECT.test(l) && !/^\s*(\/\/|\*)/.test(l))).map(([f, n]) => `${f}:${n}`);
eq("record-only files: no direct steward check", strict, []);
const SPACE_RESOLVERS = new Set(["mayUseApproverPicker", "loadConfig", "storeConfig", "listSpaceWorkflowsAction", "storeSpaceWorkflowAction", "saveWorkflowBundleAction", "deleteSpaceWorkflowAction", "getSpaceSettings", "setSpaceSettings", "bulkAssign", "getWorkflowDashboard"]);
const wfLines = readFileSync(SRC + "capsules/workflow/actions.js", "utf8").split("\n");
let fnName = null; const wfOff = [];
wfLines.forEach((l, i) => {
  const m = l.match(/^(?:export\s+)?(?:const\s+(\w+)\s*=\s*async|async\s+function\s+(\w+)|function\s+(\w+))/);
  if (m) fnName = m[1] || m[2] || m[3];
  if (DIRECT.test(l) && !/^\s*(\/\/|\*)/.test(l) && !SPACE_RESOLVERS.has(fnName)) wfOff.push(`${fnName}:${i + 1}`);
});
eq("workflow/actions.js: direct steward checks only in the space resolvers", wfOff, []);
const files = [];
(function walk(dir) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } })(SRC);
const STORED = /\b(authorizeSteward|isAccountStewardAsApp|isOperatorSteward)\(\s*[\w.?]+\s*,\s*(\w+\??\.spaceKey|objectSpaceKey|effectiveRealmKey|restoreRealmKey)\s*\)/;
const offenders = files.flatMap((p) => readFileSync(p, "utf8").split("\n").map((l, i) => [p, i + 1, l]).filter(([, , l]) => STORED.test(l))).map(([p, n]) => `${p.split("/src/")[1]}:${n}`);
eq("no steward check on a stored record's space alone, anywhere", offenders, []);

report("record-space-authz");
