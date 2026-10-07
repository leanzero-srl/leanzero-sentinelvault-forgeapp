// Live probe helpers (read-only against wolfaenpak dev). Clones the saved forge-live-harness login per
// run (never touches the shared profile). Probes write PNGs + logs under PROBE_OUT (default: the
// AI-workhorse SSD; check its marker file first, see the global media rule). 2026-10-07, responsive
// round 2 — each probe's header says what it measures; run from this folder: node <probe>.mjs <args>.
import os from "node:os"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
export const HARNESS = process.env.FORGE_LIVE_HARNESS || path.join(os.homedir(), "Projects/forge-live-harness");
export const PROBE_OUT = process.env.PROBE_OUT || "/Volumes/AI-workhorse/media/device-matrix/sentinel-probes";
if (PROBE_OUT.startsWith("/Volumes/AI-workhorse/") && !fs.existsSync("/Volumes/AI-workhorse/.ai-workhorse-disk")) { console.error("AI-workhorse SSD not mounted: set PROBE_OUT to a local folder"); process.exit(1); }
const { chromium } = await import(`${HARNESS}/node_modules/@playwright/test/index.mjs`);
const { harnessHome } = await import(`${HARNESS}/config/home.mjs`);
const { cloneProfile, removeOwnedRun, runsRoot } = await import(`${HARNESS}/forge/auth-clone.mjs`);

export const APP = "c30bf71e-4287-4872-954d-db49cc68f0ff", ENV = "17516615-12ef-4790-8ce2-29151b7ee9ac", DEV = "17516615";
export const BASE = "https://wolfaenpak.atlassian.net";
export const REALM = `${BASE}/wiki/spaces/WFH/apps/${APP}/${ENV}/realm-console`;
export const STEWARD = `${BASE}/wiki/admin/forge/apps/${APP}/${ENV}/steward-console`;
export const MYWORK = `${BASE}/wiki/apps/${APP}/${ENV}/my-work`;
export const PAGE = `${BASE}/wiki/spaces/WFH/pages/368476161`;

export async function launch({ touch = false, w = 1440, h = 900, dpr = 1, tag = "probe" } = {}) {
  const authDir = path.join(harnessHome(), ".auth");
  const runDir = path.join(runsRoot(authDir), `r2probe-${tag}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`);
  cloneProfile(path.join(authDir, "profile"), path.join(runDir, "base"), { purpose: `breaker ${tag}` });
  const ctx = await chromium.launchPersistentContext(path.join(runDir, "base"), {
    channel: "chrome", headless: true, viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch,
    ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--window-size=2600,1600"],
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  const close = async () => { await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]); try { removeOwnedRun(authDir, runDir); } catch {} setTimeout(() => process.exit(0), 200); };
  return { ctx, page, close };
}

export async function devFrame(page, sel, { timeout = 45000, not = null } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    let best = null, area = -1;
    for (const f of page.frames()) {
      if (f === page.mainFrame() || !f.url().includes(DEV)) continue;
      try {
        if (!(await f.locator(sel).count())) continue;
        if (not && (await f.locator(not).count())) continue;
        const b = await (await f.frameElement()).boundingBox();
        const a = b ? b.width * b.height : 0;
        if (a > area) { area = a; best = f; }
      } catch {}
    }
    if (best) return best;
    await page.waitForTimeout(1000);
  }
  throw new Error(`dev frame not found: ${sel}`);
}

export async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  for (let i = 0; i < 12 && /id\.atlassian\.com|login\.jsp/.test(page.url()); i++) {
    const acct = page.getByRole("button", { name: /mihai@wolfaenpak\.com/ }).first();
    if (await acct.count()) { await acct.click().catch(() => {}); await page.waitForTimeout(5000); continue; }
    await page.waitForTimeout(2000);
  }
}

export async function frameShot(page, frame, file) {
  const el = await frame.frameElement();
  await el.screenshot({ path: file, timeout: 30000 }).catch(async () => { await page.screenshot({ path: file }); });
}

export const setLight = (frame) => frame.evaluate(() => { document.documentElement.setAttribute("data-color-mode", "light"); document.documentElement.setAttribute("data-theme", (document.documentElement.getAttribute("data-theme") || "").replace(/dark/g, "light")); });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
