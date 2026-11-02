/*
 * A MODULE'S OWN "Tour" BUTTON (2026-10-30: the activity list was the one module without one; it replayed
 * only through the sv-nux:replay event). It sends that same event with the tour's name, and carries
 * data-nux-replay so the engine gives focus back to it when the tour ends. Drawn by Tour.jsx for
 * a tour def with `replay: true`, so it ships in the tour's lazy chunk, never in a glance entry.
 */
import React from "react";

export const NUX_REPLAY = "sv-nux:replay";
export const replayTour = (tour) => {
  try { window.dispatchEvent(new CustomEvent(NUX_REPLAY, { detail: { tour } })); } catch (e) { /* old browser */ }
};

export default function TourReplay({ tour, className = "btn-secondary", label = "Tour" }) {
  return (
    <div className="nux-replay-row">
      <button type="button" className={`${className} nux-replay-btn`} data-testid="nux-replay" data-nux-replay={tour}
        onClick={() => replayTour(tour)}>{label}</button>
    </div>
  );
}
