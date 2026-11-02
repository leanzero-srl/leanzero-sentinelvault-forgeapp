/*
 * ELZI, LeanZero's mascot, as a still pose (nux/elziPoses.js, generated from the content rig by
 * scripts/gen-elzi-poses.mjs). Two variants:
 *   - body: her corner tile (Mascot.tsx MascotBubble's) with body, head, face and arms; a pointing
 *     arm is drawn over the tile border so the hand breaks out toward what she points at;
 *   - head: ONLY her logo-cube head with its LED face (owner 2026-10-29: surfaces under ~480 px).
 * The FACE is composed here per step (design review 2026-10-29: steps must differ, and the eyes look
 * toward the target): an expression (idle, wave, look, curious, surprised, happy) and a look vector
 * [-1..1, -1..1]. The fragments are this bundle's own constants (no user text ever reaches them), so
 * they are set as markup. The idle bob is CSS only (.nux-elzi-bob) and stops under
 * prefers-reduced-motion. Decorative: the bubble carries the words.
 */
import React, { useId } from "react";
import { ELZI_ARMS, ELZI_BASE, ELZI_FACE as F, ELZI_FACE_AT as AT, ELZI_HEAD, ELZI_HEAD_VIEWBOX, ELZI_TILE, ELZI_VIEWBOX } from "./elziPoses.js";

// Each expression = which eyes, brows and mouth. Names are what tourSteps.js puts on a step (face).
export const ELZI_EXPRESSIONS = Object.freeze({
  idle: { eyes: "open", brows: "browNeutral", mouth: "mouthRest" },
  wave: { eyes: "open", brows: "browUp", mouth: "mouthSmile" },
  look: { eyes: "open", brows: "browUp", mouth: "mouthSmile" },
  curious: { eyes: "open", brows: "browUp", mouth: "mouthO" },
  surprised: { eyes: "ring", brows: "browUp", mouth: "mouthO" },
  happy: { eyes: "happy", brows: "browUp", mouth: "mouthSmile" },
});
// How far the LED eyes travel for a full look (rig units). The rig's own range (9) moves them ~2 px
// at head size, which nobody sees; this reads as "she looks over there" from 56 px up.
const LOOK = 20;
const PUPIL = 14;

const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
const t = (x, y) => `translate(${+x.toFixed(2)} ${+y.toFixed(2)})`;
export function faceSvg(expression = "idle", look = [0, 0]) {
  const e = ELZI_EXPRESSIONS[expression] || ELZI_EXPRESSIONS.idle;
  const lx = clamp1(look[0]), ly = clamp1(look[1]);
  let eyes = "";
  for (const [x, y] of [AT.eyeL, AT.eyeR]) {
    if (e.eyes === "happy") eyes += `<g transform="${t(x, y)}">${F.eyeHappy}</g>`;
    else if (e.eyes === "ring") eyes += `<g transform="${t(x, y)}">${F.eyeRing}<g transform="${t(lx * PUPIL, ly * PUPIL)}">${F.eyeRingPupil}</g></g>`;
    else eyes += `<g transform="${t(x + (AT.eyeRest[0] + lx * LOOK) * 0.6, y + (AT.eyeRest[1] + ly * LOOK) * 0.6)}">${F.eyeOpen}</g>`;
  }
  const brows = `<g transform="${t(AT.browL[0], AT.browL[1])}">${F[e.brows]}</g><g transform="${t(AT.browR[0], AT.browR[1])} scale(-1 1)">${F[e.brows]}</g>`;
  const mouth = `<g transform="${t(AT.mouth[0], AT.mouth[1])}">${F[e.mouth]}</g>`;
  return eyes + brows + mouth;
}

function ElziHead({ pose, face, look, size }) {
  const [, , w, h] = ELZI_HEAD_VIEWBOX.split(" ").map(Number);
  return (
    <svg className="nux-elzi nux-elzi-head" data-pose={pose} data-face={face} data-variant="head" width={size} height={Math.round((size * h) / w)} viewBox={ELZI_HEAD_VIEWBOX} aria-hidden="true" focusable="false">
      <g className="nux-elzi-bob" dangerouslySetInnerHTML={{ __html: ELZI_HEAD + faceSvg(face, look) }} />
    </svg>
  );
}

export default function Elzi({ pose = "idle", face = "idle", look = [0, 0], size = 72, head = false }) {
  const clip = `nuxtile${useId().replace(/[^a-zA-Z0-9]/g, "")}`; // before any return: one hook order
  if (head) return <ElziHead pose={pose} face={face} look={look} size={size} />;
  const arms = ELZI_ARMS[pose] || ELZI_ARMS.idle;
  const [, , w, h] = ELZI_VIEWBOX.split(" ").map(Number);
  return (
    <svg
      className="nux-elzi"
      data-pose={pose}
      data-face={face}
      data-variant="body"
      width={size}
      height={Math.round((size * h) / w)}
      viewBox={ELZI_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      <defs><clipPath id={clip}><polygon points={ELZI_TILE.points} /></clipPath></defs>
      <polygon points={ELZI_TILE.points} fill={ELZI_TILE.shadow} transform="translate(20 20)" />
      <polygon points={ELZI_TILE.points} fill={ELZI_TILE.fill} />
      <g clipPath={`url(#${clip})`}>
        <g className="nux-elzi-bob" dangerouslySetInnerHTML={{ __html: ELZI_BASE + faceSvg(face, look) + arms.main }} />
      </g>
      <polygon points={ELZI_TILE.points} fill="none" stroke={ELZI_TILE.border} strokeWidth={12} strokeLinejoin="miter" />
      {arms.over && <g className="nux-elzi-bob" dangerouslySetInnerHTML={{ __html: arms.over }} />}
    </svg>
  );
}
