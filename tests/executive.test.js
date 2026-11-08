// Tests the Executive Manager with a scripted stand-in for the API client,
// so no real (paid) model call is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { Office } from '../src/office.js';
import { ExecutiveManager } from '../src/executive.js';

function scriptedClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error('no scripted response left');
          return next;
        },
      },
    },
  };
}

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

test('without configuration the owner message is kept and a coded error is raised', async () => {
  const office = new Office(openDatabase(':memory:'));
  const em = new ExecutiveManager(office, { model: null });
  await assert.rejects(em.respond('مرحباً'), (e) => e.code === 'em_not_configured');
  assert.equal(office.messages().length, 1);
  assert.equal(office.messages()[0].role, 'owner');
});

test('the manager records real tasks and approvals through tools', async () => {
  const office = new Office(openDatabase(':memory:'));
  const client = scriptedClient([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'create_task', input: { employee_id: 2, title: 'أفكار للأسبوع', objective: 'خمس أفكار عن الأذكار' } },
        { type: 'tool_use', id: 't2', name: 'request_owner_decision', input: { kind: 'decision', title: 'اختيار محور الأسبوع', details: 'الأذكار أم السيرة؟', employee_id: 1, task_id: null } },
      ],
    },
    text('سجّلت مهمة البحث لميسو، ورفعت إليك قرار اختيار محور الأسبوع.'),
  ]);
  const em = new ExecutiveManager(office, { client, model: 'test-model' });
  const reply = await em.respond('جهّز خطة الأسبوع');

  assert.equal(reply.role, 'executive');
  const board = office.board();
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].employee_id, 2);
  assert.equal(board.attention.length, 1);
  // Creating a task does not fake activity.
  assert.equal(board.employees.find((e) => e.id === 2).status, 'idle');

  // Tool results are sent back in a single user message.
  const second = client.calls[1].messages;
  const toolResults = second.at(-1).content;
  assert.equal(toolResults.length, 2);
  assert.ok(toolResults.every((r) => r.type === 'tool_result' && !r.is_error));
  // The Arabic rule is in the system prompt.
  assert.match(client.calls[0].system, /بالعربية الفصحى المعاصرة/);
});

test('a non-Arabic tool input is refused and reported back to the model', async () => {
  const office = new Office(openDatabase(':memory:'));
  const client = scriptedClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'create_task', input: { employee_id: 2, title: 'Ideas', objective: 'هدف' } }] },
    text('تم.'),
  ]);
  const em = new ExecutiveManager(office, { client, model: 'test-model' });
  await em.respond('ابدأ');
  assert.equal(office.board().tasks.length, 0);
  assert.equal(client.calls[1].messages.at(-1).content[0].is_error, true);
});

test('a reply with Latin text is regenerated once, then refused', async () => {
  const office = new Office(openDatabase(':memory:'));
  const okClient = scriptedClient([text('Hello'), text('أهلاً بك.')]);
  const em = new ExecutiveManager(office, { client: okClient, model: 'test-model' });
  const reply = await em.respond('مرحباً');
  assert.equal(reply.content, 'أهلاً بك.');

  const office2 = new Office(openDatabase(':memory:'));
  const badClient = scriptedClient([text('Hello'), text('Still English')]);
  const em2 = new ExecutiveManager(office2, { client: badClient, model: 'test-model' });
  await assert.rejects(em2.respond('مرحباً'), (e) => e.code === 'em_non_arabic');
  assert.ok(office2.messages().every((m) => m.role === 'owner'), 'non-Arabic reply is never stored');
});

test('a refusal is surfaced as a coded error', async () => {
  const office = new Office(openDatabase(':memory:'));
  const client = scriptedClient([{ stop_reason: 'refusal', content: [] }]);
  const em = new ExecutiveManager(office, { client, model: 'test-model' });
  await assert.rejects(em.respond('سؤال'), (e) => e.code === 'em_refused');
});
