# Sentinel Vault — Design Tokens, Brand Ground Truth & Motion Signature

AQL reference. Every hex/curve value in §2–§4 is a REAL extracted value — from
`~/.claude/skills/leanzero-management/references/brand.md` (canonical LeanZero brand, itself sourced
from the LeanZero-website tailwind/globals) or from this repo's `src/ui/tokens/*.css`. Proposed items
(§5 motion signature, §6 data face) are explicitly marked PROPOSED. Deviations live in §7.

Companion facts: theme switching is Confluence `data-color-mode` on `<html>` via
`kit/palette-sync.js` (`view.theme.enable()`); every surface is its own iframe bundle, so tokens must
ship inside each bundle's CSS (Forge CSP: no external fonts/CDNs, no inline `@keyframes` — keyframes
live in bundled CSS files).

---

## 1. Owner HARD RULES (verbatim, non-negotiable, override everything below)

- never left accent lines/rails on any component
- never faded/washed-out 8-12% tints — solid saturated accent colors only
- never browser-native UI primitives (window.alert/confirm/prompt, native `<select>`)
- avoid the three AI-default looks (cream #F4F1EA + serif + terracotta #D97757; near-black + acid-green; broadsheet hairlines/zero radius)

Current compliance is GOOD on rails/tints/natives: zero `border-left` accent rails, zero
`color-mix()` washes, zero decorative gradients across all 9 token sheets; all confirm/prompt flows
are custom inline bars and all dropdowns are custom. Do not "fix" these. Known violations of the
tint rule: overlay's macro-visibility banner uses `rgba(0,135,90,0.04)` washes (see §7).

---

## 2. Canonical LeanZero palette (brand ground truth — exact extracted values)

| Role | Light | Dark | Notes |
|---|---|---|---|
| Primary | `#1d4ed8` | `#3b82f6` | Brand lead (blue-700 / blue-500). Light = saturated accent bands w/ white ink; dark = luminous glow `rgba(59,130,246,…)` |
| Primary buttons | `#2563eb` (600→500 gradient) | `#60a5fa` hover | |
| Secondary | `#0891b2` | `#06b6d4` | Cyan — this is the hue Sentinel Vault currently leads with |
| Accent | `#7c3aed` | `#a855f7` | Purple = critical/exhausted semantics in brand; SV uses it for AI |
| Rainbow | `#db2777` pink, `#ea580c` orange | `#ec4899`, `#f97316` | Solid saturated card borders/markers |
| Success | `#16a34a` | `#22c55e` | |
| Warning | `#d97706` | `#f59e0b` | Amber |
| Error | `#dc2626` | `#ef4444` | |
| Canvas | `#dee7f3` "architectural paper" | `#0a0a0f` | Light canvas sits ~17 L* below white so cards POP |
| Card | `#f5f7fd` (true `#fff` reserved for vivid 2px-colored-border cards) | `#1a1a24` (surface `#13131a`) | |
| Border | — (brand.md gives none for light) | `#2a2a3a` | |
| Text | `#0f172a`; muted floor `#475569` (never lighter; ≤12px goes one step darker) | `#f5f5f7`; muted `#a0a0b0` | |

Brand personality: light = architectural blueprint / drafting table (blue paper, drifting grid,
paper grain, edge tick marks, §-markers); dark = luminous near-black dev-tech (glass blur 12–24px +
saturate 180%). Brand.md: "wages war on pastels: -50/-100 tints get converted to saturated -600
pills."

---

## 3. Semantic token architecture (target)

Naming: keep the `--sv-` namespace (established across all surfaces) with semantic middles —
`--sv-surface*`, `--sv-line*`, `--sv-ink*`, `--sv-accent-*`. Every token MUST have a light value in
`:root` and a dark value in `html[data-color-mode="dark"]` — full parity, no exceptions. One source
block, mirrored verbatim into each bundle's sheet (until the duplication itself is fixed — §7.1).

### 3.1 Neutrals (values extracted from foundation.css — the app's Confluence-embedded context)

| Token | Light | Dark | Replaces |
|---|---|---|---|
| `--sv-surface` | `#FFFFFF` | `#020617` | `--sv-bg-primary` |
| `--sv-surface-sunken` | `#F8FAFC` | `#0F172A` | `--sv-bg-secondary` |
| `--sv-surface-raised` | `#FFFFFF` | `#1E293B` | `--sv-surface-raised` / `--sv-bg-elevated` |
| `--sv-surface-overlay` | `#FFFFFF` | `#0F172A` | `--sv-surface-overlay` (doc-ribbon dark has drifted to `#1E293B` — pick ONE) |
| `--sv-scrim` | `rgba(0,0,0,0.45)` | `rgba(2,6,23,0.75)` | `--sv-bg-overlay` |
| `--sv-line` | `#E2E8F0` | `#334155` | `--sv-border-primary/-secondary` |
| `--sv-line-focus` | `#0891B2` | `#22D3EE` | `--sv-border-focus` |
| `--sv-ink` | `#0F172A` | `#F8FAFC` | `--sv-text-primary` |
| `--sv-ink-muted` | `#475569` | `#CBD5E1` | `--sv-text-secondary` (light muted floor per brand: never lighter than `#475569`) |
| `--sv-ink-subtle` | `#94A3B8` | `#64748B` | `--sv-text-subtle` |
| `--sv-ink-on-accent` | `#FFFFFF` | `#0F172A` | `--sv-text-on-primary` |

### 3.2 Accents (solid, saturated — never tinted washes)

Semantic split that fixes the current collapse (today primary == success == info == seal, all cyan):

| Token | Light | Dark | Meaning in Sentinel Vault | Value source |
|---|---|---|---|---|
| `--sv-accent-primary` | `#1d4ed8` | `#3b82f6` | Brand lead: primary actions, active tabs, wordmark | brand.md primary |
| `--sv-accent-seal` | `#0891B2` | `#22D3EE` | Custody/seal state: sealed-by-me borders, seal buttons, shield | current app cyan (brand secondary) |
| `--sv-accent-positive` | `#16a34a` | `#22c55e` | Success/pass (validation passed, restore succeeded) | brand success |
| `--sv-accent-caution` | `#d97706` | `#f59e0b` | Warning/hold: sealed-by-other, awaiting approval, expiring | brand warning (app already uses `#F59E0B` hardcoded) |
| `--sv-accent-critical` | `#dc2626` | `#F87171` | Danger/violation/blocked/destructive | app danger (light matches brand error; dark `#F87171` is the app's proven dark value) |
| `--sv-accent-ai` | `#7c3aed` | `#a855f7` | Semantic AI review (chips, run button, findings) | brand accent purple (app already hardcodes `#7C3AED`) |

DECISION FLAG (honest confidence note): making `--sv-accent-primary` brand blue re-hues every
primary button/tab across all 7 surfaces — large blast radius, purely for awareness. It follows
brand.md's own drift guidance (it flags the same class of drift in the PPM app: "migrate emerald
drift to brand blue"), and the cyan identity survives as the seal/custody color, which is arguably
MORE on-subject. The conservative alternative is keeping cyan as primary and skipping blue entirely.
I am confident in the token architecture either way; the blue-vs-cyan lead is a taste call the loop
owner should ratify before the first design iteration applies it.

Rules for accent usage: full-strength fills with `--sv-ink-on-accent` text, or full-strength
text/borders on neutral surfaces. Status backgrounds may use the existing solid dark-mode wells
(e.g. `#083344` under `#22D3EE` text) — those are real extracted pairs — but NEVER an rgba/percent
wash of the accent. The off-palette indigo `#6366F1` ("locked-by-me" card border) is not a brand hue
and should migrate to `--sv-accent-seal`.

### 3.3 Brand-canvas option for owned surfaces (distinctiveness lever)

Embedded surfaces (doc-ribbon, inline-panel, section badge) sit inside Confluence's page and must
stay canvas-neutral (§3.1 values). The app-OWNED chrome — overlay modal, realm-console,
steward-console — may adopt the brand canvas for real LeanZero identity:
light canvas `#dee7f3` + card `#f5f7fd` (white reserved for vivid-border cards); dark canvas
`#0a0a0f` + surface `#13131a` + card `#1a1a24` + border `#2a2a3a`. Plus the blueprint devices:
mono §-marker eyebrows, edge tick marks. PROPOSED, not yet in the app; confidence medium — needs a
screenshot pass to confirm it doesn't clash with Confluence chrome around the spacePage/globalSettings
iframes.

---

## 4. Typography, spacing, radius (extracted)

- **Family:** `--sv-font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif`. Inter is named first but NOT bundled — in the Forge iframe it falls through to the system stack. Remediation option: bundle Inter woff2 inside each static resource with a local `@font-face` (CSP allows same-origin assets; external fonts/CDN forbidden). Confidence medium until verified in a deployed iframe.
- **Brand editorial weights (light mode):** h1 900/-0.028em, h2 800/-0.022em, h3 700/-0.015em; dark mode one step lighter; buttons semibold. App currently uses none of these.
- **Signature device:** monospace uppercase eyebrows / §-markers, 10–11px, 0.18–0.25em tracking, font-black in light mode (live on leanzero.net as `§01`, `LZ·/OVERVIEW·REV 2.6`). Absent from the app.
- **Body:** 14px / 1.5, antialiased.
- **Spacing (8px base):** `--sv-space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64px. Defined only in foundation.css and consumed by nothing else — the other 8 sheets use raw px.
- **Radius:** `--sv-radius-sm 6px`, `-md 10px`, `-lg 16px`, `-full 9999px` (surfaces mostly hardcode raw values).

### Data face (PROPOSED — brand has no named tabular-numerals face)

Grep-verified: no monospace/tabular declaration exists anywhere in the app, and brand.md names none —
the mono eyebrow device is the closest brand precedent. Sentinel Vault is full of live numerals
(countdowns "35h 59m", expiry timestamps, token budgets, finding counts) that currently jitter as
digits change width. Proposal:

```css
--sv-font-data: ui-monospace, "SF Mono", Menlo, Consolas, monospace; /* eyebrows, seal ids, §-markers */
.sv-num { font-variant-numeric: tabular-nums; } /* countdowns, counters, budgets — keeps Inter/system face, fixes digit width */
```

Zero-download, CSP-safe, and doubles as the brand eyebrow face. High confidence.

---

## 5. MOTION SIGNATURE (PROPOSED) — "the vault asserts custody"

Grounded in the subject: sealing, protection, custody, restoration. Motion should feel like
**mass and mechanism** — things seat, engage, and hold; nothing floats or bounces. Today the app has
NO motion tokens, uses Material's `cubic-bezier(0.4,0,0.2,1)` instead of the house curve, and its
richest motion lives on the wrong surface (overlay has entrance stagger; the flagship inline-panel
has none).

### 5.1 One house easing + duration set (the ONLY motion tokens)

```css
--sv-ease:          cubic-bezier(0.22, 1, 0.36, 1); /* LeanZero house curve — decisive start, firm settle */
--sv-dur-tap:       120ms;  /* hover/press/caret micro-feedback */
--sv-dur-state:     200ms;  /* color/border/chip state changes (matches current global 200ms) */
--sv-dur-enter:     250ms;  /* entrances, expands (matches current sv-slide-in 0.25s) */
--sv-dur-assert:    550ms;  /* one-shot narrative moves: seal engage, restore sweep */
```

Replaces: global `cubic-bezier(0.4,0,0.2,1)`, `sv-slide-in`'s `cubic-bezier(0.16,1,0.3,1)`, and all
ad-hoc `ease`/`ease-in-out` on non-looping transitions. Looping indicators (skeleton-pulse, busy
bars) keep `ease-in-out` — loops need symmetry, and those durations (1.2s) stay as-is.

### 5.2 The reusable transition set (five moves, no more)

1. **Seal engage** (seal succeeds; section sealed): the card presses and seats — `scale(1) →
   scale(0.985) → scale(1)` with border snapping to `--sv-accent-seal`; `--sv-dur-assert`,
   `--sv-ease`. A stamp seating into wax. Transform + border-color only.
2. **Restore sweep** (app reverted/restored content; ribbon violation alert appears): a single
   directional highlight sweep across the affected card/alert, left→right, reusing the existing
   `btn-slide`/skeleton sweep gradient language; `--sv-dur-assert`, one-shot. Reads as "custody
   reasserted." Never loops.
3. **Held-fast nudge** (blocked action: seal denied, edit refused, gated button): the control moves
   2px in the action's direction and firmly returns — ONE excursion, ~180ms, `--sv-ease`. It's a
   locked handle being tried, not a cartoon shake. Always paired with the inline error text.
4. **Custody shift** (state chip/border changes: mine → other → available → expired): plain
   border-color/background-color transition, `--sv-dur-state`, `--sv-ease`. No movement — status
   changes are facts, not events.
5. **Entrance** (cards/rows/groups appearing): translateY(8px) + fade to rest, `--sv-dur-enter`,
   `--sv-ease`, stagger 45ms **capped at 6** (app-scale adaptation of the brand's 105ms/cap-6
   website stagger). Standardize the existing `sv-card-appear`/`sv-row-appear` onto this and give
   it to inline-panel, which currently has none.

### 5.3 Non-negotiable execution rules

- **60fps required:** animate `transform` and `opacity` (plus border-color/background-color for
  `--sv-dur-state` micro-changes only). Never width/height/top/left/margin; no `filter: blur()`
  animation inside the Forge iframes.
- **Keyframes in bundled CSS files only** — Forge CSP disallows inline `@keyframes` (brand.md app
  note).
- **`prefers-reduced-motion: reduce` mandatory in every sheet, zero information loss:** every move
  collapses to its instant final state; anything motion communicates must also exist statically
  (restore sweep → the alert text/flag it accompanies; held-fast nudge → the inline error; seal
  engage → the border/status change). Currently the guard exists in controls/overlay/inline-panel/
  realm-console and is MISSING in doc-ribbon, panel-setup, section-setup, steward-console — closing
  those four is part of adopting this signature.

---

## 6. Appendix A — remediation: current deviations from this document

### 6.1 Systemic (all surfaces)

1. **Token triplication:** all 9 sheets re-declare a full `:root`+dark token block; panel-setup uses
   a parallel `--mc-*` namespace and section-setup `--sec-*` for the same values. Any palette change
   is 9 synchronized edits; doc-ribbon has already drifted (dark `--sv-surface-overlay #1E293B` vs
   foundation `#0F172A`; its `--sv-shadow-*` are bare rgba colors while foundation's are full
   box-shadow values — same token name, different value shape).
2. **Semantic collapse:** `--sv-status-success` == info == interactive-primary == `#0891B2/#22D3EE`;
   brand success green unused. `--sv-status-warning` is actually red `#DC2626` (brand ERROR hue) —
   semantics shifted one notch hot; real amber exists only as hardcoded chips.
3. **Brand primary blue absent** everywhere; app is cyan-led (brand secondary). See §3.2 decision flag.
4. **Canvas:** plain white/slate + slate-dark `#020617` instead of brand paper `#dee7f3` / near-black
   `#0a0a0f`; zero blueprint devices (grid, tick marks, §-markers, mono eyebrows).
5. **Typography:** Inter unbundled (system stack in practice); no editorial weights; no eyebrow
   device; no tabular numerals anywhere.
6. **Motion:** no motion tokens; Material easing instead of house curve; brand vocabulary absent;
   reduced-motion guard missing in doc-ribbon.css, panel-setup.css, section-setup.css,
   steward-console.css.
7. **Spacing/radius tokens unconsumed** outside foundation.css (raw px everywhere else).

### 6.2 Per surface (hardcoded / off-brand values)

| Surface | Deviations |
|---|---|
| **doc-ribbon** | Hardcoded chips `.ribbon-chip-awaiting-approval #F59E0B/#1F2937`, `.ribbon-chip-ai #7C3AED` (L376–377); alert block `#FFFBEB/#1A1500/#D97706/#FBBF24` (L278–301); dark `--sv-surface-overlay` drift + shadow-token shape mismatch + dark `.sv-text-inverse` fallback `#020617`; no reduced-motion guard. |
| **inline-panel** | Artifact-card status borders hardcoded L253–290 (`#0891B2`, `#6366F1` indigo — OFF-PALETTE entirely, `#F59E0B`, `#EF4444`, `#9CA3AF`, `#6B7280` + dark twins); ADS `--ds-*` fallback hexes leaking L453–494 (`#fff7d6`, `#7f5f01`, `#ca3521`, `#ae2a19`, `#626f86`, `#dcdfe4`, `#f1f2f4`); trashed lozenge `#FEF3C7/#92400E` (dark `#78350F/#FDE68A`) L579–584; AI purple `#7C3AED/#6D28D9` + amber chips L792–803; validation chip `#B45309` L1271–1293; filetype icon AUI greens/reds `#36B37E`, `#FF5630` in JSX; no entrance animation on primary cards. |
| **overlay** | Macro-visibility banner + footer built from inline style objects with AUI hexes `#00875A`, `#DE350B`, `#97A0AF` and `rgba(0,135,90,0.04)` washes — the app's only faded-tint violation of the hard rules; artifact-card borders L415–426; lozenge L550+; no focus-visible rule in its own sheet. |
| **realm-console** | Artifact-card borders L1167–1174; `.val-rule-remove color:#fff` L1749; heavy ad-hoc inline styles (badges, spacing, empty states); layout: reservation-card meta line collides at narrow width. |
| **steward-console** | `color:#fff` L547; thinnest dark coverage (1 dark sub-block); sticky "Apply Configuration" bar clips the last settings row (visible in steward-console.png); no reduced-motion guard. |
| **panel-setup** | Clean values but parallel `--mc-*` namespace (incl. `mc-green` = cyan `#0891B2` — same semantic collapse); no reduced-motion guard. |
| **section-setup** | Parallel `--sec-*` namespace; zero motion of any kind; foundation.css not in its bundle (inherits nothing). |

### 6.3 What is already RIGHT (do not regress)

Zero left accent rails; zero color-mix/percent washes outside the overlay banner; zero decorative
gradients; custom dialogs and dropdowns everywhere (no native primitives); structural light/dark
parity in all 9 sheets with explicit dark twins for hardcoded status hues; dark mode genuinely
implemented end-to-end via `data-color-mode`.
