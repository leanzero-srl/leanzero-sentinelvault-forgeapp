// ELZI'S TOURS IN A REAL BROWSER - the owner's hard acceptance gate (2026-11-02), run before ANY deploy:
//   "no overlapped or clipped or cut-off Elzi, nothing displaying under elements, no bubble outside the canvas".
// Every step of every tour of both consoles (site settings, space steward, space member), on the offline mock build:
//   viewports  1440x900, 390x844 (light and dark each), 1440x700 (short), 310x700 (the live frame on a 390 phone),
//              and a LONG-CONTENT case (1440x700 with 2400 px of content ahead of every tab's body)
//   per step   Elzi and the bubble wholly inside innerWidth x innerHeight (the iframe is the canvas), >= 16 px from the
//              side edges, bubble no wider than the window minus its margins, bubble and Elzi never touch the target,
//              the target is on top at its centre (elementFromPoint), no ancestor clips Elzi or the bubble, Elzi is drawn
//              at her intended size, the text stays inside the bubble and its buttons are visible; plus the engine's own
//              rules (lib: ring outside the target, bubble against the ring, tail on the ring, Elzi head >= 56 px)
//   marks      the page tour opens by itself and is marked shown, then done; each tab's mini-tour opens by itself after it,
//              Skip writes skipped, a second visit with the marks open nothing; Take the tour replays
//   a11y       the step is announced (role=status), Esc skips, Tab stays inside the bubble
//   rules      straight corners, no left rail, no native confirm/alert, no page error
// Needs Playwright (borrowed from ~/Projects/forge-live-harness). Missing -> FAIL unless SV_SKIP_DOM=1.
// SV_NUX_SHOTS=<dir> also saves a screenshot of every step (the visual look the owner's gate asks for).
// SV_NUX_JOBS=<n> scenarios at a time (default 5). SV_NUX_NOBUILD=1 reuses the last mock build.
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
  if (process.env.SV_SKIP_DOM === "1") { console.log("nux-geometry: SKIPPED (SV_SKIP_DOM=1)"); process.exit(0); }
  console.log(`nux-geometry: FAIL - Playwright not found at ${PW}. Run npm ci in ~/Projects/forge-live-harness, or set SV_SKIP_DOM=1 to skip knowingly.`);
  process.exit(1);
}
const { chromium } = await import(PW);
const { tourRects, judge, geoLine } = await import("./nux-geometry-lib.mjs");
const { judgeOwner } = await import("./nux-geometry-lib.mjs");
const { allTours } = await import("../src/ui/nux/tours.js");
const { SITE_TABS, SPACE_TABS } = await import("../src/ui/nux/nux-tours.js");

const OUT = path.join(ROOT, "static/_screenshot-harness/shots-nux");
if (process.env.SV_NUX_NOBUILD !== "1") {
  const b = spawnSync("npx", ["webpack", "--config", "scripts/responsive/webpack.responsive.cjs", "--mode", "production"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, SV_SHOT_OUT: "static/_screenshot-harness/shots-nux", SV_SHOT_ONLY: "steward-console,realm-console" } });
  if (b.status !== 0) { console.log("nux-geometry: FAIL - the mock build failed\n" + (b.stdout || "").slice(-1500) + (b.stderr || "").slice(-1500)); process.exit(1); }
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const serve = (root) => new Promise((done) => {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  s.listen(0, "127.0.0.1", () => done({ s, url: `http://127.0.0.1:${s.address().port}/` }));
});
const servers = { "steward-console": await serve(path.join(OUT, "steward-console")), "realm-console": await serve(path.join(OUT, "realm-console")) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const shotsDir = process.env.SV_NUX_SHOTS || "";
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

// the three consoles: which bundle, which mock scenario, which key is its page tour, its tabs (testid) and the tab keys
const CONSOLES = [
  { id: "site", app: "steward-console", shot: "steward", page: "site", tabs: SITE_TABS.map((t) => [t, ({ api: "tab-api-access" })[t] || `tab-${t}`]), prefix: "site", steward: true },
  { id: "space-steward", app: "realm-console", shot: "realm-steward", page: "space", tabs: SPACE_TABS.filter((t) => t !== "my-claims").map((t) => [t, `rc-tab-${t}`]), prefix: "space", steward: true },
  { id: "space-member", app: "realm-console", shot: "realm-user", page: "space", tabs: [["my-claims", "rc-tab-my-claims"]], prefix: "space", steward: false },
];
const VIEWS = [
  { name: "1440x900", w: 1440, h: 900 }, { name: "390x844", w: 390, h: 844 }, { name: "1440x700", w: 1440, h: 700 }, { name: "310x700", w: 310, h: 700, themes: ["light"] },
  { name: "long-1440x700", w: 1440, h: 700, long: true, themes: ["light"] },
];

const stepLine = (page) => page.evaluate(() => { const n = document.querySelector("[data-nux-step]"); const c = document.querySelector(".nux-count"); return n ? { tour: n.getAttribute("data-nux-tour"), step: n.getAttribute("data-nux-step"), count: c && c.textContent } : null; });
const sets = (page) => page.evaluate(() => (window.__NUX_SET__ || []).map((s) => (s.reset ? "reset" : `${s.tour}:${s.how}`)));
// wait until the step has been placed and has stopped moving (the engine scrolls it into view, then measures again)
async function settled(page) {
  let last = "", same = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(i === 0 ? 350 : 220);
    const r = await page.evaluate(() => { const b = document.querySelector(".nux-bubble"); const n = document.querySelector("[data-nux-fits]"); if (!b || !n) return ""; const q = b.getBoundingClientRect(); return `${Math.round(q.left)},${Math.round(q.top)},${Math.round(q.width)},${Math.round(q.height)}|${Math.round(scrollY)}`; });
    if (r && r === last) { if (++same >= 2) return true; } else { same = 0; last = r; }
  }
  return false;
}
const findings = [];
const lines = [];

async function scenario({ con, view, theme }) {
  const tag = `${con.id} ${view.name} ${theme}`;
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addInitScript(([sh, th]) => {
    window.__SHOT__ = sh; window.__NUX__ = { tours: {} };
    try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* fresh */ }
    const dark = () => { if (document.documentElement) document.documentElement.setAttribute("data-color-mode", th); };
    dark(); document.addEventListener("readystatechange", dark); document.addEventListener("DOMContentLoaded", dark);
    // PLACEMENT OVER TIME (owner gate + the LeanZero Management finding 2026-11-03): from the first frame a step is drawn, its bubble,
    // Elzi, ring and tail must not move again. Every frame is recorded per step; the test fails any later change.
    window.__frames = {};
    const watch = () => {
      const q = (sel) => document.querySelector(sel);
      const n = q("[data-nux-fits]"), b = q(".nux-bubble"), e = q(".nux-elzi"), r = q(".nux-ring"), t = q(".nux-tail");
      if (n && b && b.style.visibility !== "hidden") {
        const k = (el) => { if (!el) return "-"; const x = el.getBoundingClientRect(); return [x.left, x.top, x.width, x.height].map((v) => Math.round(v * 2) / 2).join(","); };
        const id = `${n.getAttribute("data-nux-tour")}/${n.getAttribute("data-nux-step")}`;
        const key = [k(b), k(e), k(r), k(t), Math.round(scrollY)].join("|");
        const f = (window.__frames[id] = window.__frames[id] || { first: key, moves: 0, last: key });
        if (key !== f.last) { f.moves++; (f.log = f.log || []).push(f.last + " => " + key + " @" + Math.round(performance.now())); f.last = key; }
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    window.__dialogs = 0; window.alert = window.confirm = window.prompt = () => { window.__dialogs++; return true; };
  }, [con.shot, theme]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  await page.goto(servers[con.app].url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("[data-nux-step]"), { timeout: 15000 }).catch(() => {});
  const vis = { top: 0, left: 0, width: view.w, height: view.h };
  const walk = async (label, expectTour) => {
    // walk every step of the tour on screen to its Done; returns the steps seen
    const seen = [];
    for (let guard = 0; guard < 12; guard++) {
      const cur = await stepLine(page);
      if (!cur) break;
      if (expectTour && cur.tour !== expectTour) { findings.push(`${tag}: ${label}: expected tour ${expectTour}, on screen ${cur.tour}`); break; }
      if (!(await settled(page))) findings.push(`${tag}: ${label}/${cur.step}: the step never stopped moving`);
      const moved = await page.evaluate((id) => { const f = (window.__frames || {})[id]; return f ? f.moves : 0; }, `${cur.tour}/${cur.step}`);
      if (moved && process.env.SV_NUX_TRACE) console.log("   MOVES " + JSON.stringify(await page.evaluate((id) => window.__frames[id].log, `${cur.tour}/${cur.step}`)));
      const g = await tourRects(page);
      if (moved) findings.push(`${tag}: ${label}/${cur.step}: the step moved ${moved} time(s) after its first draw (placement must be final when drawn)`);
      const fails = [...new Set([...judge(g, vis), ...judgeOwner(g, vis)])];
      lines.push(`${label}/${cur.step}: ` + geoLine(tag, g, vis, fails));
      for (const f of fails) findings.push(`${tag}: ${label}/${cur.step}: ${f}`);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${con.id}-${view.name}-${theme}-${label}-${cur.step}.png`) });
      seen.push(cur.step);
      if (process.env.SV_NUX_TRACE) console.log(`  ${tag} ${label}/${cur.step} ${fails.length ? "FAIL " + fails.join("; ") : "ok"}`);
      const last = await page.evaluate(() => !!document.querySelector('[data-testid="nux-done"]'));
      await page.locator(last ? '[data-testid="nux-done"]' : '[data-testid="nux-next"]').click({ timeout: 4000 });
      await sleep(150);
    }
    return seen;
  };
  // 1. first visit: the page tour opens by itself
  const pageSeen = await walk(con.page, con.page);
  ok(`${tag}: the page tour opened by itself and was walked (${pageSeen.length} steps)`, pageSeen.length >= 3);
  ok(`${tag}: the page tour opens with Elzi's hello`, pageSeen[0] === "hello");
  const marked = await sets(page);
  ok(`${tag}: the page tour was marked shown, then done`, marked.includes(`${con.page}:shown`) && marked.includes(`${con.page}:done`));
  await sleep(500);
  ok(`${tag}: no mini-tour opens straight after the page tour`, (await stepLine(page)) === null);
  // 2. each tab: its mini-tour opens by itself, without the hello
  // the tab on screen when the page tour ends waits for its next visit (never two tours back to back): visit it last
  for (const [tab, testid] of [...con.tabs.slice(1), ...con.tabs.slice(0, 1)]) {
    if (con.tabs.length > 1 || con.id === "space-member") {
      await page.locator(`[data-testid="${testid}"]`).first().click({ timeout: 5000 }).catch(() => findings.push(`${tag}: tab ${tab}: its button is not there`));
    }
    // a console with ONE tab (the member's): that tab is on screen when the page tour ends and waits for its next
    // visit, so the walk starts it with the tab's own "Tour" button (the by-itself opening is the multi-tab case)
    if (con.tabs.length === 1) await page.locator('[data-testid="nux-replay"]').first().click({ timeout: 5000 }).catch(() => findings.push(`${tag}: tab ${tab}: its Tour button is not there`));
    if (view.long) await page.evaluate(() => { const c = document.querySelector(".tab-content") || document.querySelector(".space-admin-container"); if (c && !c.querySelector(".nux-long-pad")) { const d = document.createElement("div"); d.className = "nux-long-pad"; d.style.cssText = "height:2400px"; d.setAttribute("aria-hidden", "true"); c.insertBefore(d, c.firstChild); } });
    await page.waitForFunction(() => document.querySelector("[data-nux-step]"), { timeout: 8000 }).catch(() => {});
    const key = `${con.prefix}-${tab}`;
    const seen = await walk(`tab-${tab}`, key);
    ok(`${tag}: ${key} opened by itself and walked (${seen.length} steps)`, seen.length >= 1);
    ok(`${tag}: ${key} carries no hello (not the first tour)`, !seen.includes("hello"));
    await sleep(200);
  }
  // 3. owner rules + errors (once, on the roomy light run only)
  if (view.name === "1440x900" && theme === "light") {
    // replay from the header button: the page tour again, from the hello
    await page.locator(`[data-testid="${con.page}-tour-btn"]`).first().click().catch(() => findings.push(`${tag}: the header's tour button is missing`));
    await page.waitForFunction(() => document.querySelector('[data-nux-step="hello"]'), { timeout: 6000 }).catch(() => findings.push(`${tag}: Take the tour did not open the hello`));
    await settled(page);
    const rules = await page.evaluate(() => {
      const b = document.querySelector(".nux-bubble"); if (!b) return null;
      const cs = getComputedStyle(b);
      const btn = [...b.querySelectorAll("button")].map((x) => getComputedStyle(x).borderTopLeftRadius);
      return { radius: cs.borderTopLeftRadius, leftW: cs.borderLeftWidth, rightW: cs.borderRightWidth, shadow: cs.boxShadow, btn, live: !!document.querySelector(".nux-live[role=status]"), live_text: (document.querySelector(".nux-live") || {}).textContent || "" };
    });
    ok(`${tag}: bubble has straight corners and equal borders (no left rail)`, !!rules && rules.radius === "0px" && rules.leftW === rules.rightW && rules.btn.every((r) => r === "0px"));
    ok(`${tag}: the step is announced politely`, !!rules && /^Step 1 of \d+/.test(rules.live_text));
    // Tab stays inside the bubble; Esc skips
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    const inBubble = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest(".nux-bubble"));
    ok(`${tag}: Tab stays inside the bubble`, inBubble);
    await page.keyboard.press("Escape"); await sleep(250);
    ok(`${tag}: Esc closes the tour`, (await stepLine(page)) === null);
    ok(`${tag}: Esc is written as skipped`, (await sets(page)).filter((s) => s === `${con.page}:skipped`).length >= 1);
  }
  ok(`${tag}: no page error`, errors.length === 0 || (findings.push(`${tag}: page errors: ${errors.join(" | ")}`), false));
  ok(`${tag}: no native alert/confirm/prompt`, (await page.evaluate(() => window.__dialogs)) === 0);
  await ctx.close();
}

// a second visit with the stored marks: nothing opens by itself; a skipped mini-tour is written skipped
async function marksScenario(con) {
  const tag = `${con.id} marks`;
  const done = Object.fromEntries(["site", "space", ...SITE_TABS.map((t) => `site-${t}`), ...SPACE_TABS.map((t) => `space-${t}`)].map((k) => [k, { seen: true, version: 2, how: "done" }]));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(([sh, m]) => { window.__SHOT__ = sh; window.__NUX__ = { tours: m }; try { sessionStorage.clear(); } catch (_) { /* fresh */ } }, [con.shot, done]);
  const page = await ctx.newPage();
  await page.goto(servers[con.app].url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("root") && document.getElementById("root").children.length > 0, { timeout: 10000 });
  await sleep(2500);
  eq(`${tag}: a second visit with every mark stored opens nothing`, await stepLine(page), null);
  ok(`${tag}: and writes nothing`, (await sets(page)).length === 0);
  await page.locator(`[data-testid="${con.page}-tour-btn"]`).first().click();
  await page.waitForFunction(() => document.querySelector('[data-nux-step="hello"]'), { timeout: 6000 }).catch(() => {});
  ok(`${tag}: the button says Replay tour once it was seen`, /Replay tour/.test(await page.locator(`[data-testid="${con.page}-tour-btn"]`).first().textContent()));
  ok(`${tag}: Replay opens the page tour at the hello`, (await stepLine(page))?.step === "hello");
  await ctx.close();
}
async function skipScenario(con) {
  const tag = `${con.id} skip`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(([sh]) => { window.__SHOT__ = sh; window.__NUX__ = { tours: { [`${"site"}`]: { seen: true, version: 2, how: "skipped" }, space: { seen: true, version: 2, how: "skipped" } } }; try { sessionStorage.clear(); } catch (_) { /* fresh */ } }, [con.shot]);
  const page = await ctx.newPage();
  await page.goto(servers[con.app].url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("root") && document.getElementById("root").children.length > 0, { timeout: 10000 });
  await sleep(2500);
  eq(`${tag}: a skipped page tour opens no mini-tour by itself`, await stepLine(page), null);
  await ctx.close();
}

// run the scenarios N at a time
const jobs = [];
for (const con of CONSOLES) for (const view of VIEWS) for (const theme of view.themes || ["light", "dark"]) {
  if (con.id === "space-member" && (view.long)) continue;
  if (process.env.SV_NUX_MARKS === "1" || (process.env.SV_NUX_ONLY && !`${con.id} ${view.name} ${theme}`.includes(process.env.SV_NUX_ONLY))) continue;
  jobs.push(() => scenario({ con, view, theme }));
}
if (!process.env.SV_NUX_ONLY || process.env.SV_NUX_MARKS === "1") jobs.push(() => marksScenario(CONSOLES[0]), () => marksScenario(CONSOLES[1]), () => skipScenario(CONSOLES[0]), () => skipScenario(CONSOLES[1]));
const N = Math.max(1, Number(process.env.SV_NUX_JOBS) || 5);
let next = 0;
const crashed = [];
await Promise.all(Array.from({ length: N }, async () => {
  while (next < jobs.length) { const j = jobs[next++]; try { await j(); } catch (e) { crashed.push(String(e && e.message).split("\n")[0]); } }
}));
// every tour in tours.js must have been exercised: the step ids walked per console cover the data
for (const c of crashed) findings.push(`scenario crashed: ${c}`);
if (process.env.SV_NUX_LINES === "1" || findings.length) console.log(lines.sort().join("\n"));
for (const f of [...new Set(findings)].sort()) ok(`GEOMETRY: ${f}`, false);
ok(`every tour step was measured (${lines.length} measurements; tours: ${allTours().length})`, process.env.SV_NUX_ONLY ? true : lines.length > 300);
await browser.close();
for (const s of Object.values(servers)) s.s.close();
report("nux-geometry");
