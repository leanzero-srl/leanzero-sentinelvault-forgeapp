// A small CSS reader for the responsive gates: every style rule with the at-rule conditions it sits
// in, its source order, and its declarations. Enough of the cascade to answer "does a narrow-frame
// override actually WIN?" without a browser (BR-01 / M-06, 2026-10-07: a <=640 px reset sat ABOVE
// the base rule it meant to reset, same specificity, so the base rule won and every stacked
// settings row was 260 px tall — while a test that only checked the reset's TEXT stayed green).

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** Parse a sheet into [{ sel: string[], decls: [{prop, value, important}], at: string[], order }]. */
export function parseSheet(text) {
  const t = strip(text);
  const out = [];
  let order = 0;
  const walk = (start, end, at) => {
    let i = start;
    while (i < end) {
      const open = t.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const head = t.slice(i, open).trim();
      // find the matching close
      let depth = 0, j = open;
      for (; j < end; j++) { if (t[j] === "{") depth++; else if (t[j] === "}" && --depth === 0) break; }
      const body = t.slice(open + 1, j);
      // a statement at-rule (@import …;) before the head is skipped by taking the text after the last ';'
      const h = head.includes(";") && !head.startsWith("@") ? head.slice(head.lastIndexOf(";") + 1).trim() : head.replace(/^[^@]*;\s*(?=@)/, "").trim();
      if (h.startsWith("@")) {
        if (/^@(media|container|supports|layer)\b/.test(h)) walk(open + 1, j, [...at, h.replace(/\s+/g, " ")]);
        // @keyframes, @font-face… hold no selectors we compare
      } else if (h) {
        const decls = [];
        for (const d of body.split(";")) {
          const k = d.indexOf(":");
          if (k < 0) continue;
          const prop = d.slice(0, k).trim().toLowerCase();
          let value = d.slice(k + 1).trim();
          const important = /!important\s*$/i.test(value);
          if (important) value = value.replace(/\s*!important\s*$/i, "");
          if (prop) decls.push({ prop, value: value.replace(/\s+/g, " "), important });
        }
        out.push({ sel: h.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean), decls, at, order: order++ });
      }
      i = j + 1;
    }
  };
  walk(0, t.length, []);
  return out;
}

// Longhands each shorthand sets (only the families the app's sheets use).
const SHORT = {
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  overflow: ["overflow-x", "overflow-y"],
  gap: ["row-gap", "column-gap"],
  inset: ["top", "right", "bottom", "left"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  "grid-template": ["grid-template-columns", "grid-template-rows", "grid-template-areas"],
  background: ["background-color", "background-image"],
  border: ["border-top", "border-right", "border-bottom", "border-left", "border-width", "border-style", "border-color"],
  "place-items": ["align-items", "justify-items"],
};
const family = (p) => {
  const set = new Set([p]);
  if (SHORT[p]) SHORT[p].forEach((x) => set.add(x));
  for (const [s, longs] of Object.entries(SHORT)) if (longs.includes(p)) set.add(s);
  return set;
};
/** True when declarations of `a` and `b` set (part of) the same property. */
export const sameProperty = (a, b) => family(a).has(b) || family(b).has(a);

/** The max-width (px) of a "@media (max-width: Npx)" condition, or null. Only the plain form. */
export const maxWidthOf = (cond) => { const m = /^@media \(max-width: ?(\d+(?:\.\d+)?)px\)$/.exec(cond); return m ? Number(m[1]) : null; };

/**
 * Every declaration inside a plain `@media (max-width: N)` block that a LATER rule with the same
 * selector cancels at the widths it was written for: the later rule is unconditional, or sits in a
 * `@media (max-width: M)` with M >= N, and sets the same property (or its shorthand) to a different
 * value, without the earlier one being !important. Those overrides are dead code that LOOKS like a fix.
 */
export function deadNarrowOverrides(text) {
  const rules = parseSheet(text);
  const dead = [];
  for (const r of rules) {
    if (r.at.length !== 1) continue;
    const n = maxWidthOf(r.at[0]);
    if (n == null) continue;
    for (const later of rules) {
      if (later.order <= r.order) continue;
      const covers = later.at.length === 0 || (later.at.length === 1 && maxWidthOf(later.at[0]) != null && maxWidthOf(later.at[0]) >= n);
      if (!covers) continue;
      for (const s of r.sel) {
        if (!later.sel.includes(s)) continue;
        for (const d of r.decls) {
          if (d.important) continue;
          for (const e of later.decls) {
            if (!sameProperty(d.prop, e.prop)) continue;
            if (d.prop === e.prop && d.value === e.value) continue;
            dead.push(`${s} { ${d.prop}: ${d.value} } in ${r.at[0]} is cancelled by a later "${s} { ${e.prop}: ${e.value} }"${later.at.length ? ` in ${later.at[0]}` : ""}`);
          }
        }
      }
    }
  }
  return [...new Set(dead)];
}

/**
 * The value that wins for `prop` on an element matched by exactly `selector`, at a frame of
 * `width` px, considering only rules whose selector list contains that exact selector (same
 * specificity, so source order decides) and only plain max/min-width media conditions.
 * A tiny cascade, for the rules this app writes. Returns { value, from } or null.
 */
export function winningValue(text, selector, prop, width) {
  const matches = (cond) => {
    const mx = /^@media \(max-width: ?(\d+(?:\.\d+)?)px\)$/.exec(cond);
    if (mx) return width <= Number(mx[1]);
    const mn = /^@media \(min-width: ?(\d+(?:\.\d+)?)px\)$/.exec(cond);
    if (mn) return width >= Number(mn[1]);
    return false; // any other condition (pointer, height, container…) is not assumed to match
  };
  let win = null;
  for (const r of parseSheet(text)) {
    if (!r.sel.includes(selector)) continue;
    if (!r.at.every(matches)) continue;
    for (const d of r.decls) {
      if (!sameProperty(d.prop, prop)) continue;
      const cand = { value: d.value, prop: d.prop, important: d.important, from: `${r.at.join(" ") || "(no condition)"} #${r.order}` };
      if (!win || cand.important || !win.important) win = cand;
    }
  }
  return win;
}
