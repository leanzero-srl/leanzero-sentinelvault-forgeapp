// B2 read confirmations — the pure halves: which version a confirmation must name, whether an
// ack still counts, and the setting's sanitizer.
import { requiredVersion, ackCounts, sanitizeReadConfirmation, readConfirmationRequired, ackKey } from "../src/server/capsules/workflow/read-acks.js";
import { eq, ok, report } from "./_assert.mjs";

const approved = { enforce: true, approvedVersion: 7, approvedAt: "2026-09-05T10:00:00Z", stateId: "approved", spaceKey: "WFH" };
eq("key", ackKey("1", "acc"), "read-ack-1-acc");
eq("required version = the approved baseline", requiredVersion(approved), 7);
eq("not enforced → nothing required", requiredVersion({ ...approved, enforce: false }), null);
eq("approved without a pin → null", requiredVersion({ ...approved, approvedVersion: null }), null);

ok("an ack for the approved version counts", ackCounts({ version: 7, at: "2026-09-05T11:00:00Z" }, approved));
ok("an ack for an older version does NOT count", !ackCounts({ version: 6, at: "2026-09-05T11:00:00Z" }, approved));
ok("no ack → false", !ackCounts(null, approved));
ok("page left the enforce state → nothing counts", !ackCounts({ version: 7, at: "2026-09-05T11:00:00Z" }, { ...approved, enforce: false }));
const unpinned = { ...approved, approvedVersion: null };
ok("unpinned approval: an ack AFTER approval counts", ackCounts({ version: null, at: "2026-09-05T11:00:00Z" }, unpinned));
ok("unpinned approval: an ack BEFORE approval does not", !ackCounts({ version: null, at: "2026-09-05T09:00:00Z" }, unpinned));

eq("sanitize: null in → null", sanitizeReadConfirmation(null), null);
eq("sanitize: enabled + audience kept, names bounded, type normalised", sanitizeReadConfirmation({ enabled: true, audience: [{ type: "group", id: "g1", name: "Ops" }, { id: "u1", name: "x".repeat(200) }, { id: "" }] }),
  { enabled: true, audience: [{ type: "group", id: "g1", name: "Ops" }, { type: "user", id: "u1", name: "x".repeat(120) }] });
eq("sanitize: enabled must be exactly true", sanitizeReadConfirmation({ enabled: "yes", audience: [] }).enabled, false);
ok("required only when enabled AND the page is enforced", readConfirmationRequired({ readConfirmation: { enabled: true, audience: [] } }, approved));
ok("not required when the page is not enforced", !readConfirmationRequired({ readConfirmation: { enabled: true, audience: [] } }, { ...approved, enforce: false }));
ok("not required when the setting is off", !readConfirmationRequired({ readConfirmation: { enabled: false, audience: [] } }, approved));
ok("not required with no setting", !readConfirmationRequired({}, approved));
report("read-acks");
