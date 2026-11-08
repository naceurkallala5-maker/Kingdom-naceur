// Authentic human recitation, one file per verse, from everyayah.com.
// Recitations are never generated: they are downloaded recordings of known
// reciters, cached in production/data/recitations (not committed).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, 'data', 'recitations');
const RECITERS = {
  maher: { folder: 'MaherAlMuaiqly128kbps', name: 'الشيخ ماهر المعيقلي' },
  alafasy: { folder: 'Alafasy_128kbps', name: 'الشيخ مشاري العفاسي' },
  sudais: { folder: 'Abdurrahmaan_As-Sudais_192kbps', name: 'الشيخ عبد الرحمن السديس' },
  shuraim: { folder: 'Saood_ash-Shuraym_128kbps', name: 'الشيخ سعود الشريم' },
  dossary: { folder: 'Yasser_Ad-Dussary_128kbps', name: 'الشيخ ياسر الدوسري' },
};

function fileFor(key, reciter = 'maher') {
  const r = RECITERS[reciter];
  if (!r) throw new Error(`Unknown reciter: ${reciter}`);
  const [s, a] = key.split(':').map(Number);
  const id = String(s).padStart(3, '0') + String(a).padStart(3, '0');
  const local = path.join(DIR, `${r.folder}-${id}.mp3`);
  if (!fs.existsSync(local)) {
    fs.mkdirSync(DIR, { recursive: true });
    execFileSync('curl', ['-sS', '-f', '-o', local, `https://everyayah.com/data/${r.folder}/${id}.mp3`]);
  }
  return local;
}

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

module.exports = { fileFor, duration, RECITERS };
