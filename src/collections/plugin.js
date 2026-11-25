// Dev server only: keeps favourites and collections (setlists) on the Mac's disk, shared by every
// device using this dev server (the iPad on the music stand), like progress-store/plugin.js.
//
//   GET /__collections   → {store: 'disk', ...doc}                      (doc shape: ./model.js)
//   PUT /__collections   ← doc → {ok: true, doc}   the newer document wins: a PUT older than what
//                          is on disk is answered with {ok: false, stale: true, doc} (HTTP 409)
//
// Stored in .data/collections.json (gitignored), written atomically; backups pick it up with the
// other .data/*.json files (backup/plugin.js validates it on restore). Nothing the client sends
// becomes a path.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {MAX_BYTES, emptyDoc, normalizeDoc, validateDoc} from './model.js';

export const DATA_DIR = resolve('.data');
export const FILE = 'collections.json';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

export function readCollections(dir = DATA_DIR) {
  const path = join(dir, FILE);
  if (!existsSync(path)) return emptyDoc();
  try { return normalizeDoc(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { throw new HttpError(500, `${FILE} is not valid JSON; fix or remove it`); }
}

export function writeCollections(dir, doc) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(tmp, JSON.stringify(doc) + '\n');
    renameSync(tmp, join(dir, FILE));
  } catch (e) {
    rmSync(tmp, {force: true});
    throw e;
  }
}

/** Validates and stores a document unless the one on disk is newer. → {ok, stale?, doc}. */
export function putCollections(dir, body) {
  let doc;
  try { doc = validateDoc(body); } catch (e) { throw new HttpError(400, e.message); }
  const current = readCollections(dir);
  if ((current.updatedAt || 0) > (doc.updatedAt || 0)) return {ok: false, stale: true, doc: current};
  writeCollections(dir, doc);
  return {ok: true, doc};
}

function readBody(req, limit) {
  return new Promise((done, fail) => {
    if (Number(req.headers['content-length']) > limit) return fail(new HttpError(413, 'request too large'));
    const chunks = [];
    let size = 0, over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; fail(new HttpError(413, 'request too large')); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!over) done(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', fail);
  });
}

/** Connect-style handler, mounted at /__collections. */
export function collectionsHandler(dir = DATA_DIR) {
  return async (req, res, next) => {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (path !== '/') return next();
    try {
      if (req.method === 'GET') return send(res, 200, {store: 'disk', ...readCollections(dir)});
      if (req.method === 'PUT' || req.method === 'POST') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
        let body;
        try { body = JSON.parse(await readBody(req, MAX_BYTES + 4096)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'not JSON'); }
        const out = putCollections(dir, body);
        return send(res, out.ok ? 200 : 409, out);
      }
      return next();
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[collections]', e);
      if (e.status === 413) res.setHeader('connection', 'close');
      send(res, e.status || 500, {error: e instanceof HttpError ? e.message : 'could not save collections'});
    }
  };
}

export function collectionsStore({dir = DATA_DIR} = {}) {
  return {
    name: 'collections-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__collections', collectionsHandler(dir));
    },
  };
}
