#!/usr/bin/env node
/**
 * Derive EVERY exact-pixel Marketplace file from the 2x masters render.mjs
 * produced, so the two can never disagree. Run after render.mjs, every time:
 *
 *   node static/submission-material/_marketing/render.mjs
 *   node static/submission-material/_marketing/derive.mjs
 *
 * Hand-produced derivatives are how a listing ends up with a current hero
 * and a year-old thumbnail beside it — the derivative is the one nobody
 * remembers to redo. Nothing in this file re-renders; it only scales, crops
 * and mats what render.mjs wrote.
 *
 * Outputs (Atlassian Marketplace specs):
 *   marketplace-logo-144.png                  144x144
 *   marketplace-banner-1120x548.png           1120x548
 *   marketplace-banner-560x274.png            560x274
 *   marketplace-highlight-{1,2,3}.png         1840x900
 *   marketplace-highlight-{1,2,3}-cropped.png 580x330 (centre crop)
 *   marketplace-screenshots/0N-*.png          1840x1020, matted on brand navy
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');
const SHOTS = path.join(OUT, 'screenshots');
const SCREENS = path.join(OUT, 'marketplace-screenshots');
// Mat color = the app's own dark surface (--sv-surface dark), the same navy
// family the banner/highlight templates stand on.
const BG = '#020617';

const ff = (args) => execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const need = (file) => {
  if (!existsSync(file)) throw new Error(`Missing ${path.basename(file)} — run render.mjs first`);
  return file;
};

async function main() {
  await mkdir(SCREENS, { recursive: true });

  // Logo: straight downscale of the 2x render (transparent background kept).
  await ff(['-i', need(path.join(OUT, 'logo-2x.png')),
    '-vf', 'scale=144:144:flags=lanczos', path.join(OUT, 'marketplace-logo-144.png')]);
  console.log('derive  marketplace-logo-144.png');

  // Banner: exact size + the standard small variant, both from the 2x master.
  await ff(['-i', need(path.join(OUT, 'banner-2x.png')),
    '-vf', 'scale=1120:548:flags=lanczos', path.join(OUT, 'marketplace-banner-1120x548.png')]);
  await ff(['-i', path.join(OUT, 'marketplace-banner-1120x548.png'),
    '-vf', 'scale=560:274:flags=lanczos', path.join(OUT, 'marketplace-banner-560x274.png')]);
  console.log('derive  marketplace-banner-1120x548.png');
  console.log('derive  marketplace-banner-560x274.png');

  // Highlights: exact 1840x900, then the 580x330 thumbnail. The thumbnail is
  // a WIDER aspect (1.758) than the source (2.044), so a plain scale would
  // letterbox — crop to the thumbnail's aspect first, centred, keeping the
  // headline on the left and the product window on the right.
  const cropW = Math.round(900 * (580 / 330)); // 1582
  const cropX = Math.round((1840 - cropW) / 2); // 129
  for (const n of [1, 2, 3]) {
    const full = path.join(OUT, `marketplace-highlight-${n}.png`);
    await ff(['-i', need(path.join(OUT, `highlight-${n}-2x.png`)),
      '-vf', 'scale=1840:900:flags=lanczos', full]);
    await ff(['-i', full, '-vf',
      `crop=${cropW}:900:${cropX}:0,scale=580:330:flags=lanczos`,
      path.join(OUT, `marketplace-highlight-${n}-cropped.png`)]);
    console.log(`derive  marketplace-highlight-${n}.png + -cropped.png`);
  }

  // Additional screenshots (max 5): each 2x product still fitted into
  // 1760x940 and matted onto the brand navy at 1840x1020, so a tall panel or
  // a wide ribbon never sits on a white void. Names tell the story in order.
  const SHEETS = [
    ['01-sentinel-panel', 'panel.png'],            // flagship: seals, requests, validation, AI, sections
    ['02-approval-ribbon', 'ribbon-approval.png'], // approve/deny straight from the page ribbon
    ['03-workflow-dashboard', 'workflow-full.png'],// space console: states, KPIs, per-page table
    ['04-ai-validations', 'validations-ai.png'],   // Forge LLM settings — Runs on Atlassian, no egress
    ['05-global-preferences', 'steward.png'],      // steward console: durations, restore, protection
  ];
  for (const [name, shot] of SHEETS) {
    await ff(['-i', need(path.join(SHOTS, shot)), '-vf',
      `scale=1760:-1:flags=lanczos,scale='min(1760,iw)':'min(940,ih)':`
      + `force_original_aspect_ratio=decrease,pad=1840:1020:(ow-iw)/2:(oh-ih)/2:${BG}`,
      path.join(SCREENS, `${name}.png`)]);
    console.log(`derive  marketplace-screenshots/${name}.png`);
  }
}
main().catch((e) => { console.error(e.stderr || e.message); process.exit(1); });
