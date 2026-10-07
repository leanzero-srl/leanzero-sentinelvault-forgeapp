// FINAL FIXES live probe (BN-02 first tick, BRK2-01 Macro switch) on the deployed dev build.
// READ-ONLY: ticks files locally (never Seal), reads the Macro tab (never Apply).
// PROBE_OUT=<dir> node firsttick.mjs <build|firsttick|firstpress|macro> <WxH> <touch|mouse> [page|realm]
// build = data-sv-build + the served coarse switch rules; firsttick = focus + Space on a checkbox low in
// the visible list (the breaker's BN-02 repro); firstpress = the same with a real mouse press / CDP tap;
// macro = Space console Macro tab, the Position switch track/knob/label geometry.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, STEWARD, REALM, PAGE, sleep } from "./lib.mjs";
const OUTROOT = process.env.PROBE_OUT || "/Volumes/AI-workhorse/media/device-matrix/sentinel-probes";
const [CHECK, WH, MODE, WHERE = "page"] = process.argv.slice(2);
const [W, H] = WH.split("x").map(Number); const TOUCH = MODE === "touch";
const tag = `${CHECK}-${WHERE}-${WH}-${MODE}`;
const OUT = path.join(OUTROOT, tag); fs.mkdirSync(OUT, { recursive: true });
const log = []; const L = (...a) => { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n")); };
const { page, close } = await launch({ w: W, h: H, touch: TOUCH, dpr: TOUCH ? 2 : 1, tag: `fix-${CHECK}` });
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) }).catch(() => {});
async function press(loc, hold = 140) {
  const b = await loc.boundingBox(); if (!b) return { err: "no box" };
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (TOUCH) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] });
    await sleep(hold);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach().catch(() => {});
  } else { await page.mouse.move(x, y, { steps: 4 }); await page.mouse.down(); await sleep(hold); await page.mouse.up(); }
  return { x: Math.round(x), y: Math.round(y) };
}
async function openSeal() {
  await go(page, PAGE); await sleep(6000);
  const more = page.getByRole("button", { name: "More actions" }).filter({ visible: true }).last();
  await more.click({ timeout: 30000 });
  const apps = page.locator('[data-testid="third-party-button"], [role="menuitem"]:has-text("Apps")').first();
  await apps.waitFor({ state: "visible", timeout: 20000 }); await apps.click();
  const item = page.locator('[role="menuitem"], [role="menu"] button, [role="menu"] a').filter({ hasText: /Seal attachments/ }).filter({ hasText: "(Development)" }).first();
  await item.waitFor({ state: "visible", timeout: 20000 }); await item.click();
  const f = await devFrame(page, '[data-testid="pd-modal"][data-mode="seal"] [data-testid="pd-attachment-check"]', { timeout: 60000 });
  await sleep(1500);
  L("served build", await f.locator("[data-sv-build]").first().getAttribute("data-sv-build").catch(() => "?"), "frame", await f.evaluate(() => [innerWidth, innerHeight, matchMedia("(pointer: coarse)").matches]));
  return f;
}
const pick = (f, off) => f.evaluate((off) => { const body = document.querySelector(".pd-body"); const br = body.getBoundingClientRect(); const bot = br.top + body.clientHeight; let best = -1, bd = 1e9;
  [...document.querySelectorAll('[data-testid="pd-attachment-check"]')].forEach((c, i) => { if (c.disabled || c.checked) return; const r = c.getBoundingClientRect(); if (r.bottom > bot - 2 || r.top < br.top) return; const d = Math.abs((bot - off) - r.bottom); if (d < bd) { bd = d; best = i; } }); return best; }, off);
const measure = (f, idx) => f.evaluate((idx) => { const c = document.querySelectorAll('[data-testid="pd-attachment-check"]')[idx]; const row = c.closest('[data-testid="pd-attachment-row"]'); const form = document.querySelector('[data-testid="pd-seal-form"]'); const body = document.querySelector(".pd-body");
  const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect(), fr = form.getBoundingClientRect(); const a = document.activeElement;
  return { checked: c.checked, box: [Math.round(cr.top), Math.round(cr.bottom)], row: [Math.round(rr.top), Math.round(rr.bottom)], form: [Math.round(fr.top), Math.round(fr.bottom)], pinned: form.classList.contains("is-pinned"), boxCovered: cr.bottom > fr.top && cr.top < fr.bottom, rowCovered: rr.bottom > fr.top && rr.top < fr.bottom, focusOnIt: a === c, scrollTop: Math.round(body.scrollTop), spb: body.style.scrollPaddingBottom }; }, idx);
try {
  if (CHECK === "build") {
    for (const [u, sel] of [[REALM, ".space-admin-title"], [STEWARD, ".admin-title"]]) {
      await go(page, u); const f = await devFrame(page, sel);
      const css = await f.evaluate(() => { const out = []; for (const s of document.styleSheets) { try { for (const r of s.cssRules) { const t = r.cssText; if (t.includes("pointer: coarse") && t.includes("checkbox-control")) out.push(t.match(/\.checkbox-control[^}]*\}/g)); } } catch {} } return out; });
      L(u.split("/").pop(), "data-sv-build:", await f.locator("[data-sv-build]").first().getAttribute("data-sv-build"), "coarse switch rules:", css);
    }
  }
  if (CHECK === "firsttick" || CHECK === "firstpress") {
    // firsttick = the breaker's keyboard repro (focus + Space); firstpress = a real mouse press / finger tap.
    const f = await openSeal();
    for (const offset of [10, 40, 80, 140]) {
      await f.evaluate(() => { document.querySelector(".pd-body").scrollTop = 0; }); await sleep(400);
      const idx = await pick(f, offset);
      if (idx < 0) { L("no candidate for", offset); continue; }
      const cb = f.locator('[data-testid="pd-attachment-check"]').nth(idx);
      const pre = await measure(f, idx);
      if (CHECK === "firsttick") { await cb.focus(); await sleep(200); await page.keyboard.press("Space"); } else await press(cb);
      await sleep(900);
      const post = await measure(f, idx);
      L(`offset ${offset}: idx ${idx} pre ${JSON.stringify(pre.box)} st ${pre.scrollTop} ->`, post, (post.boxCovered || post.rowCovered) ? "COVERED" : "clear");
      await shot(`${CHECK}-${offset}`);
      if (CHECK === "firsttick") { await page.keyboard.press("Space"); } else await press(cb);
      await sleep(700);
      L("  untick ->", await measure(f, idx));
    }
  }
  if (CHECK === "macro") {
    await go(page, REALM); const f = await devFrame(page, ".space-admin-title");
    const mt = f.locator(".tab-navigation .tab-button", { hasText: "Macro" }).first();
    // phone-390: a Playwright click on a tab is a known tool artefact there (breaker round 2); a real touch press works
    if (TOUCH) { await mt.scrollIntoViewIfNeeded().catch(() => {}); await sleep(300); L("tab press", await press(mt)); } else await mt.click();
    await sleep(3000);
    L("active tab", (await f.locator(".tab-navigation .tab-button.active").innerText().catch(() => "?")).trim());
    L("served build", await f.locator("[data-sv-build]").first().getAttribute("data-sv-build").catch(() => "?"));
    const info = await f.evaluate(() => [...document.querySelectorAll(".checkbox-control")].map((l) => { const i = l.querySelector("input"), t = l.querySelector(".checkbox-label"); const ir = i.getBoundingClientRect(), tr = t.getBoundingClientRect(); const af = getComputedStyle(i, "::after"); const m = /matrix\(([^)]+)\)/.exec(af.transform); const tx = m ? Number(m[1].split(",")[4]) : 0;
      const knobL = ir.left + parseFloat(af.left) + tx, knobR = knobL + parseFloat(af.width);
      return { label: t.innerText, checked: i.checked, disabled: i.disabled, track: [Math.round(ir.left), Math.round(ir.right), Math.round(ir.width), Math.round(ir.height)], radius: getComputedStyle(i).borderRadius, knob: [Math.round(knobL), Math.round(knobR), parseFloat(af.width), parseFloat(af.height)], knobPastTrack: Math.round(knobR - ir.right), gapToLabel: Math.round(tr.left - knobR), trackMidY: Math.round(ir.top + ir.height / 2), labelMidY: Math.round(tr.top + tr.height / 2), coarse: matchMedia("(pointer: coarse)").matches }; }));
    L(info);
    const first = f.locator(".checkbox-control").first();
    await first.scrollIntoViewIfNeeded().catch(() => {}); await sleep(400);
    const bb = await first.boundingBox(); const fe = await f.frameElement(); const fb = await fe.boundingBox();
    await shot("1");
    if (bb) await page.screenshot({ path: path.join(OUT, "2-switch-clip.png"), clip: { x: Math.max(0, bb.x - 24), y: Math.max(0, bb.y - 60), width: Math.min(W - Math.max(0, bb.x - 24), 360), height: 160 } }).catch((e) => L("clip err", String(e).slice(0, 80)));
  }
} catch (e) { L("ERROR", String(e).slice(0, 400)); await shot("error"); }
finally { await close(); }
