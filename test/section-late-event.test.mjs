// Sealed sections and LATE page events (2026-10-16, fix/workflow-86 follow-up). The seal passes judge
// the LIVE page body, but took the editor from the EVENT. When an older event (the seal owner's)
// arrives after a newer save by someone else, the owner was credited with the newer body: the
// non-owner's edit inside the sealed section was re-baselined as the owner's own, and the newer
// save's own event then found nothing to restore. Same rule as the workflow fix: an event is
// judged for the version it describes — the live body is attributed to the live version's author.
import "./_forge-fake/install.mjs";
import { eq, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const { kvs } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
const { sectionRetryKey } = await import("../src/server/shared/section-retry.js");

const APP = "app-account", OWNER = "acct-owner", OTHER = "acct-other", SPACE = "WF", PAGE = "601", SID = "sec-1";
const KEY = "app/env/static/sentinel-vault-sealed-section";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
const page = (outside, inside) => ({ version: 1, type: "doc", content: [para(outside), wrapper([para(inside)])] });
const sectionText = (adf) => JSON.stringify(adf.content.find((n) => n.type === "bodiedExtension")?.content);

async function bed() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(OWNER, { displayName: "Olga Owner" }).addUser(OTHER, { displayName: "Otto Other" });
  w.readers.add("*");
  w.addPage(PAGE, { versions: [{ authorId: OWNER, adf: page("intro", "SEALED TEXT") }] });
  w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
  const body = [para("SEALED TEXT")];
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, lockedBy: OWNER, lockedByName: "Olga Owner", contentHash: hashAdf(body), sectionTitle: "Sealed", expiresAt: new Date(Date.now() + 864e5).toISOString() });
  await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(body), bodyContent: body, hash: hashAdf(body), version: 1, originalIndex: 1 });
  return w;
}
const save = (w, authorId, adf) => { const p = w.pages.get(PAGE); p.versions.push({ number: p.versions.length + 1, authorId, adf }); return p.versions.length; };
const ev = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } } });

const log = { info: console.info, warn: console.warn, error: console.error };
console.info = console.warn = console.error = () => {};
try {
  // Control: in-order delivery restores the non-owner's edit.
  {
    const w = await bed();
    const v2 = save(w, OWNER, page("owner changed the intro", "SEALED TEXT"));
    await triggers.pageContentTrigger(ev(OWNER, v2));
    const v3 = save(w, OTHER, page("owner changed the intro", "TAMPERED BY OTHER"));
    await triggers.pageContentTrigger(ev(OTHER, v3));
    eq("control (in order): the app restored the section", [w.live(PAGE).authorId, sectionText(w.live(PAGE).adf).includes("SEALED TEXT")], [APP, true]);
  }
  // The late event: the owner's v2 event arrives AFTER the other person's v3 is live.
  {
    const w = await bed();
    const v2 = save(w, OWNER, page("owner changed the intro", "SEALED TEXT"));
    const v3 = save(w, OTHER, page("owner changed the intro", "TAMPERED BY OTHER"));
    await triggers.pageContentTrigger(ev(OWNER, v2)); // late
    const snap = await kvs.get(`section-snapshot-${SID}`);
    eq("late owner event: the other person's text is NOT taken as the owner's baseline", JSON.stringify(snap.bodyContent).includes("TAMPERED"), false);
    await triggers.pageContentTrigger(ev(OTHER, v3)); // the newer save's own event
    const live = w.live(PAGE);
    eq("late owner event: the sealed section ends restored", sectionText(live.adf).includes("SEALED TEXT") && !sectionText(live.adf).includes("TAMPERED"), true);
  }
  // The owner's own later edit, judged by a late event of their own earlier version, still stands.
  {
    const w = await bed();
    const v2 = save(w, OWNER, page("intro", "SEALED TEXT"));
    save(w, OWNER, page("intro", "OWNER REWROTE THE SECTION"));
    await triggers.pageContentTrigger(ev(OWNER, v2)); // late, but the live version is the owner's too
    const snap = await kvs.get(`section-snapshot-${SID}`);
    eq("owner's own newer edit is re-baselined (live author = owner)", JSON.stringify(snap.bodyContent).includes("OWNER REWROTE"), true);
    eq("…and nothing was written", w.live(PAGE).authorId, OWNER);
  }
  // A skipped late event says nothing about the live body: a pending section-restore retry stays.
  {
    const w = await bed();
    const v2 = save(w, OWNER, page("owner changed the intro", "SEALED TEXT"));
    save(w, OTHER, page("owner changed the intro", "TAMPERED BY OTHER"));
    await kvs.set(sectionRetryKey(PAGE), { pageId: PAGE, attempts: 1, firstAt: new Date().toISOString() });
    await triggers.pageContentTrigger(ev(OWNER, v2));
    eq("late owner event: the pending retry marker is kept", !!(await kvs.get(sectionRetryKey(PAGE))), true);
  }
} finally { Object.assign(console, log); }
report("section-late-event");
