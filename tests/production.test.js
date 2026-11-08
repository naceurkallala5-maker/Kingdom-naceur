import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verse } = require('../production/quran.cjs');

test('Quran text is loaded complete from the Tanzil file', () => {
  const v = verse('3:8');
  assert.equal(v.surahName, 'آل عمران');
  assert.ok(v.text.length > 40);
  assert.equal(verse('38:35').surahName, 'ص');
  assert.throws(() => verse('115:1'));
});

test('the Tanzil file is the exact verified copy that was downloaded', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const hash = createHash('sha256').update(readFileSync(new URL('../production/data/quran-uthmani.txt', import.meta.url))).digest('hex');
  assert.equal(hash, '6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f');
});

test('every verse used in production plans exists in the verified text', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../production/plans/', import.meta.url))) {
    const plan = JSON.parse(readFileSync(new URL(`../production/plans/${f}`, import.meta.url), 'utf8'));
    for (const s of plan.scenes) {
      if (s.type === 'ayah') assert.ok(verse(s.verse).text.length > 0, `${f}: ${s.verse}`);
      else assert.ok(!/[A-Za-z]/.test(s.text + (s.sub || '')), `${f}: Latin text in scene`);
      assert.ok(!('text' in s && s.type === 'ayah'), `${f}: ayah text must come from the mushaf file, not the plan`);
    }
  }
});
