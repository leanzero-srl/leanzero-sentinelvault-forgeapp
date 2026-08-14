/**
 * THE Sentinel Vault brand mark — "The Sealed Shield".
 *
 * A white shield with a keyhole cut through it, on a solid seal-cyan tile.
 * The shield is the promise (protection), the keyhole is the mechanism (a
 * seal only its holder can open). Flat, two bodies, no gradients, no
 * hairlines — the same constraints as the LeanZero Management mark: every
 * load-bearing feature is thick enough to survive 16px, and the drawing is
 * authored ONCE here and injected into every template's [data-brand-mark]
 * slot by render.mjs, so the listing logo, the banner and the highlights can
 * never drift apart.
 *
 * This MODERNIZES the March 2026 identity (blue #0065FF gradient shield with
 * a full padlock, src/ui/assets/icons/icon.svg): same shield-and-lock story,
 * but re-hued to the app's actual seal cyan (#0891B2 — the color every Seal
 * button and sealed border in the product wears) and simplified from
 * shackle+body+keyhole to a single keyhole, which is what actually survives
 * small sizes. The in-app icon.svg is NOT changed by this file; migrating it
 * is a separate, deliberate step.
 *
 * NOTE: no width/height attributes on the <svg> — render.mjs injects them
 * per-slot (duplicate-attribute order makes the injected pair win, but
 * omitting them here keeps the file honest).
 */

export const MARK_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" role="img" aria-labelledby="svmT"><title id="svmT">Sentinel Vault</title><rect width="144" height="144" rx="30" fill="#0891B2"/><path d="M72 22L118 40V72C118 100.4 98.9 122.9 72 130C45.1 122.9 26 100.4 26 72V40L72 22Z" fill="#FFFFFF"/><circle cx="72" cy="68" r="14" fill="#0891B2"/><path d="M64 76L60 104H84L80 76Z" fill="#0891B2"/></svg>`;

/**
 * Glyph-only version (white shield on transparent) for dark surfaces where a
 * cyan tile would double-border — currently unused by the templates, kept so
 * the next surface does not redraw the shield.
 */
export const MARK_GLYPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" role="img" aria-labelledby="svmG"><title id="svmG">Sentinel Vault</title><path d="M72 10L126 31V72C126 105.2 103.6 131.6 72 140C40.4 131.6 18 105.2 18 72V31L72 10Z" fill="#FFFFFF"/><circle cx="72" cy="64" r="16" fill="#0891B2"/><path d="M63 73L58 106H86L81 73Z" fill="#0891B2"/></svg>`;
