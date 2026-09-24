import React, { useState } from "react";
import { capItems, GROUP_LIMIT } from "./sealed-groups.js";

/**
 * One group's list, folded to GROUP_LIMIT items with a toggle under it: "Show N more files" opens
 * the rest, "Show fewer files" folds it back (owner, 2026-09-24). Each group folds on its own.
 * `children` renders the visible items: (visible) => node.
 */
export default function CappedGroup({ items, noun = "files", limit = GROUP_LIMIT, children }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden } = capItems(items, expanded, limit);
  return (
    <>
      {children(visible)}
      {hidden > 0 && (
        // Same footer as the laptop's GroupFooter (2026-09-22, shipped in 6.3.0): "Showing N of M".
        <div className="sv-group-footer" data-testid="sv-group-more">
          <span className="sv-group-footer-count">Showing {visible.length} of {items.length}</span>
          <button type="button" className="load-more-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} data-testid={expanded ? "sv-group-more-fewer" : "sv-group-more-more"}>
            {expanded ? "Show fewer" : `Show ${hidden} more ${noun}`}
          </button>
        </div>
      )}
    </>
  );
}
