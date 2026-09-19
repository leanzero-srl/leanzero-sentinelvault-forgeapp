// SEC-1 (UX critique 2026-09-19): the section picker names what a seal will cover BEFORE the user
// freezes it. Pure — takes one `list-page-headings` row ({ blocks, stopsAt }) and answers a sentence.
// `stopsAt` is `{ kind: "heading", text }` | `{ kind: "sentinel-vault", what }` | `{ kind: "end" }`.

export function describeRange(h) {
  if (!h || typeof h.blocks !== "number") return "";
  const count = h.blocks === 0 ? "the heading only" : h.blocks === 1 ? "heading + 1 block" : `heading + ${h.blocks} blocks`;
  const stop = h.stopsAt?.kind === "heading"
    ? ` · ends before “${(h.stopsAt.text || "").trim() || "the next heading"}”`
    : h.stopsAt?.kind === "sentinel-vault"
      ? (h.stopsAt.what === "sealed-section" ? " · ends before a sealed section"
        : h.stopsAt.what === "panel" ? " · ends before the Sentinel Vault panel"
          : " · ends before a Sentinel Vault macro")
      : " · to the end of the page";
  return `Seals ${count}${stop}`;
}
