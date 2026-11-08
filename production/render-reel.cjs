// Renders a silent vertical reel (1080x1920, 30 fps) from a production plan.
// Usage: node production/render-reel.cjs <plan.json> <out.mp4>
// Audio is intentionally absent: a licensed recitation is chosen from
// Instagram's own audio library at publishing time, with the owner's approval.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { verse, ATTRIBUTION } = require('./quran.cjs');

const FPS = 30;
const LATIN = /[A-Za-z]/;

function buildScenes(plan) {
  return plan.scenes.map((s, i) => {
    const sc = { ...s, duration: s.duration || 4.5 };
    if (s.type === 'ayah') {
      const v = verse(s.verse);
      sc.text = v.text;
      sc.ref = `سورة ${v.surahName} · الآية ${v.ayah}`;
    }
    for (const field of ['text', 'sub', 'ref']) {
      if (sc[field] && LATIN.test(sc[field])) throw new Error(`Scene ${i + 1}: ${field} must be Arabic only`);
    }
    return sc;
  });
}

const PAGE = `<!doctype html><html lang="ar" dir="ltr"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@500;700&family=Cinzel:wght@700&display=swap">
<style>
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#0d1d52;position:relative}
.brand,.credit{direction:rtl}
#bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,#2b57c6 0,#1d3a8a 45%,#0b1a4a 100%)}
#pat{position:absolute;inset:-200px;opacity:.10;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cg fill='none' stroke='%23a9c6f2' stroke-width='2'%3E%3Crect x='40' y='40' width='60' height='60'/%3E%3Crect x='40' y='40' width='60' height='60' transform='rotate(45 70 70)'/%3E%3C/g%3E%3C/svg%3E")}
#frame{position:absolute;inset:60px;border:3px solid rgba(255,255,255,.55);border-radius:28px}
#frame2{position:absolute;inset:78px;border:1.5px solid rgba(169,198,242,.45);border-radius:20px}
.scene{direction:rtl;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 130px;text-align:center;color:#fff;opacity:0}
.hook{font-family:'IBM Plex Sans Arabic';font-weight:700;font-size:92px;line-height:1.5}
.text{font-family:'IBM Plex Sans Arabic';font-weight:500;font-size:70px;line-height:1.7}
.ayah{font-family:'Amiri Quran';font-size:84px;line-height:2.05;color:#fff}
.ref{margin-top:50px;font-family:'Amiri';font-size:46px;color:#a9c6f2}
.sub{margin-top:36px;font-family:'Amiri';font-size:52px;color:#d7e6fa}
.orn{font-size:60px;color:#a9c6f2;margin-bottom:30px;font-family:'Amiri'}
.brand{position:absolute;bottom:120px;left:0;right:0;text-align:center;color:#d7e6fa}
.brand .w{font-family:'Cinzel';font-weight:700;letter-spacing:10px;font-size:40px;color:#fff}
.brand .a{font-family:'Amiri';font-size:30px;margin-top:4px}
.credit{position:absolute;top:110px;left:0;right:0;text-align:center;font-family:'Amiri';font-size:28px;color:rgba(215,230,250,.7)}
.outro .crown{width:260px;height:200px;margin-bottom:40px}
.scene>div{max-width:820px}
</style></head><body><div id="bg"></div><div id="pat"></div><div id="frame"></div><div id="frame2"></div>
<div id="stage"></div>
<div class="brand"><div class="w">KINGDOM</div><div class="a">ناصر</div></div>
<div class="credit" id="credit"></div>
<script>
const CROWN='<svg class="crown" viewBox="-260 -240 520 420"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#bcd5f7"/></linearGradient></defs><path d="M-230 110 L-250 -120 L-120 10 L0 -190 L120 10 L250 -120 L230 110 Z" fill="url(#cg)"/><rect x="-235" y="120" width="470" height="44" rx="10" fill="url(#cg)"/><g fill="#fff"><g transform="translate(0 -222) scale(24)"><rect x="-1" y="-1" width="2" height="2"/><rect x="-1" y="-1" width="2" height="2" transform="rotate(45)"/></g><g transform="translate(-262 -148) scale(18)"><rect x="-1" y="-1" width="2" height="2"/><rect x="-1" y="-1" width="2" height="2" transform="rotate(45)"/></g><g transform="translate(262 -148) scale(18)"><rect x="-1" y="-1" width="2" height="2"/><rect x="-1" y="-1" width="2" height="2" transform="rotate(45)"/></g></g></svg>';
let scenes=[],starts=[];
function setup(data){
  scenes=data.scenes; document.getElementById('credit').textContent=data.credit||'';
  let t=0; const st=document.getElementById('stage');
  scenes.forEach((s,i)=>{starts.push(t); t+=s.duration;
    const d=document.createElement('div'); d.className='scene '+s.type; d.id='s'+i;
    if(s.type==='outro') d.insertAdjacentHTML('beforeend',CROWN);
    if(s.type==='ayah'){const o=document.createElement('div');o.className='orn';o.textContent='﴿ ﴾';d.append(o);}
    const m=document.createElement('div'); m.className=s.type==='ayah'?'ayah':(s.type==='hook'||s.type==='outro'?'hook':'text'); m.textContent=s.text; d.append(m);
    if(s.ref){const r=document.createElement('div');r.className='ref';r.textContent=s.ref;d.append(r);}
    if(s.sub){const r=document.createElement('div');r.className='sub';r.textContent=s.sub;d.append(r);}
    st.append(d);});
  return t;
}
function render(t){
  document.getElementById('pat').style.transform='translate('+(t*6)%140+'px,'+(t*4)%140+'px)';
  scenes.forEach((s,i)=>{const el=document.getElementById('s'+i); const lt=t-starts[i]; const D=s.duration, f=0.6;
    let o=0; if(lt>=0&&lt<=D){o=Math.min(1,lt/f,(D-lt)/f); if(i===scenes.length-1) o=Math.min(1,lt/f);}
    el.style.opacity=o; el.style.transform='translateY('+((1-o)*40)+'px) scale('+(0.98+0.02*o)+')';});
}
</script></body></html>`;

async function main() {
  const [planPath, outPath] = process.argv.slice(2);
  if (!planPath || !outPath) throw new Error('Usage: node render-reel.cjs <plan.json> <out.mp4>');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const scenes = buildScenes(plan);
  const hasAyah = scenes.some((s) => s.type === 'ayah');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.setContent(PAGE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const total = await page.evaluate((d) => setup(d), { scenes, credit: hasAyah ? ATTRIBUTION : '' });
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(total * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', outPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => render(t), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed ' + c)))));
  await browser.close();
  console.log(JSON.stringify({ out: outPath, seconds: total, frames }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
