// Enforcement is decided from the app's own KVS records, never from a page property.
//
// Sentinel Vault mirrors state into Confluence page properties (`sentinel-vault-workflow`,
// `protection-`, `section-protection-`) for CQL and the UI. Anyone who may edit a page may also
// change or delete those properties, so the page-content pipeline decides whether a page event is
// enforced from KVS: the workflow record, and a per-page seal marker (shared/guarded-page.js) with the
// seal records behind it. Each scenario deletes the property, keeps the KVS record, and expects the
// event to be enforced. Plus: the markers' backfill, a seal written through the real action, and a
// source guard. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
const { capturePresentation } = await import("../src/server/infra/media-presentation.js");
const { sealSection } = await import("../src/server/capsules/section-seals/actions.js");
const gp = await import("../src/server/shared/guarded-page.js").catch(() => ({}));

const APP = "app-account", OWNER = "acct-owner", OTHER = "acct-other", APPROVER = "acct-approver", SPACE = "WF", PAGE = "881", SID = "sec-881";
const KEY = "app/env/static/sentinel-vault-sealed-section";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const heading = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
const SEALED = [para("SEALED TEXT")];
const FILE = "file-uuid-881", ATT = "att881";
const media = (layout, width) => ({ type: "mediaSingle", attrs: { layout, width }, content: [{ type: "media", attrs: { id: FILE, type: "file", collection: "contentId-881", width: 400, height: 300 } }] });
const text = (v) => JSON.stringify(v?.adf || v);
const ev = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });

async function world(firstAdf) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(OWNER, { displayName: "Olga" }).addUser(OTHER, { displayName: "Otto" }).addUser(APPROVER, { displayName: "Ana" })
    .addPage(PAGE, { versions: [{ authorId: OWNER, adf: firstAdf }] });
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("section-macro-extension-key", KEY);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  const save = (author, adf) => { const p = w.pages.get(PAGE); p.versions.push({ number: p.versions.length + 1, authorId: author, adf }); return p.versions.length; };
  return { w, save, dropProps: () => w.pages.get(PAGE).props.clear() };
}
async function sectionBed() {
  const b = await world({ version: 1, type: "doc", content: [para("intro"), wrapper(SEALED)] });
  b.w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
  await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: OWNER, contentHash: hashAdf(SEALED), sectionTitle: "Sealed", sealedVersion: 1, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(SEALED), bodyContent: SEALED, hash: hashAdf(SEALED), version: 1, originalIndex: 1 });
  return b;
}
async function mediaBed() {
  const b = await world({ version: 1, type: "doc", content: [para("intro"), media("center", 50)] });
  b.w.pages.get(PAGE).props.set("protection-", { id: "901", version: 1, value: { lockedBy: OWNER } });
  await kvs.set(`protection-${ATT}`, { lockedBy: OWNER, contentId: PAGE, attachmentId: ATT, attachmentName: "plan.png", sealedFileId: FILE, embedded: true, mediaBaseline: capturePresentation(media("center", 50)), spaceKey: SPACE, timestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return b;
}

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  // 1. Approved page, `sentinel-vault-workflow` property deleted: the edit is still reverted.
  {
    const { w, save, dropProps } = await world({ version: 1, type: "doc", content: [para("THE APPROVED TEXT")] });
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default", enforceMode: "revert", approval: { approvers: [{ type: "user", id: APPROVER }], mode: "any", min: 1 } });
    await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: OWNER, workflowId: "default" });
    await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: OWNER });
    await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, approvers: [APPROVER], approvedVersion: 1 });
    dropProps();
    const v2 = save(OTHER, { version: 1, type: "doc", content: [para("THE APPROVED TEXT"), para("UNAPPROVED")] });
    await triggers.pageContentTrigger(ev(OTHER, v2));
    ok("[1] workflow property deleted: the unapproved edit is still reverted", w.live(PAGE).authorId === APP && !text(w.live(PAGE)).includes("UNAPPROVED"));
  }
  // 2. Sealed section, `section-protection-` property deleted: the edit is still restored.
  {
    const { w, save, dropProps } = await sectionBed();
    dropProps();
    const v2 = save(OTHER, { version: 1, type: "doc", content: [para("intro"), wrapper([para("TAMPERED")])] });
    await triggers.pageContentTrigger(ev(OTHER, v2));
    ok("[2] section property deleted: the sealed section is still restored", w.live(PAGE).authorId === APP && text(w.live(PAGE)).includes("SEALED TEXT") && !text(w.live(PAGE)).includes("TAMPERED"));
  }
  // 3. Sealed file, `protection-` property deleted: its on-page layout is still restored.
  {
    const { w, save, dropProps } = await mediaBed();
    dropProps();
    const v2 = save(OTHER, { version: 1, type: "doc", content: [para("intro"), media("full-width", 100)] });
    await triggers.pageContentTrigger(ev(OTHER, v2));
    const node = w.live(PAGE).adf.content.find((n) => n.type === "mediaSingle");
    ok("[3] file property deleted: the sealed file's layout is still restored", w.live(PAGE).authorId === APP && node?.attrs?.layout === "center");
  }
  // 4. The markers: the sweep's backfill writes one per sealed page and sets the done flag; after
  //    that the marker (not the property) is what the pipeline reads.
  {
    const { w, save, dropProps } = await sectionBed();
    await triggers.pageGuardSweep();
    ok("[4] the backfill wrote the page's marker", !!(await kvs.get(`guarded-page-${PAGE}`)));
    ok("[4] ...and set the done flag", !!(await kvs.get("guard-marker-backfill-v1")));
    dropProps();
    const v2 = save(OTHER, { version: 1, type: "doc", content: [para("intro"), wrapper([para("TAMPERED")])] });
    await triggers.pageContentTrigger(ev(OTHER, v2));
    ok("[4] after the backfill, property deleted: still restored (by the marker)", w.live(PAGE).authorId === APP && !text(w.live(PAGE)).includes("TAMPERED"));
    // A page with no seal and no marker, backfill done: no seal scan, nothing written.
    await kvs.delete(`guarded-page-${PAGE}`);
    eq("[4] no marker after the backfill: the page carries no seal", await gp.pageMayCarrySeals?.(PAGE), false);
    eq("[4] ...unless the marker cannot be read (fail closed)", await (async () => { const real = kvs.get; kvs.get = async () => { throw new Error("kvs down"); }; try { return await gp.pageMayCarrySeals?.(PAGE); } finally { kvs.get = real; } })(), true);
  }
  // 5. A seal made through the real action writes the marker.
  {
    const { w, save, dropProps } = await world({ version: 1, type: "doc", content: [para("intro"), heading("Scope"), para("scope text")] });
    await kvs.set("guard-marker-backfill-v1", { at: "x" });
    const r = await sealSection({ payload: { pageId: PAGE, headingIndex: 1, headingText: "Scope" }, context: { accountId: OWNER, extension: { content: { id: PAGE, type: "page", space: { key: SPACE } }, space: { key: SPACE } } } });
    eq("[5] seal-section succeeded", r?.success, true);
    ok("[5] ...and wrote the page's marker", !!(await kvs.get(`guarded-page-${PAGE}`)));
    dropProps();
    const live = w.live(PAGE).adf;
    const tampered = JSON.parse(JSON.stringify(live));
    tampered.content.find((n) => n.type === "bodiedExtension").content = [para("TAMPERED")];
    const v = save(OTHER, tampered);
    await triggers.pageContentTrigger(ev(OTHER, v));
    ok("[5] property deleted after sealing: the section is still restored", w.live(PAGE).authorId === APP && !text(w.live(PAGE)).includes("TAMPERED"));
  }
  // 6. The workflow record cannot be read: never treated as unprotected.
  {
    const { save } = await world({ version: 1, type: "doc", content: [para("x")] });
    const real = kvs.get;
    kvs.get = async (k) => { if (String(k).startsWith("workflow-state-")) throw new Error("kvs down"); return real(k); };
    let d;
    try { d = await triggers.collectWorkflowEnforcementForPage(PAGE, OTHER, save(OTHER, { version: 1, type: "doc", content: [para("y")] }), APP, SPACE); } finally { kvs.get = real; }
    eq("[6] record unreadable: 'unknown' (nothing accepted, nothing undone), not 'not protected'", d?.action, "unknown");
  }
  // 7. A restore re-opens the backfill.
  {
    await kvs.set("guard-marker-backfill-v1", { at: "x" });
    await gp.reopenGuardBackfill?.();
    eq("[7] reopenGuardBackfill clears the done flag", await kvs.get("guard-marker-backfill-v1"), undefined);
    const src = (await import("node:fs")).readFileSync(new URL("../src/server/capsules/backup/engine.js", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function writeRestoredEntries"), src.indexOf("export async function runRestore"));
    const at = (re) => fn.search(re);
    ok("[7] runRestore writes through writeRestoredEntries (markers first, re-open after the writes)", /await writeRestoredEntries\(toWrite\)/.test(src)
      && at(/ensureGuardMarkers\(/) >= 0 && at(/ensureGuardMarkers\(/) < at(/await writeEntries\(toWrite\)/)
      && at(/await writeEntries\(toWrite\);\s*\n\s*await reopenGuardBackfill\(\);/) >= 0);
  }
} finally { Object.assign(console, log); }

// 8. Source guard: triggers.js decides nothing from a page property.
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/server/triggers.js", import.meta.url), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  eq("[8] triggers.js reads no page property (`properties?key=`)", (src.match(/properties\?key=/g) || []).length, 0);
  // Every place a seal record is first written puts the page's marker down first.
  // Every place a seal record is first written puts the page's marker down first, and refuses the
  // seal when it cannot.
  const before = (f, recordRe) => {
    const t = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const m = t.search(/if \([^\n]*!\(await markGuardedPage\(/);
    const r = t.search(recordRe);
    return m >= 0 && r > m;
  };
  ok("[8] sealing/actions.js: marker (refusing on failure) before the seal record", before("src/server/capsules/sealing/actions.js", /await kvs\.set\(`protection-\$\{attachmentId\}`, sealPayload\)/));
  ok("[8] section-seals/actions.js: marker (refusing on failure) before the page wrap and the record", before("src/server/capsules/section-seals/actions.js", /writeDocBody\(pageId, pageData, adfDoc, "\(Sentinel Vault sealed a section\)"\)/));
  ok("[8] section-seals/adopt.js: marker (refusing on failure) before the record", before("src/server/capsules/section-seals/adopt.js", /await kvs\.set\(`section-protection-\$\{sectionId\}`, record\)/));
}
report("property-authority");
