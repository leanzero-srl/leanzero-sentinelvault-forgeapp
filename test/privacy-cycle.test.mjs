// The reporting cycle and the closed-account lifecycle (review 2026-10-05: C1, C3, C4, a, b, c, d,
// C2). Each block below started life as a repro that was RED on 5dba6ae (sv-break/snapshot-loop.mjs:
// 4 reports + 4 erasures in 4 sweeps at a 6.5-day gap; sv-break/cadence.mjs: gaps {7: 15, 14: 18}
// over a year; an out-of-batch "closed" answer accepted). The simulations drive the SAME pure
// functions the worker calls, in the worker's order.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import {
  extractAccountIds, planReport, nextReportAt, acceptAnswers, parseCyclePeriod, erasableMentions, entriesMentionOutsideContent,
  sweepSchedule, rewriteAccount, keyNamesAccount, holdsPageContent, removesFromLists, batches, CYCLE_MS, DUE_MARGIN_MS,
} from "../src/server/capsules/privacy/accounts.js";

const H = 3600000, D = 24 * H;
const CLOSED = "712020:11111111-2222-3333-4444-555555555555";
const OTHER = "712020:99999999-2222-3333-4444-555555555555";
const APP = "712020:aaaaaaaa-0000-4000-8000-0000000000ff";
const iso = (ms) => new Date(ms).toISOString();

/**
 * One sweep, mirroring worker.js runPrivacySweep on an in-memory store: inventory → planReport →
 * report (Atlassian answers `closed` for `closedAtAtlassian`) → erase what erasableMentions finds
 * or what was newly closed → backup purge decision. Returns what happened.
 */
function sweep(store, index, nowMs, { closedAtAtlassian = [], exclude = [] } = {}) {
  const closedIds = Object.entries(index).filter(([, e]) => e?.c).map(([id]) => id);
  const seen = new Set();
  const stillErasable = new Set();
  for (const [k, v] of store) {
    for (const id of extractAccountIds(k, v)) seen.add(id);
    for (const id of erasableMentions(k, v, closedIds)) stillErasable.add(id);
  }
  const plan = planReport(index, seen, nowMs, { exclude });
  const next = plan.index;
  const reported = [];
  const newlyClosed = [];
  for (const batch of batches(plan.due)) {
    const answers = batch.filter((a) => closedAtAtlassian.includes(a.accountId)).map((a) => ({ accountId: a.accountId, status: "closed" }));
    const { closed } = acceptAnswers(batch, answers);
    for (const a of batch) { next[a.accountId] = { ...next[a.accountId], r: iso(nowMs) }; reported.push(a.accountId); }
    for (const id of closed) { next[id] = { ...next[id], c: iso(nowMs), x: null }; newlyClosed.push(id); }
  }
  const unfinished = Object.entries(next).filter(([, e]) => e?.c && !e.x).map(([id]) => id);
  const toErase = [...new Set([...newlyClosed, ...unfinished, ...stillErasable])];
  let changes = 0;
  for (const [k, v] of [...store]) {
    if (holdsPageContent(k)) continue;
    if (toErase.some((id) => keyNamesAccount(k, id))) { store.delete(k); changes += 1; continue; }
    let val = v; let ch = false;
    for (const id of toErase) { const r = rewriteAccount(val, id, { mode: "erase", removeFromLists: removesFromLists(k) }); val = r.value; ch = ch || r.changed; }
    if (ch) { store.set(k, val); changes += 1; }
  }
  for (const id of toErase) next[id] = { ...next[id], x: iso(nowMs) };
  const backupJob = [...new Set([...newlyClosed, ...unfinished, ...(changes > 0 ? [...stillErasable] : [])])];
  return { index: next, reported, erased: toErase, changes, backupJob };
}

// ── C1: a closed person inside a sealed section is NOT reported or erased again ──────────────
{
  const store = new Map([
    ["section-snapshot-abc", { bodyContent: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: CLOSED, text: "@Bob" } }] }], hash: "h" }],
    [`sig-device-${CLOSED}`, { at: 1 }],
    [`read-ack-123-${CLOSED}`, { version: 1, accountId: CLOSED, name: "Bob" }],
    [`space-protection-~${CLOSED}`, ["att1"]], // a personal space key (sv-break/personal-space.mjs)
    ["protection-att1", { contentId: "9", spaceKey: `~${CLOSED}`, lockedBy: OTHER, lockedByName: "Ann" }],
  ]);
  let index = {};
  let t = Date.parse("2026-10-10T03:00:00Z");
  const runs = [];
  for (let i = 1; i <= 4; i++) {
    const r = sweep(store, index, t, { closedAtAtlassian: [CLOSED] });
    index = r.index;
    runs.push(r);
    t += 7 * D;
  }
  eq("sweep 1 reports the person and Atlassian says closed", runs[0].reported.includes(CLOSED), true);
  eq("sweep 1 erases their own rows", runs[0].changes, 2);
  eq("sweep 1 queues the backup erasure", runs[0].backupJob, [CLOSED]);
  for (const n of [1, 2, 3]) {
    eq(`sweep ${n + 1}: never reported again`, runs[n].reported.includes(CLOSED), false);
    eq(`sweep ${n + 1}: no erasure`, runs[n].erased, []);
    eq(`sweep ${n + 1}: no backup job (no generation dropped)`, runs[n].backupJob, []);
  }
  ok("the closed marker survives", !!index[CLOSED]?.c && !!index[CLOSED]?.x);
  ok("the sealed snapshot still holds the mention (the sealed record is not rewritten)", JSON.stringify(store.get("section-snapshot-abc")).includes(CLOSED));
  ok("the personal space key stays (Confluence's key, not a person reference)", store.has(`space-protection-~${CLOSED}`));
  // A restore of an older backup brings an erasable row back: erased again, NOT reported again.
  store.set(`read-ack-456-${CLOSED}`, { version: 2, accountId: CLOSED, name: "Bob" });
  const back = sweep(store, index, t, { closedAtAtlassian: [CLOSED] });
  eq("restored row: not reported again", back.reported.includes(CLOSED), false);
  eq("restored row: erased again", back.erased, [CLOSED]);
  eq("restored row: the backup is scrubbed again (rows changed)", back.backupJob, [CLOSED]);
  // An erasure that was cut off (x unset) finishes on the next sweep without asking Atlassian.
  const cut = { ...back.index, [CLOSED]: { ...back.index[CLOSED], x: null } };
  const fin = sweep(store, cut, t + 7 * D);
  eq("an unfinished erasure finishes, without a report", [fin.erased, fin.reported.includes(CLOSED)], [[CLOSED], false]);
}

// ── C1: the backup purge ignores mentions inside page content ───────────────────────────────
{
  const contentOnly = [["section-snapshot-abc", { bodyContent: [{ attrs: { id: CLOSED } }] }, null], ["validation-config-global", { enabled: true }, null]];
  const inRow = [...contentOnly, ["workflow-log-1-2", { by: CLOSED, byName: "Bob" }, null]];
  eq("purge: a generation whose only mention is sealed content is kept", entriesMentionOutsideContent(contentOnly, [CLOSED]), false);
  eq("purge: a generation with the person in an ordinary row is dropped", entriesMentionOutsideContent(inRow, [CLOSED]), true);
  eq("purge: the id in a KEY counts", entriesMentionOutsideContent([[`read-ack-1-${CLOSED}`, {}, null]], [CLOSED]), true);
  const engine = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/server/capsules/backup/engine.js"), "utf8");
  ok("engine purge uses the content-aware test on chunk entries", /entriesMentionOutsideContent\(parseChunk\(text\), list\)/.test(engine));
}

// ── C4: only ids from the batch ─────────────────────────────────────────────────────────────
{
  const batch = [{ accountId: OTHER, updatedAt: "x" }];
  const a = acceptAnswers(batch, [{ accountId: CLOSED, status: "closed" }, { accountId: OTHER, status: "updated" }, null, { status: "closed" }]);
  eq("an answer for an id never sent is ignored", a.closed, []);
  eq("an answer for a sent id is kept", a.updated, [OTHER]);
  eq("closed wins over updated for one id", acceptAnswers(batch, [{ accountId: OTHER, status: "updated" }, { accountId: OTHER, status: "closed" }]), { closed: [OTHER], updated: [] });
}

// ── (c) an owed name refresh is carried by the index ────────────────────────────────────────
{
  const t = Date.parse("2026-10-05T00:00:00Z");
  const p = planReport({ [OTHER]: { u: iso(t - D), r: iso(t - D), n: 1 } }, new Set([OTHER]), t);
  eq("the n flag survives planning", p.index[OTHER].n, 1);
  eq("and does not make the account due", p.due.length, 0);
}

// ── (b) the app's own account is never reported ─────────────────────────────────────────────
{
  const p = planReport({}, new Set([APP, OTHER]), Date.now(), { exclude: [APP] });
  eq("app account excluded from the plan", p.due.map((d) => d.accountId), [OTHER]);
  eq("app account not indexed", Object.keys(p.index), [OTHER]);
}

// ── (a) Cycle-Period ────────────────────────────────────────────────────────────────────────
eq("Cycle-Period absent → keep the default", parseCyclePeriod(null), null);
eq("Cycle-Period 7 (days)", parseCyclePeriod("7"), 7 * D);
eq("Cycle-Period 14", parseCyclePeriod("14"), 14 * D);
eq("Cycle-Period in seconds (1209600)", parseCyclePeriod("1209600"), 14 * D);
eq("Cycle-Period P10D", parseCyclePeriod("P10D"), 10 * D);
eq("Cycle-Period clamped up to 1 day", parseCyclePeriod("0.1"), 1 * D);
eq("Cycle-Period clamped down to 30 days", parseCyclePeriod("90"), 30 * D);
eq("Cycle-Period garbage → null", parseCyclePeriod("soon"), null);
{
  const t = Date.parse("2026-10-05T00:00:00Z");
  const idx = { [OTHER]: { u: iso(t - 30 * D), r: iso(t - 10 * D) } };
  eq("a 14-day cycle: not due after 10 days", planReport(idx, new Set([OTHER]), t, { cycleMs: 14 * D }).due.length, 0);
  eq("a 14-day cycle: nextReportAt = last + 14 d", nextReportAt(idx, 14 * D), iso(t + 4 * D));
}

// ── C3: the cadence over a simulated year — every gap 7 days, never 8 or 14 ─────────────────
function simulateYear({ jitterMin, latencyMin, cycleMs = CYCLE_MS, seed = 7 }) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ID = OTHER;
  let status = {}; let index = {}; const reports = [];
  const t0 = Date.parse("2026-10-06T03:00:00Z");
  for (let day = 0; day < 366; day++) {
    const trig = t0 + day * D + (rnd() - 0.5) * 2 * jitterMin * 60000;
    if (status.runUntil && trig < status.runUntil) continue; // a sweep still waiting (re-queued hops)
    const { due, notBefore } = sweepSchedule(status, trig);
    if (!due) continue;
    const start = Math.max(trig, notBefore) + rnd() * latencyMin * 60000; // consumer re-queues until notBefore
    const plan = planReport(index, new Set([ID]), start, { cycleMs });
    if (plan.due.length) { reports.push(start); plan.index[ID].r = iso(start); }
    index = plan.index;
    const fin = start + 2 * 60000;
    status = { lastRunAt: iso(fin), lastAttemptAt: iso(fin), queuedAt: null, nextReportAt: nextReportAt(index, cycleMs), cycleMs, last: { accounts: { reporting: "done" } }, runUntil: fin };
  }
  return reports.slice(1).map((r, i) => r - reports[i]);
}
for (const [label, cfg] of [["±5 min jitter, 0–3 min queue latency (the review's repro)", { jitterMin: 5, latencyMin: 3 }], ["±60 min jitter, 0–10 min latency", { jitterMin: 60, latencyMin: 10, seed: 11 }], ["a 14-day Cycle-Period", { jitterMin: 5, latencyMin: 3, cycleMs: 14 * D, seed: 3 }]]) {
  const gaps = simulateYear(cfg);
  const cyc = cfg.cycleMs || CYCLE_MS;
  ok(`${label}: about a year of reports (${gaps.length + 1})`, gaps.length + 1 >= Math.floor(365 / (cyc / D)));
  ok(`${label}: never before a full cycle`, gaps.every((g) => g >= cyc));
  ok(`${label}: every gap rounds to the cycle (max ${(Math.max(...gaps) / D).toFixed(3)} d)`, gaps.every((g) => Math.round(g / D) === cyc / D));
}
{
  const t = Date.parse("2026-10-13T03:00:00Z");
  const s = sweepSchedule({ lastRunAt: iso(t - 7 * D + 1000), nextReportAt: iso(t + 4 * 60000) }, t);
  eq("a report due in 4 minutes is waited for (notBefore = due + margin)", [s.due, s.notBefore], [true, t + 4 * 60000 + DUE_MARGIN_MS]);
  eq("nothing due for days and a recent run → not due", sweepSchedule({ lastRunAt: iso(t - D), nextReportAt: iso(t + 5 * D) }, t).due, false);
}

// ── C2 / c / d: wiring in the worker ────────────────────────────────────────────────────────
{
  const worker = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/server/capsules/privacy/worker.js"), "utf8");
  const loop = worker.slice(worker.indexOf("for (const batch of batches(plan.due))"), worker.indexOf('summary.accounts.reporting = handOff ? "partial" : "done";'));
  ok("C2: the index is saved after EVERY report batch", /await writeIndex\(index, written\);/.test(loop));
  ok("C2: a time budget hands the rest to a continuation", /if \(overBudget\(\)\) \{ handOff = true; break; \}/.test(loop) && /if \(handOff\) await queueContinuation\("continue", null\);/.test(worker));
  ok("C2: a failed sweep still saves the index it has", /if \(index\) await writeIndex\(index, written\)\.catch/.test(worker));
  ok("C4: answers go through acceptAnswers(batch, …)", /acceptAnswers\(batch, res\.accounts\)/.test(worker));
  ok("c: updatedAt moves only for names actually fetched", /for \(const id of summary\.erasure\.renamed\) if \(index\[id\] && !index\[id\]\.c\) \{ const \{ n: _n, \.\.\.e \} = index\[id\]; index\[id\] = \{ \.\.\.e, u: erasedAt \}; \}/.test(worker) && !/plan\.index\[id\]\.u = reportedAt/.test(worker));
  ok("c: an owed name refresh (n) survives a failed lookup or a hand-off", /index\[id\] = \{ \.\.\.index\[id\], n: 1 \}/.test(worker) && /filter\(\(\[, e\]\) => e\?\.n && !e\.c\)/.test(worker));
  ok("a sweep that finds the lock taken re-queues itself", /r\.reason === "running"\) await pushSweep/.test(worker));
  ok("b: the app's own account is excluded", /kvs\.get\("app-account-id"\)/.test(worker) && /planReport\(prior, seen, nowMs, \{ cycleMs, exclude \}\)/.test(worker));
  ok("d: both scans back off on a KVS 429", (worker.match(/withBackoff\(\(\) => q\.getMany\(\)\)/g) || []).length === 2 && /responseDetails\?\.status === 429/.test(worker));
  ok("a: the reported Cycle-Period is followed and stored", /if \(res\.cycleMs\) cycleMs = res\.cycleMs;/.test(worker) && /nextReportAt: nra, cycleMs/.test(worker));
  ok("the sweep's own rows are never scanned for people", (worker.match(/if \(key\.startsWith\(OWN_PREFIX\)\) return;/g) || []).length === 2);
}

report("privacy-cycle");
