#!/usr/bin/env node
/**
 * 6.4.0 listing refresh (2026-09-30): renders banner + highlights in the brand-v3 language and mats
 * the five additional screenshots, from REAL frames of the owner's 2026-09-30 recordings
 * (src-6.4/*.png, cut with ffmpeg -ss t -frames:v 1 + crop; the dev-site "(Development)" suffix is
 * cropped out of every frame, the API endpoint URL is blurred).
 *
 *   node static/submission-material/_marketing/render-v3.mjs
 *
 * SUPERSEDES render.mjs + derive.mjs for the listing images (those composed the 4.x harness mocks on
 * near-black #020617). Do not run derive.mjs afterwards: it would overwrite these outputs from the
 * old 2x masters.
 *
 * Rules: DSF 2 then Lanczos to exact px; the 580x330 highlight crop is anchored at x=0 (a centred
 * crop cut the first letter of every headline in CogniRunner 1.1); a page reporting data-clipped != 0
 * or a fallback font fails the run.
 */
import http from 'node:http';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ex = promisify(execFile);
const MK = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(MK, '..');
const TMP = path.join(MK, 'out-v3');
const HARNESS = path.resolve(MK, '../../_screenshot-harness');
const { chromium } = createRequire(path.join(HARNESS, 'package.json'))('playwright');
const ff = (args) => ex('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.png': 'image/png' };

const srv = await new Promise((res) => {
  const s = http.createServer((req, r) => {
    const f = path.join(MK, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(MK) || !existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    createReadStream(f).pipe(r);
  }).listen(0, '127.0.0.1', () => res(s));
});
const base = `http://127.0.0.1:${srv.address().port}/brand-v3.html`;
const src = (n) => `src-6.4/${n}`;

// s = scale of the brand chrome (logo, pill, sub, byline); maxx keeps text inside the x=0 thumbnail crop.
const JOBS = [
  { out: 'banner', w: 1120, h: 548, q: { mode: 'banner', s: 1, pill: 'Content protection for Confluence',
    title: 'Sealed. |Approved.| Classified.', img: src('seal-panel.png'), ww: 520, right: 40 } },
  { out: 'hl1', w: 1840, h: 900, q: { mode: 'highlight', s: 1.45, maxx: 1480, pill: 'Seal & auto-restore',
    title: 'Seal~it. It~stays |sealed|', sub: 'Overwrites restored, trash undone,|sealed sections reverted',
    img: src('seal-panel.png'), ww: 1000, right: -40 } },
  { out: 'hl2', w: 1840, h: 900, q: { mode: 'highlight', s: 1.45, maxx: 1480, pill: 'Data classification',
    title: 'Every~page |classified|', sub: 'Public to Restricted, space defaults,|a reason to lower a level',
    img: src('classification-top.png'), ww: 960, right: -60, img2: src('ribbon.png'), ww2: 900, x2: 800, y2: 770, rot2: 1.5 } },
  { out: 'hl3', w: 1840, h: 900, q: { mode: 'highlight', s: 1.45, maxx: 1480, pill: 'Signed decisions',
    title: 'Signed~with~a |code|', sub: 'Seal actions and approvals can ask|for a 6-digit authenticator code',
    img: src('sign.png'), ww: 900, right: -20 } },
];

await mkdir(TMP, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
let bad = 0;
for (const j of JOBS) {
  await page.setViewportSize({ width: j.w, height: j.h });
  const qs = new URLSearchParams({ w: j.w, h: j.h, ...j.q }).toString();
  await page.goto(`${base}?${qs}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 20000 });
  const st = await page.evaluate(() => ({ clipped: +document.body.dataset.clipped, fs: document.body.dataset.fs,
    font: document.fonts.check('900 40px Inter') }));
  if (st.clipped || !st.font) { bad++; console.log('FAIL', j.out, st); }
  const f = path.join(TMP, `${j.out}-2x.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: j.w, height: j.h } });
  console.log('render', j.out, st);
}
await browser.close(); srv.close();

await ff(['-i', path.join(TMP, 'banner-2x.png'), '-vf', 'scale=1120:548:flags=lanczos', path.join(OUT, 'marketplace-banner-1120x548.png')]);
await ff(['-i', path.join(TMP, 'banner-2x.png'), '-vf', 'scale=560:274:flags=lanczos', path.join(OUT, 'marketplace-banner-560x274.png')]);
const cropW = Math.round(900 * 580 / 330); // 1582, anchored at x=0
for (const n of [1, 2, 3]) {
  const full = path.join(OUT, `marketplace-highlight-${n}.png`);
  await ff(['-i', path.join(TMP, `hl${n}-2x.png`), '-vf', 'scale=1840:900:flags=lanczos', full]);
  await ff(['-i', full, '-vf', `crop=${cropW}:900:0:0,scale=580:330:flags=lanczos`, path.join(OUT, `marketplace-highlight-${n}-cropped.png`)]);
}

// Additional screenshots: 1840x1020, the frame fitted into 1760x940 and matted on the brand sky-navy.
const SHEETS = [
  ['01-sealed-files-panel', 'seal-panel.png'],
  ['02-classification-levels', 'classification-top.png'],
  ['03-signed-action', 'sign.png'],
  ['04-auto-restored-attachment', 'restored.png'],
  ['05-rest-api-access', 'api.png'],
];
const SCREENS = path.join(OUT, 'marketplace-screenshots');
await mkdir(SCREENS, { recursive: true });
for (const [name, f] of SHEETS) {
  await ff(['-i', path.join(MK, 'src-6.4', f), '-vf',
    'scale=1760:940:force_original_aspect_ratio=decrease:flags=lanczos,pad=1840:1020:(ow-iw)/2:(oh-ih)/2:#0C4A6E',
    path.join(SCREENS, `${name}.png`)]);
  console.log('mat', name);
}
if (bad) { console.error(`${bad} render(s) clipped or fell back to a system font`); process.exit(1); }
