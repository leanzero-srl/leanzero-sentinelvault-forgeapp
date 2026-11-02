/*
 * The header's tour button: "Take the tour" until this person has seen the page tour, "Replay tour" after.
 * Drawn in the page's own bundle, so it ships with the entry (a few lines); the engine itself loads on demand
 * (ConsoleTours.jsx). It sends the same replay event every tour button sends.
 */
import React, { useEffect, useState } from "react";
import { marksNow, onMarks, readMarks } from "./marks.js";
import { storedFor, tourButtonLabel } from "./tourSteps.js";
import { replayTour } from "./TourReplay.jsx";

export default function TourButton({ tour, testId, className = "sv-link" }) {
  const [label, setLabel] = useState(() => tourButtonLabel(storedFor(marksNow(), tour)));
  useEffect(() => {
    let live = true;
    const take = (m) => { if (live) setLabel(tourButtonLabel(storedFor(m, tour))); };
    readMarks().then(take);
    const off = onMarks(take);
    return () => { live = false; off(); };
  }, [tour]);
  return (
    <button type="button" className={className} data-testid={testId} data-nux={testId} data-nux-replay={tour} onClick={() => replayTour(tour)}>{label}</button>
  );
}
