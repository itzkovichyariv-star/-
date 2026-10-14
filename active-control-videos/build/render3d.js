#!/usr/bin/env node
/**
 * Render one episode with the 3D engine (build/scene3d/engine.html) to MP4.
 *
 *   node render3d.js <episode.json> <audio_dir> <out.mp4> [--fps 24] [--clip START END] [--stills]
 *
 * audio_dir must contain narration.wav, timing.json (from tts.py) and overlay.ass (from ass.py).
 * Frames come from headless Chromium (SwiftShader WebGL) as JPEG data URLs and are piped into ffmpeg,
 * which burns the ASS text overlay (captions, lower-thirds, title cards) and muxes the narration.
 *   --clip START END   render only that window (seconds); still burns text, no audio
 *   --stills           write one PNG per scene (at 55% of the scene) to <out>.stills/ instead of a video
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright');

const [,, epPath, audioDir, outPath, ...rest] = process.argv;
const arg = (k, d) => rest.includes(k) ? rest[rest.indexOf(k) + 1] : d;
const FPS = parseInt(arg('--fps', '24'), 10);
const CLIP = rest.includes('--clip') ? [parseFloat(arg('--clip')), parseFloat(rest[rest.indexOf('--clip') + 2])] : null;
const STILLS = rest.includes('--stills');

const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.resolve(audioDir, 'timing.json'), 'utf8'));
const molecules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'molecules', 'molecules.json'), 'utf8'));
const spec = { gap: timing.gap, total: timing.total, scenes: timing.scenes.map((ts, i) => ({ id: ts.id, start: ts.start, duration: ts.duration, set: ep.scenes[i].scene3d || { type: 'title', mol: 'THC' } })) };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'scene3d', 'engine.html'));
  await page.evaluate(({ spec, molecules }) => window.init({ spec, molecules }), { spec, molecules });
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });

  if (STILLS) {
    const dir = outPath + '.stills'; fs.mkdirSync(dir, { recursive: true });
    for (const ts of timing.scenes) {
      for (const f of [0.15, 0.55, 0.9]) {
        const t = ts.start + ts.duration * f;
        const data = await page.evaluate((t) => window.renderAt(t), t);
        fs.writeFileSync(path.join(dir, `${ts.id}-${f}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
      }
    }
    await browser.close(); console.log('stills written to', dir); return;
  }

  const t0s = CLIP ? CLIP[0] : 0, t1s = CLIP ? CLIP[1] : timing.total;
  const nFrames = Math.ceil((t1s - t0s) * FPS);
  const ass = path.resolve(audioDir, 'overlay.ass');
  const vf = fs.existsSync(ass) ? [`subtitles=${ass.replace(/([\\:])/g, '\\$1')}:fontsdir=${path.resolve(__dirname, '..', 'assets', 'fonts')}`] : [];
  if (CLIP) vf.unshift(`setpts=PTS+${t0s}/TB`);  // shift timestamps so the ASS overlay lines up with the clip window
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (!CLIP) ffArgs.push('-i', path.resolve(audioDir, 'narration.wav'));
  if (vf.length) ffArgs.push('-vf', vf.join(','));
  ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-r', String(FPS));
  if (!CLIP) ffArgs.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
  if (CLIP) ffArgs.push('-vsync', 'cfr');
  ffArgs.push('-movflags', '+faststart', outPath);
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < nFrames; i++) {
    const t = t0s + i / FPS;
    const data = await page.evaluate((t) => window.renderAt(t), t);
    const buf = Buffer.from(data.split(',')[1], 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 240 === 0) console.log(`${ep.id}: frame ${i}/${nFrames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  await browser.close();
  console.log(`${ep.id}: wrote ${outPath} (${((t1s - t0s) / 60).toFixed(2)} min, ${nFrames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
