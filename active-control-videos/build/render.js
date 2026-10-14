#!/usr/bin/env node
/**
 * Render one episode to MP4.
 *
 *   node render.js <episode.json> <audio_dir> <out.mp4> [--fps 15] [--preview]
 *
 * audio_dir must contain narration.wav and timing.json produced by tts.py.
 * Frames are rendered deterministically in headless Chromium (every element's state is a
 * pure function of time t), screenshotted and piped into ffmpeg together with the narration.
 * --preview writes one PNG per scene (mid-scene) to <out>.preview/ instead of a video.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright');

const [,, epPath, audioDir, outPath, ...rest] = process.argv;
const FPS = rest.includes('--fps') ? parseInt(rest[rest.indexOf('--fps') + 1], 10) : 15;
const PREVIEW = rest.includes('--preview');
const W = 1920, H = 1080;

const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(audioDir, 'timing.json'), 'utf8'));
const fontDir = path.resolve(__dirname, '..', 'assets', 'fonts');

// ---------- HTML / CSS ----------
const css = `
@font-face{font-family:Inter;font-weight:400;src:url(file://${fontDir}/Inter-400.ttf)}
@font-face{font-family:Inter;font-weight:600;src:url(file://${fontDir}/Inter-600.ttf)}
@font-face{font-family:Inter;font-weight:800;src:url(file://${fontDir}/Inter-800.ttf)}
:root{--bg:#0b1220;--bg2:#101a2e;--panel:#141f36;--line:#243354;--text:#e8eef7;--muted:#9fb0c9;--accent:#2dd4bf;--accent2:#f59e0b;--rose:#fb7185;--sky:#60a5fa}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}
body{background:radial-gradient(1200px 800px at 80% 10%,#15223d 0%,var(--bg) 60%)}
.topbar{position:absolute;left:0;top:0;width:100%;height:84px;padding:0 64px;display:flex;align-items:center;justify-content:space-between;font-size:22px;color:var(--muted);letter-spacing:.02em}
.topbar b{color:var(--text);font-weight:600}
.topbar .ep{color:var(--accent)}
.progress{position:absolute;left:0;top:84px;height:4px;background:var(--line);width:100%}
.progress i{display:block;height:100%;background:var(--accent);width:0}
.scene{position:absolute;inset:0;opacity:0}
.content{position:absolute;left:64px;top:120px;width:1000px;height:760px}
.content h1{font-size:60px;font-weight:800;line-height:1.1;letter-spacing:-.01em;margin-bottom:36px}
.bullets{list-style:none}
.bullets li{font-size:31px;line-height:1.35;color:var(--text);padding:14px 0 14px 46px;position:relative;opacity:0;transform:translateY(14px)}
.bullets li::before{content:"";position:absolute;left:8px;top:28px;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.visual{position:absolute;left:1110px;top:120px;width:746px;height:760px;background:var(--panel);border:1px solid var(--line);border-radius:24px;overflow:hidden}
.visual svg{width:100%;height:100%;display:block}
.caption{position:absolute;left:0;right:0;bottom:0;height:150px;display:flex;align-items:center;justify-content:center;padding:0 160px;background:linear-gradient(180deg,rgba(11,18,32,0) 0%,rgba(11,18,32,.96) 35%)}
.caption span{font-size:34px;line-height:1.35;text-align:center;color:#f4f7fb;background:rgba(0,0,0,.45);padding:10px 22px;border-radius:12px;opacity:0}
.titlecard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 200px}
.titlecard .series{font-size:30px;color:var(--accent);letter-spacing:.25em;text-transform:uppercase;font-weight:600;margin-bottom:28px}
.titlecard h1{font-size:92px;font-weight:800;line-height:1.08;letter-spacing:-.015em;max-width:1500px}
.titlecard .sub{font-size:36px;color:var(--muted);margin-top:28px}
.titlecard .epnum{font-size:26px;color:var(--muted);margin-top:60px;letter-spacing:.1em}
.titlecard .cite{position:absolute;bottom:60px;left:0;right:0;text-align:center;font-size:21px;color:var(--muted)}
.outro{justify-content:center}
.outro h1{font-size:72px}
.rv{opacity:0;transform:translateY(12px)}
.rv.in{opacity:1;transform:none}
/* cards */
.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:36px}
.cards.one{grid-template-columns:1fr}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:22px 24px;opacity:0;transform:translateY(12px)}
.card h3{font-size:30px;font-weight:600;color:var(--accent);margin-bottom:8px}
.card p{font-size:22px;color:var(--muted);line-height:1.35}
/* timeline */
.tl{padding:40px 40px 40px 60px;position:relative;display:flex;flex-direction:column;justify-content:center;height:100%;gap:28px}
.tl::before{content:"";position:absolute;left:92px;top:40px;bottom:40px;width:3px;background:var(--line)}
.tli{position:relative;padding-left:70px;opacity:0;transform:translateX(12px)}
.tli::before{content:"";position:absolute;left:24px;top:14px;width:20px;height:20px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 6px var(--panel)}
.tli b{font-size:30px;font-weight:800;color:var(--accent2);display:block}
.tli span{font-size:23px;color:var(--muted);line-height:1.3}
/* compare */
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:36px;height:100%}
.col{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:26px;opacity:0;transform:translateY(12px)}
.col h3{font-size:28px;font-weight:700;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid var(--line)}
.col.l h3{color:var(--accent)}.col.r h3{color:var(--accent2)}
.col li{list-style:none;font-size:23px;color:var(--text);line-height:1.3;padding:11px 0 11px 26px;position:relative}
.col li::before{content:"";position:absolute;left:4px;top:20px;width:9px;height:9px;border-radius:50%;background:var(--muted)}
/* bigfact */
.bf{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:50px}
.bf b{font-size:54px;font-weight:800;line-height:1.15;color:var(--accent);opacity:0;transform:translateY(12px)}
.bf span{font-size:26px;color:var(--muted);margin-top:26px;line-height:1.35;opacity:0;transform:translateY(12px)}
svg text{font-family:Inter,system-ui,sans-serif}
`;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
const at = (v) => `data-at="${v}"`;

// ---------- visuals ----------
function vCards(v){
  const one = v.items.length <= 3;
  return `<div class="cards${one?' one':''}">${v.items.map(i=>`<div class="card rv" ${at(i.at)}><h3>${esc(i.title)}</h3><p>${esc(i.sub)}</p></div>`).join('')}</div>`;
}
function vTimeline(v){
  return `<div class="tl">${v.items.map(i=>`<div class="tli rv" ${at(i.at)}><b>${esc(i.label)}</b><span>${esc(i.sub)}</span></div>`).join('')}</div>`;
}
function vCompare(v){
  const col=(c,cls,a)=>`<div class="col ${cls} rv" ${at(a)}><h3>${esc(c.title)}</h3><ul>${c.rows.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`;
  return `<div class="cmp">${col(v.left,'l',v.at||0.1)}${col(v.right,'r',(v.at||0.1)+0.12)}</div>`;
}
function vBigfact(v){
  return `<div class="bf"><b class="rv" ${at(0.15)}>${esc(v.text)}</b><span class="rv" ${at(0.4)}>${esc(v.sub||'')}</span></div>`;
}
function vPathway(v){
  const W=746,H=760, bw=200,bh=64;
  const pos = {}; v.nodes.forEach(n=>{pos[n.id]={x:40+n.x*(W-80), y:40+n.y*(H-80)};});
  let s = `<svg viewBox="0 0 ${W} ${H}"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#2dd4bf"/></marker></defs>`;
  for(const e of v.edges){
    const a=pos[e.from], b=pos[e.to];
    // shorten the line so it starts/ends at box edges (approx.)
    const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy), ux=dx/L, uy=dy/L;
    const ax=Math.abs(ux)>Math.abs(uy)? bw/2+6 : bh/2+6;
    const x1=a.x+ux*ax, y1=a.y+uy*ax, x2=b.x-ux*(ax+4), y2=b.y-uy*(ax+4);
    const lp=(e.lpos!=null?e.lpos:0.5); const mx=x1+(x2-x1)*lp, my=y1+(y2-y1)*lp;
    s += `<g class="rv" ${at(e.at)}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2dd4bf" stroke-width="3" marker-end="url(#arr)"/>`;
    if(e.label){ const tw=e.label.length*11+20; s+=`<rect x="${mx-tw/2}" y="${my-16}" width="${tw}" height="32" rx="8" fill="#0b1220" stroke="#243354"/><text x="${mx}" y="${my+7}" text-anchor="middle" font-size="19" fill="#f59e0b" font-weight="600">${esc(e.label)}</text>`; }
    s += `</g>`;
  }
  for(const n of v.nodes){
    const p=pos[n.id]; const w=Math.max(bw, n.label.length*13+30);
    s += `<g class="rv" ${at(n.at)}><rect x="${p.x-w/2}" y="${p.y-bh/2}" width="${w}" height="${bh}" rx="14" fill="#101a2e" stroke="#2dd4bf" stroke-width="2"/><text x="${p.x}" y="${p.y+8}" text-anchor="middle" font-size="24" font-weight="600" fill="#e8eef7">${esc(n.label)}</text></g>`;
  }
  return s+`</svg>`;
}
function vBrain(v){
  // stylised side view of a brain (facing left): cerebrum, cerebellum, brainstem
  const W=746,H=760;
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  s+=`<g transform="translate(30,90) scale(1.05)">
  <path d="M120 300 C 60 240, 70 120, 170 80 C 230 20, 400 10, 500 60 C 600 90, 650 180, 620 280 C 610 330, 560 360, 520 370 C 480 400, 400 420, 320 400 C 250 420, 170 390, 140 350 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path d="M470 360 C 520 350, 600 360, 610 410 C 615 450, 560 480, 500 465 C 460 455, 440 420, 470 360 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path d="M400 405 C 420 440, 440 500, 430 560 L 395 560 C 385 500, 370 450, 360 410 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path d="M190 130 C 260 110, 300 160, 360 140 C 420 120, 470 160, 540 150" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  <path d="M160 220 C 240 200, 300 250, 380 230 C 440 215, 500 250, 580 230" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  <path d="M200 310 C 260 290, 320 330, 400 310" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  </g>`;
  for(const r of v.regions){
    const x=r.x*W, y=r.y*H; const hi=r.level==='high';
    const col = hi? '#f59e0b' : '#9fb0c9'; const rad = hi? 22:14;
    s+=`<g class="rv" ${at(r.at)}><circle cx="${x}" cy="${y}" r="${rad}" fill="${col}" fill-opacity=".85"/><circle cx="${x}" cy="${y}" r="${rad+10}" fill="none" stroke="${col}" stroke-opacity=".5" stroke-width="3"/>
    <text x="${x}" y="${y+rad+36}" text-anchor="middle" font-size="22" font-weight="600" fill="#e8eef7">${esc(r.label)}</text><text x="${x}" y="${y+rad+62}" text-anchor="middle" font-size="18" fill="${col}">${hi?'high density':'low density'}</text></g>`;
  }
  s+=`<g><circle cx="44" cy="44" r="12" fill="#f59e0b"/><text x="66" y="51" font-size="20" fill="#9fb0c9">CB1 receptor density: high</text><circle cx="360" cy="44" r="9" fill="#9fb0c9"/><text x="380" y="51" font-size="20" fill="#9fb0c9">low</text></g>`;
  return s+`</svg>`;
}
function vReceptor(v){
  // stages: 0 membrane, 1 ligand, 2 gprotein, 3 effect  (data-stage = minimum stage index to show)
  const W=746,H=760; const my=330; // membrane centre y
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  // membrane: two rows of lipid heads
  s+=`<g data-stage="0">`;
  for(let x=20;x<W;x+=34){ s+=`<circle cx="${x}" cy="${my-38}" r="12" fill="#243354"/><line x1="${x}" y1="${my-26}" x2="${x}" y2="${my-4}" stroke="#243354" stroke-width="3"/>`;
    s+=`<circle cx="${x}" cy="${my+38}" r="12" fill="#243354"/><line x1="${x}" y1="${my+26}" x2="${x}" y2="${my+4}" stroke="#243354" stroke-width="3"/>`; }
  s+=`<text x="24" y="${my-70}" font-size="20" fill="#9fb0c9">outside the cell</text><text x="24" y="${my+92}" font-size="20" fill="#9fb0c9">inside the cell</text>`;
  // 7 helices
  for(let i=0;i<7;i++){ const x=300+i*26; s+=`<rect x="${x}" y="${my-70}" width="18" height="140" rx="9" fill="#2dd4bf" fill-opacity="${0.55+0.06*i}"/>`; }
  s+=`<text x="378" y="${my+112}" text-anchor="middle" font-size="22" font-weight="600" fill="#2dd4bf">CB1 receptor (7 transmembrane helices)</text></g>`;
  // ligand
  s+=`<g data-stage="1"><polygon points="378,${my-150} 404,${my-135} 404,${my-105} 378,${my-90} 352,${my-105} 352,${my-135}" fill="#f59e0b"/><text x="378" y="${my-170}" text-anchor="middle" font-size="22" font-weight="600" fill="#f59e0b">cannabinoid ligand</text><path d="M378 ${my-88} L378 ${my-74}" stroke="#f59e0b" stroke-width="3" marker-end="url(#arr2)"/></g>`;
  // G protein
  s+=`<g data-stage="2"><circle cx="330" cy="${my+180}" r="38" fill="#60a5fa"/><text x="330" y="${my+188}" text-anchor="middle" font-size="26" font-weight="700" fill="#0b1220">α</text><circle cx="400" cy="${my+170}" r="28" fill="#93c5fd"/><text x="400" y="${my+178}" text-anchor="middle" font-size="22" font-weight="700" fill="#0b1220">β</text><circle cx="446" cy="${my+200}" r="20" fill="#bfdbfe"/><text x="446" y="${my+207}" text-anchor="middle" font-size="18" font-weight="700" fill="#0b1220">γ</text><text x="330" y="${my+250}" text-anchor="middle" font-size="22" fill="#60a5fa" font-weight="600">Gi/o protein</text></g>`;
  // effect
  s+=`<defs><marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#f59e0b"/></marker></defs>`;
  s+=`<g data-stage="3"><path d="M372 ${my+185} L 190 ${my+185}" stroke="#60a5fa" stroke-width="3" marker-end="url(#arr2)"/><rect x="40" y="${my+150}" width="150" height="70" rx="14" fill="#101a2e" stroke="#fb7185" stroke-width="2"/><text x="115" y="${my+180}" text-anchor="middle" font-size="20" font-weight="600" fill="#fb7185">adenylyl</text><text x="115" y="${my+204}" text-anchor="middle" font-size="20" font-weight="600" fill="#fb7185">cyclase ↓</text><text x="115" y="${my+260}" text-anchor="middle" font-size="24" fill="#e8eef7" font-weight="600">cAMP ↓</text></g>`;
  return s+`</svg>`;
}
function vSynapse(v){
  // stages: base 0, depol 1, release 2, bind 3, inhibit 4
  const W=746,H=760;
  let s=`<svg viewBox="0 0 ${W} ${H}"><defs><marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#f59e0b"/></marker></defs>`;
  // presynaptic terminal (top)
  s+=`<g data-stage="0"><path d="M220 40 L 520 40 L 520 230 C 520 290, 220 290, 220 230 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <text x="370" y="80" text-anchor="middle" font-size="24" font-weight="600" fill="#60a5fa">presynaptic terminal</text>
  <path d="M160 440 L 580 440 L 580 720 L 160 720 Z" fill="#162244" stroke="#2dd4bf" stroke-width="4"/>
  <text x="370" y="690" text-anchor="middle" font-size="24" font-weight="600" fill="#2dd4bf">postsynaptic neuron</text>
  <text x="640" y="365" font-size="20" fill="#9fb0c9">synaptic</text><text x="640" y="390" font-size="20" fill="#9fb0c9">cleft</text>`;
  // vesicles
  for(const [x,y] of [[290,140],[340,180],[400,150],[450,185],[370,110]]) s+=`<circle cx="${x}" cy="${y}" r="20" fill="#0b1220" stroke="#9fb0c9" stroke-width="3" class="ves"/>`;
  s+=`<text x="370" y="236" text-anchor="middle" font-size="18" fill="#9fb0c9">vesicles with neurotransmitter</text>`;
  // CB1 receptors on presynaptic membrane
  for(const x of [260,480]) s+=`<rect x="${x-14}" y="262" width="28" height="46" rx="8" fill="#2dd4bf"/>`;
  s+=`<text x="260" y="332" text-anchor="middle" font-size="18" fill="#2dd4bf" font-weight="600">CB1</text><text x="480" y="332" text-anchor="middle" font-size="18" fill="#2dd4bf" font-weight="600">CB1</text>`;
  // Ca channel on presynaptic membrane
  s+=`<rect x="356" y="266" width="30" height="40" rx="6" fill="#fb7185" class="cach"/><text x="371" y="332" text-anchor="middle" font-size="18" fill="#fb7185" font-weight="600">Ca²⁺ channel</text></g>`;
  // stage 1: postsynaptic depolarisation, Ca2+ in
  s+=`<g data-stage="1"><text x="370" y="500" text-anchor="middle" font-size="24" fill="#f59e0b" font-weight="700">activation → Ca²⁺ ↑</text>`;
  for(const [x,y] of [[250,540],[300,575],[430,560],[480,540],[370,580]]) s+=`<text x="${x}" y="${y}" text-anchor="middle" font-size="20" fill="#f59e0b">Ca²⁺</text>`;
  s+=`<text x="370" y="630" text-anchor="middle" font-size="20" fill="#e8eef7">DAGL makes 2-AG from membrane lipids</text></g>`;
  // stage 2: 2-AG released, travelling backwards
  s+=`<g data-stage="2">`;
  for(const [x,y] of [[250,400],[300,370],[440,395],[490,365]]) s+=`<circle cx="${x}" cy="${y}" r="9" fill="#f59e0b"/>`;
  s+=`<path d="M370 435 L 370 330" stroke="#f59e0b" stroke-width="4" marker-end="url(#arr3)"/><text x="470" y="420" font-size="20" fill="#f59e0b" font-weight="600">2-AG</text>
  <text x="40" y="380" font-size="18" fill="#f59e0b">retrograde:</text><text x="40" y="404" font-size="18" fill="#f59e0b">post → pre</text></g>`;
  // stage 3: bound to CB1
  s+=`<g data-stage="3"><circle cx="260" cy="250" r="11" fill="#f59e0b"/><circle cx="480" cy="250" r="11" fill="#f59e0b"/><text x="370" y="30" text-anchor="middle" font-size="20" fill="#f59e0b" font-weight="600">2-AG bound to presynaptic CB1 → Gi/o</text></g>`;
  // stage 4: inhibition
  s+=`<g data-stage="4"><line x1="356" y1="266" x2="386" y2="306" stroke="#e8eef7" stroke-width="4"/><line x1="386" y1="266" x2="356" y2="306" stroke="#e8eef7" stroke-width="4"/>
  <text x="548" y="120" font-size="20" fill="#fb7185" font-weight="600">Ca²⁺ entry ↓</text><text x="548" y="148" font-size="20" fill="#fb7185" font-weight="600">K⁺ channels open</text><text x="548" y="176" font-size="20" fill="#fb7185" font-weight="600">release ↓</text>
  <text x="370" y="740" text-anchor="middle" font-size="20" fill="#9fb0c9">GABA terminal → DSI · glutamate terminal → DSE</text></g>`;
  return s+`</svg>`;
}
const VIS = {cards:vCards, timeline:vTimeline, compare:vCompare, bigfact:vBigfact, pathway:vPathway, brain:vBrain, receptor:vReceptor, synapse:vSynapse};

function sceneHtml(sc, idx){
  if(sc.kind==='title'){
    return `<div class="scene" id="${sc.id}"><div class="titlecard">
      <div class="series rv" data-at="0.02">${esc(ep.series)}</div>
      <h1 class="rv" data-at="0.08">${esc(sc.heading)}</h1>
      <div class="sub rv" data-at="0.2">${esc(ep.subtitle)}</div>
      <div class="epnum rv" data-at="0.3">EPISODE ${ep.episode} OF 5</div>
      <div class="cite rv" data-at="0.4">Based on Mechoulam, Hanuš, Pertwee & Howlett (2014), Nature Reviews Neuroscience 15:757–764</div>
    </div><div class="caption"><span></span></div></div>`;
  }
  if(sc.kind==='outro'){
    return `<div class="scene" id="${sc.id}"><div class="titlecard outro">
      <div class="series rv" data-at="0.02">${esc(ep.series)}</div>
      <h1 class="rv" data-at="0.1">${esc(sc.heading)}</h1>
      <div class="cite rv" data-at="0.3">Source: Mechoulam R, Hanuš LO, Pertwee R, Howlett AC. Nat Rev Neurosci 2014;15:757–764 · doi:10.1038/nrn3811</div>
    </div><div class="caption"><span></span></div></div>`;
  }
  const vis = sc.visual && VIS[sc.visual.type] ? VIS[sc.visual.type](sc.visual) : '';
  const stages = sc.visual && sc.visual.stages ? JSON.stringify(sc.visual.stages) : 'null';
  return `<div class="scene" id="${sc.id}" data-stages='${stages}'>
    <div class="content"><h1 class="rv" data-at="0">${esc(sc.heading)}</h1><ul class="bullets">${(sc.bullets||[]).map(b=>`<li data-at="${b.at}">${esc(b.text)}</li>`).join('')}</ul></div>
    <div class="visual">${vis}</div>
    <div class="caption"><span></span></div></div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="topbar"><div><b>${esc(ep.series)}</b></div><div><span class="ep">Episode ${ep.episode}</span> &nbsp;·&nbsp; ${esc(ep.title)}</div></div>
<div class="progress"><i id="prog"></i></div>
${ep.scenes.map(sceneHtml).join('\n')}
<script>
const TIMING = ${JSON.stringify(timing)};
const TOTAL = TIMING.total;
const FADE = 0.45, RISE = 0.5;
function ease(x){ x=Math.max(0,Math.min(1,x)); return 1-Math.pow(1-x,3); }
function render(t){
  document.getElementById('prog').style.width = (100*t/TOTAL)+'%';
  for(const ts of TIMING.scenes){
    const el = document.getElementById(ts.id);
    const start = ts.start, end = ts.start + ts.duration + TIMING.gap;
    if(t < start - FADE || t > end){ el.style.opacity = 0; continue; }
    // cross-fade
    let op = 1;
    if(t < start) op = ease((t-(start-FADE))/FADE);
    else if(t > end - FADE) op = 1 - ease((t-(end-FADE))/FADE);
    el.style.opacity = op;
    const local = Math.max(0, t - start);
    const p = Math.min(1, local / ts.duration);
    // reveal elements
    el.querySelectorAll('[data-at]').forEach(x=>{
      const a = parseFloat(x.getAttribute('data-at')) * ts.duration;
      const k = ease((local - a)/RISE);
      x.style.opacity = k;
      x.style.transform = 'translate(0,' + (14*(1-k)) + 'px)';
    });
    // staged visuals
    const stages = el.getAttribute('data-stages');
    if(stages && stages!=='null'){
      const st = JSON.parse(stages);
      const names = ['membrane','ligand','gprotein','effect'];
      const synNames = ['base','depol','release','bind','inhibit'];
      let cur = 0;
      for(const s of st){ if(p >= s.at){ const n = names.indexOf(s.state); const m = synNames.indexOf(s.state); cur = n>=0? n : m; } }
      el.querySelectorAll('[data-stage]').forEach(g=>{
        const need = parseInt(g.getAttribute('data-stage'));
        g.style.opacity = need <= cur ? 1 : 0;
      });
    }
    // caption
    const cap = el.querySelector('.caption span');
    let text = '';
    for(const c of ts.captions){ if(local >= c.start && local < c.end){ text = c.text; break; } }
    cap.textContent = text;
    cap.style.opacity = text ? 1 : 0;
  }
}
window.render = render;
</script></body></html>`;

(async () => {
  const tmpHtml = path.resolve(audioDir, 'page.html');
  fs.writeFileSync(tmpHtml, html);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto('file://' + tmpHtml);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  if (PREVIEW) {
    const dir = outPath + '.preview'; fs.mkdirSync(dir, { recursive: true });
    for (const ts of timing.scenes) {
      for (const frac of [0.1, 0.5, 0.95]) {
        const t = ts.start + ts.duration * frac;
        await page.evaluate((t) => window.render(t), t);
        await page.screenshot({ path: path.join(dir, `${ts.id}-${frac}.png`) });
      }
    }
    await browser.close(); console.log('preview written to', dir); return;
  }

  const total = timing.total;
  const nFrames = Math.ceil(total * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-i', path.resolve(audioDir, 'narration.wav'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'medium', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', outPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < nFrames; i++) {
    const t = i / FPS;
    await page.evaluate((t) => window.render(t), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`${ep.id}: frame ${i}/${nFrames} (${((Date.now()-t0)/1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  await browser.close();
  console.log(`${ep.id}: wrote ${outPath} (${(total/60).toFixed(2)} min, ${nFrames} frames, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
