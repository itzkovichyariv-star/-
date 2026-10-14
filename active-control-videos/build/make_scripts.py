#!/usr/bin/env python3
"""Generate the human-readable video scripts (Markdown) from the episode JSON files.

Usage: python3 make_scripts.py <episodes_dir> <scripts_out_dir> [timing_root]
If timing_root is given, <timing_root>/<episode-basename>/timing.json is used for real durations.
If ../shotlists/<episode-basename>.json exists (next to the episodes dir), each scene also lists its
documentary shots: stock footage (described from assets/stock_footage.json) and 3D inserts.
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

SCENE3D_DESC = {
    "title": lambda v: f"Title card over a slowly orbiting 3D model of {v.get('mol','THC')}" + (" above a lipid membrane with a CB1 receptor" if v.get("receptor") else "") + ", in a drifting particle field.",
    "molecules": lambda v: "Camera tour of 3D ball-and-stick molecules: " + ", ".join(i.get("label") or i["mol"] for i in v.get("items", []) if i.get("label") or i.get("mol")) + (f"; background: {v['background']}" if v.get("background") else "") + ("; mirror plane between enantiomers" if v.get("mirrorPlane") else "") + ".",
    "mixture": lambda v: "Swirling cloud of hundreds of small molecules (a crude extract)" + (f"; {v['isolate']['label']} is isolated and brought to the centre" if v.get("isolate") else "") + ".",
    "timeline": lambda v: "Fly-through timeline in 3D space: " + "; ".join(f"{n['year']} — {n['text']}" for n in v.get("nodes", [])) + ".",
    "membrane": lambda v: "Lipid bilayer with 7-helix receptor(s) " + ", ".join(r.get("label", "receptor") for r in v.get("receptors", [])) + "; actions: " + ", ".join(s["action"] for s in v.get("stages", [])) + (("; ligands: " + ", ".join(l.get("label") or l["mol"] for l in v.get("ligands", []))) if v.get("ligands") else "") + ".",
    "brain": lambda v: "Point-cloud brain; regions light up: " + ", ".join(f"{r['label']} ({r.get('level','high')})" for r in v.get("regions", [])) + ".",
    "synapse": lambda v: "3D synapse (presynaptic terminal, cleft, postsynaptic neuron) with vesicles, CB1 receptors, Ca²⁺ channel and 2-AG molecules; stages: " + ", ".join(s["action"] for s in v.get("stages", [])) + ".",
    "network": lambda v: "Network of procedurally grown neurons with pulses travelling along axons" + ("; CB1 terminals glow" if any(s["action"] == "cb1" for s in v.get("stages", [])) else "") + ".",
    "enzyme": lambda v: "Enzyme (translucent blob) " + "; ".join(f"{i['enzyme']} {'cuts' if i.get('mode','cut')=='cut' else 'assembles'} {i['label']}" + (f" → {', '.join(p for p in i.get('products', []) if p)}" if i.get('mode','cut')=='cut' else "") for i in v.get("items", [])) + ".",
    "vesicles": lambda v: f"Membrane vesicles studded with receptors; radiolabelled probe molecules ({v.get('probeLabel','probe')}) drift and bind.",
}

def shot_desc(sh, stock):
    src = sh["src"]
    if src.startswith("stock:"):
        what = "Footage: " + (stock.get(src[6:], {}).get("title") or src).rstrip(".")
    elif "3d/" in src:
        what = "3D animation (molecules/receptors)"
    else:
        what = src
    mv = {"push": "slow push-in", "pull": "slow pull-out", "dive": "dive in", "emerge": "emerge", "rise": "rising move",
          "sink": "sinking move", "follow-left": "follows the motion", "follow-right": "follows the motion",
          "drift": "gentle drift", "pan-left": "pan", "pan-right": "pan"}.get(sh.get("motion", ""), "")
    txt = sh.get("title") or sh.get("label") or ""
    sub = sh.get("subtitle") or sh.get("sub") or ""
    on = f" — on screen: **{txt}**" + (f" ({sub})" if sub else "") if txt else ""
    return what + (f", {mv}" if mv else "") + on

def fmt(sec):
    m, s = divmod(int(round(sec)), 60)
    return f"{m}:{s:02d}"

def main():
    ep_dir, out_dir = sys.argv[1], sys.argv[2]
    timing_root = sys.argv[3] if len(sys.argv) > 3 else None
    os.makedirs(out_dir, exist_ok=True)
    shot_dir = os.path.join(os.path.dirname(os.path.abspath(ep_dir)), "shotlists")
    stock_path = os.path.join(os.path.dirname(os.path.abspath(ep_dir)), "assets", "stock_footage.json")
    stock = json.load(open(stock_path)) if os.path.exists(stock_path) else {}
    for f in sorted(glob.glob(os.path.join(ep_dir, "*.json"))):
        ep = json.load(open(f)); base = os.path.splitext(os.path.basename(f))[0]
        timing = None
        if timing_root and os.path.exists(os.path.join(timing_root, base, "timing.json")):
            timing = json.load(open(os.path.join(timing_root, base, "timing.json")))
        tmap = {s["id"]: s for s in timing["scenes"]} if timing else {}
        sl_path = os.path.join(shot_dir, base + ".json")
        shots = json.load(open(sl_path))["shots"] if os.path.exists(sl_path) else []
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
            if shots and t:
                a, b = t["start"], t["start"] + t["duration"] + timing["gap"]
                mine = [sh for sh in shots if a - 0.05 <= sh["t"] < b - 0.05]
                if mine:
                    L.append("**Visual (documentary cut, shot by shot)**\n")
                    for sh in mine: L.append(f"- `{fmt(sh['t'])}` {shot_desc(sh, stock)}")
                    L.append("")
            v3 = sc.get("scene3d")
            if v3:
                L.append("**3D animation used in this scene**\n")
                L.append(SCENE3D_DESC.get(v3.get("type"), lambda v: v.get("type", ""))(v3) + "\n")
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
