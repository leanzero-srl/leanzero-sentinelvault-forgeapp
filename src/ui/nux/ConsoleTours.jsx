/*
 * THE CONSOLES' ELZI TOURS (site settings page, space page). Two small components over the one engine (Tour.jsx):
 *   PageTour  the console's page tour: opens by itself on a person's first visit, once the first-run setup (if any)
 *             is out of the way. Mount it once, inside the console.
 *   TabTour   one tab's mini-tour. Mount it at the top of the tab's content, keyed by the tab (every tab visit is a
 *             fresh view); it draws the tab's small "Tour" button in place and opens by itself only once the page
 *             tour was FINISHED, and never straight after another tour (marks.js tourOpenSince).
 *   TourButton  the header's "Take the tour" / "Replay tour".
 * Lazy-loaded by the consoles (React.lazy), so the engine, Elzi's poses and the step tables stay out of the entry.
 */
import React, { useEffect, useMemo, useState } from "react";
import Tour from "./Tour.jsx";
import { marksNow, onMarks, readMarks, tourFinished } from "./marks.js";
import { siteTour, spaceTour, miniTourFor, miniAutoStart, CONSOLE_BTN } from "./tours.js";

const useMarks = () => {
  const [marks, setMarks] = useState(() => marksNow());
  useEffect(() => {
    let live = true;
    // the promise answers with the FIRST snapshot; a tab mounted later must read what the marks are now
    readMarks().then(() => { if (live) setMarks(marksNow()); });
    const off = onMarks((m) => { if (live) setMarks(m); });
    return () => { live = false; off(); };
  }, []);
  return marks;
};

export function PageTour({ console: which, steward = false }) {
  const tour = useMemo(() => (which === "site" ? siteTour() : spaceTour({ steward })), [which, steward]);
  return <Tour key={tour.key} tour={tour} btn={CONSOLE_BTN} />;
}

export function TabTour({ console: which, tab }) {
  const marks = useMarks();
  const tour = useMemo(() => miniTourFor(which, tab), [which, tab]);
  if (!tour) return null;
  return <Tour key={tour.key} tour={tour} autoStart={miniAutoStart({ pageTourDone: tourFinished(marks, which) })} btn={CONSOLE_BTN} />;
}

export default PageTour;
