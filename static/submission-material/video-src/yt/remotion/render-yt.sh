#!/bin/zsh
# Render one tutorial, generate an ORIGINAL royalty-free music bed of the exact length, mux at low volume.
#   ./render-yt.sh <key>            full render + music
#   ./render-yt.sh <key> --remux    keep the existing video, only regenerate + swap the music
#   MUSIC=../music-gen.py ./render-yt.sh <key>   use the older dark bed instead of the upbeat default
set -e
K=$1; MODE=$2; cd "$(dirname "$0")"
MUSIC=${MUSIC:-../music-product.py}  # the ONLY accepted bed (CogniRunner lesson)
VOL=${VOL:-0.45}
FINAL="out/yt/sentinel-vault-$K.mp4"
if [[ "$MODE" == "--remux" ]]; then
  [[ -f "$FINAL" ]] || { echo "no $FINAL to remux"; exit 1 }
  cp "$FINAL" "out/yt/$K-silent.mp4"
else
  npx remotion render "yt-$K" "out/yt/$K-silent.mp4" --log=error --concurrency=4
fi
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "out/yt/$K-silent.mp4")
/tmp/musenv/bin/python "$MUSIC" "out/yt/$K-music.wav" "$D"
ffmpeg -y -v error -i "out/yt/$K-silent.mp4" -i "out/yt/$K-music.wav" -filter_complex "[1:a]volume=$VOL,afade=t=in:d=1.2,afade=t=out:st=$(echo "$D-3" | bc):d=3[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -movflags +faststart "$FINAL"
rm -f "out/yt/$K-silent.mp4" "out/yt/$K-music.wav"
echo "RENDERED $K ($D s) music=$(basename $MUSIC) vol=$VOL"
