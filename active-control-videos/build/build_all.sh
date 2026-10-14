#!/usr/bin/env bash
# Rebuild narration, subtitles, scripts and videos for all five episodes.
#
# Requirements (one-time):
#   pip install sherpa-onnx soundfile numpy
#   npm i playwright   (and a Chromium build; set CHROMIUM_PATH / PLAYWRIGHT_MODULE if not at the defaults)
#   ffmpeg with libx264 + aac
#   Piper voice en_US-lessac-medium, e.g.
#     curl -L -o m.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2
#     mkdir -p models && tar xjf m.tar.bz2 -C models
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${PIPER_MODEL_DIR:-models/vits-piper-en_US-lessac-medium}"
WORK="${WORK_DIR:-work}"
mkdir -p "$WORK" output
for ep in episodes/*.json; do
  b=$(basename "$ep" .json)
  python3 build/tts.py "$ep" "$WORK/$b" --model-dir "$MODEL"
done
python3 build/make_scripts.py episodes scripts "$WORK"
ls episodes/*.json | xargs -P "${JOBS:-2}" -I{} sh -c 'b=$(basename {} .json); node build/render.js {} "'"$WORK"'/$b" "output/$b.mp4" --fps 15'
for ep in episodes/*.json; do b=$(basename "$ep" .json); cp "$WORK/$b/captions.srt" "output/$b.srt"; done
echo "done: output/"
