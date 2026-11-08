// Counts facts directly from the verified Tanzil text, so every number shown
// in a video is computed, never quoted from memory.
const fs = require('fs');
const path = require('path');

const lines = fs.readFileSync(path.join(__dirname, 'data', 'quran-uthmani.txt'), 'utf8').split('\n');
const verses = [];
for (const l of lines) { const m = l.match(/^(\d+)\|(\d+)\|(.+)$/); if (m) verses.push({ s: +m[1], a: +m[2], text: m[3] }); }

/** Strips diacritics and Quranic marks so words can be compared. */
function plain(t) {
  return t.replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي');
}
const words = (t) => plain(t).split(/\s+/).filter(Boolean);

// In the Tanzil file, verse 1 of each surah (except 1 and 9) starts with the basmala.
const BASMALA = 4;
function openingWords(v) { const w = words(v.text); return v.s !== 1 && v.s !== 9 && w[0] === 'بسم' ? w.slice(BASMALA) : w; }
function surahsOpeningWith(prefixes) {
  return verses.filter((v) => v.a === 1 && prefixes.some((p) => openingWords(v)[0].startsWith(p)))
    .map((v) => ({ surah: v.s, firstWord: v.text.split(/\s+/)[v.s !== 1 && v.s !== 9 && words(v.text)[0] === 'بسم' ? BASMALA : 0] }));
}
function versesWithWord(exact) {
  return verses.filter((v) => words(v.text).includes(exact)).map((v) => `${v.s}:${v.a}`);
}

module.exports = { verses, plain, words, surahsOpeningWith, versesWithWord };

if (require.main === module) {
  console.log(JSON.stringify({
    totalVerses: verses.length,
    openingWithTasbih: surahsOpeningWith(['سبح', 'يسبح']),
    alWahhab: versesWithWord('الوهاب'),
  }, null, 1));
}
