#!/usr/bin/env python3
"""Mix the final soundtrack: narration + procedural ambient bed + transition whooshes + docking chimes.

Usage: python3 mix.py <episode.json> <audio_dir> [--music music_bed.wav] [--sfx-dir DIR]
Writes <audio_dir>/mix.wav. Music and SFX are synthesised by build/soundtrack.py (no external assets).
"""
import json, os, sys, argparse
import numpy as np, soundfile as sf

def load(path, sr):
    a, s = sf.read(path, dtype='float32', always_2d=False)
    if a.ndim > 1: a = a.mean(axis=1)
    if s != sr:
        n = int(len(a) * sr / s); a = np.interp(np.linspace(0, len(a), n, endpoint=False), np.arange(len(a)), a).astype(np.float32)
    return a

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("episode"); ap.add_argument("audio_dir"); ap.add_argument("--music", default=None); ap.add_argument("--sfx-dir", default=None); ap.add_argument("--music-db", type=float, default=-23.0)
    a = ap.parse_args(); ep = json.load(open(a.episode)); timing = json.load(open(os.path.join(a.audio_dir, "timing.json")))
    sr = 48000; nar = load(os.path.join(a.audio_dir, "narration.wav"), sr); n = len(nar); out = nar.copy()
    sfx = a.sfx_dir or os.path.join(os.path.dirname(__file__), "..", "assets", "audio")
    music = a.music or os.path.join(sfx, "music_bed.ogg")
    if os.path.exists(music):
        m = load(music, sr); reps = int(np.ceil(n / len(m))) + 1; m = np.tile(m, reps)[:n]
        # fade in/out and gentle ducking under speech
        env = np.ones(n, np.float32); f = int(2 * sr); env[:f] = np.linspace(0, 1, f); env[-f:] = np.linspace(1, 0, f)
        speech = np.abs(nar); k = int(0.25 * sr); sm = np.convolve(speech, np.ones(k) / k, mode='same'); duck = 1 - 0.45 * np.clip(sm / (sm.max() + 1e-9) * 6, 0, 1)
        out += m * env * duck * (10 ** (a.music_db / 20)) / (np.max(np.abs(m)) + 1e-9)
    def place(path, t, gain):
        if not os.path.exists(path): return
        s = load(path, sr) * gain; i = int(t * sr); j = min(n, i + len(s))
        if i < n and j > i: out[i:j] += s[:j - i]
    for ts in timing["scenes"][1:]:
        place(os.path.join(sfx, "sfx_whoosh.wav"), ts["start"] - 0.5, 0.35)
    # docking chimes: membrane 'ligand-dock' stages and synapse 'bind'
    for sc, ts in zip(ep["scenes"], timing["scenes"]):
        v = sc.get("scene3d", {})
        for st in v.get("stages", []):
            if st["action"] in ("ligand-dock", "bind"):
                place(os.path.join(sfx, "sfx_dock.wav"), ts["start"] + st["at"] * ts["duration"] + 2.4, 0.5)
    peak = np.max(np.abs(out)); out = out / peak * 0.95 if peak > 0.95 else out
    sf.write(os.path.join(a.audio_dir, "mix.wav"), out.astype(np.float32), sr); print("mix", round(n / sr / 60, 2), "min")

if __name__ == "__main__":
    main()
