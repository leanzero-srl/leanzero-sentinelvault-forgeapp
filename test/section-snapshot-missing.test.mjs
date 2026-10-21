// A sealed section whose stored snapshot (`section-snapshot-<sectionId>`) is missing.
//
// The snapshot is the sealed body the restore pass compares against and puts back. When it is
// missing, the pass recovers the sealed body from the page version written at sealing (or the newest
// earlier version the app or the seal's owner saved with the seal's hash), rebuilds the snapshot from
// it, and compares structurally — a hash alone never counts as a match. A removed wrapper comes back
// from that body. A record without contentHash takes it from that body. When nothing trustworthy
// exists, nothing is written: the seal is flagged and its owner told. Real modules, fake Forge.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const { kvs, WhereConditions } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");

const APP = "app-account", OWNER = "acct-owner", OTHER = "acct-other", SPACE = "WF", PAGE = "951", SID = "sec-951";
const KEY = "app/env/static/sentinel-vault-sealed-section";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
const page = (outside, insideBody) => ({ version: 1, type: "doc", content: [para(outside), wrapper(insideBody)] });
const SEALED = [para("SEALED TEXT")];
const sectionOf = (adf) => JSON.stringify(adf.content.find((n) => n.type === "bodiedExtension")?.content ?? null);

// A fixed section body with the same 32-bit content hash as SEALED but different text: the
// structural comparison must tell them apart.
const COLLIDE = [para("TAMPERED etRnLb")];

async function bed({ snapshot = false, contentHash = true, sealedVersion = 2, comments = false } = {}) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(OWNER, { displayName: "Olga Owner" }).addUser(OTHER, { displayName: "Otto Other" });
  w.readers.add("*");
  // v1 the owner's draft, v2 the app's wrap when the section was sealed.
  w.addPage(PAGE, { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), para("SEALED TEXT")] } }, { authorId: APP, adf: page("intro", SEALED) }] });
  w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true, ...(comments ? { enableConfluenceDispatches: true, enableEmailDispatches: true } : {}) });
  await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: OWNER, lockedByName: "Olga Owner", ...(contentHash ? { contentHash: hashAdf(SEALED) } : {}), sectionTitle: "Sealed", sealedVersion, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  if (snapshot) await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(SEALED), bodyContent: SEALED, hash: hashAdf(SEALED), version: 2, originalIndex: 1 });
  return w;
}
const save = (w, authorId, adf) => { const p = w.pages.get(PAGE); p.versions.push({ number: p.versions.length + 1, authorId, adf }); return p.versions.length; };
const ev = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } } });
const rows = async () => ((await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany()).results || []).map((r) => r.value);

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  eq("bed: the fixture body has the sealed hash but other content", [hashAdf(COLLIDE) === hashAdf(SEALED), JSON.stringify(COLLIDE) !== JSON.stringify(SEALED)], [true, true]);

  // 1. A hash-only match is never "untouched".
  {
    const w = await bed();
    const v3 = save(w, OTHER, page("intro", COLLIDE));
    await triggers.pageContentTrigger(ev(OTHER, v3));
    const live = w.live(PAGE);
    ok("[1] no snapshot + a body that only shares the hash: restored to the sealed text", live.authorId === APP && sectionOf(live.adf) === JSON.stringify(SEALED));
  }
  // 2. A changed body is restored from the version written at sealing; the snapshot is repaired.
  {
    const w = await bed();
    const v3 = save(w, OTHER, page("intro", [para("TAMPERED BY OTHER")]));
    await triggers.pageContentTrigger(ev(OTHER, v3));
    const live = w.live(PAGE);
    ok("[2] no snapshot: the non-owner's edit is restored (not just logged)", live.authorId === APP && sectionOf(live.adf) === JSON.stringify(SEALED));
    const snap = await kvs.get(`section-snapshot-${SID}`);
    eq("[2] ...and the snapshot is rebuilt from the sealed version", JSON.stringify(snap?.bodyContent), JSON.stringify(SEALED));
    // No loop and no churn: the app's own event is ignored, a later untouched save writes nothing.
    await triggers.pageContentTrigger(ev(APP, live.number));
    const v5 = save(w, OTHER, page("other changed only the intro", SEALED));
    await triggers.pageContentTrigger(ev(OTHER, v5));
    eq("[2] a later save that leaves the section alone writes nothing", w.live(PAGE).number, v5);
  }
  // 3. A removed wrapper is put back from the sealed version, never from whatever the last version held.
  {
    const w = await bed();
    save(w, OTHER, page("intro", COLLIDE)); // its event never landed
    const v4 = save(w, OTHER, { version: 1, type: "doc", content: [para("intro")] });
    await triggers.pageContentTrigger(ev(OTHER, v4));
    const live = w.live(PAGE);
    ok("[3] the removed section comes back with the sealed text", live.authorId === APP && sectionOf(live.adf) === JSON.stringify(SEALED));
  }
  // 4. A seal record without contentHash: no restore on every save.
  {
    const w = await bed({ snapshot: true, contentHash: false });
    const v3 = save(w, OTHER, page("only the intro changed", SEALED));
    await triggers.pageContentTrigger(ev(OTHER, v3));
    eq("[4] no contentHash, section untouched: nothing written", w.live(PAGE).number, v3);
    const v4 = save(w, OTHER, page("only the intro changed", [para("TAMPERED")]));
    await triggers.pageContentTrigger(ev(OTHER, v4));
    ok("[4] ...and a real edit is still restored", w.live(PAGE).authorId === APP && sectionOf(w.live(PAGE).adf) === JSON.stringify(SEALED));
  }
  // 5. Nothing trustworthy to restore from: the seal is flagged and its owner told, nothing written.
  {
    const w = await bed({ sealedVersion: null, comments: true });
    w.pages.get(PAGE).versions[1].authorId = OTHER; // no version by the app or the owner holds the sealed hash
    const v3 = save(w, OTHER, page("intro", [para("TAMPERED BY OTHER")]));
    await triggers.pageContentTrigger(ev(OTHER, v3));
    eq("[5] nothing trustworthy: no write (nothing is invented)", w.live(PAGE).number, v3);
    const rec = await kvs.get(`section-protection-${SID}`);
    ok("[5] the seal is flagged as broken", !!rec?.broken?.since);
    ok("[5] an activity row records that the section could not be restored", (await rows()).some((r) => r?.type === "section.restore-failed" && r?.target?.id === SID));
    const dispatches = ((await kvs.get("recent-notifications"))?.events || []);
    ok("[5] the owner gets the 'could not restore' notice", dispatches.some((d) => d.type === "revert-failed" && d.sectionId === SID && d.ownerAccountId === OWNER));
    ok("[5] ...and a page comment mentions the owner", w.comments.some((c) => JSON.stringify(c.body || "").includes(OWNER)));
    const n = w.comments.length;
    const v4 = save(w, OTHER, page("intro", [para("TAMPERED AGAIN")]));
    await triggers.pageContentTrigger(ev(OTHER, v4));
    eq("[5] the comment is not repeated on the next save (deduped)", w.comments.length, n);
  }
  // 6. The owner's own edit still re-baselines without a snapshot.
  {
    const w = await bed();
    const v3 = save(w, OWNER, page("intro", [para("OWNER REWROTE IT")]));
    await triggers.pageContentTrigger(ev(OWNER, v3));
    eq("[6] the owner's edit stands (nothing written)", w.live(PAGE).number, v3);
    const snap = await kvs.get(`section-snapshot-${SID}`);
    ok("[6] ...and becomes the new snapshot", JSON.stringify(snap?.bodyContent || "").includes("OWNER REWROTE IT"));
  }
} finally { Object.assign(console, log); }
report("section-snapshot-missing");
