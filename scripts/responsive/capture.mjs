// Responsive baseline capture (2026-10-07): every surface the responsive lane touches, at the
// frame widths Confluence actually hands the app, with the mock bridge (bridge.js) and a FIXED
// clock, so two runs of the same bundle paint the same pixels. Used to prove desktop is unchanged
// (or changed on purpose) by a CSS/JSX change: capture → change → capture → diff.py.
//
//   npx webpack --config scripts/responsive/webpack.responsive.cjs --mode production
//   node scripts/responsive/capture.mjs --out <dir> [--set desktop|narrow|all]
//        [--only <scenario-substring>] [--theme light|dark|both]
//   python3 scripts/responsive/diff.py <before-dir> <after-dir> <diff-dir>
//
// The bundles (mock @forge/bridge = scripts/responsive/bridge-mock.js) go to the gitignored,
// never-deployed static/_screenshot-harness/shots-responsive/. Playwright comes from
// ~/Projects/forge-live-harness (this repo has no browser dependency). Media belongs on the
// AI-workhorse SSD (/Volumes/AI-workhorse/media/device-matrix/...) when it is mounted.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
const { chromium } = await import(path.join(os.homedir(), "Projects/forge-live-harness/node_modules/playwright/index.mjs"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out"); if (!OUT) { console.error("--out <dir> required"); process.exit(2); }
const SET = arg("set", "desktop");
const ONLY = arg("only", "");
const THEMES = arg("theme", "both") === "both" ? ["light", "dark"] : [arg("theme")];
const NOW = Date.parse("2026-10-07T10:00:00.000Z");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
}

// Frame widths (CSS px) Confluence gives each surface. Desktop: the 1280 laptop frame (834 for a
// space page), 1440 (994), the 1040/1120/1520/2160 frames the lane brief names, 1920 (1474).
const CONSOLE_DESKTOP = [834, 994, 1040, 1120, 1474, 1520, 2160];
const CONSOLE_NARROW = [310, 620, 636, 664, 754, 794];
const click = (sel) => async (p) => { await p.locator(sel).first().click({ timeout: 5000 }); await sleep(700); };
const tab = (text) => click(`.tab-navigation .tab-button:has-text("${text}")`);
const steps = (...fns) => async (p) => { for (const f of fns) await f(p); };

const S = [
  // space console (steward)
  { id: "realm-sealed", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW },
  { id: "realm-force-reason", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: click(".artifact-card .card-row-primary .action-btn.unlock") },
  { id: "realm-access", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Access Control") },
  { id: "realm-duration", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Seal Duration") },
  { id: "realm-macro", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Macro") },
  { id: "realm-validations", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Validations") },
  { id: "realm-validations-add", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: steps(tab("Validations"), click('button:has-text("+ Add rule")')) },
  { id: "realm-workflow", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Workflow") },
  { id: "realm-workflow-states", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: steps(tab("Workflow"), click('[data-testid="wf-defs-toggle"]')) },
  { id: "realm-activity", app: "realm-console", shot: "realm-steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: tab("Activity") },
  { id: "realm-user", app: "realm-console", shot: "realm-user", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW },
  // site settings
  { id: "st-settings", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW },
  { id: "st-validations", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: click('[data-testid="tab-validations"]') },
  { id: "st-classification", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: click('[data-testid="tab-classification"]') },
  { id: "st-classification-level", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: steps(click('[data-testid="tab-classification"]'), click('[data-testid="cls-space-picker-CLOUD"] .mini-select-value')) },
  { id: "st-api", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: click('[data-testid="tab-api-access"]') },
  { id: "st-api-role", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: steps(click('[data-testid="tab-api-access"]'), click('[data-testid="api-mint-role-value"]')) },
  { id: "st-backup", app: "steward-console", shot: "steward", h: 900, w: CONSOLE_DESKTOP, n: CONSOLE_NARROW, run: click('[data-testid="tab-backup"]') },
  // full attachments view (Forge modal "max")
  { id: "overlay", app: "overlay", shot: "overlay", viewports: [[1100, 680], [1300, 780], [1780, 960], [2440, 1300]], narrow: [[390, 760], [764, 262], [834, 1100]] },
  // inline panel macro
  { id: "panel", app: "inline-panel", shot: "panel", h: 1400, w: [760, 1100], n: [572, 690] },
  { id: "panel-expand", app: "inline-panel", shot: "panel", h: 1400, w: [760], n: [572], run: click(".card-expand-toggle") },
  // page banner
  { id: "ribbon", app: "doc-ribbon", shot: "ribbon", h: 120, w: [912, 1072, 1552, 2190], n: [360, 390, 430, 656, 744, 764] },
  { id: "ribbon-wf", app: "doc-ribbon", shot: "ribbon", h: 400, w: [1072], n: [390, 656], run: click(".wf-chip:not([data-testid=wf-details-chip])") },
  // page details modal (byline / banner Open) and the seal action
  { id: "pd-overview", app: "page-details", shot: "pd-details", viewports: [[800, 720]], narrow: [[390, 720], [430, 720], [764, 720]] },
  { id: "pd-move", app: "page-details", shot: "pd-details", viewports: [[800, 720]], narrow: [[390, 720]], run: click('[data-testid="pd-wf-move"]') },
  { id: "pd-level", app: "page-details", shot: "pd-details", viewports: [[800, 720]], narrow: [[390, 720]], run: click('[data-testid="pd-level-picker"]') },
  { id: "seal-action", app: "page-details", shot: "pd-seal", viewports: [[800, 720]], narrow: [[390, 720]] },
  { id: "seal-action-selected", app: "page-details", shot: "pd-seal", viewports: [[800, 720]], narrow: [[390, 720]], run: async (p) => { const b = p.locator('[data-testid="pd-attachment-check"]:not(:disabled)'); await b.nth(0).click(); await b.nth(1).click(); await sleep(500); } },
  // my work (shares tokens; checked for no regression)
  { id: "mywork", app: "my-work", shot: "mywork", h: 900, w: [994, 1474], n: [636] },
];

const browser = await chromium.launch();
const results = [];
for (const sc of S) {
  if (ONLY && !sc.id.includes(ONLY)) continue;
  const root = path.join(HERE, "../../static/_screenshot-harness/shots-responsive", sc.app);
  if (!fs.existsSync(path.join(root, "index.html"))) { console.log("missing bundle", sc.app); continue; }
  const vps = [];
  if (SET !== "narrow") vps.push(...(sc.viewports || (sc.w || []).map((w) => [w, sc.h])));
  if (SET !== "desktop") vps.push(...(sc.narrow || (sc.n || []).map((w) => [w, sc.h])));
  const { s, port } = await serve(root);
  for (const theme of THEMES) {
    for (const [w, h] of vps) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce", hasTouch: w < 800 && SET !== "desktop" });
      await ctx.clock.install({ time: NOW });
      await ctx.addInitScript(([sh, th]) => {
        window.__SHOT__ = sh;
        try { localStorage.clear(); } catch (_) { /* fresh */ }
        if (th === "dark") {
          const setDark = () => { if (document.documentElement) document.documentElement.setAttribute("data-color-mode", "dark"); };
          setDark(); document.addEventListener("DOMContentLoaded", setDark);
        }
      }, [sc.shot, theme]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => { const r = document.getElementById("root"); return r && r.children.length > 0; }, { timeout: 8000 }).catch(() => {});
      await ctx.clock.runFor(2500);
      await sleep(600);
      let stepErr = null;
      if (sc.run) { try { await sc.run(page); await ctx.clock.runFor(1500); await sleep(400); } catch (e) { stepErr = String(e.message || e).split("\n")[0]; } }
      const metrics = await page.evaluate(() => {
        const de = document.scrollingElement || document.documentElement;
        return { sw: de.scrollWidth, iw: innerWidth, sh: de.scrollHeight };
      });
      const dir = path.join(OUT, theme); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${sc.id}@${w}x${h}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      results.push({ id: sc.id, w, h, theme, overflowX: Math.max(0, metrics.sw - metrics.iw), height: metrics.sh, errors, stepErr });
      console.log(`${theme} ${sc.id}@${w}x${h} overflowX=${Math.max(0, metrics.sw - metrics.iw)} H=${metrics.sh}${stepErr ? " STEP-ERR " + stepErr : ""}${errors.length ? " pageerrors: " + errors.join(" | ") : ""}`);
      await ctx.close();
    }
  }
  await new Promise((r) => s.close(r));
}
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log("done", results.length);
