// Sentinel Vault tariff r2, 2026-10-26 (threshold rule). `node pricing-run-cost-2026-10-26-r2.mjs` prints JSON and exits 1
// if any check fails. Supersedes r1 (pricing-run-cost-2026-10-26.mjs, saved 08:48Z). Model: the r2 .md next to this.

// Shared threshold-rule tariff solver and checks (r2, 2026-10-26). Pure, deterministic.
// Owner rule (Mihai 2026-10-26): "I don't want to lose money... especially at higher user counts where it could
// bankrupt me. But make sure it is accessible at lower user counts cause I can take a hit at lower numbers but at
// bigger it can destroy us." So: below THRESHOLD a site may cost more than it pays (capped, stated subsidy); from
// THRESHOLD to the top row it must never lose money, monthly AND annual (annual = editor AUTO 10x for 12 months).
const cents = (x) => Math.ceil(Math.round(x * 1e6) / 1e4) / 100;
const r2 = (x) => Math.round(x * 100) / 100;

function graduated(n, rows) { // rows: [[upTo, rate]], last upTo = Infinity
  if (n <= 10) return 0;
  let t = 0, lo = 0;
  for (const [up, r] of rows) { t += Math.max(0, Math.min(n, up) - lo) * r; lo = up; if (n <= up) break; }
  return Math.round(t * 100) / 100;
}

// m: { net (fraction of list price LeanZero keeps), fixed (raw $/install/month), perUser (raw worst $/user/month) }
// Annual customer pays 10 x monthly for 12 months of cost.
// EDITOR RULE (verified live 2026-10-26 on app 3330055937): a row's per-user rate may not be higher than the row
// before it. Filling 1-100 0.10 then 101-250 0.26 (or 0.42) marks 101-250 aria-invalid and disables "Save cloud
// pricing"; 0.26 then 0.10 is accepted. So a cheap small band can only be followed by rates at or below it, and
// every row's rate is at least the top rate: no tariff shape can be cheaper at 11-100 than the never-lose top rate.
function solve({ bounds, small, threshold, m }) {
  const top = cents((m.perUser * 12 / 10) / m.net);                // annual binds: rate*net*10/12 >= perUser
  const okAt = (rows, n) => graduated(n, rows) * m.net * 10 >= 12 * (m.fixed + m.perUser * n);
  if (small >= top) { // feasible: small band at the cap, 101..threshold solved, then top; all non-increasing
    const rowsFor = (mid) => bounds.map((up) => [up, up <= 100 ? small : up <= threshold ? mid : top]);
    let mid = top;
    while (!okAt(rowsFor(mid), threshold) && mid < small) mid = r2(mid + 0.01);
    if (okAt(rowsFor(mid), threshold)) return { mode: "small-cap", top, mid, rows: rowsFor(mid), smallCapMet: true };
  }
  // infeasible under the editor rule: one flat rate on every row, the lowest cent that is whole from the threshold.
  let flat = top;
  const flatRows = (f) => bounds.map((up) => [up, f]);
  while (!okAt(flatRows(flat), threshold)) flat = r2(flat + 0.01);
  return { mode: "flat", top: flat, mid: flat, rows: flatRows(flat), smallCapMet: false, minTopRate: top };
}

function check({ rows, threshold, m, maxUsers, show }) {
  const R = rows.map(([up, r], i) => [i === rows.length - 1 ? Infinity : up, r]);
  const monthly = (n) => graduated(n, R), annual = (n) => Math.round(monthly(n) * 1000) / 100;
  const cost = (n) => m.fixed + m.perUser * n;                      // raw $/month
  const lossM = (n) => cost(n) - monthly(n) * m.net;                // >0 = LeanZero loses, monthly billing
  const lossA = (n) => cost(n) - annual(n) * m.net / 12;            // per month, annual billing
  const checks = [];
  // 1. marginal rate of every row at/above the threshold covers worst per-user cost, monthly and annual
  let lo = 0;
  for (const [up, r] of rows) {
    if (lo + 1 > threshold) {
      checks.push({ check: `row ${lo + 1}-${up} ${r}: marginal >= worst cost (monthly)`, ok: r * m.net + 1e-12 >= m.perUser });
      checks.push({ check: `row ${lo + 1}-${up} ${r}: marginal >= worst cost (annual 10/12)`, ok: r * m.net * 10 / 12 + 1e-12 >= m.perUser });
    }
    lo = up;
  }
  // 2. cumulative: every integer user count threshold..maxUsers (dense sweep, includes every band boundary +-1)
  let worstM = Infinity, worstA = Infinity, firstFail = null;
  for (let n = threshold; n <= maxUsers; n++) {
    const a = -lossM(n), b = -lossA(n);
    worstM = Math.min(worstM, a); worstA = Math.min(worstA, b);
    if ((a < -1e-9 || b < -1e-9) && firstFail === null) firstFail = n;
  }
  checks.push({ check: `dense sweep ${threshold}..${maxUsers}: monthly and annual revenue >= worst cost at every n`, ok: firstFail === null, firstFail,
    minMarginMonthly: r2(worstM), minMarginAnnualPerMonth: r2(worstA) });
  const edges = [threshold, ...rows.map(([up]) => up).filter((u) => u >= threshold)];
  for (const b of edges) for (const n of [b - 1, b, b + 1].filter((x) => x >= threshold && x <= maxUsers))
    checks.push({ check: `boundary ${n}: covered monthly and annual`, ok: lossM(n) <= 1e-9 && lossA(n) <= 1e-9 });
  // 3. no cliff anywhere (total never falls as users rise)
  let cliff = null; for (let n = 10; n < maxUsers; n++) if (monthly(n + 1) < monthly(n)) { cliff = n; break; }
  checks.push({ check: "no cliff 10..max (monthly total non-decreasing)", ok: cliff === null, cliff });
  checks.push({ check: "rates non-increasing row to row (editor rule, verified live 2026-10-26)", ok: rows.every(([, r], i) => i === 0 || r <= rows[i - 1][1]) });
  let coveredFrom = null; for (let n = 11; n <= maxUsers; n++) if (lossM(n) <= 1e-9 && lossA(n) <= 1e-9) { if (coveredFrom === null) coveredFrom = n; } else coveredFrom = null;
  checks.push({ check: "covered (monthly+annual) at every n from coveredFrom to max", ok: coveredFrom !== null && coveredFrom <= threshold, coveredFrom });
  checks.push({ check: "every rate >= editor minimum 0.01", ok: rows.every(([, r]) => r >= 0.01) });
  checks.push({ check: "1-10 free", ok: monthly(10) === 0 && annual(10) === 0 });
  // 4. subsidy below the threshold (stated, capped)
  let sub = { monthly: 0, monthlyAt: null, annual: 0, annualAt: null };
  for (let n = 1; n < threshold; n++) {
    if (lossM(n) > sub.monthly) sub = { ...sub, monthly: lossM(n), monthlyAt: n };
    if (lossA(n) > sub.annual) sub = { ...sub, annual: lossA(n), annualAt: n };
  }
  sub = { monthly: r2(sub.monthly), monthlyAt: sub.monthlyAt, annualPerMonth: r2(sub.annual), annualAt: sub.annualAt };
  const table = show.map((n) => ({ users: n, monthly: monthly(n), annual: annual(n), costMonth: r2(cost(n)),
    costYear: r2(12 * cost(n)), netMonthly: r2(monthly(n) * m.net), netAnnual: r2(annual(n) * m.net),
    marginMonthly: r2(-lossM(n)), marginAnnualYear: r2(-12 * lossA(n)) }));
  return { checks, allOk: checks.every((c) => c.ok), subsidyBelowThreshold: sub, table, monthly, annual };
}

// ======================= Sentinel Vault inputs (r2) ===============================================================
const FEE = 0.17;              // Atlassian share of Forge revenue from 2026-10-01 (re-read 2026-10-26).
const PARTNER_DISCOUNT = 0.20; // SV listing has the Solution Partner discount ON (editor readback 2026-10-26; owner: leave
                               // it). Rate not public (Partner Portal); vendors report "up to 20 %". Worst case: every
                               // licence sold through a partner at 20 % off.
const NET = (1 - FEE) * (1 - PARTNER_DISCOUNT);
// Fixed per install: the CEILING from r1 (DERIVED from code, every sweep at its limit every run; MEASURED typical is
// far lower): page-guard every 5 min x 25 s, seal-index hourly x 100 s, expiry + workflow hourly x 25 s, nudge daily,
// 0.5 GB; KVS reads 4,000 x 1 KB per page-guard run (ASSUMED 1 KB). = $6.03/month raw.
const RATE = { gbs: 0.000025, kvsReadGB: 0.055, kvsWriteGB: 1.09, llmIn: 1e-6, llmOut: 5e-6 };
const KVS_WRITE_GB = 0.098311 * 30 / 26 / 6;    // MEASURED typical (Oct 1-26, 6 installs)
const CEIL_GBS = 0.5 * (30 * 288 * 25 + 30 * 24 * 100 + 30 * 24 * 25 * 2 + 30 * 25);
const CEIL_KVS_READ_GB = 30 * 288 * 4000 * 1024 / 1e9;
const FIXED = CEIL_GBS * RATE.gbs + CEIL_KVS_READ_GB * RATE.kvsReadGB + KVS_WRITE_GB * RATE.kvsWriteGB;
// AI review: Forge LLM (manifest modules.llm, @forge/llm; src/server/infra/forge-llm.js: "Token costs bill to the app
// vendor's Forge bill"), so LEANZERO pays. Haiku 4.5 only ($1/M in, $5/M out). One review WORST = 40,000 chars
// (ai.maxChars, ~10k tokens) in + max_completion_tokens 4,096 out = $0.0305. Typical (1k out) = $0.015.
// Spend is UNBOUNDED today: monthlyTokenBudget per space defaults to 0 = unlimited and there is no site-wide total
// (validations/logic.js:31, capAiConfig). Price cannot fix that alone. REQUIRED CODE GUARD (not in code yet): a default
// site-wide monthly AI allowance = N_REVIEWS x licensed users x $0.0305 of Forge LLM spend (metered on the tokens the
// LLM reports, so non-Latin text that tokenises denser still stops at the dollar cap). The price covers exactly N.
const AI_WORST = 10000 * RATE.llmIn + 4096 * RATE.llmOut;
const AI_TYPICAL = 10000 * RATE.llmIn + 1000 * RATE.llmOut;
const N_REVIEWS = 1;           // worst-case reviews per licensed user per month (= ~2 typical reviews)
const M = { net: NET, fixed: FIXED, perUser: N_REVIEWS * AI_WORST };

// Editor rows (live editor 2026-10-26, app 1034857304): Upto 10 flat Free + 35 per-user rows to 250000.
const BOUNDS = [100, 250, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000,
  60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 190000,
  200000, 210000, 220000, 230000, 240000, 250000];
const SMALL = 0.10;            // 11-100 at CogniRunner's 0.10; 101-250 solved (comes out 0.10 too).
const THRESHOLD = 250;
const sol = solve({ bounds: BOUNDS, small: SMALL, threshold: THRESHOLD, m: M });
export const TARIFF = sol.rows.map(([upTo, perUser]) => ({ upTo, perUser }));
const SHOW = [11, 50, 100, 250, 500, 1000, 2500, 5000, 20000, 100000, 250000];
const res = check({ rows: sol.rows, threshold: THRESHOLD, m: M, maxUsers: 250000, show: SHOW });
export const monthly = res.monthly, annual = res.annual;
// Without the guard: reviews per user per month the top rate pays for (annual billing, worst / typical review).
const topCovers = (per) => r2(sol.top * NET * 10 / 12 / per);
const r1 = (n) => graduated(n, [[100, 0.08], [Infinity, 0.02]]);
const out = {
  rule: "below 250 subsidised (capped, stated); 250..250000 never loses money, monthly and annual, WITH the AI guard",
  inputs: { FEE, PARTNER_DISCOUNT, NET, FIXED_PER_INSTALL_RAW: FIXED, AI_WORST, AI_TYPICAL, N_REVIEWS,
    WORST_PER_USER_RAW: M.perUser, topRateCoversWorstReviews: topCovers(AI_WORST), topRateCoversTypicalReviews: topCovers(AI_TYPICAL),
    guardSiteAllowanceUsdPerLicensedUserMonth: M.perUser },
  tariff: [{ upTo: 10, perUser: 0, note: "Upto 10 flat, Free (Enable free on)" }, ...TARIFF], multiInstance: "1x",
  annual: "editor AUTO 10x (customer pays 10 months for 12 months of cost)",
  threshold: THRESHOLD, mode: sol.mode, smallCapMet: sol.smallCapMet, topRate: sol.top, midRate101to250: sol.mid,
  subsidyBelowThreshold: res.subsidyBelowThreshold,
  table: res.table.map((t) => ({ ...t, r1Monthly: r1(t.users) })),
  checks: res.checks.filter((c) => !c.ok || /dense|cliff|1-10|minimum|covered|non-inc/.test(c.check)),
  checkCount: res.checks.length, allOk: res.allOk,
};
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.allOk ? 0 : 1);
}
