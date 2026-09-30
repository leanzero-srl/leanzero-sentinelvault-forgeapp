---
name: sentinel-vault-marketing
description: Sentinel Vault marketing video pipeline — YouTube feature tutorials, the compilation, v2 thumbnails and upload text, built from the owner's screen recordings on CogniRunner's 2026-09-07 tutorial pipeline. Use when re-cutting, adding or re-rendering any Sentinel Vault YouTube video, thumbnail or upload description.
---

# Sentinel Vault — YouTube tutorial pipeline

Everything lives in `static/submission-material/video-src/yt/`. It is a rebranded copy of CogniRunner's
pipeline (`~/Projects/CogniRunner/.claude/skills/cognirunner-marketing/SKILL.md`, section
"2026-09-07 — YouTube feature tutorials") — read that for the WHY behind the look, the music and the
thumbnail rules. **Never** use `video-src/remotion/` (the old "demo reel" style — the owner rejected the
6.4 promo/short built with it on 2026-09-30; those files were deleted).

## Layout
- `remotion/src/yt/{Tutorial,Compilation}.tsx`, `timeline.ts` — CogniRunner's code, rebranded
  (SV logo from `_marketing/mark.mjs`, "Sentinel Vault" wordmark, `ACCENT` per feature, deep-navy
  `#0B1A36` canvas with NO accent wash). `brand.tsx`, `SceneComponents.tsx` (Title/Text/Outro cards).
- `remotion/src/yt/scripts/<key>.json` — one per tutorial. Timestamps are ABSOLUTE source seconds plus
  `source` (`rec-a`|`rec-b`) and a `[from, to]` window; `catalog.ts` cuts the window with `windowScript`
  and `srcOffset`, so one long recording feeds many tutorials.
- `remotion/public/src/rec-{a,b}.mp4` (gitignored) — converted footage. Recreate:
  `ffmpeg -i "<mov>" -r 30 -vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2" -c:v libx264 -crf 18 -pix_fmt yuv420p -an public/src/rec-a.mp4`
  Sources: `~/Downloads/wetransfer_sentinel_2026-09-30_1318/Screen Recording 2026-09-30 at 13.56.51.mov`
  (rec-a, 4096×1526 ultrawide → 1920×716, 778 s, Gabriela left / Mihai right) and `… 16.09.55.mov`
  (rec-b, 3348×2502 → 1446×1080, 392 s, admin pages + "Gabi test" page). Layout picks itself: ratio > 2 =
  footage on top + step band; otherwise footage left + right-rail checklist.
- `remotion/node_modules` — cloned from CogniRunner's (`cp -c -R`); `npm ci` also works.
- `remotion/render-yt.sh <key>` → `out/yt/sentinel-vault-<key>.mp4` (render silent → `../music-product.py`
  at exact length → mux `volume=0.45`, fades). `--remux` swaps audio only. Needs `/tmp/musenv`
  (`python3 -m venv /tmp/musenv && /tmp/musenv/bin/pip install numpy scipy`). `music-product.py` is the ONLY
  accepted bed (CogniRunner's `music-gen.py` / `music-upbeat.py` were rejected by the owner).
- `remotion/chapters.mts` — `node --experimental-strip-types chapters.mts > ../chapters.json`: replays the
  real time-remap (body starts at frame INTRO−XFADE = 91) for tutorials and Compilation.tsx frame
  arithmetic (TITLE 95, WHY 130, CH_CARD 80, XFADE 14) for the compilation. Its compilation window list
  MUST match `COMPILATION` in `catalog.ts` — change both together.
- `yt-upload-text.py` → `YOUTUBE-UPLOAD-TEXT.md` + `~/Downloads/SentinelVault-YouTube/UPLOAD-TEXT.md`, with
  asserts: title 40–60 keyword first, hook ≤150, 200–350 words, ≥3 chapters ≥10 s apart from 00:00,
  3 hashtags, 8–12 tags. The compilation's title card and first chapter are 6 s apart, so the script merges
  them into one 00:00 chapter.
- `thumbs/` — `thumb.html` + `render-thumbs.mjs` (Playwright from `~/Projects/forge-live-harness`,
  override with `PW_HOME`), crops in `thumbs/crops/<key>.png` cut from FULL-RES .mov frames
  (`ffmpeg -ss t -i mov -frames:v 1` then `crop=`). Deep saturated per-feature `BG` (never black), yellow
  pill + one yellow word, ≤3 words. Build the phone sheet (PIL paste of `out/_phone-*.png`) and LOOK at it.

## The 2026-09-30 cut (10 tutorials + compilation)
| key | source window | feature |
|---|---|---|
| seal-file | a 0–44 | Sealed files (insert panel via /senti, seal image (4).png) |
| edit-requests | a 40–152 | request, approve, decline "No", watch for release |
| auto-restore | a 176–228 | overwrite on Attachments page reverted, Seal Violation |
| sealed-sections | a 228–388 | seal "1. Introduction", edit undone, request, approved edit kept |
| validations | a 428–560 | space "Require a heading", site "Require labels" |
| approval | a 564–716 | Draft → In Review → Approved v50, seals belong to the approval |
| site-protection | b 0–128 | force-unseal, page body, removal/restore (trash + restore on page) |
| authenticator | b 124–160 | "Sign this action" 6-digit code dialog |
| expiry-alerts | b 160–236 | duration, Seals expire, reminders, Alerts, Apply |
| classification | b 264–372 | on, space default Confidential, lower with a reason |
Compilation = 8 chapters (no site-protection/expiry), `baseRate` 1.35.

## Traps (each cost time)
- **Contact frames from `-vf fps=1/4` are CENTRED: file NNN shows t = NNN*4 + 2 s, not NNN*4.** Measured by
  pixel-matching (2026-09-30). The first render used NNN*4 and every caption landed ~2 s early (the last
  step of sealed-sections showed a black reloading pane). All scripts were shifted +2 s. Either extract
  with `-vf "select=not(mod(n\,120))"` or add 2 s when reading a log. Crops: still grab 2–3 candidates.
- **Deliberately NOT used:** rec-b 376–392 (API access tab shows the live webtrigger URL, a minting accountId
  and ~30 revoked harness tokens); rec-a 392–424 (trash restore — frames do not show whether Restore or
  Delete permanently was clicked); rec-a 748–776 dead.
- Glitches in the footage are sped past, not claimed: sealed-sections 364–382 ("could not display this
  section's text", rate 8); approval 576–596 (stale "Already in that state"); classification 350–366
  (doubled "(Development)" byline). "(Development)" labels are accepted by the owner.
- Captions must describe what is ON SCREEN. Frame-read the source (one agent per ~100 frames, per-frame log
  with literal UI text) before writing a script; never caption from the user guide.
- Crops that include a whole wide UI read as noise; the window works best on one element ~2:1.
- `npx remotion still` past the composition length errors — frames from `npx remotion compositions`.

## Changelog
- 2026-09-30 — pipeline created from CogniRunner's; 10 tutorials + compilation rendered, thumbnails v2,
  UPLOAD-TEXT.md; finals in `~/Downloads/SentinelVault-YouTube/`. Old 6.4 promo/short deleted.

## 2026-09-30 — published on YouTube (Leanzero SRL channel UC1JpYs3UmQZtOzbsAf8fYXw), all PUBLIC
seal-file `BFDpA4Y1Tgk` · edit-requests `TyW_js0qXbs` · auto-restore `8YFcmh_-MJg` · sealed-sections `I7VR1Cih9rg` ·
validations `aBFt6A9_8Oo` · approval `SoYsOGB3J5Q` · site-protection `XYvwHigjkFg` · authenticator `-eUE8Hsdiik` ·
expiry-alerts `qHFShA4mu3E` · classification `taEynzBs3ew` · compilation `IGCvPP9RxZo`.
Upload recipe that works (Playwright MCP, owner signs in once in the Playwright window):
1. ONE upload dialog with ALL files: `input[type=file]`.setInputFiles([...]) on `/videos/upload?d=ud`. Uploading one
   per page.goto triggers a `beforeunload` that CANCELS the in-flight upload — never navigate mid-upload.
2. Read ids from the content list thumbnails (`i9.ytimg.com/vi/<id>/`), fill `<url:key>` watch-next links FIRST
   (YouTube rejects `<`/`>` in descriptions).
3. Per video on `/video/<id>/edit`: fill title + description textboxes, "No, it's not made for kids", thumbnail via
   the first `input[type=file]` (#file-loader), "Show advanced settings" → `input[aria-label=Tags]` fill "a, b, c,",
   Save; then "Edit draft" → `#next-button` ×3 → `tp-yt-paper-radio-button[name=PUBLIC]` → `#done-button`.
   Scripts are generated as files and run with browser_run_code_unsafe `filename` (no `require` in that sandbox).
4. Verify from OUTSIDE: oembed (404 = not public) + the watch page contains the description hook. One of eleven
   (validations) silently stayed Draft on the first pass — re-run the publish half.

## 2026-09-30 — Marketplace listing updated for 6.4.0 (done by Playwright, owner signs in once)
App id **1034857304**, key `com.leanzero.confluence.sentinelvault`, vendor LeanZero SRL 443065240.
Account: office@leanzero.net; opening `/manage/apps/...` triggers an Atlassian **step-up 8-digit email code** —
the owner types it in the Playwright window.
**URLs that work** (the old `/manage/plugins/...`, `/manage/vendors`, `/manage` return **410 API_DEPRECATED** —
that is a dead URL, not a login failure):
- App-level: `https://marketplace.atlassian.com/manage/apps/1034857304/details` → `input[name=tagLine]` (≤130),
  `textarea[name=summary]` (≤250), `button[type=submit]` Save.
- Version list: `/manage/apps/1034857304/versions` → each version `/versions/<build>/details` (6.4.0 = build 2002180;
  builds go up by 10 per release). Tabs: details · highlights · media · compatibility · links.
  - details: `input[name=releaseSummary]` (≤80); two Atlassian editors `#ak-editor-textarea` — nth(0) = More
    details (250–1000 chars), nth(1) = Release notes. Type with the keyboard: select-all + Backspace, type the
    intro, Enter, type `* ` to start a bullet list, Enter after each item, Enter twice to leave the list. Save = `Save` button.
  - highlights: layout Hero & highlights; hero = Video id `input[name=youtubeId]` (now the compilation
    `IGCvPP9RxZo`; was the old 4.0.0 video); per highlight `input[name^=title_]`, the editor inside the same card,
    `textarea[name^=explanation_]`; images via `input[type=file]` nth(i) (1840×900 — the cropped 580×330 is NOT
    asked for here any more). Expand collapsed cards by clicking the "Highlight N" text. Save = `button[type=submit]`.
  - media: 5 screenshots, `input[type=file]` nth(i) + `textarea[name^=caption_]`, expand "Image N" first.
  - links: documentationUrl = https://leanzero.net/portfolio/sentinel-vault.
- Cookie banner: click "Reject all".
**Verify from outside** (no auth): `https://marketplace.atlassian.com/rest/2/addons/com.leanzero.confluence.sentinelvault`
(tagLine/summary) and `.../versions/latest` (grep for the YouTube id and a highlight title).
Each NEW version created by `forge deploy -e production` gets "Minor version update" as release summary AND release
notes; More details, highlights, hero video and media are CARRIED OVER from the previous version (verified on 6.5.0,
build 2002190) — so per release only the summary + notes must be written, the rest only when features change; texts live in static/submission-material/LISTING-COPY.md
(`count-blocks.py` checks the limits).
- TRAP (cost a redo 2026-09-30): never "edit one line" in the Marketplace Atlassian editor with Shift+End —
  it selected to the end of the DOCUMENT and the save dropped every later bullet. Always select-all and
  retype the whole field, then reload and read it back.
- Naming: the fourth workflow state is "Needs re-review" (state id `expired`) — never write "Expired" in copy.
- The 6.4.0 REST bug (give/revoke/decline edit access failed "No resolver") is FIXED in 6.5.0 — the ops may be advertised.
