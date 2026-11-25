// Dev server only: back up and restore everything the dev server keeps on the Mac's disk.
//
//   GET  /__backup              → the server part of a backup (see below), as JSON
//   POST /__backup/restore      ← a backup file (JSON) → {ok, restored: {...}, snapshot}
//   POST /__backup/restore?dryRun=1                    → {ok, summary} without writing
//
// Server part:
//   {format: 'piano-practice-backup', version: 1, exportedAt, server: {
//     data:    {'progress.json': <doc>, 'collections.json': <doc>, '<other>.json': <json>, ...}   .data/*.json (progress, journal, goals, collections…)
//     teacher: {'messages.jsonl': '<text>', 'replies.jsonl': '…', 'student.md': '…', ...}   .teacher/
//     imports: {index: [entry, ...], files: {'<name>.musicxml': '<base64>', ...}, skipped: [names]}
//   }}
// The browser part (localStorage settings, IndexedDB imports) is added by src/pwa/backup.js.
//
// Restore replaces .data/*.json and the teacher files present in the backup, and merges imported
// scores (adds missing ones, keeps yours). Before writing, the current state is saved to
// .data/backups/before-restore-<time>.json, so a restore can itself be undone by restoring that.
// Nothing the client sends becomes a path unless it matches the strict name patterns below.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DATA_DIR} from '../progress-store/plugin.js';
import {RECORDINGS_DIR, listTakes, listExams, readTake, readExam, saveTake, saveExam} from '../recordings/store.js';

const MAX_RECORDINGS_BYTES = 60 * 1024 * 1024; // recordings in one backup (newest kept first)
const MAX_RECORDING_ITEMS = 10000;
import {TEACHER_DIR} from '../teacher/store.js';
import {SONGS_DIR, URL_BASE, ID_RE} from '../song-store/plugin.js';
import {normalizeDoc} from '../src/progress/model.js';
import {validateDoc as validateCollections} from '../src/collections/model.js';

export const FORMAT = 'piano-practice-backup';
export const VERSION = 1;
export const MAX_RESTORE_BYTES = 80 * 1024 * 1024;
export const MAX_IMPORT_FILES_BYTES = 40 * 1024 * 1024;
const MAX_DATA_FILE = 8 * 1024 * 1024;
const MAX_TEACHER_FILE = 16 * 1024 * 1024;

const DATA_NAME = /^[a-z0-9][a-z0-9-]{0,40}\.json$/;
const TEACHER_NAME = /^[a-z0-9][a-z0-9_-]{0,40}\.(jsonl|json|md)$/;
const TEACHER_SKIP = new Set(['status.json']); // "teacher is thinking…" is transient
const SCORE_NAME = /^[a-z0-9-]{1,48}-[0-9a-f]{8}\.(musicxml|mei|mxl)$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function writeAtomic(dir, name, content) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, join(dir, name));
  } catch (e) {
    rmSync(tmp, {force: true});
    throw e;
  }
}

const files = (dir, re) => {
  try { return readdirSync(dir).filter(n => re.test(n) && statSync(join(dir, n)).isFile()).sort(); } catch { return []; }
};

// ───────── export ─────────

export function collectServer({dataDir = DATA_DIR, teacherDir = TEACHER_DIR, songsDir = SONGS_DIR, recordingsDir = RECORDINGS_DIR, maxImportBytes = MAX_IMPORT_FILES_BYTES} = {}) {
  const data = {};
  for (const name of files(dataDir, DATA_NAME)) {
    try { data[name] = JSON.parse(readFileSync(join(dataDir, name), 'utf8')); } catch { /* unreadable file: left out */ }
  }
  const teacher = {};
  for (const name of files(teacherDir, TEACHER_NAME)) if (!TEACHER_SKIP.has(name)) teacher[name] = readFileSync(join(teacherDir, name), 'utf8');

  let index = [];
  try { index = JSON.parse(readFileSync(join(songsDir, 'index.json'), 'utf8')).songs || []; } catch {}
  index = index.filter(e => isObj(e) && ID_RE.test(e.id) && typeof e.file === 'string' && SCORE_NAME.test(e.file.slice(URL_BASE.length)));
  const scores = {}, skipped = [];
  let total = 0;
  for (const e of index) {
    const name = e.file.slice(URL_BASE.length);
    const path = join(songsDir, name);
    if (!existsSync(path)) continue;
    const size = statSync(path).size;
    if (total + size > maxImportBytes) { skipped.push(name); continue; }
    total += size;
    scores[name] = readFileSync(path).toString('base64');
  }
  // Recorded takes and mock-exam sheets (.data/recordings/**), newest first, size-capped.
  const recordings = {takes: [], exams: [], skipped: 0};
  let recBytes = 0;
  const keep = (list, into) => {
    for (const item of list) {
      const size = JSON.stringify(item).length;
      if (recBytes + size > MAX_RECORDINGS_BYTES) { recordings.skipped++; continue; }
      recBytes += size; into.push(item);
    }
  };
  try { keep(listTakes(recordingsDir), recordings.takes); } catch {}
  try { keep(listExams(recordingsDir), recordings.exams); } catch {}
  return {format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), server: {data, teacher, imports: {index, files: scores, skipped}, recordings}};
}

// ───────── validation ─────────

/** Checks a backup's server part → {data, teacher, imports, summary}. Throws HttpError(400). */
export function validateServerPart(backup) {
  if (!isObj(backup) || backup.format !== FORMAT) throw new HttpError(400, 'not a Piano Practice backup file');
  if (!Number.isInteger(backup.version) || backup.version > VERSION) throw new HttpError(400, `backup version ${backup.version} is newer than this app understands`);
  const s = isObj(backup.server) ? backup.server : {};
  const data = {};
  for (const [name, json] of Object.entries(isObj(s.data) ? s.data : {})) {
    if (!DATA_NAME.test(name)) throw new HttpError(400, `unexpected data file name: ${name.slice(0, 60)}`);
    if (name === 'progress.json') {
      if (!isObj(json)) throw new HttpError(400, 'progress.json is not an object');
      data[name] = normalizeDoc(json);
    } else if (name === 'collections.json') {
      // Favourites and collections (src/collections/): checked like a PUT to /__collections.
      try { data[name] = validateCollections(json); } catch (e) { throw new HttpError(400, `collections.json: ${e.message}`); }
    } else {
      const text = JSON.stringify(json);
      if (text === undefined || text.length > MAX_DATA_FILE) throw new HttpError(400, `${name} is too large or empty`);
      data[name] = json;
    }
  }
  const teacher = {};
  for (const [name, text] of Object.entries(isObj(s.teacher) ? s.teacher : {})) {
    if (!TEACHER_NAME.test(name) || TEACHER_SKIP.has(name)) throw new HttpError(400, `unexpected teacher file name: ${name.slice(0, 60)}`);
    if (typeof text !== 'string' || text.length > MAX_TEACHER_FILE) throw new HttpError(400, `${name} is not text or too large`);
    if (name.endsWith('.jsonl')) {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { throw new HttpError(400, `${name} has a line that is not JSON`); }
        if (!isObj(row)) throw new HttpError(400, `${name} has a line that is not an object`);
      }
    }
    teacher[name] = text;
  }
  const imp = isObj(s.imports) ? s.imports : {};
  const scoreFiles = isObj(imp.files) ? imp.files : {};
  const index = [];
  for (const e of Array.isArray(imp.index) ? imp.index : []) {
    if (!isObj(e) || !ID_RE.test(String(e.id)) || typeof e.file !== 'string' || !e.file.startsWith(URL_BASE)) throw new HttpError(400, 'an imported score entry is malformed');
    const name = e.file.slice(URL_BASE.length);
    if (!SCORE_NAME.test(name)) throw new HttpError(400, `unexpected score file name: ${name.slice(0, 60)}`);
    if (typeof e.title !== 'string' || !e.title) throw new HttpError(400, 'an imported score has no title');
    index.push(e);
  }
  const scores = {};
  for (const [name, b64] of Object.entries(scoreFiles)) {
    if (!SCORE_NAME.test(name) || typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, `bad score file: ${name.slice(0, 60)}`);
    scores[name] = Buffer.from(b64, 'base64');
  }
  const rec = isObj(s.recordings) ? s.recordings : {};
  const takes = Array.isArray(rec.takes) ? rec.takes : [], exams = Array.isArray(rec.exams) ? rec.exams : [];
  if (takes.length + exams.length > MAX_RECORDING_ITEMS || ![...takes, ...exams].every(isObj)) throw new HttpError(400, 'the recordings section is malformed');
  const progress = data['progress.json'];
  const count = text => (text || '').split('\n').filter(l => l.trim()).length;
  return {
    data, teacher, imports: {index, files: scores}, recordings: {takes, exams},
    summary: {
      exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt.slice(0, 40) : null,
      events: progress ? progress.events.length : 0,
      journal: progress ? (progress.journal || []).length : 0,
      collections: data['collections.json'] ? data['collections.json'].collections.length : 0,
      favourites: data['collections.json'] ? data['collections.json'].favourites.length : 0,
      dataFiles: Object.keys(data),
      teacherMessages: count(teacher['messages.jsonl']),
      teacherReplies: count(teacher['replies.jsonl']),
      teacherProfile: typeof teacher['student.md'] === 'string',
      imports: index.length,
      recordings: takes.length,
      examSheets: exams.length,
    },
  };
}

// ───────── restore ─────────

export function restoreServer(backup, {dataDir = DATA_DIR, teacherDir = TEACHER_DIR, songsDir = SONGS_DIR, recordingsDir = RECORDINGS_DIR, now = Date.now()} = {}) {
  const parsed = validateServerPart(backup);
  // Keep what's there now, so the restore can be undone.
  const before = collectServer({dataDir, teacherDir, songsDir, recordingsDir});
  const snapshotDir = join(dataDir, 'backups');
  const snapshot = `before-restore-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;
  writeAtomic(snapshotDir, snapshot, JSON.stringify(before));

  for (const [name, json] of Object.entries(parsed.data)) writeAtomic(dataDir, name, JSON.stringify(json) + '\n');
  for (const [name, text] of Object.entries(parsed.teacher)) writeAtomic(teacherDir, name, text);

  // Imports: add the scores this Mac doesn't have; never delete or overwrite.
  let added = 0;
  if (parsed.imports.index.length) {
    let current = [];
    try { current = JSON.parse(readFileSync(join(songsDir, 'index.json'), 'utf8')).songs || []; } catch {}
    const ids = new Set(current.map(e => e?.id)), hashes = new Set(current.map(e => e?.hash).filter(Boolean));
    for (const e of parsed.imports.index) {
      const name = e.file.slice(URL_BASE.length);
      if (ids.has(e.id) || (e.hash && hashes.has(e.hash))) continue;
      const bytes = parsed.imports.files[name];
      if (!bytes && !existsSync(join(songsDir, name))) continue; // index entry without its file
      if (bytes && !existsSync(join(songsDir, name))) writeAtomic(songsDir, name, bytes);
      current.push(e); ids.add(e.id); added++;
    }
    if (added) writeAtomic(songsDir, 'index.json', JSON.stringify({songs: current}, null, 2) + '\n');
  }
  // Recordings: add takes and exam sheets this Mac doesn't have; never overwrite or delete.
  // Each item goes through the recordings store's own validation; invalid ones are skipped.
  let takesAdded = 0, examsAdded = 0, recordingsSkipped = 0;
  for (const take of parsed.recordings.takes) {
    try { if (!readTake(recordingsDir, take.id)) { saveTake(recordingsDir, take); takesAdded++; } } catch { recordingsSkipped++; }
  }
  for (const exam of parsed.recordings.exams) {
    try { if (!readExam(recordingsDir, exam.id)) { saveExam(recordingsDir, exam); examsAdded++; } } catch { recordingsSkipped++; }
  }
  return {restored: {...parsed.summary, importsAdded: added, takesAdded, examsAdded, recordingsSkipped}, snapshot: `.data/backups/${snapshot}`};
}

// ───────── HTTP ─────────

function readBody(req, limit) {
  return new Promise((done, fail) => {
    if (Number(req.headers['content-length']) > limit) return fail(new HttpError(413, 'backup is too large'));
    const chunks = [];
    let size = 0, over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; fail(new HttpError(413, 'backup is too large')); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!over) done(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', fail);
  });
}

export function backupHandler(dirs = {}, {maxBody = MAX_RESTORE_BYTES} = {}) {
  return async (req, res, next) => {
    const [rawPath, query = ''] = (req.url || '/').split('?');
    const path = rawPath.replace(/\/+$/, '') || '/';
    try {
      if (path === '/' && req.method === 'GET') return send(res, 200, collectServer(dirs));
      if (path === '/restore' && req.method === 'POST') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
        let body;
        try { body = JSON.parse(await readBody(req, maxBody)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'the backup file is not valid JSON'); }
        if (new URLSearchParams(query).get('dryRun') === '1') return send(res, 200, {ok: true, summary: validateServerPart(body).summary});
        return send(res, 200, {ok: true, ...restoreServer(body, dirs)});
      }
      return next();
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[backup]', e);
      if (e.status === 413) res.setHeader('connection', 'close');
      send(res, e.status || 500, {error: e instanceof HttpError ? e.message : 'backup failed'});
    }
  };
}

export function backup(dirs = {}) {
  return {
    name: 'backup',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__backup', backupHandler(dirs));
    },
  };
}
