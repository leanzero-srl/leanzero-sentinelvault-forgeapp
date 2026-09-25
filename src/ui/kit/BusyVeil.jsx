import React from "react";

/**
 * A frosted veil over a card while an action runs (owner, 2026-09-25: approving a flow "is waiting
 * without doing anything"). Same language as the consoles' "Preparing…" screen — the pulsing bar
 * — on the frosted glass the Apply bar uses. The parent must be position: relative.
 * Announced politely to screen readers; reduced motion keeps the bar still.
 */
export default function BusyVeil({ text }) {
  return (
    <div className="sv-busy-veil" role="status" aria-live="polite" data-testid="sv-busy-veil">
      <div className="sv-busy-bar" aria-hidden="true" />
      <span className="sv-busy-text">{text}</span>
    </div>
  );
}
