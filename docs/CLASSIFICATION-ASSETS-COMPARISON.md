# Data classification storage: JSM Assets vs app storage (design note, 2026-09-14)

Decision requested: whether Sentinel Vault's classification levels should (A) link to an
existing Jira Service Management Assets object schema/type, or (B) stay app-owned (KVS +
content/space properties), given that native Confluence classification is the primary source of
truth wherever the site has levels defined.

## Facts that frame the choice

- **Native first is settled.** `GET /wiki/api/v2/classification-levels` is the switch: when it
  returns levels, Sentinel Vault reads and writes the page/space level through the v2 endpoints
  and owns nothing. Level *definitions* are Atlassian Guard, org-admin only; Forge cannot create
  them. Both LeanZero test sites return `[]` today and the page endpoint answers
  `404 "Feature is disabled"`, so the fallback provider is what runs there.
- **The fallback only has to cover the "no native levels" case.** Its whole job is: a small,
  ranked list of levels (name, colour, rank), a per-space default, a per-page override, and a
  CQL-searchable footprint. That is a few KB of configuration and one property per space/page.
- **Assets is a JSM Premium/Enterprise feature.** It is reachable on both test sites
  (`/rest/servicedeskapi/assets/workspace` answers 200) but a Confluence-only customer, or a JSM
  Standard customer, has no Assets at all. Sentinel Vault is a Confluence app; its Marketplace
  audience is not gated on JSM.
- **Assets is a separate product boundary in Forge.** Reading an object schema needs the
  `read:cmdb-object:jira` / `read:cmdb-schema:jira` scopes and `requestJira` against the
  `/jsm/assets/workspace/{id}/v1/...` routes — a Jira scope set on a Confluence app, which the
  reviewer will ask about, and another major-version re-consent for every install.

## (A) Link to a JSM Assets object schema/type

What it gives: a level list that a customer may already maintain in Assets (an "Information
classification" object type with attributes for colour and rank), shared with their JSM
processes, and the Assets UI for editing it. Sentinel Vault would read the object type on a
schedule, cache the levels in KVS, and still store the space default / page override itself
(Assets has no concept of "this Confluence page's level").

What it costs: a JSM dependency in a Confluence app; Jira scopes on the manifest (major bump,
re-consent, security review questions about why a content-protection app reads a CMDB); a
mapping UI (which schema, which object type, which attributes mean colour and rank); a sync
job and a staleness story; and two failure modes the product does not have today (Assets
unreachable, Assets licence lapsed). None of the storage that actually matters (space default,
page override) moves to Assets, so the "bulk set on spaces" need is not served by A at all —
it is served by the admin tab in either option.

## (B) App-owned (current direction)

What it gives: levels in KVS (`classification-levels`), the space default in a space property
and the page override in a content property (both CQL-visible), no new product dependency, no
new scopes beyond the native endpoints' own (`read:configuration:confluence`,
`write:space:confluence`), and a straight migration path: when a customer later enables native
classification, the provider flips to Native and the app-owned levels become read-only history.

What it costs: the customer maintains a second list of levels if they also have one in Assets.
That list is three to five rows.

## Recommendation

**B. Do not add the Assets dependency.** Native classification already covers the shared,
org-wide definition of levels and the bulk-per-space assignment for any customer who has Guard.
For the customers who do not, A would import a CMDB to hold three to five rows while leaving
the actual per-page and per-space storage inside the app anyway. The value A adds (one list
instead of two, for JSM Premium customers without Guard) does not justify a second product
boundary, Jira scopes on a Confluence app, and a sync/staleness surface in a security product.

Revisit only if a paying customer asks for Assets-sourced levels; the `ClassificationProvider`
interface leaves room for an `AssetsProvider` behind the same six methods without touching the UI.
