#!/usr/bin/env python3
"""Documentary-style editor: cuts real footage (and 3D inserts) to the narration, sentence by sentence.

Usage:
  python3 edit.py <shotlist.json> <audio_dir> <out.mp4> [--media DIR] [--start T --end T] [--work DIR]

shotlist.json:
  { "episode": "01-how-cannabis-research-began",
    "shots": [
      { "t": 18.3,                       # timeline start (s); the shot lasts until the next shot's t (or "end")
        "src": "stock:297883093",        # stock:<AdobeStock id> | file:<path relative to media dir>
        "in": 2.0,                       # optional in-point in the source (default: centred)
        "motion": "push",                # push | pull | pan-left | pan-right | still | dive | emerge
        "fx": 0.5, "fy": 0.5,            # focus point for push / dive / emerge (0..1)
        "label": "Cannabis sativa",      # optional on-screen key term, shown while the shot is on screen
        "sub": "cultivated for fibre, seed and oil" },
      ...
    ],
    "end": 125.3 }

The narration (audio_dir/mix.wav or narration.wav) and captions (audio_dir/timing.json) come from tts.py / mix.py.
Every shot is cut exactly where its sentence starts, so the picture changes with the words.
A 'dive' shot ends by pushing hard into (fx, fy); the following 'emerge' shot opens out of the same point.
"""
import json, os, sys, argparse, subprocess, shutil

W, H, FPS, X = 1920, 1080, 24, 0.5     # output size, frame rate, crossfade length

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: sys.exit("ffmpeg failed:\n" + " ".join(cmd) + "\n" + r.stderr[-2000:])

def probe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    return float(out)

def zoom_expr(motion, L, dive_len=1.0):
    """Return (zoom(t) expr, x-centre expr factor, y-centre expr factor) as ffmpeg expressions in t."""
    T = f"(t/{L:.3f})"
    if motion == "pull": return f"1.16-0.14*{T}"
    if motion in ("pan-left", "pan-right", "still"): return "1.12" if motion != "still" else "1.04"
    if motion == "dive":   # gentle push, then hard push over the last dive_len seconds
        a = L - dive_len
        return f"if(lt(t,{a:.3f}),1.0+0.08*t/{a:.3f},1.08+5.0*pow((t-{a:.3f})/{dive_len:.3f},2.2))"
    if motion == "emerge": # starts deep inside the point and pulls out over the first second
        return f"if(lt(t,{dive_len:.3f}),1.06+4.0*pow(1-t/{dive_len:.3f},2.2),1.06+0.06*(t-{dive_len:.3f})/{max(0.1, L - dive_len):.3f})"
    return f"1.0+0.12*{T}"     # push

def render_shot(sh, src, L, out):
    sdur = probe_dur(src)
    need = L
    speed = 1.0
    if sdur < need: speed = max(sdur / need, 0.6)      # slow down short clips (down to 0.6x), then hold the last frame
    span = need * speed
    tin = sh.get("in")
    if tin is None: tin = max(0.0, (sdur - span) / 2)
    tin = min(tin, max(0.0, sdur - span))
    z = zoom_expr(sh.get("motion", "push"), L)
    fx, fy = sh.get("fx", 0.5), sh.get("fy", 0.5)
    m = sh.get("motion", "push")
    if m == "pan-left": xexpr = f"(iw-{W})*(1-t/{L:.3f})"
    elif m == "pan-right": xexpr = f"(iw-{W})*(t/{L:.3f})"
    else: xexpr = f"max(0,min(iw-{W},iw*{fx}-{W}*{fx}))"
    yexpr = f"max(0,min(ih-{H},ih*{fy}-{H}*{fy}))"
    vf = [
        f"setpts=(PTS-STARTPTS)/{speed:.4f}", f"fps={FPS}",
        f"scale=w=-2:h={H}:flags=bicubic", f"crop={W}:{H}",                     # cover 16:9
        f"scale=w='trunc({W}*({z})/2)*2':h='trunc({H}*({z})/2)*2':eval=frame:flags=bicubic",
        f"crop={W}:{H}:x='{xexpr}':y='{yexpr}'",
        "eq=contrast=1.06:saturation=1.06:gamma=0.98", "vignette=angle=PI/5",
        f"tpad=stop_mode=clone:stop_duration={L:.3f}", f"trim=duration={L:.3f}", "setsar=1", "format=yuv420p",
    ]
    if m == "dive":   # brighten into the point
        a = L - 1.0
        vf.insert(-3, f"eq=brightness='if(lt(t,{a:.3f}),0,0.25*pow((t-{a:.3f}),2))':eval=frame")
    if m == "emerge":
        vf.insert(-3, "eq=brightness='if(lt(t,1),0.25*pow(1-t,2),0)':eval=frame")
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{tin:.3f}", "-t", f"{span + 0.2:.3f}", "-i", src, "-an", "-vf", ",".join(vf),
         "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-r", str(FPS), out])

def ass_time(t):
    t = max(0.0, t); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

def esc(s): return s.replace("{", "(").replace("}", ")")

def build_ass(shots, timing, ep, t0, t1, path):
    hdr = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter,40,&H00FBF7F4,&H000000FF,&H96000000,&HA0000000,0,0,0,0,100,100,0,0,3,14,0,2,220,220,46,1
Style: Tag,Inter,44,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,0,0,7,80,80,80,1
Style: TagSub,Inter,28,&H00BFE9E2,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,0,0,7,80,80,80,1
Style: Corner,Inter,22,&H009FB0C9,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,1.5,1,9,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    def add(layer, a, b, style, text):
        a, b = max(a, t0) - t0, min(b, t1) - t0
        if b > a: ev.append(f"Dialogue: {layer},{ass_time(a)},{ass_time(b)},{style},,0,0,0,,{text}")
    add(0, t0, t1, "Corner", "{\\fad(600,600)}EPISODE " + str(ep["episode"]) + "  ·  " + esc(ep["title"]))
    for i, sh in enumerate(shots):
        a = sh["t"]; b = shots[i + 1]["t"] if i + 1 < len(shots) else t1
        if sh.get("label"):
            # accent bar + key term, slides in from the left, fades before the cut
            bar = "{\\an7\\pos(64,92)\\p1\\c&H00BFD42D&\\fad(250,300)\\move(40,92,64,92,0,300)}m 0 0 l 6 0 6 56 0 56{\\p0}"
            add(3, a + 0.35, b - 0.2, "Tag", bar)
            add(3, a + 0.35, b - 0.2, "Tag", "{\\an7\\fad(250,300)\\move(64,86,84,86,0,300)}" + esc(sh["label"]))
            if sh.get("sub"): add(3, a + 0.55, b - 0.2, "TagSub", "{\\an7\\fad(250,300)\\move(66,146,86,146,0,300)}" + esc(sh["sub"]))
    for sc in timing["scenes"]:
        for c in sc["captions"]:
            add(2, sc["start"] + c["start"], sc["start"] + c["end"] - 0.05, "Caption", "{\\fad(120,120)}" + esc(c["text"]))
    open(path, "w").write(hdr + "\n".join(ev) + "\n")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("shotlist"); ap.add_argument("audio_dir"); ap.add_argument("out")
    ap.add_argument("--media", default=os.environ.get("MEDIA_DIR", "media")); ap.add_argument("--work", default=None)
    ap.add_argument("--episode-json", default=None)
    a = ap.parse_args()
    sl = json.load(open(a.shotlist)); shots = sorted(sl["shots"], key=lambda s: s["t"])
    timing = json.load(open(os.path.join(a.audio_dir, "timing.json")))
    epjson = a.episode_json or os.path.join(os.path.dirname(os.path.abspath(a.shotlist)), "..", "episodes", sl["episode"] + ".json")
    ep = json.load(open(epjson))
    t0, t1 = shots[0]["t"], sl.get("end", timing["total"])
    work = a.work or (a.out + ".work"); os.makedirs(work, exist_ok=True)
    parts = []
    for i, sh in enumerate(shots):
        d = (shots[i + 1]["t"] if i + 1 < len(shots) else t1) - sh["t"]
        L = d + (X if i + 1 < len(shots) else 0)
        kind, ref = sh["src"].split(":", 1)
        src = os.path.join(a.media, "stock", ref + ".mov") if kind == "stock" else os.path.join(a.media, ref)
        out = os.path.join(work, f"shot{i:03d}.mp4")
        render_shot(sh, src, L, out); parts.append((out, d)); print(f"shot {i:02d} {sh['t']:7.2f}s {d:5.2f}s {sh['src']}", flush=True)
    # crossfade chain
    inputs = []; fc = []; prev = "[0:v]"; off = 0.0
    for i, (p, d) in enumerate(parts): inputs += ["-i", p]
    for i in range(1, len(parts)):
        off += parts[i - 1][1]
        lab = f"[v{i}]"; fc.append(f"{prev}[{i}:v]xfade=transition=fade:duration={X}:offset={off - X / 2:.3f}{lab}"); prev = lab
    ass = os.path.join(work, "overlay.ass"); build_ass(shots, timing, ep, t0, t1, ass)
    fonts = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "fonts")
    fc.append(f"{prev}subtitles={ass}:fontsdir={fonts}[vout]")
    audio = os.path.join(a.audio_dir, "mix.wav" if os.path.exists(os.path.join(a.audio_dir, "mix.wav")) else "narration.wav")
    ai = len(parts)
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", audio,
         "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", f"{ai}:a",
         "-af", "afade=t=in:d=0.6,afade=t=out:st=" + f"{max(0, t1 - t0 - 1.0):.3f}" + ":d=1.0",
         "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", a.out])
    print("wrote", a.out, round(t1 - t0, 1), "s")

if __name__ == "__main__":
    main()
