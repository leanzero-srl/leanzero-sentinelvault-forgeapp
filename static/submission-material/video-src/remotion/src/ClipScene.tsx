import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { Background, Logo, FONT, C } from "./brand";

export type Beat = { src: string; eyebrow: string; title: string; sub?: string; accent: string; dur: number; focusX?: number; zoom?: number; from?: number };

const useIn = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 20 });
};

/* 16:9 — the footage sits in a flat window on the navy canvas; the caption lives in its own
   band underneath so it never covers the action. */
export const ClipScene: React.FC<Beat> = ({ src, eyebrow, title, sub, accent, from = 0 }) => {
  const e = useIn(4), e2 = useIn(10);
  const W = 1500, H = Math.round((W * 9) / 16); // 1500 x 844
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <div style={{ position: "absolute", top: 28, left: (1920 - W) / 2, width: W, height: H, borderRadius: 14, overflow: "hidden", background: "#fff", boxShadow: "0 30px 70px -20px rgba(0,0,0,.85)", border: `3px solid ${accent}` }}>
        <OffthreadVideo src={staticFile(src)} startFrom={from} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      {/* caption band */}
      <div style={{ position: "absolute", left: (1920 - W) / 2, right: (1920 - W) / 2, top: 28 + H + 24, height: 1080 - (28 + H + 24) - 22, display: "flex", alignItems: "center", gap: 26 }}>
        <div style={{ opacity: e, transform: `translateX(${(1 - e) * -30}px)`, background: accent, color: "#fff", fontWeight: 800, fontSize: 22, letterSpacing: 1.6, textTransform: "uppercase", padding: "12px 20px", borderRadius: 10, whiteSpace: "nowrap" }}>{eyebrow}</div>
        <div style={{ flex: 1, opacity: e2, transform: `translateY(${(1 - e2) * 14}px)` }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 44, letterSpacing: -1, lineHeight: 1.05 }}>{title}</div>
          {sub ? <div style={{ marginTop: 8, color: C.sub, fontWeight: 500, fontSize: 24, lineHeight: 1.25 }}>{sub}</div> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={50} />
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 24, letterSpacing: -0.3, whiteSpace: "nowrap" }}>Sentinel Vault</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* 9:16 — big caption on top, a square zoom of the footage (focusX picks the region), brand at the bottom. */
export const VClipScene: React.FC<Beat> = ({ src, eyebrow, title, sub, accent, focusX = 0.5, zoom = 1, from = 0 }) => {
  const e = useIn(3), e2 = useIn(8);
  const S = 1000; // square window
  const vh = S * zoom, vw = (vh * 16) / 9;
  const left = Math.min(0, Math.max(S - vw, S / 2 - focusX * vw));
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <div style={{ position: "absolute", top: 150, left: 60, right: 60, textAlign: "left" }}>
        <div style={{ opacity: e, display: "inline-block", background: accent, color: "#fff", fontWeight: 800, fontSize: 32, letterSpacing: 2, textTransform: "uppercase", padding: "12px 24px", borderRadius: 12 }}>{eyebrow}</div>
        <div style={{ opacity: e2, transform: `translateY(${(1 - e2) * 18}px)`, marginTop: 26, color: "#fff", fontWeight: 800, fontSize: 70, letterSpacing: -1.6, lineHeight: 1.04 }}>{title}</div>
        {sub ? <div style={{ opacity: e2, marginTop: 18, color: C.sub, fontWeight: 500, fontSize: 36, lineHeight: 1.25 }}>{sub}</div> : null}
      </div>
      <div style={{ position: "absolute", top: 680, left: 40, width: S, height: S, borderRadius: 22, overflow: "hidden", background: "#fff", border: `5px solid ${accent}`, boxShadow: "0 30px 70px -20px rgba(0,0,0,.85)" }}>
        <OffthreadVideo src={staticFile(src)} startFrom={from} muted style={{ position: "absolute", top: (S - vh) / 2, left, width: vw, height: vh, maxWidth: "none" }} />
      </div>
      <div style={{ position: "absolute", bottom: 90, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Logo size={64} />
        <span style={{ color: "#fff", fontWeight: 800, fontSize: 38 }}>Sentinel Vault</span>
      </div>
    </AbsoluteFill>
  );
};
