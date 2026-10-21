// Restoring a file from the trash and deleting one permanently from the Sentinel Vault panel
// ("Allow Attachment Restore from Page" / "Allow Seal Cleanup from Page") follow Confluence's own
// trash rights for the person asking.
//
// Confluence (developer.atlassian.com, REST v2 "Delete attachment"): purging a trashed attachment
// needs view access to its container, the right to delete attachments in the space AND the space's
// `manage/content` permission; the space trash (restore / purge) is a space-admin task
// (support.atlassian.com "Delete, restore, or purge a page"). The rule under test: the call that
// changes trash state is made with the caller's own rights (asUser), so Confluence decides; Sentinel
// Vault's own gate (seal owner, its Space admins list, an editor of the page) is a floor on top. An
// answer that is not a clear yes (429, a thrown call, an unreadable probe, an unproven "gone")
// changes nothing.
//
// The fake answers like Confluence: the app's identity may read and write everything, a person only
// what the scenario grants them (TRASH_ADMINS = manage/content on the space).
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const sealingMod = await import("../src/server/capsules/sealing/actions.js");
const sealing = new Map(sealingMod.actions);
sealingMod.setPurgeSettleMs(0); // the two-witness re-check without its production settle delay
const { busyAware } = await import("../src/server/registry.js");
const { artifactEventTrigger, sweepRestoreRechecks, restoreMediaPass } = await import("../src/server/triggers.js");
const { runInvocation, noteAuthzUnknown } = await import("../src/server/shared/confluence-call.js");
const panels = new Map((await import("../src/server/capsules/panels/actions.js")).actions);
const { control } = await import("../src/server/capsules/policies/settings-schema.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const SPACE = { key: "TRS", id: "301" };
const PAGE = "6001";
const OWNER = "acct-owner-plain";     // an ordinary editor who sealed (or deleted) the file
const SV_STEWARD = "acct-sv-steward"; // on Sentinel Vault's Space admins list, NOT a Confluence space admin
const CONF_ADMIN = "acct-conf-admin"; // Confluence space admin (manage/content): Confluence lets them
const EDITOR = "acct-editor";         // may edit the page, nothing else
const OUTSIDER = "acct-outsider";     // may not even edit the page

let att; // id -> { status, title, pageId, version }
let TRASH_ADMINS; // people Confluence lets restore/purge in the space (manage/content)
let SPACE_ADMINS; // administer/space rows (Sentinel Vault counts these as space admins)
let EDITORS;
let override; // (method, base, who) -> response spec | undefined, checked first
let pageListBroken = false;
let nameTaken = new Set(); // titles a newer file on the page already holds
async function world({ status = "trashed", record = "seal" } = {}) {
  resetFake();
  att = { "att1": { status, title: "plan.pdf", pageId: PAGE, version: 2, fileId: "f1", files: {} } }; // files: version -> fileId of an upload
  TRASH_ADMINS = new Set([CONF_ADMIN]);
  SPACE_ADMINS = new Set([CONF_ADMIN]);
  EDITORS = new Set([OWNER, SV_STEWARD, CONF_ADMIN, EDITOR]);
  override = () => undefined;
  pageListBroken = false;
  nameTaken = new Set();
  onConfluence((method, rawPath, body, who) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    const o = override(method, base, who, qs);
    if (o) return o;
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") { const a = qs.get("accountId"); return { body: { accountId: a, displayName: a, groups: { results: [] }, operations: [] } }; }
    if (/^\/wiki\/rest\/api\/space\/[^/]+\/permission\/check$/.test(base)) return { status: 405, body: {} };
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/([^/]+)\/permission\/check$/))) {
      const subject = body?.subject?.identifier;
      if (body?.operation === "update") return { body: { hasPermission: m[1] === PAGE && EDITORS.has(subject) } };
      return { body: { hasPermission: true } };
    }
    if (base === "/wiki/api/v2/spaces") return { body: { results: qs.get("keys") === SPACE.key ? [{ id: SPACE.id, key: SPACE.key }] : [] } };
    if (base === `/wiki/api/v2/spaces/${SPACE.id}/permissions`) {
      return { body: { results: [...SPACE_ADMINS].map((id) => ({ id: `a-${id}`, principal: { type: "user", id }, operation: { key: "administer", targetType: "space" } })), _links: {} } };
    }
    if (base === `/wiki/api/v2/spaces/${SPACE.id}`) return { body: { id: SPACE.id, key: SPACE.key } };
    if (base === `/wiki/api/v2/pages/${PAGE}/attachments`) {
      if (pageListBroken) return { status: 503, body: {} };
      return { body: { results: Object.entries(att).filter(([, a]) => a.pageId === PAGE).map(([id, a]) => ({ id, status: a.status, title: a.title })), _links: {} } };
    }
    if (base === `/wiki/api/v2/pages/${PAGE}`) return { body: { id: PAGE, status: "current", title: "Plan", spaceId: SPACE.id, version: { number: 4 } } };
    if ((m = base.match(/^\/wiki\/api\/v2\/attachments\/([^/]+)$/))) {
      const a = att[m[1]];
      if (method === "GET" && a && qs.get("version")) { const v = Number(qs.get("version")); return v <= a.version ? { body: { id: m[1], status: a.status, title: a.title, pageId: a.pageId, fileId: a.files[v] || "f1", version: { number: v } } } : { status: 404 }; }
      if (method === "GET") return a ? { body: { id: m[1], status: a.status, title: a.title, pageId: a.pageId, fileId: a.files[a.version] || a.fileId, version: { number: a.version } } } : { status: 404 };
      if (method === "DELETE") {
        if (!a) return { status: 404 };
        const purge = qs.get("purge") === "true";
        // A person who cannot see the file's container gets 404, like Confluence.
        if (who === "user" && !EDITORS.has(currentCaller)) return { status: 404 };
        if (purge) {
          if (a.status !== "trashed") return { status: 400, body: { message: "not trashed" } };
          if (who === "user" && !TRASH_ADMINS.has(currentCaller)) return { status: 403, body: { message: "Not permitted to purge" } };
          delete att[m[1]];
          return { status: 204 };
        }
        a.status = "trashed"; a.version += 1;
        return { status: 204 };
      }
    }
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/([^/]+)\/child\/attachment\/([^/]+)$/)) && method === "PUT") {
      const a = att[m[2]];
      if (!a) return { status: 404 };
      // (The name clash is answered first here, so the rename-then-refused path can be driven.)
      if (body.status === "current" && nameTaken.has(body.title)) return { status: 409, body: { message: `newer Content exists in the same container with title ${body.title}` } };
      if (a.status === "trashed" && body.status !== "current") return { status: 404, body: { message: "Trashed content cannot be updated, you need to restore it first by setting its status to current." } };
      if (who === "user" && !TRASH_ADMINS.has(currentCaller)) return { status: 403, body: { message: "Not permitted to restore" } };
      a.status = body.status; // measured: a restore keeps the version number and the fileId
      return { body: { id: m[2], status: a.status, title: a.title, version: { number: a.version } } };
    }
    if (method !== "GET") return { body: {} };
    return undefined;
  });
  await kvs.set("admin-settings-global", { allowAdminOverride: true, allowSealPurge: true, allowSealRestore: true, allowArtifactDelete: true });
  await kvs.set(`admin-settings-space-${SPACE.key}`, { adminUsers: [{ accountId: SV_STEWARD }] });
  if (record === "seal") {
    await kvs.set("protection-att1", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: SPACE.key, spaceId: SPACE.id, contentId: PAGE, attachmentId: "att1", attachmentName: "plan.pdf", timestamp: "2026-10-01T00:00:00.000Z" });
  } else if (record === "trashedOnly") {
    // The tracking record the panel's Delete writes (its lockedBy is the person who deleted the file).
    await kvs.set("protection-att1", { lockedBy: OWNER, contentId: PAGE, spaceKey: SPACE.key, spaceId: SPACE.id, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedBy: OWNER, trashedAt: "2026-10-01T00:00:00.000Z", trashedFromPage: PAGE });
  }
}
// The fake's asUser carries no identity, so the scenario names who is calling.
let currentCaller = null;
const as = async (fn, accountId, payload) => { currentCaller = accountId; try { return await fn({ payload, context: { accountId, extension: {} } }); } finally { currentCaller = null; } };
const restore = (who) => as(sealing.get("restore-sealed-artifact"), who, { attachmentId: "att1" });
const purge = (who) => as(sealing.get("purge-seal-record"), who, { attachmentId: "att1" });
const said = (r, s) => JSON.stringify(r ?? null).includes(s);
const writes = (re) => fake.calls.filter((c) => c.method !== "GET" && re.test(decodeURIComponent(c.path)));
const PURGE_CALL = /\/wiki\/api\/v2\/attachments\/att1\?purge=true/;
const RESTORE_CALL = /\/child\/attachment\/att1$/;

// ── purge: an ordinary seal owner Confluence does not let purge ───────────────────────────────
for (const [label, record] of [["seal owner", "seal"], ["the person who deleted it from the panel", "trashedOnly"]]) {
  await world({ record });
  const r = await purge(OWNER);
  eq(`purge, ${label} without Confluence's trash rights: refused`, r?.success, false);
  ok(`purge, ${label}: the refusal names Confluence`, said(r, "Confluence does not let you permanently delete this file"));
  ok(`purge, ${label}: the file is still in the trash`, att.att1?.status === "trashed");
  ok(`purge, ${label}: the record is kept`, !!(await kvs.get("protection-att1")));
  eq(`purge, ${label}: no purge call with the app's rights`, writes(PURGE_CALL).filter((c) => c.who === "app").length, 0);
}

// ── purge: on Sentinel Vault's Space admins list, not a Confluence space admin ────────────────
await world();
{
  const r = await purge(SV_STEWARD);
  eq("purge, Sentinel Vault space admin only: refused", r?.success, false);
  ok("purge, Sentinel Vault space admin only: Confluence's refusal", said(r, "Confluence does not let you permanently delete this file"));
  ok("purge, Sentinel Vault space admin only: file still in the trash", att.att1?.status === "trashed");
  ok("purge, Sentinel Vault space admin only: record kept", !!(await kvs.get("protection-att1")));
}

// ── purge: a Confluence space admin keeps what Confluence gives them ───────────────────────────
await world();
{
  const r = await purge(CONF_ADMIN);
  eq("purge, Confluence space admin: done", r?.success, true);
  ok("purge, Confluence space admin: file gone", !att.att1);
  ok("purge, Confluence space admin: record removed", !(await kvs.get("protection-att1")));
  eq("purge, Confluence space admin: the purge ran with the caller's rights", writes(PURGE_CALL).map((c) => c.who), ["user"]);
}

// ── purge: Sentinel Vault's floor still narrows (an outsider Confluence would let is not enough) ──
await world();
TRASH_ADMINS.add(EDITOR); // manage/content without administer: Confluence would let them purge, but Sentinel Vault's floor (owner or steward) does not
{
  const r = await purge(EDITOR);
  eq("purge, not owner or steward (floor): refused", r?.success, false);
  ok("purge, not owner or steward: file kept", att.att1?.status === "trashed");
}

// ── purge: answers that are not a yes change nothing ───────────────────────────────────────────
await world();
override = (method, base) => (method === "GET" && base === "/wiki/api/v2/attachments/att1" ? { status: 429, headers: { "Retry-After": "60" } } : undefined);
{
  const r = await purge(CONF_ADMIN);
  eq("purge, file status unreadable (429): refused", r?.success, false);
  ok("purge, file status unreadable: record kept", !!(await kvs.get("protection-att1")));
  eq("purge, file status unreadable: nothing deleted", writes(PURGE_CALL).length, 0);
}
await world();
override = (method, base, who) => (method === "DELETE" && who === "user" ? { status: 429, headers: { "Retry-After": "30" } } : undefined);
{
  const r = await purge(CONF_ADMIN);
  eq("purge, Confluence busy on the delete: refused", r?.success, false);
  ok("purge, Confluence busy: says it is busy", r?.busy === true && said(r, "Confluence is limiting requests"));
  ok("purge, Confluence busy: record kept", !!(await kvs.get("protection-att1")));
  ok("purge, Confluence busy: file still in the trash", att.att1?.status === "trashed");
}
await world();
override = (method, base, who) => (method === "DELETE" && who === "user" ? { status: 404 } : undefined);
{
  const r = await purge(CONF_ADMIN);
  eq("purge, caller's delete answers 404 but the file is there: refused", r?.success, false);
  ok("purge, 404 for the caller only: record kept", !!(await kvs.get("protection-att1")));
}
await world();
{
  // The caller's delete answers 404 because someone purged it a moment ago: the record goes.
  override = (method, base, who) => {
    if (method === "DELETE" && who === "user") { delete att.att1; return { status: 404 }; }
    return undefined;
  };
  const r = await purge(CONF_ADMIN);
  eq("purge, file purged meanwhile: records cleaned", r?.success, true);
  ok("purge, file purged meanwhile: record removed", !(await kvs.get("protection-att1")));
}
await world();
{
  const { default: api } = await import("@forge/api");
  const real = api.asUser;
  api.asUser = () => { throw new Error("no user context"); };
  try {
    const r = await purge(CONF_ADMIN);
    eq("purge, no user context: refused", r?.success, false);
    ok("purge, no user context: record kept", !!(await kvs.get("protection-att1")));
    ok("purge, no user context: file kept", att.att1?.status === "trashed");
  } finally { api.asUser = real; }
}

// ── purge: a file that is not in the trash is not deleted from here ────────────────────────────
await world({ status: "current" });
{
  const r = await purge(CONF_ADMIN);
  eq("purge, file not in the trash: refused", r?.success, false);
  ok("purge, file not in the trash: still current", att.att1?.status === "current");
  eq("purge, file not in the trash: no delete call at all", writes(/\/attachments\/att1/).length, 0);
  ok("purge, file not in the trash: record kept", !!(await kvs.get("protection-att1")));
}

// ── seal cleanup: the file is already gone, only the app's own records go ──────────────────────
// A tracking row names the page the file was deleted from (its current container): the page's list
// answering without the file proves it is gone.
await world({ record: "trashedOnly" });
delete att.att1;
{
  const r = await purge(OWNER);
  eq("cleanup, file already purged (tracking row): done", r?.success, true);
  ok("cleanup, file already purged: record removed", !(await kvs.get("protection-att1")));
  eq("cleanup, file already purged: no Confluence write", writes(/\/attachments\/att1/).length, 0);
}
// A tracking row whose page did not come from the attachment itself (the deleter's context page)
// proves nothing either.
await world();
await kvs.set("protection-att1", { lockedBy: OWNER, contentId: PAGE, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedBy: OWNER, trashedAt: "2026-10-01T00:00:00.000Z" });
delete att.att1;
{
  const r = await purge(OWNER);
  eq("cleanup, tracking row with only a display page: refused", r?.success, false);
  ok("cleanup, display page only: record kept", !!(await kvs.get("protection-att1")));
}
// A live seal names the page it was sealed on; the file may have moved to a page the app cannot see
// since, and that page's list proves nothing.
await world();
delete att.att1;
{
  const r = await purge(OWNER);
  eq("cleanup, live seal whose file the app no longer sees: refused", r?.success, false);
  ok("cleanup, live seal: says it cannot be cleared from here", said(r, "cannot confirm where it went") && said(r, "Nothing was changed"));
  ok("cleanup, live seal: record kept", !!(await kvs.get("protection-att1")));
}
{
  const { confirmAttachmentPurged } = await import("../src/server/infra/attachment-status.js");
  eq("confirmAttachmentPurged, list witness on a page not known to be current: not gone", await confirmAttachmentPurged("att1", 0, { pageId: PAGE }), false);
  eq("confirmAttachmentPurged, list witness on the current page: gone", await confirmAttachmentPurged("att1", 0, { pageId: PAGE, containerCurrent: true }), true);
}

// ── one 404 is not proof: the page's own list still carries the file ───────────────────────────
await world();
override = (method, base) => (method === "GET" && base === "/wiki/api/v2/attachments/att1" ? { status: 404 } : undefined);
{
  const r = await purge(OWNER);
  eq("cleanup, a stray 404 while the page still lists the file: refused", r?.success, false);
  ok("cleanup, a stray 404: record kept", !!(await kvs.get("protection-att1")));
}
await world();
delete att.att1;
pageListBroken = true;
{
  const r = await purge(OWNER);
  eq("cleanup, 404 but the page list cannot be read: refused", r?.success, false);
  ok("cleanup, unproven: record kept", !!(await kvs.get("protection-att1")));
}
await world();
override = (method, base, who) => (method === "DELETE" && who === "user" ? { status: 404 } : (method === "GET" && base === "/wiki/api/v2/attachments/att1" && who === "app" && fake.calls.some((c) => c.method === "DELETE") ? { status: 404 } : undefined));
{
  const r = await purge(CONF_ADMIN);
  eq("purge, caller 404 + app 404 but the page still lists it: refused", r?.success, false);
  ok("purge, unproven gone: record kept", !!(await kvs.get("protection-att1")));
}

// ── restore ───────────────────────────────────────────────────────────────────────────────────
for (const [label, who] of [["seal owner", OWNER], ["Sentinel Vault space admin only", SV_STEWARD], ["page editor", EDITOR]]) {
  await world();
  const r = await restore(who);
  eq(`restore, ${label} without Confluence's trash rights: refused`, r?.success, false);
  ok(`restore, ${label}: the refusal names Confluence`, said(r, "Confluence does not let you restore this file"));
  ok(`restore, ${label}: still in the trash`, att.att1?.status === "trashed");
  eq(`restore, ${label}: no restore with the app's rights`, writes(RESTORE_CALL).filter((c) => c.who === "app").length, 0);
}
await world();
{
  const r = await restore(CONF_ADMIN);
  eq("restore, Confluence space admin: done", r?.success, true);
  ok("restore, Confluence space admin: file current", att.att1?.status === "current");
  ok("restore, Confluence space admin: with the caller's rights", writes(RESTORE_CALL).length > 0 && writes(RESTORE_CALL).every((c) => c.who === "user"));
}
await world();
TRASH_ADMINS.add(OUTSIDER); EDITORS.delete(OUTSIDER);
{
  const r = await restore(OUTSIDER);
  eq("restore, not owner/steward/editor (floor): refused", r?.success, false);
  ok("restore, floor: still in the trash", att.att1?.status === "trashed");
}
await world();
override = (method, base, who) => (method === "PUT" && who === "user" ? { status: 429, headers: { "Retry-After": "30" } } : undefined);
{
  const r = await restore(CONF_ADMIN);
  eq("restore, Confluence busy: refused", r?.success, false);
  ok("restore, Confluence busy: says it is busy", r?.busy === true && said(r, "Confluence is limiting requests"));
  ok("restore, Confluence busy: still in the trash", att.att1?.status === "trashed");
}

await world();
override = (method, base, who) => (method === "PUT" && who === "user" ? { status: 404 } : undefined);
{
  const r = await restore(CONF_ADMIN);
  eq("restore, caller cannot see it (404): refused", r?.success, false);
  ok("restore, 404: Confluence's refusal", said(r, "Confluence does not let you restore this file"));
}
await world();
{
  const { default: api } = await import("@forge/api");
  const real = api.asUser;
  api.asUser = () => { throw new Error("no user context"); };
  try {
    const r = await restore(CONF_ADMIN);
    eq("restore, no user context: refused", r?.success, false);
    ok("restore, no user context: still in the trash", att.att1?.status === "trashed");
    eq("restore, no user context: no app-identity restore", writes(RESTORE_CALL).filter((c) => c.who === "app").length, 0);
  } finally { api.asUser = real; }
}
await world();
nameTaken.add("plan.pdf");
{
  const r = await restore(CONF_ADMIN);
  eq("restore, a newer file holds the name: refused", r?.success, false);
  ok("restore, name taken: says to rename or remove the other file", said(r, "Rename or remove that file"));
  eq("restore, name taken: one PUT only (a trashed file cannot be renamed)", writes(RESTORE_CALL).length, 1);
  ok("restore, name taken: still in the trash under its own name", att.att1?.status === "trashed" && att.att1?.title === "plan.pdf");
}

// ── a definite refusal is not rewritten into "try again" ───────────────────────────────────────
await runInvocation(async () => {
  noteAuthzUnknown();
  const conf = busyAware({ success: false, refusedBy: "confluence", reason: "Confluence does not let you restore this file." });
  eq("busyAware keeps Confluence's refusal", conf.reason, "Confluence does not let you restore this file.");
  const gate = busyAware({ success: false, reason: "You do not have permission to restore this file" });
  ok("busyAware still marks a gate refusal that a 429 decided", gate.busy === true);
});

// ── Remove record on a BLOG POST and on a PURGED page (the container decides where to look) ─────
const BLOG = "7001";
const GONE_PAGE = "6002";
async function containerWorld({ blogList = "ok", gonePage = "404", goneBlog = "404" } = {}) {
  await world();
  delete att.att1; // the file is purged
  onConfluence((method, rawPath) => {
    const base = decodeURIComponent(rawPath).split("?")[0];
    if (base === `/wiki/api/v2/pages/${BLOG}/attachments`) return { status: 404 };
    if (base === `/wiki/api/v2/blogposts/${BLOG}/attachments`) return blogList === "ok" ? { body: { results: [], _links: {} } } : { status: blogList };
    if (base === `/wiki/api/v2/pages/${GONE_PAGE}/attachments` || base === `/wiki/api/v2/blogposts/${GONE_PAGE}/attachments`) return { status: 404 };
    if (base === `/wiki/api/v2/pages/${GONE_PAGE}`) return gonePage === "404" ? { status: 404 } : gonePage;
    if (base === `/wiki/api/v2/blogposts/${GONE_PAGE}`) return goneBlog === "404" ? { status: 404 } : goneBlog;
    return undefined;
  });
}
await containerWorld();
await kvs.set("protection-att1", { lockedBy: OWNER, spaceKey: SPACE.key, spaceId: SPACE.id, contentId: BLOG, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedFromPage: BLOG });
{
  const r = await purge(OWNER);
  eq("remove record, file on a blog post, purged: done", r?.success, true);
  ok("remove record, blog post: record removed", !(await kvs.get("protection-att1")));
}
await containerWorld({ blogList: 429 });
await kvs.set("protection-att1", { lockedBy: OWNER, spaceKey: SPACE.key, spaceId: SPACE.id, contentId: BLOG, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedFromPage: BLOG });
{
  const r = await purge(OWNER);
  eq("remove record, blog post list busy: refused", r?.success, false);
  ok("remove record, blog post list busy: says try again", r?.busy === true && said(r, "Nothing was changed"));
  ok("remove record, blog post list busy: record kept", !!(await kvs.get("protection-att1")));
}
// A container that answers 404 everywhere may be gone, or hidden from the app: never proof.
for (const [label, opts] of [
  ["the page answers 404 everywhere (gone, or hidden from the app)", {}],
  ["the page is in the trash", { gonePage: { body: { id: GONE_PAGE, status: "trashed" } } }],
]) {
  await containerWorld(opts);
  await kvs.set("protection-att1", { lockedBy: OWNER, spaceKey: SPACE.key, spaceId: SPACE.id, contentId: GONE_PAGE, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedFromPage: GONE_PAGE });
  const r = await purge(OWNER);
  eq(`remove record, ${label}: refused`, r?.success, false);
  ok(`remove record, ${label}: record kept`, !!(await kvs.get("protection-att1")));
  if (!opts.gonePage) ok(`remove record, ${label}: says the page is not shown and the record stays`, said(r, "no longer shows this file's page") && said(r, "cannot be cleared from here"));
}
await containerWorld({ gonePage: { body: { id: GONE_PAGE, status: "deleted" } } });
await kvs.set("protection-att1", { lockedBy: OWNER, spaceKey: SPACE.key, spaceId: SPACE.id, contentId: GONE_PAGE, attachmentId: "att1", attachmentName: "plan.pdf", trashedOnly: true, trashedFromPage: GONE_PAGE });
{
  const r = await purge(OWNER);
  eq("remove record, Confluence names the page deleted: done", r?.success, true);
  ok("remove record, page deleted: record removed", !(await kvs.get("protection-att1")));
}
await containerWorld({ gonePage: { status: 429, headers: { "Retry-After": "30" } } });
await kvs.set("protection-att1", { lockedBy: OWNER, spaceKey: SPACE.key, spaceId: SPACE.id, contentId: GONE_PAGE, attachmentId: "att1", attachmentName: "plan.pdf" });
{
  const r = await purge(OWNER);
  eq("remove record, the page check is busy: refused", r?.success, false);
  ok("remove record, page check busy: try again, record kept", r?.busy === true && !!(await kvs.get("protection-att1")));
}
// A LIVE seal whose trashed file the app cannot see: the app's own cleanup keeps the records too.
{
  await world();
  override = (method, base, who) => (who === "app" && (base === "/wiki/api/v2/attachments/att1" || base === `/wiki/api/v2/pages/${PAGE}/attachments` || base === `/wiki/api/v2/blogposts/${PAGE}/attachments` || base === `/wiki/api/v2/pages/${PAGE}` || base === `/wiki/api/v2/blogposts/${PAGE}`) ? { status: 404 } : undefined);
  const { confirmAttachmentPurged } = await import("../src/server/infra/attachment-status.js");
  eq("confirmAttachmentPurged, file there but hidden from the app: not gone", await confirmAttachmentPurged("att1", 0, { pageId: PAGE }), false);
  ok("hidden file: still in the trash", att.att1?.status === "trashed");
}

// ── a caller 404 plus a 429 while confirming is "try again", never Confluence's "no" ────────────
await world();
override = (method, base, who) => {
  if (method === "DELETE" && who === "user") return { status: 404 };
  if (method === "GET" && base === "/wiki/api/v2/attachments/att1" && fake.calls.some((c) => c.method === "DELETE")) return { status: 404 };
  if (base === `/wiki/api/v2/pages/${PAGE}/attachments`) return { status: 429, headers: { "Retry-After": "30" } };
  return undefined;
};
{
  const r = await purge(CONF_ADMIN);
  eq("purge, 404 then a busy confirmation: refused", r?.success, false);
  ok("purge, busy confirmation: says try again, not Confluence's refusal", r?.busy === true && !said(r, "Confluence does not let you") && said(r, "Nothing was changed"));
  ok("purge, busy confirmation: record kept", !!(await kvs.get("protection-att1")));
}

// ── consent: Forge's "needs authentication" reaches the UI (it shows the consent prompt) ───────
for (const [label, run] of [["purge", () => purge(CONF_ADMIN)], ["restore", () => restore(CONF_ADMIN)]]) {
  await world();
  const { default: api } = await import("@forge/api");
  const real = api.asUser;
  api.asUser = () => ({ requestConfluence: async () => { const e = new Error("Authentication required"); e.name = "NEEDS_AUTHENTICATION_ERR"; e.status = 401; throw e; } });
  let thrown = null;
  try { await run(); } catch (e) { thrown = e; } finally { api.asUser = real; }
  eq(`${label}, no user consent yet: the consent error is thrown to the UI`, thrown?.name, "NEEDS_AUTHENTICATION_ERR");
  ok(`${label}, no user consent: file still in the trash`, att.att1?.status === "trashed");
  ok(`${label}, no user consent: record kept`, !!(await kvs.get("protection-att1")));
  eq(`${label}, no user consent: no restore marker left behind`, await kvs.get(`panel-restore-1-${CONF_ADMIN}`), undefined);
}


// ── a non-owner's panel restore of a LIVE seal is not read as a change to the file ────────────
async function sealedRestoreWorld() {
  await world();
  await kvs.set("protection-att1", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: SPACE.key, spaceId: SPACE.id, contentId: PAGE, attachmentId: "att1", attachmentName: "plan.pdf", sealedVersion: 1, sealedFileId: "f1", timestamp: "2026-10-01T00:00:00.000Z" });
}
const updated = (who, version) => artifactEventTrigger({ eventType: "avi:confluence:updated:attachment", atlassianId: who, attachment: { id: "att1", container: { id: PAGE }, version: { number: version }, fileName: "plan.pdf" } });
const revertedSince = (n) => fake.calls.slice(n).some((c) => /\/child\/attachment\/att1\/download/.test(decodeURIComponent(c.path)));
await sealedRestoreWorld();
{
  const r = await restore(CONF_ADMIN);
  eq("live seal, steward restores: done", r?.success, true);
  const v = att.att1.version;
  let n = fake.calls.length;
  await updated(CONF_ADMIN, v);
  eq("live seal, the restore's own update event: no revert", revertedSince(n), false);
  ok("live seal, the restore's own update event: seal kept as it was", (await kvs.get("protection-att1"))?.sealedVersion === 1);
  n = fake.calls.length;
  att.att1.version = v + 1; att.att1.files[v + 1] = "f2"; // the same person uploads new bytes
  await updated(CONF_ADMIN, v + 1);
  ok("live seal, a LATER upload by the same person is enforced", revertedSince(n));
  n = fake.calls.length;
  await updated(EDITOR, v);
  ok("live seal, the same version by someone else is enforced", revertedSince(n));
}
// A settled marker whose version holds DIFFERENT bytes is not honoured (a restore never changes them).
await sealedRestoreWorld();
{
  const r = await restore(CONF_ADMIN);
  eq("live seal, restore for the bytes check: done", r?.success, true);
  const v = att.att1.version;
  att.att1.files[v] = "f-other";
  const n = fake.calls.length;
  await updated(CONF_ADMIN, v);
  ok("live seal, marker version with other bytes: enforced", revertedSince(n));
}
// The settle never lands (or the event beats it): the restore's own event, same bytes, is still left
// alone; uploads by the restorer carry other bytes and are enforced.
await sealedRestoreWorld();
{
  const realSet = kvs.set;
  kvs.set = async (k, val, o) => { if (String(k).startsWith("panel-restore-") && val?.settled) throw new Error("kvs down"); return realSet(k, val, o); };
  let r;
  try { r = await restore(CONF_ADMIN); } finally { kvs.set = realSet; }
  eq("live seal, settle fails: the restore itself still answers", r?.success, true);
  const v = att.att1.version;
  let n0 = fake.calls.length;
  await updated(CONF_ADMIN, v);
  eq("live seal, unsettled marker, same bytes: the restore's event is left alone", revertedSince(n0), false);
  for (const up of [v + 1, v + 5]) {
    att.att1.version = up; att.att1.files[up] = `f-up-${up}`;
    const n = fake.calls.length;
    await updated(CONF_ADMIN, up);
    ok(`live seal, settle failed: upload v${up} by the restorer is enforced`, revertedSince(n));
  }
}
// Two people restore: a refused restore by one never clears the other's marker.
await sealedRestoreWorld();
{
  const ok1 = await restore(CONF_ADMIN);
  eq("two restorers: the first restores", ok1?.success, true);
  const v = att.att1.version;
  att.att1.status = "trashed"; // put it back in the trash for the second attempt, same version
  const r2 = await restore(SV_STEWARD); // Confluence refuses this person
  eq("two restorers: the second is refused", r2?.success, false);
  ok("two restorers: the first one's marker is untouched", (await kvs.get(`panel-restore-1-${CONF_ADMIN}`))?.settled === true);
  eq("two restorers: no marker for the refused one", await kvs.get(`panel-restore-1-${SV_STEWARD}`), undefined);
  att.att1.status = "current";
  const n = fake.calls.length;
  await updated(CONF_ADMIN, v);
  eq("two restorers: the first restore's event is still not read as a change", revertedSince(n), false);
}
// A busy fileId answer defers the decision (no revert, no notice now); the sweep decides later.
await sealedRestoreWorld();
{
  const r = await restore(CONF_ADMIN);
  eq("defer, restore: done", r?.success, true);
  const v = att.att1.version;
  override = (method, base, who, qs) => (method === "GET" && base === "/wiki/api/v2/attachments/att1" && qs.get("version") ? { status: 429, headers: { "Retry-After": "1" } } : undefined);
  let n = fake.calls.length;
  await updated(CONF_ADMIN, v);
  eq("defer, busy fileId read: no revert now", revertedSince(n), false);
  ok("defer, busy fileId read: a re-check is queued", !!(await kvs.get(`restore-recheck-1-${CONF_ADMIN}-${v}`)));
  override = () => undefined;
  n = fake.calls.length;
  const s1 = await sweepRestoreRechecks();
  eq("defer, sweep with a readable answer: judged a restore, nothing enforced", [s1.judged, s1.enforced], [1, 0]);
  eq("defer, sweep: no revert", revertedSince(n), false);
  eq("defer, sweep: the re-check is gone", await kvs.get(`restore-recheck-1-${CONF_ADMIN}-${v}`), undefined);
}
await sealedRestoreWorld();
{
  await restore(CONF_ADMIN);
  const v = att.att1.version;
  override = (method, base, who, qs) => (method === "GET" && base === "/wiki/api/v2/attachments/att1" && qs.get("version") ? { status: 503 } : undefined);
  await updated(CONF_ADMIN, v);
  let enforcedAt = null;
  for (let i = 1; i <= 8 && enforcedAt == null; i++) { const s = await sweepRestoreRechecks(); if (s.enforced) enforcedAt = i; }
  override = () => undefined;
  ok("defer, still busy: enforced after a few sweeps, never left alone for good", enforcedAt != null && enforcedAt <= 6);
  eq("defer, still busy: the re-check is gone", await kvs.get(`restore-recheck-1-${CONF_ADMIN}-${v}`), undefined);
}
// A seal from before sealedFileId: the bytes are compared with its sealed version's file.
for (const [label, sealedRead, wantRevert] of [["sealed version readable, same file", null, false], ["sealed version unreadable", { status: 404 }, true]]) {
  await world();
  await kvs.set("protection-att1", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: SPACE.key, spaceId: SPACE.id, contentId: PAGE, attachmentId: "att1", attachmentName: "plan.pdf", sealedVersion: 1, timestamp: "2026-10-01T00:00:00.000Z" });
  await restore(CONF_ADMIN);
  const v = att.att1.version;
  override = (method, base, who, qs) => (sealedRead && method === "GET" && base === "/wiki/api/v2/attachments/att1" && qs.get("version") === "1" ? sealedRead : undefined);
  const n = fake.calls.length;
  await updated(CONF_ADMIN, v);
  override = () => undefined;
  eq(`legacy seal, ${label}: ${wantRevert ? "enforced" : "left alone"}`, revertedSince(n), wantRevert);
}
await sealedRestoreWorld();
{
  const r = await restore(OWNER); // refused by Confluence: no version landed, the marker goes
  eq("live seal, refused restore: refused", r?.success, false);
  eq("live seal, refused restore: no marker left", await kvs.get(`panel-restore-1-${OWNER}`), undefined);
  const n = fake.calls.length;
  await updated(SV_STEWARD, 3);
  ok("live seal, no marker: an edit is enforced as before", revertedSince(n));
}

// A metadata change by the restorer AFTER the restore (same bytes, next version) is a change.
await sealedRestoreWorld();
{
  await restore(CONF_ADMIN);
  const v = att.att1.version;
  att.att1.version = v + 1; // a rename: same file, new version
  const n = fake.calls.length;
  await updated(CONF_ADMIN, v + 1);
  ok("live seal, same-bytes change by the restorer at the next version: enforced", revertedSince(n));
}

// ── the owner trashes a sealed file, then restores it from the panel ────────────────────────────
const trashed = (who) => artifactEventTrigger({ eventType: "avi:confluence:trashed:attachment", atlassianId: who, attachment: { id: "att1", container: { id: PAGE }, version: { number: att.att1?.version }, fileName: "plan.pdf" } });
await sealedRestoreWorld();
TRASH_ADMINS.add(OWNER);
{
  await trashed(OWNER); // the event lands while the file is in the trash
  const rec = await kvs.get("protection-att1");
  ok("owner trash: the seal becomes a tracking row naming the page it was trashed from", rec?.trashedOnly === true && rec?.trashedFromPage === PAGE);
  const r = await restore(OWNER);
  eq("owner trash, then restore: done", r?.success, true);
  eq("owner trash, then restore: the tracking row is consumed", await kvs.get("protection-att1"), undefined);
}
await sealedRestoreWorld();
TRASH_ADMINS.add(OWNER);
{
  const r = await restore(OWNER); // the trash event has not landed yet: the record is still the seal
  eq("late trash event: the owner's restore runs first", r?.success, true);
  await trashed(OWNER); // ...and lands now, with the file current again
  const rec = await kvs.get("protection-att1");
  ok("late trash event after the restore: the seal is kept", !!rec && rec.trashedOnly !== true && rec.sealedFileId === "f1");
}

// ── a page save meets a sealed embed whose file answers 404: unproven, so nothing is done ──────
await world();
delete att.att1;
await kvs.set("protection-att1", { lockedBy: OWNER, lockedByName: "Owner", spaceKey: SPACE.key, spaceId: SPACE.id, contentId: PAGE, attachmentId: "att1", attachmentName: "plan.pdf", sealedVersion: 1, sealedFileId: "f1", embedded: true, timestamp: "2026-10-01T00:00:00.000Z" });
{
  const seal = await kvs.get("protection-att1");
  const ctx = { enforcedRevert: false, adfDoc: { version: 1, type: "doc", content: [] }, atlassianId: EDITOR, pageId: PAGE, notifications: [], changed: false, readAuthorId: EDITOR, appAccountId: "app-account", currentVersion: 5 };
  const n = fake.calls.length;
  const keysBefore = new Set(fake.kvs.keys());
  await restoreMediaPass(ctx, [{ seal, fileId: "f1" }], new Map());
  eq("media pass, unproven purge: nothing recorded (no revert-failed activity or dispatch)", [...fake.kvs.keys()].filter((k) => !keysBefore.has(k)), []);
  const after = fake.calls.slice(n);
  eq("media pass, unproven purge: no restore attempt", after.filter((c) => c.method === "PUT").length, 0);
  eq("media pass, unproven purge: no notice", after.filter((c) => c.method === "POST" && /comment/i.test(c.path)).length + ctx.notifications.length, 0);
  ok("media pass, unproven purge: seal kept, page unchanged", !!(await kvs.get("protection-att1")) && ctx.changed === false);
}

// ── a 409 that is not a name clash is not reported as one ──────────────────────────────────────
await world();
override = (method, base, who) => (method === "PUT" && who === "user" ? { status: 409, body: { message: "Version conflict: stale version" } } : undefined);
{
  const r = await restore(CONF_ADMIN);
  eq("restore, other 409: refused", r?.success, false);
  ok("restore, other 409: not called a name clash", !said(r, "Rename or remove") && said(r, "409"));
}

// ── the panel's own delete already runs as the caller (guard) ──────────────────────────────────
await world({ status: "current", record: "none" });
{
  const r = await as(panels.get("delete-artifact"), EDITOR, { attachmentId: "att1" });
  eq("delete-artifact: done for an editor Confluence lets delete", r?.success, true);
  eq("delete-artifact: the trash call ran with the caller's rights", writes(/\/wiki\/api\/v2\/attachments\/att1$/).map((c) => c.who), ["user"]);
}

// ── the settings say what the switches do ──────────────────────────────────────────────────────
const setting = (k) => control(k);
ok("Seal Cleanup text says it permanently deletes a file from the trash", /permanently delete/i.test(setting("allowSealPurge").text) && /trash/i.test(setting("allowSealPurge").text));
ok("Seal Cleanup text says Confluence decides", /Confluence/.test(setting("allowSealPurge").text));
ok("Restore text says Confluence decides", /Confluence/.test(setting("allowSealRestore").text));

// ── source guard: nothing in src/server changes trash state of someone's file with the app's rights ──
// The only app-identity purges allowed are of the app's OWN backup files (backup/store.js) and the
// dev-only hook. A restore PUT of a trashed attachment with the app's rights is allowed only where a
// live seal puts its own file back (the seal's enforcement in triggers.js via attachment-status.js).
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
const root = new URL("../src/server", import.meta.url);
const files = walk(decodeURIComponent(root.pathname));
const appPurges = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  src.split("\n").forEach((l, i) => {
    if (/purge=true/.test(l) && /appConfluence|asApp\(\)/.test(l + (src.split("\n")[i - 1] || ""))) appPurges.push(`${f.split("/src/server/")[1]}:${i + 1}`);
  });
}
eq("no app-identity purge outside the app's own backup files", appPurges.filter((w) => !w.startsWith("capsules/backup/")), []);
// Every file that can purge, whatever the caller is named: the shared rule (as the user) and the
// app's own backup files. A new file here must be justified and added deliberately.
const code = (f) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const purgeFiles = files.filter((f) => /purge=true/.test(code(f))).map((f) => f.split("/src/server/")[1]).sort();
eq("the only files that purge", purgeFiles, ["capsules/backup/store.js", "shared/trash-rights.js"]);
// Every restore of a trashed attachment goes through putAttachmentCurrent; its callers are the
// panel's restore (as the user) and the seal's own enforcement (attachment-status.js).
const restoreCallers = files.filter((f) => /putAttachmentCurrent\(/.test(readFileSync(f, "utf8").replace(/export async function putAttachmentCurrent\(/, ""))).map((f) => f.split("/src/server/")[1]).sort();
eq("the only callers of the trash restore", restoreCallers, ["capsules/sealing/actions.js", "infra/attachment-status.js"]);
const childPut = files.filter((f) => /child\/attachment\/\$\{[^}]+\}`/.test(code(f))).map((f) => f.split("/src/server/")[1]).sort();
eq("the only file that PUTs an attachment's status", childPut, ["infra/attachment-status.js"]);
const actionsSrc = readFileSync(decodeURIComponent(new URL("../src/server/capsules/sealing/actions.js", import.meta.url).pathname), "utf8");
const restoreBody = actionsSrc.slice(actionsSrc.indexOf("export const restoreSealedArtifact"), actionsSrc.indexOf("export const purgeSealRecord"));
ok("restore-sealed-artifact restores with the caller's rights", /putAttachmentCurrent\([^)]*as:\s*"user"/.test(restoreBody));

report("trash-rights");
