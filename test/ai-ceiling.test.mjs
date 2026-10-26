// The site AI switch is a HARD CEILING (owner decision 2026-10-17). Forge LLM tokens are billed to
// LeanZero, and from 8.10.0 every space admin (personal-space owners included) can edit a space's
// AI settings. Before this, a space config with ai.enabled defined replaced the site's AI config
// outright: a space could switch AI on with the site switch off, and a space budget of 0
// (unlimited) or 10x the site's was honoured.
//
// The rule: site AI off => no space runs AI; a site budget N => no space budget above N (0 at
// space level means "unlimited" and is capped to N too). Pinned here on the pure core AND on every
// path that spends or reports AI: the manual review, the workflow AI gate (request and
// re-request share enqueueAiGate), the queue consumer right before the Forge LLM call (both of
// its branches), the panel's aiEnabled flag, the save resolver (UI and config REST API), the
// settings load the editors read, and the REST receipt.
//
// Every refusal is checked with fake.llmCalls (no model call made) and fake.queued (no job
// pushed); every grant has its positive control on the same space.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { fileURLToPath } from "node:url"; // a path, not a %20-encoded URL: the checkout path has a space

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
// Forge KVS refuses a key outside [a-zA-Z0-9:._\s-#] (a personal space key `~7120…` raw in a key
// throws). The shared fake accepts anything, which is how an unsanitised ai-usage key hid; here
// the fake refuses like the real store.
const KEY_OK = /^[a-zA-Z0-9:._\s\-#]+$/;
for (const m of ["get", "set", "delete"]) {
  const real = kvs[m];
  kvs[m] = async (k, ...rest) => { if (!KEY_OK.test(String(k))) throw new Error(`invalid key ${k}`); return real(k, ...rest); };
}
const L = await import("../src/server/capsules/validations/logic.js");
const A = await import("../src/server/capsules/validations/actions.js");
const W = await import("../src/server/capsules/validations/ai-worker.js");
const P = await import("../src/server/capsules/config-api/pure.js");
const AL = await import("../src/server/infra/activity-log.js");

const quiet = () => { console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {}; };
const say = console.log.bind(console);
quiet();

const STEWARD = "acct-space-admin";
const SPACE = { key: "POL", id: "77" };
const PAGE = "5001";
const GKEY = "validation-config-global";
const SKEY = `validation-config-space-${SPACE.key}`;
const byKey = (list, key) => (list.find(([k]) => k === key) || [])[1];
const fns = (name) => (typeof L[name] === "function" ? L[name] : null);

// ── pure core ──────────────────────────────────────────────────────────────────────────────────
// (fallbacks only so a run against the pre-fix module reports every red line instead of crashing)
const cap = fns("capAiConfig") || ((site, space) => (space && space.enabled !== undefined ? space : (site || {})));
eq("site off + space on => off", cap({ enabled: false }, { enabled: true }).enabled, false);
eq("site config missing (the shipped default, off) + space on => off", cap(undefined, { enabled: true }).enabled, false);
eq("site on + space on => on", cap({ enabled: true }, { enabled: true }).enabled, true);
eq("site on + space off => off (a space may always turn AI off)", cap({ enabled: true }, { enabled: false }).enabled, false);
eq("site on + no space AI => the site's", cap({ enabled: true, monthlyTokenBudget: 7 }, null).enabled, true);
eq("site budget N + space unlimited (0) => N", cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: 0 }).monthlyTokenBudget, 1000);
eq("site budget N + space budget missing => N", cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true }).monthlyTokenBudget, 1000);
eq("site budget N + space greater => N", cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: 5000 }).monthlyTokenBudget, 1000);
eq("site budget N + space smaller => the space's", cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: 400 }).monthlyTokenBudget, 400);
eq("site budget N + space equal => N", cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: 1000 }).monthlyTokenBudget, 1000);
eq("site budget N + space negative/garbage => N", [cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: -5 }).monthlyTokenBudget, cap({ enabled: true, monthlyTokenBudget: 1000 }, { enabled: true, monthlyTokenBudget: "lots" }).monthlyTokenBudget], [1000, 1000]);
eq("site budget N as a string still caps", cap({ enabled: true, monthlyTokenBudget: "1000" }, { enabled: true, monthlyTokenBudget: 0 }).monthlyTokenBudget, 1000);
eq("site unlimited (0) + space budget => the space's", cap({ enabled: true, monthlyTokenBudget: 0 }, { enabled: true, monthlyTokenBudget: 300 }).monthlyTokenBudget, 300);
eq("site unlimited + space unlimited => unlimited", cap({ enabled: true, monthlyTokenBudget: 0 }, { enabled: true, monthlyTokenBudget: 0 }).monthlyTokenBudget, 0);
eq("the space's prompts are kept (only switch and budget are capped)", cap({ enabled: true, rules: "site" }, { enabled: true, rules: "space" }).rules, "space");
eq("capped reasons: site off", cap({ enabled: false }, { enabled: true }).ceiling?.capped, ["site-off"]);
eq("capped reasons: budget", cap({ enabled: true, monthlyTokenBudget: 10 }, { enabled: true, monthlyTokenBudget: 0 }).ceiling?.capped, ["site-budget"]);
eq("capped reasons: none for an obedient space", cap({ enabled: true, monthlyTokenBudget: 10 }, { enabled: true, monthlyTokenBudget: 5 }).ceiling?.capped, []);
eq("capped reasons: none when the space inherits the site", cap({ enabled: true, monthlyTokenBudget: 10 }, null).ceiling?.capped, []);
eq("a stored `ceiling` on a space config is never trusted", cap({ enabled: false }, { enabled: true, ceiling: { siteEnabled: true, capped: [] } }).ceiling?.siteEnabled, false);
ok("a cap note names the site admin", /turned off for this site by a site admin/i.test((fns("aiCapNote") || (() => ""))(cap({ enabled: false }, { enabled: true })) || ""));
eq("a fractional budget is 1 token, never unlimited", [(fns("budgetOf") || (() => null))(0.5), (fns("budgetOf") || (() => null))(0), (fns("budgetOf") || (() => null))(Infinity)], [1, 0, 0]);
eq("no note when nothing was capped", (fns("aiCapNote") || (() => "x"))(cap({ enabled: true }, { enabled: true })), null);

// ── a Confluence with one page in one space, and one Sentinel Vault space admin ─────────────────
const PAGE_DOC = { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body text." }] }] };
async function world({ site, space, used = 0, pending = null } = {}) {
  resetFake();
  fake.queued = [];
  fake.llmCalls = [];
  fake.llm = async () => ({ choices: [{ message: { content: '{"findings":[],"summary":"No issues found."}' }, finish_reason: "stop" }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base] = path.split("?");
    if (base === `/wiki/api/v2/pages/${PAGE}` && method === "GET") {
      return { body: { id: PAGE, spaceId: SPACE.id, title: "Policy", version: { number: 3, authorId: STEWARD }, body: { atlas_doc_format: { value: JSON.stringify(PAGE_DOC) } } } };
    }
    if (base === `/wiki/api/v2/spaces/${SPACE.id}`) return { body: { id: SPACE.id, key: SPACE.key } };
    // The space admin can read the page (an AI review needs read access to it, 8.8.0).
    if (base === `/wiki/rest/api/content/${PAGE}/permission/check` && method === "POST") return { body: { hasPermission: true } };
    return undefined;
  });
  await kvs.set(`admin-settings-space-${SPACE.key}`, { adminUsers: [{ accountId: STEWARD }] });
  if (site !== undefined) await kvs.set(GKEY, { enabled: true, modes: { advisory: true, gate: false, revert: false }, rules: [], ai: site });
  if (space !== undefined) await kvs.set(SKEY, { enabled: true, rules: [], modes: null, ai: space });
  if (used) {
    const d = new Date();
    await kvs.set(`ai-usage-${SPACE.key}-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`, { inputTokens: used, outputTokens: 0, totalTokens: used, runs: 1 });
  }
  if (pending) await kvs.set(`workflow-pending-${PAGE}`, pending);
}
const pendingGate = () => ({ toStateId: "approved", toStateName: "Approved", requestedBy: STEWARD, pinnedVersion: 3, approvers: ["acct-approver"], mode: "any", min: 1, spaceKey: SPACE.key, aiGate: { required: true, status: "pending", threshold: "medium", reviewedVersion: null, reason: null, enqueuedAt: Date.now() } });
const ctx = (accountId = STEWARD) => ({ accountId, extension: {} });
const aiQueued = () => (fake.queued || []).filter((q) => q.key === "ai-validation-queue").length;

// resolveAiConfig — the one function every spender reads.
await world({ site: { enabled: false }, space: { enabled: true, monthlyTokenBudget: 0 } });
eq("resolveAiConfig: site off + space on => off", (await L.resolveAiConfig(SPACE.key)).enabled, false);
await world({ space: { enabled: true } });
eq("resolveAiConfig: no site config at all + space on => off", (await L.resolveAiConfig(SPACE.key)).enabled, false);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 0 } });
eq("resolveAiConfig: site budget N + space unlimited => N", (await L.resolveAiConfig(SPACE.key)).monthlyTokenBudget, 1000);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 9000 } });
eq("resolveAiConfig: site budget N + space greater => N", (await L.resolveAiConfig(SPACE.key)).monthlyTokenBudget, 1000);
await world({ site: { enabled: false }, space: { enabled: true } });
eq("resolveEffectiveConfig carries the capped AI too", (await L.resolveEffectiveConfig(SPACE.key)).ai?.enabled, false);

// ── spender 1: the manual review (enqueue-page-validation) ─────────────────────────────────────
await world({ site: { enabled: false }, space: { enabled: true } });
let r = await A.enqueuePageValidation({ payload: { pageId: PAGE }, context: ctx() });
eq("manual review: site off + space on => refused", r.success, false);
ok("…with the site-admin reason", /turned off for this site by a site admin/i.test(r.reason || ""));
eq("…and no job queued", aiQueued(), 0);
await world({ site: { enabled: true }, space: { enabled: true } });
r = await A.enqueuePageValidation({ payload: { pageId: PAGE }, context: ctx() });
eq("manual review: site on + space on => queued (positive control)", [r.success, aiQueued()], [true, 1]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 0 }, used: 1000 });
r = await A.enqueuePageValidation({ payload: { pageId: PAGE }, context: ctx() });
eq("manual review: space unlimited, site budget used up => refused, nothing queued", [r.success, aiQueued()], [false, 0]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 5000 }, used: 1200 });
r = await A.enqueuePageValidation({ payload: { pageId: PAGE }, context: ctx() });
eq("manual review: space budget above the site's, site's used up => refused", [r.success, aiQueued()], [false, 0]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 5000 }, used: 999 });
r = await A.enqueuePageValidation({ payload: { pageId: PAGE }, context: ctx() });
eq("manual review: under the site budget => queued (positive control)", [r.success, aiQueued()], [true, 1]);

// ── spender 2: the workflow AI gate (request-transition and re-request both call enqueueAiGate) ──
await world({ site: { enabled: false }, space: { enabled: true } });
r = await A.enqueueAiGate({ pageId: PAGE, spaceKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "block" });
eq("AI gate: site off + space on => not enqueued", [r.enqueued, aiQueued()], [false, 0]);
ok("…the required review cannot run, so the move is blocked with the site reason (never a silent pass)", r.verdict === "failed" && /site admin/i.test(r.reason || ""));
r = await A.enqueueAiGate({ pageId: PAGE, spaceKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "allow" });
ok("AI gate: site off + space on + allow => passes with the site warning, nothing queued", r.verdict === "passed" && /site admin.*warning/i.test(r.reason || "") && aiQueued() === 0);
await world({ site: { enabled: false }, space: { enabled: false } });
r = await A.enqueueAiGate({ pageId: PAGE, spaceKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "block" });
ok("AI gate: the SPACE has AI off => skipped as it always was (the space's own choice)", r.verdict === "passed" && /isn't enabled/i.test(r.reason || "") && aiQueued() === 0);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 0 }, used: 1000 });
r = await A.enqueueAiGate({ pageId: PAGE, spaceKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "block" });
eq("AI gate: space unlimited, site budget used up => not enqueued, blocked", [r.enqueued, r.verdict, aiQueued()], [false, "failed", 0]);
await world({ site: { enabled: true }, space: { enabled: true } });
r = await A.enqueueAiGate({ pageId: PAGE, spaceKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "allow" });
eq("AI gate: site on => enqueued (positive control)", [r.enqueued, aiQueued()], [true, 1]);
eq("…the job carries onBudgetExhausted so the consumer can apply it at spend time", fake.queued[0]?.events?.body?.onBudgetExhausted, "allow");

// ── spender 3: the queue consumer, right before the Forge LLM call ──────────────────────────────
// A job queued while AI was on must not spend once the site switch is off (or the budget is gone).
await world({ site: { enabled: false }, space: { enabled: true } });
await W.aiValidationConsumer({ body: { taskId: "t1", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, requestedBy: STEWARD } });
eq("consumer (manual): site off + space on => no model call", fake.llmCalls.length, 0);
eq("…the job ends in an error naming the site switch", [(await kvs.get("ai-validation-status-t1"))?.status, /site admin/i.test((await kvs.get("ai-validation-status-t1"))?.error || "")], ["error", true]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 0 }, used: 1000 });
await W.aiValidationConsumer({ body: { taskId: "t2", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, requestedBy: STEWARD } });
eq("consumer (manual): budget used up by the time the job runs => no model call", [fake.llmCalls.length, (await kvs.get("ai-validation-status-t2"))?.status], [0, "error"]);
await world({ site: { enabled: true }, space: { enabled: true } });
await W.aiValidationConsumer({ body: { taskId: "t3", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, requestedBy: STEWARD } });
eq("consumer (manual): site on => one model call, job done (positive control)", [fake.llmCalls.length, (await kvs.get("ai-validation-status-t3"))?.status], [1, "done"]);
{ // review finding 7: a manual job DELIVERED TWICE (same taskId, both in flight) is metered twice.
  // With the taskId as the reservation id the second reserve overwrote the first and the second
  // settle found nothing to settle: one model call went uncounted.
  await world({ site: { enabled: true }, space: { enabled: true } });
  const { aiAllowance, rowKey, monthKeyOf } = await import("../src/server/capsules/validations/allowance.js");
  const gates = [];
  const arrived = [];
  fake.llm = () => new Promise((res) => { gates.push(() => res({ choices: [{ message: { content: '{"findings":[],"summary":"ok"}' }, finish_reason: "stop" }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } })); arrived.push(1); });
  const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };
  const body = { taskId: "dup", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, requestedBy: STEWARD };
  const first = W.aiValidationConsumer({ body });
  await until(() => arrived.length === 1);
  const second = W.aiValidationConsumer({ body });
  await until(() => arrived.length === 2);
  const mid = await kvs.get(rowKey(monthKeyOf(Date.now())));
  eq("finding 7: two in-flight deliveries hold two reservations", Object.keys(mid?.reservations || {}).length, 2);
  gates[0](); await first;
  gates[1](); await second;
  const row = await kvs.get(rowKey(monthKeyOf(Date.now())));
  eq("finding 7: both calls are charged (2 x (10 + 5 x 5) micro), nothing left reserved", [row?.spentMicro, row?.reservedMicro], [70, 0]);
  void aiAllowance;
}

await world({ site: { enabled: false }, space: { enabled: true }, pending: pendingGate() });
await W.aiValidationConsumer({ body: { taskId: "g1", mode: "gate", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, pinnedVersion: 3, threshold: "medium" } });
let gate = (await kvs.get(`workflow-pending-${PAGE}`))?.aiGate;
eq("consumer (gate): site off + space on => no model call", fake.llmCalls.length, 0);
ok("…a job without onBudgetExhausted (queued before 8.10.0) blocks, with the site reason", gate?.status === "failed" && /site admin/i.test(gate?.reason || ""));
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true, monthlyTokenBudget: 0 }, used: 1000, pending: pendingGate() });
await W.aiValidationConsumer({ body: { taskId: "g2", mode: "gate", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "block" } });
gate = (await kvs.get(`workflow-pending-${PAGE}`))?.aiGate;
eq("consumer (gate): budget used up at spend time => no model call, blocked", [fake.llmCalls.length, gate?.status], [0, "failed"]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 }, space: { enabled: true }, used: 1000, pending: pendingGate() });
await W.aiValidationConsumer({ body: { taskId: "g3", mode: "gate", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "allow" } });
gate = (await kvs.get(`workflow-pending-${PAGE}`))?.aiGate;
eq("consumer (gate): budget used up + allow => no model call, passed with a warning", [fake.llmCalls.length, gate?.status], [0, "passed"]);
await world({ site: { enabled: true }, space: { enabled: true }, pending: pendingGate() });
await W.aiValidationConsumer({ body: { taskId: "g4", mode: "gate", pageId: PAGE, spaceKey: SPACE.key, realmKey: SPACE.key, pinnedVersion: 3, threshold: "medium" } });
eq("consumer (gate): site on => one model call (positive control)", fake.llmCalls.length, 1);

// ── a personal space (`~…` key): the budget is read and counted, never thrown on ─────────────────
{
  resetFake(); fake.queued = []; fake.llmCalls = [];
  const PERSONAL = "~7120abcdef";
  await kvs.set(GKEY, { ai: { enabled: true, monthlyTokenBudget: 1000 } });
  await kvs.set(`validation-config-space-${PERSONAL.replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}`, { ai: { enabled: true, monthlyTokenBudget: 0 } });
  let threw = null, spend = null;
  try { spend = await L.checkAiSpend(PERSONAL); } catch (e) { threw = String(e?.message || e); }
  eq("personal space: the spend gate answers (no invalid-key throw)", [threw, spend?.ok], [null, true]);
  try { await L.accrueTokenUsage(PERSONAL, { inputTokens: 600, outputTokens: 400, totalTokens: 1000 }); } catch (e) { threw = String(e?.message || e); }
  eq("personal space: usage is counted", [threw, await L.getMonthlyTokenUsage(PERSONAL).catch(() => "threw")], [null, 1000]);
  try { spend = await L.checkAiSpend(PERSONAL); } catch (e) { threw = String(e?.message || e); spend = null; }
  eq("personal space: the site budget applies once it is used up", [threw, spend?.ok, spend?.why], [null, false, "budget"]);
  let gateR = null;
  try { gateR = await A.enqueueAiGate({ pageId: PAGE, spaceKey: PERSONAL, pinnedVersion: 3, threshold: "medium", onBudgetExhausted: "block" }); } catch (e) { threw = String(e?.message || e); }
  eq("personal space: the AI gate resolves (blocked), never throws mid-request", [threw, gateR?.verdict, aiQueued()], [null, "failed", 0]);
}

// ── reporters: the panel's aiEnabled flag ──────────────────────────────────────────────────────
await world({ site: { enabled: false }, space: { enabled: true } });
eq("get-ai-findings: site off + space on => aiEnabled false (no Run AI review button)", (await A.getAiFindings({ payload: { pageId: PAGE }, context: { accountId: STEWARD, extension: { content: { id: PAGE, space: { key: SPACE.key } } } } })).aiEnabled, false);
await world({ site: { enabled: true }, space: { enabled: true } });
eq("get-ai-findings: site on => aiEnabled true (positive control)", (await A.getAiFindings({ payload: { pageId: PAGE }, context: { accountId: STEWARD, extension: { content: { id: PAGE, space: { key: SPACE.key } } } } })).aiEnabled, true);

// ── the save (UI and config REST API both store through store-validation-config) ───────────────
const store = byKey(A.actions, "store-validation-config");
const load = byKey(A.actions, "load-validation-config");
await world({ site: { enabled: false } });
r = await store({ payload: { scope: "space", key: SPACE.key, data: { enabled: true, rules: [], ai: { enabled: true, monthlyTokenBudget: 0 } } }, context: ctx() });
eq("save: site off + space turns AI on => saved (the space's choice is kept)", r.success, true);
eq("…the answer reports the EFFECTIVE value", r.effectiveAi?.enabled, false);
eq("…and says it was capped", r.capped, ["site-off"]);
ok("…in words", /turned off for this site by a site admin/i.test(r.note || ""));
const capEvents = [...fake.kvs.keys()].filter((k) => k.startsWith(`activity-space-${SPACE.key}-`)).map((k) => fake.kvs.get(k)).filter((e) => e?.type === "validation.ai-capped");
eq("…and the space's activity log records the cap", capEvents.length, 1);
eq("…with what was capped, and that this save turned AI on", [capEvents[0]?.details?.capped, capEvents[0]?.details?.turnedOn], [["site-off"], true]);
ok("validation.ai-capped is a known activity type", AL.ACTIVITY_TYPES.includes("validation.ai-capped"));
eq("…and still nothing can run", (await L.resolveAiConfig(SPACE.key)).enabled, false);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 } });
r = await store({ payload: { scope: "space", key: SPACE.key, data: { enabled: true, rules: [], ai: { enabled: true, monthlyTokenBudget: 50000 } } }, context: ctx() });
eq("save: space budget above the site's => effective N, capped", [r.success, r.effectiveAi?.monthlyTokenBudget, r.capped], [true, 1000, ["site-budget"]]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 } });
r = await store({ payload: { scope: "space", key: SPACE.key, data: { enabled: true, rules: [], ai: { enabled: true, monthlyTokenBudget: 500 } } }, context: ctx() });
eq("save: an obedient space is not capped and logs nothing", [r.success, r.capped || [], [...fake.kvs.keys()].filter((k) => k.startsWith("activity-space-")).length], [true, [], 0]);
await world({ site: { enabled: false } });
r = await store({ payload: { scope: "space", key: SPACE.key, data: { enabled: true, rules: [], ai: { enabled: true }, effectiveAi: { enabled: true } } }, context: ctx() });
eq("save: a derived effectiveAi in the payload is never stored", (await kvs.get(SKEY))?.effectiveAi, undefined);

// The load the settings editors (and the config export) read: the space's own values plus the
// effective, capped ones, so the UI can disable the controls and the export can say so.
await world({ site: { enabled: false }, space: { enabled: true, monthlyTokenBudget: 0 } });
let loaded = await load({ payload: { scope: "space", key: SPACE.key }, context: ctx() });
eq("load: the space's own value is returned as saved", loaded?.ai?.enabled, true);
eq("load: plus the effective value, capped", [loaded?.effectiveAi?.enabled, loaded?.effectiveAi?.siteEnabled, loaded?.effectiveAi?.capped], [false, false, ["site-off"]]);
await world({ site: { enabled: true, monthlyTokenBudget: 1000 } });
loaded = await load({ payload: { scope: "space", key: SPACE.key }, context: ctx() });
eq("load: a space with no config still learns the site switch and budget", [loaded?.effectiveAi?.siteEnabled, loaded?.effectiveAi?.siteBudget], [true, 1000]);
loaded = await load({ payload: { scope: "global" }, context: ctx() });
eq("load: the site scope carries no effectiveAi (it IS the ceiling)", loaded?.effectiveAi, undefined);

// The REST receipt carries the cap note through (interpretResult).
const ir = P.interpretResult({ success: true, note: "AI is turned off for this site by a site admin.", capped: ["site-off"] });
eq("REST receipt: applied with the cap note", [ir.status, ir.note], ["applied", "AI is turned off for this site by a site admin."]);
eq("REST receipt: no note, no field", "note" in P.interpretResult({ success: true }), false);
const merged = P.mergeValidationConfig({ ai: { enabled: false } }, { ai: { enabled: true }, effectiveAi: { enabled: true } });
eq("REST bundle: an exported effectiveAi posted back is dropped by the merge", merged.effectiveAi, undefined);

// The Confluence-side REST read (sentinel-vault-config space property): whether AI RUNS and what
// capped it; budgets, usage and prompts stay out.
const mirrored = P.redactConfigForMirror({ policy: {}, validation: { enabled: true, modes: null, ai: { enabled: true, rules: "secret prompt", monthlyTokenBudget: 0 }, effectiveAi: { enabled: false, monthlyTokenBudget: 1000, siteEnabled: false, siteBudget: 1000, capped: ["site-off"] } } }, "space");
eq("REST mirror: the effective switch and the cap reason", [mirrored.validation.aiEnabled, mirrored.validation.aiCapped], [false, ["site-off"]]);
ok("REST mirror: no prompt, no budget", !JSON.stringify(mirrored).includes("secret prompt") && !JSON.stringify(mirrored).includes("1000"));

// The audit line reads as a sentence on every surface that shows the space's activity.
const { formatActivity } = await import("../src/ui/kit/activity-format.js");
const row = (details) => formatActivity({ id: "x", ts: new Date().toISOString(), type: "validation.ai-capped", pageId: null, spaceKey: SPACE.key, actor: { accountId: STEWARD, name: "Alice Stone" }, target: { kind: "space", id: SPACE.key, name: null }, details });
eq("activity: site off", row({ capped: ["site-off"], turnedOn: true, asked: { enabled: true, monthlyTokenBudget: 0 } }).sentence, "Alice Stone turned on AI review for this space, but AI is turned off for this site by a site admin, so it stays off");
eq("activity: site off, AI already on, budget changed", row({ capped: ["site-off"], turnedOn: false, asked: { enabled: true, monthlyTokenBudget: 50 } }).sentence, "Alice Stone changed this space's AI settings, but AI is turned off for this site by a site admin, so it stays off");
eq("activity: budget", [row({ capped: ["site-budget"], asked: { enabled: true, monthlyTokenBudget: 0 }, siteBudget: 1000 }).sentence, row({ capped: ["site-budget"], asked: { enabled: true, monthlyTokenBudget: 0 }, siteBudget: 1000 }).detail], ["Alice Stone set this space's AI budget above the site's, so the site's 1,000 tokens a month applies", "asked for no limit"]);

// ── no path around the ceiling ─────────────────────────────────────────────────────────────────
// The model is called from exactly one module, and that module asks the spend gate in each of
// its two branches; the AI queue is fed only by the two enqueue paths, each behind the gate. A new
// caller of the Forge LLM, or a new push onto the queue, fails here until it goes through
// checkAiSpend.
const { readFileSync, readdirSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.(js|jsx|mjs)$/.test(f) ? [p] : []); });
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = walk(SRC).map((p) => [p.slice(SRC.length), readFileSync(p, "utf8")]);
const llmCallers = files.filter(([p, t]) => p !== "server/infra/forge-llm.js" && /\b(runForgeLlmJson|callForgeLlmChat)\s*\(/.test(t)).map(([p]) => p);
eq("the Forge LLM is called from the AI queue consumer only", llmCallers, ["server/capsules/validations/ai-worker.js"]);
eq("nothing but the wrapper imports @forge/llm", files.filter(([p, t]) => /from\s+["']@forge\/llm["']/.test(t)).map(([p]) => p), ["server/infra/forge-llm.js"]);
const worker = files.find(([p]) => p === "server/capsules/validations/ai-worker.js")[1];
eq("the consumer asks the spend gate in both branches, each before its model call", worker.split("checkAiSpend(").length - 1, 2);
ok("…and never reads the raw AI config", !/resolveAiConfig\(|validation-config-/.test(worker));
const pushers = files.filter(([, t]) => /["']ai-validation-queue["']/.test(t) && /\.push\(/.test(t)).map(([p]) => p);
eq("only the validations actions push onto the AI queue", pushers, ["server/capsules/validations/actions.js"]);
const actionsSrc = files.find(([p]) => p === "server/capsules/validations/actions.js")[1];
eq("…two pushes, two spend gates", [actionsSrc.split('key: "ai-validation-queue"').length - 1, actionsSrc.split("checkAiSpend(").length - 1], [2, 2]);
// A raw site or space `ai` object may only be handed to capAiConfig (which applies the ceiling).
const rawAiReaders = files.filter(([p, t]) => p !== "server/capsules/validations/logic.js" && p.startsWith("server/capsules/validations/")
  && /\b(space|global)\??\.ai\b/.test(t.replace(/capAiConfig\([^)]*\)/g, ""))).map(([p]) => p);
eq("no validations module but logic.js reads a raw site or space ai object except through capAiConfig", rawAiReaders, []);
// The site-wide allowance (allowance.js): the ONE model call sits between a reserve and a settle.
{
  const calls = worker.split(/\brunForgeLlmJson\s*\(/).length - 1;
  const iRes = worker.indexOf("aiAllowance.reserve("), iCall = worker.search(/\brunForgeLlmJson\s*\(/), iSet = worker.indexOf("aiAllowance.settle(");
  eq("the model is called in one place, between the allowance reserve and settle", [calls, iRes >= 0 && iRes < iCall, iCall < iSet], [1, true, true]);
  eq("both consumer branches go through callWithinAllowance", worker.split("callWithinAllowance(").length - 1, 3);
}

console.log = say;
report("ai-ceiling");
