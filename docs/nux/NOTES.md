# Elzi's tours in Sentinel Vault: plan

Goal: the same guide CogniRunner ships (1.35.22 to 1.35.25), on Sentinel Vault's two admin consoles. Elzi says hello and
whose guide she is, a page tour shows the console, and every tab has a short mini-tour that teaches the idea behind it.
Marks are per person, and "Take the tour" / "Replay tour" opens a tour again.

## Where the tours live
| Console | Who sees it | Page tour | Mini-tours |
|---|---|---|---|
| Site settings (Confluence administration, Apps) | a site admin | `site` | settings, validations, classification, api, backup |
| Space page "Sentinel Vault" | a space admin (steward) or a member | `space` | my-claims (member); locked-attachments, permissions, unlock-timeouts, macro-settings, validations, workflow, activity (steward) |

Not covered on purpose: the page modal, the inline panel and the ribbon (they sit in a modal, a macro and a banner, where a
full-page dim layer is the wrong tool); My work. The consoles are where a first-time admin has to understand concepts.

## Concepts a first-time admin must understand (the cold reader grades each one)
1. A seal: what it is, who can still change the file, what happens when someone edits anyway (undone, their version stays in history).
2. Seal expiry: default 48 hours, reminders before release, expiry can be turned off.
3. Force release by a space admin: needs a typed reason, is recorded, only while the site allows it.
4. Who hears about it: pop-ups and ribbon always; comments that mention people are off by default; a space can go Quiet.
5. Space admins: people or groups; requests wait for approval; a member can ask (48 hour wait after a decline).
6. Content validations: advisory, gate, revert (revert can discard work); a space can switch a way on but never off.
7. AI review: runs on Atlassian's AI, off by default, a monthly allowance for the whole site.
8. Classification: off by default, levels with ranks, a default per space, lowering needs a reason.
9. REST access: one endpoint, tokens with a role (viewer, editor, admin), shown once, recent jobs as receipts.
10. Backup and restore: after each change and daily, restore previews first, automations come back paused, export/import.
11. Approval workflow: states, who approves and how many, signing with an authenticator code.
12. Activity log: what is recorded, filter, CSV export.
13. The panel macro: Sealed and Available lists, auto-insert, position.
14. Apply: settings on the site page only count after Apply.

## How it is built
- Engine ported from CogniRunner's `static/_shared/nux` into `src/ui/nux/` (Tour.jsx, tourSteps.js, marks.js, Elzi.jsx, elziPoses.js,
  TourReplay.jsx, tourStyles.js). Changes: Sentinel Vault words and test ids, buttons are the console's own `btn-primary` / `btn-secondary`,
  tokens are the app's `--sv-*`, invoke goes through `kit/bridge.js`, solid teal accent instead of CogniRunner's blue.
- Tours are data: `src/ui/nux/tours.js`. The one key list: `src/ui/nux/nux-tours.js` (the backend imports it too).
- Marks: KVS row `nux:<accountId>` (`src/server/shared/nux.js`), actions `get-nux-tours`, `set-nux-tour`, `reset-nux-tours` on the caller's own
  account only. The key names the account, so the personal-data worker deletes it when the account closes. Not backed up (a preference).
- The engine loads on demand (`React.lazy`), so the console entries do not grow.
- A mini-tour opens by itself only after the page tour was finished (not skipped), never straight after another tour.

## Gates (tests first)
- `test/nux-engine.test.mjs`: marks, the key list, wiring, the engine's pure rules, the owner's acceptance rules as pure functions.
- `test/nux-geometry.test.mjs`: every step of every tour in a real browser at 1440x900, 390x844, 1440x700, 310x700 and a long-content case,
  light and dark. Owner acceptance (2026-11-02): Elzi and the bubble inside the canvas, 16 px margin, never on the target, target on top at its
  centre, no clipping ancestor, text inside the bubble, buttons visible. Plus marks, replay, Esc, Tab trap, straight corners, no native dialogs.
- Then: a cold reader (fresh agent, bubbles and screens only), two design critics on screenshots at 1440 and 390 light and dark.
