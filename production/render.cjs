// Kingdom Nasser renderer: plan JSON -> MP4 with motion graphics and chimes.
// Usage: node production/render.cjs <plan.json> <out.mp4> [--format 9x16|16x9] [--voice <file>] [--voice-gain 1.0] [--voice-offset 0]
// - Quranic text is read only from production/data (Tanzil), never typed.
// - Audio: soft chimes at each text change; no music. An uploaded human
//   voice-over (or a recitation the owner holds rights to) can be mixed in.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { verse, ATTRIBUTION } = require('./quran.cjs');
const facts = require('./facts.cjs');

const FPS = 30;
const FORMATS = { '9x16': [1080, 1920], '16x9': [1920, 1080] };
const LATIN = /[A-Za-z]/;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

function prepare(plan) {
  return plan.scenes.map((s, i) => {
    const sc = { ...s, duration: Number(s.duration) || 4 };
    if (s.type === 'ayah') {
      if (s.text) throw new Error(`Scene ${i + 1}: verse text must come from the mushaf file, not the plan`);
      const v = verse(s.verse);
      sc.text = v.text;
      sc.ref = `سورة ${v.surahName} · الآية ${v.ayah}`;
    }
    if (s.type === 'surahs') {
      // computed from the mushaf text: surahs whose first word starts with one of the prefixes
      sc.items = facts.surahsOpeningWith(s.opening || []);
      if (!sc.items.length) throw new Error(`Scene ${i + 1}: no surah matches`);
    }
    if (s.type === 'dots') {
      const keys = facts.versesWithWord(s.word);
      const index = (k) => facts.verses.findIndex((v) => `${v.s}:${v.a}` === k);
      sc.total = facts.verses.length;
      sc.marks = keys.map((k) => { const v = verse(k); return { index: index(k), label: `${v.surahName} ${v.ayah}` }; });
    }
    if (!['hook', 'text', 'ayah', 'name', 'outro', 'surahs', 'dots'].includes(sc.type)) throw new Error(`Scene ${i + 1}: unknown type ${sc.type}`);
    for (const f of ['text', 'kicker', 'sub']) {
      if (sc[f] && LATIN.test(sc[f]) && !plan.allowLatin) throw new Error(`Scene ${i + 1}: ${f} has Latin letters`);
    }
    return sc;
  });
}

async function main() {
  const [planPath, outPath] = process.argv.slice(2);
  if (!planPath || !outPath) throw new Error('Usage: node production/render.cjs <plan.json> <out.mp4> [--format 9x16|16x9]');
  const format = arg('format', '9x16');
  const [W, H] = FORMATS[format] || FORMATS['9x16'];
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const scenes = prepare(plan);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-'));
  const silent = path.join(tmp, 'video.mp4');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'engine', 'engine.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const { total, cues } = await page.evaluate((d) => E.setup(d), {
    width: W, height: H, scenes, theme: plan.theme || 'royal', credit: scenes.some((s) => s.type === 'ayah') ? ATTRIBUTION : '',
  });
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(total * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => E.render(t), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error('ffmpeg video ' + c)) : res())));
  await browser.close();

  // soundtrack: chimes only, plus optional human voice-over
  const cuesPath = path.join(tmp, 'cues.json');
  const chimes = path.join(tmp, 'chimes.wav');
  fs.writeFileSync(cuesPath, JSON.stringify(cues));
  execFileSync('python3', [path.join(__dirname, 'engine', 'chimes.py'), cuesPath, String(total), chimes]);
  // natural soundscape (no music): wind, rain, water or night
  const ambienceKind = arg('ambience', plan.ambience || 'none');
  const voice = arg('voice');
  const inputs = ['-i', silent, '-i', chimes];
  const parts = ['[1:a]volume=' + (voice ? '0.55' : '1.0') + '[c]'];
  const mixIn = ['[c]'];
  if (ambienceKind !== 'none') {
    const amb = path.join(tmp, 'ambience.wav');
    execFileSync('python3', [path.join(__dirname, 'engine', 'ambience.py'), ambienceKind, String(total), amb]);
    inputs.push('-i', amb);
    parts.push(`[${inputs.length / 2 - 1}:a]volume=${voice ? 0.25 : 0.45}[b]`); mixIn.push('[b]');
  }
  if (voice) {
    const gain = Number(arg('voice-gain', '1.0'));
    const offsetMs = Math.round(Number(arg('voice-offset', '0')) * 1000);
    inputs.push('-i', voice);
    parts.push(`[${inputs.length / 2 - 1}:a]adelay=${offsetMs}|${offsetMs},volume=${gain}[v]`); mixIn.push('[v]');
  }
  const filter = parts.join(';') + ';' + mixIn.join('') + `amix=inputs=${mixIn.length}:duration=first:normalize=0[a]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outPath]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ out: outPath, format, width: W, height: H, seconds: total, frames, chimes: cues.length }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
