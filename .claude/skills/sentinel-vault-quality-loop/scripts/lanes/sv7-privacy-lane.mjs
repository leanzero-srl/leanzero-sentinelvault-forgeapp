// Live proof of the privacy sweep on wolfaenpak dev (7.0, report:personal-data). Seeds a REAL CLOSED
// wolfaenpak account S (Atlassian answers "closed" for it — measured 2026-10-05) across families, a real
// page with a 6.6.0-style `protection-` property, takes a backup that contains S, runs the sweep through
// the QUEUED path (privacy-run-now → privacy-queue consumer, 900 s; the hook's synchronous privacySweep
// overruns the 55 s web-trigger cap once the erasure retakes the backup), and asserts what is left.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const SITE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const S = "712020:48a7d991-2319-4f02-a86b-76aad7f86cda"; // a real CLOSED account ("Former user")
const NAME = "Synthetic Privacy Person";
const EMAIL = "synthetic.privacy@example.com";
const results = [];
const check = (label, cond, extra) => { results.push({ label, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`); };

const hook = async (qs) => {
  const r = await fetch(`${HOOK}?${qs}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { status: r.status, text: t.slice(0, 500) }; }
};
const set = (key, value) => hook(`what=set&key=${encodeURIComponent(key)}&value=${encodeURIComponent(JSON.stringify(value))}`);
const get = async (key) => (await hook(`what=kvs&key=${encodeURIComponent(key)}`)).value;
const conf = async (path, init = {}) => {
  const r = await fetch(`${SITE}${path}`, { ...init, headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
  const t = await r.text();
  let body = null; try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  return { status: r.status, body };
};
const inv = (ms) => String(9999999999999 - ms).padStart(13, "0");

const now = Date.now();
// 1. a real page with a legacy property
const page = await conf("/wiki/api/v2/pages", { method: "POST", body: JSON.stringify({ spaceId: "344162767", status: "current", title: `SV privacy probe ${now}`, body: { representation: "storage", value: "<p>privacy probe</p>" } }) });
const pageId = String(page.body.id);
console.log("page", pageId, page.status);
const legacyProp = { lockedBy: S, lockedByEmail: EMAIL, lockedByName: NAME, note: "private note about the person", attachmentId: "attSYN1", contentId: pageId, timestamp: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() };
const prop = await conf(`/wiki/api/v2/pages/${pageId}/properties`, { method: "POST", body: JSON.stringify({ key: "protection-", value: legacyProp }) });
check("legacy property written", prop.status === 200, prop.status);

// 2. KVS rows for S
const rows = {
  "protection-attSYN1": { ...legacyProp, spaceKey: "SVPLAIN", spaceId: "344162767" },
  [`read-ack-${pageId}-${S}`]: { version: 1, at: new Date(now).toISOString(), name: NAME, pageId, accountId: S },
  [`sig-device-${S}`]: { enrolledAt: new Date(now).toISOString() },
  "admin-settings-space-SVPRIVTEST": { adminUsers: [S, MIHAI] },
  [`activity-page-${pageId}-${inv(now)}-syn001`]: { type: "seal.created", ts: new Date(now).toISOString(), pageId, actor: { accountId: S, name: NAME } },
  [`workflow-log-${pageId}-${now - 800 * 86400000}`]: { ts: now - 800 * 86400000, kind: "transition", by: MIHAI, byName: "Mihai", toName: "Approved" },
  [`workflow-log-${pageId}-${now}`]: { ts: now, kind: "transition", by: S, byName: NAME, toName: "Approved" },
};
for (const [k, v] of Object.entries(rows)) await set(k, v);
check("seeded rows readable", (await get("protection-attSYN1"))?.lockedBy === S);

// 3. a backup generation that contains S
const bk = await hook(`what=invoke&fn=invoke&key=backup-now&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent("{}")}`);
const jobId = bk?.result?.jobId;
// Poll the job row (never fn=backupJob: the hook's 55 s cap can kill a run holding backup-lease).
let job = null;
for (let i = 0; jobId && i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const j = (await hook(`what=invoke&fn=invoke&key=backup-job&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent(JSON.stringify({ id: jobId }))}`))?.result?.job;
  if (j && (j.status === "done" || j.status === "failed")) { job = j; break; }
}
console.log("backup before sweep:", JSON.stringify(job?.result || job?.error || bk).slice(0, 300));

// 4. the sweep, with S forced closed
// Atlassian's REAL answer only (no forcing): queue the sweep as Mihai and poll the status row.
const t0 = Date.now();
const q = await hook(`what=invoke&fn=invoke&key=privacy-run-now&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent("{}")}`);
check("sweep queued through the resolver", q?.result?.success === true, q?.result);
let sum = {};
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = (await hook(`what=invoke&fn=invoke&key=privacy-status&actor=${encodeURIComponent(MIHAI)}&payload=${encodeURIComponent("{}")}`))?.result?.status;
  if (st?.last?.finishedAt && Date.parse(st.last.finishedAt) > t0) { sum = st.last; break; }
}
console.log("sweep:", JSON.stringify(sum).slice(0, 1500));
check("sweep ok", sum.ok === true, sum.error);
check("the real report-accounts call was made", sum.accounts?.reported >= 1, sum.accounts);
check("reporting recorded as done (7.0 holds report:personal-data)", sum.accounts?.reporting === "done", sum.accounts);
check("Atlassian answered S closed (a real answer, nothing forced)", sum.accounts?.closed >= 1, sum.accounts);
if (sum.retentionDays > 0) check("retention deleted the 800-day-old log", !(await get(`workflow-log-${pageId}-${now - 800 * 86400000}`)));
else check("retention is off on dev: the 800-day-old log is kept", !!(await get(`workflow-log-${pageId}-${now - 800 * 86400000}`)), { retentionDays: sum.retentionDays });
check("recent log kept", !!(await get(`workflow-log-${pageId}-${now}`)));
const log = await get(`workflow-log-${pageId}-${now}`);
check("recent log pseudonymised", log?.by === "former-user" && log?.byName === "Former user" && log?.toName === "Approved", log);
check("S's read confirmation deleted", !(await get(`read-ack-${pageId}-${S}`)));
check("S's signature marker deleted", !(await get(`sig-device-${S}`)));
const roster = await get("admin-settings-space-SVPRIVTEST");
check("roster lost S, kept Mihai", JSON.stringify(roster?.adminUsers) === JSON.stringify([MIHAI]), roster);
const sealRow = await get("protection-attSYN1");
check("seal record pseudonymised, no email, no note", sealRow?.lockedBy === "former-user" && sealRow?.lockedByName === "Former user" && !sealRow?.lockedByEmail && !sealRow?.note && !JSON.stringify(sealRow).includes(EMAIL), sealRow);
const act = await get(`activity-page-${pageId}-${inv(now)}-syn001`);
check("activity actor pseudonymised", act?.actor?.accountId === "former-user" && act?.actor?.name === "Former user", act);
const after = await conf(`/wiki/api/v2/pages/${pageId}/properties?key=protection-`);
const pv = after.body?.results?.[0]?.value;
check("page property: no email, no name, no note, no S", pv && !JSON.stringify(pv).includes(EMAIL) && !JSON.stringify(pv).includes(NAME) && !("note" in pv) && !JSON.stringify(pv).includes(S), pv);
check("backup step ran", sum.erasure?.backup && !sum.erasure.backup.error, sum.erasure?.backup);
check("status row has no account id", !JSON.stringify(sum).includes(S));

// 5. clean up
for (const k of ["protection-attSYN1", "admin-settings-space-SVPRIVTEST", `activity-page-${pageId}-${inv(now)}-syn001`, `workflow-log-${pageId}-${now}`, `workflow-log-${pageId}-${now - 800 * 86400000}`, `read-ack-${pageId}-${S}`, `sig-device-${S}`]) await hook(`what=delete&key=${encodeURIComponent(k)}`);
const del = await conf(`/wiki/api/v2/pages/${pageId}`, { method: "DELETE" });
console.log("cleanup page delete", del.status);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
