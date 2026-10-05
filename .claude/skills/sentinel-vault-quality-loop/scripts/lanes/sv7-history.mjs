// 7.0.0 purge proof WITH HISTORY (coordinator, 2026-10-05). Builds 6 differing generations: G1–G3
// hold the real closed account in NON-content rows (read confirmation, workflow log, steward roster),
// G4–G6 hold it only in a sealed-section baseline and a personal-space key. Then three queued sweeps.
// Expected: sweep 1 drops exactly the generations that mention the id outside content (G1–G3), keeps
// the rest; sweeps 2–3 drop nothing. Each generation's verdict is read from the stored files by the
// dev hook seam `fn=backupMentions` (the purge's own tests).
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const CLOSED = "712020:48a7d991-2319-4f02-a86b-76aad7f86cda";
const OUT = process.argv[2] || "/tmp/sv7-history.json";
const results = [];
const check = (label, cond, extra) => { results.push({ label, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 500)}` : ""}`); };
const hook = async (qs) => { const r = await fetch(`${HOOK}?${qs}`, { headers: { Authorization: `Bearer ${SECRET}` } }); const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status, text: t.slice(0, 300) }; } };
const set = (key, value) => hook(`what=set&key=${encodeURIComponent(key)}&value=${encodeURIComponent(JSON.stringify(value))}`);
const get = async (key) => (await hook(`what=kvs&key=${encodeURIComponent(key)}`)).value;
const del = (key) => hook(`what=delete&key=${encodeURIComponent(key)}`);
const inv = async (key, payload = {}) => (await hook(`what=invoke&fn=invoke&key=${key}&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent(JSON.stringify(payload))}`)).result;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(jobId) { for (let i = 0; i < 60; i++) { const j = (await inv("backup-job", { id: jobId }))?.job; if (j && (j.status === "done" || j.status === "failed")) return j; await sleep(8000); } return null; }
async function backupNow(label) {
  const r = await inv("backup-now");
  const id = r?.jobId || r?.job?.id;
  const j = id ? await waitJob(id) : null;
  console.log(`${label}: ${j?.status} ${j?.result?.generationId || j?.error || JSON.stringify(r).slice(0, 200)} unchanged=${j?.result?.unchanged}`);
  return j?.result?.generationId || null;
}
const listing = async () => (await hook(`what=invoke&fn=backupMentions&ids=${encodeURIComponent(CLOSED)}`)).result?.generations || [];
async function sweep(n) {
  const before = (await get("privacy-status"))?.last?.finishedAt || null;
  await inv("privacy-run-now");
  for (let i = 0; i < 60; i++) { await sleep(10000); const st = await get("privacy-status"); if (st?.last?.finishedAt && st.last.finishedAt !== before && !st.queuedAt) return st.last; }
  throw new Error(`sweep ${n} did not finish`);
}
const pageId = "382468111";
const now = Date.now();
const NONCONTENT = [`read-ack-${pageId}-${CLOSED}`, `workflow-log-${pageId}-${now}`];
const log = { closed: CLOSED, tables: {} };
const table = (rows, label) => { log.tables[label] = rows; console.log(`\n${label}`); for (const g of rows) console.log(`  ${g.generationId}  ${String(g.reason).padEnd(13)} pinned=${g.pinned}  outsideContent=${g.mentionsOutsideContent}  holdsIdAnywhere=${g.holdsIdAnywhere}${g.error ? ` ERROR ${g.error}` : ""}`); };
try {
  // clean slate for this id (an earlier proof marked it closed + erased)
  for (const k of (await hook("what=query&prefix=privacy-accounts-")).keys || []) { const v = await get(k); if (v?.[CLOSED]) { delete v[CLOSED]; await set(k, v); } }
  await del("privacy-erase-pending");
  // traces that must NEVER drop a generation
  await set("section-snapshot-sv7-hist", { pageId, bodyContent: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: CLOSED, text: "@Former user" } }] }], hash: "sv7h" });
  await set(`space-protection-~${CLOSED}`, ["attSV7H"]);
  // traces that MUST drop the generations that hold them
  await set(NONCONTENT[0], { version: 1, at: new Date(now).toISOString(), name: "Former user", pageId, accountId: CLOSED });
  await set(NONCONTENT[1], { ts: now, kind: "transition", by: CLOSED, byName: "Former user", toName: "Approved" });
  await set("admin-settings-space-SVHIST", { adminUsers: [CLOSED, MIHAI] });
  const G = {};
  for (const n of [1, 2, 3]) { await set("admin-settings-space-SVHISTCFG", { adminUsers: [MIHAI], probe: `G${n}` }); G[`G${n}`] = await backupNow(`G${n} (closed id in non-content rows)`); }
  for (const k of NONCONTENT) await del(k);
  await set("admin-settings-space-SVHIST", { adminUsers: [MIHAI] });
  for (const n of [4, 5, 6]) { await set("admin-settings-space-SVHISTCFG", { adminUsers: [MIHAI], probe: `G${n}` }); G[`G${n}`] = await backupNow(`G${n} (closed id only in content / personal-space key)`); }
  log.G = G;
  check("six differing generations were recorded", Object.values(G).filter(Boolean).length === 6 && new Set(Object.values(G)).size === 6, G);

  const t0 = await listing(); table(t0, "before sweep 1");
  const expectDrop = t0.filter((g) => g.mentionsOutsideContent).map((g) => g.generationId);
  check("the seam sees G1–G3 as mentioning the id outside content", ["G1", "G2", "G3"].every((k) => expectDrop.includes(G[k])), expectDrop);
  check("the seam sees G4–G6 as holding the id only in content / personal-space keys", ["G4", "G5", "G6"].every((k) => { const g = t0.find((x) => x.generationId === G[k]); return g && !g.mentionsOutsideContent && g.holdsIdAnywhere; }));

  const s1 = await sweep(1);
  console.log("\nsweep 1:", JSON.stringify({ accounts: s1.accounts, erasure: s1.erasure }));
  check("sweep 1: reported, closed by Atlassian", s1.accounts?.closed === 1, s1.accounts);
  const job = s1.erasure?.backup?.jobId ? await waitJob(s1.erasure.backup.jobId) : null;
  console.log("privacy-erase job:", JSON.stringify(job && { status: job.status, result: job.result, error: job.error }));
  check("sweep 1: the privacy-erase job finished", job?.status === "done", job?.result || job?.error);
  const t1 = await listing(); table(t1, "after sweep 1");
  const ids0 = t0.map((g) => g.generationId), ids1 = t1.map((g) => g.generationId);
  const dropped1 = ids0.filter((x) => !ids1.includes(x));
  check("sweep 1 dropped EXACTLY the generations that mention the id outside content", JSON.stringify([...dropped1].sort()) === JSON.stringify([...expectDrop].sort()), { dropped1, expectDrop });
  check("sweep 1 kept G4–G6 (content / personal-space only)", ["G4", "G5", "G6"].every((k) => ids1.includes(G[k])));
  check("sweep 1 kept every generation that did not mention it", t0.filter((g) => !g.mentionsOutsideContent).every((g) => ids1.includes(g.generationId)));
  check("after sweep 1 no kept generation mentions the id outside content", t1.every((g) => !g.mentionsOutsideContent), t1.filter((g) => g.mentionsOutsideContent));
  let prev = t1;
  for (const n of [2, 3]) {
    const s = await sweep(n);
    console.log(`\nsweep ${n}:`, JSON.stringify({ accounts: s.accounts, erasure: s.erasure, erasureBackup: s.erasureBackup || null }));
    check(`sweep ${n}: nothing closed, no erasure, no backup job`, s.accounts?.closed === 0 && s.erasure == null && !s.erasureBackup, s.accounts);
    const t = await listing(); table(t, `after sweep ${n}`);
    const dropped = prev.map((g) => g.generationId).filter((x) => !t.some((g) => g.generationId === x));
    check(`sweep ${n}: no generation dropped`, dropped.length === 0, dropped);
    prev = t;
  }
  log.pinnedSeen = [t0, t1, prev].flat().filter((g) => g.pinned).map((g) => g.generationId);
} finally {
  for (const k of ["section-snapshot-sv7-hist", `space-protection-~${CLOSED}`, ...NONCONTENT, "admin-settings-space-SVHIST", "admin-settings-space-SVHISTCFG"]) await del(k);
  log.results = results;
  writeFileSync(OUT, JSON.stringify(log, null, 1));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
}
