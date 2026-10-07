// Settings rows in the stacked (<=640 px) layout: is the 260 px flex-basis of .settings-row-info a HEIGHT?
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, STEWARD, REALM, sleep, PROBE_OUT } from "./lib.mjs";
const [w, h, label] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const OUT = `${PROBE_OUT}/rowbasis-${label}`; fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w, h, touch: true, dpr: 2, tag: "rowbasis" });
const measure = (f) => f.evaluate(() => {
  const rows = [...document.querySelectorAll(".settings-row")].filter((r) => r.getBoundingClientRect().height > 0);
  const out = rows.map((r) => { const i = r.querySelector(".settings-row-info"); const ir = i.getBoundingClientRect(); const kids = [...i.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), ir.top); const cs = getComputedStyle(i); return { dir: getComputedStyle(r).flexDirection, basis: cs.flexBasis, grow: cs.flexGrow, infoH: Math.round(ir.height), contentH: Math.round(kids - ir.top), emptyPx: Math.round(ir.bottom - kids) }; });
  return { W: innerWidth, docH: document.documentElement.scrollHeight, rows: out.length, sumEmpty: out.reduce((s, r) => s + Math.max(0, r.emptyPx), 0), sample: out.slice(0, 3) };
});
try {
  await go(page, STEWARD); let f = await devFrame(page, ".admin-title"); await f.locator('[data-testid="tab-settings"]').click(); await sleep(3000);
  console.log("steward settings", JSON.stringify(await measure(f)));
  await go(page, REALM); f = await devFrame(page, ".space-admin-title"); await sleep(2000);
  for (const t of ["Seal Duration", "Macro", "Validations", "Workflow"]) {
    await f.locator(".tab-navigation .tab-button", { hasText: t }).first().click(); await sleep(3000);
    console.log("realm", t, JSON.stringify(await measure(f)));
    const el = await f.frameElement(); await el.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(OUT, `realm-${t.replace(/\W/g, "")}.png`) });
  }
} catch (e) { console.log("ERROR", String(e).slice(0, 200)); } finally { await close(); }
