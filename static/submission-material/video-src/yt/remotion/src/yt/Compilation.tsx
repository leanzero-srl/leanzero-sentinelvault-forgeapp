import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { TitleCard, OutroCard, TextScene } from "../SceneComponents";
import { Body, Intro, accentOf, FPS, XFADE, TutorialProps } from "./Tutorial";
import { buildSegments, outDuration } from "./timeline";

export const CH_CARD = 80; // chapter card frames
const TITLE = 95, WHY = 130, OUTRO = 170;

export type CompilationProps = { chapters: TutorialProps[] };

const chapterFrames = (p: TutorialProps) => Math.round(outDuration(buildSegments(p.script, p.srcDuration, p.baseRate ?? 1)) * FPS);

export const compilationFrames = (c: CompilationProps) =>
  TITLE + WHY + c.chapters.reduce((s, p) => s + CH_CARD + chapterFrames(p), 0) + OUTRO - XFADE * (2 + c.chapters.length * 2);

const Fade: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(
    interpolate(f, [0, XFADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(f, [frames - XFADE, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Compilation: React.FC<CompilationProps> = ({ chapters }) => {
  const items: { frames: number; el: React.ReactNode }[] = [];
  items.push({ frames: TITLE, el: <Fade frames={TITLE}><TitleCard /></Fade> });
  items.push({ frames: WHY, el: <Fade frames={WHY}><TextScene kicker={`${chapters.length === 8 ? "Eight" : chapters.length} features, one app`} accent="#0891B2" lines={["Seal files and page sections,", "answer edit requests, enforce approvals", "and classification, inside Confluence."]} /></Fade> });
  chapters.forEach((p, i) => {
    const accent = accentOf(p.script.feature);
    const segs = buildSegments(p.script, p.srcDuration, p.baseRate ?? 1);
    const bf = chapterFrames(p);
    items.push({ frames: CH_CARD, el: <Intro script={p.script} accent={accent} frames={CH_CARD} kicker={`${i + 1} / ${chapters.length}`} /> });
    items.push({ frames: bf, el: <Body {...p} segs={segs} accent={accent} bodyFrames={bf} /> });
  });
  items.push({ frames: OUTRO, el: <Fade frames={OUTRO}><OutroCard /></Fade> });

  let from = 0;
  return (
    <AbsoluteFill style={{ background: "#0B1A36" }}>
      {items.map((it, i) => {
        const el = <Sequence key={i} from={from} durationInFrames={it.frames} layout="none">{it.el}</Sequence>;
        from += it.frames - XFADE;
        return el;
      })}
    </AbsoluteFill>
  );
};
