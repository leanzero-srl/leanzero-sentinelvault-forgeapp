#!/usr/bin/env node
/**
 * Record the demo-video clips by DRIVING THE BUILT MOCK SURFACES.
 *
 * Footage comes from the screenshot-harness bundles under
 * static/_screenshot-harness/shots/<app>/ — each Custom UI surface built with
 * "@forge/bridge" aliased to the harness mock (bridge.js), the same mounts the
 * Marketplace screenshots use. There is no Confluence, no auth and no live
 * space behind any frame, so the video is reproducible on any machine and
 * cannot leak a customer's data.
 *
 * The scenario per beat is the mock's window.__SHOT__ (panel / steward / realm /
 * realm-steward / section / ribbon-approval), injected via addInitScript so it
 * is set BEFORE the bundle evaluates — the same mechanism driver.mjs and
 * capture.mjs use. The visible cursor is the harness's cyan seal cursor
 * (#0891B2), driven by real mousemove events, so every eased glide reads
 * on camera.
 *
 * Prereq: build the shot bundles first (repo root):
 *   npx webpack --config webpack.screenshot.js --mode production
 * Run:
 *   node static/submission-material/video-src/record.mjs [beatName ...]
 */
import http from 'node:http';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// playwright lives in the screenshot-harness package, not the repo root (render.mjs precedent).
const __req = createRequire(new URL('../../_screenshot-harness/package.json', import.meta.url));
const { chromium } = __req('playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../../_screenshot-harness/shots');
const CLIPS = path.join(__dirname, 'clips');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-beat static server on an ephemeral port (each beat may use a different surface root). */
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('x'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

/** The harness's cyan seal cursor — follows REAL mousemove events, pulses on press. */
const CURSOR = () => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    Object.assign(c.style, {
      position: 'fixed', width: '22px', height: '22px', borderRadius: '50%',
      left: '0', top: '0', transform: 'translate(-50%,-50%)', zIndex: '2147483647',
      pointerEvents: 'none', background: 'rgba(8,145,178,0.30)', border: '2.5px solid #0891B2',
      boxShadow: '0 0 12px rgba(8,145,178,0.7)', transition: 'width .1s,height .1s,background .1s',
    });
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.width = '34px'; c.style.height = '34px'; }, true);
    addEventListener('mouseup', () => { c.style.width = '22px'; c.style.height = '22px'; }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
};

let cur = { x: 0, y: 0 };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

async function glide(page, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16));
  const sx = cur.x, sy = cur.y;
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * t, sy + (y - sy) * t);
    await sleep(ms / steps);
  }
  cur = { x, y };
}

async function box(page, sel) {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250); // let the scroll settle before measuring
  return el.boundingBox();
}

async function glideClick(page, sel, { pause = 600, ms = 600 } = {}) {
  try {
    const b = await box(page, sel);
    if (!b) { console.log(`  · not found: ${sel}`); return false; }
    await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms);
    await sleep(200);
    await page.mouse.down(); await sleep(90); await page.mouse.up();
    await sleep(pause);
    return true;
  } catch (e) { console.log(`  · click skipped (${sel}): ${e.message.split('\n')[0]}`); return false; }
}

async function glideHover(page, sel, { hold = 1200, ms = 600 } = {}) {
  try {
    const b = await box(page, sel);
    if (!b) { console.log(`  · not found: ${sel}`); return false; }
    await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms);
    await sleep(hold);
    return true;
  } catch (e) { console.log(`  · hover skipped (${sel}): ${e.message.split('\n')[0]}`); return false; }
}

async function settle(page) {
  await page.waitForFunction(() => {
    const r = document.getElementById('root');
    return r && r.children.length > 0;
  }, { timeout: 8000 }).catch(() => {});
  await sleep(900);
}

/**
 * Each beat is recorded at a viewport sized to ITS OWN content, not at one
 * house size — a 860px-tall frame around a 50px ribbon ships a slab of empty
 * canvas, and the composer cannot crop back what was never worth filming.
 *
 * `zoom` LAYS THE PAGE OUT larger rather than magnifying the recording (CSS
 * zoom on the root element — deviceScaleFactor does NOT re-lay-out, it just
 * parks the page in the corner of a bigger canvas). getBoundingClientRect then
 * reports the scaled geometry, which is what page.mouse uses, so the click
 * targets still line up.
 *
 * BEATS keys are layout.mjs BEAT_ORDER names; each names the surface bundle
 * (app), the mock scenario (shot), viewport, zoom, and the drive function.
 */
const BEATS = {
  // ── 1 · seal a file: the headline verb ───────────────────────────────────
  //     Q3-budget.xlsx is sealed by me, contract-final.pdf by Alice,
  //     architecture-diagram.png is open. Walk the custody states, then seal
  //     the open file. The mock's data is canned, so the cut ends on the
  //     "Sealing…" busy state — see BEAT_START note in layout.mjs.
  seal: { app: 'inline-panel', shot: 'panel', w: 1280, h: 800, run: async (page) => {
    await glideHover(page, '.artifact-card.status-locked-by-me', { hold: 1600 });
    await glideHover(page, '.artifact-card.status-locked', { hold: 1600 });
    await glideHover(page, '.artifact-card.status-unlocked', { hold: 1100 });
    await glideClick(page, '.artifact-card.status-unlocked button.action-btn.lock', { pause: 900 });
  } },

  // ── 2 · the ribbon: custody is visible on the page, and enforced ─────────
  //     The always-on ribbon bar: sealed count, workflow chip, validation and
  //     AI chips. The caption carries the auto-restore claim; a dedicated
  //     "conflict rolled back" alert scenario is on the wish list (VIDEO-README).
  protect: { app: 'doc-ribbon', shot: 'panel', w: 1600, h: 240, zoom: 1.25, run: async (page) => {
    await sleep(500);
    await glideHover(page, '.ribbon-status', { hold: 1400 });
    await glideHover(page, '.ribbon-chip', { hold: 1400 });
    await glideHover(page, 'button.ribbon-action', { hold: 1600 });
  } },

  // ── 3 · sealed sections: the same custody for page content ───────────────
  //     Two sections already sealed (mine + Alice's); open the picker and seal
  //     "Risks & Mitigations". The picker rows are real page headings.
  sections: { app: 'inline-panel', shot: 'panel', w: 1280, h: 780, run: async (page) => {
    await glideHover(page, '.sv-card-section.sv-section-seals', { hold: 900 });
    await glideHover(page, '.sv-section-row', { hold: 1200 });
    await glideClick(page, 'button:has-text("Seal a section")', { pause: 900 });
    await glideClick(page, '.sv-section-pick-row:has-text("Risks")', { pause: 1400 });
  } },

  // ── 4 · edit requests: ask, the owner approves, access is scoped ─────────
  //     Realm console, user view: My Sealed Files + the Edit Requests inbox
  //     (Bob and Carol asking to edit Q3-budget.xlsx). Approve Bob's.
  requests: { app: 'realm-console', shot: 'realm', w: 1280, h: 860, run: async (page) => {
    await sleep(600);
    await glideHover(page, '.steward-card', { hold: 1500 });
    await glideClick(page, '.steward-card button:has-text("Approve")', { pause: 1600 });
  } },

  // ── 5 · deterministic validations, on the page panel ─────────────────────
  //     The panel's validation group shows the page failing two rules
  //     (a required table, a required heading). Re-check re-runs them live.
  validate: { app: 'inline-panel', shot: 'panel', w: 1280, h: 780, zoom: 1.15, run: async (page) => {
    await glideHover(page, '.sv-card-section.sv-validation', { hold: 1100 });
    await glideHover(page, '.sv-val-item', { hold: 1500 });
    await glideClick(page, '.sv-validation button:has-text("Re-check")', { pause: 1800 });
  } },

  // ── 6 · the optional AI review ───────────────────────────────────────────
  //     Run it and let the three findings render (high PII / medium tone /
  //     low style — severity, excerpt, explanation, suggestion).
  ai: { app: 'inline-panel', shot: 'panel', w: 1280, h: 780, zoom: 1.15, run: async (page) => {
    await glideHover(page, '.sv-card-section.sv-ai-review', { hold: 800 });
    await glideClick(page, '.sv-ai-review button:has-text("Run AI review")', { pause: 1800 });
    await glideHover(page, '.sv-ai-review .sv-val-item', { hold: 1800 });
    await glideHover(page, '.sv-ai-suggest', { hold: 1400 });
  } },

  // ── 7 · the workflow chip: a state the app enforces ──────────────────────
  //     The page is In Review. Open the chip's Move-to menu (Approved is the
  //     enforce state). The mock keeps the state canned, so the cut ends just
  //     after the menu choice — the menu itself is the information.
  workflow: { app: 'doc-ribbon', shot: 'panel', w: 1600, h: 340, zoom: 1.25, run: async (page) => {
    await sleep(400);
    await glideHover(page, '.wf-chip', { hold: 1100 });
    await glideClick(page, '.wf-chip', { pause: 1000 });
    await glideHover(page, '.wf-menu-item:has-text("Approved")', { hold: 1400 });
    await glideClick(page, '.wf-menu-item:has-text("Approved")', { pause: 1200 });
  } },

  // ── 8 · the approval dialog: the differentiator, readable ────────────────
  //     "Awaiting your approval · 1 of 2" — open it: Bob has approved with a
  //     reason, I'm the deciding approver. Type a reason and approve.
  approve: { app: 'doc-ribbon', shot: 'ribbon-approval', w: 1600, h: 640, zoom: 1.35, run: async (page) => {
    await sleep(400);
    await glideHover(page, '.wf-chip-awaiting', { hold: 1000 });
    await glideClick(page, '.wf-chip-awaiting', { pause: 1200 });
    await glideHover(page, '.wf-appr-list', { hold: 1600 });
    const ta = await box(page, '.wf-appr-reason-input');
    if (ta) {
      await glide(page, ta.x + 30, ta.y + ta.height / 2);
      await page.mouse.click(ta.x + 30, ta.y + ta.height / 2);
      await page.keyboard.type('Numbers verified — good to publish.', { delay: 45 });
      await sleep(700);
    }
    await glideClick(page, 'button.wf-appr-approve', { pause: 1200 });
  } },

  // ── 9 · global policy: one console ───────────────────────────────────────
  //     The steward console's General tab (durations, protection, restore and
  //     delete rights), then a scroll — policy reads as breadth, not detail.
  steward: { app: 'steward-console', shot: 'steward', w: 1280, h: 860, run: async (page) => {
    await sleep(700);
    await glide(page, 640, 400, 500);
    await page.mouse.wheel(0, 420); await sleep(1300);
    await glideClick(page, 'button:has-text("Alerts")', { pause: 1400 });
    await page.mouse.wheel(0, 380); await sleep(1500);
  } },

  // ── 10 · the space register: every page's state, and CSV ─────────────────
  //     Realm console as a steward → Workflow tab: 34 pages by state, overdue
  //     reviews flagged, Export CSV. End hovering the export button.
  dashboard: { app: 'realm-console', shot: 'realm-steward', w: 1280, h: 860, run: async (page) => {
    await sleep(600);
    await glideClick(page, 'button.tab-button:has-text("Workflow")', { pause: 1400 });
    await page.mouse.wheel(0, 320); await sleep(1400);
    await page.mouse.wheel(0, 320); await sleep(1200);
    await glideHover(page, 'button.wf-dash-export', { hold: 1800 });
  } },
};

async function record(browser, name, beat) {
  const root = path.join(SHOTS, beat.app);
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    console.error(`  ! missing shot bundle for ${beat.app} — run: npx webpack --config webpack.screenshot.js --mode production`);
    return false;
  }
  const { s, port } = await serve(root);
  const w = beat.w, h = beat.h;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1,
    recordVideo: { dir: CLIPS, size: { width: w, height: h } },
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(CURSOR);
  // The scenario MUST be set before the bundle evaluates — the mock reads
  // window.__SHOT__ at invoke time, but the first invokes fire on mount.
  await ctx.addInitScript(([shot]) => {
    window.__SHOT__ = shot;
    window.__THEME__ = 'light';
  }, [beat.shot]);
  const page = await ctx.newPage();
  cur = { x: w / 2, y: h / 2 };
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    if (beat.zoom && beat.zoom !== 1) {
      await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, beat.zoom);
      await sleep(400);
    }
    await settle(page);
    await page.mouse.move(cur.x, cur.y);
    await beat.run(page);
    await sleep(900);
  } catch (e) {
    console.warn(`  ! ${name}: ${e.message.split('\n')[0]}`);
  }
  const video = page.video();
  await ctx.close();
  if (video) {
    const vp = await video.path();
    const dest = path.join(CLIPS, `beat-${name}.webm`);
    fs.renameSync(vp, dest);
    console.log(`clip  beat-${name}.webm  (${w}x${h}${beat.zoom ? ` zoom ${beat.zoom}` : ''})`);
  }
  await new Promise((r) => s.close(r));
  return true;
}

async function main() {
  if (!fs.existsSync(SHOTS)) {
    console.error('No shot bundles. Run: npx webpack --config webpack.screenshot.js --mode production');
    process.exit(1);
  }
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(BEATS);
  if (!want.length) await rm(CLIPS, { recursive: true, force: true });
  await mkdir(CLIPS, { recursive: true });
  const browser = await chromium.launch();
  for (const n of names) {
    const beat = BEATS[n];
    if (!beat) { console.warn(`unknown beat ${n}`); continue; }
    await record(browser, n, beat);
  }
  await browser.close();
  console.log('\nclips in', CLIPS);
}
main().catch((e) => { console.error(e); process.exit(1); });
