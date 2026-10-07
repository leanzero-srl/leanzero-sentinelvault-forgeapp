// Cards whose name + actions would fit on ONE line but wrap anyway (the 180 px name basis).
// Overlay (attachments view) + inline panel + realm Sealed Files at desktop sizes. Read-only.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, PAGE, REALM, sleep, PROBE_OUT } from "./lib.mjs";
const vps = process.argv[2].split(",").map((s) => s.split("x").map(Number));
const OUT = `${PROBE_OUT}/cardwrap`; fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w: vps[0][0], h: vps[0][1], tag: "cardwrap" });
const measure = (f) => f.evaluate(() => {
  const cards = [...document.querySelectorAll(".artifact-card")].filter((c) => c.getBoundingClientRect().width > 0);
  let wrapped = 0, needless = 0; const hs = [];
  for (const c of cards) {
    const row = c.querySelector(".card-row-primary"); const name = row?.querySelector(".card-filename"); const right = row?.querySelector(".card-row-right");
    if (!row || !name || !right) continue;
    const nr = name.getBoundingClientRect(), rr = right.getBoundingClientRect(), row_ = row.getBoundingClientRect();
    const isWrapped = rr.top >= nr.bottom - 2;
    // natural width of the name's content (its children laid out on one line)
    const kids = [...name.children]; let natural = 0;
    for (const k of kids) { const clone = k.cloneNode(true); clone.style.cssText += ";position:absolute;visibility:hidden;white-space:nowrap;width:auto;max-width:none;flex:none"; document.body.appendChild(clone); natural += clone.getBoundingClientRect().width; clone.remove(); }
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const before = [...row.children].filter((x) => x !== name && x !== right).reduce((s, x) => s + x.getBoundingClientRect().width + gap, 0);
    const fitsOneLine = before + natural + gap * Math.max(0, kids.length - 1) + gap + rr.width <= row_.width + 0.5;
    if (isWrapped) { wrapped++; if (fitsOneLine) needless++; }
    hs.push(Math.round(c.getBoundingClientRect().height));
  }
  return { W: innerWidth, cards: cards.length, wrapped, needlessWraps: needless, medianCardH: hs.sort((a, b) => a - b)[Math.floor(hs.length / 2)] };
});
try {
  for (const [w, h] of vps) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, REALM); let f = await devFrame(page, ".space-admin-title"); await sleep(4000);
    console.log(`${w}x${h} realm-sealed`, JSON.stringify(await measure(f)));
    await go(page, PAGE); await sleep(6000);
    const panel = await devFrame(page, ".sv-panel-container", { timeout: 60000 });
    await (await panel.frameElement()).scrollIntoViewIfNeeded().catch(() => {}); await sleep(6000);
    console.log(`${w}x${h} panel`, JSON.stringify(await measure(panel)));
    await page.evaluate(() => scrollTo(0, 0));
    const chip = page.locator('button[data-testid="byline-forge-app-button"]', { has: page.locator('img[data-testid="byline-forge-app-image"]'), hasText: "(Development)" }).first();
    await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click({ timeout: 30000 });
    const pd = await devFrame(page, '[data-testid="pd-modal"][data-mode="details"][data-ready="1"]', { timeout: 60000 });
    await pd.locator('[data-testid="pd-tab-attachments"]').click(); await sleep(1500);
    await pd.locator('[data-testid="pd-open-overlay"]').click({ timeout: 20000 });
    const ov = await devFrame(page, ".modal-container .artifact-card", { not: ".sv-panel-container", timeout: 60000 });
    await sleep(5000);
    console.log(`${w}x${h} overlay`, JSON.stringify(await measure(ov)));
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-overlay.png`) });
    await ov.locator(".modal-close").first().click().catch(() => {}); await sleep(1000);
    const pd2 = await devFrame(page, '[data-testid="pd-modal"]', { timeout: 3000 }).catch(() => null); if (pd2) await pd2.locator('[data-testid="pd-close"]').click().catch(() => {});
  }
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); } finally { await close(); }
