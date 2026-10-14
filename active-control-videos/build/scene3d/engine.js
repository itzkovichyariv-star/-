// 3D scene engine for "The Science Behind Cannabis" (v2: directed camera, cause-and-effect actions).
// Every frame is a pure function of time t: window.renderAt(t) returns a JPEG data URL.
// The driver (render3d.js) calls window.init({spec, molecules}) once, then renderAt for each frame.
import * as THREE from '../../assets/vendor/three.module.min.js';

const W = 1920, H = 1080;
const FADE = 0.7;
let renderer, canvas, SPEC, MOLS, fadeMesh, fadeScene, fadeCam, vignette;
const built = {};

// ---------- utilities ----------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = x => { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
const easeInOut = x => { x = clamp(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const backOut = x => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const frac = x => x - Math.floor(x);
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const col = c => typeof c === 'string' ? parseInt(c) : c;

const COL = { bg: 0x060b16, teal: 0x2dd4bf, amber: 0xf59e0b, rose: 0xfb7185, sky: 0x60a5fa, text: 0xe8eef7, muted: 0x9fb0c9, violet: 0xa78bfa, green: 0x4ade80 };
const ELEM = { C: { c: 0xd7dee9, r: 0.40 }, H: { c: 0xf8fafc, r: 0.20 }, O: { c: 0xfb7185, r: 0.38 }, N: { c: 0x60a5fa, r: 0.38 }, P: { c: 0xf59e0b, r: 0.42 }, S: { c: 0xfde047, r: 0.42 } };
const PALETTES = {
  warm: { bg: 0x0b0d16, nebula: [0xf59e0b, 0x2dd4bf, 0x7c3aed], rim: 0xf59e0b, fill: 0x60a5fa },
  green: { bg: 0x061010, nebula: [0x4ade80, 0x2dd4bf, 0xf59e0b], rim: 0x4ade80, fill: 0x60a5fa },
  blue: { bg: 0x060b18, nebula: [0x60a5fa, 0x2dd4bf, 0xa78bfa], rim: 0x2dd4bf, fill: 0x60a5fa },
  violet: { bg: 0x0a0716, nebula: [0xa78bfa, 0xfb7185, 0x60a5fa], rim: 0xa78bfa, fill: 0xf59e0b },
  teal: { bg: 0x05100f, nebula: [0x2dd4bf, 0xfb7185, 0x60a5fa], rim: 0x2dd4bf, fill: 0xfb7185 },
};

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c); return glowTex;
}
function glow(color, size, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: getGlowTex(), color: col(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s;
}
function label(text, { size = 1.6, color = '#e8eef7', weight = 600, px = 64, bg = null, pad = 0.35 } = {}) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = `${weight} ${px}px Inter`; const w = Math.ceil(g.measureText(text).width) + px * pad * 2, h = Math.ceil(px * 1.5);
  c.width = w; c.height = h; const g2 = c.getContext('2d');
  if (bg) { g2.fillStyle = bg; const r = h * 0.3; g2.beginPath(); g2.roundRect(0, 0, w, h, r); g2.fill(); }
  g2.font = `${weight} ${px}px Inter`; g2.fillStyle = color; g2.textBaseline = 'middle'; g2.textAlign = 'center';
  g2.shadowColor = 'rgba(0,0,0,.8)'; g2.shadowBlur = 12; g2.fillText(text, w / 2, h / 2 + px * 0.04);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const s = new THREE.Sprite(m); s.scale.set(size * w / h, size, 1); s.renderOrder = 10; s.userData.isLabel = true; return s;
}
function setOpacity(obj, o) { obj.traverse(n => { if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach(m => { m.transparent = true; m.opacity = o * (m.userData.baseOpacity ?? 1); }); } }); }
function popIn(obj, k) { const s = Math.max(0.001, backOut(k)); obj.scale.setScalar(s * (obj.userData.baseScale || 1)); obj.visible = k > 0; }

// ---------- builders ----------
function space(n = 1600, spread = 140, color = 0x7dd3fc, size = 0.9, seed = 3, opacity = 0.55) {
  const r = rng(seed); const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) p[i] = (r() - 0.5) * spread;
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color, size, map: getGlowTex(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(g, m); pts.userData.spin = 0.012; return pts;
}
function nebula(pal, seed = 11) {
  const g = new THREE.Group(); const r = rng(seed);
  for (let i = 0; i < 6; i++) { const c = pal.nebula[i % pal.nebula.length]; const s = glow(c, 120 + r() * 160, 0.05 + r() * 0.05); s.position.set((r() - .5) * 260, (r() - .5) * 120, -90 - r() * 120); s.userData = { ph: r() * 6.28, sp: 0.02 + r() * 0.03, x0: s.position.x }; g.add(s); }
  g.userData.update = (t) => { g.children.forEach((s, i) => { s.position.x = s.userData.x0 + Math.sin(t * s.userData.sp + s.userData.ph) * 12; s.material.rotation = t * 0.01 * (i % 2 ? 1 : -1); s.material.opacity = (0.06 + 0.03 * Math.sin(t * 0.1 + s.userData.ph)); }); };
  return g;
}
function lights(scene, pal) {
  scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0b1220, 0.9));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(8, 14, 10); scene.add(d);
  const p = new THREE.PointLight(pal.rim, 40, 120); p.position.set(-18, 6, -8); scene.add(p);
  const f = new THREE.PointLight(pal.fill, 20, 120); f.position.set(16, -8, 14); scene.add(f);
}
const geoCache = {};
function sphereGeo(seg = 14) { return geoCache['s' + seg] || (geoCache['s' + seg] = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 4))); }
function cylGeo() { return geoCache.cyl || (geoCache.cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1)); }

function molecule(name, { scale = 1, fragments = null, hideH = false, tint = null, seg = 14 } = {}) {
  const data = MOLS[name]; if (!data) throw new Error('no molecule ' + name);
  const root = new THREE.Group(); root.userData.baseScale = scale; root.scale.setScalar(scale);
  const atoms = data.atoms, bonds = data.bonds;
  const parts = fragments || [atoms.map((_, i) => i)];
  const partOf = {}; parts.forEach((p, k) => p.forEach(i => partOf[i] = k));
  root.userData.parts = [];
  parts.forEach((idxs, k) => {
    const g = new THREE.Group(); root.add(g); root.userData.parts.push(g);
    const byEl = {}; idxs.forEach(i => { const el = atoms[i][0]; if (hideH && el === 'H') return; (byEl[el] = byEl[el] || []).push(i); });
    const d = new THREE.Object3D();
    for (const el in byEl) {
      const e = ELEM[el] || ELEM.C; const list = byEl[el];
      const mat = new THREE.MeshPhongMaterial({ color: tint && el === 'C' ? col(tint) : e.c, shininess: 70, specular: 0x334155 });
      const im = new THREE.InstancedMesh(sphereGeo(el === 'H' ? 8 : seg), mat, list.length);
      list.forEach((i, n) => { const a = atoms[i]; d.position.set(a[1], a[2], a[3]); d.scale.setScalar(e.r); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
      g.add(im);
    }
    const bl = bonds.filter(b => partOf[b[0]] === k && partOf[b[1]] === k && !(hideH && (atoms[b[0]][0] === 'H' || atoms[b[1]][0] === 'H')));
    if (bl.length) {
      const mat = new THREE.MeshPhongMaterial({ color: 0x8b9bb4, shininess: 30 });
      const im = new THREE.InstancedMesh(cylGeo(), mat, bl.length);
      bl.forEach((b, n) => {
        const a = atoms[b[0]], c = atoms[b[1]]; const pa = V3(a[1], a[2], a[3]), pc = V3(c[1], c[2], c[3]);
        const mid = pa.clone().add(pc).multiplyScalar(0.5), dir = pc.clone().sub(pa); const len = dir.length();
        d.position.copy(mid); d.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize()); d.scale.set(b[2] >= 2 ? 0.13 : 0.1, len, b[2] >= 2 ? 0.13 : 0.1); d.updateMatrix(); im.setMatrixAt(n, d.matrix);
      });
      g.add(im);
    }
    const c = V3(); idxs.forEach(i => c.add(V3(atoms[i][1], atoms[i][2], atoms[i][3]))); c.multiplyScalar(1 / idxs.length); g.userData.centroid = c;
  });
  return root;
}
function receptor({ color = COL.teal, h = 7.5, r = 2.4, emissive = 0x0f766e } = {}) {
  const g = new THREE.Group(); const mat = new THREE.MeshPhongMaterial({ color: col(color), emissive, emissiveIntensity: 0.35, shininess: 60, transparent: true });
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, h - 1.1, 4, 10), mat); m.position.set(Math.cos(a) * r * 0.62, 0, Math.sin(a) * r * 0.62); m.rotation.z = Math.sin(a * 2) * 0.12; m.rotation.x = Math.cos(a * 2) * 0.12; g.add(m); }
  g.userData.mat = mat; return g;
}
function blob({ color = COL.violet, radius = 3, seed = 5, detail = 4 } = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, detail); const pos = geo.attributes.position; const r = rng(seed);
  const n = []; for (let i = 0; i < 12; i++) n.push([r() * 6 - 3, r() * 6 - 3, r() * 6 - 3, 0.6 + r()]);
  for (let i = 0; i < pos.count; i++) { const v = V3(pos.getX(i), pos.getY(i), pos.getZ(i)); let s = 0; for (const k of n) s += 0.12 * Math.sin(v.x * k[0] * 0.5 + v.y * k[1] * 0.5 + v.z * k[2] * 0.5) * k[3]; v.multiplyScalar(1 + s * 0.35); pos.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: col(color), transparent: true, opacity: 0.6, shininess: 120, emissive: col(color), emissiveIntensity: 0.3, specular: 0xffffff })); m.material.userData.baseOpacity = 0.6; return m;
}
function bilayer({ sx = 60, sz = 40, step = 1.7, headColor = 0x334a7a, seed = 9, holes = [] } = {}) {
  const g = new THREE.Group(); const nx = Math.floor(sx * 2 / step), nz = Math.floor(sz * 2 / step); const n = nx * nz;
  const headMat = new THREE.MeshPhongMaterial({ color: headColor, shininess: 40, transparent: true, opacity: 0.8 }); headMat.userData.baseOpacity = 0.8;
  const tailMat = new THREE.MeshPhongMaterial({ color: 0x1e2d4f, transparent: true, opacity: 0.5 }); tailMat.userData.baseOpacity = 0.5;
  const heads = new THREE.InstancedMesh(sphereGeo(8), headMat, n * 2), tails = new THREE.InstancedMesh(cylGeo(), tailMat, n * 2);
  g.add(heads, tails); g.userData = { heads, tails, nx, nz, step, sx, sz, n, ripples: [] };
  g.userData.update = (t) => {
    const d = new THREE.Object3D(); let k = 0; const rips = g.userData.ripples;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -sx + i * step + step / 2, z = -sz + j * step + step / 2;
      let w = 0.35 * Math.sin(x * 0.22 + t * 0.6) + 0.3 * Math.cos(z * 0.27 + t * 0.45 + x * 0.05);
      for (const rp of rips) { const d2 = Math.hypot(x - rp.x, z - rp.z); const age = rp.age; if (age > 0 && age < 3) { const front = age * 14; w += 1.4 * Math.exp(-Math.pow((d2 - front) / 3.5, 2)) * (1 - age / 3); } }
      const inHole = holes.some(h => Math.hypot(x - h.x, z - h.z) < h.r);
      for (const side of [1, -1]) {
        if (inHole) { d.position.set(x, 0, z); d.scale.setScalar(0.0001); d.updateMatrix(); heads.setMatrixAt(k, d.matrix); tails.setMatrixAt(k, d.matrix); k++; continue; }
        d.position.set(x, side * 2.1 + w, z); d.scale.setScalar(0.75); d.rotation.set(0, 0, 0); d.updateMatrix(); heads.setMatrixAt(k, d.matrix);
        d.position.set(x, side * 1.0 + w, z); d.scale.set(0.16, 1.9, 0.16); d.updateMatrix(); tails.setMatrixAt(k, d.matrix); k++;
      }
    }
    heads.instanceMatrix.needsUpdate = true; tails.instanceMatrix.needsUpdate = true;
  };
  g.userData.update(0); return g;
}
function trichomeField({ n = 220, spread = 70, seed = 4 } = {}) {
  const g = new THREE.Group(); const r = rng(seed);
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(spread * 3, spread * 3, 60, 60), new THREE.MeshPhongMaterial({ color: 0x1a3d2a, shininess: 20, emissive: 0x06150c }));
  const pos = leaf.geometry.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.6 * Math.sin(pos.getX(i) * 0.15) * Math.cos(pos.getY(i) * 0.12) + 0.25 * Math.sin(pos.getX(i) * 0.6 + pos.getY(i) * 0.4)); leaf.geometry.computeVertexNormals();
  leaf.rotation.x = -Math.PI / 2; leaf.position.y = -0.5; g.add(leaf);
  const stalkMat = new THREE.MeshPhongMaterial({ color: 0x8fc49a, transparent: true, opacity: 0.8 }); stalkMat.userData.baseOpacity = 0.8;
  const headMat = new THREE.MeshPhongMaterial({ color: 0xfff1c2, transparent: true, opacity: 0.85, emissive: 0xf59e0b, emissiveIntensity: 0.35, shininess: 120 }); headMat.userData.baseOpacity = 0.85;
  const stalks = new THREE.InstancedMesh(cylGeo(), stalkMat, n), heads = new THREE.InstancedMesh(sphereGeo(12), headMat, n); const d = new THREE.Object3D(); const data = [];
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * spread * 2, z = (r() - 0.5) * spread * 2, h = 2.5 + r() * 3.5, tilt = (r() - 0.5) * 0.5, ph = r() * 6.28;
    d.position.set(x, h / 2, z); d.rotation.set(tilt, 0, tilt * 0.7); d.scale.set(0.22, h, 0.22); d.updateMatrix(); stalks.setMatrixAt(i, d.matrix);
    const hp = V3(x + Math.sin(tilt) * h * 0.5, h, z + Math.sin(tilt * 0.7) * h * 0.5); data.push({ x, z, h, tilt, ph, head: hp });
    d.position.copy(hp); d.rotation.set(0, 0, 0); d.scale.setScalar(0.9 + r() * 0.5); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
    const gl = glow(0xf59e0b, 4.5, 0.35); gl.position.copy(hp); g.add(gl);
  }
  g.add(stalks, heads); g.userData.data = data;
  const em = []; for (let i = 0; i < 90; i++) { const s = glow(0xfde68a, 1.6, 0.8); const src = data[Math.floor(r() * n)]; s.userData = { src, ph: r(), sp: 0.08 + r() * 0.08 }; g.add(s); em.push(s); }
  g.userData.update = (t) => { em.forEach(s => { const u = frac(t * s.userData.sp + s.userData.ph); s.position.copy(s.userData.src.head).add(V3(Math.sin(u * 9 + s.userData.ph * 6) * 1.2, u * 14, Math.cos(u * 7) * 1.2)); s.material.opacity = 0.8 * Math.sin(u * Math.PI); }); };
  return g;
}
function brainCloud({ n = 38000, seed = 21 } = {}) {
  const r = rng(seed); const pos = new Float32Array(n * 3), colA = new Float32Array(n * 3); const base = new THREE.Color(0x3b5aa8);
  let k = 0;
  const put = (v, c) => { pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z; colA[k * 3] = c.r; colA[k * 3 + 1] = c.g; colA[k * 3 + 2] = c.b; k++; };
  while (k < n * 0.82) {
    const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1); let x = Math.sin(v) * Math.cos(u), y = Math.cos(v), z = Math.sin(v) * Math.sin(u);
    const ridge = 0.07 * Math.sin(9 * u + 2.5 * Math.sin(4 * v)) * Math.sin(6 * v + 1.3 * Math.cos(3 * u)) + 0.04 * Math.sin(17 * u + 5 * v);
    const fissure = Math.exp(-Math.pow(z / 0.07, 2)) * (y > 0.1 ? 0.12 : 0);
    const depth = r() < 0.72 ? 1 : 0.35 + 0.6 * Math.cbrt(r()); const R = (1 + ridge - fissure) * depth; const px = x * 14 * R * (x > 0 ? 1.05 : 1), py = (y * 9.5 + 0.5) * R - (x > 0.5 ? (x - 0.5) * 3 : 0), pz = z * 10.5 * R;
    if (py < -4 && px > 2) continue; if (py < -6.5) continue;
    put(V3(px, py, pz), base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.12));
  }
  while (k < n * 0.95) { const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1); const x = Math.sin(v) * Math.cos(u), y = Math.cos(v), z = Math.sin(v) * Math.sin(u); const fol = 1 + 0.08 * Math.sin(22 * v + 3 * u); put(V3(9.5 + x * 5.5 * fol, -5.5 + y * 3.4 * fol, z * 5.8 * fol), base.clone().offsetHSL(0.02, 0, -0.05)); }
  while (k < n) { const a = r() * Math.PI * 2, y = -4 - r() * 9, rr = 1.9 - (y + 4) * 0.04; put(V3(3 + Math.cos(a) * rr + y * 0.15, y, Math.sin(a) * rr), base.clone().offsetHSL(0.03, -0.1, -0.08)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  const m = new THREE.PointsMaterial({ size: 0.42, vertexColors: true, map: getGlowTex(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(g, m); pts.userData.base = colA.slice(); return pts;
}
function neuron({ seed = 1, color = 0x7aa2ff, axonTo = V3(30, 0, 0), size = 1 } = {}) {
  const r = rng(seed); const g = new THREE.Group(); const curves = [];
  const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, shininess: 50, transparent: true });
  const soma = new THREE.Mesh(sphereGeo(16), mat); soma.scale.set(2.2 * size, 1.9 * size, 2 * size); g.add(soma); g.userData.soma = soma;
  const branch = (from, dir, len, rad, depth) => {
    const pts = [from.clone()]; let p = from.clone(), d = dir.clone();
    for (let i = 1; i <= 4; i++) { d.add(V3((r() - .5) * .5, (r() - .5) * .5, (r() - .5) * .5)).normalize(); p = p.clone().add(d.clone().multiplyScalar(len / 4)); pts.push(p); }
    const c = new THREE.CatmullRomCurve3(pts); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 10, rad, 6, false), mat); g.add(m); curves.push(c);
    if (depth > 0) { for (let b = 0; b < 2; b++) branch(p, d.clone().add(V3((r() - .5) * 1.4, (r() - .5) * 1.4, (r() - .5) * 1.4)).normalize(), len * 0.65, rad * 0.6, depth - 1); }
  };
  const nd = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nd; i++) { const dir = V3(-0.6 - r(), (r() - .5) * 2, (r() - .5) * 2).normalize(); branch(dir.clone().multiplyScalar(1.6 * size), dir, 6 * size + r() * 4, 0.32 * size, 2); }
  const a0 = V3(2 * size, 0, 0), mid1 = a0.clone().lerp(axonTo, 0.35).add(V3(0, (r() - .5) * 6, (r() - .5) * 6)), mid2 = a0.clone().lerp(axonTo, 0.7).add(V3(0, (r() - .5) * 6, (r() - .5) * 6));
  const axon = new THREE.CatmullRomCurve3([a0, mid1, mid2, axonTo]); const am = new THREE.Mesh(new THREE.TubeGeometry(axon, 40, 0.3 * size, 6, false), mat); g.add(am);
  const term = new THREE.Mesh(sphereGeo(10), mat); term.position.copy(axonTo); term.scale.setScalar(0.8 * size); g.add(term);
  g.userData.axon = axon; g.userData.mat = mat; g.userData.curves = curves; g.userData.term = term; return g;
}
function dnaHelix({ len = 14, turns = 2.2, color1 = COL.sky, color2 = COL.teal, n = 60 } = {}) {
  const g = new THREE.Group(); const m1 = new THREE.MeshPhongMaterial({ color: color1, emissive: color1, emissiveIntensity: .3, transparent: true }), m2 = new THREE.MeshPhongMaterial({ color: color2, emissive: color2, emissiveIntensity: .3, transparent: true });
  const rung = new THREE.MeshPhongMaterial({ color: 0x94a3b8, transparent: true }); g.userData = { s1: [], s2: [], rungs: [], m1, m2, rung };
  for (let i = 0; i < n; i++) { const y = -len / 2 + len * i / n, a = i / n * turns * Math.PI * 2; const p1 = V3(Math.cos(a) * 2, y, Math.sin(a) * 2), p2 = V3(-Math.cos(a) * 2, y, -Math.sin(a) * 2);
    const s1 = new THREE.Mesh(sphereGeo(8), m1.clone()); s1.position.copy(p1); s1.scale.setScalar(.3); s1.userData.base = p1.clone(); g.add(s1); g.userData.s1.push(s1);
    const s2 = new THREE.Mesh(sphereGeo(8), m2.clone()); s2.position.copy(p2); s2.scale.setScalar(.3); s2.userData.base = p2.clone(); g.add(s2); g.userData.s2.push(s2);
    if (i % 2 === 0) { const c = new THREE.Mesh(cylGeo(), rung); c.position.copy(p1.clone().add(p2).multiplyScalar(.5)); c.quaternion.setFromUnitVectors(V3(0, 1, 0), p2.clone().sub(p1).normalize()); c.scale.set(.08, 4, .08); c.userData = { i, p1: p1.clone(), p2: p2.clone() }; g.add(c); g.userData.rungs.push(c); } }
  return g;
}

// ---------- base set: palette, background, camera rig ----------
class SetBase {
  constructor(sc, p) {
    this.sc = sc; this.p = p; this.dur = sc.duration; this.pal = PALETTES[p.palette] || PALETTES.blue;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(this.pal.bg); this.scene.fog = new THREE.FogExp2(this.pal.bg, p.fog ?? 0.012);
    this.cam = new THREE.PerspectiveCamera(p.fov || 42, W / H, 0.1, 700); lights(this.scene, this.pal);
    this.sp = space(p.stars ?? 1500, p.spread ?? 160); this.scene.add(this.sp);
    this.bokeh = space(260, 90, this.pal.rim, 4.5, 17, 0.07); this.scene.add(this.bokeh);
    this.neb = nebula(this.pal, 11 + sc.id.length); this.scene.add(this.neb);
    this.anchors = {}; this.shots = p.shots || null;
  }
  t(at) { return at * this.dur; }
  k(local, at, d = 1) { return clamp((local - this.t(at)) / d, 0, 1); }
  A(name, v) { this.anchors[name] = v.clone ? v.clone() : v; }
  anchor(name) { const a = this.anchors[name]; if (!a) return V3(0, 0, 0); return a.isVector3 ? a.clone() : a.getWorldPosition(V3()); }
  resolve(sh, local) {
    let pos, look;
    if (sh.orbit) { const o = sh.orbit; const c = this.anchor(o.anchor || 'center'); const a = (o.phase || 0) + local * (o.speed ?? 0.06); pos = V3(c.x + Math.cos(a) * (o.r || 30), c.y + (o.h ?? 6), c.z + Math.sin(a) * (o.r || 30)); }
    else if (sh.pos) pos = V3(...sh.pos);
    else pos = this.anchor(sh.anchor || 'center').add(V3(...(sh.offset || [0, 6, 26])));
    if (sh.look) look = V3(...sh.look); else look = this.anchor(sh.lookAt || sh.anchor || (sh.orbit && sh.orbit.anchor) || 'center').add(V3(...(sh.lookOffset || [0, 0, 0])));
    return { pos, look };
  }
  camUpdate(local, fallback) {
    if (!this.shots || !this.shots.length) { fallback(); return; }
    const sh = this.shots; let i = 0; for (let j = 0; j < sh.length; j++) if (local >= this.t(sh[j].at)) i = j;
    const a = this.resolve(sh[i], local); let pos = a.pos, look = a.look;
    if (i + 1 < sh.length) { const nx = sh[i + 1]; const t0 = this.t(sh[i].at), t1 = this.t(nx.at); const moveDur = nx.move ?? Math.max(0.6, (t1 - t0) * 0.8); const ms = t1 - moveDur;
      if (!nx.cut && local > ms) { const k = easeInOut((local - ms) / moveDur); const b = this.resolve(nx, local); pos = pos.lerp(b.pos, k); look = look.lerp(b.look, k); } }
    pos.add(V3(Math.sin(local * 0.37) * 0.35, Math.sin(local * 0.23 + 1) * 0.25, Math.cos(local * 0.31) * 0.35));
    this.cam.position.copy(pos); this.cam.lookAt(look);
  }
  orbit(local, { radius = 30, height = 8, speed = 0.08, center = V3(0, 0, 0), phase = 0, dolly = 0 } = {}) { const a = phase + local * speed; const r = radius - dolly * local; this.cam.position.set(center.x + Math.cos(a) * r, center.y + height + Math.sin(local * 0.21) * 1.2, center.z + Math.sin(a) * r); this.cam.lookAt(center); }
  update(local, p, t) { this.sp.rotation.y = t * this.sp.userData.spin; this.bokeh.rotation.y = -t * 0.01; this.neb.userData.update(t); this.A('center', V3(0, 0, 0)); }
  dispose() { this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map && m.map !== glowTex) m.map.dispose(); m.dispose(); }); } }); }
}

// ---------- sets ----------
class MoleculesSet extends SetBase {
  constructor(sc, p) {
    super(sc, p);
    this.items = (p.items || []).map((it, i) => {
      const frags = it.assemble ? [MOLS[it.mol].groups[it.assemble[0]], MOLS[it.mol].groups[it.assemble[1]]] : it.decarb ? (() => { const cb = MOLS[it.mol].groups.carboxyl; const rest = MOLS[it.mol].atoms.map((_, k) => k).filter(k => !cb.includes(k)); return [rest, cb]; })() : null;
      const m = molecule(it.mol, { scale: it.scale || 1, fragments: frags, hideH: it.hideH || false, tint: it.tint || null });
      const pos = V3(...(it.pos || [0, 0, 0])); m.position.copy(pos); m.visible = false; this.scene.add(m);
      const ly = (it.labelY ?? 8.5) * (it.scale || 1);
      const lab = it.label ? label(it.label, { size: it.labelSize || 2.2, color: it.labelColor || '#e8eef7' }) : null; if (lab) { lab.position.copy(pos).add(V3(0, ly, 0)); lab.material.opacity = 0; this.scene.add(lab); }
      const sub = it.sub ? label(it.sub, { size: 1.4, color: '#9fb0c9', weight: 400 }) : null; if (sub) { sub.position.copy(pos).add(V3(0, ly - 2.2, 0)); sub.material.opacity = 0; this.scene.add(sub); }
      const halo = it.halo ? glow(it.halo, 26 * (it.scale || 1), 0.0) : null; if (halo) { halo.position.copy(pos); this.scene.add(halo); }
      return { ...it, m, pos, lab, sub, halo, at: it.at ?? 0, spin: it.spin || [0.15, 0.35], i };
    });
    if (p.mirrorPlane) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshPhongMaterial({ color: 0x9fb0c9, transparent: true, opacity: 0.08, side: THREE.DoubleSide, shininess: 200 })); pl.rotation.y = Math.PI / 2; this.scene.add(pl); }
    if (p.background === 'trichomes') { this.bg = trichomeField({ n: 140, spread: 60 }); this.bg.position.y = p.membraneY ?? -14; this.scene.add(this.bg); }
    if (p.background === 'membrane') { this.bg = bilayer({ sx: 50, sz: 34, step: 2 }); this.bg.position.y = p.membraneY ?? -12; this.scene.add(this.bg); }
    this.camP = p.cam || { mode: 'orbit', radius: 30, height: 6, speed: 0.07 };
  }
  update(local, p, t) {
    super.update(local, p, t);
    if (this.bg && this.bg.userData.update) this.bg.userData.update(t);
    for (const it of this.items) {
      this.A('item' + it.i, it.m.position);
      const k = this.k(local, it.at, 0.9); it.m.visible = k > 0; if (k <= 0) { if (it.lab) it.lab.material.opacity = 0; if (it.sub) it.sub.material.opacity = 0; continue; }
      popIn(it.m, k); it.m.rotation.y = t * it.spin[1] + it.i; it.m.rotation.x = Math.sin(t * it.spin[0] + it.i) * 0.35;
      if (it.bob) it.m.position.y = it.pos.y + Math.sin(t * 0.8 + it.i) * 0.6;
      if (it.lab) it.lab.material.opacity = easeOut((local - this.t(it.at) - 0.5) / 0.6); if (it.sub) it.sub.material.opacity = easeOut((local - this.t(it.at) - 0.8) / 0.6);
      if (it.halo) it.halo.material.opacity = 0.35 * easeOut((local - this.t(it.at) - 0.3) / 1) * (0.8 + 0.2 * Math.sin(t * 2));
      if (it.assemble) { const j = easeInOut((local - this.t(it.at)) / 2.2); const parts = it.m.userData.parts; const off = it.assembleOffset || 9; parts[0].position.set(-off * (1 - j), 0, 0); parts[1].position.set(off * (1 - j), 2 * (1 - j), 0); }
      if (it.decarb) { const j = easeInOut((local - this.t(it.decarb)) / 2.5); const cb = it.m.userData.parts[1]; cb.position.set(0, 6 * j, 4 * j); setOpacity(cb, 1 - j * 0.9); cb.rotation.z = j * 2; }
      if (it.sink) { const j = easeInOut((local - this.t(it.sink)) / 3); it.m.position.y = lerp(it.pos.y, (this.p.membraneY ?? -12) + 0.5, j); }
    }
    this.camUpdate(local, () => {
      const c = this.camP;
      if (c.mode === 'visit' && this.items.length) {
        const seq = this.items.filter(i => i.focusAt != null).sort((a, b) => a.focusAt - b.focusAt); let cur = seq[0];
        for (let i = 0; i < seq.length; i++) if (local >= this.t(seq[i].focusAt)) cur = seq[i];
        const target = cur.pos.clone(); const prev = seq[Math.max(0, seq.indexOf(cur) - 1)].pos.clone();
        const kk = easeInOut((local - this.t(cur.focusAt)) / 1.6); const look = prev.clone().lerp(target, kk);
        const r = c.radius || 26, a = (c.phase || 0) + local * (c.speed || 0.06);
        this.cam.position.set(look.x + Math.cos(a) * r, look.y + (c.height ?? 4), look.z + Math.sin(a) * r); this.cam.lookAt(look);
      } else this.orbit(local, { radius: c.radius || 30, height: c.height ?? 6, speed: c.speed || 0.07, center: V3(...(c.center || [0, 0, 0])), phase: c.phase || 0, dolly: c.dolly || 0 });
    });
  }
}

class TitleSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, stars: 2600, spread: 200 });
    this.m = molecule(p.mol || 'THC', { scale: p.scale || 1.5 }); this.m.position.set(13, 0, 0); this.scene.add(this.m);
    this.h = glow(this.pal.rim, 60, 0.16); this.h.position.set(13, 0, 0); this.scene.add(this.h);
    const bg = p.bg || (p.receptor ? 'membrane' : 'space');
    if (bg === 'membrane') { this.bl = bilayer({ sx: 40, sz: 30, step: 2 }); this.bl.position.y = -9; this.scene.add(this.bl); this.rc = receptor(); this.rc.position.set(13, -9, 0); this.scene.add(this.rc); }
    if (bg === 'trichomes') { this.tf = trichomeField({ n: 160, spread: 60 }); this.tf.position.y = -12; this.scene.add(this.tf); }
    if (bg === 'network') { this.net = new THREE.Group(); const r = rng(4); for (let i = 0; i < 7; i++) { const c = V3((r() - .5) * 70, (r() - .5) * 30 - 8, -20 - r() * 40); const n = neuron({ seed: 300 + i, axonTo: V3(28, 0, 0), size: 1 }); n.position.copy(c); n.rotation.y = r() * 6.28; this.net.add(n); } this.scene.add(this.net); }
    if (bg === 'brain') { this.br = brainCloud({ n: 20000, seed: 5 }); this.br.scale.setScalar(1.4); this.br.position.set(-12, -2, -18); this.scene.add(this.br); }
    if (bg === 'vesicles') { this.vs = new THREE.Group(); const r = rng(8); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(sphereGeo(24), new THREE.MeshPhongMaterial({ color: 0x2b4479, transparent: true, opacity: 0.5, emissive: 0x16284f })); s.scale.setScalar(5 + r() * 5); s.position.set((r() - .5) * 70, (r() - .5) * 30, -25 - r() * 40); this.vs.add(s); } this.scene.add(this.vs); }
  }
  update(local, p, t) {
    super.update(local, p, t); this.m.rotation.y = t * 0.25; this.m.rotation.x = Math.sin(t * 0.17) * 0.4; this.m.position.set(13 + Math.sin(local * 0.3), Math.sin(t * 0.5) * 0.8, 0); this.A('mol', this.m.position);
    if (this.bl) this.bl.userData.update(t); if (this.tf) this.tf.userData.update(t); if (this.br) this.br.rotation.y = t * 0.05; if (this.net) this.net.children.forEach((n, i) => n.userData.mat.emissiveIntensity = 0.25 + Math.pow(Math.max(0, Math.sin(t * 1.1 + i)), 8) * 0.8);
    this.camUpdate(local, () => this.orbit(local, { radius: 40 - easeOut(local / 6) * 6, height: 6, speed: 0.06, phase: this.p.phase || 0.9, center: V3(4, 0, 0) }));
  }
}

class MixtureSet extends SetBase {
  constructor(sc, p) {
    super(sc, p); const r = rng(7); this.n = p.n || 420;
    const cols = [0xd7dee9, 0xfb7185, 0x60a5fa, 0xf59e0b, 0xa78bfa]; const mat = cols.map(c => new THREE.MeshPhongMaterial({ color: c, shininess: 60 }));
    this.im = cols.map(() => []); this.items = [];
    for (let i = 0; i < this.n; i++) { const len = 3 + Math.floor(r() * 5); const ci = Math.floor(r() * cols.length); const orb = { a: r() * 6.28, rad: 6 + r() * 26, y: (r() - .5) * 22, sp: (0.1 + r() * 0.25) * (r() < .5 ? 1 : -1), tilt: (r() - .5) * 1.5, len, ci, ph: r() * 6.28, atoms: [] }; let pos = V3(0, 0, 0); for (let k = 0; k < len; k++) { orb.atoms.push(pos.clone()); pos = pos.clone().add(V3((r() - .5), (r() - .5), (r() - .5)).normalize().multiplyScalar(1.1)); } this.items.push(orb); this.im[ci].push(orb); }
    this.meshes = this.im.map((list, ci) => { const total = list.reduce((s, o) => s + o.len, 0); const m = new THREE.InstancedMesh(sphereGeo(8), mat[ci], Math.max(1, total)); this.scene.add(m); return m; });
    if (p.isolate) { this.iso = molecule(p.isolate.mol, { scale: p.isolate.scale || 1.2 }); this.iso.visible = false; this.scene.add(this.iso); this.isoLab = label(p.isolate.label || p.isolate.mol, { size: 2.4 }); this.isoLab.position.y = 9; this.isoLab.material.opacity = 0; this.scene.add(this.isoLab); this.halo = glow(COL.amber, 40, 0); this.scene.add(this.halo); }
    if (p.column) { this.col = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 44, 32, 1, true), new THREE.MeshPhongMaterial({ color: 0x9fb0c9, transparent: true, opacity: 0.08, side: THREE.DoubleSide })); this.scene.add(this.col); }
  }
  update(local, p, t) {
    super.update(local, p, t); const d = new THREE.Object3D(); const counters = this.meshes.map(() => 0);
    const isoK = this.p.isolate ? easeInOut((local - this.t(this.p.isolate.at)) / 3) : 0;
    const sep = this.p.column ? easeInOut((local - this.t(this.p.column.at)) / 4) : 0;
    for (const o of this.items) { const a = o.a + t * o.sp; let rad = o.rad * (1 + isoK * 0.9), y = o.y;
      if (sep > 0) { const band = (o.ci - 2) * 7; y = lerp(o.y, band + Math.sin(o.ph) * 1.5, sep); rad = lerp(rad, 2.5 + Math.abs(Math.sin(o.ph * 3)) * 3.5, sep); }
      const base = V3(Math.cos(a) * rad, y + Math.sin(t * 0.7 + o.ph) * 1.2, Math.sin(a) * rad * Math.cos(o.tilt)); const rot = t * 0.8 + o.ph;
      for (let k = 0; k < o.len; k++) { const v = o.atoms[k].clone().applyAxisAngle(V3(0, 1, 0), rot).applyAxisAngle(V3(1, 0, 0), rot * 0.6).add(base); d.position.copy(v); d.scale.setScalar(0.42); d.updateMatrix(); this.meshes[o.ci].setMatrixAt(counters[o.ci]++, d.matrix); } }
    this.meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.material.opacity = 1 - isoK * 0.55; m.material.transparent = true; });
    if (this.iso) { popIn(this.iso, isoK); this.iso.rotation.y = t * 0.4; this.iso.rotation.x = Math.sin(t * 0.3) * 0.3; this.isoLab.material.opacity = easeOut((local - this.t(this.p.isolate.at) - 1.5) / 0.8); this.halo.material.opacity = 0.35 * isoK * (0.8 + 0.2 * Math.sin(t * 2)); }
    this.A('iso', V3(0, 0, 0));
    this.camUpdate(local, () => this.orbit(local, { radius: 46 - isoK * 20, height: 6, speed: 0.06, phase: 1.2 }));
  }
}

class TimelineSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, stars: 2200, spread: 240, fog: 0.008 }); this.gap = p.gap || 46;
    this.nodes = (p.nodes || []).map((nd, i) => {
      const g = new THREE.Group(); g.position.set((i % 2 ? 9 : -9), 0, -i * this.gap); this.scene.add(g);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.14, 8, 64), new THREE.MeshBasicMaterial({ color: COL.teal, transparent: true, opacity: 0.6 })); g.add(ring);
      const yl = label(nd.year, { size: 3.2, color: '#f59e0b', weight: 800 }); yl.position.set(0, 11.5, 0); g.add(yl);
      const tl = label(nd.text, { size: 1.7, color: '#e8eef7', weight: 400 }); tl.position.set(0, -11.2, 0); g.add(tl);
      let ex; if (nd.mol) ex = molecule(nd.mol, { scale: 1.0 }); else if (nd.exhibit === 'receptor') ex = receptor(); else if (nd.exhibit === 'helix') ex = dnaHelix(); else if (nd.exhibit === 'synapse') { ex = new THREE.Group(); const m = new THREE.MeshPhongMaterial({ color: COL.sky, emissive: COL.sky, emissiveIntensity: .3 }); const a = new THREE.Mesh(sphereGeo(14), m); a.scale.set(3, 2.4, 3); a.position.y = 3; const b = new THREE.Mesh(sphereGeo(14), new THREE.MeshPhongMaterial({ color: COL.teal, emissive: COL.teal, emissiveIntensity: .3 })); b.scale.set(3.4, 1.6, 3.4); b.position.y = -2.2; ex.add(a, b); for (let k = 0; k < 6; k++) { const s = glow(COL.amber, 1.6, .9); s.userData.ph = k; ex.add(s); } ex.userData.synapse = true; } else if (nd.exhibit === 'brain') { ex = brainCloud({ n: 9000, seed: 3 }); ex.scale.setScalar(0.42); }
      if (ex) g.add(ex); const gl = glow(COL.teal, 22, 0.25); g.add(gl); return { ...nd, g, ex, ring };
    });
  }
  update(local, p, t) {
    super.update(local, p, t); const N = this.nodes.length; const ats = this.nodes.map(n => this.t(n.at));
    let z = 30; const zi = i => -i * this.gap; let seg = 0; while (seg < N - 1 && local > ats[seg + 1]) seg++;
    if (local < ats[0]) z = lerp(30, zi(0), easeInOut(local / Math.max(0.1, ats[0]))); else { const a = ats[seg], b = seg + 1 < N ? ats[seg + 1] : a + 6; const k = easeInOut((local - a) / Math.max(0.1, b - a)); z = seg + 1 < N ? lerp(zi(seg), zi(seg + 1), k) : zi(seg) - easeOut((local - a) / 8) * 14; }
    const nx = (seg % 2 ? 9 : -9), nnx = ((seg + 1) % 2 ? 9 : -9); const kx = seg + 1 < N ? easeInOut((local - ats[seg]) / Math.max(0.1, ats[seg + 1] - ats[seg])) : 0; const cx = lerp(nx, nnx, kx) * 0.55;
    this.cam.position.set(cx + Math.sin(local * 0.3) * 1.5, 3 + Math.sin(local * 0.2), z + 34); this.cam.lookAt(cx * 0.3, 1, z - 10);
    this.nodes.forEach((n, i) => { const k = easeOut((local - ats[i] + 1.5) / 1.2); n.g.visible = k > 0; n.ring.rotation.y = t * 0.4; n.ring.scale.setScalar(0.6 + 0.4 * k); n.ring.material.opacity = 0.6 * clamp((this.cam.position.z - n.g.position.z - 12) / 14, 0, 1); if (n.ex) { n.ex.rotation.y = t * 0.3; if (n.ex.userData.synapse) n.ex.children.forEach(c => { if (c.userData.ph != null) { const u = frac(t * 0.5 + c.userData.ph / 6); c.position.set(Math.sin(c.userData.ph) * 1.2, 1.2 - 2.6 * u, Math.cos(c.userData.ph) * 1.2); } }); } });
  }
}

// Membrane: ligand docks -> ripple + glow -> G protein engages -> alpha subunit travels to adenylyl cyclase -> cAMP fades.
class MembraneSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.014 });
    const hasG = (p.stages || []).some(s => s.action === 'gprotein');
    this.bl = bilayer({ sx: 64, sz: 44, step: 1.8, holes: hasG ? (p.receptors || [{ x: 0, z: 0 }]).map(r => ({ x: r.x, z: r.z, r: 7.5 })) : [] }); this.scene.add(this.bl);
    this.recs = (p.receptors || [{ x: 0, z: 0 }]).map((rc, i) => { const r = receptor({ color: rc.color ? col(rc.color) : COL.teal }); r.position.set(rc.x, 0, rc.z); this.scene.add(r); const lab = rc.label ? label(rc.label, { size: 2, color: rc.labelColor || '#2dd4bf' }) : null; if (lab) { lab.position.set(rc.x - 9, 5.5, rc.z); this.scene.add(lab); } const gl = glow(COL.teal, 16, 0); gl.position.set(rc.x, 1, rc.z); this.scene.add(gl); return { ...rc, r, lab, gl }; });
    this.ligs = (p.ligands || []).map((lg, i) => { const m = molecule(lg.mol, { scale: lg.scale || 0.6 }); m.visible = false; this.scene.add(m); const lab = lg.label ? label(lg.label, { size: 1.5, color: lg.color || '#f59e0b' }) : null; if (lab) { lab.material.opacity = 0; this.scene.add(lab); } const tgt = this.recs[lg.to ?? 0]; return { ...lg, m, lab, tgt, i, start: V3(...(lg.from || [(i % 2 ? 1 : -1) * 14, 24, -18 - i * 4])) }; });
    this.gp = new THREE.Group(); this.gpParts = [[0, 0, 38, COL.sky], [2.6, 0.6, 28, 0x93c5fd], [4.2, -0.8, 20, 0xbfdbfe]].map(([x, z, r, c]) => { const s = new THREE.Mesh(sphereGeo(16), new THREE.MeshPhongMaterial({ color: c, shininess: 80, transparent: true, emissive: c, emissiveIntensity: 0.45 })); s.position.set(x, 0, z); s.scale.setScalar(r / 20); this.gp.add(s); return s; });
    this.gpLab = label('Gi/o protein', { size: 1.5, color: '#60a5fa' }); this.gpLab.position.y = -3; this.gp.add(this.gpLab); const gpg = glow(COL.sky, 14, 0.35); gpg.material.depthTest = false; gpg.position.set(2, 0, 0); this.gp.add(gpg); this.gp.visible = false; this.scene.add(this.gp);
    this.alpha = new THREE.Mesh(sphereGeo(16), new THREE.MeshPhongMaterial({ color: COL.sky, emissive: COL.sky, emissiveIntensity: 0.6, transparent: true })); this.alpha.scale.setScalar(1.9); this.alpha.visible = false; this.scene.add(this.alpha); const ag = glow(COL.sky, 10, 0.5); ag.material.depthTest = false; ag.scale.set(5, 5, 1); this.alpha.add(ag);
    this.ac = blob({ color: COL.amber, radius: 2.6, seed: 9 }); this.ac.visible = false; this.scene.add(this.ac); this.acLab = label('adenylyl cyclase', { size: 1.4, color: '#fcd34d' }); this.acLab.material.opacity = 0; this.scene.add(this.acLab);
    this.camp = []; const r = rng(3); for (let i = 0; i < 40; i++) { const s = glow(COL.rose, 1.8, 0.9); s.material.depthTest = false; s.position.set((r() - .5) * 40, -4 - r() * 8, (r() - .5) * 30); s.userData.ph = r() * 6.28; s.visible = false; this.scene.add(s); this.camp.push(s); }
    this.campLab = label('cAMP ↓', { size: 2, color: '#fb7185' }); this.campLab.material.opacity = 0; this.scene.add(this.campLab);
    this.enz = (p.enzymes || []).map(e => { const b = blob({ color: e.color ? col(e.color) : COL.violet, radius: 2.6, seed: e.seed || 2 }); b.position.set(...e.pos); this.scene.add(b); const lab = label(e.label, { size: 1.6, color: '#c4b5fd' }); lab.position.set(e.pos[0], e.pos[1] + 4.2, e.pos[2]); this.scene.add(lab); return { ...e, b, lab }; });
    this.q = (p.question) ? label('?', { size: 4, color: '#f59e0b', weight: 800 }) : null; if (this.q) { this.q.position.set(0, 5.5, 0); this.q.material.opacity = 0; this.scene.add(this.q); }
    this.stages = p.stages || []; this.camP = p.cam || {};
  }
  stageAt(name) { const s = this.stages.find(s => s.action === name); return s ? this.t(s.at) : Infinity; }
  stageK(name, d = 1) { return clamp((this.local - this.stageAt(name)) / d, 0, 1); }
  update(local, p, t) {
    super.update(local, p, t); this.local = local;
    const vanish = this.stageK('receptor-vanish', 2), appear = this.stages.find(s => s.action === 'receptor-appear') ? this.stageK('receptor-appear', 1.2) : 1;
    this.recs.forEach((rc, i) => { this.A('receptor' + i, V3(rc.x, 2, rc.z)); const k = appear * (1 - vanish); rc.r.visible = k > 0.001; popIn(rc.r, k); rc.r.userData.mat.opacity = k; if (rc.lab) rc.lab.material.opacity = k; rc.r.children.forEach((h, j) => h.position.y = Math.sin(t * 2 + j) * 0.06); });
    const dockAt = this.stageAt('ligand-dock'); const rips = [];
    this.ligs.forEach(lg => {
      const mode = lg.mode || 'dock'; let vis = true; let pos;
      if (mode === 'dock') { const t0 = (lg.at != null ? this.t(lg.at) : dockAt) + (lg.delay || 0); const kk = easeInOut((local - t0) / 2.6); vis = kk > 0 || lg.pre; const end = V3(lg.tgt.x, 3.9, lg.tgt.z); pos = lg.start.clone().lerp(end, kk); pos.y += Math.sin(kk * Math.PI) * 6; lg.m.rotation.set(Math.sin(t) * 0.2 * (1 - kk), t * 0.6 * (1 - kk) + 0.4, 0); lg.docked = kk >= 1; if (local >= t0 + 2.6) rips.push({ x: lg.tgt.x, z: lg.tgt.z, age: local - (t0 + 2.6) }); }
      else if (mode === 'pass') { const u = frac(t * 0.05 + lg.i * 0.21); pos = V3(lerp(-40, 40, u), 8 + Math.sin(u * 9 + lg.i) * 3, -14 + lg.i * 5); lg.m.rotation.set(t * .5, t * .3, 0); vis = this.stageK('ligand-pass', 1) > 0; }
      else if (mode === 'sink') { const kk = easeInOut((local - this.t(lg.at)) / 3.5); pos = V3(lg.start.x * 0.5, lerp(14, 1.6, kk), lg.start.z * 0.5); lg.m.rotation.set(t * 0.4 * (1 - kk) + 1.2 * kk, t * 0.5 * (1 - kk), 0); vis = local > this.t(lg.at) - 1; }
      else if (mode === 'local') { const kk = clamp((local - this.t(lg.at)) / 1, 0, 1), gone = clamp((local - this.t(lg.at) - (lg.life || 3)) / 1, 0, 1); pos = V3(lg.tgt.x + 3, 3.5 + 3 * (1 - kk), lg.tgt.z + 2); vis = kk > 0 && gone < 1; setOpacity(lg.m, 1 - gone); lg.m.rotation.y = t; }
      lg.m.visible = vis; if (pos) lg.m.position.copy(pos); this.A('ligand' + lg.i, lg.m.position); if (lg.lab) { lg.lab.position.copy(lg.m.position).add(V3(8, 2.5, 0)); lg.lab.material.opacity = vis ? 1 : 0; }
    });
    this.bl.userData.ripples = rips; this.bl.userData.update(t);
    this.recs.forEach(rc => { const anyDocked = this.ligs.some(l => l.docked && l.tgt === rc); rc.gl.material.opacity = anyDocked ? 0.35 + 0.15 * Math.sin(t * 3) : 0; rc.r.userData.mat.emissiveIntensity = anyDocked ? 0.7 + 0.2 * Math.sin(t * 3) : 0.35; });
    const gpk = this.stageK('gprotein', 1.4); this.gp.visible = gpk > 0; const rc0 = this.recs[0];
    const toCam = this.cam.position.clone().sub(V3(rc0.x, 0, rc0.z)); toCam.y = 0; if (toCam.length() < 0.01) toCam.set(1, 0, 0); toCam.normalize(); const side = V3(-toCam.z, 0, toCam.x);
    const gpos = V3(rc0.x, -3.2, rc0.z).add(toCam.clone().multiplyScalar(3.8)).add(side.clone().multiplyScalar(-1.5 - 12 * (1 - easeOut(gpk)))); gpos.y -= 5 * (1 - easeOut(gpk)); this.gp.position.copy(gpos); this.gp.lookAt(this.cam.position.x, gpos.y, this.cam.position.z); this.A('gprotein', gpos);
    this.gp.children.forEach(c => { if (c.material && c.material.opacity != null && !c.isSprite) c.material.opacity = easeOut(gpk); });
    const ck = this.stageK('camp-drop', 0.1); const acPos = V3(rc0.x, -4.5, rc0.z).add(side.clone().multiplyScalar(11)).add(toCam.clone().multiplyScalar(2)); this.ac.position.copy(acPos); this.A('ac', acPos); this.acLab.position.copy(acPos).add(V3(0, 4.2, 0));
    const showAc = this.stages.some(s => s.action === 'camp-drop') && local > this.stageAt('camp-drop') - 7; this.ac.visible = showAc; this.acLab.material.opacity = showAc ? 1 : 0;
    const travel = easeInOut((local - this.stageAt('camp-drop')) / 1.6); this.alpha.visible = ck > 0; this.gpParts[0].visible = !(ck > 0); this.alpha.position.copy(this.gp.localToWorld(V3(0, 0, 0))).lerp(acPos.clone().add(V3(0, 2.6, 0)), travel); this.alpha.position.y += Math.sin(travel * Math.PI) * 3; this.A('alpha', this.alpha.position);
    const acDim = clamp((local - this.stageAt('camp-drop') - 1.6) / 1, 0, 1); this.ac.material.emissiveIntensity = 0.3 * (1 - acDim * 0.8); this.ac.material.opacity = 0.6 * (1 - acDim * 0.4); this.ac.scale.setScalar(1 - 0.15 * acDim + 0.06 * Math.sin(t * 2));
    this.camp.forEach((s, i) => { s.visible = showAc; const fade = ck > 0 ? 1 - clamp((local - this.stageAt('camp-drop') - 1.8 - i * 0.1) / 0.8, 0, 1) : 1; s.material.opacity = 0.9 * fade; s.position.y += Math.sin(t * 1.5 + s.userData.ph) * 0.01; }); this.A('camp', V3(rc0.x - 6, -8, rc0.z + 6));
    this.campLab.material.opacity = ck > 0 ? easeOut((local - this.stageAt('camp-drop') - 2.2) / 0.6) : 0; this.campLab.position.copy(acPos).add(V3(0, -4.5, 0));
    this.enz.forEach((e, i) => { e.b.rotation.y = t * 0.2 + i; e.b.position.y = e.pos[1] + Math.sin(t * 0.7 + i) * 0.5; e.lab.position.y = e.b.position.y + 4.2; this.A('enzyme' + i, e.b.position); });
    if (this.q) { this.q.material.opacity = this.stageK('question', 0.8) * (0.7 + 0.3 * Math.sin(t * 3)); }
    this.camUpdate(local, () => { const c = this.camP; this.orbit(local, { radius: c.radius || 30, height: c.height ?? 9, speed: c.speed || 0.06, phase: c.phase || 0.6, center: V3(...(c.center || [0, 0, 0])), dolly: c.dolly || 0 }); });
  }
}

class BrainSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.006 }); this.pts = brainCloud({ n: p.n || 36000 }); this.scene.add(this.pts);
    this.regions = (p.regions || []).map((r, i) => { const c = V3(...r.pos); const gl = glow(r.level === 'low' ? COL.muted : COL.amber, r.level === 'low' ? 10 : 16, 0); gl.position.copy(c); this.scene.add(gl); const dy = r.labelDy ?? 4.5; const lab = label(r.label, { size: 1.9, color: r.level === 'low' ? '#9fb0c9' : '#f59e0b' }); lab.position.copy(c).add(V3(0, dy, 0)); lab.material.opacity = 0; this.scene.add(lab); const sub = label(r.level === 'low' ? 'low CB1 density' : 'high CB1 density', { size: 1.2, color: '#e8eef7', weight: 400 }); sub.position.copy(c).add(V3(0, dy - 1.7, 0)); sub.material.opacity = 0; this.scene.add(sub); return { ...r, c, gl, lab, sub, rad: r.radius || 5 }; });
    const r = rng(8); const pos = this.pts.geometry.attributes.position; const lp = []; for (let i = 0; i < 260; i++) { const a = Math.floor(r() * pos.count * 0.8), b = Math.floor(r() * pos.count * 0.8); lp.push(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b)); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3)); this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COL.sky, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending })); this.scene.add(this.lines);
    this.colBase = this.pts.userData.base;
  }
  update(local, p, t) {
    super.update(local, p, t); const cl = this.pts.geometry.attributes.color, pos = this.pts.geometry.attributes.position; const base = this.colBase;
    const acts = this.regions.map(r => ({ r, k: easeOut((local - this.t(r.at)) / 1.5) }));
    for (let i = 0; i < pos.count; i++) { let rr = base[i * 3], gg = base[i * 3 + 1], bb = base[i * 3 + 2]; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      for (const { r, k } of acts) { if (k <= 0) continue; const d = Math.hypot(x - r.c.x, y - r.c.y, z - r.c.z); if (d < r.rad) { const w = k * (1 - d / r.rad) * (0.85 + 0.15 * Math.sin(t * 3 + d)); if (r.level === 'low') { rr = lerp(rr, 0.62, w); gg = lerp(gg, 0.69, w); bb = lerp(bb, 0.79, w); } else { rr = lerp(rr, 1.0, w); gg = lerp(gg, 0.62, w); bb = lerp(bb, 0.08, w); } } }
      cl.setXYZ(i, rr, gg, bb); }
    cl.needsUpdate = true; this.pts.material.size = 0.42 + 0.03 * Math.sin(t * 2);
    this.regions.forEach((r, i) => { const k = acts[i].k; r.gl.material.opacity = (r.level === 'low' ? 0.25 : 0.4) * k * (0.8 + 0.2 * Math.sin(t * 2.5 + i)); r.lab.material.opacity = easeOut((local - this.t(r.at) - 0.6) / 0.6); r.sub.material.opacity = easeOut((local - this.t(r.at) - 0.9) / 0.6); this.A('region' + i, r.c); });
    this.lines.material.opacity = 0.08 + 0.08 * Math.abs(Math.sin(t * 1.7)); this.A('center', V3(2, -1, 0));
    this.camUpdate(local, () => this.orbit(local, { radius: 46 - easeOut(local / 20) * 8, height: 10, speed: 0.07, phase: 3.4, center: V3(2, -1, 0) }));
  }
}

class SynapseSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.012 }); const preM = new THREE.MeshPhongMaterial({ color: 0x3b6fd6, emissive: 0x1d3f8a, emissiveIntensity: 0.35, shininess: 40, transparent: true, opacity: 0.92 }); preM.userData.baseOpacity = .92;
    const postM = new THREE.MeshPhongMaterial({ color: 0x1f9e8f, emissive: 0x0f5f55, emissiveIntensity: 0.35, shininess: 40, transparent: true, opacity: 0.92 }); postM.userData.baseOpacity = .92;
    this.pre = new THREE.Mesh(sphereGeo(32), preM); this.pre.scale.set(12, 9.5, 11); this.pre.position.y = 8.3; this.scene.add(this.pre); this.preM = preM;
    this.axon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.5, 40, 16), preM); this.axon.position.set(0, 36, 0); this.scene.add(this.axon);
    this.post = new THREE.Mesh(sphereGeo(32), postM); this.post.scale.set(14, 7, 12); this.post.position.y = -8.6; this.scene.add(this.post);
    this.dend = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 40, 16), postM); this.dend.position.set(0, -34, 0); this.scene.add(this.dend);
    this.labels = { pre: label('presynaptic terminal', { size: 1.8, color: '#93c5fd' }), post: label('postsynaptic neuron', { size: 1.8, color: '#5eead4' }) }; this.labels.pre.position.set(-14, 14, 4); this.labels.post.position.set(-15, -10, 6); this.scene.add(this.labels.pre, this.labels.post);
    const r = rng(12); this.ves = []; const vm = new THREE.MeshPhongMaterial({ color: 0xdbe7ff, emissive: 0x7aa2ff, emissiveIntensity: .3, transparent: true, opacity: .95 });
    for (let i = 0; i < 26; i++) { const v = new THREE.Mesh(sphereGeo(10), vm); v.scale.setScalar(0.9); v.userData = { home: V3((r() - .5) * 14, 4 + r() * 8, (r() - .5) * 11), ph: r() * 6.28 }; v.position.copy(v.userData.home); this.scene.add(v); this.ves.push(v); }
    this.nt = []; for (let i = 0; i < 48; i++) { const s = glow(0xdbe7ff, 1.2, 0.9); s.userData = { ph: r() * 6.28, x: (r() - .5) * 12, z: (r() - .5) * 9 }; this.scene.add(s); this.nt.push(s); }
    this.cb1 = [[-6, 2.2, 3], [6.5, 2.4, 2], [0, 1.8, -6]].map(([x, y, z]) => { const rc = receptor({ h: 3.6, r: 1.5 }); rc.scale.setScalar(0.75); rc.position.set(x, y - 0.6, z); this.scene.add(rc); const gl = glow(COL.teal, 8, 0); gl.position.set(x, y - 1.5, z); this.scene.add(gl); return { rc, gl, pos: V3(x, y - 0.6, z) }; });
    this.cb1Lab = label('CB1', { size: 1.3, color: '#2dd4bf' }); this.cb1Lab.position.set(-6, 3.2, 3.5); this.scene.add(this.cb1Lab);
    this.chan = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.3, 8, 20), new THREE.MeshPhongMaterial({ color: COL.rose, emissive: COL.rose, emissiveIntensity: .5 })); this.chan.rotation.x = Math.PI / 2; this.chan.position.set(1.5, 0.3, 4); this.scene.add(this.chan); this.chanLab = label('Ca²⁺ channel', { size: 1.1, color: '#fb7185' }); this.chanLab.position.set(1.5, 1.6, 6.2); this.scene.add(this.chanLab);
    this.postChan = []; for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.2, 8, 16), new THREE.MeshPhongMaterial({ color: COL.amber, emissive: COL.amber, emissiveIntensity: .5 })); c.rotation.x = Math.PI / 2; c.position.set(-8 + i * 4, -1.9, -2 + (i % 2) * 4); this.scene.add(c); this.postChan.push(c); }
    this.ca = []; for (let i = 0; i < 16; i++) { const s = label('Ca²⁺', { size: 0.95, color: '#fcd34d', weight: 700 }); s.userData = { ph: r() * 6.28, x: (r() - .5) * 16, z: (r() - .5) * 10 }; s.material.opacity = 0; this.scene.add(s); this.ca.push(s); }
    this.ag = []; for (let i = 0; i < 6; i++) { const m = molecule('2-AG', { scale: 0.28, hideH: true }); m.visible = false; this.scene.add(m); m.userData = { ph: i / 6, target: this.cb1[i % 3] }; this.ag.push(m); }
    this.agLab = label('2-AG', { size: 1.5, color: '#f59e0b' }); this.agLab.material.opacity = 0; this.scene.add(this.agLab);
    this.dagl = blob({ color: COL.amber, radius: 1.6, seed: 4 }); this.dagl.position.set(5, -1.2, 1); this.scene.add(this.dagl); this.daglLab = label('DAGL', { size: 1.1, color: '#fcd34d' }); this.daglLab.position.set(8.5, -2.6, 3); this.daglLab.material.opacity = 0; this.scene.add(this.daglLab);
    this.pulse = glow(0xfff7d6, 7, 0); this.scene.add(this.pulse);
    this.stages = p.stages || []; this.camP = p.cam || {};
  }
  stage(name) { const s = this.stages.find(s => s.action === name); return s ? this.t(s.at) : Infinity; }
  update(local, p, t) {
    super.update(local, p, t);
    const depol = easeOut((local - this.stage('depol')) / 1), release = easeOut((local - this.stage('release')) / 1), bind = easeOut((local - this.stage('bind')) / 1), inhibit = easeOut((local - this.stage('inhibit')) / 1.2);
    const classic = this.stages.some(s => s.action === 'classic'); const rate = classic || inhibit < 0.5 ? 1 : 0.25;
    const period = inhibit > 0.5 ? 9 : 4.5; const u = frac(t / period); const py = 56 - 48 * u; this.pulse.position.set(0, py, 0); this.pulse.material.opacity = py > 16 ? 0.9 : 0; const flash = py <= 16 && py > 10 ? 1 - (16 - py) / 6 : 0; this.preM.emissiveIntensity = 0.35 + 0.6 * flash;
    this.ves.forEach((v, i) => { const cyc = frac(t * 0.12 * rate + v.userData.ph / 6.28); const docking = i % 4 === 0; if (docking) { const uu = smooth(clamp(cyc * 2.2, 0, 1)); v.position.copy(v.userData.home).lerp(V3(v.userData.home.x * 0.6, 0.6, v.userData.home.z * 0.6), uu); v.scale.setScalar(0.9 * (1 - clamp((cyc - 0.5) * 6, 0, 1) * 0.9)); } else { v.position.copy(v.userData.home).add(V3(Math.sin(t + v.userData.ph) * 0.4, Math.cos(t * 1.3 + v.userData.ph) * 0.4, 0)); } v.material.opacity = inhibit > 0 ? 0.95 - 0.4 * inhibit : 0.95; });
    this.nt.forEach((s, i) => { const uu = frac(t * 0.35 * rate + s.userData.ph); const show = inhibit > 0.5 ? (i % 3 === 0) : true; s.position.set(s.userData.x + Math.sin(t * 2 + i) * 0.3, 0.2 - 2.2 * uu, s.userData.z); s.material.opacity = show ? Math.sin(uu * Math.PI) * 0.9 : 0; });
    this.ca.forEach((s, i) => { const uu = frac((local - this.stage('depol')) * 0.25 + s.userData.ph / 6.28); s.position.set(s.userData.x, -2.2 - uu * 6, s.userData.z + Math.sin(t + i) * 0.3); s.material.opacity = depol * Math.sin(uu * Math.PI); });
    this.postChan.forEach((c, i) => { c.material.emissiveIntensity = 0.5 + depol * (0.6 + 0.4 * Math.sin(t * 4 + i)); });
    this.dagl.visible = depol > 0; setOpacity(this.dagl, depol * (0.7 + 0.3 * Math.sin(t * 2))); this.daglLab.material.opacity = depol;
    this.ag.forEach((m, i) => { const uu = frac((local - this.stage('release')) * 0.22 + m.userData.ph); m.visible = release > 0; const from = V3(5 + Math.sin(i) * 2, -0.6, 1 + Math.cos(i) * 2), to = m.userData.target.pos.clone().add(V3(0, -1.6, 0)); const held = bind > 0 && i < 3; const u2 = held ? 1 : uu; m.position.copy(from).lerp(to, easeInOut(u2)); m.position.y += Math.sin(u2 * Math.PI) * 1.5; m.rotation.set(t * 0.8 + i, t * 0.5, 0); setOpacity(m, held ? 1 : clamp((1 - uu) * 4, 0, 1) * release); });
    this.agLab.position.copy(this.ag[0].position).add(V3(0, 2, 0)); this.agLab.material.opacity = release * (bind > 0 ? 0.6 : 1);
    this.cb1.forEach((c, i) => { c.gl.material.opacity = bind * (0.4 + 0.2 * Math.sin(t * 3 + i)); c.rc.userData.mat.emissiveIntensity = 0.35 + bind * 0.6; this.A('cb1_' + i, c.pos); });
    this.chan.scale.setScalar(1 - 0.55 * inhibit); this.chan.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(t * 5) * (depol > 0 ? 1 : 0.2) * (1 - inhibit);
    this.A('pre', V3(0, 8, 0)); this.A('post', V3(0, -8, 0)); this.A('cleft', V3(0, 0, 0)); this.A('axon', V3(0, 40, 0)); this.A('channel', this.chan.position); this.A('ag0', this.ag[0].position); this.A('dagl', this.dagl.position); this.A('pulse', this.pulse.position);
    this.camUpdate(local, () => { const c = this.camP; this.orbit(local, { radius: (c.radius || 42) - (c.dolly || 0) * easeOut(local / 10), height: c.height ?? 6, speed: c.speed || 0.05, phase: c.phase || 0.3, center: V3(0, 0.5, 0) }); });
  }
}

class NetworkSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.006, stars: 1800 }); const r = rng(p.seed || 5); this.ns = []; const N = p.n || 14; const centers = [];
    for (let i = 0; i < N; i++) centers.push(V3((r() - .5) * 90, (r() - .5) * 40, (r() - .5) * 60));
    centers.forEach((c, i) => { const j = (i + 1 + Math.floor(r() * (N - 2))) % N; const tgt = centers[j].clone().sub(c).add(V3(-2, 0, 0)); const n = neuron({ seed: 100 + i, axonTo: tgt, size: 1.1, color: i % 3 === 0 ? 0x7aa2ff : i % 3 === 1 ? 0x5eead4 : 0x93c5fd }); n.position.copy(c); n.rotation.y = r() * 6.28; this.scene.add(n); const pulses = []; for (let k = 0; k < 3; k++) { const s = glow(0xfff7d6, 2.6, 0.95); this.scene.add(s); pulses.push({ s, ph: r() }); } const term = glow(COL.teal, 6, 0); term.position.copy(n.localToWorld(tgt.clone())); this.scene.add(term); this.ns.push({ n, pulses, term, ph: r() * 6.28, c }); });
    this.stages = p.stages || []; this.camP = p.cam || {};
  }
  update(local, p, t) {
    super.update(local, p, t); const cb = this.stages.find(s => s.action === 'cb1') ? easeOut((local - this.t(this.stages.find(s => s.action === 'cb1').at)) / 1.5) : 0;
    this.ns.forEach((o, i) => { const ax = o.n.userData.axon; o.pulses.forEach((pu, k) => { const u = frac(t * 0.18 + pu.ph); const pt = ax.getPointAt(u); pu.s.position.copy(o.n.localToWorld(pt)); pu.s.material.opacity = 0.9 * Math.sin(u * Math.PI); if (k === 0) this.A('pulse' + i, pu.s.position); }); const flash = Math.pow(Math.max(0, Math.sin(t * 1.1 + o.ph)), 8); o.n.userData.mat.emissiveIntensity = 0.25 + flash * 0.8; o.term.material.opacity = cb * (0.45 + 0.25 * Math.sin(t * 3 + i)); this.A('neuron' + i, o.c); this.A('term' + i, o.term.position); });
    this.camUpdate(local, () => { const c = this.camP; this.cam.position.set(Math.sin(local * 0.05 + 1) * 30, 14 + Math.sin(local * 0.08) * 5, 105 - easeOut(local / 25) * (c.dolly || 30)); this.cam.lookAt(0, 0, 0); });
  }
}

// Enzyme: substrate travels into the enzyme, which pulses and releases fragments (cut) or a product (join).
class EnzymeSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.01 }); this.items = (p.items || []).map((it, i) => { const g = MOLS[it.mol].groups; const frags = [g[it.frags[0]], g[it.frags[1]]]; const m = molecule(it.mol, { scale: it.scale || 0.9, fragments: frags }); const pos = V3(...(it.pos || [0, 0, 0])); m.position.copy(pos); this.scene.add(m); const e = blob({ color: it.color ? col(it.color) : COL.violet, radius: 3.4, seed: 3 + i }); e.position.copy(pos).add(V3(0, -0.5, -1)); this.scene.add(e); const el = label(it.enzyme, { size: 2, color: '#c4b5fd', weight: 700 }); el.position.copy(pos).add(V3(0, 6, 0)); this.scene.add(el); const ml = label(it.label, { size: 1.6, color: '#e8eef7' }); ml.position.copy(pos).add(V3(0, -5.5, 0)); this.scene.add(ml); const pl = (it.products || []).map((pn, k) => { const l = label(pn, { size: 1.5, color: k ? '#60a5fa' : '#fb7185' }); l.material.opacity = 0; this.scene.add(l); return l; }); const cue = it.cue ? label(it.cue, { size: 1.4, color: '#fcd34d' }) : null; if (cue) { cue.position.copy(pos).add(V3(-9, 4, 0)); cue.material.opacity = 0; this.scene.add(cue); } const eg = glow(it.color ? col(it.color) : COL.violet, 18, 0.1); eg.position.copy(e.position); this.scene.add(eg); return { ...it, m, e, eg, el, ml, pl, pos, cue, i }; });
    this.camP = p.cam || {};
  }
  update(local, p, t) {
    super.update(local, p, t);
    this.items.forEach(it => {
      const mode = it.mode || 'cut'; const T = this.t(it.at); const appr = easeInOut((local - (T - 3)) / 3);
      const k = easeInOut((local - T) / 2.4); const sep = mode === 'cut' ? k : 1 - k; const [a, b] = it.m.userData.parts; const off = 8;
      if (mode === 'cut') it.m.position.copy(it.pos).add(V3(0, 10 * (1 - appr), 6 * (1 - appr))); else it.m.position.copy(it.pos);
      a.position.set(-off * sep, -1.5 * sep, 2 * sep); b.position.set(off * sep, 1.5 * sep, 2 * sep); a.rotation.z = -0.4 * sep; b.rotation.z = 0.4 * sep;
      if (mode === 'join') { const far = 1 - appr; a.position.x -= 6 * far; b.position.x += 6 * far; a.position.y += 6 * far; b.position.y -= 6 * far; }
      it.m.visible = mode === 'join' ? true : appr > 0 || local > T - 3;
      it.m.rotation.y = t * 0.3 + it.i; it.m.rotation.x = Math.sin(t * 0.25) * 0.25; it.e.rotation.y = t * 0.25; const squeeze = Math.sin(clamp((local - T + 0.4) / 1.2, 0, 1) * Math.PI); it.e.scale.setScalar(1 + 0.08 * Math.sin(t * 2) + 0.3 * squeeze); it.eg.material.opacity = 0.1 + 0.5 * squeeze; it.e.material.emissiveIntensity = 0.3 + 0.8 * squeeze;
      it.pl.forEach((l, n) => { l.material.opacity = mode === 'cut' ? easeOut((local - T - 1.8) / 0.8) : (1 - easeOut((local - T) / 0.8)); const part = n ? b : a; l.position.copy(it.m.position).add(V3(part.position.x * it.m.scale.x, 5 + part.position.y * it.m.scale.x, 0)); });
      it.ml.material.opacity = mode === 'cut' ? (appr > 0.2 ? 1 : 0) * (1 - easeOut((local - T - 0.6) / 0.8)) : easeOut((local - T - 1.6) / 0.8); it.ml.position.copy(it.m.position).add(V3(0, -5.5, 0));
      if (it.cue) it.cue.material.opacity = clamp(Math.sin(clamp((local - T + 1.5) / 3, 0, 1) * Math.PI), 0, 1);
      this.A('item' + it.i, it.m.position); this.A('enzyme' + it.i, it.e.position); this.A('fragA' + it.i, it.m.localToWorld(a.position.clone())); this.A('fragB' + it.i, it.m.localToWorld(b.position.clone()));
    });
    this.camUpdate(local, () => { const c = this.camP; this.orbit(local, { radius: c.radius || 26, height: c.height ?? 4, speed: c.speed || 0.06, phase: c.phase || 0.4, center: V3(...(c.center || [0, 0, 0])) }); });
  }
}

class VesiclesSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.012 }); const r = rng(p.seed || 6); this.vs = []; const n = p.n || 5;
    for (let i = 0; i < n; i++) { const g = new THREE.Group(); const rad = 6 + r() * 4; const sph = new THREE.Mesh(sphereGeo(28), new THREE.MeshPhongMaterial({ color: 0x2b4479, transparent: true, opacity: 0.55, shininess: 80, emissive: 0x16284f, emissiveIntensity: .3 })); sph.scale.setScalar(rad); g.add(sph);
      const heads = new THREE.InstancedMesh(sphereGeo(6), new THREE.MeshPhongMaterial({ color: 0x4a66a8 }), 420); const d = new THREE.Object3D(); for (let k = 0; k < 420; k++) { const u = r() * 6.28, v = Math.acos(2 * r() - 1); d.position.set(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)).multiplyScalar(rad * 1.02); d.scale.setScalar(0.32); d.updateMatrix(); heads.setMatrixAt(k, d.matrix); } g.add(heads);
      const recs = []; for (let k = 0; k < 3; k++) { const rc = receptor({ h: 3.2, r: 1.4 }); rc.scale.setScalar(0.5); const u = r() * 6.28, v = Math.acos(2 * r() - 1); const dir = V3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)); rc.position.copy(dir.clone().multiplyScalar(rad)); rc.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); g.add(rc); const gl = glow(COL.teal, 6, 0); gl.position.copy(dir.clone().multiplyScalar(rad + 1)); g.add(gl); recs.push({ rc, gl, dir, rad }); }
      g.position.set((r() - .5) * 60, (r() - .5) * 26, (r() - .5) * 40); g.userData = { ph: r() * 6.28, recs }; this.scene.add(g); this.vs.push(g); }
    this.probes = []; const pm = p.probe || 'CP55940'; for (let i = 0; i < (p.probes || 10); i++) { const m = molecule(pm, { scale: 0.5, hideH: true, tint: 0xfde68a }); const gl = glow(COL.amber, 9, 0.5); m.add(gl); this.scene.add(m); const v = this.vs[i % this.vs.length]; const rc = v.userData.recs[i % 3]; m.userData = { ph: r() * 6.28, start: V3((r() - .5) * 90, (r() - .5) * 50, (r() - .5) * 60), v, rc, bindAt: i === 0 ? 0 : r() }; this.probes.push(m); }
    this.probeLab = label(p.probeLabel || '[³H]CP-55,940', { size: 1.8, color: '#f59e0b' }); this.scene.add(this.probeLab);
    this.stages = p.stages || []; this.camP = p.cam || {};
  }
  update(local, p, t) {
    super.update(local, p, t); const bindStage = this.stages.find(s => s.action === 'bind'); const bk = bindStage ? easeInOut((local - this.t(bindStage.at)) / 3) : 0;
    this.vs.forEach((v, i) => { v.rotation.y = t * 0.08 + i; this.A('vesicle' + i, v.position); });
    this.probes.forEach((m, i) => { const kk = clamp((bk - m.userData.bindAt * 0.5) / 0.5, 0, 1); const drift = m.userData.start.clone().add(V3(Math.sin(t * 0.3 + m.userData.ph) * 6, Math.cos(t * 0.25 + m.userData.ph) * 4, Math.sin(t * 0.2 + i) * 5)); const rc = m.userData.rc; const dock = m.userData.v.localToWorld(rc.dir.clone().multiplyScalar(rc.rad + 2.2)); m.position.copy(drift).lerp(dock, easeInOut(kk)); m.rotation.set(t * 0.5 * (1 - kk), t * 0.4 + i, 0); rc.gl.material.opacity = kk * (0.4 + 0.2 * Math.sin(t * 3 + i)); if (i === 0) { this.A('probe0', m.position); this.A('dock0', dock); } });
    this.probeLab.position.copy(this.probes[0].position).add(V3(0, 4, 0));
    this.camUpdate(local, () => { const c = this.camP; this.orbit(local, { radius: c.radius || 52, height: c.height ?? 8, speed: c.speed || 0.05, phase: c.phase || 0.5, dolly: c.dolly || 0.4 }); });
  }
}

// DNA: a gene is read (a glow travels along the helix) and the receptor is expressed beside it; or a segment is deleted (knockout).
class DnaSet extends SetBase {
  constructor(sc, p) {
    super(sc, { ...p, fog: 0.008 }); this.h = dnaHelix({ len: 44, turns: 5, n: 150 }); this.scene.add(this.h);
    this.reader = glow(COL.amber, 9, 0); this.scene.add(this.reader);
    this.rc = receptor(); this.rc.position.set(14, -2, 4); this.rc.visible = false; this.scene.add(this.rc); this.rcLab = label(p.receptorLabel || 'CB1 receptor', { size: 2, color: '#2dd4bf' }); this.rcLab.position.set(14, 5, 4); this.rcLab.material.opacity = 0; this.scene.add(this.rcLab);
    this.geneLab = label(p.geneLabel || 'CNR1 gene', { size: 1.8, color: '#93c5fd' }); this.geneLab.position.set(-7, 26, 0); this.scene.add(this.geneLab);
    this.delLab = label(p.deleteLabel || 'gene deleted', { size: 1.8, color: '#fb7185' }); this.delLab.position.set(-8, 2, 0); this.delLab.material.opacity = 0; this.scene.add(this.delLab);
    this.stages = p.stages || []; this.camP = p.cam || {};
  }
  stage(n) { const s = this.stages.find(s => s.action === n); return s ? this.t(s.at) : Infinity; }
  update(local, p, t) {
    super.update(local, p, t); const h = this.h; h.rotation.y = t * 0.12;
    const unwind = easeInOut((local - this.stage('unwind')) / 2.5), read = clamp((local - this.stage('read')) / 6, 0, 1), expr = easeOut((local - this.stage('express')) / 1.5), del = easeInOut((local - this.stage('delete')) / 2);
    const ry = -22 + 44 * read;
    const strand = (arr) => arr.forEach(s => { const b = s.userData.base; const near = Math.exp(-Math.pow((b.y - ry) / 3, 2)) * (read > 0 && read < 1 ? 1 : 0); s.position.copy(b).add(V3(Math.sign(b.x) * (1.8 * near + 0.4) * unwind, 0, Math.sign(b.z) * 1.0 * near * unwind)); s.material.emissiveIntensity = 0.3 + near; const gone = del > 0 && Math.abs(b.y) < 7 ? del : 0; s.scale.setScalar(0.3 * (1 - gone)); });
    strand(h.userData.s1); strand(h.userData.s2);
    h.userData.rungs.forEach(c => { const gone = del > 0 && Math.abs(c.userData.p1.y) < 7 ? del : 0; c.scale.set(.08 * (1 - gone) + 0.0001, 4 * (1 - gone) + 0.001, .08 * (1 - gone) + 0.0001); });
    this.reader.position.set(Math.cos(h.rotation.y + read * 5 * 6.28) * 2.2, ry, Math.sin(h.rotation.y + read * 5 * 6.28) * 2.2); this.reader.material.opacity = read > 0 && read < 1 ? 0.9 : 0; this.A('reader', this.reader.position);
    this.rc.visible = expr > 0; popIn(this.rc, expr); this.rc.position.y = -2 + 4 * expr; this.rc.rotation.y = t * 0.3; this.rcLab.material.opacity = easeOut((local - this.stage('express') - 1) / 0.8); this.rcLab.position.y = this.rc.position.y + 7;
    this.delLab.material.opacity = del; this.A('helix', V3(0, 0, 0)); this.A('top', V3(0, 20, 0)); this.A('receptor', this.rc.position); this.A('gene', V3(0, 0, 0));
    this.camUpdate(local, () => this.orbit(local, { radius: 40, height: 6, speed: 0.05, phase: 0.6 }));
  }
}

const SETS = { title: TitleSet, molecules: MoleculesSet, mixture: MixtureSet, timeline: TimelineSet, membrane: MembraneSet, brain: BrainSet, synapse: SynapseSet, network: NetworkSet, enzyme: EnzymeSet, vesicles: VesiclesSet, dna: DnaSet };

// ---------- driver API ----------
window.init = async ({ spec, molecules }) => {
  SPEC = spec; MOLS = molecules; canvas = document.getElementById('c');
  await document.fonts.ready;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setSize(W, H, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  fadeScene = new THREE.Scene(); fadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false })); fadeScene.add(fadeMesh);
  const vc = document.createElement('canvas'); vc.width = 512; vc.height = 288; const g = vc.getContext('2d'); const gr = g.createRadialGradient(256, 144, 120, 256, 144, 330); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
  vignette = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(vc), transparent: true, depthTest: false })); fadeScene.add(vignette);
  window.ready = true;
};

function getSet(idx) {
  if (built[idx]) return built[idx];
  const sc = SPEC.scenes[idx]; const Cls = SETS[(sc.set && sc.set.type) || 'title'] || TitleSet;
  built[idx] = new Cls(sc, sc.set || {});
  for (const k in built) if (+k < idx - 1) { built[k].dispose(); delete built[k]; }
  return built[idx];
}

window.renderAt = (t) => {
  const scenes = SPEC.scenes; let idx = 0;
  for (let i = 0; i < scenes.length; i++) { if (t >= scenes[i].start - FADE * 0.5) idx = i; }
  const sc = scenes[idx]; const set = getSet(idx);
  const local = Math.max(0, t - sc.start); const p = clamp(local / sc.duration, 0, 1);
  set.update(local, p, t);
  set.scene.traverse(o => { if (o.userData && o.userData.isLabel && o.material) { const d = o.getWorldPosition(new THREE.Vector3()).distanceTo(set.cam.position); o.material.opacity *= clamp((d - 7) / 8, 0, 1); } });
  const end = sc.start + sc.duration + SPEC.gap; let fade = 0;
  if (t < sc.start) fade = 1 - easeOut((t - (sc.start - FADE * 0.5)) / (FADE * 0.5)); else if (t < sc.start + FADE * 0.5) fade = 1 - easeOut((t - sc.start) / (FADE * 0.5));
  if (t > end - FADE) fade = Math.max(fade, easeOut((t - (end - FADE)) / FADE));
  renderer.autoClear = true; renderer.render(set.scene, set.cam);
  renderer.autoClear = false; vignette.material.opacity = 1; fadeMesh.material.opacity = fade; renderer.render(fadeScene, fadeCam);
  return canvas.toDataURL('image/jpeg', 0.92);
};
