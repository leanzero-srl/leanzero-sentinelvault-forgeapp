# HANDOFF: Sentinel Vault Elzi NUX lane (written 2026-11-03 03:00, at 350k context)

Worktree: ~/Projects/leanzero-sentinelvault-forgeapp/.claude/worktrees/nux-elzi (branch nux-elzi, from origin/main f7f7924, NOT pushed, NOT merged).
Brief: ~/Projects/machine-sync/docs/nux-campaign/BRIEF-COMMON.md (+ both ADDENDA: owner geometry gate; LOW priority, one browser, nice -n 15 taskpolicy -b).
VIGIL: ~/Projects/machine-sync/docs/nux-campaign/sv/VIGIL.md (one line per <=15 min; write OVERRULED: lines for any block).
Plan and concept list: docs/nux/NOTES.md. Bubble text for the cold reader: docs/nux/BUBBLES-FOR-COLD-READER.md.

## Done (all committed except the last CSS edit, see below)
- Engine port: src/ui/nux/{Tour.jsx,tourSteps.js,marks.js,Elzi.jsx,elziPoses.js,TourReplay.jsx,tourStyles.js,nux-tours.js,tours.js,ConsoleTours.jsx,TourButton.jsx}.
  Changed from CogniRunner: SV words/test ids (data-testid nux-*), btn-primary/btn-secondary, --sv-* tokens, teal accent, invoke via kit/bridge.js,
  EDGE=16 (owner), LZM aee08928 fix ported (run numbers, always-rendered hidden bubble as height probe, scroll BEFORE first draw, target box held still).
- Backend: src/server/shared/nux.js (row `nux:<accountId>`), src/server/capsules/nux/actions.js (get-nux-tours, set-nux-tour, reset-nux-tours), registered in registry.js, classified in backup/hook.js READ_ACTIONS.
  NOT yet done: nothing calls reset-nux-tours from a UI (no "Show all tours again" control); add one (a small Reset in the site console, own dialog via kit/Dialog, call clearNuxShownHere + forgetAutoShown + forgetMarks) or drop the action.
- Wiring: steward-console (site) and realm-console (space): lazy PageTour + TabTour, TourButton in headers, data-nux anchors (grp-*, api-*, bk-*, val-*, wf-*, cls-status, act-head, sealed-head, sealed-toolbar, admins-card, request-admin, site-head, space-head), rc-tab-* test ids on realm tabs.
- Mock bridge (scripts/responsive/bridge-mock.js): get/set/reset-nux-tours via window.__NUX__ (no value = "all seen", so other suites are unaffected); webpack.responsive.cjs takes SV_SHOT_OUT / SV_SHOT_ONLY.
- Tests: test/nux-engine.test.mjs 49/49 green. test/nux-geometry.test.mjs (+ nux-geometry-lib.mjs, nux-geometry-rules.mjs): every step, 1440x900, 390x844, 1440x700, 310x700, long-content, light+dark, plus marks/replay/Esc/Tab/corners and "no movement after first draw".
  Probes PASS: site 1440x900 light 16 steps; space-steward 1440x900 light 19 steps (26/26).
- Bubble copy linted: ai_phrasing_lint 4.7 -> 1.1 per 1k words.
- Env vars: SV_NUX_ONLY="<console> <view> <theme>" (one scenario), SV_NUX_JOBS, SV_NUX_NOBUILD=1, SV_NUX_TRACE=1, SV_NUX_LINES=1, SV_NUX_SHOTS=<dir> (screenshot every step).
  Build the two bundles: SV_SHOT_OUT=static/_screenshot-harness/shots-nux SV_SHOT_ONLY=steward-console,realm-console npx webpack --config scripts/responsive/webpack.responsive.cjs --mode production

## FIRST FULL MATRIX (363/480; ran on the build BEFORE the CSS fix below)
Failures were: (1) 390 and 310: bubble text overflows its box + a button outside the bubble (console btn padding 12x32);
(2) 310x700: "ring-to-target gap -155" (a target wider than the 310 frame; ring is clamped, check the narrower-anchor fallback) ;
(3) space-steward long-1440x700: tab-locked-attachments/force and tab-unlock-timeouts/end "moved 1 time after first draw" (a late layout change after the 2400 px pad; find what moves: probably a fixed bar or font, then fix, do not loosen the gate).
UNCOMMITTED at hand-off time: src/ui/nux/tourStyles.js compact bubble buttons (padding 7px 14px, nowrap) = the fix for (1). Commit it, rebuild, rerun 390 and 310 first (SV_NUX_ONLY="390x844"), then the rest.

## Still to do, in order
1. Fix (1)(2)(3), rerun the FULL matrix once on the final build (cause: owner gate; cheaper path = the SV_NUX_ONLY probes; ~1.5 h one browser; vigil every 15 min).
2. LOOK at screenshots (SV_NUX_SHOTS=<dir>, not only pass counts). Known to check: the hello bubble sits over the header title ("What's new" link) at 1440; consider placing it lower.
3. Reset control (see above) + a11y check; `npm test` full once (needs Playwright at ~/Projects/forge-live-harness; responsive-dom builds into shots-responsive, nux into shots-nux, no clash); `node scripts/gen-action-names.mjs`; `npm run lint`.
4. Cold reader: FRESH agent, give ONLY docs/nux/BUBBLES-FOR-COLD-READER.md + screenshots; grade the 14 concepts in NOTES.md UNDERSTOOD/PARTLY/LOST; ship with 0 LOST.
5. Critics: design-critic-grid + design-critic-owner-rules on fresh screenshots at 1440 and 390, light and dark (they must look for clipping, overlap, off-canvas bubbles).
6. Release (tracker-first, hard rules in the sentinel-vault skill): add a KNOWN entry in scripts/public-tracker/entries.mjs (`plan`, then `apply`), release note (docs/RELEASE-NOTES.md + src/server/shared/release-notes.js, version x.y.0 = next minor after 8.23.0, i.e. 8.24.0 unless Forge says otherwise), independent reviewer on tracker + note text BEFORE posting, public repo: NO AI trailers (commit-msg hook is present on the main checkout; check the worktree uses it), never force-push.
   Door: `./scripts/deploy-prod.sh --sha "$(git -C <tested worktree> rev-parse HEAD)"` from a worktree at origin/main with a real npm ci, ON THE LAPTOP (forge is NOT logged in on Gabee's Mac; run via ~/Projects/machine-sync/bin/node-run, class build). Merge to main first normally; dev + staging deploy and live check on wolfaenpak (SV production is not installed there, dev only), production smoke, leanzero-demo check, CI: ssh workhorse 'zsh -lc "gh run list --workflow ci.yml --commit <sha>"' (read-only).
7. Clean up: worktree by exact path, browsers, shots-nux dir (gitignored), scratchpad logs.

## Traps paid for
- marks.js readMarks() resolves with the FIRST snapshot; a component mounted later must read marksNow() (fixed in ConsoleTours/TourButton; same latent bug exists in CogniRunner AdminTours).
- A tab that is on screen when the page tour ends waits for its NEXT visit (never two tours back to back): the test visits the first tab last.
- Foreground Bash is cut at 120 s: run the geometry test in the background and watch with a Monitor until-loop (no sleep polling).
- Do not run two builds into one output folder (SV_SHOT_OUT).
- Playwright for the tests lives in ~/Projects/forge-live-harness (present on this Mac now).
- The primary checkout's local main is stale; never touch it. build-info.js shows modified there, leave it.
