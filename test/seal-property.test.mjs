// The `protection-` page property is readable by anyone who can read the page (2026-10-04):
// it may carry the account id and timestamps, never an email, a display name or the note.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { sealPropertyValue, sealPropertyNeedsScrub, SEAL_PROPERTY_FIELDS } from "../src/server/capsules/sealing/seal-property.js";

const legacy = {
  lockedBy: "712020:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", lockedByEmail: "jane@example.com", lockedByName: "Jane Doe",
  timestamp: "2026-10-01T10:00:00.000Z", expiresAt: "2026-10-02T10:00:00.000Z", lockDuration: 86400,
  spaceKey: "SV", spaceId: "123", contentId: "456", attachmentId: "att789", attachmentName: "Jane Doe CV.pdf",
  sealedVersion: 2, sealedFileId: "f1", downloadLink: "/download/x", mediaBaseline: { width: 1 }, embedded: true,
  note: "for Jane's review", extensionCount: 1, extendedBy: "712020:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};
const v = sealPropertyValue(legacy);
eq("keeps exactly the whitelist", Object.keys(v).sort(), SEAL_PROPERTY_FIELDS.filter((k) => k in legacy).sort());
ok("no email", !("lockedByEmail" in v));
ok("no display name", !("lockedByName" in v));
ok("no note", !("note" in v));
ok("no file name", !("attachmentName" in v));
eq("account id kept", v.lockedBy, legacy.lockedBy);
eq("timestamps kept", [v.timestamp, v.expiresAt], [legacy.timestamp, legacy.expiresAt]);
ok("no string anywhere in the value looks like an email", !JSON.stringify(v).includes("@"));
eq("null in → empty object", sealPropertyValue(null), {});
eq("legacy value needs a scrub", sealPropertyNeedsScrub(legacy), true);
eq("a clean value does not", sealPropertyNeedsScrub(v), false);
eq("a non-object is never scrubbed", sealPropertyNeedsScrub("x"), false);

// Static: the only writer of the property goes through the whitelist, and no seal record stores an email.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../src/server");
const logic = readFileSync(resolve(root, "capsules/sealing/logic.js"), "utf8");
const writer = logic.slice(logic.indexOf("export async function writeSealContentProp"), logic.indexOf("export async function removeSealContentProp"));
ok("writer computes the whitelisted value", /const value = sealPropertyValue\(sealData\)/.test(writer));
ok("writer never sends sealData itself", !/value:\s*sealData/.test(writer));
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
walk(root);
const emailWrites = files.filter((f) => /lockedByEmail\s*:/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
eq("no record writes lockedByEmail", emailWrites, []);
report("seal-property");
