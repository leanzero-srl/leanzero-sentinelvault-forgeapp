import React from "react";
import { Composition, Still } from "remotion";
import { ClipDemo, PROMO_TOTAL, ShortDemo, SHORT_TOTAL } from "./ClipDemo";
import { Thumb } from "./Thumbs";
import { C } from "./brand";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={ClipDemo} durationInFrames={PROMO_TOTAL} fps={30} width={1920} height={1080} />
    <Composition id="Short" component={ShortDemo} durationInFrames={SHORT_TOTAL} fps={30} width={1080} height={1920} />
    <Still id="ThumbPromo" component={Thumb} width={1280} height={720} defaultProps={{ still: "thumb-promo.png", line1: "Lock it.", line2: "It stays locked.", chip: "Confluence · v6.4", chipColor: C.seal }} />
    <Still id="ThumbShort" component={Thumb} width={1280} height={720} defaultProps={{ still: "thumb-short.png", line1: "Tamper?", line2: "Reverted.", chip: "Sealed sections", chipColor: C.orange }} />
  </>
);
