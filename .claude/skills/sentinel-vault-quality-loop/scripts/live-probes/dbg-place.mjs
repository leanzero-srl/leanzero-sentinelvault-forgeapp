import fs from "node:fs";
import { launch, go, devFrame, REALM, sleep } from "./lib.mjs";
import { placeFloat } from "../../../../../src/ui/kit/float-placement.js";
const { page, close } = await launch({ w: 360, h: 780, touch: true, dpr: 2, tag: "dbgplace" });
try {
  await go(page, REALM); const f = await devFrame(page, ".space-admin-title");
  await f.locator(".tab-navigation .tab-button", { hasText: "Validations" }).first().click(); await sleep(3000);
  const box = f.locator('.val-modes input[type="checkbox"]').first();
  await box.scrollIntoViewIfNeeded(); await sleep(300);
  await box.tap(); await sleep(1200);
  const inp = await f.evaluate(async () => {
    const fl = document.querySelector(".sv-unsaved-float");
    const C = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], [role="menu"], [tabindex]:not([tabindex="-1"])';
    const R = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    const controls = [...document.querySelectorAll(C)].filter((e) => !fl.contains(e)).map((e) => R(e.getBoundingClientRect())).filter((r) => r.right > r.left && r.bottom > r.top);
    const content = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.nodeValue.trim() || fl.contains(n.parentNode)) continue; rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width && r.height) content.push({ ...R(r), t: n.nodeValue.trim().slice(0, 16) }); }
    for (const e of document.querySelectorAll('svg, img, canvas, video, [role="img"]')) { if (fl.contains(e)) continue; const r = e.getBoundingClientRect(); if (r.width && r.height) content.push({ ...R(r), t: "icon" }); }
    const band = await new Promise((res) => { const io = new IntersectionObserver((es) => { io.disconnect(); const r = es[0].intersectionRect; res(R(r)); }); io.observe(document.documentElement); });
    const target = R(document.querySelector('.val-modes input[type="checkbox"]').closest('label').getBoundingClientRect());
    const tgtInput = R(document.querySelector('.val-modes input[type="checkbox"]').getBoundingClientRect());
    const fr = fl.getBoundingClientRect();
    return { controls, content, band, target, tgtInput, float: { ...R(fr), spot: fl.dataset.spot, w: fr.width, h: fr.height }, W: innerWidth, H: innerHeight };
  });
  fs.writeFileSync("dbg-place.json", JSON.stringify(inp));
  console.log("band", JSON.stringify(inp.band), "target", JSON.stringify(inp.target), "float", JSON.stringify(inp.float));
  const near = inp.content.filter((r) => r.bottom > inp.target.top - 200 && r.top < inp.target.bottom + 80).map((r) => `${r.t}@${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`);
  console.log("text near:", near.join(" | "));
  console.log("controls near:", inp.controls.filter((r) => r.bottom > inp.target.top - 200 && r.top < inp.target.bottom + 80).map((r) => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`).join(" | "));
  const spot = placeFloat({ target: inp.target, anchor: null, size: { width: 334, height: 84 }, compact: { width: inp.float.w, height: inp.float.h }, view: { width: inp.W, height: inp.H, ...inp.band }, controls: inp.controls, content: inp.content });
  console.log("replayed:", JSON.stringify(spot));
} catch (e) { console.log("ERR", String(e).slice(0, 300)); } finally { await close(); }
