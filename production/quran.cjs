// Verbatim Quran text from the Tanzil Project (Uthmani, CC BY 3.0).
// The text is only ever read from data/quran-uthmani.txt, never typed or generated.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
let verses = null;
let suras = null;

function load() {
  if (verses) return;
  verses = new Map();
  for (const line of fs.readFileSync(path.join(DATA, 'quran-uthmani.txt'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)\|(\d+)\|(.+)$/);
    if (m) verses.set(`${m[1]}:${m[2]}`, m[3].trim());
  }
  if (verses.size !== 6236) throw new Error(`Quran text incomplete: ${verses.size} verses`);
  suras = new Map();
  const xml = fs.readFileSync(path.join(DATA, 'quran-data.xml'), 'utf8');
  for (const m of xml.matchAll(/<sura index="(\d+)" ayas="\d+" start="\d+" name="([^"]+)"/g)) suras.set(Number(m[1]), m[2]);
}

/** Returns {key, text, surahName, ayah} for a key like "3:8". Throws if missing. */
function verse(key) {
  load();
  const text = verses.get(key);
  if (!text) throw new Error(`Verse not found: ${key}`);
  const [s, a] = key.split(':').map(Number);
  return { key, text, surahName: suras.get(s), ayah: a };
}

module.exports = { verse, ATTRIBUTION: 'نص المصحف من مشروع تنزيل (الرسم العثماني)' };
