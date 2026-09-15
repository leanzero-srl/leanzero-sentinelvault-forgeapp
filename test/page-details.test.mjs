// 5.0 page-details modal — the pure row-state → primary-action mapping (mockup decision 5: one
// primary action per seal row, by state) and what sits under ⋯. logic.js binds @forge/api and
// @forge/kvs at import (both load in plain node); the two mappings never touch them.
import { primaryActionFor, menuActionsFor } from "../src/server/capsules/page-details/logic.js";
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
ok("…the hint says when to try again", /48 hours/.test(primaryActionFor({ ...base, myEditStatus: "denied" }).hint));
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
eq("owner attachment: Extend + Copy link (Release is the primary)", menuActionsFor({ ...base, isMine: true }), ["extend", "copy-link"]);
eq("owner attachment with a request: Extend + Release + Copy link", menuActionsFor({ ...base, isMine: true, pendingRequests: [req] }), ["extend", "release", "copy-link"]);
eq("owner section: Copy link only (no extend for sections; Release is primary)", menuActionsFor({ ...base, kind: "section", isMine: true }), ["copy-link"]);
eq("owner section with a request: Release + Copy link", menuActionsFor({ ...base, kind: "section", isMine: true, pendingRequests: [req] }), ["release", "copy-link"]);
eq("requester on an attachment: Watch + Copy link", menuActionsFor(base), ["watch", "copy-link"]);
eq("…already watching → Stop watching", menuActionsFor({ ...base, watching: true }), ["unwatch", "copy-link"]);
eq("requester on a section: Copy link only (no watch for sections)", menuActionsFor({ ...base, kind: "section" }), ["copy-link"]);
eq("space admin on someone else's seal: + Force release", menuActionsFor(base, { isSpaceAdmin: true }), ["watch", "copy-link", "force-release"]);
eq("space admin on their OWN seal: no Force release (Release is theirs anyway)", menuActionsFor({ ...base, isMine: true }, { isSpaceAdmin: true }), ["extend", "copy-link"]);
eq("space admin on an expired foreign seal: Force release is the only way", menuActionsFor({ ...base, isExpired: true }, { isSpaceAdmin: true }), ["watch", "copy-link", "force-release"]);
eq("trashed: Copy link only", menuActionsFor({ ...base, isMine: true, isTrashed: true }, { isSpaceAdmin: true }), ["copy-link"]);
eq("unsealed attachment: Copy link only", menuActionsFor({ ...base, sealed: false }), ["copy-link"]);
eq("garbage in → nothing", menuActionsFor(undefined), []);

report("page-details");
