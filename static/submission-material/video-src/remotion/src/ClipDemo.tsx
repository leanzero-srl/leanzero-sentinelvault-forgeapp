import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { TitleCard, OutroCard, TextScene } from "./SceneComponents";
import { ClipScene, VClipScene, Beat } from "./ClipScene";
import { C } from "./brand";

const T = 12; // crossfade frames
type Seq = { dur: number; el: React.ReactNode };

const series = (seqs: Seq[]) => {
  const children: React.ReactNode[] = [];
  seqs.forEach((s, i) => {
    if (i > 0) children.push(<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: T })} />);
    children.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.dur}>{s.el}</TransitionSeries.Sequence>);
  });
  return <TransitionSeries>{children}</TransitionSeries>;
};
const total = (seqs: Seq[]) => seqs.reduce((s, x) => s + x.dur, 0) - T * (seqs.length - 1);

/* ---------- Main promo (16:9). Every claim below is visible in its clip or documented in docs/user-guide.md / LISTING-COPY.md. */
export const BEATS: Record<string, Beat> = {
  seal: { src: "clips/01-seal.mp4", dur: 172, accent: C.seal, eyebrow: "Seal attachments", title: "Seal a file in one click", sub: "Only you, and the editors you approve, can change a sealed file." },
  request: { src: "clips/02-request.mp4", dur: 330, accent: C.purple, eyebrow: "Edit requests", title: "Colleagues ask. The owner decides.", sub: "Owner on the left, colleague on the right: approve, and they can edit until the time you set." },
  decline: { src: "clips/03-decline.mp4", dur: 300, accent: C.red, eyebrow: "Decline with a reason", title: "A 'no' that explains itself", sub: "The colleague sees why, and when they can ask again." },
  restored: { src: "clips/04-restored.mp4", dur: 330, accent: C.seal, eyebrow: "Auto-restore", title: "Overwrite a sealed file? It's put back.", sub: "The sealed version is restored and the attachments list says who did it." },
  secpick: { src: "clips/05-sec-pick.mp4", dur: 217, accent: C.blue, eyebrow: "Sealed sections", title: "Freeze a heading and everything under it", sub: "Pick how long it holds. The rest of the page stays editable." },
  secrevert: { src: "clips/06-sec-revert.mp4", dur: 360, from: 40, accent: C.orange, eyebrow: "Auto-revert", title: "Edit a sealed section and it's undone", sub: "The editor's text isn't lost: it's kept in the page history." },
  comments: { src: "clips/07-comments.mp4", dur: 181, accent: C.amber, eyebrow: "Content validations", title: "Pages that miss the standard get flagged", sub: "Required headings, labels and more, with a comment to the author." },
  toggles: { src: "clips/08-site-toggles.mp4", dur: 300, accent: C.seal, eyebrow: "Site settings", title: "Your protection policy, switch by switch", sub: "Nothing changes until you press Apply." },
  sign: { src: "clips/09-sign.mp4", dur: 400, accent: C.green, eyebrow: "Signed decisions", title: "Sign with your authenticator code", sub: "Releasing, extending and approving can require the current 6-digit code." },
  classif: { src: "clips/10-classif.mp4", dur: 330, accent: C.orange, eyebrow: "Classification", title: "Public · Internal · Confidential · Restricted", sub: "Turn it on and every page shows its level under the title and in the top banner." },
  spacedef: { src: "clips/11-space-default.mp4", dur: 208, accent: C.pink, eyebrow: "Space defaults", title: "Classify a whole space at once" },
  banner: { src: "clips/13-banner.mp4", dur: 200, accent: C.orange, eyebrow: "On every page", title: "Everyone sees how sensitive it is" },
  reason: { src: "clips/12-reason.mp4", dur: 246, accent: C.red, eyebrow: "Audit trail", title: "Lowering a level needs a reason", sub: "It is kept in the activity log." },
  api: { src: "clips/14-api.mp4", dur: 200, from: 56, accent: C.blue, eyebrow: "API access", title: "Script it over REST", sub: "One endpoint and role-scoped tokens. Only a hash of each token is stored." },
};
const clip = (b: Beat) => ({ dur: b.dur, el: <ClipScene {...b} /> });

const PROMO: Seq[] = [
  { dur: 100, el: <TitleCard /> },
  { dur: 140, el: <TextScene kicker="Why Sentinel Vault" accent={C.seal} lines={["Confluence tracks who changed a document.", "Sentinel Vault decides whether the change stands."]} /> },
  clip(BEATS.seal), clip(BEATS.request), clip(BEATS.decline), clip(BEATS.restored),
  clip(BEATS.secpick), clip(BEATS.secrevert), clip(BEATS.comments),
  { dur: 110, el: <TextScene kicker="For site admins" accent={C.green} lines={["One console.", "Every space."]} /> },
  clip(BEATS.toggles), clip(BEATS.sign), clip(BEATS.classif), clip(BEATS.spacedef), clip(BEATS.banner), clip(BEATS.reason), clip(BEATS.api),
  { dur: 210, el: <OutroCard /> },
];
export const PROMO_TOTAL = total(PROMO);
export const ClipDemo: React.FC = () => series(PROMO);

/* ---------- YouTube Short (9:16, <=55s): the punchiest beats, square zooms. */
const v = (b: Beat, dur: number, from: number, focusX: number, zoom: number, title?: string) => ({ dur, el: <VClipScene {...b} title={title ?? b.title} sub={undefined} from={from} focusX={focusX} zoom={zoom} /> });
const SHORT: Seq[] = [
  { dur: 60, el: <TitleCard vertical /> },
  { dur: 75, el: <TextScene vertical kicker="Confluence content protection" accent={C.seal} lines={["Your files.", "Sealed.", "Tamper-proof."]} /> },
  v(BEATS.seal, 120, 40, 0.52, 1.35, "Seal a file in one click"),
  v(BEATS.restored, 220, 110, 0.42, 1.6, "Overwrite it? It's put back."),
  v(BEATS.secrevert, 250, 150, 0.5, 1.5, "Sealed section edited? Undone."),
  v(BEATS.request, 210, 60, 0.5, 1.0, "Colleagues ask. Owners decide."),
  v(BEATS.sign, 230, 150, 0.55, 1.5, "Sign decisions with your authenticator"),
  v(BEATS.classif, 170, 90, 0.5, 1.2, "Classify every page"),
  v(BEATS.banner, 120, 20, 0.35, 1.6, "Everyone sees the level"),
  { dur: 120, el: <OutroCard vertical /> },
];
export const SHORT_TOTAL = total(SHORT);
export const ShortDemo: React.FC = () => series(SHORT);
