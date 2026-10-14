# The Science Behind Cannabis — active-control video series

Five short, narrated explainer videos (about 4–6 minutes each, English) that describe **how cannabis acts biologically**, and nothing else. They are built to serve as an **active control condition** in a trial of a behaviour-change chatbot for cannabis users: credible, interesting and clearly "about cannabis", but free of any component that could itself change use.

## Source

Mechoulam, R., Hanuš, L. O., Pertwee, R., & Howlett, A. C. (2014). *Early phytocannabinoid chemistry to endocannabinoids and beyond.* **Nature Reviews Neuroscience, 15**(11), 757–764. https://doi.org/10.1038/nrn3811 (PubMed PMID 25315390)

The review is a history-of-discovery and basic-science paper: isolation of the phytocannabinoids, the discovery of the CB1 and CB2 receptors, the discovery of anandamide and 2-AG, and the development of the endocannabinoid-system concept. The episodes follow that structure. Where the review cites primary papers (Howlett 1984/1988, Herkenham 1990, Matsuda 1990, Devane 1992, Munro 1993, Sugiura 1995, Cravatt 1996, Wilson & Nicoll 2001, etc.), details were taken from those papers; each script lists them.

## Episodes

| # | Video | Script | Topic | Length |
|---|---|---|---|---|
| 1 | `output/01-how-cannabis-research-began.mp4` | `scripts/01-how-cannabis-research-began.md` | How cannabis research began: from plant chemistry to a biological system | 3:50 |
| 2 | `output/02-what-are-cannabinoids.mp4` | `scripts/02-what-are-cannabinoids.md` | What are cannabinoids? Phytocannabinoids, biosynthesis, three families | 3:57 |
| 3 | `output/03-discovery-of-cannabinoid-receptors.mp4` | `scripts/03-discovery-of-cannabinoid-receptors.md` | How were the receptors discovered? Adenylyl cyclase, binding, brain map, cloning | 4:38 |
| 4 | `output/04-endocannabinoids-anandamide-and-2ag.mp4` | `scripts/04-endocannabinoids-anandamide-and-2ag.md` | The body's own cannabinoids: anandamide (1992) and 2-AG (1995) | 4:04 |
| 5 | `output/05-how-the-endocannabinoid-system-works.mp4` | `scripts/05-how-the-endocannabinoid-system-works.md` | How the system works: synthesis, degradation, retrograde signalling | 5:45 |

Total ≈ 22 minutes. Each video has a matching `.srt` subtitle file in `output/`. One episode per session/week gives a dose of exposure comparable to a brief weekly chatbot interaction.

## Neutrality rules (what keeps the control condition inert)

| Included | Deliberately excluded |
|---|---|
| History of the research, chemistry, neurobiology | Harms, risks, dependence, withdrawal, "safer use" / harm reduction |
| Who discovered what, when, and how | Therapeutic or recreational benefits as an argument for or against use |
| Mechanisms: receptors, ligands, enzymes, synaptic signalling | Craving, motivation, goal setting, self-monitoring, coping strategies |
| Short factual comprehension questions (attention checks) | Reflective questions about the viewer's own use ("think about…") |
| "This is how it works" phrasing | "You should / should not", warnings, advice, reassurance |
| Abstract motion graphics | Footage of consumption, products, shops, or people using |

Each script ends with a *Neutrality check* paragraph stating what was left out of that episode. Before fielding, a second team member should read the five scripts and flag any sentence that could be read as a behavioural message.

Two places were handled with particular care:

- **Episode 3, brainstem.** The 1990 autoradiography result (low CB1 density in the brainstem) is stated as anatomy only; the usual "that's why…" inference about safety is not drawn.
- **Episode 5, THC vs 2-AG.** The comparison is purely mechanistic (partial vs full agonist, made on demand vs delivered via the bloodstream, local vs system-wide). Nothing is said about what this means for a person.

## What is in each script

1. Learning objectives (2–3)
2. The narration, scene by scene, with timecodes from the rendered video
3. On-screen text and a description of the visual for each scene
4. Three comprehension questions with answers (for attention checks)
5. Neutrality check
6. Sources

## Production notes

- **Narration:** English, synthetic voice (Piper `en_US-lessac-medium`, run offline through sherpa-onnx). The voice is clear but recognisably synthetic; if a human voice-over is preferred, record each scene's narration and drop the WAVs into the work folder as `s1.wav`, `s2.wav`, … — the renderer times every scene from the audio, so no re-editing is needed.
- **Visuals:** 1920×1080, 15 fps, dark motion-graphics style, rendered deterministically from HTML/SVG in headless Chromium. Every visual element's state is a pure function of time, so re-renders are reproducible.
- **Subtitles:** burned-in captions plus a separate `.srt` per episode.
- **Font:** Inter (SIL Open Font License), bundled in `assets/fonts/`.

## Rebuilding

```
active-control-videos/
├── episodes/      # source of truth: one JSON per episode (narration, on-screen text, visuals, quiz, sources)
├── scripts/       # generated Markdown scripts
├── output/        # rendered MP4 + SRT
├── assets/fonts/
└── build/
    ├── tts.py           # narration → per-scene WAV, timing.json, captions.srt
    ├── render.js        # timing + episode JSON → MP4 (Playwright + ffmpeg)
    ├── make_scripts.py  # episode JSON → Markdown scripts
    └── build_all.sh     # runs everything
```

Edit the JSON, then run `build/build_all.sh` (requirements are listed at the top of that script). Changing narration automatically re-times the scene; `at` values on bullets and visual elements are fractions of the scene's duration, so they keep their relative position.
