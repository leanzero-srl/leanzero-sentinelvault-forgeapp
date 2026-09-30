import { Script, windowScript } from "./timeline";
import { TutorialProps } from "./Tutorial";
import { CompilationProps } from "./Compilation";
import sealFile from "./scripts/seal-file.json";
import editReq from "./scripts/edit-requests.json";
import autoRestore from "./scripts/auto-restore.json";
import sections from "./scripts/sealed-sections.json";
import validations from "./scripts/validations.json";
import approval from "./scripts/approval.json";
import siteProt from "./scripts/site-protection.json";
import auth from "./scripts/authenticator.json";
import expiry from "./scripts/expiry-alerts.json";
import classification from "./scripts/classification.json";

// The owner's two recordings, converted to fit 1920x1080 @30fps into public/src/<source>.mp4.
// Step scripts hold ABSOLUTE source seconds plus a [from, to] window; each tutorial is that window.
export const DIMS: Record<string, { w: number; h: number; d: number }> = {
  "rec-a": { w: 1920, h: 716, d: 778.43 },
  "rec-b": { w: 1446, h: 1080, d: 392.06 },
};

export const SCRIPTS: Script[] = [sealFile, editReq, autoRestore, sections, validations, approval, siteProt, auth, expiry, classification] as Script[];

const cut = (s: Script, from: number, to: number, extra: { from: number; to: number; rate?: number }[] = [], baseRate = 1): TutorialProps => ({
  script: { ...windowScript(s, from, to, extra), key: s.key },
  src: `src/${s.source}.mp4`,
  srcW: DIMS[s.source].w,
  srcH: DIMS[s.source].h,
  srcDuration: to - from,
  srcOffset: from,
  baseRate,
});

export const CATALOG: TutorialProps[] = SCRIPTS.map((s) => cut(s, s.from, s.to));

/* ---------- compilation: a highlight window per tutorial, normal stretches at 1.35x ---------- */
const by = Object.fromEntries(SCRIPTS.map((s) => [s.key, s]));
export const COMPILATION: CompilationProps = {
  chapters: [
    cut(by["seal-file"], 22, 46, [], 1.35),
    cut(by["edit-requests"], 46, 102, [], 1.35),
    cut(by["auto-restore"], 182, 230, [], 1.35),
    cut(by["sealed-sections"], 242, 302, [{ from: 246, to: 258, rate: 6 }], 1.35),
    cut(by["validations"], 458, 506, [{ from: 470, to: 494, rate: 4 }], 1.35),
    cut(by["approval"], 598, 642, [], 1.35),
    cut(by["authenticator"], 130, 162, [], 1.35),
    cut(by["classification"], 266, 316, [], 1.35),
  ],
};
