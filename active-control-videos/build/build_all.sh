#!/usr/bin/env bash
# Rebuild narration, sound mix, scripts, the 3D passes and the final documentary cuts for all five episodes.
#
# One-time requirements:
#   pip install sherpa-onnx soundfile numpy rdkit
#   npm i playwright   (plus a Chromium build; set CHROMIUM_PATH / PLAYWRIGHT_MODULE if not at the defaults)
#   ffmpeg with libx264, aac and libass
#   Kokoro voice (speaker 9 = bm_george):
#     curl -L -o k.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2
#     mkdir -p models && tar xjf k.tar.bz2 -C models
#   Stock footage: download every clip named "stock:<id>" in shotlists/*.json from Adobe Stock
#   (free collection, 1080p) into media/stock/<id>.mov. assets/stock_footage.json lists them.
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${TTS_MODEL_DIR:-models/kokoro-en-v0_19}"
MEDIA="${MEDIA_DIR:-media}"
WORK="${WORK_DIR:-work}"
mkdir -p "$WORK" output
python3 build/molecules.py                      # assets/molecules/molecules.json (RDKit 3D conformers)
for ep in episodes/*.json; do
  b=$(basename "$ep" .json)
  python3 build/tts.py "$ep" "$WORK/$b" --model-dir "$MODEL"   # narration + timing + srt
  python3 build/mix.py "$WORK/$b"                               # voice + ducked music bed + SFX -> mix.wav
  python3 build/ass.py "$ep" "$WORK/$b"                         # text overlay (pure-3D version only)
done
python3 build/make_scripts.py episodes scripts "$WORK"
# clean full-length 3D passes (software WebGL; roughly 0.3-1 s per frame, so budget a few hours for all five)
mkdir -p "$MEDIA/3d"
ls episodes/*.json | xargs -P "${JOBS:-2}" -I{} sh -c 'b=$(basename {} .json); n=$(echo $b | cut -c1-2); node build/render3d.js {} "'"$WORK"'/$b" "'"$MEDIA"'/3d/ep${n}_full.mp4" --fps 24 --notext'
# short clean inserts (no captions, no in-scene labels) borrowed by other episodes' shot lists
R="node build/render3d.js"; X="--fps 24 --notext --nolabels"
$R episodes/01-how-cannabis-research-began.json "$WORK/01-how-cannabis-research-began" "$MEDIA/3d/ep01_083.mp4" --clip 82.5 90 --fps 24 --notext
$R episodes/01-how-cannabis-research-began.json "$WORK/01-how-cannabis-research-began" "$MEDIA/3d/ep01_thc.mp4" --clip 103.5 115 $X
$R episodes/01-how-cannabis-research-began.json "$WORK/01-how-cannabis-research-began" "$MEDIA/3d/ep01_s7.mp4" --clip 211.8 232 $X
$R episodes/03-discovery-of-cannabinoid-receptors.json "$WORK/03-discovery-of-cannabinoid-receptors" "$MEDIA/3d/ep03_binding.mp4" --clip 142.5 152 $X
$R episodes/04-endocannabinoids-anandamide-and-2ag.json "$WORK/04-endocannabinoids-anandamide-and-2ag" "$MEDIA/3d/ep04_aea.mp4" --clip 96.4 100.6 $X
$R episodes/04-endocannabinoids-anandamide-and-2ag.json "$WORK/04-endocannabinoids-anandamide-and-2ag" "$MEDIA/3d/ep04_2ag.mp4" --clip 135.4 138.6 $X
# documentary cuts: one shot per sentence, stock footage + 3D inserts
for sl in shotlists/*.json; do b=$(basename "$sl" .json); python3 build/edit.py "$sl" "$WORK/$b" "output/$b.mp4" --media "$MEDIA"; done
for ep in episodes/*.json; do b=$(basename "$ep" .json); cp "$WORK/$b/captions.srt" "output/$b.srt"; done
echo "done: output/"
