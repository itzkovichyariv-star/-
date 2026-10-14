#!/usr/bin/env python3
"""Build the text overlay (ASS subtitles) for one episode: title cards, scene lower-thirds, captions.

Usage: python3 ass.py <episode.json> <audio_dir>      -> writes <audio_dir>/overlay.ass
Text is burned in by ffmpeg at full resolution, so it stays crisp regardless of the 3D render.
"""
import json, os, sys, re

def ts(t):
    t = max(0.0, t); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

def esc(s):
    return s.replace("\\", "\\\\").replace("{", "(").replace("}", ")")

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter,40,&H00FBF7F4,&H000000FF,&H96000000,&HA0000000,0,0,0,0,100,100,0,0,3,14,0,2,220,220,46,1
Style: Lower,Inter,46,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2.5,2,1,70,70,150,1
Style: LowerSub,Inter,27,&H00C9D4E5,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,2,1.5,1,72,70,118,1
Style: Series,Inter,30,&H00BFD4F2,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,6,0,1,2,1.5,7,0,0,0,1
Style: Title,Inter,100,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,-1,0,1,3,3,7,140,760,300,1
Style: Sub,Inter,42,&H00C9D4E5,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,7,0,0,0,1
Style: Small,Inter,24,&H009FB0C9,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,2,0,1,1.5,1,7,0,0,0,1
Style: Corner,Inter,22,&H009FB0C9,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,1.5,1,7,60,60,40,1
Style: CornerR,Inter,22,&H00C9D4E5,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,1.5,1,9,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

def main():
    ep = json.load(open(sys.argv[1])); audio_dir = sys.argv[2]
    timing = json.load(open(os.path.join(audio_dir, "timing.json")))
    tmap = {s["id"]: s for s in timing["scenes"]}
    ev = []
    def add(layer, start, end, style, text):
        ev.append(f"Dialogue: {layer},{ts(start)},{ts(end)},{style},,0,0,0,,{text}")
    total = timing["total"]
    # persistent corner labels
    add(0, 0.8, total - 0.5, "Corner", "{\\fad(600,600)}" + esc(ep["series"].upper()))
    add(0, 0.8, total - 0.5, "CornerR", "{\\fad(600,600)}EPISODE " + str(ep["episode"]) + "  ·  " + esc(ep["title"]))
    for sc in ep["scenes"]:
        t = tmap[sc["id"]]; s0, d = t["start"], t["duration"]; s1 = s0 + d + timing["gap"]
        if sc["kind"] in ("title", "outro"):
            # kinetic title card: series label, title (scale-in), subtitle, episode number, citation
            add(1, s0 + 0.3, s1 - 0.4, "Series", "{\\an7\\pos(140,236)\\fad(500,400)}" + esc(ep["series"].upper()))
            words = sc["heading"].split(" ")
            add(1, s0 + 0.8, s1 - 0.4, "Title", "{\\fad(500,400)\\q0\\fscx94\\fscy94\\t(0,700,\\fscx100\\fscy100)}" + esc(sc["heading"]))
            if sc["kind"] == "title":
                add(1, s0 + 1.8, s1 - 0.4, "Sub", "{\\an7\\pos(140,600)\\fad(500,400)}" + esc(ep["subtitle"]))
                add(1, s0 + 2.4, s1 - 0.4, "Small", "{\\an7\\pos(140,672)\\fad(500,400)}EPISODE " + str(ep["episode"]) + " OF 5")
            add(1, s0 + 3.0, s1 - 0.4, "Small", "{\\an7\\pos(140,740)\\fad(500,400)}" + esc("Based on Mechoulam, Hanuš, Pertwee & Howlett (2014), Nature Reviews Neuroscience 15:757–764  ·  doi:10.1038/nrn3811"))
        else:
            # lower-third: scene heading for the first seconds, then fades
            hold = min(6.0, d * 0.5)
            add(1, s0 + 0.4, s0 + 0.4 + hold, "Lower", "{\\fad(400,500)\\move(50,930,70,930,0,400)}" + esc(sc["heading"]))
            add(1, s0 + 0.7, s0 + 0.4 + hold, "LowerSub", "{\\fad(400,500)}" + esc(ep["title"]).upper())
        # captions
        for c in t["captions"]:
            add(2, s0 + c["start"], s0 + c["end"] - 0.05, "Caption", "{\\fad(120,120)}" + esc(c["text"]))
    open(os.path.join(audio_dir, "overlay.ass"), "w").write(HEADER + "\n".join(ev) + "\n")
    print("wrote", os.path.join(audio_dir, "overlay.ass"), len(ev), "events")

if __name__ == "__main__":
    main()
