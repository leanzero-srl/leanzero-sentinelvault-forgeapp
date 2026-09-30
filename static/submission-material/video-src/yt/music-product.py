#!/usr/bin/env python3
# UNTRACKED — original, royalty-free "product walkthrough" bed for LeanZero videos.
#
#   /tmp/musenv/bin/python music-product.py <out.wav> <seconds> [seed]
#
# Design (from what actually works under SaaS demo / explainer videos): minimal and restrained,
# NO lead melody competing with the screen. A felt-piano ostinato in the Steve Reich vein, a
# marimba counter-pattern that enters late, a soft ambient pad, a sub bass, and hand percussion
# (shaker 16ths, finger snaps on 2 & 4, a light kick) — all in a real reverb, at 100 BPM.
# Everything is synthesised from primitives (no samples), so there is nothing to license.
import sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

OUT = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 90.0
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 3
rng = np.random.default_rng(SEED)

sr = 44100
BPM = 100.0
beat = 60.0 / BPM
bar = beat * 4
eighth = beat / 2
six = beat / 4
NBARS = int(np.ceil(DUR / bar)) + 2
N = int(NBARS * bar * sr)
TARGET = int(DUR * sr)

def lp(x, cut, order=4): return sosfilt(butter(order, cut, btype="low", fs=sr, output="sos"), x)
def hp(x, cut, order=2): return sosfilt(butter(order, cut, btype="high", fs=sr, output="sos"), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], btype="band", fs=sr, output="sos"), x)
def add(buf, st, a):
    st = max(0, int(st)); n = min(len(a), len(buf) - st)
    if n > 0: buf[st:st + n] += a[:n]
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------- instruments ----------
def felt_piano(m, dur, vel=1.0):
    """Muffled, intimate piano: a few partials with slight inharmonicity, soft hammer, long decay."""
    t = np.arange(int(dur * sr)) / sr
    f = hz(m)
    tone = np.zeros_like(t)
    for k, amp in ((1, 1.0), (2, 0.28), (3, 0.10), (4, 0.05)):
        fk = f * k * (1 + 0.0004 * k * k)  # string stiffness
        tone += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t * (1.6 + 0.9 * k))
    hammer = rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.08
    env = (1 - np.exp(-t * 900))
    out = (tone + hammer) * env * vel
    return lp(out, 1800 + 600 * vel, 2)

def marimba(m, dur, vel=1.0):
    """Wooden bar: fundamental + 4th partial that dies fast, short decay."""
    t = np.arange(int(dur * sr)) / sr
    f = hz(m)
    out = np.sin(2 * np.pi * f * t) * np.exp(-t * 5.5) + 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 28)
    out += 0.03 * rng.standard_normal(len(t)) * np.exp(-t * 300)
    return out * (1 - np.exp(-t * 1500)) * vel

def pad_chord(notes, dur):
    t = np.arange(int(dur * sr)) / sr
    out = np.zeros_like(t)
    for m in notes:
        f = hz(m)
        for det in (-0.6, 0.0, 0.7):  # gentle chorus
            fd = f * 2 ** (det / 1200)
            out += (np.sin(2 * np.pi * fd * t) + 0.3 * np.sin(2 * np.pi * 2 * fd * t) + 0.12 * np.sin(2 * np.pi * 3 * fd * t))
    a, r = 0.9, 0.9
    env = np.minimum(t / a, 1) * np.minimum((dur - t) / r, 1)
    return lp(out / (len(notes) * 3), 900, 2) * env

def sub_bass(m, dur):
    t = np.arange(int(dur * sr)) / sr
    f = hz(m)
    env = (1 - np.exp(-t * 60)) * np.minimum((dur - t) / 0.25, 1) * np.exp(-t * 0.35)
    return (np.sin(2 * np.pi * f * t) + 0.12 * np.sin(2 * np.pi * 2 * f * t)) * env

def shaker(vel=1.0):
    t = np.arange(int(0.09 * sr)) / sr
    n = rng.standard_normal(len(t)) * (np.exp(-t * 55) * (1 - np.exp(-t * 900)))
    return bp(n, 3500, 11000) * vel

def snap():
    t = np.arange(int(0.16 * sr)) / sr
    n = rng.standard_normal(len(t)) * np.exp(-t * 45)
    click = np.sin(2 * np.pi * 1900 * t) * np.exp(-t * 180) * 0.6
    return bp(n, 900, 5000) * 0.8 + click

def kick():
    t = np.arange(int(0.28 * sr)) / sr
    f = np.linspace(110, 46, len(t)); ph = 2 * np.pi * np.cumsum(f) / sr
    return np.sin(ph) * np.exp(-t * 14) * (1 - np.exp(-t * 800))

# ---------- harmony (C major, warm 7ths/9ths) ----------
# I(add9) – vi7 – IV(maj7) – V(sus2→) ; 8-bar loop: Cadd9 Am7 Fmaj7 G | Cadd9 Em7 Fmaj7 Gsus2
C4, D4, E4, F4, G4, A4, B4 = 60, 62, 64, 65, 67, 69, 71
CHORDS = {
    "C":  {"root": 36, "pad": [C4, E4, G4, D4 + 12], "pat": [C4, G4, E4 + 12, D4 + 12, G4, E4 + 12, C4 + 12, G4]},
    "Am": {"root": 33, "pad": [A4 - 12, C4, E4, G4],  "pat": [A4 - 12, E4, C4 + 12, B4, E4, C4 + 12, A4, E4]},
    "F":  {"root": 29, "pad": [F4 - 12, A4 - 12, C4, E4], "pat": [F4 - 12, C4, A4, G4, C4, A4, F4, C4]},
    "G":  {"root": 31, "pad": [G4 - 12, B4 - 12, D4, G4], "pat": [G4 - 12, D4, B4, A4, D4, B4, G4, D4]},
    "Em": {"root": 28, "pad": [E4 - 12, G4 - 12, B4 - 12, D4], "pat": [E4 - 12, B4 - 12, G4, D4 + 12, B4 - 12, G4, E4, B4 - 12]},
    "Gs": {"root": 31, "pad": [G4 - 12, A4 - 12, D4, G4], "pat": [G4 - 12, D4, A4, G4, D4, A4, G4, D4]},
}
LOOP = ["C", "Am", "F", "G", "C", "Em", "F", "Gs"]
# marimba counter-pattern: 2 bars, pentatonic, sparse (None = rest), plays over the piano
MAR = [G4 + 12, None, None, E4 + 12, None, D4 + 12, None, None, C4 + 12, None, None, G4, None, None, A4, None,
       None, None, E4 + 12, None, None, D4 + 12, None, C4 + 12, None, None, None, None, G4, None, None, None]

piano = np.zeros(N); mar = np.zeros(N); pad = np.zeros(N); bass = np.zeros(N)
shk = np.zeros(N); snp = np.zeros(N); kck = np.zeros(N)

for b in range(NBARS):
    ch = CHORDS[LOOP[b % 8]]
    s = b * bar * sr
    sec = (b // 8) % 4          # 32-bar form: 0 intro-ish, 1 full, 2 full+, 3 breathe
    full = b >= 4
    # piano ostinato: 8ths, two-bar phrase accents, slight humanised timing/velocity
    for j, m in enumerate(ch["pat"]):
        vel = 0.9 if j % 4 == 0 else (0.62 if j % 2 == 0 else 0.5)
        vel *= 1 + rng.normal(0, 0.05)
        st = s + (j * eighth + rng.normal(0, 0.006)) * sr
        add(piano, st, felt_piano(m, 2.2, vel))
    # sustained low root every bar (left hand)
    add(piano, s, felt_piano(ch["root"] + 12, 3.0, 0.55))
    # pad
    add(pad, s, pad_chord(ch["pad"], bar + 0.3))
    # bass from bar 4 on, resting in the "breathe" section's first two bars
    if full and not (sec == 3 and b % 8 < 2):
        add(bass, s, sub_bass(ch["root"], bar))
    # percussion from bar 4; drops out in the breathe section
    if full and sec != 3:
        for j in range(16):
            vel = 0.9 if j % 4 == 0 else (0.45 if j % 2 == 0 else 0.3)
            add(shk, s + j * six * sr + rng.normal(0, 0.004) * sr, shaker(vel))
        for k in (1, 3):
            add(snp, s + k * beat * sr, snap())
        for k in (0, 2):
            add(kck, s + k * beat * sr, kick() * (1.0 if k == 0 else 0.7))
    # marimba from bar 8; alternates two bars on / two bars off in later sections for air
    if b >= 8 and not (sec == 3 and b % 8 >= 4):
        for j in range(16):
            m = MAR[(b % 2) * 16 + j]
            if m is None: continue
            add(mar, s + j * six * sr, marimba(m, 0.7, 0.55 + 0.25 * (j % 4 == 0)))

# ---------- space ----------
def reverb_ir(seconds, tone_cut):
    t = np.arange(int(seconds * sr)) / sr
    ir = rng.standard_normal(len(t)) * np.exp(-t * (6.9 / seconds))
    ir[: int(0.012 * sr)] = 0  # pre-delay
    return lp(ir, tone_cut, 2) / np.sqrt(np.sum(ir ** 2))

def verb(x, ir, wet):
    return x + fftconvolve(x, ir)[: len(x)] * wet

ir_room = reverb_ir(1.6, 3500)
ir_hall = reverb_ir(2.8, 2200)
piano = verb(piano, ir_room, 0.28)
mar = verb(mar, ir_room, 0.35)
pad = verb(pad, ir_hall, 0.6)
snp = verb(snp, ir_room, 0.18)

mix = piano * 0.62 + mar * 0.30 + pad * 0.34 + bass * 0.55 + shk * 0.16 + snp * 0.20 + kck * 0.45
mix = mix[:TARGET]
mix = np.tanh(mix * 0.9) / 0.9
mix = lp(mix, 12000)
mix = mix / np.max(np.abs(mix)) * 0.85
fi = int(1.5 * sr); fo = int(4.0 * sr)
mix[:fi] *= np.linspace(0, 1, fi); mix[-fo:] *= np.linspace(1, 0, fo)
# stereo: piano/marimba slightly wide via a short cross-delay, low end mono
d = int(0.011 * sr)
wide = hp(mix, 180, 2)
mono = mix - wide
left = mono + wide
right = mono + np.concatenate([np.zeros(d), wide])[: len(wide)]
data = (np.stack([left, right], axis=1) / max(np.max(np.abs(left)), np.max(np.abs(right))) * 0.85 * 32767).astype(np.int16)
with wave.open(OUT, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(data.tobytes())
print(f"wrote {OUT}  {NBARS} bars  {TARGET/sr:.1f}s  seed={SEED}")
