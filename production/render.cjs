// Kingdom Nasser renderer: plan JSON -> MP4 with motion graphics, sound design and recitation.
// Usage: node production/render.cjs <plan.json> <out.mp4> [--format 9x16|16x9] [--voice <file>] [--voice-gain 1.0] [--voice-offset 0]
// - Quranic text is read only from production/data (Tanzil), never typed.
// - Audio: varied synthesised effects and a natural bed (no music, no bells), authentic per-verse recitation, optional human voice-over.
//   voice-over (or a recitation the owner holds rights to) can be mixed in.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { verse, ATTRIBUTION } = require('./quran.cjs');
const facts = require('./facts.cjs');
const recitation = require('./recitation.cjs');

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
      if (plan.recitation !== false) {
        const reciter = plan.reciter || 'maher';
        const file = recitation.fileFor(s.verse, reciter);
        const len = recitation.duration(file);
        sc.audio = { file, offset: 0.9, length: len };
        sc.duration = Math.max(sc.duration, len + 2.2);
        sc.sub = 'بصوت ' + recitation.RECITERS[reciter].name;
      }
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

  // soundtrack: varied effects + natural bed (no music, no bells), recitation, optional voice-over
  const starts = []; { let acc = 0; for (const sc of scenes) { starts.push(acc); acc += sc.duration; } }
  const events = [], duck = [], recitations = [];
  const rotate = ['drops', 'rustle', 'breath', 'drop', 'bird'];
  let rot = 0;
  scenes.forEach((sc, i) => {
    const t0 = starts[i];
    const words = String(sc.text || '').split(/\s+/).filter(Boolean);
    const reveal = sc.type === 'ayah' ? 0 : Math.min(0.16, (sc.duration * 0.4) / Math.max(1, words.length));
    if (i > 0 && sc.type !== 'ayah' && sc.type !== 'name') events.push({ t: t0 - 0.45, kind: 'whoosh', gain: 0.55 });
    if (sc.type === 'hook') { events.push({ t: t0 + 0.05, kind: 'boom', gain: 0.8 }, { t: t0 + 0.5, kind: 'sparkle', gain: 0.8 }); }
    if (sc.type === 'name') { events.push({ t: Math.max(0, t0 - 1.5), kind: 'swell', gain: 0.9 }, { t: t0 + 0.05, kind: 'boom', gain: 1.0 }, { t: t0 + 0.35, kind: 'sparkle', gain: 1.0 }); }
    if (sc.type === 'text') { events.push({ t: t0 + 0.2, kind: rotate[rot++ % rotate.length], gain: 0.9 }); }
    if (sc.type === 'outro') { events.push({ t: t0 + 0.05, kind: 'boom', gain: 0.6 }, { t: t0 + 0.4, kind: 'sparkle', gain: 0.8 }, { t: t0 + 1.2, kind: 'bird', gain: 0.8 }); }
    if (sc.type === 'surahs') { events.push({ t: t0 + 0.6, kind: 'swell', gain: 0.6 }); (sc.items || []).forEach((_, j) => events.push({ t: t0 + 2.4 + j * 0.12, kind: 'drop', gain: 0.5 })); }
    if (sc.type === 'dots') { events.push({ t: t0 + 0.5, kind: 'rustle', gain: 0.7 }); (sc.marks || []).forEach((_, j) => events.push({ t: t0 + 2.3 + j * 0.5, kind: 'drop', gain: 0.8 })); }
    // a small accent on each highlighted word as it appears
    (sc.highlight || []).forEach((h) => { const j = words.findIndex((w) => w.includes(h)); if (j > -1 && sc.type !== 'name') events.push({ t: t0 + 0.2 + j * reveal, kind: 'drop', gain: 0.5 }); });
    if (sc.type === 'ayah') {
      events.push({ t: Math.max(0, t0 - 1.0), kind: 'swell', gain: 0.6 });
      if (sc.audio) { const a = t0 + sc.audio.offset; recitations.push({ file: sc.audio.file, at: a }); duck.push([a, a + sc.audio.length]); }
    }
  });
  const specPath = path.join(tmp, 'sound.json');
  const fxWav = path.join(tmp, 'sound.wav');
  const bedKind = arg('ambience', plan.ambience || 'forest');
  fs.writeFileSync(specPath, JSON.stringify({ total, events, duck, bed: { kind: bedKind, gain: 0.32 } }));
  execFileSync('python3', [path.join(__dirname, 'engine', 'sound.py'), specPath, fxWav], { cwd: path.join(__dirname, 'engine') });
  const voice = arg('voice');
  const inputs = ['-i', silent, '-i', fxWav];
  const parts = [`[1:a]volume=${voice ? 0.6 : 1.0}[fx]`];
  const mixIn = ['[fx]'];
  for (const r of recitations) {
    inputs.push('-i', r.file);
    const idx = inputs.length / 2 - 1, ms = Math.round(r.at * 1000);
    parts.push(`[${idx}:a]aresample=44100,adelay=${ms}|${ms},volume=1.15[r${idx}]`); mixIn.push(`[r${idx}]`);
  }
  if (voice) {
    const gain = Number(arg('voice-gain', '1.0'));
    const offsetMs = Math.round(Number(arg('voice-offset', '0')) * 1000);
    inputs.push('-i', voice);
    const idx = inputs.length / 2 - 1;
    parts.push(`[${idx}:a]aresample=44100,adelay=${offsetMs}|${offsetMs},volume=${gain}[v]`); mixIn.push('[v]');
  }
  const filter = parts.join(';') + ';' + mixIn.join('') + `amix=inputs=${mixIn.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ out: outPath, format, width: W, height: H, seconds: total, frames, effects: events.length, recitations: recitations.length }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
