// The pure keyboard models behind kit/ActionMenu.jsx (the ⋯ menu) and kit/RovingList.jsx (the
// card lists): where each key moves the active item. The DOM half (focus, portal, Escape → focus
// return) is proven live by forge-live-harness/scenarios/sentinel-vault/a11y.spec.ts.
import { nextMenuIndex, nextCardIndex } from "../src/ui/kit/menu-keys.js";
import { eq, report } from "./_assert.mjs";

// ── menu: wraps ──────────────────────────────────────────────────────────────────────────────
eq("ArrowDown moves to the next item", nextMenuIndex("ArrowDown", 0, 3), 1);
eq("ArrowDown wraps from the last to the first", nextMenuIndex("ArrowDown", 2, 3), 0);
eq("ArrowUp moves to the previous item", nextMenuIndex("ArrowUp", 2, 3), 1);
eq("ArrowUp wraps from the first to the last", nextMenuIndex("ArrowUp", 0, 3), 2);
eq("Home → first", nextMenuIndex("Home", 2, 3), 0);
eq("End → last", nextMenuIndex("End", 0, 3), 2);
eq("a non-navigation key is left alone", nextMenuIndex("a", 1, 3), null);
eq("Escape is not navigation (the hook closes on it)", nextMenuIndex("Escape", 1, 3), null);
eq("Enter is not navigation (the button's click fires)", nextMenuIndex("Enter", 1, 3), null);
eq("an empty menu never moves", nextMenuIndex("ArrowDown", 0, 0), null);
eq("a single item stays put on ArrowDown", nextMenuIndex("ArrowDown", 0, 1), 0);
eq("an out-of-range active index is treated as the first item", nextMenuIndex("ArrowDown", 9, 3), 1);
eq("a negative active index is treated as the first item", nextMenuIndex("ArrowUp", -1, 3), 2);

// ── card list: clamps (a list has ends; a menu is a ring) ────────────────────────────────────
eq("ArrowDown moves to the next card", nextCardIndex("ArrowDown", 0, 3), 1);
eq("ArrowDown on the last card stays (no wrap in a list)", nextCardIndex("ArrowDown", 2, 3), 2);
eq("ArrowUp on the first card stays", nextCardIndex("ArrowUp", 0, 3), 0);
eq("Home → first card", nextCardIndex("Home", 2, 3), 0);
eq("End → last card", nextCardIndex("End", 0, 3), 2);
eq("ArrowRight is not a row move", nextCardIndex("ArrowRight", 0, 3), null);
eq("an empty list never moves", nextCardIndex("ArrowDown", 0, 0), null);

report("action-menu");
