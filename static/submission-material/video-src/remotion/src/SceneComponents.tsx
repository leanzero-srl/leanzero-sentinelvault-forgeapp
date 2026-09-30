import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, spring, staticFile } from "remotion";
import { Background, Logo, FONT, MONO, C } from "./brand";

export const ease = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 24 });

const Chips: React.FC<{ items: [string, string][]; o: number; size?: number }> = ({ items, o, size = 24 }) => (
  <div style={{ opacity: o, display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
    {items.map(([t, c]) => (
      <span key={t} style={{ background: c, color: "#fff", fontWeight: 700, fontSize: size, padding: "10px 22px", borderRadius: 999 }}>{t}</span>
    ))}
  </div>
);

export const CHIPS: [string, string][] = [
  ["Seal & auto-restore", C.seal],
  ["Edit requests", C.purple],
  ["Signed decisions", C.green],
  ["Classification", C.orange],
];

const ByLeanZero: React.FC<{ o: number; h?: number }> = ({ o, h = 38 }) => (
  <div style={{ opacity: o, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
    <span style={{ fontSize: h * 0.6, fontWeight: 500, color: "#94A3B8" }}>by</span>
    <Img src={staticFile("leanzero.png")} style={{ height: h * 1.5, width: h * 1.5, margin: -h * 0.2 }} />
    <span style={{ fontSize: h * 0.8, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>LeanZero</span>
  </div>
);

export const TitleCard: React.FC<{ vertical?: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = ease(frame, fps), e2 = ease(frame, fps, 10), e3 = ease(frame, fps, 18);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 60 }}>
        <div style={{ textAlign: "center", opacity: e, transform: `translateY(${(1 - e) * 30}px)` }}>
          <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: 28, justifyContent: "center" }}>
            <Logo size={vertical ? 180 : 120} />
            <div style={{ fontSize: vertical ? 96 : 100, fontWeight: 800, color: "#fff", letterSpacing: -2.5, lineHeight: 1 }}>Sentinel Vault</div>
          </div>
          <div style={{ opacity: e2, marginTop: 30, fontFamily: MONO, fontSize: vertical ? 30 : 26, fontWeight: 700, letterSpacing: 5, color: C.cyan, textTransform: "uppercase" }}>
            Content protection for Confluence
          </div>
          <div style={{ marginTop: 40 }}><Chips items={CHIPS} o={e3} size={vertical ? 30 : 24} /></div>
          <div style={{ marginTop: 44 }}><ByLeanZero o={e3} h={vertical ? 50 : 40} /></div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const TextScene: React.FC<{ kicker: string; lines: string[]; accent: string; vertical?: boolean }> = ({ kicker, lines, accent, vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: vertical ? 70 : 160 }}>
        <div style={{ textAlign: "center", maxWidth: 1500 }}>
          <div style={{ opacity: ease(frame, fps), display: "inline-block", background: accent, color: "#fff", fontSize: vertical ? 32 : 26, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", padding: "10px 24px", borderRadius: 10, marginBottom: 40 }}>{kicker}</div>
          {lines.map((l, i) => {
            const e = ease(frame, fps, 8 + i * 9);
            return <div key={i} style={{ opacity: e, transform: `translateY(${(1 - e) * 24}px)`, fontSize: vertical ? 76 : 66, fontWeight: 800, color: i === lines.length - 1 ? C.cyan : "#fff", lineHeight: 1.16, letterSpacing: -1.2, marginTop: 8 }}>{l}</div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const OutroCard: React.FC<{ vertical?: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const e = ease(frame, fps), e2 = ease(frame, fps, 12);
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: out }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 60 }}>
        <div style={{ textAlign: "center", opacity: e, transform: `translateY(${(1 - e) * 24}px)` }}>
          <Logo size={vertical ? 170 : 120} />
          <div style={{ fontSize: vertical ? 80 : 72, fontWeight: 800, color: "#fff", letterSpacing: -1.6, marginTop: 30, lineHeight: 1.08 }}>
            Sealed, approved —{vertical ? <br /> : " "}<span style={{ color: C.cyan }}>and it stays that way</span>
          </div>
          <div style={{ opacity: e2, marginTop: 26, fontSize: vertical ? 38 : 32, color: C.sub, fontWeight: 500 }}>Runs on Atlassian Forge — your content never leaves Atlassian</div>
          <div style={{ opacity: e2, marginTop: 40, display: "inline-flex", alignItems: "center", padding: "18px 38px", borderRadius: 999, background: C.seal, color: "#fff", fontSize: vertical ? 36 : 30, fontWeight: 800 }}>
            Get Sentinel Vault on the Atlassian Marketplace
          </div>
          <div style={{ marginTop: 46 }}><ByLeanZero o={e2} h={vertical ? 54 : 44} /></div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
