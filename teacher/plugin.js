// Dev server only: the Teacher panel's conversation, kept in .teacher/ (see store.js).
// The student writes from the app; a Claude Code subagent answers with `node teacher/cli.js`.
//   GET  /__teacher           → {messages, replies, status}
//   POST /__teacher/messages  {text, context?} → 201 the stored message
//   GET  /__teacher/stream    SSE: `thread` events ({messages, replies, status}) whenever .teacher/ changes
//   POST /__teacher/status    {thinking: <message id> | null} → 200 status
import {mkdirSync, watch} from 'node:fs';
import {addMessage, readThread, setThinking, TEACHER_DIR} from './store.js';

const MAX_BODY = 256 * 1024;

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function readJson(req) {
  return new Promise((done, fail) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        fail(Object.assign(new Error('request too large'), {status: 413}));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        done(JSON.parse(body));
      } catch {
        fail(new Error('not JSON'));
      }
    });
    req.on('error', fail);
  });
}

/** One watcher per directory shared by every open stream; pushes the thread when it changes. */
function createHub(dir, {pollMs = 1500} = {}) {
  const clients = new Set();
  let watcher = null, poll = null, timer = null, last = '';
  const snapshot = () => JSON.stringify(readThread(dir));
  const push = (force = false) => {
    const now = snapshot();
    if (!force && now === last) return;
    last = now;
    for (const res of clients) res.write(`event: thread\ndata: ${now}\n\n`);
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(push, 30);
  };
  function start() {
    mkdirSync(dir, {recursive: true});
    last = snapshot();
    try {
      watcher = watch(dir, soon);
      watcher.on('error', () => {});
    } catch {}
    // fs.watch can miss events on some filesystems; a cheap poll backs it up.
    poll = setInterval(() => {
      push();
      for (const res of clients) res.write(': ping\n\n');
    }, pollMs);
  }
  function stop() {
    watcher?.close();
    clearInterval(poll);
    clearTimeout(timer);
    watcher = poll = null;
  }
  return {
    add(res) {
      if (!clients.size) start();
      clients.add(res);
      res.write(`event: thread\ndata: ${snapshot()}\n\n`);
    },
    remove(res) {
      clients.delete(res);
      if (!clients.size) stop();
    },
    changed: soon,
    close: () => {
      for (const res of clients) res.end();
      clients.clear();
      stop();
    },
  };
}

export function teacherHandler(dir = TEACHER_DIR, options) {
  const hub = createHub(dir, options);
  const handler = async (req, res, next) => {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    try {
      if (path === '/' && req.method === 'GET') return send(res, 200, readThread(dir));
      if (path === '/stream' && req.method === 'GET') {
        res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no'});
        res.write('retry: 2000\n\n');
        hub.add(res);
        req.on('close', () => hub.remove(res));
        return;
      }
      if (path === '/messages' && req.method === 'POST') {
        const message = addMessage(dir, await readJson(req));
        hub.changed();
        const {context: _context, ...shown} = message;
        return send(res, 201, shown);
      }
      if (path === '/status' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || !('thinking' in body)) throw new Error('send {thinking: <message id> | null}');
        const status = setThinking(dir, body.thinking);
        hub.changed();
        return send(res, 200, status);
      }
    } catch (e) {
      return send(res, e.status || 400, {error: e.message});
    }
    next();
  };
  handler.close = hub.close;
  return handler;
}

export function teacher({dir = TEACHER_DIR} = {}) {
  return {
    name: 'teacher',
    apply: 'serve',
    // The conversation isn't source: don't let writes to it wake Vite's file watcher.
    config: () => ({server: {watch: {ignored: ['**/.teacher/**']}}}),
    configureServer(server) {
      const handler = teacherHandler(dir);
      server.middlewares.use('/__teacher', handler);
      server.httpServer?.on('close', handler.close);
    },
  };
}
