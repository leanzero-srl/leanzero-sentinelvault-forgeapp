#!/usr/bin/env python3
"""
Generate the music bed, to an exact duration.

numpy and the stdlib `wave` module only — scipy is not installed on this machine
and pulling it in for one low-pass filter would make the video unbuildable
anywhere it is missing. The filter here is a plain moving-average FIR via
np.convolve, which is all a pad this soft needs.

The bed is deliberately unobtrusive: a slow four-chord progression under a
muted pulse, mixed low, so it carries pacing without competing with the
on-screen text. Sentinel Vault's cut of the house sound is voiced a shade
steadier than the sibling apps' — Am / Em / F / G, a watchful loop that
resolves upward rather than the darker Am / G / F / E descent. It is generated
to the video's measured length rather than trimmed to it, so nothing has to be
faded off mid-phrase.

    python3 music.py <seconds> <out.wav>
"""
import sys
import wave

import numpy as np

SR = 44100


def adsr(n, a=0.25, d=0.2, s=0.7, r=0.45):
    """
    Amplitude envelope over n samples, times in seconds.

    The stages are scaled down proportionally when they do not fit — the pulse
    voice is shorter than attack+decay+release on its own, and an envelope that
    assumes it has room writes past the end of the note.
    """
    if n <= 1:
        return np.zeros(max(n, 0))
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    span = na + nd + nr
    if span > n:
        k = n / span
        na, nd, nr = int(na * k), int(nd * k), int(nr * k)
    ns = n - na - nd - nr
    parts = [np.linspace(0, 1, na, endpoint=False) if na else np.empty(0),
             np.linspace(1, s, nd, endpoint=False) if nd else np.empty(0),
             np.full(ns, s) if ns > 0 else np.empty(0),
             np.linspace(s, 0, nr) if nr else np.empty(0)]
    env = np.concatenate(parts)
    if len(env) < n:
        env = np.concatenate([env, np.zeros(n - len(env))])
    return env[:n]


def tone(freq, dur, amp=0.2, partials=(1.0, 0.5, 0.28, 0.14), detune=0.0015):
    """A soft additive-synth voice, slightly detuned so it is not a bare sine."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for i, level in enumerate(partials):
        h = i + 1
        out += level * np.sin(2 * np.pi * freq * h * t)
        out += level * 0.6 * np.sin(2 * np.pi * freq * h * (1 + detune) * t)
    out /= np.max(np.abs(out)) or 1.0
    return out * adsr(n) * amp


def lowpass(x, width):
    """Moving-average FIR — no scipy needed, and gentle is the point."""
    k = np.ones(width) / width
    return np.convolve(x, k, mode='same')


def build(seconds):
    total = int(seconds * SR)
    bed = np.zeros(total)

    # Four chords, cycling. Voiced low and wide so the pad sits under
    # speech-sized text without masking it. Am / Em / F / G — calm and level,
    # ending each cycle a step up: vigilance, not menace.
    chords = [
        (110.00, 130.81, 164.81),   # Am
        (82.41, 123.47, 164.81),    # Em
        (87.31, 130.81, 174.61),    # F
        (98.00, 146.83, 196.00),    # G
    ]
    bar = 6.0
    n_bars = int(np.ceil(seconds / bar))
    for b in range(n_bars):
        start = int(b * bar * SR)
        chord = chords[b % len(chords)]
        for j, f in enumerate(chord):
            v = tone(f, min(bar + 1.4, seconds - b * bar + 1.4), amp=0.17 - j * 0.02)
            end = min(start + len(v), total)
            if end > start:
                bed[start:end] += v[:end - start]

    # A quiet pulse on the half-bar, for pace.
    for b in range(int(seconds / (bar / 2)) + 1):
        start = int(b * (bar / 2) * SR)
        p = tone(220.0, 0.42, amp=0.045, partials=(1.0, 0.22))
        end = min(start + len(p), total)
        if end > start:
            bed[start:end] += p[:end - start]

    bed = lowpass(bed, 48)

    # Breathe — a slow amplitude drift so a 90-second bed does not read as a loop.
    t = np.arange(total) / SR
    bed *= 0.85 + 0.15 * np.sin(2 * np.pi * t / 23.0)

    # Head and tail fades, and headroom well under full scale.
    fade = int(1.6 * SR)
    bed[:fade] *= np.linspace(0, 1, fade)
    bed[-fade:] *= np.linspace(1, 0, fade)
    peak = np.max(np.abs(bed)) or 1.0
    return bed / peak * 0.42


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0
    out = sys.argv[2] if len(sys.argv) > 2 else 'music.wav'
    mono = build(seconds)
    # Widen very slightly: the right channel lags by a few milliseconds.
    delay = int(0.011 * SR)
    right = np.concatenate([np.zeros(delay), mono])[:len(mono)]
    stereo = np.stack([mono, right * 0.92], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype('<i2')
    with wave.open(out, 'w') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'music  {out}  {seconds:.2f}s')


if __name__ == '__main__':
    main()
