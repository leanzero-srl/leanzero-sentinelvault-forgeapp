// The owner index behind "edit requests waiting on me" (K1 index discipline): only a pending
// request with an owner belongs in it, and the key is one owner's prefix.
import { editreqOwnerKey, wantsOwnerIndex } from "../src/server/capsules/editreq/logic.js";
import { eq, ok, report } from "./_assert.mjs";

const rec = { artifactId: "att1", requesterAccountId: "acc-R", ownerAccountId: "acc-O", status: "pending", requestedAt: "2026-09-05T00:00:00Z" };
eq("key = owner prefix + artifact + requester", editreqOwnerKey("acc-O", "att1", "acc-R"), "editreq-owner-acc-O-att1-acc-R");
ok("a pending request with an owner is indexed", wantsOwnerIndex(rec));
ok("a denied request is not", !wantsOwnerIndex({ ...rec, status: "denied" }));
ok("a request without an owner is not", !wantsOwnerIndex({ ...rec, ownerAccountId: null }));
ok("a request without an artifact is not", !wantsOwnerIndex({ ...rec, artifactId: "" }));
ok("null is not", !wantsOwnerIndex(null));
ok("the owner's prefix never collides with another owner's", !editreqOwnerKey("acc-O", "x", "y").startsWith("editreq-owner-acc-O2-"));
report("editreq-index");
