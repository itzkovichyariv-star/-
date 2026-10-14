#!/usr/bin/env bash
# Rebuild narration, text overlays, scripts and the 3D videos for all five episodes.
#
# One-time requirements:
#   pip install sherpa-onnx soundfile numpy rdkit
#   npm i playwright   (plus a Chromium build; set CHROMIUM_PATH / PLAYWRIGHT_MODULE if not at the defaults)
#   ffmpeg with libx264, aac and libass
#   Piper voice en_US-lessac-medium:
#     curl -L -o m.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2
#     mkdir -p models && tar xjf m.tar.bz2 -C models
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${PIPER_MODEL_DIR:-models/vits-piper-en_US-lessac-medium}"
WORK="${WORK_DIR:-work}"
mkdir -p "$WORK" output
python3 build/molecules.py                      # assets/molecules/molecules.json (RDKit 3D conformers)
for ep in episodes/*.json; do
  b=$(basename "$ep" .json)
  python3 build/tts.py "$ep" "$WORK/$b" --model-dir "$MODEL"   # narration + timing + srt
  python3 build/ass.py "$ep" "$WORK/$b"                         # text overlay
done
python3 build/make_scripts.py episodes scripts "$WORK"
# 3D render (software WebGL; roughly 0.3-0.6 s per frame, so budget a few hours for all five)
ls episodes/*.json | xargs -P "${JOBS:-3}" -I{} sh -c 'b=$(basename {} .json); node build/render3d.js {} "'"$WORK"'/$b" "output/$b.mp4" --fps 24'
for ep in episodes/*.json; do b=$(basename "$ep" .json); cp "$WORK/$b/captions.srt" "output/$b.srt"; done
echo "done: output/"
