// Dev server only: keeps practice progress on the Mac's disk so it survives
// clearing site data and is shared by every device using this dev server.
//
//   GET  /__progress            → {store: 'disk', ...doc}   (doc shape: src/progress/model.js)
//   POST /__progress/events     ← [event, ...]  or  {events: [event, ...]}
//                               → {ok: true, added, rejected, total}
//                                 events: practice:result / practice:session / trainer:result / learn:step
//                                 payloads (docs/ARCHITECTURE.md) tagged with `type`, plus
//                                 optional `id` (dedupe key) and `tz` (getTimezoneOffset()).
//   PUT  /__progress/settings   ← {dailyGoalMin} → {ok: true, settings}
//   POST /__progress/journal    ← [entry, ...] or {entries: [...]} or one entry
//                               → {ok: true, added, rejected, total}   (practice-journal notes)
//   PUT  /__progress/goals      ← {goals: [goal, ...]} (replaces the list) → {ok: true, goals}
//
// Stored in .data/progress.json (gitignored), written atomically. The file name
// is fixed here; nothing the client sends ends up in a path.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {MAX_EVENTS, MAX_EVENTS_PER_REQUEST, MAX_GOALS, appendEvents, appendJournal, emptyDoc, normalizeDoc, sanitizeEvent, sanitizeGoals, sanitizeJournalEntry, sanitizeSettings} from '../src/progress/model.js';

export const DATA_DIR = resolve('.data');
export const FILE = 'progress.json';
export const MAX_BODY = 512 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

export function readDoc(dir) {
  const path = join(dir, FILE);
  if (!existsSync(path)) return emptyDoc();
  let json;
  try { json = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new HttpError(500, `${FILE} is not valid JSON; fix or remove it`); }
  return normalizeDoc(json);
}

export function writeDoc(dir, doc) {
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

/** Validates and appends a request body (sync, so requests can't interleave). */
export function addEvents(dir, body, {maxEvents = MAX_EVENTS, maxPerRequest = MAX_EVENTS_PER_REQUEST, now = Date.now()} = {}) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : null;
  if (!list) throw new HttpError(400, 'expected a JSON array of events');
  if (list.length > maxPerRequest) throw new HttpError(413, `send at most ${maxPerRequest} events per request`);
  const clean = list.map(e => sanitizeEvent(e, now)).filter(Boolean);
  const doc = readDoc(dir);
  const {added} = appendEvents(doc, clean, {maxEvents, now});
  if (added) writeDoc(dir, doc);
  return {added, rejected: list.length - clean.length, total: doc.events.length};
}

export function setSettings(dir, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'expected a JSON object');
  const doc = readDoc(dir);
  doc.settings = sanitizeSettings(body, doc.settings);
  doc.updatedAt = Date.now();
  writeDoc(dir, doc);
  return doc.settings;
}

/** Validates and appends practice-journal notes. */
export function addJournal(dir, body, {now = Date.now()} = {}) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.entries) ? body.entries : body && typeof body === 'object' ? [body] : null;
  if (!list) throw new HttpError(400, 'expected a journal entry or a JSON array of them');
  if (list.length > 200) throw new HttpError(413, 'send at most 200 journal entries per request');
  const clean = list.map(e => sanitizeJournalEntry(e, now)).filter(Boolean);
  const doc = readDoc(dir);
  const added = appendJournal(doc, clean, {now});
  if (added) writeDoc(dir, doc);
  return {added, rejected: list.length - clean.length, total: doc.journal.length};
}

/** Replaces the goals list (invalid goals are dropped). */
export function setGoals(dir, body, {now = Date.now()} = {}) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.goals) ? body.goals : null;
  if (!list) throw new HttpError(400, 'expected {goals: [...]}');
  if (list.length > MAX_GOALS) throw new HttpError(400, `at most ${MAX_GOALS} goals`);
  const doc = readDoc(dir);
  doc.goals = sanitizeGoals(list, now);
  doc.updatedAt = now;
  writeDoc(dir, doc);
  return doc.goals;
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

async function readJson(req, limit) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
  const body = await readBody(req, limit);
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'not JSON'); }
}

/** Connect-style handler, mounted at /__progress (req.url is the rest). */
export function progressHandler(dir = DATA_DIR, {maxBody = MAX_BODY, maxEvents = MAX_EVENTS, maxPerRequest = MAX_EVENTS_PER_REQUEST} = {}) {
  return async (req, res, next) => {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    try {
      if (path === '/' && req.method === 'GET') return send(res, 200, {store: 'disk', ...readDoc(dir)});
      if (path === '/events' && req.method === 'POST') {
        const body = await readJson(req, maxBody);
        return send(res, 200, {ok: true, ...addEvents(dir, body, {maxEvents, maxPerRequest})});
      }
      if (path === '/settings' && (req.method === 'PUT' || req.method === 'POST')) {
        const body = await readJson(req, 4096);
        return send(res, 200, {ok: true, settings: setSettings(dir, body)});
      }
      if (path === '/journal' && req.method === 'POST') {
        const body = await readJson(req, 128 * 1024);
        return send(res, 200, {ok: true, ...addJournal(dir, body)});
      }
      if (path === '/goals' && (req.method === 'PUT' || req.method === 'POST')) {
        const body = await readJson(req, 32 * 1024);
        return send(res, 200, {ok: true, goals: setGoals(dir, body)});
      }
      return next();
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[progress-store]', e);
      if (e.status === 413) res.setHeader('connection', 'close');
      send(res, e.status || 500, {error: e instanceof HttpError ? e.message : 'could not save progress'});
    }
  };
}

export function progressStore({dir = DATA_DIR} = {}) {
  return {
    name: 'progress-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__progress', progressHandler(dir));
    },
  };
}
