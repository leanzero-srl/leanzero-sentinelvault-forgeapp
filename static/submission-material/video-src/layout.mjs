/**
 * The one place the video's geometry, running order and captions are defined.
 *
 * plates.mjs punches the window and compose.mjs positions the footage inside it;
 * both read `windowRect` from here, because a plate whose hole disagrees with
 * the overlay offset by even a pixel shows a bright seam along one edge.
 *
 * Ported from lz-ppm-forge's Generation-2 pipeline; the beats film Sentinel
 * Vault's mocked-bridge screenshot surfaces instead of live-app routes.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const OUT_W = 1920;
export const OUT_H = 1080;
export const FPS = 30;

/** Footage lives in this band; the lower third sits beneath it, never over it. */
const BAND = { top: 92, height: 792, maxW: 1610 };

/** Fit a clip inside the band, centred, snapped to even pixels for H.264. */
export function windowRect(clipW, clipH) {
  const scale = Math.min(BAND.maxW / clipW, BAND.height / clipH);
  const w = Math.round((clipW * scale) / 2) * 2;
  const h = Math.round((clipH * scale) / 2) * 2;
  return {
    w, h,
    x: Math.round((OUT_W - w) / 2 / 2) * 2,
    y: Math.round((BAND.top + (BAND.height - h) / 2) / 2) * 2,
  };
}

export const CLIPS_DIR = path.join(__dirname, 'clips');

/** Native pixel size of a recorded beat. */
export async function clipSize(beat) {
  const file = path.join(CLIPS_DIR, `beat-${beat}.webm`);
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0', file,
    ]);
    const [w, h] = stdout.trim().split(',').map(Number);
    return w && h ? { w, h } : null;
  } catch { return null; }
}

/** Seconds of a recorded beat. */
export async function clipDuration(beat) {
  const file = path.join(CLIPS_DIR, `beat-${beat}.webm`);
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

/**
 * The cut. The value story, in order:
 *   seal      → one click reserves a file
 *   protect   → the ribbon: tampering is undone automatically
 *   sections  → the same custody for a section of the page body
 *   requests  → edit requests: ask, owner approves, scoped access
 *   validate  → deterministic content rules (advisory / gate / revert)
 *   ai        → the optional AI review on Atlassian-hosted models
 *   workflow  → the workflow chip: states the app ENFORCES
 *   approve   → the multi-approver sign-off dialog, on the page
 *   steward   → global policy in one console
 *   dashboard → the space register: every page's state, CSV export
 */
export const BEAT_ORDER = [
  'seal', 'protect', 'sections', 'requests', 'validate',
  'ai', 'workflow', 'approve', 'steward', 'dashboard',
];

/**
 * How long each beat runs in the cut. Recorded clips are longer on purpose — it
 * is far cheaper to trim a hold than to re-record one that ended too early.
 *
 * `seal` and `approve` get the most air: sealing is the product's headline verb
 * and the approval dialog is the differentiator ("everyone tracks, Sentinel
 * Vault enforces") — the viewer must be able to READ the approver rows.
 */
export const BEAT_SECONDS = {
  seal: 10,
  protect: 7,
  sections: 9,
  requests: 8,
  validate: 7,
  ai: 9,
  workflow: 8,
  approve: 10,
  steward: 7,
  dashboard: 9,
};

/**
 * Where in each recording the usable footage starts. Every recording opens with
 * ~1s of settle before the first gesture; trim most of it.
 *
 * NOTE on `seal`: the beat ENDS on the "Sealing…" busy state on purpose. The
 * bridge mock's data is canned, so after the refetch the card snaps back to
 * "Available" — the cut must end before that renders (see VIDEO-README).
 */
export const BEAT_START = {
  seal: 0.8,
  protect: 0.6,
  sections: 0.8,
  requests: 0.8,
  validate: 0.8,
  ai: 0.8,
  workflow: 0.6,
  approve: 0.6,
  steward: 0.8,
  dashboard: 0.8,
};

export const LOWER_THIRDS = {
  seal: ['Seal a file — now it is enforced',
    'One click reserves the attachment. Everyone sees who holds the seal and until when — nobody else can replace it'],
  protect: ['Tampering is undone automatically',
    'Replace, edit or trash a sealed file and Sentinel Vault puts the previous version back — and tells everyone involved'],
  sections: ['Seal a section of the page itself',
    'Pick a heading — that section is snapshotted. Edits or removal by anyone else are restored from the snapshot'],
  requests: ['Need to edit a sealed file? Ask',
    'The owner approves it from their console. Approved editors can replace the file until the seal expires'],
  validate: ['Check pages against your rules',
    'Required headings, tables and labels — advisory comments, a pass/fail gate, or hard revert to the last compliant version'],
  ai: ['An optional AI review — data stays put',
    'Atlassian-hosted Claude via Forge LLM: style, tone and compliance findings. No keys, no egress, off by default'],
  workflow: ['Everyone tracks status. This one enforces it',
    'Draft → In Review → Approved, on the page itself. An Approved page that is tampered with is reverted, not just flagged'],
  approve: ['Approvals, right on the page',
    'Any one, all, or a minimum number of approvers. Every decision is recorded with its reason, where the work is'],
  steward: ['Set policy once, for every space',
    'Seal durations, restore and delete rights, notification channels and validation rules — one admin console'],
  dashboard: ['Know where every page stands',
    'The whole space by workflow state, overdue reviews flagged — and the register exports to CSV'],
};

export const TITLE_SECONDS = 4.5;
export const OUTRO_SECONDS = 6;
/** Crossfade between segments. */
export const XFADE = 0.45;
