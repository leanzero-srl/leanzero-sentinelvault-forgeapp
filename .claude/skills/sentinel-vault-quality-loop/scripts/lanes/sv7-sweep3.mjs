// 7.0.0 live proof (review C1): a REAL closed wolfaenpak account, mentioned in ordinary rows AND
// inside a sealed-section baseline (page content) AND a personal-space key. Three queued sweeps
// (privacy-run-now as Mihai): #1 reports + erases once + queues the backup erasure job;
// #2 and #3 report nothing for it, erase nothing, queue no backup job, drop no generation.
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const CLOSED = "712020:48a7d991-2319-4f02-a86b-76aad7f86cda"; // "Former user" on wolfaenpak (Atlassian answers closed)
const OUT = process.argv[2] || "/tmp/sv7-sweep3.json";
const results = [];
const check = (label, cond, extra) => { results.push({ label, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 400)}` : ""}`); };
const hook = async (qs) => { const r = await fetch(`${HOOK}?${qs}`, { headers: { Authorization: `Bearer ${SECRET}` } }); const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status, text: t.slice(0, 300) }; } };
const set = (key, value) => hook(`what=set&key=${encodeURIComponent(key)}&value=${encodeURIComponent(JSON.stringify(value))}`);
const get = async (key) => (await hook(`what=kvs&key=${encodeURIComponent(key)}`)).value;
const del = (key) => hook(`what=delete&key=${encodeURIComponent(key)}`);
const inv = async (key, payload = {}) => (await hook(`what=invoke&fn=invoke&key=${key}&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent(JSON.stringify(payload))}`)).result;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gens = async () => { const d = await inv("backup-discover"); const b = (d?.backups || []).find((x) => x.sameEnvironment) || d?.backups?.[0]; return { pageId: b?.pageId, ids: (b?.generations || []).map((g) => g.generationId), reasons: (b?.generations || []).map((g) => g.reason) }; };
const indexEntry = async () => { const rows = (await hook("what=query&prefix=privacy-accounts-")).keys || []; for (const k of rows) { const v = await get(k); if (v?.[CLOSED]) return v[CLOSED]; } return null; };
async function sweep(n) {
  const before = (await get("privacy-status"))?.last?.finishedAt || null;
  const q = await inv("privacy-run-now");
  if (!q?.queued) throw new Error(`sweep ${n} not queued: ${JSON.stringify(q)}`);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const st = await get("privacy-status");
    if (st?.last?.finishedAt && st.last.finishedAt !== before && !st.queuedAt) return st;
  }
  throw new Error(`sweep ${n} did not finish in 10 min`);
}
async function waitJob(jobId) {
  for (let i = 0; i < 60; i++) { const j = (await inv("backup-job", { id: jobId }))?.job; if (j && (j.status === "done" || j.status === "failed")) return j; await sleep(10000); }
  return null;
}

const now = Date.now();
const pageId = "382468111";
const rows = {
  [`read-ack-${pageId}-${CLOSED}`]: { version: 1, at: new Date(now).toISOString(), name: "Former user", pageId, accountId: CLOSED },
  [`workflow-log-${pageId}-${now}`]: { ts: now, kind: "transition", by: CLOSED, byName: "Former user", toName: "Approved" },
  "admin-settings-space-SVPRIVTEST": { adminUsers: [CLOSED, MIHAI] },
  // page content: a sealed-section baseline that mentions the person — the sealed record, never rewritten
  "section-snapshot-sv7-c1-proof": { pageId, bodyContent: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: CLOSED, text: "@Former user" } }] }], hash: "sv7" },
  // a personal space key (Confluence's key, not a person reference)
  [`space-protection-~${CLOSED}`]: ["attSV7PS"],
};
const log = { closed: CLOSED, sweeps: [] };
try {
  // Clean slate for the proof: forget this one id's marker (the run before the lock fix left it
  // closed+erased) and the pending backup erasure, so sweep 1 meets it as new again.
  for (const k of (await hook("what=query&prefix=privacy-accounts-")).keys || []) {
    const v = await get(k);
    if (v?.[CLOSED]) { delete v[CLOSED]; await set(k, v); }
  }
  await del("privacy-erase-pending");
  const e0 = await indexEntry();
  console.log("index entry before:", JSON.stringify(e0));
  for (const [k, v] of Object.entries(rows)) await set(k, v);
  const g0 = await gens();
  console.log("generations before:", g0.ids.length, g0.ids.slice(0, 3));

  // ── sweep 1
  const s1 = await sweep(1);
  const l1 = s1.last;
  console.log("sweep 1:", JSON.stringify({ accounts: l1.accounts, erasure: l1.erasure }));
  check("sweep 1: the account was reported and Atlassian answered closed", l1.accounts.closed === 1, l1.accounts);
  check("sweep 1: rows erased (own rows deleted, mentions rewritten)", l1.erasure && l1.erasure.deletedRows >= 1 && l1.erasure.rewrittenRows >= 1, l1.erasure);
  check("sweep 1: own read confirmation deleted", !(await get(`read-ack-${pageId}-${CLOSED}`)));
  const wl = await get(`workflow-log-${pageId}-${now}`);
  check("sweep 1: workflow log pseudonymised", wl?.by === "former-user" && wl?.byName === "Former user", wl);
  check("sweep 1: removed from the roster", JSON.stringify((await get("admin-settings-space-SVPRIVTEST"))?.adminUsers) === JSON.stringify([MIHAI]));
  check("sweep 1: the sealed snapshot still holds the mention (record kept)", JSON.stringify(await get("section-snapshot-sv7-c1-proof")).includes(CLOSED));
  const e1 = await indexEntry();
  check("sweep 1: the index keeps a durable closed marker (c, x)", !!e1?.c && !!e1?.x, e1);
  const jobId = l1.erasure?.backup?.jobId;
  check("sweep 1: the backup erasure was queued as its own job", !!jobId, l1.erasure?.backup);
  const job = jobId ? await waitJob(jobId) : null;
  console.log("privacy-erase job:", JSON.stringify(job && { status: job.status, result: job.result, error: job.error }));
  check("sweep 1: the backup job finished", job?.status === "done", job?.result || job?.error);
  check("sweep 1: the job left no pending ids", !(await get("privacy-erase-pending")));
  const g1 = await gens();
  console.log("generations after sweep 1:", g1.ids.length, "dropped:", g0.ids.filter((x) => !g1.ids.includes(x)).length, "new:", g1.ids.filter((x) => !g0.ids.includes(x)));
  log.sweeps.push({ n: 1, finishedAt: l1.finishedAt, accounts: l1.accounts, erasure: l1.erasure, job: job && { status: job.status, result: job.result }, gensBefore: g0.ids.length, gensAfter: g1.ids.length, droppedIds: g0.ids.filter((x) => !g1.ids.includes(x)) });

  // ── sweeps 2 and 3
  let prev = g1;
  for (const n of [2, 3]) {
    const s = await sweep(n);
    const l = s.last;
    console.log(`sweep ${n}:`, JSON.stringify({ accounts: l.accounts, erasure: l.erasure, erasureBackup: l.erasureBackup || null }));
    check(`sweep ${n}: nothing closed (the account is not reported again)`, l.accounts.closed === 0, l.accounts);
    check(`sweep ${n}: no erasure ran`, l.erasure == null, l.erasure);
    check(`sweep ${n}: no backup job queued`, !l.erasure?.backup && !l.erasureBackup, l.erasureBackup);
    const e = await indexEntry();
    check(`sweep ${n}: marker unchanged (same c, x)`, e?.c === e1?.c && e?.x === e1?.x, e);
    const g = await gens();
    const dropped = prev.ids.filter((x) => !g.ids.includes(x));
    check(`sweep ${n}: no backup generation dropped`, dropped.length === 0, { before: prev.ids.length, after: g.ids.length, dropped });
    check(`sweep ${n}: sealed snapshot still there`, JSON.stringify(await get("section-snapshot-sv7-c1-proof")).includes(CLOSED));
    log.sweeps.push({ n, finishedAt: l.finishedAt, accounts: l.accounts, erasure: l.erasure, gensBefore: prev.ids.length, gensAfter: g.ids.length, droppedIds: dropped });
    prev = g;
  }
  log.status = await get("privacy-status");
} finally {
  for (const k of [`workflow-log-${pageId}-${now}`, "admin-settings-space-SVPRIVTEST", "section-snapshot-sv7-c1-proof", `space-protection-~${CLOSED}`, `read-ack-${pageId}-${CLOSED}`]) await del(k);
  log.results = results;
  writeFileSync(OUT, JSON.stringify(log, null, 1));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
}
