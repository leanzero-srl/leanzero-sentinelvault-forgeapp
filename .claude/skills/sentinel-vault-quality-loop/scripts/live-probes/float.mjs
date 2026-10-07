// Does the "Not applied yet" gap (UnsavedFloat room-below) shift the NEXT control between pointerdown
// and pointerup, swallowing (mouse) or misdirecting (touch) the next click? Local edits only; ends with
// Discard; never Apply.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, STEWARD, REALM, sleep, PROBE_OUT } from "./lib.mjs";
const [w, h, touch, label, where = "steward"] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "touch", process.argv[5], process.argv[6]];
const OUT = `${PROBE_OUT}/float-${where}-${label}`;
fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w, h, touch, dpr: touch ? 2 : 1, tag: "float" });
const log = [];
const L = (...a) => { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); };
try {
  let f;
  if (where === "steward") {
    await go(page, STEWARD); f = await devFrame(page, ".admin-title");
    await f.locator('[data-testid="tab-settings"]').click(); await sleep(2500);
  } else {
    await go(page, REALM); f = await devFrame(page, ".space-admin-title");
    await f.locator(".tab-navigation .tab-button", { hasText: where }).first().click(); await sleep(2500);
  }
  const state = () => f.evaluate(() => {
    const sw = [...document.querySelectorAll('.settings-row .settings-row-control input[type="checkbox"]')].filter((i) => !i.disabled && i.getBoundingClientRect().width > 0);
    const gaps = [...document.querySelectorAll("*")].filter((e) => e.style && e.style.marginBottom).map((e) => `${e.className || e.tagName}:${e.style.marginBottom}`);
    const fl = document.querySelector(".sv-unsaved-float"); const r = fl && fl.getBoundingClientRect();
    const fl2 = document.querySelector(".sv-unsaved-float"); let cov = null;
    if (fl2 && getComputedStyle(fl2).visibility !== "hidden") { const f = fl2.getBoundingClientRect(); const hit = (q) => q.width > 0 && q.height > 0 && q.left < f.right && q.right > f.left && q.top < f.bottom && q.bottom > f.top;
      const C = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], [role="menu"], [tabindex]:not([tabindex="-1"])';
      const ctl = [...document.querySelectorAll(C)].filter((e) => !fl2.contains(e) && hit(e.getBoundingClientRect())).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).slice(0, 24));
      const txt = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.nodeValue.trim() || fl2.contains(n.parentNode)) continue; rg.selectNodeContents(n); if ([...rg.getClientRects()].some(hit)) txt.push(n.nodeValue.trim().slice(0, 24)); }
      cov = { spot: fl2.dataset.spot, ctl, txt }; }
    return { checked: sw.map((i) => i.checked), n: sw.length, gaps, float: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), spot: fl.dataset.spot } : null, cov, W: innerWidth };
  });
  const s0 = await state(); L("initial", s0);
  const sw = f.locator('.settings-row .settings-row-control input[type="checkbox"]:not(:disabled)');
  const N = Math.min(6, s0.n);
  let lost = 0;
  for (let i = 0; i < N; i++) {
    const before = await state();
    const el = sw.nth(i);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    const bb0 = await el.boundingBox();
    if (touch) await el.tap({ timeout: 8000 }).catch((e) => L("tap err", String(e).slice(0, 120)));
    else await el.click({ timeout: 8000 }).catch((e) => L("click err", String(e).slice(0, 120)));
    await sleep(900);
    const after = await state();
    const bb1 = await el.boundingBox();
    const flipped = after.checked[i] !== before.checked[i];
    const others = after.checked.map((c, k) => (k !== i && c !== before.checked[k] ? k : null)).filter((k) => k !== null);
    if (!flipped) lost++;
    L(`click #${i}: flipped=${flipped} otherFlipped=${JSON.stringify(others)} y ${bb0 && Math.round(bb0.y)} -> ${bb1 && Math.round(bb1.y)} float=${JSON.stringify(after.float)} gaps=${JSON.stringify(after.gaps)} cov=${JSON.stringify(after.cov)}`);
    await page.screenshot({ path: path.join(OUT, `step-${i}.png`) });
    // a dialog may have opened (e.g. a confirm) — record and close
    if (await f.locator(".sv-dialog").count()) { L("dialog opened:", (await f.locator(".sv-dialog").first().innerText()).slice(0, 160)); await f.locator("body").press("Escape").catch(() => {}); await sleep(500); }
  }
  L("lost clicks:", lost, "of", N);
  // revert: Discard in the float (or the bar)
  const disc = f.locator('[data-testid="sv-unsaved-float-discard"], [data-testid="sv-discard-global-prefs"], [data-testid="sv-discard-realm-prefs"]').first();
  if (await disc.count()) { await disc.click().catch(() => {}); await sleep(800); }
  const fin = await state(); L("after discard", fin, "same as initial:", JSON.stringify(fin.checked) === JSON.stringify(s0.checked));
} catch (e) { L("ERROR", String(e).slice(0, 300)); }
finally { fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n")); await close(); }
