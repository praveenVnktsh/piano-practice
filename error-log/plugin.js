// Dev server only: collects uncaught errors from every device using this dev server (the iPad
// on the music stand has no console you can see) into a JSON-lines file on the Mac.
//
//   POST /__errors   ← {message, stack, url, ua, at, count?}  or an array of them (≤ 20)
//                    → 200 {ok: true, added}
//   GET  /__errors   → {errors: [entry, …]}  the most recent (?limit=N, default 50, ≤ 500), oldest first
//
// Entries are appended to <dir>/errors.log (default .data/, ERRORS_DIR overrides; tests pass a
// temp dir) as one JSON object per line: {message, stack, url, ua, at, count, received}. Strings are
// capped; when the file passes maxBytes (256 kB) the oldest half is dropped. The browser side
// (src/errors/reporter.js) dedupes and rate-limits; `node tools/errors.mjs` lists the file.
// Nothing the client sends ends up in a path.
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

export const DATA_DIR = resolve(process.env.ERRORS_DIR || '.data');
export const FILE = 'errors.log';
export const MAX_BYTES = 256 * 1024;
export const MAX_PER_REQUEST = 20;
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// eslint-disable-next-line no-control-regex
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);

/** A client report → a stored entry, or null if it has no message. */
export function sanitizeError(e, now = Date.now()) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const message = clean(e.message, 1000).trim();
  if (!message) return null;
  const at = Number.isFinite(e.at) && e.at > 0 && e.at < now + 86400000 ? Math.round(e.at) : now;
  const count = Number.isInteger(e.count) && e.count > 1 ? Math.min(e.count, 1e6) : 1;
  return {message, stack: clean(e.stack, 4000), url: clean(e.url, 300), ua: clean(e.ua, 300), at, count, received: now};
}

/** Appends entries; trims the file to its newest half when it grows past maxBytes. */
export function appendErrors(dir, list, {maxBytes = MAX_BYTES} = {}) {
  if (!list.length) return 0;
  mkdirSync(dir, {recursive: true});
  const path = join(dir, FILE);
  appendFileSync(path, list.map(e => JSON.stringify(e)).join('\n') + '\n');
  if (statSync(path).size > maxBytes) {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    let keep = lines.slice(Math.floor(lines.length / 2));
    while (keep.length > 1 && Buffer.byteLength(keep.join('\n')) > maxBytes / 2) keep = keep.slice(Math.ceil(keep.length / 4));
    const tmp = join(dir, `.errors-${process.pid}.tmp`);
    try { writeFileSync(tmp, keep.join('\n') + '\n'); renameSync(tmp, path); }
    catch (err) { rmSync(tmp, {force: true}); throw err; }
  }
  return list.length;
}

/** The newest `limit` entries, oldest first (unreadable lines are skipped). */
export function readErrors(dir, {limit = 50} = {}) {
  const path = join(dir, FILE);
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return limit > 0 ? out.slice(-limit) : out;
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((done, fail) => {
    if (Number(req.headers['content-length']) > limit) return fail(new HttpError(413, 'request too large'));
    const chunks = [];
    let size = 0, over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; fail(new HttpError(413, 'request too large')); } else chunks.push(chunk);
    });
    req.on('end', () => { if (!over) done(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', fail);
  });
}

/** Connect-style handler, mounted at /__errors (req.url is the rest). */
export function errorsHandler(dir = DATA_DIR, {maxBytes = MAX_BYTES, now = () => Date.now()} = {}) {
  return async (req, res, next) => {
    const [rawPath, query = ''] = (req.url || '/').split('?');
    const path = rawPath.replace(/\/+$/, '') || '/';
    if (path !== '/') return next();
    try {
      if (req.method === 'GET') {
        const limit = Math.max(1, Math.min(500, parseInt(new URLSearchParams(query).get('limit'), 10) || 50));
        return send(res, 200, {errors: readErrors(dir, {limit})});
      }
      if (req.method !== 'POST') throw new HttpError(405, 'use GET or POST');
      // sendBeacon posts text/plain; fetch posts application/json. Both carry JSON.
      if (!/^(application\/json|text\/plain)\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
      let body;
      try { body = JSON.parse(await readBody(req, MAX_BODY)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'not JSON'); }
      const list = Array.isArray(body) ? body : [body];
      if (list.length > MAX_PER_REQUEST) throw new HttpError(413, `send at most ${MAX_PER_REQUEST} errors per request`);
      const t = now();
      const entries = list.map(e => sanitizeError(e, t)).filter(Boolean);
      return send(res, 200, {ok: true, added: appendErrors(dir, entries, {maxBytes})});
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[error-log]', e);
      if (e.status === 413) res.setHeader('connection', 'close');
      send(res, e.status || 500, {error: e instanceof HttpError ? e.message : 'could not save the error'});
    }
  };
}

export function errorLog({dir = DATA_DIR} = {}) {
  return {
    name: 'error-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__errors', errorsHandler(dir));
    },
  };
}
