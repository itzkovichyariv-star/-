#!/usr/bin/env node
/**
 * Render one episode to MP4 (motion-graphics version).
 *
 *   node render.js <episode.json> <audio_dir> <out.mp4> [--fps 24] [--preview] [--clip START END]
 *
 * audio_dir must contain narration.wav and timing.json produced by tts.py.
 * Every visual element's state is a pure function of time t (seconds), so frames are rendered
 * deterministically in headless Chromium, screenshotted and piped into ffmpeg with the narration.
 *   --preview         writes PNGs at several points of every scene to <out>.preview/ instead of a video
 *   --clip START END  renders only that time window (seconds), without audio, for quick motion checks
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright');

const [,, epPath, audioDir, outPath, ...rest] = process.argv;
const arg = (k, d) => rest.includes(k) ? rest[rest.indexOf(k) + 1] : d;
const FPS = parseInt(arg('--fps', '24'), 10);
const PREVIEW = rest.includes('--preview');
const CLIP = rest.includes('--clip') ? [parseFloat(arg('--clip')), parseFloat(rest[rest.indexOf('--clip') + 2])] : null;
const W = 1920, H = 1080;

const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.resolve(audioDir, 'timing.json'), 'utf8'));
const fontDir = path.resolve(__dirname, '..', 'assets', 'fonts');

// ---------- CSS ----------
const css = `
@font-face{font-family:Inter;font-weight:400;src:url(file://${fontDir}/Inter-400.ttf)}
@font-face{font-family:Inter;font-weight:600;src:url(file://${fontDir}/Inter-600.ttf)}
@font-face{font-family:Inter;font-weight:800;src:url(file://${fontDir}/Inter-800.ttf)}
:root{--bg:#0b1220;--bg2:#101a2e;--panel:#141f36;--line:#243354;--text:#e8eef7;--muted:#9fb0c9;--accent:#2dd4bf;--accent2:#f59e0b;--rose:#fb7185;--sky:#60a5fa}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}
#blobs{position:absolute;inset:0;overflow:hidden}
.blob{position:absolute;width:900px;height:900px;border-radius:50%;filter:blur(90px);opacity:.55}
.b1{background:radial-gradient(circle,#1b3a6b 0%,rgba(27,58,107,0) 65%)}
.b2{background:radial-gradient(circle,#0f4f4a 0%,rgba(15,79,74,0) 65%)}
#bg{position:absolute;inset:0}
.topbar{position:absolute;left:0;top:0;width:100%;height:84px;padding:0 64px;display:flex;align-items:center;justify-content:space-between;font-size:22px;color:var(--muted);letter-spacing:.02em}
.topbar b{color:var(--text);font-weight:600}
.topbar .ep{color:var(--accent)}
.progress{position:absolute;left:0;top:84px;height:4px;background:var(--line);width:100%}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#7df3e4);width:0;box-shadow:0 0 12px rgba(45,212,191,.7)}
.scene{position:absolute;inset:0;opacity:0;will-change:opacity,transform}
.content{position:absolute;left:64px;top:120px;width:1000px;height:760px}
.content h1{font-size:60px;font-weight:800;line-height:1.1;letter-spacing:-.01em;margin-bottom:14px}
.hline{height:5px;width:140px;border-radius:3px;background:linear-gradient(90deg,var(--accent),rgba(45,212,191,0));margin-bottom:30px;transform-origin:left center}
.bullets{list-style:none}
.bullets li{font-size:31px;line-height:1.35;color:var(--text);padding:14px 0 14px 46px;position:relative;opacity:0}
.bullets li i{position:absolute;left:8px;top:28px;width:14px;height:14px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 rgba(45,212,191,.5)}
.visual{position:absolute;left:1110px;top:120px;width:746px;height:760px;background:linear-gradient(160deg,#162243 0%,#111b31 100%);border:1px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.visual svg{width:100%;height:100%;display:block}
.caption{position:absolute;left:0;right:0;bottom:0;height:150px;display:flex;align-items:center;justify-content:center;padding:0 160px;background:linear-gradient(180deg,rgba(11,18,32,0) 0%,rgba(11,18,32,.96) 35%)}
.caption span{font-size:34px;line-height:1.35;text-align:center;color:#f4f7fb;background:rgba(0,0,0,.45);padding:10px 22px;border-radius:12px;opacity:0}
.titlecard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 200px}
.titlecard .series{font-size:30px;color:var(--accent);letter-spacing:.25em;text-transform:uppercase;font-weight:600;margin-bottom:28px}
.titlecard h1{font-size:92px;font-weight:800;line-height:1.08;letter-spacing:-.015em;max-width:1500px}
.titlecard h1 span{display:inline-block;margin:0 .14em;opacity:0}
.titlecard .tline{height:6px;width:260px;border-radius:3px;background:var(--accent);margin:34px auto 0;transform-origin:center}
.titlecard .sub{font-size:36px;color:var(--muted);margin-top:28px}
.titlecard .epnum{font-size:26px;color:var(--muted);margin-top:50px;letter-spacing:.1em}
.titlecard .cite{position:absolute;bottom:60px;left:0;right:0;text-align:center;font-size:21px;color:var(--muted)}
.outro h1{font-size:72px}
.rv{opacity:0}
/* cards */
.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:36px}
.cards.one{grid-template-columns:1fr}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:22px 24px;opacity:0;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.card h3{font-size:30px;font-weight:600;color:var(--accent);margin-bottom:8px}
.card p{font-size:22px;color:var(--muted);line-height:1.35}
/* timeline */
.tl{padding:40px 40px 40px 60px;position:relative;display:flex;flex-direction:column;justify-content:center;height:100%;gap:28px}
.tl-line{position:absolute;left:92px;top:40px;bottom:40px;width:3px;background:linear-gradient(180deg,var(--accent2),var(--accent));transform-origin:top;transform:scaleY(0)}
.tli{position:relative;padding-left:70px;opacity:0}
.tli i{position:absolute;left:24px;top:14px;width:20px;height:20px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 6px var(--panel)}
.tli b{font-size:30px;font-weight:800;color:var(--accent2);display:block}
.tli span{font-size:23px;color:var(--muted);line-height:1.3}
/* compare */
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:36px;height:100%}
.col{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:26px;opacity:0}
.col h3{font-size:28px;font-weight:700;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid var(--line)}
.col.l h3{color:var(--accent)}.col.r h3{color:var(--accent2)}
.col li{list-style:none;font-size:23px;color:var(--text);line-height:1.3;padding:11px 0 11px 26px;position:relative;opacity:0}
.col li::before{content:"";position:absolute;left:4px;top:20px;width:9px;height:9px;border-radius:50%;background:var(--muted)}
/* bigfact */
.bf{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:50px}
.bf b{font-size:54px;font-weight:800;line-height:1.15;color:var(--accent);opacity:0;text-shadow:0 0 30px rgba(45,212,191,.35)}
.bf span{font-size:26px;color:var(--muted);margin-top:26px;line-height:1.35;opacity:0}
svg text{font-family:Inter,system-ui,sans-serif}
`;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
const at = (v, fx) => `data-at="${v}"${fx?` data-fx="${fx}"`:''}`;

// ---------- visuals ----------
function vCards(v){
  const one = v.items.length <= 3;
  return `<div class="cards${one?' one':''}">${v.items.map((i,k)=>`<div class="card" ${at(i.at,'pop')} data-float="${k}"><h3>${esc(i.title)}</h3><p>${esc(i.sub)}</p></div>`).join('')}</div>`;
}
function vTimeline(v){
  const first = v.items[0].at, last = v.items[v.items.length-1].at;
  return `<div class="tl"><div class="tl-line" data-line-from="${first}" data-line-to="${last}"></div>${v.items.map(i=>`<div class="tli" ${at(i.at,'right')}><i data-pulse="1"></i><b>${esc(i.label)}</b><span>${esc(i.sub)}</span></div>`).join('')}</div>`;
}
function vCompare(v){
  const a = v.at||0.1;
  const col=(c,cls,a0,fx)=>`<div class="col ${cls}" ${at(a0,fx)}><h3>${esc(c.title)}</h3><ul>${c.rows.map((r,i)=>`<li ${at(a0+0.05+i*0.04,'left')}>${esc(r)}</li>`).join('')}</ul></div>`;
  return `<div class="cmp">${col(v.left,'l',a,'left')}${col(v.right,'r',a+0.08,'right')}</div>`;
}
function vBigfact(v){
  return `<div class="bf"><b ${at(0.12,'pop')} data-breathe="1">${esc(v.text)}</b><span ${at(0.35,'up')}>${esc(v.sub||'')}</span></div>`;
}
function vPathway(v){
  const W=746,H=760, bw=200,bh=64;
  const pos = {}; v.nodes.forEach(n=>{pos[n.id]={x:40+n.x*(W-80), y:40+n.y*(H-80)};});
  let s = `<svg viewBox="0 0 ${W} ${H}"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#2dd4bf"/></marker></defs>`;
  for(const e of v.edges){
    const a=pos[e.from], b=pos[e.to];
    const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy), ux=dx/L, uy=dy/L;
    const ax=Math.abs(ux)>Math.abs(uy)? bw/2+6 : bh/2+6;
    const x1=a.x+ux*ax, y1=a.y+uy*ax, x2=b.x-ux*(ax+4), y2=b.y-uy*(ax+4);
    const lp=(e.lpos!=null?e.lpos:0.5); const mx=x1+(x2-x1)*lp, my=y1+(y2-y1)*lp;
    s += `<g ${at(e.at,'none')}><line class="draw" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2dd4bf" stroke-width="3" marker-end="url(#arr)"/>`;
    for(let k=0;k<2;k++) s += `<circle r="5" fill="#7df3e4" data-flow="${k}" data-x1="${x1}" data-y1="${y1}" data-x2="${x2}" data-y2="${y2}"/>`;
    if(e.label){ const tw=e.label.length*11+20; s+=`<g ${at(e.at+0.03,'pop')} data-origin="${mx} ${my}"><rect x="${mx-tw/2}" y="${my-16}" width="${tw}" height="32" rx="8" fill="#0b1220" stroke="#243354"/><text x="${mx}" y="${my+7}" text-anchor="middle" font-size="19" fill="#f59e0b" font-weight="600">${esc(e.label)}</text></g>`; }
    s += `</g>`;
  }
  for(const n of v.nodes){
    const p=pos[n.id]; const w=Math.max(bw, n.label.length*13+30);
    s += `<g ${at(n.at,'pop')} data-origin="${p.x} ${p.y}"><rect x="${p.x-w/2}" y="${p.y-bh/2}" width="${w}" height="${bh}" rx="14" fill="#101a2e" stroke="#2dd4bf" stroke-width="2"/><text x="${p.x}" y="${p.y+8}" text-anchor="middle" font-size="24" font-weight="600" fill="#e8eef7">${esc(n.label)}</text></g>`;
  }
  return s+`</svg>`;
}
function vBrain(v){
  const W=746,H=760;
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  s+=`<g transform="translate(30,90) scale(1.05)">
  <path class="draw" data-draw-s="0.2" data-draw-d="1.6" d="M120 300 C 60 240, 70 120, 170 80 C 230 20, 400 10, 500 60 C 600 90, 650 180, 620 280 C 610 330, 560 360, 520 370 C 480 400, 400 420, 320 400 C 250 420, 170 390, 140 350 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path class="draw" data-draw-s="0.9" data-draw-d="0.9" d="M470 360 C 520 350, 600 360, 610 410 C 615 450, 560 480, 500 465 C 460 455, 440 420, 470 360 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path class="draw" data-draw-s="1.2" data-draw-d="0.8" d="M400 405 C 420 440, 440 500, 430 560 L 395 560 C 385 500, 370 450, 360 410 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <path class="draw" data-draw-s="1.4" data-draw-d="1.0" d="M190 130 C 260 110, 300 160, 360 140 C 420 120, 470 160, 540 150" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  <path class="draw" data-draw-s="1.6" data-draw-d="1.0" d="M160 220 C 240 200, 300 250, 380 230 C 440 215, 500 250, 580 230" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  <path class="draw" data-draw-s="1.8" data-draw-d="0.8" d="M200 310 C 260 290, 320 330, 400 310" fill="none" stroke="#60a5fa" stroke-opacity=".45" stroke-width="3"/>
  </g>`;
  v.regions.forEach((r,i)=>{
    const x=r.x*W, y=r.y*H; const hi=r.level==='high';
    const col = hi? '#f59e0b' : '#9fb0c9'; const rad = hi? 22:14;
    s+=`<g ${at(r.at,'pop')} data-origin="${x} ${y}"><circle cx="${x}" cy="${y}" r="${rad+6}" fill="none" stroke="${col}" stroke-width="3" data-ripple="${i}" data-r0="${rad+6}"/><circle cx="${x}" cy="${y}" r="${rad+6}" fill="none" stroke="${col}" stroke-width="2" data-ripple="${i+0.5}" data-r0="${rad+6}"/><circle cx="${x}" cy="${y}" r="${rad}" fill="${col}" fill-opacity=".9"/>
    <text x="${x}" y="${y+rad+36}" text-anchor="middle" font-size="22" font-weight="600" fill="#e8eef7">${esc(r.label)}</text><text x="${x}" y="${y+rad+62}" text-anchor="middle" font-size="18" fill="${col}">${hi?'high density':'low density'}</text></g>`;
  });
  s+=`<g ${at(0.02,'up')}><circle cx="44" cy="44" r="12" fill="#f59e0b"/><text x="66" y="51" font-size="20" fill="#9fb0c9">CB1 receptor density: high</text><circle cx="360" cy="44" r="9" fill="#9fb0c9"/><text x="380" y="51" font-size="20" fill="#9fb0c9">low</text></g>`;
  return s+`</svg>`;
}
function vReceptor(v){
  // stages: 0 membrane, 1 ligand docks, 2 G protein engages, 3 effect
  const W=746,H=760; const my=330;
  let s=`<svg viewBox="0 0 ${W} ${H}"><defs><marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#60a5fa"/></marker></defs>`;
  s+=`<g data-stage="0">`;
  for(let x=20;x<W;x+=34){ s+=`<g data-lipid="${x}"><circle cx="${x}" cy="${my-38}" r="12" fill="#243354"/><line x1="${x}" y1="${my-26}" x2="${x}" y2="${my-4}" stroke="#243354" stroke-width="3"/>`;
    s+=`<circle cx="${x}" cy="${my+38}" r="12" fill="#243354"/><line x1="${x}" y1="${my+26}" x2="${x}" y2="${my+4}" stroke="#243354" stroke-width="3"/></g>`; }
  s+=`<text x="24" y="${my-70}" font-size="20" fill="#9fb0c9">outside the cell</text><text x="24" y="${my+92}" font-size="20" fill="#9fb0c9">inside the cell</text>`;
  s+=`<rect x="290" y="${my-80}" width="200" height="160" rx="30" fill="#2dd4bf" fill-opacity="0" data-rglow="1"/>`;
  for(let i=0;i<7;i++){ const x=300+i*26; s+=`<rect x="${x}" y="${my-70}" width="18" height="140" rx="9" fill="#2dd4bf" fill-opacity="${0.55+0.06*i}" data-helix="${i}"/>`; }
  s+=`<text x="378" y="${my+112}" text-anchor="middle" font-size="22" font-weight="600" fill="#2dd4bf">CB1 receptor (7 transmembrane helices)</text></g>`;
  // ligand (moves)
  s+=`<g data-stage="1" data-ligand="1"><g transform="translate(378 ${my-120})"><polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="#f59e0b"/><text x="0" y="-50" text-anchor="middle" font-size="22" font-weight="600" fill="#f59e0b">cannabinoid ligand</text></g></g>`;
  // G protein (slides in)
  s+=`<g data-stage="2" data-gprot="1"><circle cx="330" cy="${my+180}" r="38" fill="#60a5fa"/><text x="330" y="${my+188}" text-anchor="middle" font-size="26" font-weight="700" fill="#0b1220">α</text><circle cx="400" cy="${my+170}" r="28" fill="#93c5fd"/><text x="400" y="${my+178}" text-anchor="middle" font-size="22" font-weight="700" fill="#0b1220">β</text><circle cx="446" cy="${my+200}" r="20" fill="#bfdbfe"/><text x="446" y="${my+207}" text-anchor="middle" font-size="18" font-weight="700" fill="#0b1220">γ</text><text x="330" y="${my+250}" text-anchor="middle" font-size="22" fill="#60a5fa" font-weight="600">Gi/o protein</text></g>`;
  // effect: arrow draws, cAMP dots fade out
  s+=`<g data-stage="3"><path class="draw" data-draw-s="0" data-draw-d="0.8" d="M286 ${my+185} L 196 ${my+185}" stroke="#60a5fa" stroke-width="3" marker-end="url(#arr2)"/><rect x="40" y="${my+150}" width="150" height="70" rx="14" fill="#101a2e" stroke="#fb7185" stroke-width="2"/><text x="115" y="${my+180}" text-anchor="middle" font-size="20" font-weight="600" fill="#fb7185">adenylyl</text><text x="115" y="${my+204}" text-anchor="middle" font-size="20" font-weight="600" fill="#fb7185">cyclase ↓</text><text x="115" y="${my+260}" text-anchor="middle" font-size="24" fill="#e8eef7" font-weight="600">cAMP ↓</text>`;
  for(let i=0;i<14;i++){ const x=60+ (i*53)%620, y=my+290+((i*37)%110); s+=`<circle cx="${x}" cy="${y}" r="6" fill="#fb7185" data-camp="${i}"/>`; }
  s+=`</g>`;
  return s+`</svg>`;
}
function vSynapse(v){
  // stages: base 0, depol 1, release 2, bind 3, inhibit 4
  const W=746,H=760;
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  s+=`<g data-stage="0"><path d="M220 40 L 520 40 L 520 230 C 520 290, 220 290, 220 230 Z" fill="#162244" stroke="#60a5fa" stroke-width="4"/>
  <text x="370" y="80" text-anchor="middle" font-size="24" font-weight="600" fill="#60a5fa">presynaptic terminal</text>
  <path d="M160 440 L 580 440 L 580 720 L 160 720 Z" fill="#162244" stroke="#2dd4bf" stroke-width="4"/>
  <text x="370" y="690" text-anchor="middle" font-size="24" font-weight="600" fill="#2dd4bf">postsynaptic neuron</text>
  <text x="640" y="365" font-size="20" fill="#9fb0c9">synaptic</text><text x="640" y="390" font-size="20" fill="#9fb0c9">cleft</text>`;
  [[290,140],[340,180],[400,150],[450,185],[370,110]].forEach(([x,y],i)=>{ s+=`<circle cx="${x}" cy="${y}" r="20" fill="#0b1220" stroke="#9fb0c9" stroke-width="3" data-ves="${i}"/>`; });
  s+=`<text x="370" y="236" text-anchor="middle" font-size="18" fill="#9fb0c9">vesicles with neurotransmitter</text>`;
  for(let i=0;i<6;i++) s+=`<circle r="5" fill="#9fb0c9" data-nt="${i}"/>`;
  for(const x of [260,480]) s+=`<rect x="${x-14}" y="262" width="28" height="46" rx="8" fill="#2dd4bf" data-cb1="${x}"/>`;
  s+=`<text x="260" y="332" text-anchor="middle" font-size="18" fill="#2dd4bf" font-weight="600">CB1</text><text x="480" y="332" text-anchor="middle" font-size="18" fill="#2dd4bf" font-weight="600">CB1</text>`;
  s+=`<rect x="356" y="266" width="30" height="40" rx="6" fill="#fb7185"/><text x="371" y="332" text-anchor="middle" font-size="18" fill="#fb7185" font-weight="600">Ca²⁺ channel</text></g>`;
  // stage 1: Ca2+ flowing into postsynaptic cell
  s+=`<g data-stage="1"><text x="370" y="590" text-anchor="middle" font-size="24" fill="#f59e0b" font-weight="700">activation → Ca²⁺ ↑</text>`;
  for(let i=0;i<7;i++) s+=`<text font-size="20" fill="#f59e0b" text-anchor="middle" data-ca="${i}">Ca²⁺</text>`;
  s+=`<text x="370" y="640" text-anchor="middle" font-size="20" fill="#e8eef7">DAGL makes 2-AG from membrane lipids</text></g>`;
  // stage 2: 2-AG particles travel upward
  s+=`<g data-stage="2">`;
  for(let i=0;i<8;i++) s+=`<circle r="9" fill="#f59e0b" data-ag="${i}"/>`;
  s+=`<text x="470" y="420" font-size="20" fill="#f59e0b" font-weight="600">2-AG</text>
  <text x="40" y="380" font-size="18" fill="#f59e0b">retrograde:</text><text x="40" y="404" font-size="18" fill="#f59e0b">post → pre</text></g>`;
  // stage 3: bound
  s+=`<g data-stage="3"><circle cx="260" cy="250" r="11" fill="#f59e0b" data-bound="0"/><circle cx="480" cy="250" r="11" fill="#f59e0b" data-bound="1"/><text x="370" y="30" text-anchor="middle" font-size="20" fill="#f59e0b" font-weight="600">2-AG bound to presynaptic CB1 → Gi/o</text></g>`;
  // stage 4: inhibition
  s+=`<g data-stage="4"><line class="draw" data-draw-s="0" data-draw-d="0.4" x1="356" y1="266" x2="386" y2="306" stroke="#e8eef7" stroke-width="4"/><line class="draw" data-draw-s="0.3" data-draw-d="0.4" x1="386" y1="266" x2="356" y2="306" stroke="#e8eef7" stroke-width="4"/>
  <g data-stagepop="1"><text x="548" y="120" font-size="20" fill="#fb7185" font-weight="600">Ca²⁺ entry ↓</text><text x="548" y="148" font-size="20" fill="#fb7185" font-weight="600">K⁺ channels open</text><text x="548" y="176" font-size="20" fill="#fb7185" font-weight="600">release ↓</text></g>
  <text x="370" y="740" text-anchor="middle" font-size="20" fill="#9fb0c9">GABA terminal → DSI · glutamate terminal → DSE</text></g>`;
  return s+`</svg>`;
}
const VIS = {cards:vCards, timeline:vTimeline, compare:vCompare, bigfact:vBigfact, pathway:vPathway, brain:vBrain, receptor:vReceptor, synapse:vSynapse};

function words(h){ return h.split(' ').map((w,i)=>`<span data-at-s="${(0.5+i*0.12).toFixed(2)}" data-fx="word">${esc(w)}</span>`).join(''); }

function sceneHtml(sc){
  if(sc.kind==='title' || sc.kind==='outro'){
    const isT = sc.kind==='title';
    return `<div class="scene" id="${sc.id}" data-kind="${sc.kind}"><div class="titlecard${isT?'':' outro'}">
      <div class="series rv" data-at-s="0.1" data-fx="up">${esc(ep.series)}</div>
      <h1>${words(sc.heading)}</h1>
      <div class="tline rv" data-at-s="${isT?1.6:1.2}" data-fx="line"></div>
      ${isT?`<div class="sub rv" data-at-s="2.0" data-fx="up">${esc(ep.subtitle)}</div><div class="epnum rv" data-at-s="2.5" data-fx="up">EPISODE ${ep.episode} OF 5</div>`:''}
      <div class="cite rv" data-at-s="${isT?3.0:2.0}" data-fx="up">${isT?'Based on Mechoulam, Hanuš, Pertwee &amp; Howlett (2014), Nature Reviews Neuroscience 15:757–764':'Source: Mechoulam R, Hanuš LO, Pertwee R, Howlett AC. Nat Rev Neurosci 2014;15:757–764 · doi:10.1038/nrn3811'}</div>
    </div><div class="caption"><span></span></div></div>`;
  }
  const vis = sc.visual && VIS[sc.visual.type] ? VIS[sc.visual.type](sc.visual) : '';
  const stages = sc.visual && sc.visual.stages ? JSON.stringify(sc.visual.stages) : 'null';
  return `<div class="scene" id="${sc.id}" data-kind="content" data-stages='${stages}' data-vtype="${sc.visual?sc.visual.type:''}">
    <div class="content"><h1 class="rv" data-at-s="0.1" data-fx="up">${esc(sc.heading)}</h1><div class="hline rv" data-at-s="0.5" data-fx="line"></div><ul class="bullets">${(sc.bullets||[]).map(b=>`<li data-at="${b.at}" data-fx="left"><i></i>${esc(b.text)}</li>`).join('')}</ul></div>
    <div class="visual rv" data-at-s="0.25" data-fx="panel">${vis}</div>
    <div class="caption"><span></span></div></div>`;
}

// background particles (deterministic seed)
const NP = 42, seedP = [];
{ let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < NP; i++) seedP.push({ x: rnd()*W, y: rnd()*H, vx: (rnd()-0.5)*18, vy: (rnd()-0.5)*12, r: 1.5+rnd()*2.5, ph: rnd()*6.28 }); }

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="blobs"><div class="blob b1" id="blob1"></div><div class="blob b2" id="blob2"></div></div>
<svg id="bg" viewBox="0 0 ${W} ${H}"><g id="bglines"></g><g id="bgdots">${seedP.map((p,i)=>`<circle id="bp${i}" r="${p.r}" fill="#7dd3fc" fill-opacity=".35"/>`).join('')}</g></svg>
<div class="topbar"><div class="rv" data-at-s="0.2" data-fx="left-abs"><b>${esc(ep.series)}</b></div><div class="rv" data-at-s="0.4" data-fx="right-abs"><span class="ep">Episode ${ep.episode}</span> &nbsp;·&nbsp; ${esc(ep.title)}</div></div>
<div class="progress"><i id="prog"></i></div>
${ep.scenes.map(sceneHtml).join('\n')}
<script>
const TIMING = ${JSON.stringify(timing)};
const SEEDS = ${JSON.stringify(seedP)};
const W=${W}, H=${H};
const TOTAL = TIMING.total;
const FADE = 0.5;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const easeOut=x=>{x=clamp(x,0,1);return 1-Math.pow(1-x,3);};
const easeInOut=x=>{x=clamp(x,0,1);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
const backOut=x=>{x=clamp(x,0,1);const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);};
const frac=x=>x-Math.floor(x);

// prepare stroke drawing lengths
document.querySelectorAll('.draw').forEach(p=>{ const L=p.getTotalLength(); p.dataset.len=L; p.style.strokeDasharray=L; p.style.strokeDashoffset=L; });

function applyFx(el, k, fx){
  const o=easeOut(k), b=backOut(k);
  el.style.opacity = clamp(k*1.6, 0, 1);
  switch(fx){
    case 'left': el.style.transform = 'translateX(' + (-36*(1-o)) + 'px)'; break;
    case 'right': el.style.transform = 'translateX(' + (36*(1-o)) + 'px)'; break;
    case 'left-abs': el.style.transform = 'translateX(' + (-24*(1-o)) + 'px)'; break;
    case 'right-abs': el.style.transform = 'translateX(' + (24*(1-o)) + 'px)'; break;
    case 'up': el.style.transform = 'translateY(' + (26*(1-o)) + 'px)'; break;
    case 'word': el.style.transform = 'translateY(' + (40*(1-o)) + 'px) scale(' + (0.9+0.1*b) + ')'; break;
    case 'pop': { const org = el.getAttribute('data-origin');
      if(org){ const [ox,oy]=org.split(' '); el.setAttribute('transform', 'translate(' + ox + ' ' + oy + ') scale(' + Math.max(0.001,b) + ') translate(' + (-ox) + ' ' + (-oy) + ')'); }
      else if(!el.hasAttribute('data-float') && !el.hasAttribute('data-breathe')) el.style.transform = 'scale(' + (0.8+0.2*b) + ')'; break; }
    case 'line': el.style.transform = 'scaleX(' + o + ')'; break;
    case 'panel': el.style.transform = 'translateY(' + (30*(1-o)) + 'px) scale(' + (0.97+0.03*o) + ')'; break;
    default: break;
  }
}

function render(t){
  document.getElementById('prog').style.width = (100*t/TOTAL)+'%';
  // background: drifting blobs + particle network
  document.getElementById('blob1').style.transform = 'translate(' + (1100+160*Math.sin(t*0.09)) + 'px,' + (-350+120*Math.cos(t*0.07)) + 'px)';
  document.getElementById('blob2').style.transform = 'translate(' + (-250+140*Math.cos(t*0.06+1)) + 'px,' + (500+110*Math.sin(t*0.08+2)) + 'px)';
  const P=[]; for(let i=0;i<SEEDS.length;i++){ const s=SEEDS[i]; const x=((s.x+s.vx*t)%W+W)%W + 10*Math.sin(t*0.5+s.ph), y=((s.y+s.vy*t)%H+H)%H + 8*Math.cos(t*0.4+s.ph); P.push([x,y]); const c=document.getElementById('bp'+i); c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('fill-opacity', 0.2+0.2*Math.sin(t*1.3+s.ph)); }
  let lines=''; for(let i=0;i<P.length;i++) for(let j=i+1;j<P.length;j++){ const dx=P[i][0]-P[j][0], dy=P[i][1]-P[j][1]; const d=Math.hypot(dx,dy); if(d<170) lines += '<line x1="'+P[i][0]+'" y1="'+P[i][1]+'" x2="'+P[j][0]+'" y2="'+P[j][1]+'" stroke="#7dd3fc" stroke-opacity="'+(0.18*(1-d/170)).toFixed(3)+'" stroke-width="1"/>'; }
  document.getElementById('bglines').innerHTML = lines;
  document.querySelectorAll('.topbar [data-at-s]').forEach(x=>applyFx(x, (t-parseFloat(x.getAttribute('data-at-s')))/0.6, x.getAttribute('data-fx')));

  for(const ts of TIMING.scenes){
    const el = document.getElementById(ts.id);
    const start = ts.start, end = ts.start + ts.duration + TIMING.gap;
    if(t < start - FADE || t > end){ el.style.opacity = 0; continue; }
    let op = 1, ty = 0;
    if(t < start){ op = easeOut((t-(start-FADE))/FADE); ty = 24*(1-op); }
    else if(t > end - FADE){ const q = easeOut((t-(end-FADE))/FADE); op = 1-q; ty = -18*q; }
    el.style.opacity = op; el.style.transform = 'translateY(' + ty + 'px)';
    const local = Math.max(0, t - start);
    const p = Math.min(1, local / ts.duration);

    // staged visuals: determine current stage first (draw-on timings depend on it)
    const stagesAttr = el.getAttribute('data-stages');
    let cur = -1, since = 0, stageStart = {};
    const sinceStage = n => (stageStart[n]!=null ? local - stageStart[n] : since);
    if(stagesAttr && stagesAttr!=='null'){
      const st = JSON.parse(stagesAttr);
      const names = ['membrane','ligand','gprotein','effect'];
      const synNames = ['base','depol','release','bind','inhibit'];
      let curStart = 0; cur = 0; stageStart = {};
      for(const s of st){ const n = names.indexOf(s.state); const m = synNames.indexOf(s.state); const idx = n>=0? n : m; stageStart[idx] = s.at*ts.duration; if(p >= s.at){ cur = idx; curStart = s.at*ts.duration; } }
      since = local - curStart;
      el.querySelectorAll('[data-stage]').forEach(g=>{ const need=parseInt(g.getAttribute('data-stage')); g.style.opacity = need < cur ? 1 : (need===cur ? easeOut(since/0.5) : 0); });
    }

    // reveals
    el.querySelectorAll('[data-at],[data-at-s]').forEach(x=>{
      const a = x.hasAttribute('data-at-s') ? parseFloat(x.getAttribute('data-at-s')) : parseFloat(x.getAttribute('data-at')) * ts.duration;
      const dur = x.getAttribute('data-fx')==='word' ? 0.55 : 0.6;
      applyFx(x, (local - a)/dur, x.getAttribute('data-fx')||'up');
    });
    // active bullet highlight
    const lis = el.querySelectorAll('.bullets li'); let active=-1;
    lis.forEach((li,i)=>{ const a=parseFloat(li.getAttribute('data-at'))*ts.duration; if(local>=a) active=i; });
    lis.forEach((li,i)=>{ const dot=li.querySelector('i'); const isA=i===active;
      li.style.color = isA ? '#ffffff' : (i<active ? '#b9c6da' : '#e8eef7');
      const pulse = 0.5+0.5*Math.sin(t*4);
      dot.style.boxShadow = isA ? '0 0 0 ' + (4+6*pulse) + 'px rgba(45,212,191,' + (0.35-0.25*pulse) + ')' : 'none';
      dot.style.background = isA ? '#7df3e4' : '#2dd4bf';
    });
    // floating cards
    el.querySelectorAll('[data-float]').forEach(c=>{ const i=parseFloat(c.getAttribute('data-float')); const a=parseFloat(c.getAttribute('data-at'))*ts.duration; const k=clamp((local-a)/0.6,0,1); const b=backOut(k); c.style.transform='translateY('+(3*Math.sin(t*1.1+i*1.3)*k)+'px) scale('+(0.8+0.2*b)+')'; });
    // breathing bigfact
    el.querySelectorAll('[data-breathe]').forEach(c=>{ const a=parseFloat(c.getAttribute('data-at'))*ts.duration; const k=clamp((local-a)/0.6,0,1); const b=backOut(k); c.style.transform='scale('+((0.8+0.2*b)*(1+0.012*Math.sin(t*1.6)))+')'; c.style.textShadow='0 0 '+(24+14*Math.sin(t*1.6))+'px rgba(45,212,191,.45)'; });
    // timeline line growth + dot pulse
    el.querySelectorAll('.tl-line').forEach(l=>{ const f=parseFloat(l.getAttribute('data-line-from'))*ts.duration, to=parseFloat(l.getAttribute('data-line-to'))*ts.duration+0.6; l.style.transform='scaleY('+easeInOut((local-f)/Math.max(0.1,to-f))+')'; });
    el.querySelectorAll('[data-pulse]').forEach(d=>{ d.style.boxShadow='0 0 0 6px #141f36, 0 0 '+(6+8*(0.5+0.5*Math.sin(t*3)))+'px rgba(245,158,11,.7)'; });
    // stroke draw-on
    el.querySelectorAll('.draw').forEach(pth=>{
      const L=parseFloat(pth.dataset.len); let s0=0, d=0.7;
      if(pth.hasAttribute('data-draw-s')){ s0=parseFloat(pth.getAttribute('data-draw-s')); d=parseFloat(pth.getAttribute('data-draw-d')); }
      const grp = pth.closest('[data-at],[data-stage]');
      let ref = local;
      if(grp && grp.hasAttribute('data-stage')){ const need=parseInt(grp.getAttribute('data-stage')); ref = need<=cur ? sinceStage(need) : -99; }
      else if(grp && grp.hasAttribute('data-at')) ref = local - parseFloat(grp.getAttribute('data-at'))*ts.duration;
      pth.style.strokeDashoffset = L*(1-easeInOut((ref-s0)/d));
    });
    // flow particles along pathway edges
    el.querySelectorAll('[data-flow]').forEach(c=>{ const g=c.parentElement; const a=parseFloat(g.getAttribute('data-at'))*ts.duration; const k=parseFloat(c.getAttribute('data-flow'));
      const x1=+c.getAttribute('data-x1'),y1=+c.getAttribute('data-y1'),x2=+c.getAttribute('data-x2'),y2=+c.getAttribute('data-y2');
      const u=frac((local-a)*0.45+k*0.5); c.setAttribute('cx',x1+(x2-x1)*u); c.setAttribute('cy',y1+(y2-y1)*u); c.setAttribute('fill-opacity', local>a+0.7 ? Math.sin(u*Math.PI) : 0); });
    // ripples (brain)
    el.querySelectorAll('[data-ripple]').forEach(c=>{ const g=c.parentElement; const a=parseFloat(g.getAttribute('data-at'))*ts.duration; const r0=+c.getAttribute('data-r0'); const ph=parseFloat(c.getAttribute('data-ripple'));
      const u=frac((local-a)*0.5+ph*0.37); const vis=local>a+0.4; c.setAttribute('r', r0+u*34); c.setAttribute('stroke-opacity', vis ? (0.7*(1-u)).toFixed(3) : 0); });

    if(cur>=0){
      const vt = el.getAttribute('data-vtype');
      if(vt==='receptor'){
        const my=330;
        el.querySelectorAll('[data-lipid]').forEach(g=>{ const x=+g.getAttribute('data-lipid'); g.setAttribute('transform','translate(0,'+(2.5*Math.sin(t*1.8+x*0.05))+')'); });
        const lig = el.querySelector('[data-ligand] > g');
        if(lig){ let y=my-260, x=378, rot=0; if(cur>=1){ const s1=sinceStage(1); const k=easeInOut(s1/1.4); y=(my-260)+140*k; if(s1<1.4){ x+=6*Math.sin(s1*6)*(1-k); rot=8*Math.sin(s1*5)*(1-k); } } lig.setAttribute('transform','translate('+x+' '+y+') rotate('+rot+')'); }
        const docked = cur>=1 && sinceStage(1)>1.2;
        const glow = el.querySelector('[data-rglow]'); if(glow) glow.setAttribute('fill-opacity', docked ? 0.12+0.1*Math.sin(t*3) : 0);
        el.querySelectorAll('[data-helix]').forEach((h,i)=>{ h.setAttribute('transform','translate('+(docked ? 1.5*Math.sin(t*3+i*0.8) : 0)+',0)'); });
        const gp = el.querySelector('[data-gprot]'); if(gp){ const k=cur>=2?easeOut(sinceStage(2)/0.9):0; gp.setAttribute('transform','translate('+(-120*(1-k))+','+(60*(1-k))+')'); }
        el.querySelectorAll('[data-camp]').forEach(c=>{ const i=+c.getAttribute('data-camp'); let o=0; if(cur>=3){ o = 0.9*(1-clamp((sinceStage(3)-0.6-i*0.18)/0.5,0,1)); } c.setAttribute('fill-opacity', o); c.setAttribute('transform','translate(0,'+(3*Math.sin(t*2+i))+')'); });
      }
      if(vt==='synapse'){
        const inhibited = cur>=4;
        el.querySelectorAll('[data-ves]').forEach((c,i)=>{ c.setAttribute('transform','translate('+(2*Math.sin(t*2.3+i))+','+(2*Math.cos(t*1.9+i*1.7))+')'); c.setAttribute('stroke', inhibited ? '#4b5a74' : '#9fb0c9'); });
        el.querySelectorAll('[data-nt]').forEach(c=>{ const i=+c.getAttribute('data-nt'); const rate = inhibited ? 0.18 : 0.55; const u=frac(t*rate+i/6); const show = inhibited ? (i%3===0) : true; c.setAttribute('cx', 300+ i*28 + 6*Math.sin(t*3+i)); c.setAttribute('cy', 300+140*u); c.setAttribute('fill-opacity', show ? Math.sin(u*Math.PI)*0.9 : 0); });
        el.querySelectorAll('[data-ca]').forEach(c=>{ const i=+c.getAttribute('data-ca'); const u=frac(sinceStage(1)*0.35+i*0.14); const x=190+ i*60 + 8*Math.sin(t*2+i); c.setAttribute('x',x); c.setAttribute('y', 446+ u*100); c.setAttribute('fill-opacity', cur>=1 ? Math.sin(u*Math.PI) : 0); });
        el.querySelectorAll('[data-ag]').forEach(c=>{ const i=+c.getAttribute('data-ag'); const s2=sinceStage(2); const u=frac(s2*0.3+i*0.125); const side = i%2 ? 480 : 260; const x = 370 + (side-370)*easeInOut(u) + 10*Math.sin(t*2.2+i); const y = 438 - (438-262)*u; c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('fill-opacity', cur>=2 ? clamp(s2,0,1) * (cur>=3 ? 0.8 : 1) * clamp((1-u)*4,0,1) : 0); });
        el.querySelectorAll('[data-cb1]').forEach(r=>{ const glow = cur>=3; r.setAttribute('fill', glow ? '#7df3e4' : '#2dd4bf'); r.setAttribute('transform', glow ? 'translate(0,'+(1.5*Math.sin(t*5))+')' : ''); r.style.filter = glow ? 'drop-shadow(0 0 '+(6+6*Math.sin(t*4))+'px rgba(125,243,228,.95))' : 'none'; });
        el.querySelectorAll('[data-bound]').forEach(c=>{ const k=cur>=3?backOut(sinceStage(3)/0.5):0; const cx=+c.getAttribute('cx'), cy=+c.getAttribute('cy'); c.setAttribute('transform','translate('+cx+' '+cy+') scale('+Math.max(0.001,k)+') translate('+(-cx)+' '+(-cy)+')'); });
        el.querySelectorAll('[data-stagepop]').forEach(g=>{ const k=cur>=4?easeOut((sinceStage(4)-0.5)/0.5):0; g.setAttribute('transform','translate('+(20*(1-k))+',0)'); g.setAttribute('opacity',k); });
      }
    }
    // caption with slide-in per chunk
    const cap = el.querySelector('.caption span');
    let text = '', cs = 0;
    for(const c of ts.captions){ if(local >= c.start && local < c.end){ text = c.text; cs = c.start; break; } }
    cap.textContent = text;
    const ck = easeOut((local-cs)/0.3);
    cap.style.opacity = text ? ck : 0;
    cap.style.transform = 'translateY(' + (10*(1-ck)) + 'px)';
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
      for (const frac of [0.02, 0.1, 0.5, 0.95]) {
        const t = ts.start + ts.duration * frac;
        await page.evaluate((t) => window.render(t), t);
        await page.screenshot({ path: path.join(dir, `${ts.id}-${frac}.png`) });
      }
    }
    await browser.close(); console.log('preview written to', dir); return;
  }

  const t0s = CLIP ? CLIP[0] : 0, t1s = CLIP ? CLIP[1] : timing.total;
  const nFrames = Math.ceil((t1s - t0s) * FPS);
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (!CLIP) ffArgs.push('-i', path.resolve(audioDir, 'narration.wav'));
  ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-r', String(FPS));
  if (!CLIP) ffArgs.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
  ffArgs.push('-movflags', '+faststart', outPath);
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < nFrames; i++) {
    const t = t0s + i / FPS;
    await page.evaluate((t) => window.render(t), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 500 === 0) console.log(`${ep.id}: frame ${i}/${nFrames} (${((Date.now()-t0)/1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  await browser.close();
  console.log(`${ep.id}: wrote ${outPath} (${((t1s-t0s)/60).toFixed(2)} min, ${nFrames} frames, ${((Date.now()-t0)/1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
