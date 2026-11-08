// Automated guard for the Arabic-only rule (CLAUDE.md, section 1).
// Fails if any user-facing text contains Latin letters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsLatin, isArabicText } from '../src/arabic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ar = JSON.parse(read('locales/ar.json'));

function leaves(obj, path = '') {
  if (typeof obj === 'string') return [[path, obj]];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

test('every Arabic locale string is free of Latin letters', () => {
  for (const [key, value] of leaves(ar)) {
    // Strip interpolation placeholders like {name}; they are code, not text.
    const visible = value.replace(/\{\w+\}/g, '');
    assert.ok(!containsLatin(visible), `Latin text in locales/ar.json at "${key}": ${value}`);
  }
});

test('index.html declares Arabic RTL and shows no Latin text', () => {
  const html = read('public/index.html');
  assert.match(html, /<html lang="ar" dir="rtl">/);
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<head>[\s\S]*?<\/head>/, '');
  const text = body.replace(/<[^>]+>/g, ' ');
  assert.ok(!containsLatin(text), `Latin text visible in index.html: ${text.match(/[A-Za-z]+/)}`);
  for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
    for (const m of html.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))) {
      assert.ok(!containsLatin(m[1]), `Latin text in ${attr} attribute: ${m[1]}`);
    }
  }
});

test('every data-i18n key used by the page exists in ar.json', () => {
  const html = read('public/index.html');
  const lookup = (key) => key.split('.').reduce((o, p) => o?.[p], ar);
  for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
    assert.equal(typeof lookup(m[1]), 'string', `Missing locale key: ${m[1]}`);
  }
});

test('browser code never hardcodes visible text', () => {
  const js = read('public/app.js');
  // No Arabic literals in code: all Arabic must live in ar.json.
  assert.ok(!/[؀-ۿ]/.test(js.replace(/\/\/.*$/gm, '')), 'Arabic literal found in public/app.js');
  // No literal strings assigned to visible properties.
  assert.ok(!/(textContent|innerText|innerHTML|placeholder)\s*=\s*['"`]/.test(js), 'Literal text assigned in public/app.js');
  assert.ok(!/\btext:\s*['"]/.test(js), 'Literal text passed to el() in public/app.js');
  // Template strings passed as visible text may only combine translated values.
  for (const m of js.matchAll(/\btext:\s*`([^`]*)`/g)) {
    const literal = m[1].replace(/\$\{[^}]*\}/g, '');
    assert.ok(!/[A-Za-z\u0600-\u06FF]/.test(literal), `Literal text in template: ${m[1]}`);
  }
  // Every t('...') key referenced statically must exist.
  const lookup = (key) => key.split('.').reduce((o, p) => o?.[p], ar);
  for (const m of js.matchAll(/\bt\('([\w.]+)'/g)) {
    assert.ok(lookup(m[1]) !== undefined, `Missing locale key in app.js: ${m[1]}`);
  }
});

test('every status, task status, approval kind and decision has an Arabic label', async () => {
  const { STATUSES, TASK_STATUSES, APPROVAL_KINDS, APPROVAL_DECISIONS } = await import('../src/office.js');
  for (const s of STATUSES) assert.ok(isArabicText(ar.status[s]), `status.${s}`);
  for (const s of TASK_STATUSES) assert.ok(isArabicText(ar.taskStatus[s]), `taskStatus.${s}`);
  for (const k of APPROVAL_KINDS) assert.ok(isArabicText(ar.approvalKind[k]), `approvalKind.${k}`);
  for (const d of APPROVAL_DECISIONS) assert.ok(isArabicText(ar.decision[d]), `decision.${d}`);
});

test('every event type the office records has an Arabic description', () => {
  const src = read('src/office.js');
  for (const m of src.matchAll(/type:\s*'(\w+)'/g)) {
    const value = String(ar.events[m[1]] ?? '').replace(/\{\w+\}/g, '');
    assert.ok(isArabicText(value), `events.${m[1]} missing`);
  }
});

test('every error code the server can send has an Arabic message', () => {
  const sources = readdirSync(join(ROOT, 'src')).map((f) => read(join('src', f))).join('\n');
  const codes = new Set();
  for (const m of sources.matchAll(/(?:OfficeError|ExecutiveError)\('(\w+)'/g)) codes.add(m[1]);
  for (const m of sources.matchAll(/fail\(res,\s*\d+,\s*'(\w+)'\)/g)) codes.add(m[1]);
  assert.ok(codes.size > 10);
  for (const code of codes) assert.ok(isArabicText(ar.errors[code]), `errors.${code} missing`);
});

test('every employee profile is written in Arabic', () => {
  const roster = JSON.parse(read('data/employees.json'));
  assert.equal(roster.length, 10);
  for (const e of roster) {
    for (const field of ['name', 'title', 'department', 'level']) {
      assert.ok(isArabicText(e[field]), `Employee ${e.id} field "${field}" is not Arabic`);
    }
  }
});

test('Western digits are used for numbers in the page', () => {
  assert.match(read('public/app.js'), /ar-u-nu-latn/);
  assert.match(read('public/app.js'), /Europe\/Paris/);
});

test('team/roster.md and data/employees.json list the same employees', () => {
  const roster = JSON.parse(read('data/employees.json'));
  const md = read('team/roster.md');
  for (const e of roster) {
    assert.ok(md.includes(`| ${e.id} | ${e.name} | ${e.title} | ${e.department} | ${e.level} |`), `Roster mismatch for employee ${e.id}`);
  }
});
