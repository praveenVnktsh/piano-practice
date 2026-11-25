// Dev server only: recorded performances ("takes") and mock-exam sheets on the Mac's disk
// (recordings/store.js; .data/recordings, or RECORDINGS_DIR). A production build has no
// server; src/record/store.js then keeps takes in localStorage.
//
//   GET    /__recordings                  → {store: 'disk', takes: [meta, …]}          newest first
//   GET    /__recordings?songId=<id>      → {store: 'disk', takes: [meta, …]}          one piece
//   GET    /__recordings/takes/<id>       → the take (with notes and report)          404 if none
//   PUT    /__recordings/takes/<id>       ← a take (src/record/take.mjs)  → 200 {ok, take: meta}
//   PATCH  /__recordings/takes/<id>       ← {name?, report?, sentAt?}     → 200 {ok, take: meta}
//   DELETE /__recordings/takes/<id>       → 200 {ok}
//   GET    /__recordings/exams            → {exams: [sheet, …]}
//   GET    /__recordings/exams/<id>       → the sheet
//   PUT    /__recordings/exams/<id>       ← a sheet → 200 {ok, exam}
//   DELETE /__recordings/exams/<id>       → 200 {ok}
// Bodies are JSON (content-type application/json), at most 2.5 MB; ids are [a-z0-9]{8,40} and the
// id in the path must match the body's. Errors: 400 invalid, 404 missing, 409 conflict / too
// many takes, 413 too large, 415 not JSON → {error}.
import {RECORDINGS_DIR, HttpError, deleteExam, deleteTake, listExams, listTakes, readExam, readTake, saveExam, saveTake, updateTake} from './store.js';
import {takeMeta, validSongId} from '../src/record/take.mjs';

export const MAX_BODY = 2.5 * 1024 * 1024;

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
async function readJson(req, limit) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
  const text = await readBody(req, limit);
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'not JSON'); }
}

/** Connect-style handler, mounted at /__recordings (req.url is the rest). */
export function recordingsHandler(dir = RECORDINGS_DIR, {maxBody = MAX_BODY} = {}) {
  return async (req, res, next) => {
    const [rawPath, query = ''] = (req.url || '/').split('?');
    const path = rawPath.replace(/\/+$/, '') || '/';
    try {
      if (path === '/' && req.method === 'GET') {
        const songId = new URLSearchParams(query).get('songId');
        if (songId != null && !validSongId(songId)) throw new HttpError(400, 'invalid song id');
        return send(res, 200, {store: 'disk', takes: listTakes(dir, songId ?? undefined).map(takeMeta)});
      }
      let m = path.match(/^\/takes\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const take = readTake(dir, id);
          return take ? send(res, 200, take) : send(res, 404, {error: `no take ${id}`});
        }
        if (req.method === 'PUT') {
          const body = await readJson(req, maxBody);
          if (body?.id !== id) throw new HttpError(400, 'the take id in the path and the body differ');
          return send(res, 200, {ok: true, take: saveTake(dir, body)});
        }
        if (req.method === 'PATCH') return send(res, 200, {ok: true, take: updateTake(dir, id, await readJson(req, maxBody))});
        if (req.method === 'DELETE') { deleteTake(dir, id); return send(res, 200, {ok: true}); }
        throw new HttpError(405, 'method not allowed');
      }
      if (path === '/exams' && req.method === 'GET') return send(res, 200, {exams: listExams(dir)});
      m = path.match(/^\/exams\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const exam = readExam(dir, id);
          return exam ? send(res, 200, exam) : send(res, 404, {error: `no exam ${id}`});
        }
        if (req.method === 'PUT') {
          const body = await readJson(req, 256 * 1024);
          if (body?.id !== id) throw new HttpError(400, 'the exam id in the path and the body differ');
          return send(res, 200, {ok: true, exam: saveExam(dir, body)});
        }
        if (req.method === 'DELETE') { deleteExam(dir, id); return send(res, 200, {ok: true}); }
        throw new HttpError(405, 'method not allowed');
      }
      return next();
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[recordings]', e);
      if (status === 413) res.setHeader('connection', 'close');
      send(res, status, {error: status === 500 ? 'could not save the recording' : e.message});
    }
  };
}

export function recordings({dir = RECORDINGS_DIR} = {}) {
  return {
    name: 'recordings',
    apply: 'serve',
    // Takes aren't source: don't let writes to them wake Vite's file watcher.
    config: () => ({server: {watch: {ignored: ['**/.data/**']}}}),
    configureServer(server) {
      server.middlewares.use('/__recordings', recordingsHandler(dir));
    },
  };
}
