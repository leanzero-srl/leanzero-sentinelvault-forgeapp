import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

// Real Inter, same family as leanzero.net and the CogniRunner tutorials.
const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });
export const FONT = `${fontFamily}, 'Helvetica Neue', -apple-system, sans-serif`;

export const APP = "Sentinel Vault";
export const SEAL = "#0891B2"; // the product's seal cyan (every Seal button / sealed border)

// "The Sealed Shield" — same drawing as _marketing/mark.mjs MARK_TILE_SVG (never redraw it).
export const Logo: React.FC<{ size?: number }> = ({ size = 80 }) => (
  <svg width={size} height={size} viewBox="0 0 144 144">
    <rect width="144" height="144" rx="30" fill="#0891B2" />
    <path d="M72 22L118 40V72C118 100.4 98.9 122.9 72 130C45.1 122.9 26 100.4 26 72V40L72 22Z" fill="#FFFFFF" />
    <circle cx="72" cy="68" r="14" fill="#0891B2" />
    <path d="M64 76L60 104H84L80 76Z" fill="#0891B2" />
  </svg>
);

// Deep navy canvas (not black), solid — no faded accent wash. A faint dot grid for texture only.
export const Background: React.FC<{ accent?: string }> = () => (
  <AbsoluteFill style={{ background: "linear-gradient(160deg, #0E2144 0%, #0B1A36 55%, #09152D 100%)" }}>
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(circle, rgba(140,180,235,0.07) 1.5px, transparent 1.5px)", backgroundSize: "38px 38px" }} />
  </AbsoluteFill>
);
