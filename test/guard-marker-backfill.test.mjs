// The per-page seal markers (shared/guarded-page.js) stay complete: a backup restore, a big site, a
// failed marker write, and a sweep running in the middle of a restore never leave a sealed page
// without its marker while the "markers complete" flag says otherwise. Plus the guard that no new
// page-property reader appears in src/server. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const { kvs } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
const gp = await import("../src/server/shared/guarded-page.js");
const engine = await import("../src/server/capsules/backup/engine.js");
const { sealSection } = await import("../src/server/capsules/section-seals/actions.js");

const APP = "app-account", OWNER = "acct-owner", OTHER = "acct-other", SPACE = "WF";
const KEY = "app/env/static/sentinel-vault-sealed-section";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const heading = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
const wrapper = (sid, body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: sid } } }, content: body });
const SEALED = [para("SEALED TEXT")];
const FLAG = "guard-marker-backfill-v1";
const text = (v) => JSON.stringify(v?.adf || v);
const sectionRecord = (sid, pageId) => ({ sectionId: sid, pageId, spaceKey: SPACE, lockedBy: OWNER, contentHash: hashAdf(SEALED), sectionTitle: "Sealed", sealedVersion: 1, expiresAt: new Date(Date.now() + 864e5).toISOString() });
const ev = (pageId, actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: pageId, version: { number: version } }, space: { key: SPACE } });

function base() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(OWNER).addUser(OTHER);
  w.readers.add("*");
  return w;
}
async function settings() {
  await kvs.set("app-account-id", APP);
  await kvs.set("section-macro-extension-key", KEY);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
}

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  // C1. A sweep runs in the middle of a restore and finishes over a partial scan.
  {
    const w = base();
    await settings();
    w.addPage("1001", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), wrapper("s-r", SEALED)] } }] });
    const toWrite = [
      { key: "section-protection-s-r", value: sectionRecord("s-r", "1001") },
      { key: "section-snapshot-s-r", value: { wrapperNode: wrapper("s-r", SEALED), bodyContent: SEALED, hash: hashAdf(SEALED), version: 1, originalIndex: 1 } },
    ];
    // The concurrent sweep: runs when the restore starts writing records, i.e. BEFORE they land.
    const realBatch = kvs.batchSet;
    let raced = false;
    kvs.batchSet = async (items) => {
      if (!raced && items.some((i) => i.key.startsWith("section-protection-"))) { raced = true; await gp.backfillGuardMarkers(); }
      return realBatch(items);
    };
    try { await (engine.writeRestoredEntries ? engine.writeRestoredEntries(toWrite) : Promise.reject(new Error("no writeRestoredEntries"))); }
    catch (_) { /* old code: reported below */ } finally { kvs.batchSet = realBatch; }
    eq("[C1] the sweep did run during the restore", raced, true);
    ok("[C1] the restored seal's page has its marker", !!(await kvs.get("guarded-page-1001")));
    eq("[C1] the 'markers complete' flag is not left over the partial scan", await kvs.get(FLAG), undefined);
    // Three sweeps later, a tamper is still restored.
    for (let i = 0; i < 3; i++) await triggers.pageGuardSweep();
    w.pages.get("1001").versions.push({ number: 2, authorId: OTHER, adf: { version: 1, type: "doc", content: [para("intro"), wrapper("s-r", [para("TAMPERED")])] } });
    await triggers.pageContentTrigger(ev("1001", OTHER, 2));
    ok("[C1] after three sweeps the tamper on the restored seal is still restored", w.live("1001").authorId === APP && !text(w.live("1001")).includes("TAMPERED"));
  }
  {
    // Self-heal: the flag is set (an older version, or a rollback and forward again) and a seal record
    // has no marker. The five-minute sweep writes it.
    const w = base();
    await settings();
    w.addPage("1002", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), wrapper("s-h", SEALED)] } }] });
    await kvs.set("section-protection-s-h", sectionRecord("s-h", "1002"));
    await kvs.set("section-snapshot-s-h", { wrapperNode: wrapper("s-h", SEALED), bodyContent: SEALED, hash: hashAdf(SEALED), version: 1, originalIndex: 1 });
    await kvs.set(FLAG, { at: "old" });
    await triggers.pageGuardSweep();
    ok("[C1] the sweep's self-heal wrote the missing marker", !!(await kvs.get("guarded-page-1002")));
  }

  // C2. More than 5,000 records: the backfill resumes across sweeps, finishes, and never rewrites a marker.
  {
    base();
    const N = 5100;
    for (let i = 0; i < N; i++) await kvs.set(`protection-a${String(i).padStart(5, "0")}`, { lockedBy: OWNER, contentId: String(20000 + i), attachmentId: `a${i}` });
    await kvs.set("guarded-page-20005", { at: "pre-existing" }); // already marked: must be left alone
    const realSet = kvs.set;
    const markerWrites = new Map();
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-")) markerWrites.set(k, (markerWrites.get(k) || 0) + 1); return realSet(k, v); };
    let sweeps = 0;
    let flagAfterFirst = null;
    try {
      for (; sweeps < 10 && !(await kvs.get(FLAG)); sweeps++) {
        await gp.backfillGuardMarkers();
        if (sweeps === 0) flagAfterFirst = await kvs.get(FLAG);
      }
    } finally { kvs.set = realSet; }
    eq("[C2] not complete after the first sweep (more than one sweep's worth of records)", flagAfterFirst, undefined);
    ok("[C2] the flag is set after a few sweeps", !!(await kvs.get(FLAG)) && sweeps > 1 && sweeps < 10);
    eq("[C2] every sealed page has a marker", (await kvs.query().where("key", { beginsWith: "guarded-page-" }).limit(100).getMany()).results.length > 0 && (await (async () => { let c = 0; for (let i = 0; i < N; i++) if (await kvs.get(`guarded-page-${20000 + i}`)) c++; return c; })()), N);
    eq("[C2] no marker was written twice", Math.max(...markerWrites.values()), 1);
    eq("[C2] the pre-existing marker was not rewritten", markerWrites.has("guarded-page-20005"), false);
    eq("[C2] once done, a further sweep writes nothing", (await gp.backfillGuardMarkers()).skipped, true);
  }
  {
    // A restore during the backfill starts a new generation: the step running over it sets no flag.
    base();
    for (let i = 0; i < 150; i++) await kvs.set(`section-protection-g${i}`, sectionRecord(`g${i}`, String(30000 + i)));
    const realGet = kvs.get;
    let reopened = false;
    kvs.get = async (k) => { if (k === "guarded-page-30120" && !reopened) { reopened = true; await gp.reopenGuardBackfill(); } return realGet(k); };
    let r;
    try { r = await gp.backfillGuardMarkers(); } finally { kvs.get = realGet; }
    eq("[C2] a step that a restore overlapped sets no flag", [reopened, r.done, await kvs.get(FLAG)], [true, false, undefined]);
  }

  // C3. The marker cannot be written: the seal is refused and nothing is written.
  {
    const w = base();
    await settings();
    w.addPage("1003", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), heading("Scope"), para("scope")] } }] });
    const realSet = kvs.set;
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-")) throw new Error("kvs down"); return realSet(k, v); };
    let r;
    try { r = await sealSection({ payload: { pageId: "1003", headingIndex: 1, headingText: "Scope" }, context: { accountId: OWNER, extension: { content: { id: "1003", type: "page", space: { key: SPACE } }, space: { key: SPACE } } } }); }
    finally { kvs.set = realSet; }
    eq("[C3] seal-section is refused when the page marker cannot be written", r?.success, false);
    eq("[C3] ...the page was not changed", w.live("1003").number, 1);
    eq("[C3] ...and no seal record exists", (await kvs.query().where("key", { beginsWith: "section-protection-" }).getMany()).results.length, 0);
  }

  // R1. Seal on publish whose adoption fails: not reported as sealed, and retried on the next publish.
  {
    const w = base();
    await settings();
    const fresh = { type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: {} } }, content: [heading("Inserted"), para("inserted body")] };
    w.addPage("1004", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), fresh] } }] });
    await kvs.set("section-insert-pending-1004", { at: new Date().toISOString(), by: OWNER });
    const realSet = kvs.set;
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-")) throw new Error("kvs down"); return realSet(k, v); };
    let g;
    try { g = await triggers.guardPageNow("1004", "view"); } finally { kvs.set = realSet; }
    eq("[R1] a failed adoption is not reported as sealed on publish", g?.adoptedOnPublish, false);
    eq("[R1] ...no seal record was made", (await kvs.query().where("key", { beginsWith: "section-protection-" }).getMany()).results.length, 0);
    ok("[R1] ...and the insert marker stays for the next publish", !!(await kvs.get("section-insert-pending-1004")));
    w.pages.get("1004").versions.push({ number: 2, authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro, edited"), fresh] } });
    const g2 = await triggers.guardPageNow("1004", "view");
    eq("[R1] the next publish adopts it", [g2?.adoptedOnPublish, (await kvs.query().where("key", { beginsWith: "section-protection-" }).getMany()).results.length], [true, 1]);
    eq("[R1] ...and only then is the insert marker consumed", await kvs.get("section-insert-pending-1004"), undefined);
  }
  // R2. A restore lands between the generation check and the flag write: the flag does not stay.
  {
    base();
    for (let i = 0; i < 3; i++) await kvs.set(`section-protection-f${i}`, sectionRecord(`f${i}`, String(40000 + i)));
    const realSet = kvs.set;
    kvs.set = async (k, v) => { if (k === FLAG) await realSet(gp.GUARD_BACKFILL_GEN, { gen: "restore-in-between" }); return realSet(k, v); };
    try { await gp.backfillGuardMarkers(); } finally { kvs.set = realSet; }
    eq("[R2] a generation that changed while the flag was written: the flag is taken back", await kvs.get(FLAG), undefined);
  }
  {
    // A restore whose marker writes fail still restores (the scan covers every page meanwhile) and says so.
    const w = base();
    await settings();
    const realSet = kvs.set;
    kvs.set = async (k, v) => { if (k === "guarded-page-1005") throw new Error("kvs down"); return realSet(k, v); };
    let out;
    try { out = await engine.writeRestoredEntries([{ key: "section-protection-s-f", value: sectionRecord("s-f", "1005") }]); } finally { kvs.set = realSet; }
    eq("[R2] marker writes that failed are reported by the restore", out?.markerFailures, 1);
    ok("[R2] ...the records were restored", !!(await kvs.get("section-protection-s-f")));
    eq("[R2] ...and the flag is open, so every page is scanned until the sweep heals the marker", await kvs.get(FLAG), undefined);
    void w;
  }
  {
    // A cursor KVS no longer accepts: the family's scan starts again instead of wedging the backfill.
    base();
    for (let i = 0; i < 3; i++) await kvs.set(`section-protection-d${i}`, sectionRecord(`d${i}`, String(41000 + i)));
    await gp.backfillGuardMarkers({ pagesPerSweep: 0 }); // writes a state for this generation
    const st = await kvs.get(gp.GUARD_BACKFILL_STATE);
    await kvs.set(gp.GUARD_BACKFILL_STATE, { ...st, cursors: { "protection-": "dead", "section-protection-": "dead" } });
    const realQuery = kvs.query;
    kvs.query = () => { const q = realQuery(); const c = q.cursor; let dead = false; q.cursor = (x) => { if (x === "dead") dead = true; return c(x); }; const gm = q.getMany; q.getMany = async () => { if (dead) throw new Error("invalid cursor"); return gm(); }; return q; };
    try { for (let i = 0; i < 10 && !(await kvs.get(FLAG)); i++) { try { await gp.backfillGuardMarkers(); } catch (_) { /* old code throws */ } } } finally { kvs.query = realQuery; }
    ok("[R2] a dead cursor is reset and the backfill completes", !!(await kvs.get(FLAG)) && !!(await kvs.get("guarded-page-41002")));
  }
  // R3. Protection switched off: the sweep still heals missing markers.
  {
    const w = base();
    await kvs.set("app-account-id", APP);
    await kvs.set("admin-settings-global", { enableContentProtection: false });
    w.addPage("1006", { versions: [{ authorId: OWNER, text: "x" }] });
    await kvs.set("section-protection-s-o", sectionRecord("s-o", "1006"));
    await kvs.set(FLAG, { at: "old" });
    await triggers.pageGuardSweep();
    ok("[R3] protection off: the sweep still writes the missing marker", !!(await kvs.get("guarded-page-1006")));
  }

  // S1. A partial adoption failure keeps the version's claim until the page write has happened.
  {
    const w = base();
    await settings();
    const ins = (t) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: {} } }, content: [heading(t), para(`${t} body`)] });
    w.addPage("1007", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), ins("First"), ins("Second")] } }] });
    await kvs.set("section-insert-pending-1007", { at: new Date().toISOString(), by: OWNER });
    const realSet = kvs.set;
    let markerCalls = 0;
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-") && ++markerCalls === 2) throw new Error("kvs down"); return realSet(k, v); };
    let claimAtWrite = "no write";
    const { onConfluence } = await import("./_forge-fake/state.mjs");
    onConfluence((method, rawPath) => {
      if (method === "PUT" && /\/wiki\/api\/v2\/pages\/1007(\?|$)/.test(decodeURIComponent(rawPath)) && claimAtWrite === "no write") {
        return kvs.get("section-adopt-claim-1007-v1").then((c) => { claimAtWrite = c ? "held" : "released"; return undefined; });
      }
      return undefined;
    });
    try { await triggers.pageContentTrigger(ev("1007", OWNER, 1)); } finally { kvs.set = realSet; }
    eq("[S1] the claim is still held while the adopted wrapper is written", claimAtWrite, "held");
    eq("[S1] ...and released after the attempt, so a later run can adopt the one that failed", await kvs.get("section-adopt-claim-1007-v1"), undefined);
    eq("[S1] one wrapper adopted, one left for later", (await kvs.query().where("key", { beginsWith: "section-protection-" }).getMany()).results.length, 1);
  }
  // T1. The page write throws (a network error, not a non-ok answer) after a partial adoption: the
  // claim is still released, so a late event for the same version can adopt the one that failed.
  {
    const w = base();
    await settings();
    const ins = (t) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: {} } }, content: [heading(t), para(`${t} body`)] });
    w.addPage("1009", { versions: [{ authorId: OWNER, adf: { version: 1, type: "doc", content: [para("intro"), ins("First"), ins("Second")] } }] });
    await kvs.set("section-insert-pending-1009", { at: new Date().toISOString(), by: OWNER });
    const realSet = kvs.set;
    let markerCalls = 0;
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-") && ++markerCalls === 2) throw new Error("kvs down"); return realSet(k, v); };
    let threw = false;
    const { onConfluence } = await import("./_forge-fake/state.mjs");
    onConfluence((method, rawPath) => {
      if (method === "PUT" && /\/wiki\/api\/v2\/pages\/1009(\?|$)/.test(decodeURIComponent(rawPath))) { threw = true; throw new Error("socket hang up"); }
      return undefined;
    });
    try { await triggers.pageContentTrigger(ev("1009", OWNER, 1)); } finally { kvs.set = realSet; onConfluence(() => undefined); }
    ok("[T1] the page write threw", threw);
    eq("[T1] ...and the failed adoption's claim was still released", await kvs.get("section-adopt-claim-1009-v1"), undefined);
    ok("[T1] ...and the insert marker stays for the next run", !!(await kvs.get("section-insert-pending-1009")));
  }
  // S2. A refused seal (its marker write failed) does not re-open the site's backfill.
  {
    base();
    await kvs.set(FLAG, { at: "done" });
    await kvs.set(gp.GUARD_BACKFILL_STATE, { gen: "g", cursors: {}, done: {} });
    const realSet = kvs.set;
    kvs.set = async (k, v) => { if (String(k).startsWith("guarded-page-")) throw new Error("rate limited"); return realSet(k, v); };
    let r;
    try { r = await gp.markGuardedPage("1008"); } finally { kvs.set = realSet; }
    eq("[S2] the marker write failed", r, false);
    ok("[S2] ...the done flag and the resume state are left alone", !!(await kvs.get(FLAG)) && !!(await kvs.get(gp.GUARD_BACKFILL_STATE)));
    const fs = await import("node:fs");
    for (const f of ["src/server/capsules/realms/scan-worker.js", "src/server/triggers.js"]) {
      const t = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      ok(`[S2] ${f}: the self-heal re-opens the backfill when its marker write fails`, /if \(!\(await markGuardedPage\([^\n]*\)\)\) await reopenGuardBackfill\(\)/.test(t));
    }
  }
  // S3. One failed scan keeps the family's cursor; only repeated failures at it start the family again.
  {
    base();
    for (let i = 0; i < 3; i++) await kvs.set(`section-protection-k${i}`, sectionRecord(`k${i}`, String(42000 + i)));
    await gp.backfillGuardMarkers({ pagesPerSweep: 0 });
    const st = await kvs.get(gp.GUARD_BACKFILL_STATE);
    await kvs.set(gp.GUARD_BACKFILL_STATE, { ...st, done: { "protection-": true }, cursors: { "protection-": null, "section-protection-": "1" } });
    const realQuery = kvs.query;
    let throwsLeft = 1;
    kvs.query = () => { const q = realQuery(); const gm = q.getMany; q.getMany = async () => { if (throwsLeft > 0) { throwsLeft--; throw new Error("busy"); } return gm(); }; return q; };
    try { await gp.backfillGuardMarkers(); } finally { kvs.query = realQuery; }
    eq("[S3] after one failed scan the family keeps its cursor", (await kvs.get(gp.GUARD_BACKFILL_STATE))?.cursors?.["section-protection-"], "1");
    // Three failures in a row at the same cursor: the family starts again (the backfill cannot wedge).
    throwsLeft = 3;
    kvs.query = () => { const q = realQuery(); const gm = q.getMany; q.getMany = async () => { if (throwsLeft > 0) { throwsLeft--; throw new Error("busy"); } return gm(); }; return q; };
    try { for (let i = 0; i < 3; i++) await gp.backfillGuardMarkers(); } finally { kvs.query = realQuery; }
    const after = await kvs.get(gp.GUARD_BACKFILL_STATE);
    ok("[S3] ...after three failures at it, the family starts again", (after?.cursors?.["section-protection-"] ?? null) === null || !!(await kvs.get(FLAG)));
  }
} finally { Object.assign(console, log); }

// C7. No page-property reader in src/server outside the allowlist.
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src", "server");
  const ALLOW = {
    "capsules/backup/store.js": "the backup index on the backup page, which is restricted to the app's own account",
    "capsules/classification/logic.js": "mirror writer: reads the property only to update or delete it",
    "capsules/config-api/mirror.js": "mirror writer: appends a receipt to the property it reads",
    "capsules/page-details/byline.js": "mirror writer: reads the property only to update it",
    "capsules/panels/actions.js": "the panel's own page setting (hide the panel), which an editor may set anyway",
    "infra/doc-surgery.js": "the same panel setting, read before inserting the panel",
    "capsules/privacy/worker.js": "erasure: reads a property to rewrite the personal data in it",
    "capsules/sealing/logic.js": "mirror writer: reads the property only to update or delete it",
    "capsules/section-seals/logic.js": "mirror writer: reads the property only to update or delete it",
    "capsules/validations/logic.js": "mirror writer: reads the property only to update it (the status is read from KVS)",
    "capsules/workflow/logic.js": "mirror writer: reads the property only to update or delete it",
  };
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js|jsx)$/.test(e.name)) files.push(p); } };
  walk(root);
  const readers = files.filter((f) => /properties\?key=/.test(fs.readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
  eq("[C7] every page-property reader in src/server is a listed mirror writer, erasure or backup-index file", readers.filter((f) => !ALLOW[f]), []);
  // R5: and each listed file keeps its number of reads — a new read in a listed file is reviewed too.
  const COUNTS = { "capsules/backup/store.js": 1, "capsules/classification/logic.js": 1, "capsules/config-api/mirror.js": 1, "capsules/page-details/byline.js": 1, "capsules/panels/actions.js": 2, "infra/doc-surgery.js": 1, "capsules/privacy/worker.js": 2, "capsules/sealing/logic.js": 2, "capsules/section-seals/logic.js": 2, "capsules/validations/logic.js": 1, "capsules/workflow/logic.js": 2 };
  const counted = Object.fromEntries(readers.map((f) => [f, (fs.readFileSync(path.join(root, f), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").match(/properties\?key=/g) || []).length]));
  eq("[R5] the number of page-property reads per listed file is pinned", counted, Object.fromEntries(Object.keys(counted).sort().map((f) => [f, COUNTS[f]])));
}
report("guard-marker-backfill");
