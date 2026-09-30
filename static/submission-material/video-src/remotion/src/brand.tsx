import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

// Real Inter (same family as leanzero.net and the Marketplace templates).
const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });
export const FONT = `${fontFamily}, 'Helvetica Neue', -apple-system, sans-serif`;
export const MONO = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";

// Sentinel Vault brand tokens (static/submission-material/_marketing/banner.html + mark.mjs).
export const C = {
  navy: "#020617",     // canvas
  panel: "#0F172A",    // caption band / cards
  rule: "#1E293B",
  seal: "#0891B2",     // the seal cyan every Seal button wears (mark tile)
  cyan: "#22D3EE",     // eyebrow / emphasis on navy
  green: "#16A34A",
  purple: "#7C3AED",
  blue: "#1D4ED8",
  orange: "#EA580C",
  red: "#DC2626",
  amber: "#D97706",
  pink: "#DB2777",
  ink: "#F8FAFC",
  sub: "#CBD5E1",
};

// THE Sealed Shield mark — copied verbatim from _marketing/mark.mjs (MARK_TILE_SVG).
export const Logo: React.FC<{ size?: number }> = ({ size = 80 }) => (
  <svg width={size} height={size} viewBox="0 0 144 144" style={{ flexShrink: 0 }}>
    <rect width="144" height="144" rx="30" fill="#0891B2" />
    <path d="M72 22L118 40V72C118 100.4 98.9 122.9 72 130C45.1 122.9 26 100.4 26 72V40L72 22Z" fill="#FFFFFF" />
    <circle cx="72" cy="68" r="14" fill="#0891B2" />
    <path d="M64 76L60 104H84L80 76Z" fill="#0891B2" />
  </svg>
);

// Navy canvas + the faint seal-cyan blueprint grid used on the banner.
export const Background: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.navy }}>
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(rgba(34,211,238,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.06) 1px,transparent 1px)",
        backgroundSize: "96px 96px",
      }}
    />
  </AbsoluteFill>
);
