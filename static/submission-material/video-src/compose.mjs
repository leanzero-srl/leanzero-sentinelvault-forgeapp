#!/usr/bin/env node
/**
 * Compose the demo video: footage + plates + music → one 1920×1080 MP4.
 *
 * Per beat, ffmpeg builds a segment as black → footage → plate. The plate is
 * the brand backdrop with a rounded hole exactly where the footage is placed
 * (both read the same `windowRect`), so the plate supplies the corner radius,
 * the drop shadow and that beat's caption in one overlay.
 *
 * Segments are then crossfaded with xfade rather than hard-cut, and the music
 * is generated to the FINAL measured length instead of being trimmed to it — a
 * bed cut mid-phrase is the most obvious tell that a video was assembled.
 *
 *   node static/submission-material/video-src/compose.mjs
 */
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  BEAT_ORDER, BEAT_SECONDS, BEAT_START, windowRect, clipSize, clipDuration,
  OUT_W, OUT_H, FPS, TITLE_SECONDS, OUTRO_SECONDS, XFADE, CLIPS_DIR,
} from './layout.mjs';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATES = path.join(__dirname, 'plates');
const WORK = path.join(__dirname, '.work');
const OUT_FILE = path.resolve(__dirname, '../sentinel-vault-demo.mp4');

const run = (args, label) => execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  .catch((e) => { throw new Error(`${label}\n${e.stderr || e.message}`); });

/** A still plate held for `seconds`, encoded to match the beat segments. */
async function stillSegment(plate, seconds, out) {
  await run([
    '-loop', '1', '-t', String(seconds), '-i', plate,
    '-vf', `scale=${OUT_W}:${OUT_H},format=yuv420p`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out,
  ], `still ${plate}`);
}

/** One beat: footage scaled into the plate's window, plate over the top. */
async function beatSegment(beat, out) {
  const size = await clipSize(beat);
  const rect = windowRect(size.w, size.h);
  const start = BEAT_START[beat] ?? 0;
  const want = BEAT_SECONDS[beat];
  const have = await clipDuration(beat);
  const dur = Math.min(want, Math.max(1, have - start - 0.1));
  if (dur < want - 0.05) {
    console.warn(`  ! ${beat}: wanted ${want}s from ${start}s but the clip is only ${have.toFixed(1)}s — using ${dur.toFixed(1)}s`);
  }
  await run([
    '-ss', String(start), '-t', String(dur), '-i', path.join(CLIPS_DIR, `beat-${beat}.webm`),
    '-i', path.join(PLATES, `frame-${beat}.png`),
    '-filter_complex',
    `color=c=#020617:s=${OUT_W}x${OUT_H}:r=${FPS}:d=${dur}[bg];`
    + `[0:v]fps=${FPS},scale=${rect.w}:${rect.h}:flags=lanczos[fg];`
    + `[bg][fg]overlay=${rect.x}:${rect.y}:shortest=1[a];`
    + `[a][1:v]overlay=0:0:format=auto,format=yuv420p[v]`,
    '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out,
  ], `beat ${beat}`);
  return dur;
}

async function main() {
  for (const f of ['plates/title.png', 'plates/outro.png']) {
    if (!existsSync(path.join(__dirname, f))) {
      console.error(`Missing ${f}. Run plates.mjs first.`); process.exit(1);
    }
  }
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  const segments = [];
  const titleSeg = path.join(WORK, 's00-title.mp4');
  await stillSegment(path.join(PLATES, 'title.png'), TITLE_SECONDS, titleSeg);
  segments.push({ file: titleSeg, dur: TITLE_SECONDS });
  console.log(`segment title      ${TITLE_SECONDS.toFixed(2)}s`);

  for (const [i, beat] of BEAT_ORDER.entries()) {
    const out = path.join(WORK, `s${String(i + 1).padStart(2, '0')}-${beat}.mp4`);
    const dur = await beatSegment(beat, out);
    segments.push({ file: out, dur });
    console.log(`segment ${beat.padEnd(10)} ${dur.toFixed(2)}s`);
  }

  const outroSeg = path.join(WORK, 's99-outro.mp4');
  await stillSegment(path.join(PLATES, 'outro.png'), OUTRO_SECONDS, outroSeg);
  segments.push({ file: outroSeg, dur: OUTRO_SECONDS });
  console.log(`segment outro      ${OUTRO_SECONDS.toFixed(2)}s`);

  // Chain the crossfades. Each xfade eats XFADE seconds of overlap, so the
  // offset is the running length MINUS the fades already spent — get this wrong
  // and ffmpeg silently emits a video that freezes on the last segment.
  const inputs = segments.flatMap((s) => ['-i', s.file]);
  const steps = [];
  let acc = segments[0].dur;
  let label = '0:v';
  for (let i = 1; i < segments.length; i++) {
    const offset = acc - XFADE;
    const next = i === segments.length - 1 ? 'vout' : `x${i}`;
    steps.push(`[${label}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${next}]`);
    label = next;
    acc = acc + segments[i].dur - XFADE;
  }
  const silent = path.join(WORK, 'silent.mp4');
  await run([...inputs, '-filter_complex', steps.join(';'), '-map', '[vout]',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', silent], 'xfade chain');

  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent]);
  const total = Number(stdout.trim());
  const expected = acc;
  console.log(`\ntimeline  ${total.toFixed(2)}s  (expected ${expected.toFixed(2)}s)`);
  if (Math.abs(total - expected) > 0.6) {
    throw new Error(`xfade offsets are wrong: got ${total.toFixed(2)}s, expected ${expected.toFixed(2)}s`);
  }

  // Music generated to the measured length, so it ends with the picture.
  const wav = path.join(WORK, 'music.wav');
  const { stdout: mout } = await execFileP('python3', [path.join(__dirname, 'music.py'), total.toFixed(2), wav]);
  process.stdout.write(mout);

  // No -shortest: it truncates to whichever stream ffmpeg finishes first, which
  // has clipped the last second of picture in the sibling app's build before.
  await run(['-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT_FILE], 'mux');

  const { stdout: fin } = await execFileP('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_name,width,height', '-of', 'default=nw=1', OUT_FILE]);
  console.log(`\n${OUT_FILE}\n${fin.trim()}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
