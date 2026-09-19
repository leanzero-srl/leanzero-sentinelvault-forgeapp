// SEC-2 — the ONE rule for who owns a seal while a page is Approved (workflow-held) and how a
// seal is held and handed back with its remaining time. Pure; no Forge.
import { isWorkflowHeld, workflowHoldsSeals, holdSeal, handBackSeal, mayEditInside, heldRefusal, heldLabel, HELD_REASON } from "../src/server/shared/seal-authority.js";
import { eq, ok, report } from "./_assert.mjs";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const seal = { sectionId: "s1", pageId: "9", lockedBy: "owner", expiresAt: new Date(NOW + 2 * 3600_000).toISOString(), contentHash: "h" };
const record = { pageId: "9", stateId: "approved", enforce: true, approvedVersion: 3 };

// ── predicates ──────────────────────────────────────────────────────────────────────────────
eq("a plain seal is not held", isWorkflowHeld(seal), false);
eq("no record → the workflow holds nothing", workflowHoldsSeals(null), false);
eq("a draft record holds nothing", workflowHoldsSeals({ stateId: "draft", enforce: false }), false);
eq("an enforce record holds the seals", workflowHoldsSeals(record), true);

// ── hold ────────────────────────────────────────────────────────────────────────────────────
const held = holdSeal(seal, { record, stateName: "Approved", now: NOW });
eq("held: expiry suspended", held.expiresAt, null);
eq("held: the remaining time is kept (2 h)", held.workflowHeld.remainingMs, 2 * 3600_000);
eq("held: the previous expiry is kept for the trail", held.workflowHeld.prevExpiresAt, seal.expiresAt);
eq("held: names the page and the state", [held.workflowHeld.pageId, held.workflowHeld.stateId, held.workflowHeld.stateName], ["9", "approved", "Approved"]);
eq("held: the owner is untouched (the trail)", held.lockedBy, "owner");
eq("held: the hash is untouched", held.contentHash, "h");
ok("held: idempotent (a second Approved entry changes nothing)", holdSeal(held, { record, now: NOW + 5000 }) === held);
eq("hold a seal with no expiry → remaining null", holdSeal({ ...seal, expiresAt: null }, { record, now: NOW }).workflowHeld.remainingMs, null);
eq("hold an already-lapsed seal → remaining 0", holdSeal({ ...seal, expiresAt: new Date(NOW - 1000).toISOString() }, { record, now: NOW }).workflowHeld.remainingMs, 0);
eq("hold null → null", holdSeal(null, { record }), null);

// ── hand back ───────────────────────────────────────────────────────────────────────────────
const later = NOW + 26 * 3600_000; // Approved for 26 hours
const back = handBackSeal(held, { now: later });
eq("handed back: the 2 hours are still there", back.expiresAt, new Date(later + 2 * 3600_000).toISOString());
ok("handed back: the hold record is gone", !("workflowHeld" in back));
ok("handed back: stamped", !!back.handedBackAt);
eq("handed back: a no-expiry seal stays without", handBackSeal(holdSeal({ ...seal, expiresAt: null }, { record, now: NOW }), { now: later }).expiresAt, null);
eq("handed back: a lapsed-when-held seal comes back lapsed (expires now)", handBackSeal(holdSeal({ ...seal, expiresAt: new Date(NOW - 1000).toISOString() }, { record, now: NOW }), { now: later }).expiresAt, new Date(later).toISOString());
ok("handing back a plain seal changes nothing", handBackSeal(seal, { now: later }) === seal);

// ── who may edit inside ─────────────────────────────────────────────────────────────────────
eq("personal: the owner", mayEditInside({ seal, actorId: "owner" }), true);
eq("personal: a grantee", mayEditInside({ seal, actorId: "g", hasGrant: true }), true);
eq("personal: anyone else", mayEditInside({ seal, actorId: "x" }), false);
eq("held: the owner is NOT privileged unless in the workflow's set", mayEditInside({ seal: held, actorId: "owner", isOwner: true }), false);
eq("held: a grantee is frozen out", mayEditInside({ seal: held, actorId: "g", hasGrant: true }), false);
eq("held: the workflow's privileged set edits freely", mayEditInside({ seal: held, actorId: "approver", workflowPrivileged: true }), true);
eq("held: the owner who is ALSO an approver edits freely", mayEditInside({ seal: held, actorId: "owner", isOwner: true, workflowPrivileged: true }), true);

// ── refusals and copy ───────────────────────────────────────────────────────────────────────
eq("plain seal: nothing is refused", ["release", "extend", "grant", "request"].map((a) => heldRefusal(seal, a)), [null, null, null, null]);
eq("held: every personal action is refused with the one sentence", ["release", "extend", "grant", "approve", "deny", "request"].map((a) => heldRefusal(held, a)), Array(6).fill(HELD_REASON));
eq("held: a steward's force-release is the one door out", heldRefusal(held, "force-release"), null);
eq("the sentence", HELD_REASON, "Locked by the approval of this page — changes go through the workflow");
eq("row label", heldLabel(held), "Locked by the approval of this page (Approved)");
eq("row label on a plain seal", heldLabel(seal), null);

report("seal-authority");
