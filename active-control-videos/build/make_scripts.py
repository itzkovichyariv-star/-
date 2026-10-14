#!/usr/bin/env python3
"""Generate the human-readable video scripts (Markdown) from the episode JSON files.

Usage: python3 make_scripts.py <episodes_dir> <scripts_out_dir> [timing_root]
If timing_root is given, <timing_root>/<episode-basename>/timing.json is used for real durations.
"""
import json, os, sys, glob

VIS_DESC = {
    "cards": lambda v: "Card grid: " + "; ".join(f"**{i['title']}** — {i['sub']}" for i in v["items"]),
    "timeline": lambda v: "Timeline: " + "; ".join(f"**{i['label']}** — {i['sub']}" for i in v["items"]),
    "compare": lambda v: f"Two-column comparison. Left, **{v['left']['title']}**: " + "; ".join(v['left']['rows']) + f". Right, **{v['right']['title']}**: " + "; ".join(v['right']['rows']) + ".",
    "bigfact": lambda v: f"Large on-screen statement: **{v['text']}** — {v.get('sub','')}",
    "pathway": lambda v: "Flow diagram: " + "; ".join(f"{e['from'].upper()} → {e['to'].upper()}" + (f" ({e['label']})" if e.get('label') else "") for e in v["edges"]) + ". Nodes: " + ", ".join(n['label'] for n in v['nodes']),
    "brain": lambda v: "Side view of the brain with labelled regions: " + "; ".join(f"{r['label']} ({r['level']} density)" for r in v["regions"]),
    "receptor": lambda v: "Animated membrane diagram: lipid bilayer → 7-helix CB1 receptor → ligand docks → Gi/o protein engages → adenylyl cyclase and cAMP fall.",
    "synapse": lambda v: "Animated synapse: presynaptic terminal with vesicles, CB1 receptors and a Ca²⁺ channel; postsynaptic neuron below. Stages: " + " → ".join(s['state'] for s in v['stages']),
}

def fmt(sec):
    m, s = divmod(int(round(sec)), 60)
    return f"{m}:{s:02d}"

def main():
    ep_dir, out_dir = sys.argv[1], sys.argv[2]
    timing_root = sys.argv[3] if len(sys.argv) > 3 else None
    os.makedirs(out_dir, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ep_dir, "*.json"))):
        ep = json.load(open(f)); base = os.path.splitext(os.path.basename(f))[0]
        timing = None
        if timing_root and os.path.exists(os.path.join(timing_root, base, "timing.json")):
            timing = json.load(open(os.path.join(timing_root, base, "timing.json")))
        tmap = {s["id"]: s for s in timing["scenes"]} if timing else {}
        L = []
        L.append(f"# Episode {ep['episode']}: {ep['title']}\n")
        L.append(f"*{ep['series']} — {ep['subtitle']}*\n")
        if timing: L.append(f"**Running time:** {fmt(timing['total'])} (narrated video, 1920×1080)\n")
        L.append(f"**Primary source:** {ep['sources'][0]}\n")
        L.append("## Learning objectives\n")
        for o in ep["objectives"]: L.append(f"- {o}")
        L.append("")
        L.append("## Script\n")
        L.append("Each scene lists the narration (voice-over), the on-screen text and the visual. Timecodes come from the rendered narration.\n")
        for i, sc in enumerate(ep["scenes"], 1):
            t = tmap.get(sc["id"])
            tc = f" · {fmt(t['start'])}–{fmt(t['start'] + t['duration'])}" if t else ""
            kind = {"title": "Title card", "outro": "Closing card"}.get(sc["kind"], "Scene")
            L.append(f"### {i}. {sc['heading']}  <sub>{kind}{tc}</sub>\n")
            L.append("**Narration**\n")
            L.append(f"> {sc['narration']}\n")
            if sc.get("bullets"):
                L.append("**On-screen text**\n")
                for b in sc["bullets"]: L.append(f"- {b['text']}")
                L.append("")
            v = sc.get("visual")
            if v and v.get("type") in VIS_DESC:
                L.append("**Visual**\n")
                L.append(VIS_DESC[v["type"]](v) + "\n")
        L.append("## Comprehension check (attention check)\n")
        for i, q in enumerate(ep["quiz"], 1):
            L.append(f"{i}. {q['q']}")
            for j, o in enumerate(q["options"]):
                mark = " ✔" if j == q["answer"] else ""
                L.append(f"   - {chr(97+j)}) {o}{mark}")
        L.append("")
        L.append("## Neutrality check\n")
        L.append(ep["excluded"] + "\n")
        L.append("## Sources\n")
        for s in ep["sources"]: L.append(f"- {s}")
        L.append("")
        open(os.path.join(out_dir, base + ".md"), "w").write("\n".join(L))
        print("wrote", base + ".md")

if __name__ == "__main__":
    main()
