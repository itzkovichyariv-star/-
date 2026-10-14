#!/usr/bin/env python3
"""Synthesise narration for one episode with Piper (via sherpa-onnx), write per-scene
WAVs, a concatenated episode WAV, a timing.json (scene start/duration) and an SRT file.

Usage: python3 tts.py <episode.json> <out_dir> [--model-dir DIR]
"""
import json, os, re, sys, wave, argparse
import numpy as np
import soundfile as sf
import sherpa_onnx

GAP = 0.9  # seconds of silence between scenes

# Spoken forms for abbreviations (TTS only; on-screen text keeps the abbreviations)
SPOKEN = [
    (r"\bTHCV\b", "T H C V"), (r"\bTHCA\b", "T H C A"), (r"\bTHC\b", "T H C"),
    (r"\bCBDA\b", "C B D A"), (r"\bCBD\b", "C B D"), (r"\bCBGA\b", "C B G A"),
    (r"\bCBG\b", "C B G"), (r"\bCBCA\b", "C B C A"), (r"\bCBC\b", "C B C"), (r"\bCBN\b", "C B N"),
    (r"\bCB1\b", "C B one"), (r"\bCB2\b", "C B two"), (r"\b2-AG\b", "two A G"),
    (r"\bFAAH\b", "F A A H"), (r"\bMAGL\b", "M A G L"), (r"\bDAGL\b", "D A G L"),
    (r"\bNAPE-PLD\b", "nape phospholipase D"), (r"\bNAPE\b", "nape"), (r"\bDAG\b", "D A G"),
    (r"\bGPCR\b", "G P C R"), (r"\bTRPV1\b", "T R P V one"), (r"\bGPR55\b", "G P R fifty-five"),
    (r"\bPPARs\b", "P P A Rs"), (r"\bDSI\b", "D S I"), (r"\bDSE\b", "D S E"),
    (r"\bNIH\b", "N I H"), (r"\bcAMP\b", "cyclic A M P"), (r"\bHU-", "H U "), (r"\bCP-", "C P "),
    (r"\(−\)-trans-Δ9-THC", "minus trans delta nine T H C"), (r"Δ9-", "delta nine "), (r"Δ9", "delta nine"), (r"\bNMR\b", "N M R"),
    (r"CP-55,940", "C P fifty-five, nine forty"), (r"WIN 55,212-2", "WIN fifty-five, two one two"),
    (r"HU-210", "H U two ten"), (r"HU-243", "H U two forty-three"), (r"\bABHD6\b", "A B H D six"), (r"\bABHD12\b", "A B H D twelve"),
    (r"\bCOX-2\b", "cox two"), (r"PLCβ", "P L C beta"), (r"\bcyclic AMP\b", "cyclic A M P"), (r"\bAMP\b", "A M P"),
    (r"Lumír Hanuš", "Lumeer Hanoosh"), (r"Hanuš", "Hanoosh"), (r"Gaoni", "Gah-oni"), (r"Mechoulam", "Meshoolam"),
    (r"O'Shaughnessy", "O'Shawnessy"), (r"Herkenham", "Herkenham"), (r"Ohno-Shosaku", "Ohno Shosaku"), (r"Kreitzer", "Krytzer"),
    (r"\(([^)]*)\)", r", \1,"),
]

def spoken(text):
    for pat, rep in SPOKEN:
        text = re.sub(pat, rep, text)
    return text

def chunks_for_captions(text, max_words=16):
    """Split narration into caption chunks: sentences, then at commas/semicolons if long."""
    sents = re.split(r"(?<=[.!?])\s+", text.strip())
    out = []
    for s in sents:
        if len(s.split()) <= max_words:
            out.append(s); continue
        parts = re.split(r"(?<=[,;:])\s+", s)
        cur = ""
        for p in parts:
            cand = (cur + " " + p).strip()
            if cur and len(cand.split()) > max_words:
                out.append(cur); cur = p
            else:
                cur = cand
        if cur: out.append(cur)
    return [c for c in out if c]

def srt_time(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode"); ap.add_argument("out_dir")
    ap.add_argument("--model-dir", default=os.environ.get("PIPER_MODEL_DIR", "models/vits-piper-en_US-lessac-medium"))
    ap.add_argument("--length-scale", type=float, default=1.18)
    a = ap.parse_args()
    ep = json.load(open(a.episode))
    os.makedirs(a.out_dir, exist_ok=True)
    m = a.model_dir
    onnx = [f for f in os.listdir(m) if f.endswith(".onnx")][0]
    cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=os.path.join(m, onnx), lexicon="",
            tokens=os.path.join(m, "tokens.txt"), data_dir=os.path.join(m, "espeak-ng-data"),
            length_scale=a.length_scale), num_threads=2))
    tts = sherpa_onnx.OfflineTts(cfg)

    sr = None; pieces = []; timing = {"fps": None, "gap": GAP, "scenes": []}; t = 0.0; srt = []; n = 1
    for sc in ep["scenes"]:
        audio = tts.generate(spoken(sc["narration"]), sid=0, speed=1.0)
        sr = audio.sample_rate
        samples = np.asarray(audio.samples, dtype=np.float32)
        # trim long trailing silence, keep a short tail
        thr = 0.01; idx = np.where(np.abs(samples) > thr)[0]
        if len(idx): samples = samples[: min(len(samples), idx[-1] + int(0.25 * sr))]
        lead = np.zeros(int(0.35 * sr), np.float32)
        samples = np.concatenate([lead, samples])
        dur = len(samples) / sr
        sf.write(os.path.join(a.out_dir, f"{sc['id']}.wav"), samples, sr)
        # captions proportional to characters
        caps = chunks_for_captions(sc["narration"]); total = sum(len(c) for c in caps)
        speech_start = t + 0.35; speech_dur = dur - 0.35 - 0.25
        ct = speech_start; cap_list = []
        for c in caps:
            d = speech_dur * len(c) / total
            cap_list.append({"text": c, "start": round(ct - t, 3), "end": round(ct - t + d, 3)})
            srt.append(f"{n}\n{srt_time(ct)} --> {srt_time(ct + d)}\n{c}\n"); n += 1; ct += d
        timing["scenes"].append({"id": sc["id"], "start": round(t, 3), "duration": round(dur, 3), "captions": cap_list})
        pieces.append(samples); pieces.append(np.zeros(int(GAP * sr), np.float32))
        t += dur + GAP
    full = np.concatenate(pieces)
    timing["total"] = round(len(full) / sr, 3)
    sf.write(os.path.join(a.out_dir, "narration.wav"), full, sr)
    json.dump(timing, open(os.path.join(a.out_dir, "timing.json"), "w"), indent=1)
    open(os.path.join(a.out_dir, "captions.srt"), "w").write("\n".join(srt))
    print(f"{ep['id']}: {len(ep['scenes'])} scenes, {timing['total']/60:.2f} min")

if __name__ == "__main__":
    main()
