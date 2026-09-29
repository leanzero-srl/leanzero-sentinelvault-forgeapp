import React, { useState } from "react";
import { groupWindow, GROUP_LIMIT } from "./sealed-groups.js";

/**
 * One group's list, shown `limit` at a time (owner, 2026-09-29: 5, so the macro stays small).
 * The footer is the group's "breadcrumb": "Showing 5 of 16 · Show 5 more · Show all 16 · Show
 * fewer". Each group pages on its own. `children` renders the visible items: (visible) => node.
 */
export default function CappedGroup({ items, noun = "files", limit = GROUP_LIMIT, children }) {
  const [shown, setShown] = useState(limit);
  const w = groupWindow(items, shown, limit);
  const total = Array.isArray(items) ? items.length : 0;
  return (
    <>
      {children(w.visible)}
      {(w.hidden > 0 || w.canFewer) && (
        <div className="sv-group-footer" data-testid="sv-group-more">
          <span className="sv-group-footer-count">Showing {w.visible.length} of {total}</span>
          {w.hidden > 0 && (
            <button type="button" className="load-more-btn" onClick={() => setShown(w.visible.length + limit)} data-testid="sv-group-more-more">
              Show {w.more} more {noun}
            </button>
          )}
          {w.canAll && (
            <button type="button" className="load-more-btn" onClick={() => setShown(total)} data-testid="sv-group-more-all">
              Show all {total}
            </button>
          )}
          {w.canFewer && (
            <button type="button" className="load-more-btn" onClick={() => setShown(limit)} data-testid="sv-group-more-fewer">
              Show fewer
            </button>
          )}
        </div>
      )}
    </>
  );
}
