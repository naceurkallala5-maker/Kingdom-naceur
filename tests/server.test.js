import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withServer(fn) {
  const { server } = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('serves the Arabic page and locale file', async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /dir="rtl"/);
    const ar = await (await fetch(`${base}/locales/ar.json`)).json();
    assert.equal(ar.app.name, 'مملكة ناصر');
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  });
});

test('session API drives the board and errors are codes only', async () => {
  await withServer(async (base) => {
    const started = await fetch(`${base}/api/sessions`, json('POST', { employeeId: 4, status: 'researching', note: 'تحقق من حديث' }));
    assert.equal(started.status, 201);
    const session = await started.json();

    let board = await (await fetch(`${base}/api/board`)).json();
    assert.equal(board.employees.find((e) => e.id === 4).status, 'researching');

    const dup = await fetch(`${base}/api/sessions`, json('POST', { employeeId: 4 }));
    assert.equal(dup.status, 409);
    assert.deepEqual(await dup.json(), { error: 'session_already_open' });

    await fetch(`${base}/api/sessions/${session.id}/end`, json('POST', {}));
    board = await (await fetch(`${base}/api/board`)).json();
    assert.equal(board.employees.find((e) => e.id === 4).status, 'idle');
  });
});

test('chat without configuration records the message and returns a coded error', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/chat`, json('POST', { text: 'ما خطة اليوم؟' }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'em_not_configured' });
    const chat = await (await fetch(`${base}/api/chat`)).json();
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.configured, false);
  });
});
