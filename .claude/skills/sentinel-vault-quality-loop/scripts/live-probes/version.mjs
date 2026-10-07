import { launch, go, devFrame, REALM, STEWARD, sleep } from "./lib.mjs";
const { page, close } = await launch({ tag: "version2" });
try {
  await go(page, REALM);
  const f = await devFrame(page, ".space-admin-title");
  console.log("realm data-sv-build:", await f.locator("[data-sv-build]").first().getAttribute("data-sv-build"));
  const css = await f.evaluate(() => { const out = []; for (const s of document.styleSheets) { try { for (const r of s.cssRules) { const t = r.cssText; if (t.includes("sv-unsaved-float.is-compact") || t.includes("card-secondary-left { flex: 1 1 180px")) out.push(t.slice(0, 160)); } } catch {} } return out; });
  console.log("realm css:", css);
  await go(page, STEWARD);
  const s = await devFrame(page, ".admin-title");
  console.log("steward data-sv-build:", await s.locator("[data-sv-build]").first().getAttribute("data-sv-build"));
  const css2 = await s.evaluate(() => { const out = []; for (const x of document.styleSheets) { try { for (const r of x.cssRules) { const t = r.cssText; if (t.includes("sv-unsaved-float.is-compact") || t.includes("card-secondary-left { flex: 1 1 180px")) out.push(t.slice(0, 160)); } } catch {} } return out; });
  console.log("steward css:", css2);
  const btn = s.locator("button", { hasText: /What.s new/ }).first();
  if (await btn.count()) { await btn.click(); await sleep(1500); }
  const txt = await s.evaluate(() => document.body.innerText);
  const i = txt.indexOf("7.0.1");
  console.log("whatsnew excerpt:", i >= 0 ? txt.slice(i, i + 1600) : "(7.0.1 not found)");
} catch (e) { console.log("ERR", String(e).slice(0, 300)); } finally { await close(); }
