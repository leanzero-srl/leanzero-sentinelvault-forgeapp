# Demo video — how it is built

`../sentinel-vault-demo.mp4` · 1920×1080 · 30fps · H.264 + AAC · ~90s

Everything here is reproducible from a clean checkout. No editor, no timeline
file, no assets that exist only on one machine. (The outro embeds the LeanZero
brand icon from `~/Projects/LeanZero-website/public/brand-icon-144.png` when
that repo is present; without it the attribution renders text-only.)

```bash
npx webpack --config webpack.screenshot.js --mode production   # the shot bundles the video films
node static/submission-material/video-src/record.mjs           # drives the surfaces, records 10 clips
node static/submission-material/video-src/plates.mjs           # title, outro, one framed plate per beat
node static/submission-material/video-src/compose.mjs          # trims, frames, crossfades, scores, muxes
```

Re-record a single beat while iterating: `node record.mjs seal approve`.
(With NO argument record.mjs DELETES all clips first — same trap as the
harness's driver.mjs.)

## What is being filmed

The screenshot-harness bundles under `static/_screenshot-harness/shots/<app>/`
— each Custom UI surface built by `webpack.screenshot.js` with `@forge/bridge`
aliased to the mock (`static/_screenshot-harness/bridge.js`). There is no
Confluence, no auth and no live space behind any frame, so the video is
reproducible anywhere and cannot leak a customer's data.

The scenario per beat is the mock's `window.__SHOT__` (`panel`, `steward`,
`realm`, `realm-steward`, `ribbon-approval`), injected with `addInitScript` so
it is set **before** the bundle evaluates — the same mechanism `driver.mjs`
and `capture.mjs` use. The cursor is the harness's cyan seal cursor
(`#0891B2`), driven by real mousemove events.

## The cut

| # | beat | surface · scenario | shows |
|---|---|---|---|
| 1 | `seal` | inline-panel · panel | the three custody states, then sealing the open file |
| 2 | `protect` | doc-ribbon · panel | the always-on ribbon: sealed count, workflow + validation chips |
| 3 | `sections` | inline-panel · panel | sealed sections; the picker seals "Risks & Mitigations" |
| 4 | `requests` | realm-console · realm | the Edit Requests inbox; approving Bob's request |
| 5 | `validate` | inline-panel · panel | two failing content rules; Re-check runs them live |
| 6 | `ai` | inline-panel · panel | Run AI review → three findings with suggestions |
| 7 | `workflow` | doc-ribbon · panel | the In Review chip and its Move-to menu |
| 8 | `approve` | doc-ribbon · ribbon-approval | the approval dialog: approver rows, a typed reason, Approve |
| 9 | `steward` | steward-console · steward | global policy: General toggles, Alerts channels |
| 10 | `dashboard` | realm-console · realm-steward | the Workflow register: 34 pages by state, Export CSV |

## Composition

`layout.mjs` is the single source of geometry, running order, per-beat trim and
captions. `plates.mjs` and `compose.mjs` both read `windowRect` from it — a
plate whose hole disagrees with the overlay by one pixel shows a bright seam.

Each beat is recorded at a viewport sized to **its own** content. The doc-ribbon
beats are 1600×240–640 strips — a full-height frame around a 50px bar ships a
slab of empty canvas, and the composer cannot crop back what was never worth
filming. The ribbon and panel-detail beats are laid out with CSS `zoom` so the
small type is genuinely rendered at video size rather than upscaled.

Compositing per beat is `black → footage → plate`. The plate is the brand
backdrop (near-black slate, seal-cyan wash, engineering grid) with a rounded
window punched out of it, so it supplies the corner radius, the drop shadow and
the caption in one overlay.

## Things that bit the sibling pipeline (lz-ppm-forge), and will bite here

- **`destination-out` punches with the CURRENT fill style.** `ctx.restore()`
  after the shadow pass put the backdrop's radial gradient back, so the punch
  removed only 5–25% of the alpha. The plate stayed almost solid over the
  window and every frame of footage came out dimmed to near-black, with a
  horizontal ramp that exactly traced the gradient. Set an opaque `fillStyle`
  before punching. Check it with:
  `ffmpeg -i plates/frame-seal.png -vf "format=rgba,crop=1:1:960:488,extractplanes=a" -f rawvideo - | xxd -p` → must be `00`.
- **`deviceScaleFactor` does not enlarge a layout.** Raising it with a bigger
  `recordVideo.size` just parks the page in the top-left of a larger canvas.
  Use CSS `zoom`, which scales layout — and note `getBoundingClientRect` then
  reports the scaled geometry, which is what `page.mouse` uses, so click
  targets still line up.
- **Dialogs have a viewport-relative max-height.** Shoot one in too short a
  viewport and it silently scrolls or clips. The `approve` beat's viewport
  (1600×640 at zoom 1.35) exists to fit the whole approval dialog below the
  ribbon bar — verify the Approve/Deny buttons are in frame before accepting a
  take.
- **A stale tooltip or hover state covers the payoff.** Park the cursor on
  neutral ground and let hovers clear before the moment the caption describes.
- **Never mux with `-shortest`** — it truncates to whichever stream ends first.
  The music is generated to the measured picture length instead.

## Sentinel-Vault-specific traps

- **The mock's data is canned, so mutations snap back.** `seal-artifact`,
  `request-transition` and `decide-approval` return success but the refetch
  re-renders the same fixture. The `seal` beat therefore ENDS on the
  "Sealing…" busy state and the `workflow`/`approve` beats end just after the
  click — `BEAT_SECONDS`/`BEAT_START` trim before the snap-back renders.
  After any re-record, scrub the last second of those three clips.
- **`window.__SHOT__` must exist before the bundle evaluates.** The mock reads
  it at invoke time and the first invokes fire on mount — inject with
  `addInitScript` (as record.mjs does), never `addScriptTag` after load.
- **Every beat serves its own surface root** (`shots/<app>/`) on an ephemeral
  port; there is no shared build like lz-ppm's. A 404 in a recording means the
  beat's `app` doesn't match a built bundle — re-run the screenshot webpack.

## Wish list — mock scenarios that would upgrade the film (do NOT hack in mid-render)

1. **`ribbon-conflict`**: `recent-dispatches` returning one `SEAL_CONFLICT`
   dispatch, so the `protect` beat can show the real payoff alert — "Bob tried
   to modify Q3-budget.xlsx… The modification was automatically rolled back."
   Today the mock's default returns no dispatches, so the beat shows the ribbon
   status bar and the caption carries the claim.
2. **Stateful `seal-artifact`**: flipping att3 to `HELD_BY_ACTOR` in the
   fixture so the `seal` beat can hold on the sealed result instead of ending
   on the busy state.
3. **Stateful `request-transition` / `decide-approval`**: moving the ribbon to
   `awaiting-approval` / `Approved` so the workflow beats show the state
   actually change.

## Music

`music.py` — numpy and the stdlib `wave` module only. scipy is not installed
here and pulling it in for one low-pass filter would make the video unbuildable
on any machine without it; the filter is a moving-average FIR via `np.convolve`.
Generated to the final measured duration so it ends with the picture rather
than being cut mid-phrase. Mixed at about −24 dB mean so it never fights the
captions. Progression Am / Em / F / G — steady and watchful, Sentinel's own
voicing of the house sound.

## Verifying a build

Do not trust the exit code. Look at the frames:

```bash
ffmpeg -i ../sentinel-vault-demo.mp4 \
  -vf "select='not(mod(n\,150))',scale=380:-1,tile=5x4" -frames:v 1 verify/contact-sheet.png
ffmpeg -i ../sentinel-vault-demo.mp4 -map 0:a -af volumedetect -f null -   # mean ≈ -24 dB
```

`compose.mjs` already fails hard if the xfade offsets do not produce the
expected total duration — that error means a segment is frozen, not merely
mistimed. Then check the three snap-back beats (`seal`, `workflow`, `approve`)
frame-by-frame at their cut points, and that no beat shows an empty white strip
where a surface failed to mount (root text length is printed by capture.mjs if
in doubt).
