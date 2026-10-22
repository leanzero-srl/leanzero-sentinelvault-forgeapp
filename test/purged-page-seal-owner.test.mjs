// A seal on a file whose page was deleted from the trash stays (Confluence answers 404 everywhere for
// a purged page, the same answer it gives for a page that leaves the app out, so nothing licenses
// removing it: attachmentPurgeVerdict "container-unseen", and the expiry sweep holds it). The 8.18.0
// note says such a seal "stays listed until its owner or a space admin releases it". Measured live
// on wolfaenpak (2026-10-22, dev e2490d8): the owner's lists ("Files you hold sealed" on My work, and
// "My Sealed Files" in the space console, both enumerate-operator-seals) showed the lapsed seal while
// its page existed and dropped it once the page was purged, so the owner could neither see nor
// release it. Now the row is listed as unavailable (no page link), and the owner's Release works.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const sealingMod = await import("../src/server/capsules/sealing/actions.js");
const sealing = new Map(sealingMod.actions);
sealingMod.setPurgeSettleMs(0);
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const OWNER = "acct-owner";
const OTHER = "acct-other";
const PURGED = "7001"; // deleted from the trash: every read answers 404 (no handler = the fake's 404)
const LIVE = "7002";
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const ahead = (d) => new Date(Date.now() + d * 864e5).toISOString();

let busy = false; // the attachment read answers 503 (not proof of anything)
let listAnswers = false; // the purged page's attachment list answers 200 without the file (a moved file, not proven)
function world() {
  resetFake();
  busy = false; listAnswers = false;
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const base = path.split("?")[0];
    if (method !== "GET") return undefined;
    if (busy && base === "/wiki/api/v2/attachments/att1") return { status: 503, body: { message: "busy" } };
    if (listAnswers && base === `/wiki/api/v2/pages/${PURGED}/attachments`) return { status: 200, body: { results: [] } };
    if (base === "/wiki/api/v2/attachments/att2") return { status: 200, body: { id: "att2", status: "current", title: "live.pdf", fileSize: 2048, pageId: LIVE } };
    if (base === `/wiki/api/v2/pages/${LIVE}`) return { status: 200, body: { id: LIVE, title: "Live page", spaceId: "301", status: "current" } };
    if (base === "/wiki/api/v2/spaces/301") return { status: 200, body: { id: "301", key: "TRS", name: "Trust space" } };
    return undefined;
  });
}
async function seed() {
  await kvs.set("protection-att1", { attachmentId: "att1", lockedBy: OWNER, lockedByName: "Owen Owner", timestamp: ago(10), expiresAt: ago(2), spaceKey: "TRS", spaceId: "301", contentId: PURGED, attachmentName: "budget.xlsx" });
  await kvs.set("space-protection-301-att1", { attachmentName: "budget.xlsx", lockedBy: OWNER, contentId: PURGED, expiresAt: ago(2) });
  await kvs.set("protection-att2", { attachmentId: "att2", lockedBy: OWNER, lockedByName: "Owen Owner", timestamp: ago(1), expiresAt: ahead(5), spaceKey: "TRS", spaceId: "301", contentId: LIVE, attachmentName: "live.pdf" });
  await kvs.set("protection-att3", { attachmentId: "att3", lockedBy: OTHER, lockedByName: "Ola Other", timestamp: ago(10), expiresAt: ago(2), spaceKey: "TRS", spaceId: "301", contentId: PURGED, attachmentName: "theirs.docx" });
}
const list = async (who = OWNER) => (await sealing.get("enumerate-operator-seals")({ payload: { cursor: null, limit: 50 }, context: { accountId: who } })) || {};
const row = (r, id) => (r.attachments || []).find((a) => a.id === id) || null;

world(); await seed();
{
  const r = await list();
  ok("control: the owner's seal on a live page is listed", !!row(r, "att2") && row(r, "att2").isStale === false);
  const a = row(r, "att1");
  ok("the owner's lapsed seal on a page deleted from the trash is listed (was left out)", !!a);
  eq("…marked unavailable", [a?.isStale, a?.staleReason, a?.isExpired], [true, "unavailable", true]);
  eq("…with the name it was sealed under and no page link", [a?.title, a?.pageId, a?.pageUrl, a?.downloadLink], ["budget.xlsx", null, "", null]);
  eq("the count includes it", r.total, 2);
  ok("another person's seal on that page is not listed to the owner", !row(r, "att3"));
  ok("the seal record is kept by the listing (nothing removed on a 404)", !!(await kvs.get("protection-att1")));
  const o = await list(OTHER);
  ok("…and is listed to its own owner only", !!row(o, "att3") && !row(o, "att1"));
}
{
  busy = true;
  const r = await list();
  ok("a read Confluence did not answer (503) proves nothing: the row is skipped for this render, the seal kept", !row(r, "att1") && !!(await kvs.get("protection-att1")));
  busy = false;
  listAnswers = true;
  const r2 = await list();
  ok("a page that answers but no longer holds the file (not proven gone, not unavailable): skipped as before", !row(r2, "att1") && !!(await kvs.get("protection-att1")));
  listAnswers = false;
}
{
  const res = await sealing.get("unseal-artifact")({ payload: { attachmentId: "att1" }, context: { accountId: OWNER, extension: {} } });
  eq("the owner's Release on the listed row succeeds", res?.success, true);
  eq("…the seal and its space index row are gone", [await kvs.get("protection-att1"), await kvs.get("space-protection-301-att1")], [undefined, undefined]);
  const r = await list();
  ok("…and the row leaves the owner's list", !row(r, "att1") && !!row(r, "att2"));
  const denied = await sealing.get("unseal-artifact")({ payload: { attachmentId: "att3" }, context: { accountId: OWNER, extension: {} } });
  ok("someone else's seal on that page is still refused to the owner", denied?.success === false && !!(await kvs.get("protection-att3")));
}
{
  // The space console card names only THIS row Missing (another attachment status, such as archived,
  // keeps its usual label and Extend): review 2026-10-22.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const ui = readFileSync(fileURLToPath(new URL("../src/ui/surfaces/realm-console/index.jsx", import.meta.url)), "utf8");
  ok("the My Sealed Files card marks Missing only the unavailable row", /const unavailable = artifact\.isStale === true && artifact\.staleReason === "unavailable"/.test(ui));
}
report("purged-page-seal-owner");
