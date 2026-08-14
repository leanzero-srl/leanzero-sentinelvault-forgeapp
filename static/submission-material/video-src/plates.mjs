#!/usr/bin/env node
/**
 * Render the still plates the video is composed against.
 *
 * Two kinds:
 *   title.png / outro.png    full-frame brand cards
 *   frame-<beat>.png         the brand backdrop with a rounded window PUNCHED OUT
 *                            for that beat's footage, plus a drop shadow around
 *                            the opening and that beat's lower-third caption
 *
 * The punch-out is why there is one plate per beat rather than one shared
 * background: each clip is recorded at a viewport sized to its own content, so
 * every beat lands in a different window rectangle. Compositing order is
 * black → footage → plate, so the plate's rounded hole is what gives the footage
 * its corner radius, and nothing can spill past the opening.
 *
 * Brand: Sentinel Vault leads with the seal cyan (#0891B2 light / #22D3EE dark
 * accents) on the LeanZero dark canvas. Solid saturated accents only — the
 * single radial wash from the seal cyan is the same device the sibling apps'
 * plates use, not a pastel tint.
 *
 *   node static/submission-material/video-src/plates.mjs
 */
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BEAT_ORDER, LOWER_THIRDS, windowRect, OUT_W, OUT_H, clipSize } from './layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'plates');

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Brand backdrop + optional punched window, as a data URL from a canvas. */
const PAINT = ({ rect, w, h }) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');

  // Near-black slate canvas (the app's own dark surface family), drifting
  // toward a deep cyan-tinted teal in the lower right.
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#020617');
  g.addColorStop(0.55, '#07131f');
  g.addColorStop(1, '#04232e');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);

  // A faint engineering grid — the LeanZero drafting-table device.
  x.strokeStyle = 'rgba(103,203,220,0.06)';
  x.lineWidth = 1;
  for (let i = 0; i <= w; i += 80) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
  for (let i = 0; i <= h; i += 80) { x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(w, i + 0.5); x.stroke(); }

  // A single saturated wash from the seal cyan, top-left — solid colour
  // radiating out, not a 10% tint spread over the whole frame.
  const rg = x.createRadialGradient(w * 0.18, h * 0.1, 0, w * 0.18, h * 0.1, w * 0.7);
  rg.addColorStop(0, 'rgba(8,145,178,0.30)');
  rg.addColorStop(1, 'rgba(8,145,178,0)');
  x.fillStyle = rg;
  x.fillRect(0, 0, w, h);

  if (rect) {
    const r = 14;
    const round = () => {
      x.beginPath();
      x.moveTo(rect.x + r, rect.y);
      x.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r);
      x.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r);
      x.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r);
      x.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r);
      x.closePath();
    };
    // Shadow first, while the shape is still opaque — this darkens the backdrop
    // AROUND the opening, which is what reads as depth once the hole is punched.
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.65)';
    x.shadowBlur = 60;
    x.shadowOffsetY = 22;
    x.fillStyle = '#000';
    round();
    x.fill();
    x.restore();
    // Now remove the shape itself, leaving the footage to show through.
    // fillStyle MUST be reset to something fully opaque: destination-out removes
    // destination alpha in proportion to the SOURCE alpha, and the restore()
    // above puts the radial-gradient fill back. Punching with that gradient
    // removed only 5-25% of the alpha in the sibling app's first build — every
    // frame of footage came out dimmed to near-black, with a horizontal ramp
    // that exactly traced the gradient.
    x.save();
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = '#000';
    round();
    x.fill();
    x.restore();
    // A hairline edge so the opening reads as a surface, not a cut-out.
    x.save();
    x.strokeStyle = 'rgba(103,232,249,0.30)';
    x.lineWidth = 1.5;
    round();
    x.stroke();
    x.restore();
  }
  return c.toDataURL('image/png');
};

/** The app's own shield glyph (the ribbon's SVG path) on a solid seal-cyan tile. */
const shieldTile = (size) => `
  <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;flex:none;
              background:linear-gradient(135deg,#0891B2,#0E7490);display:flex;align-items:center;justify-content:center;
              box-shadow:0 8px 24px rgba(8,145,178,.55)">
    <svg width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" viewBox="0 0 24 24" fill="none"
         stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  </div>`;

const brandMark = (size = 52) => `
  <div style="display:flex;align-items:center;gap:16px;justify-content:center">
    ${shieldTile(size)}
    <div style="font-size:${Math.round(size * 0.56)}px;font-weight:800;letter-spacing:-.015em;color:#fff">Sentinel Vault</div>
  </div>`;

/** "A LeanZero app" footer, with the real LeanZero mark when the sibling repo is present. */
const leanzeroLine = (iconDataUrl) => `
  <div style="display:flex;align-items:center;gap:10px;justify-content:center">
    ${iconDataUrl ? `<img src="${iconDataUrl}" style="width:26px;height:26px;border-radius:6px">` : ''}
    <span style="font-size:19px;font-weight:600;color:#8fb3c4;letter-spacing:.01em">A LeanZero app</span>
  </div>`;

const lowerThird = (title, sub) => `
  <div style="position:absolute;left:78px;bottom:52px;max-width:1360px">
    <div style="font-size:40px;font-weight:800;color:#fff;letter-spacing:-.02em;line-height:1.15;text-shadow:0 2px 18px rgba(0,0,0,.7)">${title}</div>
    <div style="font-size:23px;color:#9cc0d1;margin-top:9px;line-height:1.35;text-shadow:0 2px 14px rgba(0,0,0,.7)">${sub}</div>
  </div>`;

async function loadLeanZeroIcon() {
  const p = path.join(os.homedir(), 'Projects/LeanZero-website/public/brand-icon-144.png');
  if (!existsSync(p)) { console.warn('  · LeanZero brand icon not found — outro renders text-only attribution'); return null; }
  const buf = await readFile(p);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const lzIcon = await loadLeanZeroIcon();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: OUT_W, height: OUT_H }, deviceScaleFactor: 1 });

  const shoot = async (name, rect, html) => {
    const bg = await page.evaluate(PAINT, { rect, w: OUT_W, h: OUT_H });
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <body style="margin:0;width:${OUT_W}px;height:${OUT_H}px;font-family:${FONT};position:relative;overflow:hidden">
        <img src="${bg}" style="position:absolute;inset:0;width:${OUT_W}px;height:${OUT_H}px">
        ${html}
      </body>`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
    console.log(`plate  ${name}.png`);
  };

  // Tagline mirrors the listing draft ("Seal files and sections, enforce
  // approvals") — if the listing copy lands differently, update BOTH.
  await shoot('title', null, `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
      ${brandMark(58)}
      <div style="text-align:center">
        <div style="font-size:82px;font-weight:800;color:#fff;letter-spacing:-.035em;line-height:1.06">Seal files and sections,<br><span style="color:#22D3EE">enforce approvals</span></div>
        <div style="font-size:27px;color:#9cc0d1;margin-top:30px">Content protection for Confluence — enforced, not just tracked</div>
      </div>
    </div>`);

  await shoot('outro', null, `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
      ${brandMark(58)}
      <div style="text-align:center">
        <div style="font-size:62px;font-weight:800;color:#fff;letter-spacing:-.03em;line-height:1.12">Everyone tracks.<br><span style="color:#22D3EE">Sentinel Vault enforces.</span></div>
        <div style="font-size:24px;color:#9cc0d1;margin-top:30px">Built on Atlassian Forge · AI review runs on Atlassian-hosted models</div>
      </div>
      <div style="font-size:21px;font-weight:700;color:#fff;background:#0891B2;padding:14px 30px;border-radius:10px">Find it on the Atlassian Marketplace</div>
      ${leanzeroLine(lzIcon)}
    </div>`);

  for (const beat of BEAT_ORDER) {
    const size = await clipSize(beat);
    if (!size) { console.warn(`  ! no clip for ${beat} — run record.mjs first`); continue; }
    const rect = windowRect(size.w, size.h);
    const lt = LOWER_THIRDS[beat];
    await shoot(`frame-${beat}`, rect, lt ? lowerThird(lt[0], lt[1]) : '');
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
