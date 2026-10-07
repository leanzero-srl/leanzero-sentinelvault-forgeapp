// Short desktop windows: the details modal (byline) and the attachments overlay. Which height
// queries fire, and what does the user get? Read-only.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, PAGE, sleep, PROBE_OUT } from "./lib.mjs";
const vps = process.argv[2].split(",").map((s) => s.split("x").map(Number));
const OUT = `${PROBE_OUT}/short`; fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w: vps[0][0], h: vps[0][1], tag: "short" });
try {
  for (const [w, h] of vps) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, PAGE); await sleep(5000);
    const chip = page.locator('button[data-testid="byline-forge-app-button"]', { has: page.locator('img[data-testid="byline-forge-app-image"]'), hasText: "(Development)" }).first();
    await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click({ timeout: 30000 });
    const pd = await devFrame(page, '[data-testid="pd-modal"][data-mode="details"][data-ready="1"]', { timeout: 60000 });
    await sleep(1500);
    const pm = await pd.evaluate(() => ({ W: innerWidth, H: innerHeight, mq520: matchMedia("(max-height: 520px)").matches, bodyScroll: `${document.querySelector(".pd-body")?.scrollHeight}/${document.querySelector(".pd-body")?.clientHeight}`, docScroll: `${document.documentElement.scrollHeight}/${innerHeight}`, footVisible: (() => { const f = document.querySelector(".pd-foot"); if (!f) return null; const r = f.getBoundingClientRect(); return r.bottom <= innerHeight + 1; })() }));
    console.log(`${w}x${h} details`, JSON.stringify(pm));
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-details.png`) });
    await pd.locator('[data-testid="pd-tab-attachments"]').click(); await sleep(1500);
    await pd.locator('[data-testid="pd-open-overlay"]').click({ timeout: 20000 });
    const ov = await devFrame(page, ".modal-container .artifact-card", { not: ".sv-panel-container", timeout: 60000 });
    await sleep(4000);
    const om = await ov.evaluate(() => { const l = document.querySelector(".attachments-tab-content"); const cards = [...document.querySelectorAll(".artifact-card")]; const lr = l?.getBoundingClientRect(); const vis = cards.filter((c) => { const r = c.getBoundingClientRect(); return lr && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1; }).length; return { W: innerWidth, H: innerHeight, mq720: matchMedia("(max-height: 720px)").matches, mq560: matchMedia("(max-height: 560px)").matches, listH: lr && Math.round(lr.height), fullyVisibleCards: vis, cols: getComputedStyle(document.querySelector(".sv-card-list")).gridTemplateColumns.split(" ").length, descShown: !!document.querySelector(".ov-macro-notice-desc") && getComputedStyle(document.querySelector(".ov-macro-notice-desc")).display !== "none" }; });
    console.log(`${w}x${h} overlay`, JSON.stringify(om));
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-overlay.png`) });
    await ov.locator(".modal-close").first().click().catch(() => {}); await sleep(1200);
    const pd2 = await devFrame(page, '[data-testid="pd-modal"]', { timeout: 3000 }).catch(() => null);
    if (pd2) await pd2.locator('[data-testid="pd-close"]').click().catch(() => {});
    await sleep(800);
  }
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); } finally { await close(); }
