// Which Forge modal size the page-details hub opens at (device matrix 2026-10-06, SV-16 / M-04).
// A "large" Confluence modal gives its iframe a FIXED ~720 px height: on a portrait phone that left
// a 124-212 px dead band under the footer, and on a landscape phone (390 px tall) the modal ran
// 400 px past the screen with nested scrolling. "max" fits the frame to the screen — but on a
// desktop it would stretch the 800 px hub across 1,200-2,400 px, so it is chosen for phones only.
// A phone is a screen whose SHORT side is under 600 CSS px (every phone in either orientation; the
// smallest iPad is 744). `screen` is the device, not the 44 px banner frame the code runs in.
export const PHONE_SHORT_SIDE = 600;

export function detailsModalSize(screenLike) {
  const w = Number(screenLike?.width);
  const h = Number(screenLike?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "large";
  return Math.min(w, h) < PHONE_SHORT_SIDE ? "max" : "large";
}
