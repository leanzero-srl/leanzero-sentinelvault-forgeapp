// SV-SEC-1 follow-on (2026-10-11): a seal record's space is the OBJECT's — its own spaceKey, else
// its page's — never the caller's context or payload. The fallback shape `record.spaceKey ||
// <caller's space>` let a steward of whatever space they stood in (or named) act on every record
// that carried no spaceKey, and the panel's delete writes exactly such records.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { objectSpaceKeyOf } from "../src/server/shared/content-access.js";
import { eq, report } from "./_assert.mjs";

// --- objectSpaceKeyOf: the no-I/O branches ---
eq("the record's own spaceKey wins (no lookup)", await objectSpaceKeyOf({ spaceKey: "ENG", contentId: "1" }), "ENG");
eq("a section record's own spaceKey wins", await objectSpaceKeyOf({ spaceKey: "OPS", pageId: "2" }), "OPS");
eq("no record → null (deny)", await objectSpaceKeyOf(null), null);
eq("a record with no spaceKey and no page → null (deny), never a caller fallback", await objectSpaceKeyOf({ lockedBy: "u" }), null);
eq("a non-object → null", await objectSpaceKeyOf("ENG"), null);

// --- static guard: the fallback shape must not come back in the seal resolvers ---
const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(resolve(here, "../src/server", p), "utf8")
  .split("\n").map((l, i) => ({ where: `${p}:${i + 1}`, l })).filter(({ l }) => !/^\s*(\/\/|\*)/.test(l));
const FILES = ["capsules/sealing/actions.js", "capsules/realms/actions.js", "capsules/panels/actions.js", "capsules/workflow/actions.js"];
// `<record>.spaceKey || <realmKey | spaceKey | contextSpaceKey | spaceKeyOf(req) | req.…>`
const SHAPE = /\b(sealRecord|sealData|record|current|existingSeal)\??\.spaceKey\s*\|\|\s*(realmKey|spaceKey\b|contextSpaceKey|spaceKeyOf\(req\)|req\.)/;
for (const f of FILES) {
  const hits = src(f).filter(({ l }) => SHAPE.test(l)).map(({ where }) => where);
  eq(`${f}: no record.spaceKey || <caller space> fallback`, hits, []);
}
// restore-sealed-artifact must not land a file on the caller's page
const restore = readFileSync(resolve(here, "../src/server/capsules/sealing/actions.js"), "utf8");
const restoreBody = restore.slice(restore.indexOf("export const restoreSealedArtifact"), restore.indexOf("export const purgeSealRecord"));
eq("restore never reads the caller's context page or space", /req\.context\.extension/.test(restoreBody), false);
const purgeBody = restore.slice(restore.indexOf("export const purgeSealRecord"), restore.indexOf("const RIBBON_ATTACHMENT_PAGE_CAP"));
eq("purge never reads the caller's context space", /req\.context\.extension/.test(purgeBody), false);
const realms = readFileSync(resolve(here, "../src/server/capsules/realms/actions.js"), "utf8");
const stewardBody = realms.slice(realms.indexOf("const stewardUnseal"), realms.indexOf("async function dropUnrecordedIndexRow"));
eq("steward-unseal does not destructure the payload's spaceKey/spaceId", /\{\s*attachmentId,\s*spaceKey/.test(stewardBody), false);
eq("steward-unseal has no inline teardown (one teardown: releaseSeal)", /kvs\.delete\(`protection-/.test(stewardBody), false);

report("object-space");
