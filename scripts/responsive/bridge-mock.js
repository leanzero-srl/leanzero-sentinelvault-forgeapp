// Mock @forge/bridge for the OFFLINE screenshot harness (responsive baseline, 2026-10-07).
// webpack.screenshot.js aliases "@forge/bridge" → this file so every Custom UI surface renders
// outside the Forge host with DETERMINISTIC data. The scenario comes from window.__SHOT__ (set by
// the capture script). Time is fixed: the capture script pins the page clock to MOCK_NOW, and every
// date below is relative to it, so two runs paint the same pixels.
//
// The data imitates the wolfaenpak demo page and the WFH space the live device-matrix walks
// (long and short file names, several seal owners, a raw accountId actor, 40 workflow pages,
// revoked API tokens) so the layouts are exercised the way the live ones are.

const SHOT = () => (typeof window !== "undefined" && window.__SHOT__) || "panel";
const NOW = Date.parse("2026-10-07T10:00:00.000Z");
const future = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
const past = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

const ME = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const GABI = "712020:2b9d007d-0000-4000-8000-000000000001";
const NAMES = { [ME]: "Mihai Perdum", [GABI]: "Gabriela Perdum", me: "Mihai Perdum", alice: "Alice Stone", bob: "Bob Lee", carol: "Carol Ng" };

// ── page attachments (overlay, panel, page details) ────────────────────────────────────────
const ATT = [
  { id: "att1001", title: "Test sentinel.pdf", mediaType: "application/pdf", fileSize: 534118, lockStatus: "HELD", lockedByAccountId: GABI, lockedByName: "Gabriela Perdum", expiresAt: future(30 * 24), workflowHeld: true },
  { id: "att1002", title: "Regim caini.pdf", mediaType: "application/pdf", fileSize: 98211, lockStatus: "HELD", lockedByAccountId: ME, lockedByName: "Mihai Perdum", expiresAt: future(30 * 24), workflowHeld: true },
  { id: "att1003", title: "images (25).jpeg", mediaType: "application/octet-stream", fileSize: 8120, lockStatus: "HELD", lockedByAccountId: GABI, lockedByName: "Gabriela Perdum", expiresAt: future(12 * 24) },
  { id: "att1004", title: "images (21).jpeg", mediaType: "application/octet-stream", fileSize: 7340, lockStatus: "HELD_BY_ACTOR", lockedByAccountId: ME, lockedByName: "Mihai Perdum", expiresAt: future(40) },
  { id: "att1005", title: "Q3 Financial Plan — board pack v12 FINAL.xlsx", mediaType: "application/vnd.ms-excel", fileSize: 184320, lockStatus: "HELD", lockedByAccountId: "alice", lockedByName: "Alice Stone", expiresAt: past(5), isExpired: true },
  { id: "att1006", title: "architecture-diagram-2026-10-01-rev3.svg", mediaType: "application/octet-stream", fileSize: 96000, lockStatus: "OPEN" },
  { id: "att1007", title: "contract-final.pdf", mediaType: "application/pdf", fileSize: 542000, lockStatus: "OPEN" },
  { id: "att1008", title: "notes.txt", mediaType: "text/plain", fileSize: 1200, lockStatus: "OPEN" },
  { id: "att1009", title: "Release checklist for the 7.0 production cut.docx", mediaType: "application/msword", fileSize: 74000, lockStatus: "OPEN" },
  { id: "att1010", title: "budget.csv", mediaType: "text/csv", fileSize: 4100, lockStatus: "OPEN" },
].map((a) => ({
  isExpired: false, labels: [], comment: null, versionNumber: 1, allowDelete: true, allowRestore: false, allowPurge: false,
  notifyRequested: false, lockedOn: past(72), createdAt: past(400), ...a,
}));
const CLAIMED = ATT.filter((a) => a.lockStatus !== "OPEN").map((a) => ({ ...a }));

// ── space console: sealed files across the space ──────────────────────────────────────────
const REALM_SEALS = [
  { id: "att2001", title: "images (21).jpeg", lockedBy: "Gabriela Perdum", pageTitle: "Sentinel Vault demo", mediaType: "application/octet-stream" },
  { id: "att2002", title: "images (25).jpeg", lockedBy: "Gabriela Perdum", pageTitle: "Sentinel Vault demo", mediaType: "application/octet-stream" },
  { id: "att2003", title: "Regim caini.pdf", lockedBy: "Mihai Perdum", pageTitle: "Sentinel Vault demo", mediaType: "application/pdf" },
  { id: "att2004", title: "sv-aql-sealed-fixture.txt", lockedBy: "Mihai Perdum", pageTitle: "SV AQL Seal Fixture (do not delete)", mediaType: "text/plain", expiresAt: past(30), isExpired: true },
  { id: "att2005", title: "sv-bugB-1789443073003.txt", lockedBy: "Other", pageTitle: "HARNESS sv-media-attrs 1789443073003", mediaType: "text/plain", expiresAt: past(50), isExpired: true },
  { id: "att2006", title: "sv-matrix-1787210601799.txt", lockedBy: "Other", pageTitle: "HARNESS sv-matrix 1787210601799", mediaType: "text/plain", expiresAt: past(70), isExpired: true },
  { id: "att2007", title: "Test sentinel.pdf", lockedBy: "Gabriela Perdum", pageTitle: "Sentinel Vault demo", mediaType: "application/pdf" },
].map((a, i) => ({ pageId: String(368476161 + i), spaceKey: "WFH", fileSize: `${(i + 1) * 37}KB`, lockedOn: past(100 + i), expiresAt: future(24 * (10 + i)), isExpired: false, ...a }));

// ── activity (space report + page feeds) ──────────────────────────────────────────────────
const ACT_TYPES = [
  ["seal.created", "attachment", "Test sentinel.pdf"], ["seal.forced", "attachment", "sv-bugB-1789443073003.txt"],
  ["section.sealed", "section", "3. Staging API & Environment"], ["editreq.requested", "attachment", "Regim caini.pdf"],
  ["workflow.transition", "page", "Sentinel Vault demo"], ["workflow.approval-decided", "page", "Sentinel Vault demo"],
  ["validation.gate", "page", "HARNESS val-probe 1790091139773"], ["classification.page-set", "page", "Sentinel Vault demo"],
  ["seal.released", "attachment", "images (25).jpeg"], ["seal.extended", "attachment", "images (21).jpeg"],
  ["section.released", "section", "4. Rollout Timeline and Communication Plan"], ["editreq.approved", "attachment", "Regim caini.pdf"],
];
const ACTORS = [{ accountId: ME, name: "Mihai Perdum" }, { accountId: GABI, name: "Gabriela Perdum" }, { accountId: ME, name: ME }, null, { accountId: "harness", name: "Harness Bot With A Long Name" }];
const ACTIVITY = ACT_TYPES.map(([type, kind, name], i) => ({
  id: `act${i}`, ts: past(i * 7 + 1), type, pageId: String(368476161 + (i % 3)), spaceKey: "WFH",
  pageTitle: i % 3 === 0 ? "Sentinel Vault demo" : i % 3 === 1 ? "HARNESS sv-media-attrs 1789443073003" : "Q3 Financial Plan",
  actor: ACTORS[i % ACTORS.length], target: { kind, id: `t${i}`, name },
  details: { reason: i % 4 === 1 ? "Owner left the project; the file had to be updated for the audit." : undefined, fromStateName: "In Review", toStateName: "Approved", decision: "approved", levelName: "Public", fromLevelName: "Internal" },
  version: 9,
}));

// ── workflow ───────────────────────────────────────────────────────────────────────────────
const WF_STATES = [
  { id: "draft", name: "Draft", color: "neutral", initial: true },
  { id: "in_review", name: "In Review", color: "info", reviewAfterDays: null },
  { id: "approved", name: "Approved", color: "success", enforce: true, reviewAfterDays: 90 },
  { id: "needs_rereview", name: "Needs re-review", color: "caution" },
  { id: "expired", name: "Expired", color: "critical" },
];
const WF_DEF = {
  id: "default", name: "Document Approval", states: WF_STATES,
  transitions: [
    { from: "draft", to: "in_review" }, { from: "in_review", to: "approved" }, { from: "in_review", to: "draft" },
    { from: "approved", to: "needs_rereview" }, { from: "needs_rereview", to: "in_review" }, { from: "expired", to: "draft" },
  ],
};
const WF_PAGES = Array.from({ length: 40 }, (_, i) => {
  const st = WF_STATES[i % 4];
  return {
    pageId: String(100100 + i), title: i % 5 === 0 ? `HARNESS sv-wf-${1790000000000 + i * 977} long page title` : `Policy page ${i + 1}`,
    url: "#", stateId: st.id, stateName: st.name, enteredAt: past(24 * (i + 1)),
    reviewDueAt: st.id === "approved" ? future(24 * (20 - i)) : null, overdue: st.id === "approved" && i > 20,
  };
});
const WF_SETTINGS = {
  enabled: true, autoAssignNew: true, workflowId: "default", enforceMode: "demote", reviewAfterDays: 90,
  approval: { approvers: [{ type: "user", id: ME, name: "Mihai Perdum" }, { type: "user", id: GABI, name: "Gabriela Perdum" }, { type: "group", id: "reviewers", name: "reviewers" }], mode: "any", min: 1 },
};

// ── validations ────────────────────────────────────────────────────────────────────────────
const VALIDATION_CONFIG = {
  enabled: true,
  modes: { advisory: true, gate: true, revert: false },
  rules: [
    { id: "r1", type: "required-table", label: "Budget table required", severity: "block", config: { minCount: 1 } },
    { id: "r2", type: "required-heading", label: "Decision heading", severity: "warn", config: { text: "Decision" } },
  ],
  ai: { enabled: false, model: "claude-haiku-4-5-20251001", styleGuide: "", tone: "", compliance: "", rules: "", severityThreshold: "low", notifyAuthor: true, monthlyTokenBudget: 500000, maxChars: 40000 },
};

// ── site settings ──────────────────────────────────────────────────────────────────────────
const GLOBAL_POLICY = {
  setupCompletedAt: past(500), autoUnlockEnabled: true, defaultLockDuration: 172800, defaultSealDurationHours: 48,
  allowAdminOverride: true, allowStewardOverride: true, reminderIntervalDays: 7, enableContentProtection: true,
  allowArtifactDelete: true, allowSealRestore: true, allowSealPurge: true, enableFlashMessages: true, enableDocRibbons: true,
  enableConfluenceDispatches: true, enableEmailDispatches: true, enableSealExpiryReminderEmail: true,
  enableAutoUnsealDispatchEmail: true, enablePeriodicReminderEmail: true, globalAutoInsertMacro: true, replaceAttachmentsMacro: false,
  classificationEnabled: true,
};
const LEVELS = [
  { id: "public", name: "Public", color: "#15803D", rank: 1, description: "If this data is misused, it presents limited or no risk as it is already publicly available information." },
  { id: "internal", name: "Internal", color: "#2563EB", rank: 2, description: "For people inside the organisation. Sharing it outside needs the owner's agreement." },
  { id: "restricted", name: "Restricted", color: "#D97706", rank: 3, description: "A named group only. Misuse would harm the organisation or the people the data describes." },
  { id: "highly-restricted", name: "Highly restricted", color: "#DC2626", rank: 4, description: "Named individuals only. Misuse would cause serious, lasting harm; every access is reviewed and the content must never leave Confluence." },
];
const SPACES = [
  ["CLOUD", "Cloud migration programme", "global", "internal"], ["PEOPLE", "People and culture", "collaboration", "restricted"],
  ["WFH", "WORK FOR HIRE", "global", "public"], ["SVPLAIN", "Sentinel plain editors", "global", null],
  ["SVSEC1P", "SV security private", "global", "highly-restricted"], ["LEGAL", "Legal and contracts", "knowledge_base", "restricted"],
  ["ENG", "Engineering handbook", "global", "internal"], ["~712020abc", "Mihai Perdum", "personal", null],
].map(([key, name, type, defaultLevelId], i) => ({ id: String(9000 + i), key, name, type, defaultLevelId }));
const TOKENS = [
  { id: "tok_1", name: "ci-deploy", prefix: "svt_8f2a1c", role: "editor", createdAt: past(200), createdBy: ME, lastUsedAt: past(3) },
  { id: "tok_2", name: "harness-config-api-1790091139773", prefix: "svt_77ab09", role: "admin", createdAt: past(300), createdBy: ME, lastUsedAt: past(150), revokedAt: past(140) },
  { id: "tok_3", name: "readonly-reporting", prefix: "svt_0c9d11", role: "viewer", createdAt: past(400), createdBy: GABI, lastUsedAt: null },
  { id: "tok_4", name: "harness-config-api-1790091733655", prefix: "svt_e41f22", role: "admin", createdAt: past(500), createdBy: ME, lastUsedAt: past(480), revokedAt: past(470) },
];
const JOBS = Array.from({ length: 8 }, (_, i) => ({
  id: `deploy-20261${i}05-${i}`, status: ["done", "partial", "failed", "refused", "running", "queued", "done", "done"][i], op: i % 3 ? "bundle" : "seal",
  submittedBy: ME, role: "editor", submittedAt: past(i * 9 + 2), finishedAt: i === 4 || i === 5 ? null : past(i * 9 + 1),
  summary: { applied: 3 + i, refused: i % 2, failed: i === 2 ? 2 : 0 }, results: [{ path: "spaces.WFH.policy", status: "applied" }],
}));

// ── page details / ribbon ──────────────────────────────────────────────────────────────────
const SEAL_ROWS = [
  { kind: "attachment", id: "att1001", name: "Test sentinel.pdf", ownerAccountId: GABI, ownerName: "Gabriela Perdum", expiresAt: future(30 * 24), isExpired: false, isMine: false, isTrashed: false, watching: false, link: "/pages/viewpage.action?pageId=368476161", myEditStatus: "none", held: true, workflowHeld: true, pendingRequests: [] },
  { kind: "attachment", id: "att1002", name: "Regim caini.pdf", ownerAccountId: ME, ownerName: "Mihai Perdum", expiresAt: future(30 * 24), isExpired: false, isMine: true, isTrashed: false, watching: false, link: "/x", myEditStatus: "none", pendingRequests: [] },
  { kind: "attachment", id: "att1003", name: "images (25).jpeg", ownerAccountId: GABI, ownerName: "Gabriela Perdum", expiresAt: future(12 * 24), isExpired: false, isMine: false, isTrashed: false, watching: false, link: "/x", myEditStatus: "none", pendingRequests: [] },
  { kind: "attachment", id: "att1004", name: "images (21).jpeg", ownerAccountId: ME, ownerName: "Mihai Perdum", expiresAt: future(40), isExpired: false, isMine: true, isTrashed: false, watching: false, link: "/x", myEditStatus: "none", pendingRequests: [] },
  { kind: "attachment", id: "att1005", name: "Q3 Financial Plan — board pack v12 FINAL.xlsx", ownerAccountId: "alice", ownerName: "Alice Stone", expiresAt: past(5), isExpired: true, isMine: false, isTrashed: false, watching: false, link: "/x", myEditStatus: "none", pendingRequests: [] },
  { kind: "section", id: "sec1", name: "3. Staging API & Environment", ownerAccountId: GABI, ownerName: "Gabriela Perdum", expiresAt: future(8 * 24), isExpired: false, isMine: false, isTrashed: false, link: "/x", myEditStatus: "none", pendingRequests: [] },
];
const PD_SUMMARY = () => ({
  ok: true, pageId: "368476161", title: "Sentinel Vault demo", contentType: "page", spaceKey: "WFH",
  viewer: { accountId: ME, canEditPage: true, isSpaceAdmin: true, canForceRelease: true },
  classification: { enabled: true, effective: { level: LEVELS[0], source: "page" }, pageLevelId: "public", spaceDefault: LEVELS[0], levels: LEVELS, canChange: true },
  workflow: {
    assigned: true, workflowName: "Document Approval", state: { id: "approved", name: "Approved", color: "success" },
    status: { text: "Approved v9", tone: "success" }, enforced: true, enforceMode: "revert", reviewDueAt: future(24 * 82),
    approvalSummary: "Approved for version 9 on Sep 29, 2026 · any one approver.", canMove: true, canRemove: true,
    available: [{ id: "draft", name: "Draft", color: "neutral" }, { id: "in_review", name: "In Review", color: "info" }, { id: "needs_rereview", name: "Needs re-review", color: "caution" }],
    approvalRecord: { decisions: [{ name: "Mihai Perdum", decision: "approved", decidedAt: past(200) }, { name: "Gabriela Perdum", decision: "none" }] },
  },
  seals: SEAL_ROWS, waitingOnMe: 0, activity: { entries: ACTIVITY.slice(0, 5), nextCursor: null },
  attachments: ATT.map((a, i) => ({ id: a.id, name: a.title, fileSize: a.fileSize, mediaType: a.mediaType, createdAt: a.createdAt, version: 1 + (i % 3), sealed: a.lockStatus !== "OPEN" })),
  sealDefaults: { holdSeconds: 172800 },
});
const RIBBON_SUMMARY = {
  sealedAttachments: 5, sectionSeals: 1, trashedSeals: 0,
  classification: { level: LEVELS[0], source: "page", enabled: true },
  waitingOnMe: { requests: 0, approvals: 0, grantsActive: [] },
  lockedFor: { name: "Test sentinel.pdf", owner: "Gabriela Perdum", until: future(30 * 24), kind: "attachment", id: "att1001", myRequest: "none", held: true },
};
const PAGE_WORKFLOW = {
  assigned: true, canMove: true, canSetReviewDue: true,
  record: { workflowId: "default", stateId: "approved", enteredAt: past(200), spaceKey: "WFH", reviewDueAt: future(24 * 82), reviewedVersion: 9 },
  state: { id: "approved", name: "Approved", color: "success", enforce: true },
  enforced: true, reviewedVersion: 9,
  available: [{ id: "draft", name: "Draft", color: "neutral" }, { id: "in_review", name: "In Review", color: "info" }, { id: "needs_rereview", name: "Needs re-review", color: "caution" }],
  def: WF_DEF,
};

const SECTION_SEALS = [
  { sectionId: "sec1", sectionTitle: "3. Staging API & Environment", lockedByAccountId: GABI, lockedByName: "Gabriela Perdum", expiresAt: future(8 * 24), isMine: false, isExpired: false, held: true, workflowHeld: true },
  { sectionId: "sec2", sectionTitle: "4. Rollout Timeline and Communication Plan", lockedByAccountId: ME, lockedByName: "Mihai Perdum", expiresAt: future(36), isMine: true, isExpired: false },
];

// ── invoke router ──────────────────────────────────────────────────────────────────────────
const clone = (v) => JSON.parse(JSON.stringify(v));
async function invoke(action, payload = {}) {
  switch (action) {
    case "identify-operator": case "current-operator": {
      const id = payload?.accountId || ME;
      return { accountId: id, displayName: NAMES[id] || `User ${String(id).slice(-4)}` };
    }
    case "check-license": return { active: true };
    case "check-seal-stamp": return { stamp: 1 };
    // panel + overlay
    case "enumerate-page-seals": return { claimedArtifacts: clone(CLAIMED) };
    case "enumerate-panel-artifacts": case "enumerate-doc-artifacts":
      return { attachments: clone(ATT), hasMore: false, nextCursor: null, counts: { sealed: CLAIMED.length, available: ATT.length - CLAIMED.length } };
    case "discover-panel-key": return { extensionKey: "app/env/static/sentinel-vault-panel" };
    case "register-panel-key": return { success: true };
    case "check-panel-status": return { present: true, macroDisabled: false };
    case "load-bulletin-toggles": return { flags: { ENABLE_TOAST_DISPATCHES: true } };
    case "check-edit-request": case "check-section-edit": return { status: "none" };
    case "list-edit-requests": case "list-section-edit-requests": return { requests: [] };
    case "list-edit-grants": case "list-section-edit-grants": return { grants: [] };
    case "list-my-edit-requests": return { requests: [] };
    case "check-watch": return { success: true, requested: false };
    case "resolve-artifact-preview": return { success: false };
    case "enumerate-section-seals": return { sections: clone(SECTION_SEALS) };
    case "section-seal-status": return { sections: clone(SECTION_SEALS) };
    case "list-page-headings": return { headings: [{ index: 0, level: 2, text: "1. Overview" }, { index: 4, level: 2, text: "3. Staging API & Environment" }, { index: 9, level: 3, text: "4. Rollout Timeline and Communication Plan" }], hasSealedSections: true };
    case "get-validation-state": return { state: { state: "passed", violations: [], version: 9 } };
    case "get-ai-findings": return { aiEnabled: false, findings: null };
    case "get-page-activity": return { entries: clone(ACTIVITY.slice(0, 8)), nextCursor: null };
    // space console
    case "identify-realm": return { key: "WFH", name: "WORK FOR HIRE", id: "s1" };
    case "check-user-role": return { role: SHOT() === "realm-user" ? "user" : "steward", canForceRelease: true };
    case "check-steward-request": return { status: "none" };
    case "list-steward-requests": return { requests: SHOT() === "realm-steward" ? [{ accountId: "carol", displayName: "Carol Ng", requestedAt: past(20) }] : [] };
    case "enumerate-realm-seals": return { attachments: clone(REALM_SEALS), hasMore: false, nextCursor: null };
    case "enumerate-operator-seals": return { attachments: clone(REALM_SEALS.slice(0, 3)), hasMore: false, nextCursor: null, total: 3 };
    case "steward-override-enabled": return { enabled: true };
    case "enumerate-teams": return { groups: ["confluence-users", "site-admins", "reviewers"], hasMore: false };
    case "enumerate-operators": return { users: [{ accountId: ME, displayName: "Mihai Perdum" }], hasMore: false };
    case "load-policy": case "load-global-ruleset":
      return payload?.scope === "space" ? { adminUsers: [{ accountId: ME, displayName: "Mihai Perdum" }, { accountId: GABI, displayName: "Gabriela Perdum" }], adminGroups: ["confluence-admins-wolfaenpak", "reviewers"], notificationsMode: "normal", classification: "inherit" } : clone(GLOBAL_POLICY);
    case "classification-space-default": return { levels: clone(LEVELS), levelId: "public", enabled: true };
    case "get-space-activity": return { entries: clone(ACTIVITY), nextCursor: "c2" };
    case "get-workflow-dashboard": {
      const states = WF_STATES.slice(0, 4).map((s) => ({ ...s, count: WF_PAGES.filter((p) => p.stateId === s.id).length }));
      return { spaceKey: "WFH", total: WF_PAGES.length, truncated: false, listCap: 500, overdue: WF_PAGES.filter((p) => p.overdue).length, states, pages: clone(WF_PAGES) };
    }
    case "get-space-workflow-settings": return { settings: clone(WF_SETTINGS), def: clone(WF_DEF) };
    case "list-space-workflows": return { source: "space", default: clone(WF_DEF), extras: [] };
    case "list-my-approvals": return { approvals: [] };
    case "search-workflow-users": return { users: [{ accountId: "carol", name: "Carol Ng" }] };
    case "search-workflow-groups": return { groups: [{ id: "reviewers", name: "reviewers" }] };
    case "load-validation-config": return clone(VALIDATION_CONFIG);
    case "list-ai-models": return { models: ["claude-haiku-4-5-20251001"] };
    case "get-validation-audit": return { monthlyTokens: 128450 };
    // site settings
    case "classification-provider": return { name: "app", levels: clone(LEVELS), canManageLevels: false, enabled: true };
    case "classification-list-spaces": return { spaces: clone(SPACES), siteAdmin: true };
    case "classification-assets-link": return { link: null };
    case "list-api-tokens": return { success: true, tokens: clone(TOKENS), url: "https://c30bf71e-4287-4872-954d-db49cc68f0ff.hello.atlassian-dev.net/x1/CONFIG-API-URL" };
    case "list-api-jobs": return { success: true, jobs: clone(JOBS) };
    case "privacy-status": return { success: true, status: { last: { at: past(30), reporting: "done", stored: 9, due: 0, reported: 0, closed: 0 }, queuedAt: null } };
    case "backup-status": return { success: true, status: { lastBackup: { at: past(5), keys: 412, sizeBytes: 182000, generationId: "g1" } }, install: { installationId: "e0f4fa35-393d-484f-a000-a5f91ed1dac6", siteId: "cadafbe4-0000-4000-8000-000000000000" }, paused: { items: [] }, survival: { survives: [{ group: "settings", label: "Settings", items: ["Site settings", "Space settings", "Validation rules"] }, { group: "seals", label: "Seals", items: ["Attachment seals", "Section seals and their saved content"] }], secrets: ["Authenticator codes"], rebuilt: ["Search indexes (rebuilt on the next sweep)"] } };
    case "backup-discover": return { success: true, backups: [{ pageId: "1", spaceKey: "ADMIN", title: "Sentinel Vault backup", sameEnvironment: true, restricted: true, installations: [], generations: [{ generationId: "g1", createdAt: past(5), reason: "scheduled", keys: 412 }, { generationId: "g2", createdAt: past(29), reason: "privacy", keys: 409 }, { generationId: "g3", createdAt: past(53), reason: "manual", keys: 401 }] }] };
    case "backup-history": return { success: true, entries: [] };
    // page details
    case "page-details-summary": return PD_SUMMARY();
    // ribbon
    case "ribbon-summary": return clone(RIBBON_SUMMARY);
    case "get-page-workflow": return clone(PAGE_WORKFLOW);
    case "get-page-approvals": return { pending: false };
    case "get-read-status": return { required: false };
    case "recent-dispatches": return { dispatches: [] };
    case "guard-page-now": return { fresh: false };
    case "workflow-seals-to-freeze": return { seals: [] };
    // my work
    case "count-my-work": return { total: 3, requests: 1, approvals: 0, seals: 2 };
    case "signature-status": return { enrolled: false };
    default:
      if (action.startsWith("enumerate") || action.startsWith("list")) return { attachments: [], requests: [], results: [], items: [], entries: [] };
      return { success: true };
  }
}

// ── view / router / Modal / showFlag ────────────────────────────────────────────────────────
const view = {
  getContext: async () => {
    const s = SHOT();
    const content = { id: "368476161", type: "page", space: { key: "WFH", id: "s1" } };
    const base = { accountId: ME, siteUrl: "https://wolfaenpak.atlassian.net", localId: "harness-local" };
    if (s === "pd-seal") return { ...base, moduleKey: "sentinel-vault-seal-action", extension: { type: "confluence:contentAction", content } };
    if (s === "pd-details") return { ...base, moduleKey: "sentinel-vault-byline", extension: { type: "confluence:contentBylineItem", content } };
    return {
      ...base,
      extension: {
        content, space: { key: "WFH", id: "s1" }, location: "https://wolfaenpak.atlassian.net/wiki/spaces/WFH/pages/368476161",
        config: s === "panel" ? { cardsPerRow: 2, rowsPerPage: 5, showUploadZone: true } : undefined,
        macro: s === "section" ? { body: null } : undefined,
      },
    };
  },
  theme: { enable: async () => {} },
  submit: async () => ({}),
  close: async () => {},
  createAdfRendererIframeProps: async () => { throw new Error("ADF renderer unavailable in harness"); },
};
const router = { open: () => {}, navigate: () => {} };
class Modal { constructor(opts) { this.opts = opts; if (typeof window !== "undefined") window.__lastModal = opts; } open() { /* no-op in harness */ } }
const showFlag = () => ({ close: () => {} });
const requestConfluence = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });

export { invoke, view, router, Modal, showFlag, requestConfluence };
export default { invoke, view, router, Modal, showFlag, requestConfluence };
