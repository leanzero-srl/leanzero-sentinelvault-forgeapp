import { classifyAttachmentResponse, decideMediaRestoreAction } from "../src/server/infra/attachment-status.js";
import { composeViolationLayout } from "../src/server/infra/notice-blueprints.js";
import { eq, ok, report } from "./_assert.mjs";

// Decision table probed live 2026-08-14 (state/INCIDENT-2026-07-22.md §7): v2 GET returns
// 200+"current", 200+"trashed" (with pageId/version/title/fileId), or 404 after a purge.

// --- classifyAttachmentResponse ---
eq("200 current → current",
  classifyAttachmentResponse(200, { status: "current", version: { number: 3 }, title: "a.png", pageId: "852172", fileId: "f-1" }),
  { status: "current", version: 3, title: "a.png", pageId: "852172", fileId: "f-1" });

eq("200 trashed carries every restore input",
  classifyAttachmentResponse(200, { status: "trashed", version: { number: 1 }, title: "a.png", pageId: "852172", fileId: "f-1" }),
  { status: "trashed", version: 1, title: "a.png", pageId: "852172", fileId: "f-1" });

eq("404 → deleted (purged, unrecoverable)",
  classifyAttachmentResponse(404, null),
  { status: "deleted", version: null, title: null, pageId: null, fileId: null });

eq("200 with missing fields → current with nulls (no crash on sparse payloads)",
  classifyAttachmentResponse(200, {}),
  { status: "current", version: null, title: null, pageId: null, fileId: null });

eq("503 → unknown (callers fail toward pre-probe behavior)",
  classifyAttachmentResponse(503, null).status, "unknown");

eq("429 → unknown", classifyAttachmentResponse(429, null).status, "unknown");

eq("200 archived-ish status maps to current (only 'trashed' is special)",
  classifyAttachmentResponse(200, { status: "draft" }).status, "current");

// --- decideMediaRestoreAction (the Fix-1 classify→action mapping) ---
eq("current → splice (today's path)", decideMediaRestoreAction("current"), "splice");
eq("trashed → restore attachment FIRST, then splice", decideMediaRestoreAction("trashed"), "restore-splice");
eq("deleted → cleanup, never a dead node", decideMediaRestoreAction("deleted"), "cleanup");
eq("unknown → splice (fail toward pre-probe behavior)", decideMediaRestoreAction("unknown"), "splice");
eq("garbage → splice", decideMediaRestoreAction(undefined), "splice");

// --- composeViolationLayout copy honesty (Fix 1 copy fixes + vet F4) ---
const base = { ownerAccountId: "o-1", editorAccountId: "e-1", artifactName: "a.png", pageUrl: null, historyUrl: null };

ok("content-removal reads as human prose (attempted to remove), not the raw verb id",
  composeViolationLayout({ ...base, actionVerb: "content-removal" }).storageBody.includes("attempted to remove"));
ok("content-removal never leaks the raw identifier",
  !composeViolationLayout({ ...base, actionVerb: "content-removal" }).storageBody.includes("attempted to content-removal"));
ok("trash-delete outcome says restored FROM THE TRASH",
  composeViolationLayout({ ...base, actionVerb: "delete" }).storageBody.includes("restored from the trash"));
ok("permanently-deleted outcome never claims restoration",
  !composeViolationLayout({ ...base, actionVerb: "permanently-deleted" }).storageBody.includes("has been restored"));
ok("permanently-deleted states the file is gone + seal released",
  composeViolationLayout({ ...base, actionVerb: "permanently-deleted" }).storageBody.includes("permanently gone and the seal has been released"));
ok("revert-failed admits the failure instead of claiming a revert",
  composeViolationLayout({ ...base, actionVerb: "revert-failed" }).storageBody.includes("could NOT automatically restore"));
ok("null editor (probe-discovered purge) → no accusation mention of an editor",
  !composeViolationLayout({ ...base, editorAccountId: null, actionVerb: "permanently-deleted" }).storageBody.includes('ri:account-id=""'));
ok("null editor copy states the fact without an actor",
  composeViolationLayout({ ...base, editorAccountId: null, actionVerb: "permanently-deleted" }).storageBody.includes("was permanently deleted"));
ok("with an editor, permanently-deleted names the attempt honestly",
  composeViolationLayout({ ...base, actionVerb: "permanently-deleted" }).storageBody.includes("attempted to permanently delete"));

report("media-restore");
