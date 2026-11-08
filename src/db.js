import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireArabic } from './arabic.js';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const DEFAULT_DB_PATH = join(ROOT, 'data', 'kingdom.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  level TEXT NOT NULL,
  model_tier TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  task_id INTEGER REFERENCES tasks(id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  task_id INTEGER REFERENCES tasks(id),
  session_id INTEGER REFERENCES sessions(id),
  approval_id INTEGER,
  status TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  task_id INTEGER REFERENCES tasks(id),
  status TEXT NOT NULL,
  owner_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDatabase(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  syncEmployees(db);
  return db;
}

/** The roster file is the source of truth for employee profiles. */
function syncEmployees(db) {
  const roster = JSON.parse(readFileSync(join(ROOT, 'data', 'employees.json'), 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO employees (id, name, title, department, level, model_tier)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, title=excluded.title,
      department=excluded.department, level=excluded.level, model_tier=excluded.model_tier
  `);
  for (const e of roster) {
    // Reject any profile whose visible fields are not Arabic.
    requireArabic({ name: e.name, title: e.title, department: e.department, level: e.level });
  }
  for (const e of roster) upsert.run(e.id, e.name, e.title, e.department, e.level, e.modelTier);
}
