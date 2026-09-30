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
