import React, { useState, useEffect, useRef, useCallback } from "react";

// A5: the app's own date-entry primitive — a month grid, never a native <input type="date">
// (owner rule: no browser-native primitives). Value in/out is a plain "YYYY-MM-DD" in the
// viewer's LOCAL calendar; the caller decides what instant that day means (the ribbon uses the
// end of that day, so "due Sep 12" is not overdue at breakfast on Sep 12).
//
// Keyboard (roving tabindex on the focused day, like a native grid): ← → move a day, ↑ ↓ move a
// week, PageUp/PageDown move a month, Home/End go to the week's edges, Enter/Space pick,
// Escape → onClose. Days before `min` are disabled and skipped by Enter.
//
// Styles live in the mounting surface's token sheet (.sv-dp-*), like every kit component.

const pad = (n) => String(n).padStart(2, "0");
export const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const sameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => {
  // Clamp the day so Jan 31 + 1 month is Feb 28/29, not Mar 3.
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthLabel = (d) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

// The 6x7 grid for the month containing `view`, Monday-first, padded with the neighbouring
// months' days so the grid never jumps height between months.
const gridFor = (view) => {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

export default function DatePicker({ value = null, min = null, onChange, onClose, ariaLabel = "Choose a date", testId = "sv-datepicker" }) {
  const selected = fromYmd(value);
  const minDay = fromYmd(min);
  const today = new Date();
  const [focusDay, setFocusDay] = useState(() => selected || (minDay && minDay > today ? minDay : today));
  const [view, setView] = useState(() => new Date(focusDay.getFullYear(), focusDay.getMonth(), 1));
  const gridRef = useRef(null);
  const pendingFocus = useRef(false);

  // Keep the visible month in step with keyboard travel, and move DOM focus to the day the
  // arrow keys landed on (only after a keyboard move — never on mount, so the dialog's own
  // focus-on-open is not hijacked).
  useEffect(() => {
    if (focusDay.getMonth() !== view.getMonth() || focusDay.getFullYear() !== view.getFullYear()) {
      setView(new Date(focusDay.getFullYear(), focusDay.getMonth(), 1));
    }
  }, [focusDay, view]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector(`[data-date="${toYmd(focusDay)}"]`)?.focus();
  });

  const disabled = useCallback((d) => !!minDay && d < minDay, [minDay]);
  const pick = useCallback((d) => { if (!disabled(d)) onChange?.(toYmd(d)); }, [disabled, onChange]);
  const move = useCallback((next) => { pendingFocus.current = true; setFocusDay(next); }, []);

  const onKey = (e) => {
    // Enter/Space on the month buttons must stay a button press, not a pick.
    const onDay = !!e.target?.closest?.(".sv-dp-day");
    if ((e.key === "Enter" || e.key === " ") && !onDay) return;
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); move(addDays(focusDay, -1)); break;
      case "ArrowRight": e.preventDefault(); move(addDays(focusDay, 1)); break;
      case "ArrowUp": e.preventDefault(); move(addDays(focusDay, -7)); break;
      case "ArrowDown": e.preventDefault(); move(addDays(focusDay, 7)); break;
      case "PageUp": e.preventDefault(); move(addMonths(focusDay, -1)); break;
      case "PageDown": e.preventDefault(); move(addMonths(focusDay, 1)); break;
      case "Home": e.preventDefault(); move(addDays(focusDay, -((focusDay.getDay() + 6) % 7))); break;
      case "End": e.preventDefault(); move(addDays(focusDay, 6 - ((focusDay.getDay() + 6) % 7))); break;
      case "Enter": case " ": e.preventDefault(); pick(focusDay); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); onClose?.(); break;
      default: break;
    }
  };

  const days = gridFor(view);
  return (
    <div className="sv-dp" role="group" aria-label={ariaLabel} data-testid={testId} onKeyDown={onKey}>
      <div className="sv-dp-head">
        <button type="button" className="sv-dp-nav" onClick={() => { const v = addMonths(view, -1); setView(v); setFocusDay(addMonths(focusDay, -1)); }} aria-label="Previous month">‹</button>
        <span className="sv-dp-month" aria-live="polite">{monthLabel(view)}</span>
        <button type="button" className="sv-dp-nav" onClick={() => { const v = addMonths(view, 1); setView(v); setFocusDay(addMonths(focusDay, 1)); }} aria-label="Next month">›</button>
      </div>
      <div className="sv-dp-weekdays" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w} className="sv-dp-weekday">{w}</span>)}
      </div>
      <div className="sv-dp-grid" ref={gridRef}>
        {days.map((d) => {
          const ymd = toYmd(d);
          const isSel = sameDay(d, selected);
          const isFocus = sameDay(d, focusDay);
          const outside = d.getMonth() !== view.getMonth();
          const off = disabled(d);
          return (
            <button
              key={ymd}
              type="button"
              className={`sv-dp-day${isSel ? " sv-dp-sel" : ""}${sameDay(d, today) ? " sv-dp-today" : ""}${outside ? " sv-dp-outside" : ""}`}
              data-testid="sv-datepicker-day"
              data-date={ymd}
              tabIndex={isFocus ? 0 : -1}
              aria-pressed={isSel}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              disabled={off}
              onClick={() => { setFocusDay(d); pick(d); }}
              onFocus={() => { if (!isFocus) setFocusDay(d); }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
