// Sentinel Vault run-cost tariff, 2026-10-26 (settled version). Deterministic: `node pricing-run-cost-2026-10-26.mjs`
// prints inputs, tariff, quotes and checks as JSON and exits 1 if any check fails. Owner order (Mihai 2026-10-26):
// price = run cost + Atlassian's revenue share and nothing more, 1-10 users free, multi-instance 1x, no cliffs,
// CogniRunner (0.10/user) is the reference. Model and evidence: pricing-run-cost-2026-10-26.md next to this file.

const FEE = 0.17; // Atlassian keeps 17 % of Forge app revenue from 2026-10-01 (pricing-payment-and-billing, read
// 2026-10-26). The 0 % first-$1M incentive is ignored on purpose: a lifetime cap per partner.
const list = (cost) => cost / (1 - FEE);

// Forge rates (forge-platform-pricing, read 2026-10-26). Free allowances (200k GB-s, 0.1 GB KVS read/write, 1 GB
// logs) are NOT credited: they are shared per app across every install, so a price must not lean on them.
const RATE = { gbs: 0.000025, kvsReadGB: 0.055, kvsWriteGB: 1.09, llmIn: 1e-6, llmOut: 5e-6 };

// TYPICAL fixed cost per install (MEASURED: leanzero-analytics state/apps/2026-10-26.json, Oct 1-26, 6 installs incl.
// dev): functionCompute 69,266 GB-s, kvsRead 3.067 GB, kvsWrite 0.0983 GB, logsWrite 0.0654 GB (inside the 1 GB free
// logs, $0). Scheduled sweeps (manifest.yml: page-guard every 5 min; expiry, seal-index, workflow hourly; nudge
// daily) are per install, not per user.
const DAYS = 26, INSTALLS = 6, M = 30 / DAYS / INSTALLS;
const TYPICAL = {
  gbs: 69266.22 * M, kvsReadGB: 3.06707 * M, kvsWriteGB: 0.098311 * M,
};
TYPICAL.cost = TYPICAL.gbs * RATE.gbs + TYPICAL.kvsReadGB * RATE.kvsReadGB + TYPICAL.kvsWriteGB * RATE.kvsWriteGB;

// CEILING fixed cost per install (DERIVED from code, every sweep running to its limit every time). Memory: Forge
// default 512 MB (manifest reference "The default value is 512 MB"; SV sets no memoryMB). page-guard-sweep-fn has no
// timeoutSeconds, so the platform default 25 s kills it before its 40 s PAGE_GUARD_BUDGET_MS (triggers.js:3018; the
// code itself says "the function runs on the default 25 s", triggers.js:3109). seal-index-cron: 100 s budget
// (manifest comment, timeout 300). expiry + workflow sweeps: default 25 s. Each page-guard run lists at most
// 2 prefixes x 20 pages x 100 seal records = 4,000 records (triggers.js collectGuardedPageIds), ASSUMED 1 KB each.
const MEM_GB = 0.5, RUNS_5MIN = 30 * 288, RUNS_HOUR = 30 * 24, RUNS_DAY = 30;
const CEIL = {
  gbs: MEM_GB * (RUNS_5MIN * 25 + RUNS_HOUR * 100 + RUNS_HOUR * 25 * 2 + RUNS_DAY * 25),
  kvsReadGB: RUNS_5MIN * 4000 * 1024 / 1e9,
  kvsWriteGB: TYPICAL.kvsWriteGB,
};
CEIL.cost = CEIL.gbs * RATE.gbs + CEIL.kvsReadGB * RATE.kvsReadGB + CEIL.kvsWriteGB * RATE.kvsWriteGB;

// AI review (the only paid resource that grows with use; Forge LLM billed to us, no allowance). OFF by default
// (validations/logic.js DEFAULT ai.enabled false; a site admin must switch it on). Claude Haiku 4.5, page text capped
// at 40,000 chars (~10k tokens), output up to 4,096 tokens (forge-llm.js). Budget: monthlyTokenBudget per SPACE (0 =
// unlimited, the default); a site value caps every space's budget (capAiConfig) but there is NO site-wide total, so
// spend is not bounded by default. STATED ASSUMPTION priced in: 1 review per user per month at 10k in + 1k out.
// Worst single review: 10k in + 4,096 out.
const AI_TYPICAL = 10000 * RATE.llmIn + 1000 * RATE.llmOut;      // $0.015
const AI_WORST = 10000 * RATE.llmIn + 4096 * RATE.llmOut;        // $0.0305
const AI_REVIEWS_PER_USER_MONTH = 1;
const VAR_PER_USER = AI_REVIEWS_PER_USER_MONTH * AI_TYPICAL;

// Editor rows (live editor 2026-10-26: Up to 10 flat Free, then 35 per-user rows 1-100 ... 240001-250000; the public
// REST shows the last one as Unlimited). Graduated: above 10, users 1-100 are all charged at the 1-100 rate.
const BOUNDS = [100, 250, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000,
  60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 190000,
  200000, 210000, 220000, 230000, 240000, 250000];
const rate = (upper) => (upper <= 100 ? 0.08 : 0.02);
// 0.08: 100 users pay $8.00, which covers the CEILING fixed cost at list ($7.26) inside the first band, so no band
//       above 100 has to carry fixed cost. (0.05 would cover it only from 214 users.)
// 0.02: list variable 0.0181 rounded UP to the cent (smallest step the editor takes).
export const TARIFF = BOUNDS.map((upTo) => ({ upTo, perUser: rate(upTo) }));

export function monthly(n) {
  if (n <= 10) return 0;
  let total = 0, lower = 0;
  for (const { upTo, perUser } of TARIFF) {
    total += Math.max(0, Math.min(n, upTo) - lower) * perUser;
    lower = upTo;
    if (n <= upTo) break;
  }
  if (n > lower) total += (n - lower) * TARIFF.at(-1).perUser;
  return Math.round(total * 100) / 100;
}
export const annual = (n) => Math.round(monthly(n) * 1000) / 100; // native AUTO 10x

const OLD = [[2500, 1.00], [10000, 0.50], [60000, 0.20], [Infinity, 0.10]]; // live editor + REST 2026-10-26
function oldMonthly(n) {
  if (n <= 10) return 0;
  let t = 0, lo = 0;
  for (const [up, r] of OLD) { t += Math.max(0, Math.min(n, up) - lo) * r; lo = up; if (n <= up) break; }
  return Math.round(t * 100) / 100;
}
const r2 = (x) => Math.round(x * 100) / 100;
const cost = {
  typical: (n) => list(TYPICAL.cost + VAR_PER_USER * n),          // measured fixed + assumed AI
  ceilingNoAi: (n) => list(CEIL.cost),                             // AI off (the default), every sweep at its limit
  ceilingAi: (n) => list(CEIL.cost + VAR_PER_USER * n),            // both at once
};

const SIZES = [11, 15, 50, 100, 250, 500, 655, 1000, 2500, 5000, 10000, 20000, 50000, 250000];
const quotes = SIZES.map((n) => ({
  users: n, oldMonthly: oldMonthly(n), oldAnnual: Math.round(oldMonthly(n) * 1000) / 100,
  newMonthly: monthly(n), newAnnual: annual(n),
  costTypical: r2(cost.typical(n)), costCeilingNoAi: r2(cost.ceilingNoAi(n)), costCeilingAi: r2(cost.ceilingAi(n)),
}));

const checks = [];
for (const b of [10, ...BOUNDS]) {
  checks.push({ check: `no cliff at ${b}`, ok: monthly(b + 1) >= monthly(b) && monthly(b) >= monthly(b - 1) });
}
checks.push({ check: "marginal rates non-increasing", ok: TARIFF.every((t, i) => i === 0 || t.perUser <= TARIFF[i - 1].perUser) });
checks.push({ check: "every rate >= editor minimum 0.01", ok: TARIFF.every((t) => t.perUser >= 0.01) });
for (const n of [15, 50, 100, 250, 1000, 2500, 10000, 50000, 250000]) {
  checks.push({ check: `covers typical cost (measured fixed + 1 AI review/user) at ${n}`, ok: monthly(n) + 1e-9 >= cost.typical(n) });
}
for (const n of [100, 250, 1000, 2500, 10000, 250000]) {
  checks.push({ check: `covers ceiling cost with AI off at ${n}`, ok: monthly(n) + 1e-9 >= cost.ceilingNoAi(n) });
}
for (const n of [655, 1000, 2500, 10000, 250000]) {
  checks.push({ check: `covers ceiling + AI at ${n}`, ok: monthly(n) + 1e-9 >= cost.ceilingAi(n) });
}
checks.push({ check: "per user at or below CogniRunner 0.10 at every size", ok: SIZES.every((n) => monthly(n) <= 0.10 * n + 1e-9) });

// Where coverage is NOT claimed (stated, not hidden): 11-~14 users (free-tier-like sites), ceiling with AI off
// below 91 users, ceiling + 1 AI review/user between 11 and 654 users (max shortfall $1.07/month at 101),
// and any site doing more than ~1.1 AI reviews per user a month (0.02 list covers 1.10 typical reviews).
const coverFrom = (f) => { for (let n = 11; n <= 300000; n++) { let ok = true; for (let m = n; m < n + 2000 && m <= 300000; m += 7) if (monthly(m) + 1e-9 < f(m)) { ok = false; break; } if (ok && monthly(n) + 1e-9 >= f(n)) return n; } return null; };
const out = {
  inputs: { FEE, RATE, TYPICAL, TYPICAL_LIST: list(TYPICAL.cost), CEIL, CEIL_LIST: list(CEIL.cost), MEM_GB,
    AI_TYPICAL, AI_WORST, AI_REVIEWS_PER_USER_MONTH, VAR_PER_USER, VAR_PER_USER_LIST: list(VAR_PER_USER),
    AI_REVIEWS_COVERED_PER_USER_BY_0_02: r2(0.02 * (1 - FEE) / AI_TYPICAL) },
  tariff: [{ upTo: 10, perUser: 0, note: "free (Enable free)" }, ...TARIFF], multiInstance: "1x (multi = single)",
  coveredFrom: { typical: coverFrom(cost.typical), ceilingNoAi: coverFrom(cost.ceilingNoAi), ceilingAi: coverFrom(cost.ceilingAi) },
  quotes, checks, allOk: checks.every((c) => c.ok),
};
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allOk ? 0 : 1);
}
