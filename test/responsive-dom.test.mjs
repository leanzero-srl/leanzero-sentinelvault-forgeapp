// COMPUTED layout gates (2026-10-07, round 2 of the responsive pass). responsive-css.test.mjs reads
// the sheets; this file renders the real surfaces (the offline mock build, scripts/responsive/) in
// Chromium and measures what a person would see. It exists because round 1's static check passed
// while the shipped page was broken: the ≤640 px reset was in the sheet, just in the wrong order
// (BR-01), and nothing measured a row. Each block names the finding it guards:
//
//   BR-01  no flex child carries blank space from a px basis that turned into a height (every
//          stacked settings row on a phone was 260 px for 40-100 px of text)
//   BR-02  no control moves between pointerdown and pointerup (the reminder's gap moved the new
//          rule's picker and × mid-press and the click was lost, mouse included)
//   BR-03  the "Not applied yet" reminder covers no control and no line of text
//   BR-04  a desktop card whose name fits beside its actions stays on ONE line
//   BN-01  the seal-duration menu opens where it can be seen, inside the scrolling body
//   BN-02  the pinned seal form sits on the scrollport's edge and keyboard focus never lands under it
//
// Needs Playwright (borrowed from ~/Projects/forge-live-harness, like scripts/responsive/capture.mjs).
// Missing → FAIL, unless SV_SKIP_DOM=1 says to skip it knowingly. SV_DOM_NOBUILD=1 reuses the last
// mock build (static/_screenshot-harness/shots-responsive, gitignored, never deployed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PW = path.join(os.homedir(), "Projects/forge-live-harness/node_modules/playwright/index.mjs");
if (!fs.existsSync(PW)) {
  if (process.env.SV_SKIP_DOM === "1") { console.log("responsive-dom: SKIPPED (SV_SKIP_DOM=1)"); process.exit(0); }
  console.log(`responsive-dom: FAIL — Playwright not found at ${PW}. Run npm ci in ~/Projects/forge-live-harness, or set SV_SKIP_DOM=1 to skip these gates knowingly.`);
  process.exit(1);
}
const { chromium } = await import(PW);

// SV_DOM_BUNDLES=<dir> runs the gates against another build (a mutation check: the pre-fix build
// must FAIL them — a gate that passes on the bug it names guards nothing).
const BUNDLES = process.env.SV_DOM_BUNDLES || path.join(ROOT, "static/_screenshot-harness/shots-responsive");
if (process.env.SV_DOM_NOBUILD !== "1" && !process.env.SV_DOM_BUNDLES) {
  const b = spawnSync("npx", ["webpack", "--config", "scripts/responsive/webpack.responsive.cjs", "--mode", "production"], { cwd: ROOT, encoding: "utf8" });
  if (b.status !== 0) { console.log("responsive-dom: FAIL — the mock build failed\n" + (b.stdout || "").slice(-2000) + (b.stderr || "").slice(-2000)); process.exit(1); }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((done) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      if (p === "/__phone.html") { // a page that frames the surface the way Confluence does (same origin)
        // Live phone-360/390 (2026-10-07): Confluence puts the frame 32 px in from the screen's left
        // edge, so the part of a 636 px frame on a 360 px screen is 0-328, not 0-360.
        const q = new URL(req.url, "http://x").searchParams;
        const w = Number(q.get("w")) || 620, x = Number(q.get("x") ?? 32);
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<html><body style="margin:0;padding:48px 0 0 ${x}px;width:${w + 48}px"><iframe id="f" src="/index.html" style="border:0;display:block;width:${w}px;height:900px"></iframe><div style="height:400px"></div></body></html>`);
      }
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => done({ s, url: `http://127.0.0.1:${s.address().port}/` }));
  });
}
const servers = {};
const urlOf = async (app) => { if (!servers[app]) servers[app] = await serve(path.join(BUNDLES, app)); return servers[app].url; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
// The consoles run in CONTENT-TALL frames: Confluence sizes the iframe to the document, and the page
// around it scrolls — the frame itself never does. A fixed element (the Apply bar, the reminder) is
// therefore fixed to the DOCUMENT. Offline, a 900 px viewport over a 3,000 px document would scroll
// content under them, which never happens live; so console scenarios size the viewport to the
// document before every measurement (the trap noted in scripts/responsive/capture.mjs).
async function fitFrame(page, minH = 900) {
  const w = page.viewportSize().width;
  for (let i = 0; i < 2; i++) {
    const H = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    const want = Math.min(Math.max(H, minH), 12000);
    if (want === page.viewportSize().height) break;
    await page.setViewportSize({ width: w, height: want });
    await sleep(250);
  }
}
async function open(app, shot, w, h, { touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce", hasTouch: touch });
  await ctx.addInitScript((sh) => { window.__SHOT__ = sh; try { localStorage.clear(); } catch (_) { /* fresh */ } }, shot);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  await page.goto(await urlOf(app), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const r = document.getElementById("root"); return r && r.children.length > 0; }, { timeout: 10000 });
  await sleep(1200);
  return { ctx, page, errors };
}

// ── in-page measurements ────────────────────────────────────────────────────────────────────────
const CONTROL = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], [role="menu"], [tabindex]:not([tabindex="-1"])';

/** BR-01: flex children of a column box that are taller than their content because of a px basis. */
const blankUnderContent = (page) => page.evaluate(() => {
  const bad = [];
  const contentSpan = (el) => {
    let top = Infinity, bottom = -Infinity;
    for (const k of el.children) {
      const kr = k.getBoundingClientRect();
      if (!kr.height) continue;
      const km = getComputedStyle(k);
      top = Math.min(top, kr.top - parseFloat(km.marginTop || 0));
      bottom = Math.max(bottom, kr.bottom + parseFloat(km.marginBottom || 0));
    }
    if (!(bottom > top)) { const r = document.createRange(); r.selectNodeContents(el); const rr = r.getBoundingClientRect(); top = rr.top; bottom = rr.bottom; }
    return bottom > top ? bottom - top : 0;
  };
  for (const el of document.querySelectorAll("body *")) {
    const p = el.parentElement;
    if (!p) continue;
    const ps = getComputedStyle(p);
    if (!/flex/.test(ps.display) || !ps.flexDirection.startsWith("column")) continue;
    const cs = getComputedStyle(el);
    if (!/px$/.test(cs.flexBasis) || !(parseFloat(cs.flexBasis) > 0)) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    const inner = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    const blank = inner - contentSpan(el);
    if (blank > 4) bad.push(`${String(el.className).slice(0, 40) || el.tagName}: ${Math.round(blank)} px blank (flex-basis ${cs.flexBasis})`);
  }
  // …and the row the breaker measured, whatever its basis.
  for (const el of document.querySelectorAll(".settings-row-info")) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    const blank = r.height - contentSpan(el);
    if (blank > 4) bad.push(`settings-row-info: ${Math.round(blank)} px blank`);
  }
  return [...new Set(bad)];
});

/** BR-03: what the reminder covers. */
const floatCovers = (page) => page.evaluate((CONTROL) => {
  const fl = document.querySelector(".sv-unsaved-float");
  if (!fl || getComputedStyle(fl).visibility === "hidden") return null;
  const f = fl.getBoundingClientRect();
  const hit = (r) => r.width > 0 && r.height > 0 && r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
  const controls = [];
  for (const el of document.querySelectorAll(CONTROL)) if (!fl.contains(el) && hit(el.getBoundingClientRect())) controls.push((el.innerText || el.getAttribute("aria-label") || el.className || el.tagName).toString().slice(0, 30));
  const text = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.nodeValue.trim() || fl.contains(n.parentNode)) continue;
    range.selectNodeContents(n);
    if ([...range.getClientRects()].some(hit)) text.push(n.nodeValue.trim().slice(0, 30));
  }
  return { spot: fl.dataset.spot, controls, text, rect: [Math.round(f.left), Math.round(f.top), Math.round(f.width), Math.round(f.height)] };
}, CONTROL);

/** BR-02: press a control with the mouse; did it move between down and up? */
async function press(page, loc, { tall = true } = {}) {
  if (tall) await fitFrame(page);
  await loc.scrollIntoViewIfNeeded();
  await sleep(100);
  const a = await loc.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await sleep(120);
  const b = await loc.boundingBox();
  await page.mouse.up();
  await sleep(350);
  const moved = !b || Math.abs(b.x - a.x) > 1 || Math.abs(b.y - a.y) > 1;
  return { moved, from: Math.round(a.y), to: b ? Math.round(b.y) : null };
}

const checkFloat = async (page, label) => {
  const c = await floatCovers(page);
  if (!c) return;
  ok(`BR-03 ${label}: the reminder found a clear spot (${c.spot} ${JSON.stringify(c.rect)})`, /^clear/.test(c.spot));
  eq(`BR-03 ${label}: the reminder covers no control`, c.controls, []);
  eq(`BR-03 ${label}: the reminder covers no text`, c.text, []);
};

// ── BR-01: stacked settings rows carry no blank space (and nothing else does) ──────────────────
const PANELS = [
  { app: "steward-console", shot: "steward", tab: null, name: "site settings" },
  { app: "steward-console", shot: "steward", tab: '[data-testid="tab-validations"]', name: "site validations" },
  { app: "realm-console", shot: "realm-steward", tab: '.tab-navigation .tab-button:has-text("Seal Duration")', name: "space seal duration" },
  { app: "realm-console", shot: "realm-steward", tab: '.tab-navigation .tab-button:has-text("Macro")', name: "space macro" },
  { app: "realm-console", shot: "realm-steward", tab: '.tab-navigation .tab-button:has-text("Validations")', name: "space validations" },
  { app: "realm-console", shot: "realm-steward", tab: '.tab-navigation .tab-button:has-text("Access Control")', name: "space access" },
];
for (const app of ["steward-console", "realm-console"]) {
  const panels = PANELS.filter((p) => p.app === app);
  const { ctx, page, errors } = await open(app, panels[0].shot, 994, 900);
  for (const w of [620, 636, 664, 754, 834, 994, 1474]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of panels) {
      await page.locator(p.tab || '[data-testid="tab-settings"]').first().click();
      await sleep(500);
      await fitFrame(page);
      eq(`BR-01 ${p.name} @${w}: no flex child holds blank space from a px basis`, await blankUnderContent(page), []);
    }
  }
  eq(`${app}: no page errors`, errors, []);
  await ctx.close();
}

// ── BR-02 + BR-03 on a settings list: six toggles in a row, each by mouse ───────────────────────
for (const w of [636, 834, 994, 1474]) {
  const { ctx, page } = await open("steward-console", "steward", w, 900);
  const sw = page.locator('.settings-row .settings-row-control input[type="checkbox"]:not(:disabled)');
  const n = Math.min(6, await sw.count());
  ok(`site settings @${w}: toggles to press`, n >= 4);
  for (let i = 0; i < n; i++) {
    const el = sw.nth(i);
    const before = await el.isChecked();
    const r = await press(page, el);
    ok(`BR-02 site settings @${w} toggle #${i}: did not move during the press (${r.from}→${r.to})`, !r.moved);
    eq(`BR-02 site settings @${w} toggle #${i}: the press toggled it`, await el.isChecked(), !before);
    await checkFloat(page, `site settings @${w} after toggle #${i}`);
  }
  await ctx.close();
}

// ── BR-02 + BR-03 on the Validations editors: modes, + Add rule, the new rule's picker and × ────
for (const [app, shot, tab, name] of [
  ["realm-console", "realm-steward", '.tab-navigation .tab-button:has-text("Validations")', "space validations"],
  ["steward-console", "steward", '[data-testid="tab-validations"]', "site validations"],
]) {
  for (const w of [620, 754, 834, 850, 994]) {
    const { ctx, page } = await open(app, shot, w, 900);
    await page.locator(tab).first().click();
    await sleep(800);
    const modes = page.locator('.val-modes input[type="checkbox"]');
    for (let i = 0; i < Math.min(3, await modes.count()); i++) {
      const before = await modes.nth(i).isChecked();
      const r = await press(page, modes.nth(i));
      ok(`BR-02 ${name} @${w} mode #${i}: still under the pointer (${r.from}→${r.to})`, !r.moved);
      eq(`BR-02 ${name} @${w} mode #${i}: toggled`, await modes.nth(i).isChecked(), !before);
      await checkFloat(page, `${name} @${w} after mode #${i}`);
    }
    const cards = page.locator(".val-rule-card");
    const n0 = await cards.count();
    const ra = await press(page, page.locator("button", { hasText: "+ Add rule" }).first());
    ok(`BR-02 ${name} @${w} + Add rule: still under the pointer`, !ra.moved);
    eq(`BR-02 ${name} @${w} + Add rule: added a rule`, await cards.count(), n0 + 1);
    await checkFloat(page, `${name} @${w} after + Add rule`);
    for (const which of ["first", "last"]) {
      const card = which === "first" ? cards.first() : cards.last();
      const picker = card.locator(".mini-select-value").first();
      const rp = await press(page, picker);
      ok(`BR-02 ${name} @${w} ${which} rule's type picker: did not move (${rp.from}→${rp.to})`, !rp.moved);
      eq(`BR-02 ${name} @${w} ${which} rule's type picker: one press opened it`, await card.locator(".mini-select-menu").count(), 1);
      await page.keyboard.press("Escape");
      await press(page, picker); // close it again
      await sleep(250);
    }
    const n1 = await cards.count();
    const rx = await press(page, cards.last().locator(".val-rule-remove"));
    ok(`BR-02 ${name} @${w} the new rule's ×: did not move (${rx.from}→${rx.to})`, !rx.moved);
    eq(`BR-02 ${name} @${w} the new rule's ×: one press removed it`, await cards.count(), n1 - 1);
    await checkFloat(page, `${name} @${w} after ×`);
    await ctx.close();
  }
}

// ── Phones, as Confluence builds them: the console is a 620/636 px CONTENT-TALL iframe inside a
// 360/390 px screen (Confluence keeps a 700 px minimum content width), so only part of the frame is
// on screen and the reminder must fit that part. The round-2 live probe found the 56 px compact
// form fit nowhere there and fell back to covering text; this scene would have caught it. ────────
async function openFramed(app, shot, frameW, vw, vh) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce" });
  await ctx.addInitScript((sh) => { window.__SHOT__ = sh; try { localStorage.clear(); } catch (_) { /* fresh */ } }, shot);
  const page = await ctx.newPage();
  await page.goto(`${await urlOf(app)}__phone.html?w=${frameW}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const f = document.getElementById("f"); const d = f && f.contentDocument; const r = d && d.getElementById("root"); return r && r.children.length > 0; }, { timeout: 10000 });
  await sleep(1200);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const fit = async () => { const H = await frame.evaluate(() => document.documentElement.scrollHeight); await page.evaluate((h) => { document.getElementById("f").style.height = `${h}px`; }, H); await sleep(150); };
  await fit();
  return { ctx, page, frame, fit, F: page.frameLocator("#f") };
}
async function pressIn(page, fit, loc) {
  await fit();
  await loc.scrollIntoViewIfNeeded();
  await sleep(100);
  const a = await loc.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await sleep(120);
  const b = await loc.boundingBox();
  await page.mouse.up();
  await sleep(350);
  return { moved: !b || Math.abs(b.x - a.x) > 1 || Math.abs(b.y - a.y) > 1, from: Math.round(a.y), to: b ? Math.round(b.y) : null };
}
const checkFloatIn = async (frame, label) => {
  const c = await floatCovers(frame);
  ok(`BR-03 ${label}: the reminder is shown`, !!c);
  if (!c) return;
  ok(`BR-03 ${label}: the reminder found a clear spot (${c.spot} ${JSON.stringify(c.rect)})`, /^clear/.test(c.spot));
  eq(`BR-03 ${label}: the reminder covers no control`, c.controls, []);
  eq(`BR-03 ${label}: the reminder covers no text`, c.text, []);
  const band = await frame.evaluate(() => { const r = document.querySelector(".sv-unsaved-float").getBoundingClientRect(); return { left: r.left, right: r.right }; });
  ok(`BR-03 ${label}: the reminder is inside the part of the frame on screen`, band.left >= 0 && band.right <= 999);
};
for (const [vw, vh] of [[360, 780], [390, 844]]) {
  {
    const { ctx, page, frame, fit, F } = await openFramed("steward-console", "steward", 636, vw, vh);
    const sw = F.locator('.settings-row .settings-row-control input[type="checkbox"]:not(:disabled)');
    const n = Math.min(8, await sw.count());
    for (let i = 0; i < n; i++) {
      const before = await sw.nth(i).isChecked();
      const r = await pressIn(page, fit, sw.nth(i));
      ok(`BR-02 phone ${vw} site settings toggle #${i}: did not move during the press`, !r.moved);
      eq(`BR-02 phone ${vw} site settings toggle #${i}: toggled`, await sw.nth(i).isChecked(), !before);
      await checkFloatIn(frame, `phone ${vw} site settings toggle #${i}`);
      const onScreen = await page.evaluate(() => { const f = document.getElementById("f").getBoundingClientRect(); const d = document.getElementById("f").contentDocument.querySelector(".sv-unsaved-float"); if (!d) return null; const r = d.getBoundingClientRect(); return { left: f.left + r.left, right: f.left + r.right, w: innerWidth }; });
      ok(`BR-03 phone ${vw} site settings toggle #${i}: the reminder is on the phone's screen (${onScreen && Math.round(onScreen.left)}-${onScreen && Math.round(onScreen.right)} of ${vw})`, !!onScreen && onScreen.left >= 0 && onScreen.right <= onScreen.w);
    }
    await ctx.close();
  }
  {
    const { ctx, page, frame, fit, F } = await openFramed("realm-console", "realm-steward", 620, vw, vh);
    await F.locator('.tab-navigation .tab-button:has-text("Validations")').first().click();
    await sleep(700);
    const modes = F.locator('.val-modes input[type="checkbox"]');
    for (let i = 0; i < 3; i++) {
      const before = await modes.nth(i).isChecked();
      const r = await pressIn(page, fit, modes.nth(i));
      ok(`BR-02 phone ${vw} space validations mode #${i}: did not move`, !r.moved);
      eq(`BR-02 phone ${vw} space validations mode #${i}: toggled`, await modes.nth(i).isChecked(), !before);
      await checkFloatIn(frame, `phone ${vw} space validations mode #${i}`);
    }
    const cards = F.locator(".val-rule-card");
    const n0 = await cards.count();
    const ra = await pressIn(page, fit, F.locator("button", { hasText: "+ Add rule" }).first());
    ok(`BR-02 phone ${vw} + Add rule: did not move`, !ra.moved);
    eq(`BR-02 phone ${vw} + Add rule: added`, await cards.count(), n0 + 1);
    await checkFloatIn(frame, `phone ${vw} after + Add rule`);
    const rp = await pressIn(page, fit, cards.last().locator(".mini-select-value").first());
    ok(`BR-02 phone ${vw} the new rule's type picker: did not move`, !rp.moved);
    eq(`BR-02 phone ${vw} the new rule's type picker: one press opened it`, await cards.last().locator(".mini-select-menu").count(), 1);
    await pressIn(page, fit, cards.last().locator(".mini-select-value").first());
    const rx = await pressIn(page, fit, cards.last().locator(".val-rule-remove"));
    ok(`BR-02 phone ${vw} the new rule's ×: did not move`, !rx.moved);
    eq(`BR-02 phone ${vw} the new rule's ×: removed it`, await cards.count(), n0);
    await ctx.close();
  }
}

// ── BR-04: a card whose name fits beside its actions stays on one line (desktop density) ───────
const cardLines = (page) => page.evaluate(() => [...document.querySelectorAll(".artifact-card")].map((c) => {
  const row = c.querySelector(".card-row-primary");
  const name = row?.querySelector(":scope > .card-filename");
  const right = row?.querySelector(":scope > .card-row-right");
  const text = name?.querySelector(".card-filename-text");
  if (!row || !name || !right || !text) return null;
  const nameNeed = name.scrollWidth - text.clientWidth + text.scrollWidth; // the name's full width
  const rs = getComputedStyle(row);
  const room = row.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight);
  const gap = parseFloat(rs.columnGap) || 0;
  const fits = nameNeed + gap + right.getBoundingClientRect().width <= room; // the name's own width, no floor
  const oneLine = Math.abs(name.getBoundingClientRect().top - right.getBoundingClientRect().top) < 12;
  const truncated = text.scrollWidth > text.clientWidth + 1;
  return { title: text.textContent.slice(0, 40), fits, oneLine, truncated, nameNeed, room };
}).filter(Boolean));
for (const [app, shot, w, h, name] of [
  ["overlay", "overlay", 1320, 900, "attachments view @1320 (1440 laptop)"],
  ["overlay", "overlay", 1160, 800, "attachments view @1160 (1280 laptop)"],
  ["overlay", "overlay", 1800, 960, "attachments view @1800 (1920)"],
  ["inline-panel", "panel", 760, 1400, "page panel @760"],
  ["realm-console", "realm-steward", 994, 900, "space console cards @994"],
]) {
  const { ctx, page } = await open(app, shot, w, h);
  const cards = await cardLines(page);
  ok(`BR-04 ${name}: cards measured`, cards.length >= 3);
  eq(`BR-04 ${name}: every card whose name fits beside its actions is on one line`, cards.filter((c) => c.fits && !c.oneLine).map((c) => c.title), []);
  eq(`BR-04 ${name}: a card that wraps does so to show its whole name (none truncated that fit the card)`, cards.filter((c) => !c.oneLine && c.truncated && c.nameNeed <= c.room).map((c) => c.title), []);
  await ctx.close();
}

// ── BN-01 / BN-02: Seal attachments with files ticked ─────────────────────────────────────────────
for (const [w, h] of [[800, 720], [430, 720], [390, 720]]) {
  const { ctx, page } = await open("page-details", "pd-seal", w, h, { touch: w < 500 });
  const boxes = page.locator('[data-testid="pd-attachment-check"]:not(:disabled)');
  await boxes.nth(0).click(); await boxes.nth(1).click();
  await sleep(400);
  const geo = () => page.evaluate(() => {
    const body = document.querySelector(".pd-body"); const form = document.querySelector('[data-testid="pd-seal-form"]');
    const b = body.getBoundingClientRect(); const f = form.getBoundingClientRect();
    return { scrollable: body.scrollHeight > body.clientHeight + 4, bodyBottom: b.bottom - parseFloat(getComputedStyle(body).borderBottomWidth || 0), formBottom: f.bottom, pinned: form.classList.contains("is-pinned"), max: body.scrollHeight - body.clientHeight };
  });
  const g = await geo();
  ok(`BN-02 seal @${w}x${h}: the list scrolls under the pinned form (precondition)`, g.pinned && g.scrollable);
  for (const frac of [0, 0.5]) {
    await page.evaluate((f) => { const b = document.querySelector(".pd-body"); b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) * f); }, frac);
    await sleep(200);
    const gg = await geo();
    ok(`BN-02 seal @${w}x${h} scrolled ${frac * 100}%: the pinned form sits on the body's bottom edge (gap ${Math.round(gg.bodyBottom - gg.formBottom)} px)`, Math.abs(gg.bodyBottom - gg.formBottom) <= 1);
    await page.locator('[data-testid="pd-duration"]').click();
    await sleep(500);
    const vis = await page.evaluate(() => {
      const m = document.querySelector('[role="listbox"][aria-label="Seal duration"]'); const body = document.querySelector(".pd-body");
      if (!m) return null;
      const r = m.getBoundingClientRect(); const b = body.getBoundingClientRect();
      const top = Math.max(r.top, b.top), bottom = Math.min(r.bottom, b.bottom);
      return { shown: Math.max(0, bottom - top), height: r.height, opacity: getComputedStyle(m).opacity };
    });
    ok(`BN-01 seal @${w}x${h} scrolled ${frac * 100}%: the duration menu opened`, !!vis && vis.opacity === "1");
    ok(`BN-01 seal @${w}x${h} scrolled ${frac * 100}%: all of it is inside the visible body (${vis && Math.round(vis.shown)} of ${vis && Math.round(vis.height)} px)`, !!vis && vis.shown >= vis.height - 1);
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="pd-duration"]').click().catch(() => {});
    await sleep(200);
    if (await page.locator('[role="listbox"][aria-label="Seal duration"]').count()) { await page.locator('[data-testid="pd-duration"]').click(); await sleep(200); }
  }
  // A row's ⋯ just above the pinned form (the same class as BN-01): its menu opens where it is seen.
  const kebabs = page.locator('[data-testid="pd-kebab"]');
  if (await kebabs.count()) {
    await page.evaluate(() => {
      const body = document.querySelector(".pd-body"); const ks = body.querySelectorAll('[data-testid="pd-kebab"]');
      const k = ks[ks.length - 1]; const form = document.querySelector('[data-testid="pd-seal-form"]');
      body.scrollTop += k.getBoundingClientRect().bottom - (form.getBoundingClientRect().top - 6);
    });
    await sleep(200);
    await kebabs.last().click();
    await sleep(500);
    const km = await page.evaluate(() => {
      const m = document.querySelector(".pd-kebab-wrap .pd-menu"); const b = document.querySelector(".pd-body").getBoundingClientRect();
      if (!m) return null; const r = m.getBoundingClientRect();
      return { shown: Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)), height: r.height };
    });
    ok(`BN-01 seal @${w}x${h}: the last row's ⋯ menu opens fully inside the body (${km && Math.round(km.shown)} of ${km && Math.round(km.height)} px)`, !!km && km.shown >= km.height - 1);
    await page.keyboard.press("Escape");
    await sleep(200);
  }
  // Keyboard: Tab from the top through the list — no focused control may sit under the pinned form.
  await page.evaluate(() => { document.querySelector(".pd-body").scrollTop = 0; document.querySelector('[data-testid="pd-select-all"]').focus(); });
  let under = 0, stops = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const a = document.activeElement; const form = document.querySelector('[data-testid="pd-seal-form"]');
      if (!a || !form || form.contains(a) || !document.querySelector(".pd-body").contains(a)) return null;
      const r = a.getBoundingClientRect(); const f = form.getBoundingClientRect();
      return r.bottom > f.top + 1 && r.top < f.bottom;
    });
    if (s === null) continue;
    stops++; if (s) under++;
  }
  ok(`BN-02 seal @${w}x${h}: Tab visited list controls`, stops >= 5);
  eq(`BN-02 seal @${w}x${h}: focus never landed under the pinned form`, under, 0);
  await ctx.close();
}

await browser.close();
for (const k of Object.keys(servers)) servers[k].s.close();
report("responsive-dom");
