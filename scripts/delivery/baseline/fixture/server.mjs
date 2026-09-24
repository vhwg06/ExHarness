import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const statuses = new Set(['OPEN', 'CLOSED']);
const codePoints = value => [...value].length;

function fieldError(field, message) { return { error: { field, message } }; }
function normalizedTitle(value, fault) {
  if (typeof value !== 'string') return { error: fieldError('title', 'Title must be text') };
  const title = value.trim();
  // NORM-01 is the deliberate starter defect. The agent must repair both API and UI.
  if (fault !== 'NORM-01' && (codePoints(title) < 1 || codePoints(title) > 120))
    return { error: fieldError('title', 'Title must contain 1 to 120 characters') };
  return { value: title };
}
function validDescription(value) {
  if (typeof value !== 'string' || codePoints(value) > 2000)
    return { error: fieldError('description', 'Description must contain at most 2000 characters') };
  return { value };
}
function validStatus(value, fault, isPatch = false) {
  // STATUS-01 is a separate seeded defect on update, never a policy toggle in production.
  if ((!isPatch || fault !== 'STATUS-01') && !statuses.has(value))
    return { error: fieldError('status', 'Status must be OPEN or CLOSED') };
  return { value };
}
async function bodyJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 8192) throw new Error('request too large');
  }
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('body must be an object');
  return value;
}
function reply(response, status, value, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(typeof value === 'string' ? value : JSON.stringify(value));
}

export function createRequestTracker({ databasePath, fault = 'NORM-01' }) {
  if (!['NORM-01', 'STATUS-01', 'ORDER-01', 'NONE'].includes(fault)) throw new Error('unknown fixture fault');
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL)');
  const select = database.prepare('SELECT id, title, description, status FROM requests WHERE id = ?');
  const insert = database.prepare('INSERT INTO requests (title, description, status) VALUES (?, ?, ?)');
  const update = database.prepare('UPDATE requests SET title = ?, description = ?, status = ? WHERE id = ?');
  const ordered = database.prepare(`SELECT id, title, description, status FROM requests ORDER BY id ${fault === 'ORDER-01' ? 'DESC' : 'ASC'}`);
  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await readFile(join(here, 'index.html'), 'utf8');
        return reply(response, 200, html.replace('<!-- FIXTURE_CONFIG -->', `<script>window.FIXTURE_FAULT=${JSON.stringify(fault)}</script>`), 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && url.pathname === '/client.js')
        return reply(response, 200, await readFile(join(here, 'client.js'), 'utf8'), 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/requests') return reply(response, 200, ordered.all());
      if (request.method === 'POST' && url.pathname === '/requests') {
        const input = await bodyJson(request);
        const title = normalizedTitle(input.title, fault);
        if (title.error) return reply(response, 400, title.error);
        const description = validDescription(input.description ?? '');
        if (description.error) return reply(response, 400, description.error);
        const status = validStatus(input.status ?? 'OPEN', fault);
        if (status.error) return reply(response, 400, status.error);
        const result = insert.run(title.value, description.value, status.value);
        return reply(response, 201, select.get(Number(result.lastInsertRowid)));
      }
      const match = /^\/requests\/(\d+)$/.exec(url.pathname);
      if (request.method === 'PATCH' && match) {
        const id = Number(match[1]);
        const previous = select.get(id);
        if (!previous) return reply(response, 404, { error: { message: 'Request not found' } });
        const input = await bodyJson(request);
        if (!Object.keys(input).length || Object.keys(input).some(key => !['title', 'description', 'status'].includes(key)))
          return reply(response, 400, fieldError('body', 'Unknown or empty update'));
        const title = normalizedTitle(input.title ?? previous.title, fault);
        if (title.error) return reply(response, 400, title.error);
        const description = validDescription(input.description ?? previous.description);
        if (description.error) return reply(response, 400, description.error);
        const status = validStatus(input.status ?? previous.status, fault, true);
        if (status.error) return reply(response, 400, status.error);
        update.run(title.value, description.value, status.value, id);
        return reply(response, 200, select.get(id));
      }
      reply(response, 404, { error: { message: 'Not found' } });
    } catch (error) {
      if (error instanceof SyntaxError || /request too large|body must be/.test(error.message))
        return reply(response, 400, fieldError('body', 'Invalid JSON body'));
      reply(response, 500, { error: { message: 'Internal error' } });
    }
  });
  return {
    server,
    async listen(port = 0) {
      await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      database.close();
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const app = createRequestTracker({ databasePath: option('--database'), fault: option('--fault') ?? 'NORM-01' });
  const url = await app.listen(Number(option('--port') ?? 0));
  process.stdout.write(`${JSON.stringify({ url, pid: process.pid })}\n`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
