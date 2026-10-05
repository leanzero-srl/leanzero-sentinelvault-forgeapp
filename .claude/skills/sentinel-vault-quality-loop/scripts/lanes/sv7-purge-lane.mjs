// confirmAttachmentPurged on a real attachment: current → false, trashed → false, purged → true,
// purged with no page id → false (unproven). Throwaway page in SVPLAIN, deleted afterwards.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const SITE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const page = await (await fetch(`${SITE}/wiki/api/v2/pages`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ spaceId: "344162767", status: "current", title: `SV purge witness ${Date.now()}`, body: { representation: "storage", value: "<p>purge</p>" } }) })).json();
const r = await (await fetch(`${env.SENTINEL_TESTHOOK_URL}?what=invoke&fn=purgeVerdicts&pageId=${page.id}`, { headers: { Authorization: `Bearer ${env.HARNESS_SECRET}` } })).json();
console.log(JSON.stringify(r));
const v = r.result || {};
const checks = [["current → not purged", v.current === false], ["trashed → not purged", v.trashed === false], ["purged → confirmed", v.purged === true], ["purged but no page id → unproven", v.purgedWithoutPageId === false]];
for (const [l, c] of checks) console.log(`${c ? "PASS" : "FAIL"} ${l}`);
await fetch(`${SITE}/wiki/api/v2/pages/${page.id}`, { method: "DELETE", headers: { Authorization: AUTH } });
console.log(`${checks.filter((c) => c[1]).length}/${checks.length} passed`);
