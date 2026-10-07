// Validations tab (realm or steward): enforcement checkboxes + Add rule. Does the reminder's gap shift
// the next control between pointerdown and pointerup? Local edits only; Discard at the end.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, STEWARD, REALM, sleep, PROBE_OUT } from "./lib.mjs";
const [w, h, touch, label, where = "realm"] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "touch", process.argv[5], process.argv[6]];
const OUT = `${PROBE_OUT}/floatval-${where}-${label}`;
fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w, h, touch, dpr: touch ? 2 : 1, tag: "floatval" });
const log = [];
const L = (...a) => { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); };
try {
  let f;
  if (where === "steward") { await go(page, STEWARD); f = await devFrame(page, ".admin-title"); await f.locator('[data-testid="tab-validations"]').click(); }
  else { await go(page, REALM); f = await devFrame(page, ".space-admin-title"); await f.locator(".tab-navigation .tab-button", { hasText: "Validations" }).first().click(); }
  await sleep(3000);
  const state = () => f.evaluate(() => {
    const boxes = [...document.querySelectorAll('.val-modes input[type="checkbox"]')];
    const gaps = [...document.querySelectorAll("*")].filter((e) => e.style && e.style.marginBottom).map((e) => `${String(e.className).slice(0, 30)}:${e.style.marginBottom}`);
    const fl = document.querySelector(".sv-unsaved-float"); const r = fl && fl.getBoundingClientRect();
    const covered = [];
    if (r) for (const el of document.querySelectorAll("p, span, label, input, button, .mini-select-value")) {
      if (fl.contains(el)) continue; const q = el.getBoundingClientRect();
      if (q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top && el.children.length === 0) covered.push(`${el.tagName}.${String(el.className).slice(0, 25)}:${(el.innerText || el.value || el.placeholder || "").slice(0, 30)}`);
    }
    const fl2 = document.querySelector(".sv-unsaved-float"); let cov = null;
    if (fl2 && getComputedStyle(fl2).visibility !== "hidden") { const f = fl2.getBoundingClientRect(); const hit = (q) => q.width > 0 && q.height > 0 && q.left < f.right && q.right > f.left && q.top < f.bottom && q.bottom > f.top;
      const C = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], [role="menu"], [tabindex]:not([tabindex="-1"])';
      const ctl = [...document.querySelectorAll(C)].filter((e) => !fl2.contains(e) && hit(e.getBoundingClientRect())).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).slice(0, 24));
      const txt = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.nodeValue.trim() || fl2.contains(n.parentNode)) continue; rg.selectNodeContents(n); if ([...rg.getClientRects()].some(hit)) txt.push(n.nodeValue.trim().slice(0, 24)); }
      cov = { spot: fl2.dataset.spot, ctl, txt }; }
    return { modes: boxes.map((b) => b.checked), rules: document.querySelectorAll(".val-rule-card").length, gaps, float: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), spot: fl.dataset.spot } : null, covered: covered.slice(0, 8), cov, W: innerWidth };
  });
  const act = async (loc, name) => {
    const before = await state();
    await loc.scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    const bb0 = await loc.boundingBox();
    if (touch) await loc.tap({ timeout: 8000 }).catch((e) => L("tap err", String(e).slice(0, 100)));
    else await loc.click({ timeout: 8000 }).catch((e) => L("click err", String(e).slice(0, 100)));
    await sleep(1000);
    const after = await state(); const bb1 = await loc.boundingBox().catch(() => null);
    L(`${name}: modes ${JSON.stringify(before.modes)}->${JSON.stringify(after.modes)} rules ${before.rules}->${after.rules} y ${bb0 && Math.round(bb0.y)}->${bb1 && Math.round(bb1.y)} float=${JSON.stringify(after.float)} gaps=${JSON.stringify(after.gaps)} covered=${JSON.stringify(after.covered)} cov=${JSON.stringify(after.cov)}`);
    return after;
  };
  const s0 = await state(); L("initial", s0);
  const boxes = f.locator('.val-modes input[type="checkbox"]');
  for (let i = 0; i < Math.min(3, s0.modes.length); i++) { await act(boxes.nth(i), `mode#${i}`); await page.screenshot({ path: path.join(OUT, `mode-${i}.png`) }); }
  const add = f.locator("button", { hasText: "+ Add rule" }).first();
  await act(add, "add-rule-1"); await page.screenshot({ path: path.join(OUT, "add-1.png") });
  // the control BELOW the gap: the new rule's type picker (opens on click) — is the click kept?
  const pick = f.locator(".val-rule-card .mini-select-value").first();
  const sp = await act(pick, "rule-type-picker");
  const menuOpen = await f.locator(".val-rule-card .mini-select-menu").count();
  L("type menu open after one click:", menuOpen > 0);
  await page.screenshot({ path: path.join(OUT, "picker.png") });
  if (menuOpen) { await f.locator(".val-rule-card .mini-select-value").first().click().catch(() => {}); await sleep(500); }
  await act(add, "add-rule-2"); await page.screenshot({ path: path.join(OUT, "add-2.png") });
  // the remove x of the FIRST rule (below the gap opened under the head / the cards)
  const rm = f.locator(".val-rule-card .val-rule-remove").first();
  await act(rm, "remove-first-rule");
  await page.screenshot({ path: path.join(OUT, "remove.png") });
  for (let i = 0; i < Math.min(3, s0.modes.length); i++) { await act(boxes.nth(i), `mode-back#${i}`); }
  await page.screenshot({ path: path.join(OUT, "end.png") });
  const disc = f.locator('[data-testid="val-discard"], [data-testid="sv-unsaved-float-discard"]').first();
  if (await disc.count()) { await disc.click().catch(() => {}); await sleep(1000); }
  const fin = await state(); L("after discard", fin, "modes restored:", JSON.stringify(fin.modes) === JSON.stringify(s0.modes), "rules restored:", fin.rules === s0.rules);
} catch (e) { L("ERROR", String(e).slice(0, 300)); }
finally { fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n")); await close(); }
