# Sentinel Vault run-cost tariff, 2026-10-26

Owner order (Mihai, 2026-10-26, after a deal was lost on price): price Sentinel Vault at run cost plus Atlassian's
17 % share and nothing more. CogniRunner (0.10/user) is the reference. 1-10 users stay free, multi-instance = 1x,
no price cliff at any band boundary. No staff, development, profit or buffer lines; the only margin is rounding up
to the cent.

Calculator: `pricing-run-cost-2026-10-26.mjs` (deterministic; `node pricing-run-cost-2026-10-26.mjs` prints inputs,
tariff, quotes and checks as JSON and exits 1 if a check fails). This version settles the draft of the same day
(0.05 / 0.02) after an adversarial review.

## Tariff (USD per user per month, graduated; multi-instance = single; annual = the editor's automatic 10x)

| Users | Old | New |
|---|---|---|
| 1-10 | free | free |
| 1-100 (all users, once above 10) | 1.00 | 0.08 |
| 101-2,500 | 1.00 | 0.02 |
| 2,501-10,000 | 0.50 | 0.02 |
| 10,001-60,000 | 0.20 | 0.02 |
| 60,001 and up | 0.10 | 0.02 |

## Cost inputs

| Input | Value | Source |
|---|---|---|
| Atlassian revenue share | 17 % | pricing-payment-and-billing, read 2026-10-26 (0 % first-$1M incentive ignored) |
| Forge rates | $0.000025/GB-s, KVS read $0.055/GB, write $1.09/GB, Haiku 4.5 $1/M in, $5/M out | forge-platform-pricing, read 2026-10-26 |
| Free allowances | not credited | shared per app across installs |
| Typical fixed per install | $0.386/month, $0.465 at list (13,320 GB-s, 0.59 GB KVS read, 0.019 GB KVS write; logs inside the free 1 GB) | MEASURED, Developer Console snapshot (leanzero-analytics state/apps/2026-10-26.json), Oct 1-26, 6 installs |
| Ceiling fixed per install | $6.03/month, $7.26 at list | DERIVED from code, below |
| AI review | $0.015 typical (10k in + 1k out), $0.0305 worst (4,096 out) | rates live, tokens from code caps |
| AI reviews per user per month | 1 | STATED ASSUMPTION (today: 29k tokens in a month across all installs) |

### The ceiling (review defect 5)

Every scheduled sweep running to its limit on every run. Memory is the Forge default 512 MB (SV sets no memoryMB).
The five-minute page-guard sweep has a 40 s budget (triggers.js PAGE_GUARD_BUDGET_MS) but no timeoutSeconds, so the
platform's default 25 s ends it first (the code says so itself). seal-index runs up to its 100 s budget hourly;
expiry and workflow sweeps up to 25 s hourly; the nudge up to 25 s daily. That is 162,375 GB-s = $4.06. Each
page-guard run lists at most 4,000 seal records (2 prefixes x 20 pages x 100); at an assumed 1 KB each that is
35.4 GB of KVS reads a month = $1.95. The earlier review estimate (~$5 compute) used the 40 s budget; the real cap
is 25 s.

### AI review cost (review defect 7)

AI review is OFF by default and only a site admin can switch it on (validations/logic.js). It runs per page on a
steward's request or a workflow transition, on Claude Haiku 4.5, page text capped at 40,000 characters (about 10k
tokens), output capped at 4,096 tokens. A per-space monthly token budget exists (default 0 = unlimited) and a
site-level value caps every space's budget (capAiConfig), but there is no site-wide total, so AI spend has no cap
by default. The tariff therefore prices a stated assumption: one review per user per month. The 0.02 rate covers
1.1 typical reviews (or 0.54 worst-case reviews) per user per month. A site that reviews more uses more than it
pays; the per-space budget is the control an admin has. No app code was changed for this.

## Why these two rates

0.08 for 1-100: 100 users pay $8.00, which covers the ceiling fixed cost at list ($7.26) inside the first band, so no
higher band carries fixed cost. At the draft's 0.05 the ceiling was covered only from 214 users.

0.02 above 100: the list variable cost of one AI review per user, $0.0181, rounded up to the cent. It is kept to the
top band: at 0.01 a large site would not cover one review per user a month.

## Quotes (USD)

| Users | Old monthly | Old annual | New monthly | New annual | Cost typical | Cost ceiling, AI off | Cost ceiling + AI |
|---|---|---|---|---|---|---|---|
| 11 | 11 | 110 | 0.88 | 8.80 | 0.66 | 7.26 | 7.46 |
| 50 | 50 | 500 | 4 | 40 | 1.37 | 7.26 | 8.16 |
| 100 | 100 | 1,000 | 8 | 80 | 2.27 | 7.26 | 9.07 |
| 250 | 250 | 2,500 | 11 | 110 | 4.98 | 7.26 | 11.78 |
| 1,000 | 1,000 | 10,000 | 26 | 260 | 18.54 | 7.26 | 25.33 |
| 2,500 | 2,500 | 25,000 | 56 | 560 | 45.65 | 7.26 | 52.44 |
| 10,000 | 6,250 | 62,500 | 206 | 2,060 | 181.19 | 7.26 | 187.98 |
| 50,000 | 14,250 | 142,500 | 1,006 | 10,060 | 904.08 | 7.26 | 910.88 |

Costs are at list (cost / 0.83).

## Checks (all pass)

No drop in total at 10 to 11 or at any of the 35 band edges; marginal rates never rise; every rate is at least the
editor minimum 0.01; at or below CogniRunner's 0.10 per user at every size; typical cost covered from 11 users;
ceiling cost with AI off covered from 91 users; ceiling plus one AI review per user covered from 655 users.

## Where coverage is not claimed

Ceiling with AI off below 91 users; ceiling plus AI between 11 and 654 users (largest shortfall $1.07/month at 101);
any site above about 1.1 AI reviews per user per month. The ceiling needs thousands of live seals and busy sweeps,
which today's installs are far from. Reconcile after a full billing month with paid installs.

## Marketplace

Saved in the vendor editor 2026-10-26 08:48 UTC (36 rows: Up to 10 flat Free with Enable free on, then 35 per-user
rows 1-100 ... 240001-250000, single = multi on every row). Reloaded and read back: all 70 inputs as above, the read
view totals match this calculator (100 users $8, 250 $11, 1,000 $26, 2,500 $56, 10,000 $206). The editor says
pricing changes take effect after 24 hours, so the new tariff is due about 2026-10-27 08:48 UTC; the anonymous
`/rest/2/addons/com.leanzero.confluence.sentinelvault/pricing/cloud/live` still showed the old tariff
(lastModified 2026-10-13) right after the save. Existing customers move to the lower price at renewal.

Open owner decision: the Solution Partner discount is still ON. A reseller discount on a cost-only price sells below
run cost; it was left as it was (the toggle did not take through automation and it is outside the price order).
