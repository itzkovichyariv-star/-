# The Science Behind Cannabis — active-control video series

Five short, narrated explainer videos (about 4–6 minutes each, English) that describe **how cannabis acts biologically**, and nothing else. They are built to serve as an **active control condition** in a trial of a behaviour-change chatbot for cannabis users: credible, interesting and clearly "about cannabis", but free of any component that could itself change use.

## Source

Mechoulam, R., Hanuš, L. O., Pertwee, R., & Howlett, A. C. (2014). *Early phytocannabinoid chemistry to endocannabinoids and beyond.* **Nature Reviews Neuroscience, 15**(11), 757–764. https://doi.org/10.1038/nrn3811 (PubMed PMID 25315390)

The review is a history-of-discovery and basic-science paper: isolation of the phytocannabinoids, the discovery of the CB1 and CB2 receptors, the discovery of anandamide and 2-AG, and the development of the endocannabinoid-system concept. The episodes follow that structure. Where the review cites primary papers (Howlett 1984/1988, Herkenham 1990, Matsuda 1990, Devane 1992, Munro 1993, Sugiura 1995, Cravatt 1996, Wilson & Nicoll 2001, etc.), details were taken from those papers; each script lists them.

## Episodes

| # | Video | Script | Topic | Length |
|---|---|---|---|---|
| 1 | `output/01-how-cannabis-research-began.mp4` | `scripts/01-how-cannabis-research-began.md` | How cannabis research began: from plant chemistry to a biological system | 4:04 |
| 2 | `output/02-what-are-cannabinoids.mp4` | `scripts/02-what-are-cannabinoids.md` | What are cannabinoids? Phytocannabinoids, biosynthesis, three families | 4:12 |
| 3 | `output/03-discovery-of-cannabinoid-receptors.mp4` | `scripts/03-discovery-of-cannabinoid-receptors.md` | How were the receptors discovered? Adenylyl cyclase, binding, brain map, cloning | 4:52 |
| 4 | `output/04-endocannabinoids-anandamide-and-2ag.mp4` | `scripts/04-endocannabinoids-anandamide-and-2ag.md` | The body's own cannabinoids: anandamide (1992) and 2-AG (1995) | 4:20 |
| 5 | `output/05-how-the-endocannabinoid-system-works.mp4` | `scripts/05-how-the-endocannabinoid-system-works.md` | How the system works: synthesis, degradation, retrograde signalling | 6:00 |

Total ≈ 23.5 minutes. Each video has a matching `.srt` subtitle file in `output/`. One episode per session/week gives a dose of exposure comparable to a brief weekly chatbot interaction.

## Neutrality rules (what keeps the control condition inert)

| Included | Deliberately excluded |
|---|---|
| History of the research, chemistry, neurobiology | Harms, risks, dependence, withdrawal, "safer use" / harm reduction |
| Who discovered what, when, and how | Therapeutic or recreational benefits as an argument for or against use |
| Mechanisms: receptors, ligands, enzymes, synaptic signalling | Craving, motivation, goal setting, self-monitoring, coping strategies |
| Short factual comprehension questions (attention checks) | Reflective questions about the viewer's own use ("think about…") |
| "This is how it works" phrasing | "You should / should not", warnings, advice, reassurance |
| Laboratory, cell, nature and archive-style footage; 3D molecules and receptors | Footage of consumption, smoking, products, shops, or people using |

Each script ends with a *Neutrality check* paragraph stating what was left out of that episode. Before fielding, a second team member should read the five scripts and flag any sentence that could be read as a behavioural message.

Two places were handled with particular care:

- **Episode 3, brainstem.** The 1990 autoradiography result (low CB1 density in the brainstem) is stated as anatomy only; the usual "that's why…" inference about safety is not drawn.
- **Episode 5, THC vs 2-AG.** The comparison is purely mechanistic (partial vs full agonist, made on demand vs delivered via the bloodstream, local vs system-wide). Nothing is said about what this means for a person.

## What is in each script

1. Learning objectives (2–3)
2. The narration, scene by scene, with timecodes from the rendered video
3. On-screen text, plus a shot-by-shot description of the documentary cut (which footage or 3D insert appears when, and the key-term tag on screen)
4. Three comprehension questions with answers (for attention checks)
5. Neutrality check
6. Sources

## Production notes

- **Format:** documentary-style cut, 1920×1080 at 24 fps. Every narrated sentence gets its own shot, cut on the sentence start, so the picture follows the narration: lab work when an experiment is described, a dive from a microscope or a leaf into cells, then 3D molecules binding a receptor when the mechanism is explained.
- **Real footage:** licensed clips from the Adobe Stock free collection (lab work, microscopy, cells and neurons, plants growing, places such as Jerusalem, Cambridge, San Francisco). Each clip is graded to one look and given a motion that suits its subject: plants rise as they grow, fish and cells are followed in their direction of travel, close-ups push in or dive. The list of clips with titles and links is in `assets/stock_footage.json`. The raw clips are not stored in this repository (licence terms); they are re-downloaded with the project's Adobe account when rebuilding.
- **3D inserts:** molecules and receptors rendered with Three.js in headless Chromium (software WebGL). Molecules are real 3D conformers generated with RDKit from SMILES (THC, CBD, CBG, CBC, CBN, THCV, the acid precursors, anandamide, 2-AG, arachidonic acid, CP-55,940, HU-210, terpenes, morphine, cAMP…). Set pieces: a crude-extract molecule cloud, a discovery timeline, a lipid bilayer with 7-helix receptors (ligand docking, G-protein engagement, cAMP drop, gene knockout), membrane vesicles with radiolabelled probes, a point-cloud brain with regions lighting up, a synapse with vesicle release and retrograde 2-AG signalling, neuron networks, and enzymes that cut or assemble molecules.
- **Narration:** English, Kokoro neural voice (`bm_george`, run offline through sherpa-onnx). To use a human voice-over instead, record each scene's narration as `s1.wav`, `s2.wav`, … in the work folder; the timings, captions and cuts follow the audio.
- **Sound:** a quiet ambient music bed under the voice (ducked during speech), soft whooshes on scene changes and a chime when a molecule docks.
- **Text:** title cards, key-term tags (term + short explanation) and captions, burned in by ffmpeg from ASS so they stay crisp. A separate `.srt` per episode is in `output/`.
- **Font:** Inter (SIL Open Font License), bundled in `assets/fonts/`.

## Rebuilding

```
active-control-videos/
├── episodes/      # source of truth: one JSON per episode (narration, on-screen text, 3D scenes, quiz, sources)
├── shotlists/     # documentary cut: one shot per sentence (stock clip or 3D insert, in-point, motion, tag)
├── scripts/       # generated Markdown scripts
├── output/        # rendered MP4 + SRT
├── assets/        # fonts, molecules.json, audio bed/SFX, stock_footage.json (clip catalogue)
└── build/
    ├── tts.py           # narration → per-scene WAV, timing.json, captions.srt
    ├── soundtrack.py    # music bed + SFX;  mix.py → mix.wav (voice + ducked music + SFX)
    ├── ass.py           # overlay for the pure-3D render
    ├── molecules.py     # SMILES → 3D conformers (RDKit) → assets/molecules/molecules.json
    ├── scene3d/         # Three.js engine (engine.html + engine.js)
    ├── render3d.js      # episode JSON + timing → 3D MP4 (Playwright WebGL + ffmpeg)
    ├── edit.py          # shot list + stock clips + 3D pass + mix.wav → final documentary MP4
    ├── render.js        # the earlier 2D motion-graphics renderer (kept for reference)
    ├── make_scripts.py  # episode JSON + shot list → Markdown scripts
    └── build_all.sh     # runs everything
```

Steps (see `build/build_all.sh`):

1. `tts.py`, `mix.py` and `ass.py` for each episode (audio and timing).
2. `render3d.js --notext` for each episode: a clean full-length 3D pass, saved as `media/3d/epNN_full.mp4`.
3. Download the clips listed in the shot lists into `media/stock/<id>.mov` (Adobe Stock, free collection, 1080p).
4. `edit.py shotlists/<episode>.json <work>/<episode> output/<episode>.mp4 --media media` cuts the final video.

To change a shot, edit its line in the shot list (`t` = cut time in seconds, `src` = `stock:<id>` or `file:3d/...`, `in` = in-point, `motion` = push, pull, pan-left/right, dive, emerge, rise, sink, follow-left/right, drift or still, `label`/`sub` = the key-term tag) and re-run step 4 only; it takes a few minutes. The 3D pass is software-rendered (about 0.3–1 s per frame) and only needs re-rendering when the narration or a `scene3d` block changes.
