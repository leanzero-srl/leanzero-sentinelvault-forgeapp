// E2E outline: verify the app does NOT crash and the page-protection trigger is
// reachable on a real page. This is a black-box smoke test — it reads observable
// state via REST and forge logs; it never imports the app or KVS.
//
// Prereq: SV_PAGE_ID set to a page that has at least one sealed attachment OR a
// sealed section (seal it first via the UI). Then run this after editing that
// page to confirm the trigger ran without error.
import { cfg } from "../lib/env.mjs";
import { readPageAdf, listAttachments } from "../lib/confluence.mjs";
import { pollForgeLogs, scanForSignals } from "../lib/forge-logs.mjs";

const C = cfg();
let total = 0, passed = 0;
const check = (label, cond) => { total++; if (cond) { passed++; console.log(`ok   ${label}`); } else { console.log(`FAIL ${label}`); } };

if (!C.pageId) {
  console.log("FAIL set SV_PAGE_ID to a page with a sealed attachment or section first.");
  process.exit(1);
}

// 1. Page is readable as ADF.
const page = await readPageAdf(C.pageId);
check("page ADF readable", !!page?.body?.atlas_doc_format?.value);

// 2. Attachments endpoint is reachable.
const atts = await listAttachments(C.pageId);
check("attachments listed", Array.isArray(atts?.results));

// 3. Section-protection / protection content properties exist (proves a seal).
//    (Either property family is fine — depends on what you sealed.)
const baseHost = C.base; // …/wiki
const props = await (await fetch(`${baseHost}/api/v2/pages/${C.pageId}/properties`, {
  headers: { Authorization: C.auth, Accept: "application/json" },
})).json();
const keys = (props?.results || []).map((p) => p.key);
check("a Sentinel Vault content property is present", keys.some((k) => k.startsWith("protection-") || k.startsWith("section-protection-") || k === "sentinel-vault-validation"));

// 4. No error signals in the logs.
const { ok: logsOk, lines } = pollForgeLogs();
if (logsOk) {
  const signals = scanForSignals(lines);
  check("no error signals in forge logs", signals.length === 0);
  if (signals.length) signals.forEach((s) => console.log(`     [${s.signal}] ${s.line}`));
} else {
  console.log("warn forge logs unavailable — skipping log scan");
}

console.log(`\nseal-lifecycle-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
