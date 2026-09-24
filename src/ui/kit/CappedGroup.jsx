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
        <div className="sv-group-more">
          <button type="button" className="sv-group-more-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} data-testid="sv-group-more">
            {expanded ? `Show fewer ${noun}` : `Show ${hidden} more ${noun}`}
          </button>
        </div>
      )}
    </>
  );
}
