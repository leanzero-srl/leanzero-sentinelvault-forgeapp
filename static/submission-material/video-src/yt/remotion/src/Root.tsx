import React from "react";
import { Composition } from "remotion";
import { Tutorial, tutorialFrames, FPS } from "./yt/Tutorial";
import { CATALOG, COMPILATION } from "./yt/catalog";
import { Compilation, compilationFrames } from "./yt/Compilation";

export const RemotionRoot: React.FC = () => (
  <>
    {CATALOG.map((p) => (
      <Composition key={p.script.key} id={`yt-${p.script.key}`} component={Tutorial} durationInFrames={tutorialFrames(p)} fps={FPS} width={1920} height={1080} defaultProps={p} />
    ))}
    <Composition id="yt-compilation" component={Compilation} durationInFrames={compilationFrames(COMPILATION)} fps={FPS} width={1920} height={1080} defaultProps={COMPILATION} />
  </>
);
