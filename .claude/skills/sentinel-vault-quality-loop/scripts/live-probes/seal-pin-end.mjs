// Seal attachments: tick 2 files, scroll the list to its END first, THEN open "Seal holds for".
// Is the menu wholly visible, or capped and scrollable inside? Local only; never presses Seal.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, PAGE, sleep, PROBE_OUT } from "./lib.mjs";
const [w, h, touch, label] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "touch", process.argv[5]];
const OUT = `${PROBE_OUT}/seal-pin-end-${label}`;
fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w, h, touch, dpr: touch ? 2 : 1, tag: "sealpinend" });
try {
  await go(page, PAGE); await sleep(6000);
  const more = page.getByRole("button", { name: "More actions" }).filter({ visible: true }).last();
  await more.click({ timeout: 30000 });
  const apps = page.locator('[data-testid="third-party-button"], [role="menuitem"]:has-text("Apps")').first();
  await apps.waitFor({ state: "visible", timeout: 20000 }); await apps.click();
  const item = page.locator('[role="menuitem"], [role="menu"] button, [role="menu"] a').filter({ hasText: /Seal attachments/ }).filter({ hasText: "(Development)" }).first();
  await item.waitFor({ state: "visible", timeout: 20000 }); await item.click();
  const f = await devFrame(page, '[data-testid="pd-modal"][data-mode="seal"] [data-testid="pd-attachment-check"]', { timeout: 60000 });
  await sleep(1500);
  const boxes = f.locator('[data-testid="pd-attachment-check"]:not(:disabled)');
  const n = await boxes.count();
  for (let i = 0, t = 0; i < n && t < 2; i++) { const b = boxes.nth(i); if (!(await b.isChecked())) { if (touch) await b.tap(); else await b.click(); t++; } }
  await sleep(800);
  const geo = () => f.evaluate(() => {
    const body = document.querySelector(".pd-body"); const b = body.getBoundingClientRect();
    const menu = document.querySelector(".pd-seal-form .pd-dd-menu"); const m = menu && menu.getBoundingClientRect();
    const top = b.top, bottom = b.top + body.clientHeight;
    return { body: [Math.round(top), Math.round(bottom)], scrollTop: Math.round(body.scrollTop), menu: m ? { top: Math.round(m.top), bottom: Math.round(m.bottom), visiblePx: Math.round(Math.max(0, Math.min(m.bottom, bottom) - Math.max(m.top, top))), h: Math.round(m.height), scrollH: menu.scrollHeight, up: menu.classList.contains("is-up"), maxH: menu.style.maxHeight || null } : null };
  });
  for (const where of ["end", "top"]) {
    await f.evaluate((wh) => { const b = document.querySelector(".pd-body"); b.scrollTop = wh === "end" ? b.scrollHeight : 0; }, where); await sleep(700);
    const dd = f.locator('[data-testid="pd-seal-form"] [data-testid="pd-duration"]');
    if (touch) await dd.tap(); else await dd.click();
    await sleep(1000);
    const g = await geo();
    console.log(`${where}: opened after scrolling`, JSON.stringify(g), "whole menu visible:", !!g.menu && g.menu.visiblePx >= g.menu.h - 1, "all options reachable:", !!g.menu && (g.menu.visiblePx >= g.menu.h - 1) && g.menu.scrollH <= g.menu.h + 1 || (!!g.menu && !!g.menu.maxH && g.menu.visiblePx >= g.menu.h - 1));
    await page.screenshot({ path: path.join(OUT, `${where}-open.png`) });
    if (touch) await dd.tap(); else await dd.click(); await sleep(500);
  }
  await f.locator('[data-testid="pd-close"]').click().catch(() => {});
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); }
finally { await close(); }
