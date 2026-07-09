# Iteration 19 — copy/microcopy review (reviewed + flagged, no code change)

Branch: `aql/workflow-state-engine`. **Angle: copy/microcopy.**

## Verdict: copy is generally STRONG
Read user-facing strings across doc-ribbon, WorkflowSettingsEditor, ValidationsEditor, WorkflowInbox, realm-console. The workflow settings descriptions are clear and jargon-light — e.g. the enforce-mode options spell out the consequence ("Move it back to Draft (keeps their edit)" / "Revert to the approved version (discards their edit)"), and "Require approval to reach Approved" explains the whole flow. No typos, broken sentences, or misleading labels found.

## The one genuine finding: realm ↔ space inconsistency
- **realm-console** (older chrome) uses **"realm" ×14**: title "Realm Preferences", tab "Realm Sealed Files", header subtitle "…access control for this realm", "enabled for all pages in this realm", "steward access to this realm", etc.
- **WorkflowSettingsEditor + ValidationsEditor** (newer, embedded in the SAME realm-console tabs) + invitations/empty-states use **"space" ×4**: "pages in this space", "space rules", "no sealed files in this space", "Ask a space admin".
- So on ONE screen (the Workflow tab) a user reads "Realm Preferences" (title) above "pages in this space" (settings).

### Key insight
The app has a cohesive THEMED vocabulary: Sentinel **Vault** → **Realm** (space) → **Steward** (admin) → **Guild** (group) → **Seal** (lock). steward/guild/seal are app-UNIQUE (Confluence has no such concepts) → consistent, distinctive, fine. But **"realm" maps 1:1 to Confluence's omnipresent "space"** — the one themed term that collides with a concept the user already sees in Confluence's own chrome — so it's uniquely confusing. ("guild" also collides with "Confluence group", but is used consistently + is explained inline, so lower priority.)

## Decision: FLAGGED, not changed
Which vocabulary to standardize on is a BRAND-vocabulary decision the owner should own:
- The cohesive theme suggests "realm" may be intentional.
- A 14-string rewrite of prominent chrome (incl. the console title) risks the "over-fixing" the loop explicitly warns against for copy.
- Confidence the DIRECTION should be "space" (Confluence-native, already the app's dominant term across newer code + space-admin references, naive-user-clearest) is HIGH; confidence I should make the brand call UNILATERALLY is LOW.

Per "bias HARD against churn", "copy nits are easy to over-fix", "defer risky work with an explicit flag", and "'no change — reviewed, solid' is VALID" → flag, don't force.

## OWNER DECISION NEEDED
Standardize the user-facing scope term on **"space"** (recommended) or keep the themed **"realm"**? If "space": ~14 realm-console strings become "space" (keep steward/guild/seal, keep "space admin" as the real Confluence role). Secondary: decide "guild" vs "group".

## Next
Rotate to the deferred UNAMBIGUOUS a11y leads (WorkflowInbox per-item `aria-label`, WorkflowDashboard `<th scope="col">`) — low-churn, high-confidence, no brand question.
