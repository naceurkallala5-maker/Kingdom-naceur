// Company domain logic. Every status shown on the Live Office Board is derived
// from recorded sessions, events and approvals; nothing here invents activity.

import { requireArabic } from './arabic.js';

export const STATUSES = ['working', 'idle', 'waiting_owner', 'blocked', 'meeting', 'researching'];
export const SESSION_STATUSES = STATUSES.filter((s) => s !== 'idle');
export const TASK_STATUSES = ['assigned', 'in_progress', 'waiting_owner', 'blocked', 'done', 'rejected'];
export const APPROVAL_KINDS = ['publish', 'message', 'spend', 'settings', 'connect', 'sharia_review', 'decision', 'missing_info'];
export const APPROVAL_DECISIONS = ['approved', 'rejected', 'changes_requested'];

export class OfficeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.httpStatus = status;
  }
}

const now = () => new Date().toISOString();

export class Office {
  constructor(db, { onChange } = {}) {
    this.db = db;
    this.onChange = onChange ?? (() => {});
  }

  // ---------- reads ----------

  employee(id) {
    const row = this.db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!row) throw new OfficeError('employee_not_found', 404);
    return row;
  }

  task(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) throw new OfficeError('task_not_found', 404);
    return row;
  }

  openSession(employeeId) {
    return this.db
      .prepare('SELECT * FROM sessions WHERE employee_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(employeeId);
  }

  /**
   * Current status rules:
   * 1. An open work session -> that session's recorded status.
   * 2. No open session but a pending approval raised by the employee -> waiting_owner.
   * 3. Otherwise -> idle.
   */
  employeeStatus(employeeId) {
    const session = this.openSession(employeeId);
    if (session) {
      return { status: session.status, taskId: session.task_id, since: this.lastStatusTime(session.id) ?? session.started_at };
    }
    const pending = this.db
      .prepare("SELECT * FROM approvals WHERE employee_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1")
      .get(employeeId);
    if (pending) return { status: 'waiting_owner', taskId: pending.task_id, since: pending.created_at };
    const last = this.db
      .prepare("SELECT created_at FROM events WHERE employee_id = ? AND type = 'session_ended' ORDER BY id DESC LIMIT 1")
      .get(employeeId);
    return { status: 'idle', taskId: null, since: last?.created_at ?? null };
  }

  lastStatusTime(sessionId) {
    return this.db
      .prepare('SELECT created_at FROM events WHERE session_id = ? ORDER BY id DESC LIMIT 1')
      .get(sessionId)?.created_at;
  }

  board() {
    const employees = this.db.prepare('SELECT * FROM employees ORDER BY id').all().map((e) => {
      const s = this.employeeStatus(e.id);
      const doneCount = this.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE employee_id = ? AND status = 'done'")
        .get(e.id).n;
      const task = s.taskId ? this.db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(s.taskId) : null;
      return {
        id: e.id, name: e.name, title: e.title, department: e.department, level: e.level,
        status: s.status, since: s.since, currentTask: task ?? null, completedTasks: doneCount,
      };
    });
    const attention = this.db
      .prepare(`SELECT a.*, e.name AS employee_name, e.department AS department, t.title AS task_title
                FROM approvals a JOIN employees e ON e.id = a.employee_id
                LEFT JOIN tasks t ON t.id = a.task_id
                WHERE a.status = 'pending' ORDER BY a.id ASC`)
      .all();
    const tasks = this.db
      .prepare(`SELECT t.*, e.name AS employee_name, e.department AS department
                FROM tasks t JOIN employees e ON e.id = t.employee_id
                WHERE t.status NOT IN ('done', 'rejected') ORDER BY t.id DESC`)
      .all();
    const activity = this.db
      .prepare(`SELECT ev.*, e.name AS employee_name, t.title AS task_title
                FROM events ev LEFT JOIN employees e ON e.id = ev.employee_id
                LEFT JOIN tasks t ON t.id = ev.task_id
                ORDER BY ev.id DESC LIMIT 50`)
      .all();
    return { employees, attention, tasks, activity };
  }

  // ---------- writes ----------

  logEvent({ type, employeeId = null, taskId = null, sessionId = null, approvalId = null, status = null, note = null }) {
    this.db
      .prepare(`INSERT INTO events (type, employee_id, task_id, session_id, approval_id, status, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(type, employeeId, taskId, sessionId, approvalId, status, note, now());
  }

  validNote(note) {
    if (note == null || note === '') return null;
    try {
      requireArabic({ note });
    } catch {
      throw new OfficeError('non_arabic_text');
    }
    return note;
  }

  createTask({ title, objective, employeeId }) {
    try {
      requireArabic({ title, objective });
    } catch {
      throw new OfficeError('non_arabic_text');
    }
    this.employee(employeeId);
    const ts = now();
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO tasks (title, objective, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'assigned', ?, ?)")
      .run(title, objective, employeeId, ts, ts);
    const taskId = Number(lastInsertRowid);
    this.logEvent({ type: 'task_created', employeeId, taskId });
    this.onChange();
    return this.task(taskId);
  }

  setTaskStatus(taskId, status) {
    if (!TASK_STATUSES.includes(status)) throw new OfficeError('invalid_status');
    this.task(taskId);
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), taskId);
  }

  startSession({ employeeId, taskId = null, status = 'working', note = null }) {
    if (!SESSION_STATUSES.includes(status)) throw new OfficeError('invalid_status');
    this.employee(employeeId);
    if (taskId != null) {
      const task = this.task(taskId);
      if (task.employee_id !== employeeId) throw new OfficeError('task_not_assigned_to_employee');
    }
    if (this.openSession(employeeId)) throw new OfficeError('session_already_open', 409);
    note = this.validNote(note);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO sessions (employee_id, task_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(employeeId, taskId, status, now());
    const sessionId = Number(lastInsertRowid);
    if (taskId != null) this.setTaskStatus(taskId, 'in_progress');
    this.logEvent({ type: 'session_started', employeeId, taskId, sessionId, status, note });
    this.onChange();
    return this.session(sessionId);
  }

  session(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row) throw new OfficeError('session_not_found', 404);
    return row;
  }

  changeSessionStatus(sessionId, { status, note = null }) {
    if (!SESSION_STATUSES.includes(status)) throw new OfficeError('invalid_status');
    const s = this.session(sessionId);
    if (s.ended_at) throw new OfficeError('session_closed', 409);
    note = this.validNote(note);
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, sessionId);
    if (s.task_id != null && (status === 'blocked' || status === 'waiting_owner')) this.setTaskStatus(s.task_id, status);
    else if (s.task_id != null) this.setTaskStatus(s.task_id, 'in_progress');
    this.logEvent({ type: 'status_changed', employeeId: s.employee_id, taskId: s.task_id, sessionId, status, note });
    this.onChange();
    return this.session(sessionId);
  }

  endSession(sessionId, { taskDone = false, note = null } = {}) {
    const s = this.session(sessionId);
    if (s.ended_at) throw new OfficeError('session_closed', 409);
    note = this.validNote(note);
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now(), sessionId);
    if (s.task_id != null && taskDone) this.setTaskStatus(s.task_id, 'done');
    this.logEvent({ type: 'session_ended', employeeId: s.employee_id, taskId: s.task_id, sessionId, note });
    this.onChange();
    return this.session(sessionId);
  }

  requestApproval({ kind, title, details, employeeId, taskId = null }) {
    if (!APPROVAL_KINDS.includes(kind)) throw new OfficeError('invalid_approval_kind');
    try {
      requireArabic({ title, details });
    } catch {
      throw new OfficeError('non_arabic_text');
    }
    this.employee(employeeId);
    if (taskId != null) this.task(taskId);
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO approvals (kind, title, details, employee_id, task_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .run(kind, title, details, employeeId, taskId, now());
    const approvalId = Number(lastInsertRowid);
    if (taskId != null) this.setTaskStatus(taskId, 'waiting_owner');
    this.logEvent({ type: 'approval_requested', employeeId, taskId, approvalId });
    this.onChange();
    return this.approval(approvalId);
  }

  approval(id) {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!row) throw new OfficeError('approval_not_found', 404);
    return row;
  }

  /**
   * Records the owner's decision. Recording a decision never performs an
   * external action by itself; any later action must check this record.
   */
  decideApproval(approvalId, { decision, note = null }) {
    if (!APPROVAL_DECISIONS.includes(decision)) throw new OfficeError('invalid_decision');
    const a = this.approval(approvalId);
    if (a.status !== 'pending') throw new OfficeError('approval_already_decided', 409);
    note = this.validNote(note);
    this.db
      .prepare('UPDATE approvals SET status = ?, owner_note = ?, decided_at = ? WHERE id = ?')
      .run(decision, note, now(), approvalId);
    if (a.task_id != null) {
      const stillPending = this.db
        .prepare("SELECT COUNT(*) AS n FROM approvals WHERE task_id = ? AND status = 'pending'")
        .get(a.task_id).n;
      if (!stillPending) this.setTaskStatus(a.task_id, decision === 'rejected' ? 'rejected' : 'assigned');
    }
    this.logEvent({ type: 'approval_decided', employeeId: a.employee_id, taskId: a.task_id, approvalId, status: decision, note });
    this.onChange();
    return this.approval(approvalId);
  }

  // ---------- executive conversation ----------

  messages(limit = 100) {
    return this.db.prepare('SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC').all(limit);
  }

  addMessage(role, content) {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)')
      .run(role, content, now());
    this.onChange();
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(lastInsertRowid));
  }
}
