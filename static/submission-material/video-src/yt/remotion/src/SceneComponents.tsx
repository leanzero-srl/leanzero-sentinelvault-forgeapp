import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, FONT, Logo, SEAL } from "./brand";

const ease = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 24 });

const ByLeanZero: React.FC<{ size?: number }> = ({ size = 27 }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 11 }}>
    <span style={{ fontSize: size * 0.78, fontWeight: 500, color: "#8FA6CC", letterSpacing: 1 }}>by</span>
    <Img src={staticFile("leanzero.png")} style={{ height: size * 1.25 }} />
    <span style={{ fontSize: size, fontWeight: 700, color: "#EAF1FB", letterSpacing: -0.3 }}>LeanZero</span>
  </div>
);

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = ease(frame, fps);
  const e2 = ease(frame, fps, 10);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${(1 - e) * 30}px) scale(${0.92 + e * 0.08})`, opacity: e, textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24, justifyContent: "center" }}>
            <Logo size={104} />
            <div style={{ fontSize: 88, fontWeight: 800, color: "#fff", letterSpacing: -2 }}>Sentinel Vault</div>
          </div>
          <div style={{ opacity: e2, marginTop: 28, fontSize: 34, fontWeight: 500, color: "#A9BEDD" }}>Content protection for Confluence</div>
          <div style={{ opacity: e2, marginTop: 32 }}><ByLeanZero /></div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const TextScene: React.FC<{ kicker: string; lines: string[]; accent: string }> = ({ kicker, lines, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 160 }}>
        <div style={{ textAlign: "center", maxWidth: 1400 }}>
          <div style={{ opacity: ease(frame, fps), display: "inline-block", padding: "10px 22px", borderRadius: 999, background: accent, color: "#fff", fontSize: 26, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", marginBottom: 34 }}>{kicker}</div>
          {lines.map((l, i) => {
            const e = ease(frame, fps, 8 + i * 8);
            return <div key={i} style={{ opacity: e, transform: `translateY(${(1 - e) * 24}px)`, fontSize: 60, fontWeight: 700, color: "#fff", lineHeight: 1.18, letterSpacing: -1 }}>{l}</div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = ease(frame, fps);
  const e2 = ease(frame, fps, 12);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", opacity: e, transform: `translateY(${(1 - e) * 24}px)` }}>
          <Logo size={96} />
          <div style={{ fontSize: 64, fontWeight: 800, color: "#fff", letterSpacing: -1.4, marginTop: 26 }}>Runs on Atlassian Forge</div>
          <div style={{ opacity: e2, marginTop: 22, fontSize: 32, color: "#A9BEDD", fontWeight: 500 }}>Find Sentinel Vault on the Atlassian Marketplace</div>
          <div style={{ opacity: e2, marginTop: 34, display: "inline-flex", alignItems: "center", padding: "16px 34px", borderRadius: 999, background: SEAL, color: "#fff", fontSize: 26, fontWeight: 700 }}>marketplace.atlassian.com → Sentinel Vault</div>
          <div style={{ opacity: e2, marginTop: 38 }}><ByLeanZero size={32} /></div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
