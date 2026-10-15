#!/usr/bin/env python3
"""Synthesise the ambient music bed and the two sound effects used by mix.py (numpy only, no external assets).
Usage: python3 soundtrack.py <out_dir>   -> music_bed.ogg (via ffmpeg), sfx_whoosh.wav, sfx_dock.wav
"""
import numpy as np, soundfile as sf, sys, os, subprocess
sr = 48000
def pad(dur, chords, seed=1):
    rng = np.random.default_rng(seed); n = int(dur * sr); t = np.arange(n) / sr; out = np.zeros(n); seg = dur / len(chords)
    for ci, ch in enumerate(chords):
        env = np.clip(np.minimum((t - ci * seg) / 6, (ci + 1) * seg + 6 - t) / 6, 0, 1)
        for f in ch:
            for det in (-0.4, 0, 0.35):
                ph = rng.uniform(0, 6.28); lfo = 1 + 0.004 * np.sin(2 * np.pi * 0.07 * t + ph)
                w = np.sin(2 * np.pi * f * (2 ** (det / 1200)) * t * lfo + ph)
                w += 0.35 * np.sin(2 * np.pi * 2 * f * t * lfo + ph * 1.3) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.03 * t + ph))
                out += env * w * (0.9 / len(ch)) / 3
    out += 0.05 * np.sin(2 * np.pi * 0.11 * t) * np.sin(2 * np.pi * 660 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.02 * t))
    k = int(sr / 900); out = np.convolve(out, np.ones(k) / k, mode='same'); return out / (np.max(np.abs(out)) + 1e-9)
A = lambda m: 440 * 2 ** ((m - 69) / 12)
chords = [[A(38), A(53), A(57), A(60), A(64)], [A(41), A(53), A(57), A(60), A(65)], [A(43), A(55), A(59), A(62), A(67)], [A(36), A(52), A(55), A(59), A(64)]]
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
sf.write(os.path.join(out, 'music_bed.wav'), (pad(400, chords) * 0.9).astype(np.float32), sr)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(out, 'music_bed.wav'), '-c:a', 'libvorbis', '-q:a', '4', os.path.join(out, 'music_bed.ogg')], check=True); os.remove(os.path.join(out, 'music_bed.wav'))
t = np.arange(int(1.2 * sr)) / sr; noise = np.random.default_rng(3).standard_normal(len(t)); env = np.exp(-((t - 0.45) / 0.22) ** 2)
wh = np.convolve(noise * env, np.ones(40) / 40, mode='same'); sf.write(os.path.join(out, 'sfx_whoosh.wav'), (wh / np.max(np.abs(wh)) * 0.6).astype(np.float32), sr)
t = np.arange(int(1.6 * sr)) / sr; ch = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * (3 + i * 2)) for i, f in enumerate([880, 1320, 1760, 2640])) / 4
sf.write(os.path.join(out, 'sfx_dock.wav'), (ch * 0.5).astype(np.float32), sr); print('soundtrack written to', out)
