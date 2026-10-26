# Sentinel Vault tariff r2 (threshold rule), 2026-10-26

Owner rule (Mihai, 2026-10-26): never lose money at large user counts; keep small sites accessible (they may be
subsidised, capped and stated). 1-10 users free, multi-instance = 1x, annual = the editor's automatic 10x, which
must also not lose above the threshold. Supersedes the same-day r1 tariff (pricing-run-cost-2026-10-26.md, kept
as history).

Calculator: `pricing-run-cost-2026-10-26-r2.mjs` (commit b9c3cd5). Exit 0 = every check passes. Dense sweep from
the threshold to 250,000 users, every band boundary +-1, monthly and annual, marginal price >= worst cost per row
above the threshold, no cliff, non-increasing rows (the editor refuses a row priced higher than the row before).

## Tariff (USD per user per month)

1-10 users free. 1-100 0.10, 101-250 0.10, every row above 250 (34 rows, up to 250,000) 0.06.
Threshold 250 users; the price covers worst cost from 243 users.

## Inputs (worst case; measured vs assumed)

Net revenue factor 0.664 (17 % Atlassian share x Solution Partner discount ON, worst 20 %). Fixed cost = the
$6.03 per install ceiling (raw; every sweep at the limit). AI runs on Forge LLM and is VENDOR-billed
(forge-llm.js: "Token costs bill to the app vendor's Forge bill"; manifest modules.llm). Today it is unbounded:
monthlyTokenBudget per space defaults to 0 = unlimited and there is no site total (validations/logic.js:31,
capAiConfig :145).

REQUIRED CODE GUARD (not yet shipped): a default site-wide monthly AI allowance of N x licensed users x $0.0305,
metered on LLM-reported tokens, N = 1 worst-case review (10k tokens in + 4,096 out), about 2 typical reviews.
At 0.06 on annual billing that covers 1.09 worst or 2.21 typical reviews per user per month. Without the guard the
never-lose claim does not hold for AI-heavy sites.

Subsidy at most $6.33 per site per month (a free 1-10 site); 11 users $5.63.

## Saved

Saved in the Marketplace editor 2026-10-26T11:06:28Z (app 1034857304). Read back after reload: 70 inputs as above,
Enable free on, Solution Partner discount on (unchanged). Editor totals: 100 users $10, 250 $25, 1,000 $70,
2,500 $160 (annual $1,600), 100,000 $6,010, 250,000 $15,010. Takes effect about 24 h later, ~2026-10-27T11:07Z.
Existing customers get Atlassian's 60-day price override. Licences: 2 commercial (ours, 9 and 3 users), 2 free,
1 external evaluation (enhanceit.atlassian.net); nobody large.
