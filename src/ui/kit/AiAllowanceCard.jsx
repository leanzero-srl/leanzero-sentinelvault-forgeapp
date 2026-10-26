import React from "react";

// The site-wide monthly AI allowance (server: capsules/validations/allowance.js), shown in the site
// Validations editor. The server derives the view on every load; the admin may only LOWER the
// limit (the server clamps on save and on read). Amounts are micro-dollars on the wire.
const usd = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(2)}`;
const SOURCE = {
  count: "from the site's licensed user count",
  cached: "from the site's licensed user count",
  "stale-cache": "from the last licensed user count read",
  fallback: "the 10-user allowance (the licensed user count could not be read)",
  trial: "the 10-user allowance (trial)",
  unlicensed: "the 10-user allowance (no active licence)",
};

export default function AiAllowanceCard({ view, loweredMicro, onLower }) {
  if (!view) return null;
  if (view.unavailable) {
    return <p className="val-ai-allowance-exhausted" role="status" data-testid="val-ai-allowance-unavailable">The AI allowance could not be read right now. AI review is paused until it can be.</p>;
  }
  const dollars = Number(loweredMicro) > 0 ? (Number(loweredMicro) / 1e6).toString() : "";
  return (
    <div className="val-ai-allowance" data-testid="val-ai-allowance">
      <div className="val-ai-allowance-head">AI allowance for {view.monthLabel}</div>
      <div className="val-ai-allowance-figures">
        <span><strong data-testid="val-ai-allowance-used">{usd(view.spentMicro + view.reservedMicro)}</strong> used</span>
        <span><strong data-testid="val-ai-allowance-limit">{usd(view.limitMicro)}</strong> allowance</span>
        <span><strong data-testid="val-ai-allowance-left">{usd(view.remainingMicro)}</strong> left</span>
        <span>resets {view.resetLabel}</span>
      </div>
      <p className="val-ai-allowance-note">
        Default {usd(view.defaultMicro)} a month: {Number(view.users).toLocaleString("en-US")} users, {SOURCE[view.userSource] || "from the licence"}.
        {view.lowered ? " Lowered by a site admin." : ""}
      </p>
      {view.exhausted && (
        <p className="val-ai-allowance-exhausted" role="status" data-testid="val-ai-allowance-exhausted">
          The allowance for {view.monthLabel} is used up. AI review is paused until {view.resetLabel}. Other Sentinel Vault features keep working.
        </p>
      )}
      <label className="val-ai-allowance-lower">
        <span>Lower the monthly allowance to ($, empty = default)</span>
        <input
          className="form-input" type="number" min="0" step="0.01" inputMode="decimal"
          data-testid="val-ai-allowance-input" value={dollars} placeholder={(view.defaultMicro / 1e6).toFixed(2)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onLower(Number.isFinite(v) && v > 0 ? Math.min(Math.round(v * 1e6), view.defaultMicro) : 0);
          }}
        />
      </label>
    </div>
  );
}
