// Live REST exercise against the deployed app: create a throwaway page, read it,
// edit it (fires avi:confluence:updated:page → pageContentTrigger), confirm the
// content-property fast-paths are reachable, then clean up. Run `forge logs`
// afterwards to confirm the deployed triggers handled the real events without error.
//
// REST cannot drive the UI-only resolvers (seal/validate config), so this proves
// "the deployed app handles real Confluence events cleanly", not the seal/revert
// behaviours (those are UI/mock-verified).
import { get, post, put, del } from "../lib/confluence.mjs";

let total = 0, passed = 0;
const check = (label, cond) => { total++; if (cond) { passed++; console.log(`ok   ${label}`); } else console.log(`FAIL ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Pick a global space.
const spaces = await get("/api/v2/spaces?limit=50");
const space = (spaces.results || []).find((s) => s.type === "global") || (spaces.results || [])[0];
check("found a space", !!space);
if (!space) process.exit(1);
console.log(`     using space ${space.key} (${space.id})`);

let pageId = null;
try {
  // 2. Create a throwaway page.
  const stamp = new Date().toISOString();
  const created = await post("/api/v2/pages", {
    spaceId: space.id,
    status: "current",
    title: `[sentinel-vault-e2e] ${stamp}`,
    body: { representation: "storage", value: "<h2>Overview</h2><p>Live E2E probe.</p>" },
  });
  pageId = created.id;
  check("created test page", !!pageId);
  console.log(`     page ${pageId}`);

  // 3. Read it back as ADF (the format the app's trigger reads).
  const adf = await get(`/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
  check("page readable as ADF", !!adf?.body?.atlas_doc_format?.value);

  // 4. Edit it → fires avi:confluence:updated:page on the deployed app.
  const v = adf.version.number;
  await put(`/api/v2/pages/${pageId}`, {
    id: pageId, status: "current", title: adf.title,
    body: { representation: "storage", value: "<h2>Overview</h2><p>Live E2E probe — edited.</p><h2>Risks</h2><p>none</p>" },
    version: { number: v + 1 },
  });
  check("edited page (fires page-content trigger)", true);

  // 5. Content-property fast-path endpoints are reachable (no seals → empty).
  for (const key of ["protection-", "section-protection-", "sentinel-vault-validation"]) {
    const props = await get(`/api/v2/pages/${pageId}/properties?key=${key}`);
    check(`content-property probe reachable: ${key}`, Array.isArray(props?.results));
  }

  // Give the async triggers a moment to run before the log scan.
  await sleep(8000);
} finally {
  // 6. Clean up.
  if (pageId) {
    try { await del(`/api/v2/pages/${pageId}`); console.log(`ok   cleaned up page ${pageId}`); passed++; total++; }
    catch (e) { console.log(`FAIL cleanup: ${e.message}`); total++; }
  }
}

console.log(`\nlive-trigger-e2e: ${passed}/${total} passed`);
console.log("Now run `forge logs` (or: cd .. && npx forge logs) to confirm the trigger ran without error signals.");
process.exit(passed === total ? 0 : 1);
