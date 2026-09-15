# Draft: Forge developer support case — product event delivery latency (2026-09-15)

Status: DRAFT for the owner to file at https://developer.atlassian.com/support (DEVHELP). Not sent.

Title: Confluence product events delivered to Forge trigger ~10 minutes late on wolfaenpak.atlassian.net

App: Sentinel Vault, app id ari:cloud:ecosystem::app/c30bf71e-4287-4872-954d-db49cc68f0ff
Environment: development 17516615-12ef-4790-8ce2-29151b7ee9ac (also observed on the fresh staging install 66f18786-…)
Site: wolfaenpak.atlassian.net (Confluence), installation 09797ffe-faf7-4dc7-a2a1-cecc99ea5e1f

What we see: the `trigger` module subscribed to `avi:confluence:created:page` and `avi:confluence:updated:page`
(function page-content-trigger) is invoked roughly 9–10 minutes after the event, since about 09:15 UTC today.
Attachment events (`avi:confluence:updated:attachment` etc., function artifact-trigger) arrive within a minute
on the same site and install. Before 09:15 UTC page events arrived within seconds (our live suite relies on it).

Evidence (UTC, from `forge logs -e development` with an instrumented first-line log in the handler):
- updated:page for page 265912321 v47: PUT at 10:41:14, invocation at 10:50:29 (9m15s)
- created:page 335773872: created 10:47:13, invocation 10:57:07 (9m54s)
- created:page 336330819: created 10:47:13, invocation 10:57:18 (10m05s)
Invocation ids: 37835572-aa8a-4500-bb5f-1f33642c86a9, 3a34c268-dffd-47ac-b14a-7816afe101f9, 4d0f3bb7-0f4d-448c-8b72-bb858bef814f.
Deploys today: several to development (last 10:46 UTC), two majors (new confluence:contentBylineItem and
confluence:contentAction modules + scopes); installs upgraded and reported Up-to-date.

Question: is there a per-app or per-site throttle/backlog on product events we are hitting (we ran a large
live test suite today, several hundred page create/update events), or a platform incident? What is the
expected delivery latency SLO for product events, and is anything on our side able to reduce it?
