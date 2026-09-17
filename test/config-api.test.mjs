// Config REST API — the pure cores (docs/REST-CONFIG-API.md).
//   tokens-core.js  mint / verify / revoke / tombstone / roles, over a Map storage
//   bundle.js       validateBundle limits + allow-lists + $replace; planBundle mapping table
//   admission.js    decideAdmission (idempotency / busy)
//   consumer.js     the pure helpers (mergeValidationConfig, interpretResult, summarize, findHeadingIndex)
import { eq, ok, report } from "./_assert.mjs";
import {
  createTokenStore, tokenRole, tokenRoleAtLeast, normalizeMintRole, extractBearer, tombstoneKey, sha256,
  API_TOKENS_KEY, MAX_TOKENS,
} from "../src/server/capsules/config-api/tokens-core.js";
import { validateBundle, planBundle, bundleRoleFloor, readSet, touchedSpaceKeys, MAX_BUNDLE_BYTES, MAX_CONTENT_OPS, CONTENT_OPS } from "../src/server/capsules/config-api/bundle.js";
import { decideAdmission, opRoleFloor, OUTPUT, jobId, jobKvsKey, activeJobKvsKey, isActiveJob, JOB_PREFIX, ACTIVE_PREFIX, CONSUMER_TIMEOUT_MS } from "../src/server/capsules/config-api/admission.js";
import { mergeValidationConfig, interpretResult, summarize, findHeadingIndex, pushReceipt, redactConfigForMirror, isStaleRunning, staleFailureReceipt, STALE_RUNNING_REASON } from "../src/server/capsules/config-api/pure.js";

const memStorage = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined), set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, delete: async (k) => { m.delete(k); } }; };

// ── tokens ───────────────────────────────────────────────────────────────────
{
  let t = 1_700_000_000_000;
  const st = memStorage();
  const store = createTokenStore(st, { now: () => t });
  const { token, row } = await store.createApiToken({ name: "ci", accountId: "712020:me", role: "editor" });
  ok("plaintext has the svt_ prefix + 48 hex", /^svt_[0-9a-f]{48}$/.test(token));
  eq("row is public (no hash)", Object.keys(row).sort(), ["createdAt", "createdBy", "id", "lastUsedAt", "name", "prefix", "revokedAt", "role"]);
  eq("row role", row.role, "editor");
  eq("stored hash is sha256 of the plaintext", st.m.get(API_TOKENS_KEY)[0].hash, sha256(token));
  ok("stored row never holds the plaintext", !JSON.stringify(st.m.get(API_TOKENS_KEY)).includes(token));

  const hit = await store.authenticate(token);
  eq("authenticate → the row", hit?.id, row.id);
  ok("first use touches lastUsedAt", !!hit.lastUsedAt);
  const firstTouch = hit.lastUsedAt;
  t += 60_000;
  eq("second use within the hour does NOT touch", (await store.authenticate(token)).lastUsedAt, firstTouch);
  t += 3_600_001;
  ok("after an hour it touches again", (await store.authenticate(token)).lastUsedAt !== firstTouch);

  eq("wrong token → null", await store.authenticate("svt_" + "0".repeat(48)), null);
  eq("malformed token → null", await store.authenticate("cgr_" + "a".repeat(48)), null);
  eq("empty → null", await store.authenticate(""), null);

  // Tombstone-first revoke: even a resurrected array row is dead.
  const stale = JSON.parse(JSON.stringify(st.m.get(API_TOKENS_KEY))); // a snapshot taken before the revoke
  eq("revoke", await store.revokeApiToken(row.id), { revoked: true });
  ok("tombstone written", !!st.m.get(tombstoneKey(row.id)));
  eq("revoked token → null", await store.authenticate(token), null);
  st.m.set(API_TOKENS_KEY, stale); // a racing writer puts the live hash back
  eq("resurrected row still refused (tombstone wins)", await store.authenticate(token), null);
  const listed = await store.listApiTokens();
  ok("list reports the resurrected row as revoked", !!listed[0].revokedAt);
  eq("revoke unknown id", await store.revokeApiToken("tok_nope"), { revoked: false });

  // Roles.
  eq("missing role reads admin", tokenRole({}), "admin");
  eq("null role reads admin", tokenRole({ role: null }), "admin");
  eq("unknown role reads viewer (not a grant)", tokenRole({ role: "owner" }), "viewer");
  ok("viewer < editor", !tokenRoleAtLeast({ role: "viewer" }, "editor"));
  ok("editor ≥ editor", tokenRoleAtLeast({ role: "editor" }, "editor"));
  ok("admin ≥ editor", tokenRoleAtLeast({ role: "admin" }, "editor"));
  ok("editor < admin", !tokenRoleAtLeast({ role: "editor" }, "admin"));
  ok("no floor is never reached", !tokenRoleAtLeast({}, "root"));
  eq("normalizeMintRole trims/lowers", normalizeMintRole(" Admin "), "admin");
  eq("normalizeMintRole omitted → null", normalizeMintRole(undefined), null);
  let threw = false; try { normalizeMintRole("viwer"); } catch { threw = true; } ok("normalizeMintRole refuses a typo", threw);

  // MAX_TOKENS.
  const st2 = memStorage(); const store2 = createTokenStore(st2, { now: () => t });
  for (let i = 0; i < MAX_TOKENS; i++) await store2.createApiToken({ name: `t${i}`, accountId: "a" });
  let limit = false; try { await store2.createApiToken({ name: "one-too-many", accountId: "a" }); } catch (e) { limit = /limit/i.test(e.message); }
  ok("MAX_TOKENS enforced on live rows", limit);
  const victim = (await store2.listApiTokens())[0];
  await store2.revokeApiToken(victim.id);
  const again = await store2.createApiToken({ name: "after-revoke", accountId: "a" });
  ok("a revoked row frees a slot", !!again.token);
  t += 31 * 86400000;
  await store2.revokeApiToken(again.row.id); // frees a live slot; revoked just now, so NOT pruned
  await store2.createApiToken({ name: "prunes", accountId: "a" });
  ok("a fresh revoke is kept (30-day window)", (await store2.listApiTokens()).some((r) => r.id === again.row.id));
  ok("revoked rows older than 30 days are pruned, tombstone too", !(await store2.listApiTokens()).some((r) => r.id === victim.id) && !st2.m.has(tombstoneKey(victim.id)));

  // Bearer extraction.
  eq("Authorization: Bearer", extractBearer({ headers: { Authorization: ["Bearer svt_x"] } }), "svt_x");
  eq("authorization lowercase", extractBearer({ headers: { authorization: "Bearer svt_y" } }), "svt_y");
  eq("X-Api-Key", extractBearer({ headers: { "x-api-key": ["svt_z"] } }), "svt_z");
  eq("none", extractBearer({}), "");
}

// ── bundle validation ────────────────────────────────────────────────────────
{
  const good = { version: 1, site: { policy: { defaultLockDuration: 3600 } }, content: [{ op: "seal-attachment", pageId: "1", attachmentId: "att1" }] };
  eq("valid bundle ok", validateBundle(good).ok, true);
  eq("version required", validateBundle({ site: {} }).errors, ["version: must be 1"]);
  ok("not an object", !validateBundle([]).ok);
  ok("unknown top-level key", validateBundle({ version: 1, sites: {} }).errors.includes("sites: unknown key"));
  ok("unknown site key", validateBundle({ version: 1, site: { polcy: {} } }).errors.includes("site.polcy: unknown key"));
  ok("unknown space key", validateBundle({ version: 1, spaces: { WFH: { workflow: [] } } }).errors.includes("spaces.WFH.workflow: unknown key"));
  ok("bad space key", validateBundle({ version: 1, spaces: { "bad key!": {} } }).errors[0].startsWith("spaces.bad key!: invalid"));
  ok("receiptPageId must be numeric", !validateBundle({ version: 1, site: { receiptPageId: "abc" } }).ok);
  ok("classification.levels must be array", !validateBundle({ version: 1, site: { classification: { levels: {} } } }).ok);
  ok("spaceAdmins.users strings only", !validateBundle({ version: 1, spaces: { A: { spaceAdmins: { users: [1] } } } }).ok);
  ok("spaceAdmins unknown key", !validateBundle({ version: 1, spaces: { A: { spaceAdmins: { admins: [] } } } }).ok);
  ok("workflows item needs def", !validateBundle({ version: 1, spaces: { A: { workflows: [{ workflowId: "x" }] } } }).ok);
  ok("workflows $replace object form", validateBundle({ version: 1, spaces: { A: { workflows: { $replace: true, items: [{ workflowId: "x", def: { states: [] } }] } } } }).ok);
  ok("workflows malformed set", !validateBundle({ version: 1, spaces: { A: { workflows: { items: "x" } } } }).ok);
  ok("validation.rules $replace object form", validateBundle({ version: 1, site: { validation: { rules: { $replace: true, items: [] } } } }).ok);
  ok("validation.rules malformed", !validateBundle({ version: 1, site: { validation: { rules: "x" } } }).ok);
  eq("readSet array", readSet([1]), { replace: false, items: [1] });
  eq("readSet $replace", readSet({ $replace: true, items: [] }), { replace: true, items: [] });
  eq("readSet bad", readSet("x"), null);

  // Limits.
  const big = { version: 1, site: { policy: { note: "x".repeat(MAX_BUNDLE_BYTES) } } };
  ok("size limit (computed)", validateBundle(big).errors[0].includes("exceeds"));
  ok("size limit (rawBytes)", validateBundle(good, { rawBytes: MAX_BUNDLE_BYTES + 1 }).errors[0].includes("exceeds"));
  const many = { version: 1, content: Array.from({ length: MAX_CONTENT_OPS + 1 }, () => ({ op: "unseal-attachment", attachmentId: "a" })) };
  ok("content op limit", validateBundle(many).errors.some((e) => e.startsWith("content: at most")));
  ok("exactly the limit passes", validateBundle({ ...many, content: many.content.slice(0, MAX_CONTENT_OPS) }).ok);

  // Content op allow-lists: every op refuses a foreign field and demands its required ones.
  for (const [op, spec] of Object.entries(CONTENT_OPS)) {
    const base = { op }; for (const k of spec.required) base[k] = "x1";
    ok(`${op}: minimal passes`, validateBundle({ version: 1, content: [base] }).ok);
    ok(`${op}: foreign field refused`, validateBundle({ version: 1, content: [{ ...base, adminOverride: true }] }).errors.includes(`content[0].adminOverride: not a field of ${op}`));
    for (const k of spec.required) {
      const missing = { ...base }; delete missing[k];
      ok(`${op}: ${k} required`, validateBundle({ version: 1, content: [missing] }).errors.includes(`content[0].${k}: required`));
    }
  }
  ok("unknown op", validateBundle({ version: 1, content: [{ op: "nuke" }] }).errors[0].includes('unknown op "nuke"'));
  ok("bad id", !validateBundle({ version: 1, content: [{ op: "classify-page", pageId: "1; drop" }] }).ok);
  ok("lockDuration positive", !validateBundle({ version: 1, content: [{ op: "seal-attachment", attachmentId: "a", lockDuration: -1 }] }).ok);

  // Role floor of a bundle.
  eq("site → admin", bundleRoleFloor({ version: 1, site: { policy: {} } }), "admin");
  eq("spaces → admin", bundleRoleFloor({ version: 1, spaces: { A: {} } }), "admin");
  eq("content only → editor", bundleRoleFloor({ version: 1, content: [] }), "editor");
  eq("empty site object → editor", bundleRoleFloor({ version: 1, site: {}, content: [] }), "editor");
  eq("whoami floor", opRoleFloor("whoami", "admin"), "viewer");
  eq("bundle floor passes through", opRoleFloor("bundle", "editor"), "editor");
}

// ── planBundle: the resolver-mapping table ───────────────────────────────────
{
  const sample = {
    version: 1,
    site: {
      policy: { defaultLockDuration: 172800 },
      validation: { enabled: true, rules: [] },
      classification: { levels: [{ id: "public", name: "Public", color: "#15803D", rank: 1 }] },
      notifications: { enableEmailDispatches: false },
      receiptPageId: "265912321",
    },
    spaces: {
      WFH: {
        policy: { defaultLockDuration: 86400 },
        validation: { enabled: true },
        workflows: { $replace: true, items: [{ workflowId: "review", def: { states: [] }, labels: ["policy"], priority: 1 }] },
        workflowSettings: { enabled: true },
        classificationDefault: "confidential",
        spaceAdmins: { users: ["712020:a"], groups: ["confluence-admins"] },
      },
    },
    content: [
      { op: "seal-attachment", pageId: "265912321", attachmentId: "att265945089", lockDuration: 86400, note: "freeze" },
      { op: "unseal-attachment", attachmentId: "att1", reason: "done" },
      { op: "seal-section", pageId: "9", headingText: "Pricing" },
      { op: "unseal-section", sectionId: "sec1", reason: "r" },
      { op: "classify-page", pageId: "9", levelId: "restricted" },
      { op: "assign-workflow", pageId: "9", workflowId: "review" },
      { op: "transition", pageId: "9", toStateId: "approved", reason: "ship" },
    ],
  };
  const v = validateBundle(sample);
  eq("sample validates", v.errors, []);
  const plan = planBundle(sample);
  eq("plan order and mapping", plan.map((s) => [s.path, s.resolverKey]), [
    ["site.policy", "store-policy"],
    ["site.validation", "store-validation-config"],
    ["site.classification.levels", "classification-manage-levels"],
    ["site.notifications", "store-policy"],
    ["spaces.WFH.policy", "store-policy"],
    ["spaces.WFH.validation", "store-validation-config"],
    ["spaces.WFH.workflows.$replace", "delete-space-workflow"],
    ["spaces.WFH.workflows[0]", "store-space-workflow"],
    ["spaces.WFH.workflowSettings", "set-space-workflow-settings"],
    ["spaces.WFH.classificationDefault", "classification-set-space-default"],
    ["spaces.WFH.spaceAdmins", "store-policy"],
    ["content[0]", "seal-artifact"],
    ["content[1]", "unseal-artifact"],
    ["content[2]", "seal-section"],
    ["content[3]", "unseal-section"],
    ["content[4]", "classification-set-page"],
    ["content[5]", "assign-workflow"],
    ["content[6]", "request-transition"],
  ]);
  const by = Object.fromEntries(plan.map((s) => [s.path, s]));
  eq("site.policy payload", by["site.policy"].payload, { scope: "global", data: { defaultLockDuration: 172800 } });
  eq("site.notifications merges into the global policy", by["site.notifications"].payload, { scope: "global", data: { enableEmailDispatches: false } });
  eq("site.validation needs a merge", by["site.validation"].needs, "validationMerge");
  eq("levels payload", by["site.classification.levels"].payload.levels.length, 1);
  eq("space policy payload", by["spaces.WFH.policy"].payload, { scope: "space", key: "WFH", data: { defaultLockDuration: 86400 } });
  eq("$replace prunes then stores", by["spaces.WFH.workflows.$replace"].payload, { spaceKey: "WFH", keep: ["review"] });
  eq("workflow payload", by["spaces.WFH.workflows[0]"].payload, { spaceKey: "WFH", workflowId: "review", def: { states: [] }, labels: ["policy"], priority: 1 });
  eq("workflowSettings payload", by["spaces.WFH.workflowSettings"].payload, { spaceKey: "WFH", settings: { enabled: true } });
  eq("classificationDefault resolves the space id at run time", [by["spaces.WFH.classificationDefault"].needs, by["spaces.WFH.classificationDefault"].payload], ["spaceId", { spaceKey: "WFH", levelId: "confidential" }]);
  eq("spaceAdmins → the roster fields of the space policy", by["spaces.WFH.spaceAdmins"].payload, { scope: "space", key: "WFH", data: { adminUsers: [{ accountId: "712020:a" }], adminGroups: ["confluence-admins"] } });
  eq("seal-attachment payload + page context", [by["content[0]"].payload, by["content[0]"].pageId], [{ attachmentId: "att265945089", lockDuration: 86400, note: "freeze" }, "265912321"]);
  eq("unseal-attachment carries adminOverride + reason", by["content[1]"].payload, { attachmentId: "att1", adminOverride: true, reason: "done" });
  eq("seal-section resolves the heading at run time", [by["content[2]"].needs, by["content[2]"].payload], ["headingIndex", { pageId: "9", headingText: "Pricing", lockDuration: undefined }]);
  eq("unseal-section", by["content[3]"].payload, { sectionId: "sec1", reason: "r" });
  // Direct grants (2026-09-17): their own bundle so the plan-order assertion above stays as it was.
  const grants = { version: 1, content: [
    { op: "grant-attachment-edit", attachmentId: "att1", editorAccountId: "712020:abc-1" },
    { op: "revoke-attachment-edit", attachmentId: "att1", editorAccountId: "712020:abc-1" },
    { op: "grant-section-edit", sectionId: "sec1", editorAccountId: "712020:abc-1" },
    { op: "revoke-section-edit", sectionId: "sec1", editorAccountId: "712020:abc-1" },
  ] };
  eq("grant bundle validates", validateBundle(grants).errors, []);
  eq("grant ops map to the owner-gated resolvers", planBundle(grants).map((s) => [s.resolverKey, s.payload]), [
    ["grant-edit-access", { attachmentId: "att1", editorAccountId: "712020:abc-1" }],
    ["revoke-edit-grant", { attachmentId: "att1", editorAccountId: "712020:abc-1" }],
    ["grant-section-edit", { sectionId: "sec1", editorAccountId: "712020:abc-1" }],
    ["revoke-section-edit-grant", { sectionId: "sec1", editorAccountId: "712020:abc-1" }],
  ]);
  eq("a grant with no editor is refused", validateBundle({ version: 1, content: [{ op: "grant-section-edit", sectionId: "sec1" }] }).errors.length > 0, true);
  eq("a grant with a malformed editor id is refused", validateBundle({ version: 1, content: [{ op: "grant-attachment-edit", attachmentId: "att1", editorAccountId: "a b<script>" }] }).errors.length > 0, true);
  eq("classify-page", by["content[4]"].payload, { pageId: "9", levelId: "restricted" });
  eq("assign-workflow", by["content[5]"].payload, { pageId: "9", workflowId: "review" });
  eq("transition", by["content[6]"].payload, { pageId: "9", toStateId: "approved", reason: "ship" });
  eq("touched spaces", touchedSpaceKeys(plan), ["WFH"]);
  eq("no $replace → no prune step", planBundle({ version: 1, spaces: { A: { workflows: [{ workflowId: "x", def: {} }] } } }).map((s) => s.resolverKey), ["store-space-workflow"]);
  eq("classificationDefault null is a reset step", planBundle({ version: 1, spaces: { A: { classificationDefault: null } } })[0].payload.levelId, null);
  eq("empty bundle → empty plan", planBundle({ version: 1 }), []);
}

// ── admission ────────────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-09-15T10:00:00Z");
  const fresh = (status) => ({ status, startedAt: new Date(now - 1000).toISOString() });
  eq("no key → invalid", decideAdmission({ existingJob: null, runningForToken: false, key: null, nowMs: now }).outputKey, OUTPUT.invalid);
  eq("bad key → invalid", decideAdmission({ existingJob: null, runningForToken: false, key: "a b", nowMs: now }).outputKey, OUTPUT.invalid);
  eq("fresh → accepted", decideAdmission({ existingJob: null, runningForToken: false, key: "job-1", nowMs: now }), { outputKey: OUTPUT.accepted, noop: false, stale: false });
  eq("same key running → conflict", decideAdmission({ existingJob: fresh("running"), runningForToken: false, key: "job-1", nowMs: now }).outputKey, OUTPUT.conflict);
  eq("same key queued → conflict", decideAdmission({ existingJob: { status: "queued" }, runningForToken: true, key: "job-1", nowMs: now }).outputKey, OUTPUT.conflict);
  eq("same key done → accepted no-op", decideAdmission({ existingJob: { status: "done" }, runningForToken: true, key: "job-1", nowMs: now }), { outputKey: OUTPUT.accepted, noop: true, stale: false });
  eq("same key refused → accepted no-op", decideAdmission({ existingJob: { status: "refused" }, runningForToken: false, key: "job-1", nowMs: now }).noop, true);
  eq("another job for the token running → busy", decideAdmission({ existingJob: null, runningForToken: true, key: "job-2", nowMs: now }).outputKey, OUTPUT.busy);

  // A wedged `running` row is settled (no 409), flagged stale so the trigger writes the failure.
  const wedged = { status: "running", startedAt: new Date(now - CONSUMER_TIMEOUT_MS - 1).toISOString() };
  eq("stale running → accepted, noop, stale", decideAdmission({ existingJob: wedged, runningForToken: false, key: "job-1", nowMs: now }), { outputKey: OUTPUT.accepted, noop: true, stale: true });
  ok("isStaleRunning: past the timeout", isStaleRunning(wedged, now, CONSUMER_TIMEOUT_MS));
  ok("isStaleRunning: within the timeout is live", !isStaleRunning(fresh("running"), now, CONSUMER_TIMEOUT_MS));
  ok("isStaleRunning: exactly at the timeout is live", !isStaleRunning({ status: "running", startedAt: new Date(now - CONSUMER_TIMEOUT_MS).toISOString() }, now, CONSUMER_TIMEOUT_MS));
  ok("isStaleRunning: running with no startedAt is stale", isStaleRunning({ status: "running" }, now, CONSUMER_TIMEOUT_MS));
  ok("isStaleRunning: queued is never stale", !isStaleRunning({ status: "queued" }, now, CONSUMER_TIMEOUT_MS));
  ok("isStaleRunning: done is never stale", !isStaleRunning({ status: "done", startedAt: "2020-01-01T00:00:00Z" }, now, CONSUMER_TIMEOUT_MS));
  ok("isActiveJob: live running holds the slot", isActiveJob(fresh("running"), now));
  ok("isActiveJob: stale running frees the slot", !isActiveJob(wedged, now));
  ok("isActiveJob: null frees the slot", !isActiveJob(null, now));
  const failed = staleFailureReceipt({ id: "k", status: "running", tokenId: "tok_1", bundle: { version: 1 }, results: [{ path: "a", status: "applied" }] }, "2026-09-15T10:05:00Z");
  eq("stale receipt: failed with the resubmit reason", [failed.status, failed.reason, failed.error], ["failed", STALE_RUNNING_REASON, STALE_RUNNING_REASON]);
  ok("stale receipt drops the bundle, keeps the results", !("bundle" in failed) && failed.results.length === 1 && failed.finishedAt === "2026-09-15T10:05:00Z");

  // Idempotency-Key is scoped to the token: the row is api-job-<tokenId>:<key>, the active marker
  // lives under its own prefix so a job listing by prefix never sees it.
  eq("job id is tokenId:key", jobId("tok_a", "deploy-1"), "tok_a:deploy-1");
  eq("job row key", jobKvsKey(jobId("tok_a", "deploy-1")), "api-job-tok_a:deploy-1");
  ok("two tokens, same key → different rows", jobKvsKey(jobId("tok_a", "k")) !== jobKvsKey(jobId("tok_b", "k")));
  eq("active marker prefix", activeJobKvsKey("tok_a"), "api-active-tok_a");
  ok("active marker is NOT under the job prefix", !activeJobKvsKey("tok_a").startsWith(JOB_PREFIX) && ACTIVE_PREFIX !== JOB_PREFIX);
  // Cross-token collision: token B's row for key k is what decides B, never A's running job.
  const rows = { [jobKvsKey(jobId("tok_a", "k"))]: fresh("running") };
  eq("token A, same key → conflict", decideAdmission({ existingJob: rows[jobKvsKey(jobId("tok_a", "k"))] || null, runningForToken: false, key: "k", nowMs: now }).outputKey, OUTPUT.conflict);
  eq("token B, same key → its own fresh job", decideAdmission({ existingJob: rows[jobKvsKey(jobId("tok_b", "k"))] || null, runningForToken: false, key: "k", nowMs: now }).outputKey, OUTPUT.accepted);
}

// ── the sentinel-vault-config mirror carries only what every viewer may see ──
{
  const full = {
    version: 1, spaceKey: "WFH", exportedAt: "2026-09-15T00:00:00Z",
    policy: { defaultLockDuration: 3600, allowAdminOverride: true, adminUsers: [{ accountId: "712020:a" }], adminGroups: ["g"] },
    validation: { enabled: true, modes: { advisory: true, gate: false }, rules: [{ id: "r1", pattern: "secret" }], ai: { styleGuide: "prompt", compliance: "prompt" } },
    workflows: [{ workflowId: "review", def: { name: "Review", states: [{ id: "s" }] }, labels: ["policy"], priority: 1 }, { workflowId: "default", def: { states: [] } }],
    workflowSettings: { approval: { approvers: ["712020:a"] }, entryConditions: {} },
    classificationDefault: "confidential",
    spaceAdmins: { users: ["712020:a"], groups: ["g"] },
  };
  const m = redactConfigForMirror(full, "space");
  const stripped = ["spaceAdmins", "workflowSettings"];
  for (const k of stripped) ok(`mirror has no ${k}`, !(k in m));
  ok("mirror policy has no roster", !("adminUsers" in m.policy) && !("adminGroups" in m.policy));
  eq("mirror policy keeps durations/toggles", m.policy, { defaultLockDuration: 3600, allowAdminOverride: true });
  eq("mirror validation is { enabled, modes } only", m.validation, { enabled: true, modes: { advisory: true, gate: false } });
  eq("mirror workflows carry no definitions", m.workflows, [{ workflowId: "review", name: "Review", labels: ["policy"], priority: 1 }, { workflowId: "default", name: null, labels: [], priority: null }]);
  eq("mirror keeps classificationDefault", m.classificationDefault, "confidential");
  eq("mirror keeps the envelope", [m.version, m.spaceKey, m.exportedAt], [1, "WFH", "2026-09-15T00:00:00Z"]);
  const text = JSON.stringify(m);
  for (const secret of ["712020:a", "secret", "prompt", "styleGuide", "compliance", "approvers", "entryConditions", "states", "rules", "ai"]) ok(`mirror text never contains "${secret}"`, !text.includes(`"${secret}"`) && !text.includes(secret === "712020:a" ? secret : `"${secret}":`));
  const site = redactConfigForMirror({ version: 1, exportedAt: "x", policy: { autoUnlockTimeoutHours: 2, adminUsers: [] }, validation: { enabled: false, ai: { x: 1 }, rules: [1] }, classification: { provider: "kvs", levels: [{ id: "public" }] } }, "site");
  eq("site mirror shape", Object.keys(site).sort(), ["classification", "exportedAt", "policy", "validation", "version"]);
  eq("site mirror validation reduced", site.validation, { enabled: false, modes: null });
  ok("site mirror policy has no roster", !("adminUsers" in site.policy));
  eq("site mirror keeps the public levels", site.classification.levels, [{ id: "public" }]);
  eq("redact tolerates null validation/workflows", redactConfigForMirror({ policy: null }, "space"), { policy: null, validation: null, workflows: [], classificationDefault: null });
  eq("redact passes a non-object through", redactConfigForMirror(null), null);
}

// ── consumer helpers ─────────────────────────────────────────────────────────
{
  eq("interpret success", interpretResult({ success: true }), { status: "applied" });
  eq("interpret ok", interpretResult({ ok: true, levels: [] }), { status: "applied" });
  eq("interpret refusal reason", interpretResult({ success: false, reason: "nope" }), { status: "refused", reason: "nope" });
  eq("interpret results[] all ok", interpretResult({ results: [{ ok: true }] }), { status: "applied" });
  eq("interpret results[] one refused", interpretResult({ results: [{ ok: false, reason: "Not authorized" }] }), { status: "refused", reason: "Not authorized" });
  eq("interpret empty → refused", interpretResult(null), { status: "refused", reason: "Refused" });

  eq("validation merge overlays and keeps rules", mergeValidationConfig({ enabled: false, modes: { advisory: true, gate: false }, rules: [{ id: "r1" }] }, { enabled: true, modes: { gate: true } }), { enabled: true, modes: { advisory: true, gate: true }, rules: [{ id: "r1" }] });
  eq("validation merge rules by id", mergeValidationConfig({ rules: [{ id: "r1", sev: "warn" }, { id: "r2" }] }, { rules: [{ id: "r1", sev: "block" }, { id: "r3" }] }).rules, [{ id: "r1", sev: "block" }, { id: "r2" }, { id: "r3" }]);
  eq("validation $replace rules", mergeValidationConfig({ rules: [{ id: "r1" }], ai: { x: 1 } }, { rules: { $replace: true, items: [{ id: "r9" }] } }), { rules: [{ id: "r9" }], ai: { x: 1 } });
  eq("validation merge from nothing", mergeValidationConfig(null, { enabled: true }), { enabled: true });

  eq("summarize done", summarize([{ status: "applied" }]), { summary: { applied: 1, refused: 0, failed: 0, skipped: 0 }, status: "done" });
  eq("summarize partial", summarize([{ status: "applied" }, { status: "refused" }]).status, "partial");
  eq("summarize failed", summarize([{ status: "refused" }, { status: "failed" }]).status, "failed");
  eq("summarize empty plan is done", summarize([]).status, "done");

  const hs = [{ index: 0, text: "Intro" }, { index: 4, text: "Pricing" }];
  eq("heading exact", findHeadingIndex(hs, "Pricing"), 4);
  eq("heading case-insensitive", findHeadingIndex(hs, " pricing "), 4);
  eq("heading missing", findHeadingIndex(hs, "Nope"), null);
  eq("heading no list", findHeadingIndex(undefined, "x"), null);

  const r1 = pushReceipt(null, { id: "a" }, 2);
  eq("receipt list newest first", r1.receipts.map((r) => r.id), ["a"]);
  const r2 = pushReceipt(pushReceipt(r1, { id: "b" }, 2), { id: "c" }, 2);
  eq("receipt list capped", r2.receipts.map((r) => r.id), ["c", "b"]);
  eq("receipt dedup by id", pushReceipt(r2, { id: "b", v: 2 }, 2).receipts.map((r) => r.id), ["b", "c"]);
}



// scopeOfConfigWrite — the registry's one rule for "which mirror does this UI write refresh".
{
  const { scopeOfConfigWrite, CONFIG_WRITER_KEYS } = await import("../src/server/capsules/config-api/mirror.js");
  eq("global policy → site", scopeOfConfigWrite("store-policy", { scope: "global", data: {} }).scope, "site");
  eq("space policy → space", scopeOfConfigWrite("store-policy", { scope: "space", key: "WFH" }).spaceKey, "WFH");
  eq("space validation → space", scopeOfConfigWrite("store-validation-config", { scope: "space", key: "X" }).spaceKey, "X");
  eq("workflow settings → space", scopeOfConfigWrite("set-space-workflow-settings", { spaceKey: "WFH" }).scope, "space");
  eq("workflow without spaceKey → null", scopeOfConfigWrite("store-space-workflow", {}), null);
  eq("levels → site", scopeOfConfigWrite("classification-manage-levels", {}).scope, "site");
  eq("space default → by id", JSON.stringify(scopeOfConfigWrite("classification-set-space-default", { spaceIds: [1, 2] }).spaceIds), '["1","2"]');
  eq("unknown key → null", scopeOfConfigWrite("seal-artifact", {}), null);
  ok("every writer key is a string", CONFIG_WRITER_KEYS.every((k) => typeof k === "string"));
}
report("config-api");
