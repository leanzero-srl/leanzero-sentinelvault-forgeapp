// P1-3: the indexes behind My work. The section owner index is the SAME rule as the attachment
// one (one factory, two families) — this proves the section family keys, wants and never collides,
// and that the space-admin index only holds spaces with a PENDING request.
import {
  sectionreqOwnerKey, wantsSectionOwnerIndex, editreqOwnerKey, wantsOwnerIndex,
  stewardreqSpaceKeyOf, wantsSpaceIndex,
} from "../src/server/capsules/editreq/logic.js";
import { eq, ok, report } from "./_assert.mjs";

const rec = { sectionId: "sec1", requesterAccountId: "acc-R", ownerAccountId: "acc-O", status: "pending", requestedAt: "2026-09-15T00:00:00Z" };
eq("section key = owner prefix + section + requester", sectionreqOwnerKey("acc-O", "sec1", "acc-R"), "sectionreq-owner-acc-O-sec1-acc-R");
ok("a pending section request with an owner is indexed", wantsSectionOwnerIndex(rec));
ok("a denied one is not", !wantsSectionOwnerIndex({ ...rec, status: "denied" }));
ok("one without an owner is not", !wantsSectionOwnerIndex({ ...rec, ownerAccountId: null }));
ok("one without a section is not", !wantsSectionOwnerIndex({ ...rec, sectionId: "" }));
ok("null is not", !wantsSectionOwnerIndex(null));
ok("an ATTACHMENT record does not qualify for the section index (it names artifactId, not sectionId)", !wantsSectionOwnerIndex({ ...rec, sectionId: undefined, artifactId: "att1" }));
ok("a SECTION record does not qualify for the attachment index", !wantsOwnerIndex(rec));
ok("the two families never share a key prefix", !sectionreqOwnerKey("o", "x", "r").startsWith("editreq-owner-") && !editreqOwnerKey("o", "x", "r").startsWith("sectionreq-owner-"));
ok("the owner's prefix never collides with another owner's", !sectionreqOwnerKey("acc-O", "x", "y").startsWith("sectionreq-owner-acc-O2-"));

const sreq = { accountId: "acc-R", spaceKey: "WFH", status: "pending", requestedAt: "2026-09-15T00:00:00Z" };
eq("space index key sanitises the space key the way the request key does", stewardreqSpaceKeyOf("A/B C"), "stewardreq-space-A_B C");
eq("a plain key is kept", stewardreqSpaceKeyOf("WFH"), "stewardreq-space-WFH");
ok("a pending access request puts its space in the index", wantsSpaceIndex(sreq));
ok("a denied one does not", !wantsSpaceIndex({ ...sreq, status: "denied" }));
ok("one without a space does not", !wantsSpaceIndex({ ...sreq, spaceKey: "" }));
ok("null does not", !wantsSpaceIndex(null));
report("my-work-index");
