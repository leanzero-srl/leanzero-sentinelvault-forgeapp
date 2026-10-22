// "Waiting on you" counts count exactly what the lists list (SVT-147). My work's total and the page
// banner's Waiting for you count read the raw indexes, while the lists dropped approvals on pages in
// the trash, gone or not viewable, approvals with no open request or a failed AI review, and
// proposals on pages the caller cannot view: the counts could be higher than the lists. Now each count
// runs its list's own rule (approvals.js waitingApprovals, editreq/viewable.js viewableProposals), and a
// source guard keeps any count from reading a raw index again.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { readFileSync } from "node:fs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const editreq = byKey((await import("../src/server/capsules/editreq/actions.js")).actions);
const sealing = byKey((await import("../src/server/capsules/sealing/actions.js")).actions);
const { writeProposalIndex, writeSectionProposalIndex } = await import("../src/server/capsules/editreq/logic.js");
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const X = "acct-approver-x";
const Y = "acct-approver-y";
const REQUESTER = "acct-requester";
const APPROVED = DEFAULT_WORKFLOW.states.find((s) => s.enforce)?.id || "approved";
const IN_REVIEW = DEFAULT_WORKFLOW.states.find((s) => s.id === "in_review")?.id || DEFAULT_WORKFLOW.states[1].id;
const REQ_AT = "2026-10-02T00:00:00.000Z";
const users = (...ids) => ids.map((id) => ({ id, type: "user", name: id }));

// Pages: OK (current, X can view), HIDDEN (X cannot view), TRASHED, AIFAIL (AI review failed),
// ORPHAN (an approval record with no open request).
const P = { OK: "8001", HIDDEN: "8002", TRASHED: "8003", AIFAIL: "8004", ORPHAN: "8005" };
let trashed = new Set([P.TRASHED]);
let hiddenFor = { [X]: new Set([P.HIDDEN]) };

function world() {
  resetFake();
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") { const a = qs.get("accountId"); return { body: { accountId: a, displayName: a, operations: [] } }; }
    const perm = base.match(/^\/wiki\/rest\/api\/content\/([^/]+)\/permission\/check$/);
    if (perm) {
      let who = null;
      try { who = (typeof body === "string" ? JSON.parse(body) : body)?.subject?.identifier || null; } catch (_) { who = null; }
      return { body: { hasPermission: !(hiddenFor[who]?.has(perm[1])) } };
    }
    if (base === "/wiki/api/v2/pages" && method === "GET") {
      const ids = String(qs.get("id") || "").split(",").filter(Boolean);
      const want = String(qs.get("status") || "");
      const pick = want.includes("trashed") ? ids.filter((id) => trashed.has(id)) : ids.filter((id) => !trashed.has(id));
      return { body: { results: pick.map((id) => ({ id, status: want.includes("trashed") ? "trashed" : "current", title: `Page ${id} title`, spaceId: "101", _links: { webui: `/p/${id}` } })) } };
    }
    const one = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/);
    if (one) return { body: { id: one[1], status: trashed.has(one[1]) ? "trashed" : "current", title: `Page ${one[1]} title`, spaceId: "101", version: { number: 3, authorId: REQUESTER } } };
    if (/^\/wiki\/api\/v2\/pages\/\d+\/attachments/.test(base)) return { body: { results: [] } };
    if (base === "/wiki/api/v2/spaces/101") return { body: { id: "101", key: "AAA" } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: qs.get("keys") === "AAA" ? [{ id: "101", key: "AAA" }] : [] } };
    if (base === "/wiki/api/v2/spaces/101/permissions") return { body: { results: [] } };
    if (/^\/wiki\/api\/v2\/pages\/\d+\/properties/.test(base)) return method === "GET" ? { body: { results: [] } } : { body: { id: "901", version: { number: 1 } } };
    if (method !== "GET") return { body: {} };
    return { body: { results: [] } };
  });
}
async function settings() {
  await kvs.set("admin-settings-global", { allowAdminOverride: true });
  await kvs.set("admin-settings-space-AAA", { adminUsers: [] });
  await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X, Y), mode: "any" } });
}
async function request(pageId, { aiGate = null, pending = true } = {}) {
  await kvs.set(`workflow-state-${pageId}`, { workflowId: "default", stateId: IN_REVIEW, spaceKey: "AAA", enteredAt: REQ_AT, enforce: false, approvedVersion: null, approvers: [] });
  if (pending) await kvs.set(`workflow-pending-${pageId}`, { pageId, toStateId: APPROVED, toStateName: "Approved", requestedBy: REQUESTER, requestedByName: "Req", requestedAt: REQ_AT, pinnedVersion: 3, approvers: [X, Y], mode: "any", min: 1, spaceKey: "AAA", aiGate });
  for (const a of [X, Y]) {
    await kvs.set(`workflow-approval-${pageId}-${APPROVED}-approval-${a}`, { pageId, stateId: APPROVED, approverAccountId: a, status: "pending", requestedAt: REQ_AT, pinnedVersion: 3 });
    await kvs.set(`workflow-inbox-${a}-${pageId}`, { pageId, stateId: APPROVED, requestedAt: REQ_AT });
  }
}
const remote = (fn, accountId, payload = {}) => fn({ payload, context: { accountId } });
const onPage = (fn, accountId, pageId) => fn({ payload: {}, context: { accountId, extension: { content: { id: pageId, type: "page" } } } });

// ══ 1. Approvals: the total counts what the inbox lists ══════════════════════════════════════════════
world(); await settings();
await request(P.OK);
await request(P.HIDDEN);
await request(P.TRASHED);
await request(P.AIFAIL, { aiGate: { required: true, status: "failed", threshold: "medium", reviewedVersion: 3, reason: "x" } });
await request(P.ORPHAN, { pending: false });
{
  const list = await remote(workflow.get("list-my-approvals"), X);
  const count = await remote(editreq.get("count-my-work"), X);
  eq("inbox lists only the request X can act on", (list?.approvals || []).map((a) => String(a.pageId)).join(","), P.OK);
  eq("the inbox says how many there are in all", list?.total, 1);
  eq("My work's approvals number = the inbox rows (no hidden, trashed, AI-failed or orphan row counted)", count?.approvals, (list?.approvals || []).length);
  eq("My work's total = the inbox rows (nothing else waits)", count?.total, 1);
}

// ══ 2. The page banner counts the same rows, on its page ═════════════════════════════════════════════
{
  const ok1 = await onPage(sealing.get("ribbon-summary"), X, P.OK);
  eq("banner on the page with a request waiting on X: 1", ok1?.waitingOnMe?.approvals, 1);
  const ai = await onPage(sealing.get("ribbon-summary"), X, P.AIFAIL);
  eq("banner on a page whose AI review failed: nothing waits on X (the inbox does not list it)", ai?.waitingOnMe?.approvals, 0);
  const orphan = await onPage(sealing.get("ribbon-summary"), X, P.ORPHAN);
  eq("banner on a page with no open request: nothing waits on X", orphan?.waitingOnMe?.approvals, 0);
  const req = await onPage(sealing.get("ribbon-summary"), REQUESTER, P.OK);
  eq("banner for the requester: their own request is not waiting on them", req?.waitingOnMe?.approvals, 0);
}

// ══ 3. Proposals: the request numbers count what the request lists list ══════════════════════════════
const future = new Date(Date.now() + 86400000).toISOString();
async function proposalOn(pageId, n) {
  await kvs.set(`protection-att-${n}`, { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: pageId, attachmentId: `att-${n}`, attachmentName: "a.pdf", expiresAt: future, workflowHeld: { pageId, stateId: APPROVED } });
  await kvs.set(`edit-request-att-${n}-acct-proposer`, { artifactId: `att-${n}`, requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], contentId: pageId, pageId, spaceKey: "AAA", requestedAt: REQ_AT });
  await writeProposalIndex(await kvs.get(`edit-request-att-${n}-acct-proposer`));
  await kvs.set(`section-protection-sec-${n}`, { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", pageId, sectionId: `sec-${n}`, sectionTitle: "Terms", expiresAt: future, workflowHeld: { pageId, stateId: APPROVED } });
  await kvs.set(`section-edit-request-sec-${n}-acct-proposer`, { sectionId: `sec-${n}`, requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], pageId, spaceKey: "AAA", requestedAt: REQ_AT });
  await writeSectionProposalIndex(await kvs.get(`section-edit-request-sec-${n}-acct-proposer`));
}
world(); await settings();
await proposalOn(P.OK, 1);
await proposalOn(P.HIDDEN, 2);
{
  const files = (await remote(editreq.get("list-my-edit-requests"), X))?.requests || [];
  const sections = (await remote(editreq.get("list-my-section-edit-requests"), X))?.requests || [];
  const count = await remote(editreq.get("count-my-work"), X);
  eq("file proposals: only the one on a page X can view is listed", files.length, 1);
  eq("file proposals: My work's number = the list", count?.fileRequests, files.length);
  eq("section proposals: only the one on a page X can view is listed", sections.length, 1);
  eq("section proposals: My work's number = the list", count?.sectionRequests, sections.length);
  eq("My work's total = the lists", count?.total, files.length + sections.length);
  const banner = await onPage(sealing.get("ribbon-summary"), X, P.OK);
  eq("banner on the page X can view: its two proposals", banner?.waitingOnMe?.requests, 2);
}

// ══ 4. More than the inbox shows: the total is the real number, the list says so ══════════════════════
world(); await settings();
const many = Array.from({ length: 27 }, (_, i) => String(9100 + i));
for (const id of many) await request(id);
{
  const list = await remote(workflow.get("list-my-approvals"), X);
  const count = await remote(editreq.get("count-my-work"), X);
  eq("27 waiting: the inbox lists 25", (list?.approvals || []).length, 25);
  eq("27 waiting: the inbox's total is 27", list?.total, 27);
  eq("27 waiting: My work's number is the inbox's total", count?.approvals, list?.total);
}

// ══ 5. Source guards: no count reads a raw index ═════════════════════════════════════════════════════
const src = (p) => readFileSync(new URL(`../src/server/${p}`, import.meta.url), "utf8");
for (const f of ["capsules/editreq/actions.js", "capsules/sealing/actions.js", "capsules/workflow/actions.js"]) {
  const s = src(f);
  ok(`${f}: no caller reads the raw approvals index (listMyApprovals) — waitingApprovals is the rule`, !/\blistMyApprovals\s*\(/.test(s));
  // Every read of an owner index hands its rows to viewableProposals.
  const calls = [...s.matchAll(/listPending(?:Section)?RequestsForOwner\s*\(\s*accountId\s*\)/g)];
  const bad = calls.filter((m) => {
    const before = s.slice(Math.max(0, m.index - 40), m.index);
    const after = s.slice(m.index, m.index + 140);
    return !/viewableProposals\s*\(\s*await\s*$/.test(before) && !/\.then\(\s*(?:mineHere|\(rows\)\s*=>\s*viewableProposals)/.test(after);
  });
  eq(`${f}: every owner-index read goes through viewableProposals`, bad.length, 0);
}
const mw = readFileSync(new URL("../src/ui/surfaces/my-work/index.jsx", import.meta.url), "utf8");
ok("My work recounts after a decision in the approvals list", /<WorkflowInbox[^>]*onDecided=\{recount\}/.test(mw));

report("waiting-count");
