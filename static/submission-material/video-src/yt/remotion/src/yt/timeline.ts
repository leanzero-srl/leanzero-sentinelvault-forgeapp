// Time remapping for the YouTube tutorials: dead zones (waiting / nothing changes) are
// played back faster, and every step/callout timestamp is mapped from source seconds to
// output seconds through the same segment list, so overlays stay in sync with the footage.

export type Step = { t: number; label: string; detail: string };
export type Callout = { t: number; duration: number; text: string };
export type DeadZone = { from: number; to: number; why?: string; rate?: number };
export type Script = {
  key: string;
  title: string;
  subtitle: string;
  feature: string;
  source: "rec-a" | "rec-b"; // which owner recording
  from: number; // source window start (absolute seconds in the recording)
  to: number; // source window end
  steps: Step[];
  callouts: Callout[];
  deadZones: DeadZone[];
  trimEnd?: number; // source seconds; drop everything after this
  summary?: string;
};

export type Segment = { inStart: number; inEnd: number; rate: number; outStart: number; outEnd: number };

const MIN_OUT = 4; // a sped-up stretch never lasts less than this on screen
const MAX_RATE = 4;

export const buildSegments = (script: Script, srcDuration: number, baseRate = 1): Segment[] => {
  const end = Math.min(srcDuration, script.trimEnd ?? srcDuration);
  const zones = [...script.deadZones]
    .filter((z) => z.to - z.from >= 6 && z.from < end)
    .map((z) => ({ from: Math.max(0, z.from), to: Math.min(end, z.to), rate: z.rate }))
    .sort((a, b) => a.from - b.from);
  const segs: Segment[] = [];
  let cursor = 0;
  let out = 0;
  const push = (a: number, b: number, rate: number) => {
    if (b - a <= 0.01) return;
    const dur = (b - a) / rate;
    segs.push({ inStart: a, inEnd: b, rate, outStart: out, outEnd: out + dur });
    out += dur;
  };
  for (const z of zones) {
    if (z.from > cursor) push(cursor, z.from, baseRate);
    const len = z.to - Math.max(cursor, z.from);
    const rate = z.rate ?? Math.min(MAX_RATE, Math.max(2, len / MIN_OUT));
    push(Math.max(cursor, z.from), z.to, rate);
    cursor = z.to;
  }
  if (cursor < end) push(cursor, end, baseRate);
  return segs;
};

export const mapTime = (segs: Segment[], srcSec: number): number => {
  for (const s of segs) {
    if (srcSec <= s.inEnd) return s.outStart + Math.max(0, srcSec - s.inStart) / s.rate;
  }
  const last = segs[segs.length - 1];
  return last ? last.outEnd : 0;
};

export const outDuration = (segs: Segment[]) => (segs.length ? segs[segs.length - 1].outEnd : 0);

/* Cut a script to a source window [from, to] and rebase every timestamp to 0 (for compilations). */
export const windowScript = (s: Script, from: number, to: number, extraZones: DeadZone[] = []): Script => {
  const sh = (t: number) => Math.max(0, t - from);
  const steps = s.steps.filter((x) => x.t > from && x.t < to).map((x) => ({ ...x, t: sh(x.t) }));
  // the step that was active at `from` becomes step 1 at t=0
  const before = s.steps.filter((x) => x.t <= from);
  if (before.length && steps[0]?.t !== 0) steps.unshift({ ...before[before.length - 1], t: 0 });
  const zones = [...s.deadZones, ...extraZones]
    .filter((z) => z.to > from && z.from < to)
    .map((z) => ({ ...z, from: sh(z.from), to: Math.min(to, z.to) - from }));
  const callouts = s.callouts.filter((c) => c.t >= from && c.t < to).map((c) => ({ ...c, t: sh(c.t) }));
  return { ...s, steps, callouts, deadZones: zones, trimEnd: to - from };
};
