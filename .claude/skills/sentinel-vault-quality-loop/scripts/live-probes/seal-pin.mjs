// Seal attachments (content action): tick 2 files (local only), then open "Seal holds for" from the
// pinned form. Is the menu visible? Does the list bleed under the pinned form? Never presses Seal.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, PAGE, sleep, PROBE_OUT } from "./lib.mjs";
const [w, h, touch, label] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "touch", process.argv[5]];
const OUT = `${PROBE_OUT}/seal-pin-${label}`;
fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w, h, touch, dpr: touch ? 2 : 1, tag: "sealpin" });
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
    const body = document.querySelector(".pd-body"), form = document.querySelector('[data-testid="pd-seal-form"]');
    const b = body.getBoundingClientRect(), fr = form.getBoundingClientRect(); const cs = getComputedStyle(body);
    const menu = document.querySelector(".pd-seal-form .pd-dd-menu"); const m = menu && menu.getBoundingClientRect();
    return { frame: [innerWidth, innerHeight], body: { top: Math.round(b.top), bottom: Math.round(b.bottom), clientBottom: Math.round(b.top + body.clientHeight), padB: cs.paddingBottom, scrollTop: Math.round(body.scrollTop), scrollH: body.scrollHeight, clientH: body.clientHeight }, form: { top: Math.round(fr.top), bottom: Math.round(fr.bottom), pinned: form.classList.contains("is-pinned"), pos: getComputedStyle(form).position }, gapUnderForm: Math.round(b.top + body.clientHeight - fr.bottom), menu: m ? { top: Math.round(m.top), bottom: Math.round(m.bottom), visiblePx: Math.max(0, Math.min(m.bottom, b.top + body.clientHeight) - Math.max(m.top, b.top)) } : null };
  });
  // scroll the list to the middle
  await f.evaluate(() => { const b = document.querySelector(".pd-body"); b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) / 2); });
  await sleep(600);
  console.log("mid, ticked:", JSON.stringify(await geo()));
  await page.screenshot({ path: path.join(OUT, "mid-ticked.png") });
  const dd = f.locator('[data-testid="pd-seal-form"] [data-testid="pd-duration"]');
  if (touch) await dd.tap(); else await dd.click();
  await sleep(900);
  console.log("mid, duration menu open:", JSON.stringify(await geo()));
  await page.screenshot({ path: path.join(OUT, "mid-duration-open.png") });
  // close menu, scroll to top, open again
  if (touch) await dd.tap(); else await dd.click(); await sleep(500);
  await f.evaluate(() => { document.querySelector(".pd-body").scrollTop = 0; }); await sleep(500);
  if (touch) await dd.tap(); else await dd.click(); await sleep(900);
  console.log("top, duration menu open:", JSON.stringify(await geo()));
  await f.evaluate(() => { const b = document.querySelector(".pd-body"); b.scrollTop = b.scrollHeight; }); await sleep(600);
  console.log("END, duration menu open:", JSON.stringify(await geo()));
  await page.screenshot({ path: path.join(OUT, "end-duration-open.png") });
  await page.screenshot({ path: path.join(OUT, "top-duration-open.png") });
  if (touch) await dd.tap(); else await dd.click(); await sleep(500);
  // keyboard: tab through the checkboxes from the top; is the focused row ever hidden under the pinned form?
  await f.evaluate(() => { document.querySelector(".pd-body").scrollTop = 0; });
  await f.locator('[data-testid="pd-attachment-check"]').first().focus();
  let hidden = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab"); await sleep(120);
    const r = await f.evaluate(() => { const a = document.activeElement; const form = document.querySelector('[data-testid="pd-seal-form"]'); if (!a || a === document.body || form.contains(a)) return null; const ar = a.getBoundingClientRect(), fr = form.getBoundingClientRect(); const b = document.querySelector('.pd-body').getBoundingClientRect(); return { inBody: ar.bottom > b.top && ar.top < b.bottom, cov: ar.top < fr.bottom && ar.bottom > fr.top && ar.right > fr.left && ar.left < fr.right, tag: a.tagName, tid: a.dataset.testid || "" }; });
    if (!r) continue; total++; if (r.cov) { hidden++; if (hidden === 1) { await page.screenshot({ path: path.join(OUT, "focus-hidden.png") }); console.log("first hidden focus:", JSON.stringify(r)); } }
  }
  console.log(`keyboard: ${hidden} of ${total} focus stops were under the pinned form`);
  await f.locator('[data-testid="pd-close"]').click().catch(() => {});
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); }
finally { await close(); }
