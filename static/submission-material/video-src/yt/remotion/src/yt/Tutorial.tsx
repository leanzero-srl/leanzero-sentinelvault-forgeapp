import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background, Logo, FONT } from "../brand";
import { OutroCard } from "../SceneComponents";
import { Script, buildSegments, mapTime, outDuration, Segment } from "./timeline";

export const FPS = 30;
export const INTRO = 105; // frames
export const OUTRO = 150;
export const XFADE = 14;

// One solid, saturated hue per feature (never a tint). Seal cyan is the product's own seal colour.
export const ACCENT: Record<string, string> = {
  "Sealed files": "#0891B2",
  "Sealed sections": "#7C3AED",
  "Edit requests": "#EA580C",
  "Auto-restore": "#DC2626",
  "Authenticator": "#16A34A",
  Classification: "#DB2777",
  "Site settings": "#2563EB",
  "Space settings": "#CA8A04",
  "Audit log": "#0D9488",
  "API access": "#4F46E5",
};
export const accentOf = (f: string) => ACCENT[f] ?? "#0891B2";

export type TutorialProps = { script: Script; src: string; srcW: number; srcH: number; srcDuration: number; srcOffset?: number; baseRate?: number };

export const tutorialFrames = (p: TutorialProps) => {
  const segs = buildSegments(p.script, p.srcDuration, p.baseRate ?? 1);
  return INTRO - XFADE + Math.round(outDuration(segs) * FPS) - XFADE + OUTRO;
};

const sp = (frame: number, fps: number, delay = 0, dur = 22) =>
  spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: dur });

/* ---------- intro ---------- */
export const Intro: React.FC<{ script: Script; accent: string; frames?: number; kicker?: string }> = ({ script, accent, frames = INTRO, kicker }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = sp(frame, fps, 0, 26);
  const e2 = sp(frame, fps, 10, 26);
  const e3 = sp(frame, fps, 20, 26);
  const out = interpolate(frame, [frames - XFADE, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: out }}>
      <Background accent={accent} />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 150px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
          <Logo size={64} />
          <span style={{ fontSize: 34, fontWeight: 800, color: "#fff", letterSpacing: -0.6 }}>Sentinel Vault</span>
          <span style={{ marginLeft: 10, padding: "8px 18px", borderRadius: 999, background: accent, color: "#fff", fontSize: 22, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>{script.feature}</span>
          {kicker ? <span style={{ marginLeft: 6, color: "#7E93BD", fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>{kicker}</span> : null}
        </div>
        <div style={{ marginTop: 46, fontSize: 84, fontWeight: 800, color: "#fff", lineHeight: 1.06, letterSpacing: -2.4, maxWidth: 1500, opacity: e2, transform: `translateY(${(1 - e2) * 26}px)` }}>{script.title}</div>
        <div style={{ marginTop: 28, fontSize: 34, fontWeight: 500, color: "#B7C7E0", maxWidth: 1400, lineHeight: 1.3, opacity: e3, transform: `translateY(${(1 - e3) * 18}px)` }}>{script.subtitle}</div>
        <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 12, opacity: e3 }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: "#7E93BD", letterSpacing: 1 }}>by</span>
          <Img src={staticFile("leanzero.png")} style={{ height: 34 }} />
          <span style={{ fontSize: 28, fontWeight: 700, color: "#EAF1FB" }}>LeanZero</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- footage with remapped time ---------- */
const Footage: React.FC<{ src: string; segs: Segment[]; width: number; height: number; offset?: number }> = ({ src, segs, width, height, offset = 0 }) => (
  <div style={{ position: "relative", width, height, borderRadius: 14, overflow: "hidden", background: "#0b0e16", boxShadow: "0 10px 26px rgba(0,0,0,0.45), 0 40px 90px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)" }}>
    {segs.map((s, i) => (
      <Sequence key={i} from={Math.round(s.outStart * FPS)} durationInFrames={Math.max(1, Math.round((s.outEnd - s.outStart) * FPS))} layout="none">
        <OffthreadVideo src={staticFile(src)} startFrom={Math.round((s.inStart + offset) * FPS)} playbackRate={s.rate} muted style={{ width, height, objectFit: "fill", display: "block" }} />
      </Sequence>
    ))}
  </div>
);

const FastBadge: React.FC<{ segs: Segment[]; accent: string; x: number; y: number }> = ({ segs, accent, x, y }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const seg = segs.find((s) => t >= s.outStart && t < s.outEnd && s.rate >= 2);
  if (!seg) return null;
  const e = sp(frame - Math.round(seg.outStart * FPS), FPS, 0, 14);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: e, transform: `scale(${0.9 + e * 0.1})`, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, background: "#0F172A", border: `2px solid ${accent}`, color: "#fff", fontWeight: 800, fontSize: 20, fontFamily: FONT }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M3 5l8 7-8 7V5zm10 0l8 7-8 7V5z" /></svg>
      {Math.round(seg.rate)}× faster
    </div>
  );
};

const CalloutLayer: React.FC<{ callouts: { t: number; end: number; text: string }[]; accent: string; x: number; y: number; maxW: number }> = ({ callouts, accent, x, y, maxW }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const c = callouts.find((k) => t >= k.t && t < k.end);
  if (!c) return null;
  const local = frame - Math.round(c.t * FPS);
  const e = sp(local, FPS, 0, 18);
  const out = interpolate(t, [c.end - 0.35, c.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: x, top: y, maxWidth: maxW, opacity: e * out, transform: `translateY(${(1 - e) * -14}px) scale(${0.94 + e * 0.06})`, transformOrigin: "left top", display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderRadius: 12, background: accent, color: "#fff", fontWeight: 800, fontSize: 26, fontFamily: FONT, boxShadow: "0 10px 30px rgba(0,0,0,0.45)", letterSpacing: -0.3 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
      <span>{c.text}</span>
    </div>
  );
};

/* ---------- step widgets ---------- */
const StepBadge: React.FC<{ n: number; accent: string; size?: number }> = ({ n, accent, size = 64 }) => (
  <div style={{ width: size, height: size, borderRadius: 14, background: accent, color: "#fff", fontWeight: 800, fontSize: size * 0.48, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 8px 24px ${accent}66` }}>{n}</div>
);

const Check: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

const useStepIndex = (steps: { t: number }[]) => {
  const frame = useCurrentFrame();
  const t = frame / FPS + 0.001;
  let idx = 0;
  steps.forEach((s, i) => { if (t >= s.t) idx = i; });
  return { idx, since: frame - Math.round(steps[idx].t * FPS) };
};

/* current-step card (wide layout: horizontal band; tall layout: top of rail) */
const StepCard: React.FC<{ steps: { t: number; label: string; detail: string }[]; accent: string; compact?: boolean; width: number }> = ({ steps, accent, compact = false, width }) => {
  const { idx, since } = useStepIndex(steps);
  const e = sp(since, FPS, 0, 16);
  const s = steps[idx];
  return (
    <div style={{ width, display: "flex", alignItems: "flex-start", gap: compact ? 18 : 26, opacity: 0.35 + e * 0.65, transform: `translateY(${(1 - e) * 10}px)` }}>
      <StepBadge n={idx + 1} accent={accent} size={compact ? 56 : 72} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: accent, fontSize: compact ? 15 : 17, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>Step {idx + 1} of {steps.length}</div>
        <div style={{ color: "#fff", fontSize: compact ? 30 : 40, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.12 }}>{s.label}</div>
        <div style={{ marginTop: 8, color: "#C6D4EA", fontSize: compact ? 20 : 24, fontWeight: 500, lineHeight: 1.32 }}>{s.detail}</div>
      </div>
    </div>
  );
};

/* progress dots (wide layout) */
const StepDots: React.FC<{ steps: { t: number }[]; accent: string }> = ({ steps, accent }) => {
  const { idx } = useStepIndex(steps);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {steps.map((_, i) => (
        <div key={i} style={{ width: i === idx ? 34 : 14, height: 14, borderRadius: 7, background: i <= idx ? accent : "#334155", transition: "width 120ms" }} />
      ))}
    </div>
  );
};

/* full step list (tall layout rail) */
const StepList: React.FC<{ steps: { t: number; label: string }[]; accent: string; width: number }> = ({ steps, accent, width }) => {
  const { idx } = useStepIndex(steps);
  const dense = steps.length > 8;
  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: dense ? 8 : 12 }}>
      {steps.map((s, i) => {
        const done = i < idx, cur = i === idx;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: dense ? "8px 12px" : "10px 14px", borderRadius: 12, background: cur ? accent : "transparent" }}>
            <div style={{ width: dense ? 28 : 32, height: dense ? 28 : 32, borderRadius: 9, flexShrink: 0, background: done ? "#16A34A" : cur ? "#fff" : "#1E293B", color: cur ? accent : "#fff", fontWeight: 800, fontSize: dense ? 15 : 17, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {done ? <Check size={dense ? 15 : 17} /> : i + 1}
            </div>
            <div style={{ color: cur ? "#fff" : done ? "#DCE6F5" : "#94A3B8", fontSize: dense ? 19 : 21, fontWeight: cur ? 800 : 600, lineHeight: 1.2, letterSpacing: -0.3 }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
};

const Brand: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <Logo size={size} />
    <span style={{ color: "#fff", fontWeight: 800, fontSize: size * 0.6, letterSpacing: -0.4 }}>Sentinel Vault</span>
    <span style={{ color: "#7E93BD", fontWeight: 600, fontSize: size * 0.45, marginLeft: 4 }}>by LeanZero</span>
  </div>
);

/* ---------- the two layouts ---------- */
export const Body: React.FC<TutorialProps & { segs: Segment[]; accent: string; bodyFrames: number }> = ({ script, src, srcW, srcH, segs, accent, bodyFrames, srcOffset = 0 }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, XFADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [bodyFrames - XFADE, bodyFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const steps = script.steps.map((s) => ({ ...s, t: mapTime(segs, s.t) }));
  const callouts = script.callouts.map((c) => ({ text: c.text, t: mapTime(segs, c.t), end: mapTime(segs, c.t) + c.duration }));
  const wide = srcW / srcH > 2;

  if (wide) {
    // footage across the top, step band below
    const W = 1824, H = Math.round((W * srcH) / srcW); // 1824 x 678
    const X = 48, Y = 100;
    return (
      <AbsoluteFill style={{ fontFamily: FONT, opacity: Math.min(fadeIn, fadeOut) }}>
        <Background accent={accent} />
        <div style={{ position: "absolute", left: X, top: Y }}>
          <Footage src={src} segs={segs} width={W} height={H} offset={srcOffset} />
          <FastBadge segs={segs} accent={accent} x={W - 190} y={H - 62} />
          <CalloutLayer callouts={callouts} accent={accent} x={24} y={24} maxW={1000} />
        </div>
        <div style={{ position: "absolute", left: X, right: X, top: Y + H + 34, bottom: 36, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 40 }}>
          <StepCard steps={steps} accent={accent} width={1280} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 26, paddingTop: 6 }}>
            <Brand size={44} />
            <StepDots steps={steps} accent={accent} />
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // tall (4:3-ish) footage on the left, rail on the right
  const H = 1000, W = Math.round((H * srcW) / srcH); // ~1348 x 1000
  const X = 40, Y = 40;
  const railX = X + W + 36, railW = 1920 - railX - 40;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: Math.min(fadeIn, fadeOut) }}>
      <Background accent={accent} />
      <div style={{ position: "absolute", left: X, top: Y }}>
        <Footage src={src} segs={segs} width={W} height={H} offset={srcOffset} />
        <FastBadge segs={segs} accent={accent} x={W - 190} y={H - 62} />
        <CalloutLayer callouts={callouts} accent={accent} x={24} y={24} maxW={W - 48} />
      </div>
      <div style={{ position: "absolute", left: railX, top: Y, width: railW, bottom: 40, display: "flex", flexDirection: "column", gap: 28 }}>
        <Brand size={40} />
        <div style={{ height: 2, background: "#1E293B" }} />
        <StepCard steps={steps} accent={accent} compact width={railW} />
        <div style={{ height: 2, background: "#1E293B" }} />
        <StepList steps={steps} accent={accent} width={railW} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------- composition ---------- */
export const Tutorial: React.FC<TutorialProps> = (p) => {
  const accent = accentOf(p.script.feature);
  const segs = buildSegments(p.script, p.srcDuration, p.baseRate ?? 1);
  const bodyFrames = Math.round(outDuration(segs) * FPS);
  return (
    <AbsoluteFill style={{ background: "#0B1A36" }}>
      <Sequence from={0} durationInFrames={INTRO} layout="none"><Intro script={p.script} accent={accent} /></Sequence>
      <Sequence from={INTRO - XFADE} durationInFrames={bodyFrames} layout="none"><Body {...p} segs={segs} accent={accent} bodyFrames={bodyFrames} /></Sequence>
      <Sequence from={INTRO - XFADE + bodyFrames - XFADE} durationInFrames={OUTRO} layout="none"><OutroFade /></Sequence>
    </AbsoluteFill>
  );
};

const OutroFade: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, XFADE], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}><OutroCard /></AbsoluteFill>;
};
