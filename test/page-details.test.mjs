// 5.0 page-details modal — the pure row-state → primary-action mapping (mockup decision 5: one
// primary action per seal row, by state) and what sits under ⋯. logic.js binds @forge/api and
// @forge/kvs at import (both load in plain node); the two mappings never touch them.
import { primaryActionFor, menuActionsFor } from "../src/server/capsules/page-details/logic.js";
import { expiryWarning, EXPIRY_WARNING_MS } from "../src/server/capsules/page-details/row-state.js";
import { eq, ok, report } from "./_assert.mjs";

const base = { kind: "attachment", isMine: false, isExpired: false, isTrashed: false, ownerName: "Mihai Perdum", expiresAt: "2026-10-01T09:00:00.000Z", myEditStatus: "none", myEditExpiresAt: null, pendingRequests: [] };
const kind = (row, viewer) => primaryActionFor(row, viewer).kind;

// ── the five states ──────────────────────────────────────────────────────────────────────────
eq("unsealed attachment → Seal", kind({ ...base, sealed: false }), "seal");
eq("another user's seal, no request yet → Request edit", kind(base), "request");
eq("…and it is not disabled", primaryActionFor(base).disabled, undefined);
eq("my request pending → Waiting for {owner}", kind({ ...base, myEditStatus: "pending" }), "waiting");
eq("…carrying the owner's name", primaryActionFor({ ...base, myEditStatus: "pending" }).owner, "Mihai Perdum");
eq("granted → Edit now until {time}", kind({ ...base, myEditStatus: "granted", myEditExpiresAt: "2026-09-20T17:00:00.000Z" }), "editnow");
eq("…until the grant's own expiry", primaryActionFor({ ...base, myEditStatus: "granted", myEditExpiresAt: "2026-09-20T17:00:00.000Z" }).until, "2026-09-20T17:00:00.000Z");
eq("…falling back to the seal's expiry when the grant has none", primaryActionFor({ ...base, myEditStatus: "granted" }).until, base.expiresAt);
eq("my own seal → Release", kind({ ...base, isMine: true }), "release");

// ── owner vs requester vs grantee vs expired ─────────────────────────────────────────────────
const req = { requesterAccountId: "acc-G", requesterName: "Gabriela Perdum", reason: "totals need fixing" };
eq("owner with a pending request → Approve/Decline inline", kind({ ...base, isMine: true, pendingRequests: [req] }), "decide");
eq("…for that request", primaryActionFor({ ...base, isMine: true, pendingRequests: [req] }).request.requesterAccountId, "acc-G");
eq("owner: a request does not change the primary when it is someone else's seal", kind({ ...base, pendingRequests: [req] }), "request");
eq("declined within the cooldown → Request edit, disabled", kind({ ...base, myEditStatus: "denied" }), "request");
eq("…disabled with a hint", primaryActionFor({ ...base, myEditStatus: "denied" }).disabled, true);
ok("…the hint says when to try again (the server's retry time, never a typed-in 48 hours)", /ask again after/.test(primaryActionFor({ ...base, myEditStatus: "denied", myRetryAt: "2026-09-17T12:50:00.000Z" }).hint) && !/48/.test(primaryActionFor({ ...base, myEditStatus: "denied" }).hint));
eq("expired, someone else's attachment → Expired (no primary)", kind({ ...base, isExpired: true }), "expired");
eq("expired, someone else's attachment, even with a grant → Expired", kind({ ...base, isExpired: true, myEditStatus: "granted" }), "expired");
eq("expired, mine → Release", kind({ ...base, isExpired: true, isMine: true }), "release");
eq("expired section, page editor → Release (server rule F6)", kind({ ...base, kind: "section", isExpired: true }, { canEditPage: true }), "release");
eq("expired section, not a page editor → Expired", kind({ ...base, kind: "section", isExpired: true }, { canEditPage: false }), "expired");
eq("in the trash → no primary", kind({ ...base, isMine: true, isTrashed: true }), "trashed");
eq("in the trash beats a pending request", kind({ ...base, isMine: true, isTrashed: true, pendingRequests: [req] }), "trashed");
eq("section rows map the same way (request)", kind({ ...base, kind: "section" }), "request");
eq("section rows map the same way (mine)", kind({ ...base, kind: "section", isMine: true }), "release");
eq("garbage in → none", kind(null), "none");

// ── ⋯ menu ───────────────────────────────────────────────────────────────────────────────────
eq("owner attachment: Extend + Give access + Copy link (Release is the primary)", menuActionsFor({ ...base, isMine: true }), ["extend", "give-access", "copy-link"]);
eq("owner attachment with a request: Extend + Release + Copy link", menuActionsFor({ ...base, isMine: true, pendingRequests: [req] }), ["extend", "give-access", "release", "copy-link"]);
eq("owner section: Extend + Give access + Copy link (SEC-7: sections extend; Release is primary)", menuActionsFor({ ...base, kind: "section", isMine: true }), ["extend", "give-access", "copy-link"]);
eq("owner section with a request: Extend + Give access + Release + Copy link (SEC-7)", menuActionsFor({ ...base, kind: "section", isMine: true, pendingRequests: [req] }), ["extend", "give-access", "release", "copy-link"]);
eq("requester on an attachment: Watch + Copy link", menuActionsFor(base), ["watch", "copy-link"]);
eq("…already watching → Stop watching", menuActionsFor({ ...base, watching: true }), ["unwatch", "copy-link"]);
eq("requester on a section: Copy link only (no watch for sections)", menuActionsFor({ ...base, kind: "section" }), ["copy-link"]);
eq("space admin on someone else's seal: + Force release", menuActionsFor(base, { isSpaceAdmin: true }), ["watch", "copy-link", "give-access", "force-release"]);
eq("space admin on their OWN seal: no Force release (Release is theirs anyway)", menuActionsFor({ ...base, isMine: true }, { isSpaceAdmin: true }), ["extend", "give-access", "copy-link"]);
eq("space admin on an expired foreign seal: Force release is the only way", menuActionsFor({ ...base, isExpired: true }, { isSpaceAdmin: true }), ["watch", "copy-link", "force-release"]);
eq("trashed: Copy link only", menuActionsFor({ ...base, isMine: true, isTrashed: true }, { isSpaceAdmin: true }), ["copy-link"]);
eq("unsealed attachment: Copy link only", menuActionsFor({ ...base, sealed: false }), ["copy-link"]);
eq("garbage in → nothing", menuActionsFor(undefined), []);

// ── SEC-7: sections extend; the owner sees the lapse coming ────────────────────────────────
{
  const mineSection = { ...base, kind: "section", isMine: true, ownerName: "me" };
  ok("SEC-7: a section's owner gets Extend under ⋯", menuActionsFor(mineSection).includes("extend"));
  ok("SEC-7: an expired section still offers Extend (it re-arms from now)", menuActionsFor({ ...mineSection, isExpired: true }).includes("extend"));
  ok("SEC-7: a non-owner never gets Extend", !menuActionsFor({ ...base, kind: "section" }).includes("extend"));
  ok("SEC-7: attachments unchanged", menuActionsFor({ ...base, isMine: true }).includes("extend"));
  const NOW = Date.parse("2026-09-20T12:00:00Z");
  const at = (h) => new Date(NOW + h * 3600000).toISOString();
  eq("SEC-7: 2 days left → 'expires in 2 days'", expiryWarning({ ...mineSection, expiresAt: at(50) }, NOW), { text: "expires in 2 days", hours: 50 });
  eq("SEC-7: 30 hours left → tomorrow", expiryWarning({ ...mineSection, expiresAt: at(30) }, NOW).text, "expires tomorrow");
  eq("SEC-7: 5 hours left", expiryWarning({ ...mineSection, expiresAt: at(5) }, NOW).text, "expires in 5 hours");
  eq("SEC-7: 20 minutes left", expiryWarning({ ...mineSection, expiresAt: at(0.3) }, NOW).text, "expires within the hour");
  eq("SEC-7: beyond the 3-day window → nothing", expiryWarning({ ...mineSection, expiresAt: at(80) }, NOW), null);
  eq("SEC-7: already lapsed → nothing (the row says Expired)", expiryWarning({ ...mineSection, expiresAt: at(-1) }, NOW), null);
  eq("SEC-7: not mine → nothing", expiryWarning({ ...base, kind: "section", expiresAt: at(10) }, NOW), null);
  eq("SEC-7: no expiry → nothing", expiryWarning({ ...mineSection, expiresAt: null }, NOW), null);
  eq("SEC-7: the window is three days", EXPIRY_WARNING_MS, 3 * 24 * 3600 * 1000);
}
// ── SEC-2: a seal held by the workflow (the page is Approved) ───────────────────────────────
{
  const heldMine = { ...base, kind: "section", isMine: true, workflowHeld: true };
  const heldTheirs = { ...base, kind: "section", workflowHeld: true };
  eq("SEC-2: the owner's held row has no Release — the state is the primary", primaryActionFor(heldMine).kind, "held");
  eq("SEC-2: …with the one label", primaryActionFor(heldMine).label, "Locked by the approval of this page");
  eq("SEC-2: a stranger's held row offers no Request edit", primaryActionFor(heldTheirs).kind, "held");
  eq("SEC-2: a pending request on a held seal is not offered for decision", primaryActionFor({ ...heldMine, pendingRequests: [{}] }).kind, "held");
  eq("SEC-2: the owner's menu is Copy link only (no Extend / Give access / Release)", menuActionsFor(heldMine), ["copy-link"]);
  eq("SEC-2: a stranger's menu is Copy link only", menuActionsFor(heldTheirs, { canEditPage: true }), ["copy-link"]);
  eq("SEC-2: a space admin keeps the break-glass Force release", menuActionsFor(heldTheirs, { isSpaceAdmin: true }), ["copy-link", "force-release"]);
  eq("SEC-2: a held attachment likewise", [primaryActionFor({ ...base, isMine: true, workflowHeld: true }).kind, menuActionsFor({ ...base, isMine: true, workflowHeld: true })], ["held", ["copy-link"]]);
  eq("SEC-2: an unsealed attachment is untouched by the flag", primaryActionFor({ ...base, sealed: false, workflowHeld: true }).kind, "seal");
  eq("SEC-2: no lapse warning while held (expiry is paused)", expiryWarning({ ...heldMine, expiresAt: null }), null);
}
report("page-details");
