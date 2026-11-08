import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { Office, OfficeError } from '../src/office.js';

const fresh = () => new Office(openDatabase(':memory:'));
const statusOf = (office, id) => office.board().employees.find((e) => e.id === id).status;

test('all employees start idle with no fake activity', () => {
  const office = fresh();
  const board = office.board();
  assert.equal(board.employees.length, 11);
  assert.ok(board.employees.every((e) => e.status === 'idle' && e.currentTask === null));
  assert.equal(board.activity.length, 0);
  assert.equal(board.attention.length, 0);
});

test('status follows the recorded session lifecycle', () => {
  const office = fresh();
  const task = office.createTask({ employeeId: 2, title: 'بحث عن أفكار رمضان', objective: 'جمع عشر أفكار موثّقة' });
  assert.equal(statusOf(office, 2), 'idle', 'creating a task does not start work');

  const s = office.startSession({ employeeId: 2, taskId: task.id, status: 'researching' });
  assert.equal(statusOf(office, 2), 'researching');
  assert.equal(office.task(task.id).status, 'in_progress');

  office.changeSessionStatus(s.id, { status: 'blocked', note: 'المصدر غير متاح' });
  assert.equal(statusOf(office, 2), 'blocked');
  assert.equal(office.task(task.id).status, 'blocked');

  office.changeSessionStatus(s.id, { status: 'working' });
  office.endSession(s.id, { taskDone: true });
  assert.equal(statusOf(office, 2), 'idle');
  assert.equal(office.task(task.id).status, 'done');
  assert.equal(office.board().employees.find((e) => e.id === 2).completedTasks, 1);

  const types = office.board().activity.map((a) => a.type).reverse();
  assert.deepEqual(types, ['task_created', 'session_started', 'status_changed', 'status_changed', 'session_ended']);
});

test('pending approvals appear in NEEDS YOUR ATTENTION and set waiting status', () => {
  const office = fresh();
  const task = office.createTask({ employeeId: 9, title: 'نشر ريلز الجمعة', objective: 'تجهيز منشور الجمعة' });
  const a = office.requestApproval({ kind: 'publish', title: 'موافقة على نشر ريلز الجمعة', details: 'المسودة جاهزة', employeeId: 9, taskId: task.id });
  assert.equal(office.board().attention.length, 1);
  assert.equal(statusOf(office, 9), 'waiting_owner');
  assert.equal(office.task(task.id).status, 'waiting_owner');

  office.decideApproval(a.id, { decision: 'approved', note: 'موافق' });
  assert.equal(office.board().attention.length, 0);
  assert.equal(statusOf(office, 9), 'idle');
  assert.throws(() => office.decideApproval(a.id, { decision: 'rejected' }), (e) => e.code === 'approval_already_decided');
});

test('rejection marks the task rejected', () => {
  const office = fresh();
  const task = office.createTask({ employeeId: 9, title: 'نشر منشور', objective: 'منشور تجريبي' });
  const a = office.requestApproval({ kind: 'publish', title: 'نشر', details: 'تفاصيل', employeeId: 9, taskId: task.id });
  office.decideApproval(a.id, { decision: 'rejected' });
  assert.equal(office.task(task.id).status, 'rejected');
});

test('non-Arabic text is refused everywhere it reaches the owner', () => {
  const office = fresh();
  const isArabicError = (e) => e instanceof OfficeError && e.code === 'non_arabic_text';
  assert.throws(() => office.createTask({ employeeId: 2, title: 'Research', objective: 'هدف' }), isArabicError);
  assert.throws(() => office.requestApproval({ kind: 'decision', title: 'قرار', details: 'Details here', employeeId: 1 }), isArabicError);
  assert.throws(() => office.startSession({ employeeId: 3, note: 'starting' }), isArabicError);
});

test('one open session per employee, and tasks must belong to the employee', () => {
  const office = fresh();
  const task = office.createTask({ employeeId: 5, title: 'كتابة سيناريو', objective: 'سيناريو عن الصبر' });
  assert.throws(() => office.startSession({ employeeId: 6, taskId: task.id }), (e) => e.code === 'task_not_assigned_to_employee');
  office.startSession({ employeeId: 5, taskId: task.id });
  assert.throws(() => office.startSession({ employeeId: 5 }), (e) => e.code === 'session_already_open');
  assert.throws(() => office.startSession({ employeeId: 4, status: 'idle' }), (e) => e.code === 'invalid_status');
});
