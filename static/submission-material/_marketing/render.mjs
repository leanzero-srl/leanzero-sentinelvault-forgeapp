#!/usr/bin/env node
/**
 * Render Sentinel Vault's Marketplace assets from the HTML templates beside
 * this file, using the app's OWN mocked-bridge screenshot harness.
 *
 * Product screenshots come from `static/_screenshot-harness/shots/<surface>/`
 * — the webpack.screenshot.js builds where `@forge/bridge` is aliased to the
 * mock and `window.__SHOT__` selects the scenario (same serve+scenario
 * mechanism as the harness's capture.mjs). No Confluence, no auth, no live
 * space. Rebuild the surfaces first if the UI changed:
 *
 *   npx webpack --config webpack.screenshot.js --mode production
 *   node static/submission-material/_marketing/render.mjs
 *   node static/submission-material/_marketing/derive.mjs
 *
 * Everything renders at deviceScaleFactor 2. The outputs of THIS script are
 * the 2x masters (`*-2x.png` + screenshots/); derive.mjs produces every
 * exact-pixel Marketplace file FROM them — never re-render a small size by
 * hand and never edit a derived file.
 *
 * Lessons carried over from the lz-ppm pipeline (do not relearn these):
 *  - viewport heights are tuned to the CONTENT — a viewport taller than the
 *    content ships a slab of empty canvas inside a Marketplace asset;
 *  - viewport screenshots, never fullPage — fullPage dislocates
 *    sticky/fixed bars into the middle of the image (visible in the old
 *    harness fullPage captures);
 *  - the ONE authored brand mark (mark.mjs) is injected into every
 *    template's [data-brand-mark] slot, so banner, highlights and logo can
 *    never drift apart;
 *  - the window shot's CSS width must be >= the template window's 1240px,
 *    or the composed image silently UPSCALES and goes soft.
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MARK_TILE_SVG } from './mark.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');                       // static/submission-material
const SHOTS = path.join(OUT, 'screenshots');                     // 2x product stills
const HARNESS = path.resolve(__dirname, '../../_screenshot-harness');
const SURFACES = path.join(HARNESS, 'shots');                    // per-surface standalone builds

// Playwright lives in the harness's node_modules, not at the repo root.
const requireHarness = createRequire(path.join(HARNESS, 'package.json'));
const { chromium } = requireHarness('playwright');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json', '.txt': 'text/plain' };

function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

/* Evaluated in the page: the panel's dismissible onboarding explainer is good
 * in the full flagship shot but noise inside a tight banner/highlight crop. */
const HIDE_EXPLAINER = () => { document.querySelector('.sv-explainer')?.remove(); };

/* Evaluated in the page: the consoles' sticky "Save … settings" bars are real
 * UI, but inside a mid-page marketing crop they float over the content. Only
 * the save bars are hidden — never anything else sticky. */
const HIDE_STICKY_SAVE = () => {
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'sticky' || cs.position === 'fixed')
        && /Save (workflow|validation)/i.test(el.textContent || '')
        && (el.textContent || '').length < 200) el.style.display = 'none';
  }
};

/**
 * The product stills. `app` is the surface build dir under shots/, `shot` is
 * the bridge-mock scenario (window.__SHOT__: panel | steward | realm |
 * realm-steward | section | ribbon-approval). All light theme — Marketplace
 * listings are viewed on a white page.
 *
 * Heights are tuned to the content, measured on the current harness builds.
 * `el` switches to an element screenshot; `clipFrom`/`clipTo` clip the full
 * width from the top of one element to the bottom of another (both must be
 * inside the viewport — keep those viewports tall enough).
 */
const SCENES = [
  // The flagship: seals + edit requests + validation + AI findings + sealed
  // sections + upload zone, with the self-describing explainer kept in.
  { name: 'panel', app: 'inline-panel', shot: 'panel', w: 1280, h: 1250,
    wait: '.sv-card-section' },

  // Banner / highlight-1 window: header chips + sealed cards with the edit-
  // request inbox (Approve/Deny) and editors (Revoke), down to the Available
  // card with its Seal button. Explainer hidden so the seal story starts at
  // the first pixel; the clip ends cleanly at the Available section instead
  // of slicing the next group's header.
  { name: 'panel-seals', app: 'inline-panel', shot: 'panel', w: 1280, h: 900,
    wait: '.sv-card-section', drive: HIDE_EXPLAINER,
    clipFrom: '.sv-panel-header', clipTo: '.sv-card-section:has-text("Available")' },

  // Highlight-3 window: Validation results + AI Review findings — the
  // product WORKING (severity, excerpt, suggested fix), not a settings form.
  { name: 'panel-ai', app: 'inline-panel', shot: 'panel', w: 1280, h: 1000,
    wait: '.sv-ai-review', drive: HIDE_EXPLAINER,
    clipFrom: '.sv-validation', clipTo: '.sv-ai-review' },

  // The page ribbon with its approval popover open: chips (Awaiting your
  // approval 1 of 2 · Validation · AI check) + Approve/Deny with reason box.
  { name: 'ribbon-approval', app: 'doc-ribbon', shot: 'ribbon-approval', w: 1280, h: 430,
    wait: 'button', click: 'Awaiting' },

  // Highlight-2 window: "Approvals waiting on you" + the workflow status
  // dashboard (state KPIs + per-page table), save bar hidden for the crop.
  { name: 'workflow', app: 'realm-console', shot: 'realm-steward', w: 1280, h: 780,
    wait: 'button', click: 'Workflow', afterClick: '.wf-dash',
    drive: () => {
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const cs = getComputedStyle(el);
        if ((cs.position === 'sticky' || cs.position === 'fixed')
            && /Save (workflow|validation)/i.test(el.textContent || '')
            && (el.textContent || '').length < 200) el.style.display = 'none';
      }
      document.querySelector('.wf-inbox')?.scrollIntoView();
    } },

  // Marketplace screenshot: the space console's Workflow tab from the top —
  // header, tabs, approvals inbox, status KPIs. Sticky save bar is real UI
  // at the real bottom here, so it stays.
  { name: 'workflow-full', app: 'realm-console', shot: 'realm-steward', w: 1280, h: 900,
    wait: 'button', click: 'Workflow', afterClick: '.wf-dash' },

  // Marketplace screenshot: Semantic AI Validations settings — the block
  // that literally says "no external API keys and no data egress", with the
  // Runs on Atlassian badge, model, rules, style, tone, budget.
  { name: 'validations-ai', app: 'realm-console', shot: 'realm-steward', w: 1280, h: 900,
    wait: 'button', click: 'Validations', afterClick: '.val-ai',
    drive: HIDE_STICKY_SAVE, el: '.val-ai' },

  // Marketplace screenshot: global steward console — seal duration, force-
  // unseal, restore/cleanup toggles, page-body protection.
  { name: 'steward', app: 'steward-console', shot: 'steward', w: 1280, h: 900,
    wait: '.settings-panel' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderScenes(browser) {
  await mkdir(SHOTS, { recursive: true });
  for (const sc of SCENES) {
    const root = path.join(SURFACES, sc.app);
    if (!existsSync(path.join(root, 'index.html'))) {
      throw new Error(`Missing harness build for "${sc.app}" — run: npx webpack --config webpack.screenshot.js --mode production`);
    }
    const { s, port } = await serve(root);
    const ctx = await browser.newContext({ viewport: { width: sc.w, height: sc.h }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([shot]) => { window.__SHOT__ = shot; window.__THEME__ = 'light'; }, [sc.shot]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const r = document.getElementById('root'); return r && r.children.length > 0; }, { timeout: 10000 });
    if (sc.wait) await page.waitForSelector(sc.wait, { timeout: 10000 }).catch(() => {});
    await sleep(1200);
    if (sc.click) {
      await page.locator(`button:has-text("${sc.click}")`).first().click();
      if (sc.afterClick) await page.waitForSelector(sc.afterClick, { timeout: 10000 }).catch(() => {});
      await sleep(900);
    }
    if (sc.drive) { await page.evaluate(sc.drive); await sleep(500); }
    await sleep(400);

    const file = path.join(SHOTS, `${sc.name}.png`);
    if (sc.el) {
      await page.locator(sc.el).first().screenshot({ path: file });
    } else if (sc.clipFrom && sc.clipTo) {
      const a = await page.locator(sc.clipFrom).first().boundingBox();
      const b = await page.locator(sc.clipTo).first().boundingBox();
      if (!a || !b) throw new Error(`${sc.name}: clip anchors not found (${sc.clipFrom} / ${sc.clipTo})`);
      const top = Math.max(0, a.y - 8);
      const bottom = Math.min(sc.h, b.y + b.height + 8);
      await page.screenshot({ path: file, clip: { x: 0, y: top, width: sc.w, height: bottom - top } });
    } else {
      await page.screenshot({ path: file }); // viewport, never fullPage
    }
    console.log(`screenshot  ${sc.name}.png  ${sc.w}x${sc.h} @2x${errors.length ? '  PAGEERRORS: ' + errors.join(' | ') : ''}`);
    if (errors.length) throw new Error(`${sc.name}: page errored — a broken shot must not reach the listing`);
    await ctx.close();
    await new Promise((r) => s.close(r));
  }
}

/**
 * The three highlight stories — the app's strongest, in order:
 * 1. sealing + auto-restore (the core enforcement),
 * 2. workflow approvals with the ENFORCED Approved state (the differentiator),
 * 3. AI validations that Run on Atlassian (no keys, no egress).
 * Copy states only what the product does today (FEATURE_LEDGER rows 1–46;
 * row 47 status-mirroring is REMOVED — never mention it).
 */
const HIGHLIGHTS = [
  { eyebrow: '§01 · Seal & auto-restore', title: 'Seal a file —<br><em>the vault holds it</em>',
    sub: 'Seal attachments and page sections. If anyone overwrites, trashes or strips a sealed file, Sentinel Vault puts it back — automatically.',
    feats: ['Overwritten files restored to the sealed version',
            'Trashed attachments come back from the trash',
            'Sealed embeds re-inserted when an edit removes them',
            'Edit requests — approve or deny named editors'],
    shot: 'panel-seals.png', noteTitle: 'Restored, not just flagged',
    noteBody: 'A violation is not a warning — the previous version is re-uploaded and everyone involved is notified.' },
  { eyebrow: '§02 · Approvals', title: 'Approved means<br><em>approved</em>',
    sub: 'Draft → In Review → Approved, with real sign-offs. Approved is an enforced state: edit it without rights and the page snaps back.',
    feats: ['Multi-approver sign-off — everyone, or a quorum you set',
            'Non-approver edits revert or send the page back to Draft',
            'Review dates expire stale Approved pages automatically',
            'Gate Approved behind content rules and AI review'],
    shot: 'workflow.png', noteTitle: 'The state that defends itself',
    noteBody: 'Everyone tracks approvals — Sentinel Vault enforces them. Approve from the console or straight from the page ribbon.' },
  { eyebrow: '§03 · AI validations', title: 'AI review, with<br><em>zero data egress</em>',
    sub: 'Semantic checks against your rules, style guide, tone and compliance — run by Atlassian-hosted Claude via Forge. No API keys, nothing leaves Atlassian.',
    feats: ['Advisory, gate or hard-revert enforcement — your call',
            'Findings ranked by severity, each with a suggested fix',
            'Page author notified with an @mention comment',
            'Off by default, capped by a monthly token budget'],
    shot: 'panel-ai.png', noteTitle: 'Runs on Atlassian',
    noteBody: 'Atlassian-hosted Claude via the Forge LLM API — no external keys, no egress, token use bounded per space.' },
];

async function main() {
  const browser = await chromium.launch();
  await renderScenes(browser);

  const compose = async (tpl, out, w, h, opts = {}, mutate, data) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(path.join(__dirname, tpl)).href, { waitUntil: 'networkidle' });
    if (mutate) await page.evaluate(mutate, data);
    // The ONE authored mark, injected into every [data-brand-mark] slot.
    await page.evaluate((svg) => {
      for (const el of document.querySelectorAll('[data-brand-mark]')) {
        const r = el.getBoundingClientRect();
        el.innerHTML = svg.replace('<svg ', `<svg width="${Math.round(r.width)}" height="${Math.round(r.height)}" `);
      }
    }, MARK_TILE_SVG);
    // Every embedded product shot must actually load — a template pointing at
    // a missing screenshot must fail the render, not ship a broken image.
    await page.waitForFunction(
      () => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
      { timeout: 10000 },
    );
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, out), omitBackground: !!opts.transparent });
    await page.close();
    console.log(`asset       ${out}  ${w}x${h} @2x`);
  };

  await compose('banner.html', 'banner-2x.png', 1120, 548);
  await compose('logo.html', 'logo-2x.png', 144, 144, { transparent: true });
  for (const [i, hd] of HIGHLIGHTS.entries()) {
    await compose('highlight.html', `highlight-${i + 1}-2x.png`, 1840, 900, {}, (d) => {
      document.getElementById('eyebrow').textContent = d.eyebrow;
      document.getElementById('title').innerHTML = d.title;
      document.getElementById('sub').textContent = d.sub;
      document.getElementById('shot').src = `../screenshots/${d.shot}`;
      document.getElementById('noteTitle').textContent = d.noteTitle;
      document.getElementById('noteBody').textContent = d.noteBody;
      document.getElementById('feats').innerHTML = d.feats
        .map((f) => `<div class="feat"><span class="tick">✓</span><span>${f}</span></div>`).join('');
    }, hd);
  }

  await browser.close();
  console.log('\n2x masters rendered. Now derive every exact Marketplace file:');
  console.log('  node static/submission-material/_marketing/derive.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
