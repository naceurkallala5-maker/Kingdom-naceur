// Local web server for Kingdom Nasser. Every error sent to the browser is a
// code that the page translates through locales/ar.json; no English text is
// ever shown to the owner.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { openDatabase, ROOT } from './db.js';
import { Office, OfficeError } from './office.js';
import { ExecutiveManager, ExecutiveError, executiveConfig } from './executive.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createApp({ dbPath, executive } = {}) {
  const sseClients = new Set();
  const broadcast = () => {
    for (const res of sseClients) res.write('event: change\ndata: {}\n\n');
  };
  const db = openDatabase(dbPath);
  const office = new Office(db, { onChange: broadcast });
  const manager = executive ?? new ExecutiveManager(office, executiveConfig());
  if (!manager.office) manager.office = office;

  // Changes written by other processes (for example scripts/office-cli.js)
  // are detected through SQLite's data_version and pushed to open boards.
  let dataVersion = db.prepare('PRAGMA data_version').get().data_version;
  const watcher = setInterval(() => {
    const v = db.prepare('PRAGMA data_version').get().data_version;
    if (v !== dataVersion) {
      dataVersion = v;
      broadcast();
    }
  }, 2000);
  watcher.unref();

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code) => send(res, status, { error: code });

  async function readJson(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) throw new OfficeError('bad_request');
    }
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new OfficeError('bad_request');
    }
  }

  async function serveStatic(res, urlPath) {
    const map = { '/': 'public/index.html', '/locales/ar.json': 'locales/ar.json' };
    const rel = map[urlPath] ?? join('public', normalize(urlPath).replace(/^([/\\])+/, ''));
    const full = join(ROOT, rel);
    if (!full.startsWith(join(ROOT, 'public')) && rel !== 'locales/ar.json') return fail(res, 404, 'not_found');
    try {
      const body = await readFile(full);
      res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      fail(res, 404, 'not_found');
    }
  }

  const routes = [
    ['GET', /^\/api\/board$/, () => [200, office.board()]],
    ['GET', /^\/api\/chat$/, () => [200, { messages: office.messages(), configured: manager.configured }]],
    ['POST', /^\/api\/chat$/, async (req) => {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) throw new OfficeError('empty_message');
      const reply = await manager.respond(text.trim());
      return [200, { reply }];
    }],
    ['POST', /^\/api\/approvals\/(\d+)\/decision$/, async (req, [, id]) => {
      const { decision, note } = await readJson(req);
      return [200, office.decideApproval(Number(id), { decision, note: note?.trim() || null })];
    }],
    // Work-session endpoints used by employees and tools to record real activity.
    ['POST', /^\/api\/sessions$/, async (req) => {
      const b = await readJson(req);
      return [201, office.startSession({ employeeId: b.employeeId, taskId: b.taskId ?? null, status: b.status ?? 'working', note: b.note ?? null })];
    }],
    ['PATCH', /^\/api\/sessions\/(\d+)$/, async (req, [, id]) => {
      const b = await readJson(req);
      return [200, office.changeSessionStatus(Number(id), { status: b.status, note: b.note ?? null })];
    }],
    ['POST', /^\/api\/sessions\/(\d+)\/end$/, async (req, [, id]) => {
      const b = await readJson(req);
      return [200, office.endSession(Number(id), { taskDone: Boolean(b.taskDone), note: b.note ?? null })];
    }],
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('event: hello\ndata: {}\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      for (const [method, pattern, handler] of routes) {
        const match = url.pathname.match(pattern);
        if (match && req.method === method) {
          const [status, body] = await handler(req, match);
          return send(res, status, body);
        }
      }
      if (url.pathname.startsWith('/api/')) return fail(res, 404, 'not_found');
      if (req.method === 'GET') return serveStatic(res, url.pathname);
      fail(res, 404, 'not_found');
    } catch (err) {
      if (err instanceof OfficeError) return fail(res, err.httpStatus, err.code);
      if (err instanceof ExecutiveError) return fail(res, err.code === 'em_not_configured' ? 503 : 502, err.code);
      console.error(err);
      fail(res, 500, 'internal_error');
    }
  });

  server.on('close', () => {
    clearInterval(watcher);
    for (const res of sseClients) res.end();
    db.close();
  });
  return { server, office, manager };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const { server, manager } = createApp({ dbPath: process.env.KINGDOM_DB || undefined });
  server.listen(port, () => {
    console.log(`Kingdom Nasser running on http://localhost:${port}`);
    if (!manager.configured) console.log('Executive manager not configured (set KINGDOM_MODEL_ADVANCED and ANTHROPIC_API_KEY).');
  });
}
