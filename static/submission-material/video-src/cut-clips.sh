#!/usr/bin/env bash
# Cuts the 6.4 promo clips from the two real screen recordings (macOS retina, no audio)
# into 1920x1080 30fps H.264 clips for Remotion (remotion/public/clips/, untracked).
# Usage: SRC_DIR=~/Downloads/wetransfer_sentinel_2026-09-30_1318 ./cut-clips.sh [name...]
set -euo pipefail
cd "$(dirname "$0")"
SRC_DIR="${SRC_DIR:-$HOME/Downloads/wetransfer_sentinel_2026-09-30_1318}"
A="$SRC_DIR/Screen Recording 2026-09-30 at 13.56.51.mov"   # 4096x1526: owner (left half) | colleague (right half)
B="$SRC_DIR/Screen Recording 2026-09-30 at 16.09.55.mov"   # 3348x2502: site admin
OUT=remotion/public/clips; mkdir -p "$OUT"
ENC=(-an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart)
want(){ [ ${#ONLY[@]} -eq 0 ] && return 0; for w in "${ONLY[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }
ONLY=("$@"); set +u
# one(name src start dur cropW cropH x y speed)
one(){ want "$1" || return 0; echo "-> $1"
  ffmpeg -v error -y -ss "$3" -t "$4" -i "$2" -vf "crop=$5:$6:$7:$8,scale=1920:1080:flags=lanczos,setpts=PTS/$9,fps=30" "${ENC[@]}" "$OUT/$1.mp4"; }
# split(name start dur yLeft yRight speed) — owner | colleague, 1000x1125 from each half of A
split(){ want "$1" || return 0; echo "-> $1"
  ffmpeg -v error -y -ss "$2" -t "$3" -i "$A" -filter_complex \
   "[0:v]split[a][b];[a]crop=1000:1125:710:$4,pad=1008:1125:0:0:color=0x020617[l];[b]crop=1000:1125:2760:$5[r];[l][r]hstack,scale=1920:1080:flags=lanczos,setpts=PTS/$6,fps=30[v]" \
   -map "[v]" "${ENC[@]}" "$OUT/$1.mp4"; }
one   01-seal        "$A" 24  8   1440 810  560  230  1.4
split 02-request          42  30  400 300 2.5
split 03-decline          74  22  0   500 2.0
one   04-restored    "$A" 196 24  1640 922  2440 40   2.0
one   05-sec-pick    "$A" 246.5 2.6 1280 720  580  740  0.8
one   06-sec-revert  "$A" 283 20  1400 788  2560 120  1.5
one   07-comments    "$A" 296 6   1400 788  520  380  1.0
one   08-site-toggles "$B" 52 20  2620 1474 660  120  2.0
one   09-sign        "$B" 128 28  2400 1350 900  900  2.0
one   10-classif     "$B" 262 18  2700 1519 640  150  1.5
one   11-space-default "$B" 289 9 2560 1440 760 900  1.3
one   12-reason      "$B" 340 12  2560 1440 760  900  1.5
one   13-banner      "$B" 308 7   2200 1238 600  110  1.0
one   14-api         "$B" 375 18  2620 1474 660  120  2.0
