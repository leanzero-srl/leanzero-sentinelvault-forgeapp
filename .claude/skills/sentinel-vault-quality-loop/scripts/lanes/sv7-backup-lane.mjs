// Backup lane (reconstructs backup-live-3.log's 13 checks): relocate WFH→SVPLAIN→WFH, preview,
// restore, resume, delete, re-create. Jobs start through the resolvers (generic invoke seam) and
// the job row is POLLED — never fn=backupJob (55 s hook cap). Ends with the backup in WFH.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const SITE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const results = [];
const check = (l, c, x) => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} ${l}${x !== undefined ? ` — ${JSON.stringify(x).slice(0, 400)}` : ""}`); };
const hook = async (p) => { const r = await fetch(`${HOOK}?${new URLSearchParams(p)}`, { headers: { Authorization: `Bearer ${SECRET}` } }); const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status, text: t.slice(0, 300) }; } };
const res = async (key, payload = {}) => (await hook({ what: "invoke", fn: "invoke", key, actor: MIHAI, payload: JSON.stringify(payload) })).result;
const getKvs = async (key) => (await hook({ what: "kvs", key })).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(start, label, maxMs = 900000) {
  if (!start?.success || !start?.jobId) { console.log(`${label}: did not start`, JSON.stringify(start)); return null; }
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(8000);
    const j = (await res("backup-job", { id: start.jobId }))?.job;
    if (j && (j.status === "done" || j.status === "failed")) return j;
  }
  console.log(`${label}: timed out`); return null;
}
const confGet = async (path) => { const r = await fetch(`${SITE}${path}`, { headers: { Authorization: AUTH, Accept: "application/json" } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const gens = async () => { const d = await res("backup-discover"); const own = (d?.backups || []).find((b) => b.sameEnvironment && b.restricted); return { own, n: own?.generations?.length || 0 }; };

console.log("build:", JSON.stringify((await hook({ what: "version" })).build));
const s0 = await getKvs("backup-settings");
console.log("start:", s0?.pageId, s0?.spaceKey);
const g0 = await gens();
console.log("generations at start:", g0.n);

// 1. relocate to SVPLAIN
const j1 = await waitJob(await res("backup-set-location", { spaceKey: "SVPLAIN" }), "relocate");
check("relocate job done", j1?.status === "done", j1?.result || j1?.error);
check("relocate reports the old page removed", j1?.result?.oldPage?.removed === true, j1?.result?.oldPage);
const s1 = await getKvs("backup-settings");
check("new page in SVPLAIN", s1?.spaceKey === "SVPLAIN" && s1?.pageId && s1.pageId !== s0?.pageId, s1);
const g1 = await gens();
check("history carried", g1.n >= Math.min(g0.n + 1, 10) && g1.n > 0, { gens0: g0.n, gens1: g1.n });
if (s0?.pageId) { const o = await confGet(`/wiki/api/v2/pages/${s0.pageId}`); console.log("old page as site admin (user token):", o.status); }

// 2. relocate back to WFH
const j2 = await waitJob(await res("backup-set-location", { spaceKey: "WFH" }), "relocate back");
check("relocate back done, intermediate page removed", j2?.status === "done" && j2?.result?.oldPage?.removed === true, j2?.result?.oldPage || j2?.error);
const s2 = await getKvs("backup-settings");
check("backup home is WFH again", s2?.spaceKey === "WFH", s2);

// 3. preview + restore newest generation
const g2 = await gens();
const newest = g2.own?.generations?.[0]?.generationId;
const pv = await res("backup-preview", { pageId: s2?.pageId, generationId: newest });
check("preview of the newest generation", pv?.success === true && !!pv?.preview, { newest, keys: pv?.preview?.keys ?? pv?.preview?.manifest?.keys, reason: pv?.reason });
const j3 = await waitJob(await res("backup-restore", { pageId: s2?.pageId, generationId: newest }), "restore");
check("restore job done", j3?.status === "done" && j3?.result?.ok !== false, j3?.result || j3?.error);
const rs = await res("backup-resume-automations", {});
check("paused automations resumed", rs?.success === true && rs?.left === 0, rs);

// 4. delete
const j4 = await waitJob(await res("backup-delete", {}), "delete");
check("backup-delete job done: files purged, emptied page trashed", j4?.status === "done" && j4?.result?.ok !== false && (j4?.result?.deleted || 0) >= 1, j4?.result || j4?.error);
const sp = s2?.pageId ? await confGet(`/wiki/api/v2/pages/${s2.pageId}`) : null;
console.log("deleted page as site admin:", sp?.status);
check("location row cleared", !(await getKvs("backup-settings")));

// 5. re-create
const j5 = await waitJob(await res("backup-now", {}), "backup-now");
check("a new backup is created after delete", j5?.status === "done" && j5?.result?.ok !== false && !!j5?.result?.generationId, j5?.result || j5?.error);
let s5 = await getKvs("backup-settings");
if (s5 && s5.spaceKey !== "WFH") {
  console.log("new backup landed in", s5.spaceKey, "— moving it to WFH");
  await waitJob(await res("backup-set-location", { spaceKey: "WFH" }), "relocate to WFH");
  s5 = await getKvs("backup-settings");
}
check("new backup page exists", s5?.spaceKey === "WFH" && !!s5?.pageId, s5);
const st = await getKvs("backup-status");
console.log("end state: deletedAt =", st?.deletedAt || null, "lastBackup =", st?.lastBackup?.generationId);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
