# UNTRACKED — synthesize a dark, punchy-but-soft synth bed for the demo video.
# Am progression, rounded kick + sidechain pump, everything low-passed (not industrial).
#   /tmp/musenv/bin/python music-gen.py <out.wav> <seconds>
import sys, wave
import numpy as np
from scipy.signal import butter, sosfilt

OUT = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 77.0
sr = 44100
BPM = 100.0
beat = 60.0 / BPM
bar = beat * 4
NBARS = int(np.ceil(DUR / bar)) + 1   # generate a little extra, then trim to exact DUR
N = int(NBARS * bar * sr)
TARGET = int(DUR * sr)
def lp(x, cut): return sosfilt(butter(4, cut, btype="low", fs=sr, output="sos"), x)
def add(buf, st, a):  # length-safe accumulate (avoids off-by-one at bar boundaries)
    n = min(len(a), len(buf) - st)
    if n > 0: buf[st:st + n] += a[:n]

# Am – F – C – G  (i – VI – III – VII), dark but warm
PROG = [
    (110.00, [220.00, 261.63, 329.63]),  # Am: A2 | A3 C4 E4
    (87.31,  [220.00, 261.63, 349.23]),  # F : F2 | A3 C4 F4
    (130.81, [261.63, 329.63, 392.00]),  # C : C3 | C4 E4 G4
    (98.00,  [246.94, 293.66, 392.00]),  # G : G2 | B3 D4 G4
]

pad = np.zeros(N); bass = np.zeros(N); arp = np.zeros(N); kick = np.zeros(N)
for b in range(NBARS):
    bf, chord = PROG[b % 4]
    s = int(b * bar * sr); e = int((b + 1) * bar * sr); L = e - s; tt = np.arange(L) / sr
    # pad: soft swelling chord
    env = np.clip(np.minimum(tt / 0.45, (bar - tt) / 0.55), 0, 1)
    p = sum(np.sin(2 * np.pi * cf * tt) + 0.25 * np.sin(2 * np.pi * 2 * cf * tt) for cf in chord)
    add(pad, s, p * env / len(chord))
    for k in range(4):
        bs = int(k * beat * sr); be = int(min((k + 1) * beat, bar) * sr); bl = be - bs; bt = np.arange(bl) / sr
        # sub bass pluck
        penv = np.exp(-bt * 3.5) * (1 - np.exp(-bt * 70))
        add(bass, s + bs, (np.sin(2 * np.pi * bf * bt) + 0.3 * np.sin(2 * np.pi * bf * 2 * bt)) * penv)
        # soft rounded kick on each beat
        kf = np.linspace(115, 45, bl); ph = 2 * np.pi * np.cumsum(kf) / sr
        add(kick, s + bs, np.sin(ph) * np.exp(-bt * 13))
    # gentle arp, eighth notes
    for j in range(8):
        js = int(j * (beat / 2) * sr); je = int(min((j + 1) * (beat / 2), bar) * sr); jl = je - js; jt = np.arange(jl) / sr
        nf = chord[j % len(chord)]
        aenv = np.exp(-jt * 7) * (1 - np.exp(-jt * 110))
        add(arp, s + js, np.sin(2 * np.pi * nf * jt) * aenv)

pad = lp(pad, 1800); arp = lp(arp, 2600); bass = lp(bass, 380); kick = lp(kick, 150)

# sidechain pump: duck the tonal layers on every beat
duck = np.ones(N)
for b in range(NBARS):
    for k in range(4):
        ds = int((b * bar + k * beat) * sr); seg = int(0.25 * sr)
        x = np.arange(min(seg, N - ds)) / sr
        d = 0.55 + 0.45 * (1 - np.exp(-x / 0.06))
        duck[ds:ds + len(d)] = np.minimum(duck[ds:ds + len(d)], d)

mix = (pad * 0.50 + arp * 0.42 + bass * 0.85) * duck + kick * 0.95
mix = mix[:TARGET]                  # trim to the exact video length
mix = np.tanh(mix * 1.05)           # soft saturation (no harsh transients)
mix = lp(mix, 11000)                # tame the highs
mix = mix / np.max(np.abs(mix)) * 0.88
fi = int(2.0 * sr); fo = int(3.5 * sr)
mix[:fi] *= np.linspace(0, 1, fi); mix[-fo:] *= np.linspace(1, 0, fo)
# subtle stereo width via a few-ms delay on one channel
d = int(0.008 * sr)
left = mix; right = np.concatenate([np.zeros(d), mix])[:mix.shape[0]]
data = (np.stack([left, right], axis=1) * 32767).astype(np.int16)
with wave.open(OUT, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(data.tobytes())
print(f"wrote {OUT}  {NBARS} bars  {N/sr:.1f}s")
