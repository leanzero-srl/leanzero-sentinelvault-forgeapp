/*
 * ELZI'S TOUR - the tour's own sheet, injected once by Tour.jsx. It ships in the
 * tour's lazy chunk, not in the page's entry bundle.
 * Paper look: straight corners, a 2px ink line, a hard offset shadow in solid blue (no blur),
 * solid chip and ring colours, no rail, no tint. The dim layer is four blocks round the
 * highlighted element, so the element itself stays clickable. Uses the glance's own tokens
 * (--card-bg, --text-color, --fs-*, --fw-*) and its .cw-btn buttons.
 */
export const TOUR_CSS = [
  ".nux-dim { position: absolute; top: 0; left: 0; width: 100%; height: 0; z-index: 2147482000; pointer-events: none; }",
  ".nux-dim-block { position: absolute; background: rgba(11, 18, 35, 0.62); pointer-events: auto; }",
  "html[data-color-mode=\"dark\"] .nux-dim-block { background: rgba(0, 0, 0, 0.72); }",
  // the ring sits RING_GAP px outside the element (tourSteps.js); its width comes inline (RING_W)
  ".nux-ring { position: absolute; z-index: 2147482001; border: 3px solid #f97316; box-sizing: border-box; pointer-events: none; }",
  ".nux-spacer { display: block; width: 1px; }",
  ".nux-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }",
  ".nux-elzi-wrap { position: absolute; z-index: 2147482002; line-height: 0; pointer-events: none; }",
  ".nux-elzi { display: block; overflow: visible; }",
  ".nux-elzi-bob { animation: nuxBob 2.4s ease-in-out infinite; }",
  "@keyframes nuxBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-22px); } }",
  ".nux-bubble { position: absolute; z-index: 2147482003; box-sizing: border-box; background: var(--sv-bg-elevated); color: var(--sv-text-primary); border: 2px solid #0b1223; border-radius: 0; box-shadow: 5px 5px 0 #0E7490; padding: 10px 12px 10px; }",
  "html[data-color-mode=\"dark\"] .nux-bubble { border-color: #e2e8f0; box-shadow: 5px 5px 0 #22d3ee; }",
  // focused on purpose (an auto start, a click): no ring on the bubble; its buttons keep :focus-visible
  ".nux-bubble:focus { outline: none; }",
  // THE TAIL: an ink triangle with a card-coloured one inside it, on the bubble edge that faces the
  // ring (up / down) or Elzi (left / right, the hello). The inner one runs 2 px into the bubble so it
  // covers the border where the tail joins. Its position along the edge comes inline (tourSteps.js).
  ".nux-tail { position: absolute; width: 0; height: 0; pointer-events: none; }",
  ".nux-tail::before, .nux-tail::after { content: \"\"; position: absolute; width: 0; height: 0; border-style: solid; }",
  ".nux-tail-up { top: -14px; margin-left: -10px; width: 20px; height: 12px; }",
  ".nux-tail-up::before { left: 0; top: 0; border-width: 0 10px 12px 10px; border-color: transparent transparent #0b1223 transparent; }",
  ".nux-tail-up::after { left: 4px; top: 6px; border-width: 0 6px 8px 6px; border-color: transparent transparent var(--sv-bg-elevated) transparent; }",
  ".nux-tail-down { bottom: -14px; margin-left: -10px; width: 20px; height: 12px; }",
  ".nux-tail-down::before { left: 0; top: 0; border-width: 12px 10px 0 10px; border-color: #0b1223 transparent transparent transparent; }",
  ".nux-tail-down::after { left: 4px; top: -2px; border-width: 8px 6px 0 6px; border-color: var(--sv-bg-elevated) transparent transparent transparent; }",
  ".nux-tail-left { left: -14px; margin-top: -10px; width: 12px; height: 20px; }",
  ".nux-tail-left::before { left: 0; top: 0; border-width: 10px 12px 10px 0; border-color: transparent #0b1223 transparent transparent; }",
  ".nux-tail-left::after { left: 6px; top: 4px; border-width: 6px 8px 6px 0; border-color: transparent var(--sv-bg-elevated) transparent transparent; }",
  ".nux-tail-right { right: -14px; margin-top: -10px; width: 12px; height: 20px; }",
  ".nux-tail-right::before { left: 0; top: 0; border-width: 10px 0 10px 12px; border-color: transparent transparent transparent #0b1223; }",
  ".nux-tail-right::after { left: -2px; top: 4px; border-width: 6px 0 6px 8px; border-color: transparent transparent transparent var(--sv-bg-elevated); }",
  "html[data-color-mode=\"dark\"] .nux-tail-up::before { border-bottom-color: #e2e8f0; }",
  "html[data-color-mode=\"dark\"] .nux-tail-down::before { border-top-color: #e2e8f0; }",
  "html[data-color-mode=\"dark\"] .nux-tail-left::before { border-right-color: #e2e8f0; }",
  "html[data-color-mode=\"dark\"] .nux-tail-right::before { border-left-color: #e2e8f0; }",
  ".nux-count { display: inline-block; background: #0E7490; color: #ffffff; font-size: 12px; font-weight: 600; line-height: 16px; padding: 1px 6px; margin-bottom: 6px; }",
  ".nux-title { font-size: 16px; font-weight: 700; line-height: 20px; color: var(--sv-text-primary); }",
  ".nux-text { margin: 4px 0 10px; font-size: 14px; line-height: 19px; color: var(--sv-text-primary); }",
  ".nux-btns { display: flex; align-items: center; gap: 8px; }",
  // a module's own small Tour button (TourReplay.jsx), right-aligned over its list
  ".nux-replay-row { display: flex; justify-content: flex-end; margin: 0 0 4px; }",
  ".nux-replay-btn { font-size: 12px; padding: 2px 8px; border-radius: 0; }",
  ".nux-btns-go { margin-left: auto; display: inline-flex; gap: 6px; }",
  // straight corners on the bubble's buttons, whichever app's classes they carry (owner rule: no rounded corners)
  ".nux .nux-btns button { border-radius: 0; }",
  // the console's own .btn-primary / .btn-secondary carry a 12 x 32 px padding meant for a page; in the bubble they are compact so Skip, Back and Next always fit
  ".nux .nux-btns button { padding: 7px 14px; font-size: 14px; line-height: 20px; min-width: 0; transform: none; box-shadow: none; white-space: nowrap; }",
  ".nux .nux-btns button:hover, .nux .nux-btns button:active { transform: none; box-shadow: none; }",
  ".nux .nux-replay-btn { padding: 2px 8px; font-size: 12px; }",
  ".nux-small .nux-bubble { padding: 8px 10px; }",
  ".nux-small .nux-title { font-size: 14px; }",
  "@media (prefers-reduced-motion: reduce) { .nux-elzi-bob { animation: none; } }",
].join("\n");

export const injectTourStyles = (doc = document) => {
  if (!doc || doc.getElementById("nux-tour-style")) return;
  const el = doc.createElement("style");
  el.id = "nux-tour-style";
  el.textContent = TOUR_CSS;
  doc.head.appendChild(el);
};
