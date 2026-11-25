// Dev server only: keeps imported scores on the Mac's disk so they survive
// clearing site data and show up on every device using this dev server
// (e.g. an iPad on http://<mac-ip>:5173, see `npm run dev:ipad`).
//
//   GET    /__songs        → {store: 'disk', songs: [entry, ...]} (newest first)
//   POST   /__songs        ← {title, composer?, data | mxlBase64, id?, added?, omr?, partial?}
//                          → 201 entry (200 + duplicate:true if the same title and content exist)
//   DELETE /__songs/<id>   → {ok: true} (404 if unknown)
//
// entry = {id, title, composer?, added, file, format, hash, omr?, partial?}
// Files go to public/songs/local/imports/<slug>-<shortid>.<musicxml|mei|mxl>
// (gitignored, dropped from production builds) and are listed in index.json
// there. Filenames are always generated here; nothing the client sends ends
// up in a path.
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, createReadStream} from 'node:fs';
import {join, resolve} from 'node:path';

export const SONGS_DIR = resolve('public/songs/local/imports');
export const URL_BASE = 'songs/local/imports/'; // relative to the site root (public/)
export const MAX_BODY = 50 * 1024 * 1024;

export const ID_RE = /^import:[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^[a-z0-9-]{1,48}-[0-9a-f]{8}\.(musicxml|mei|mxl)$/;
const SCORE_RE = /<(score-partwise|score-timewise|mei)\b/;
const MIME = {musicxml: 'application/vnd.recordare.musicxml+xml', mei: 'application/mei+xml', mxl: 'application/vnd.recordare.musicxml'};

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ───────── index.json ─────────

function readIndex(dir) {
  const path = join(dir, 'index.json');
  if (!existsSync(path)) return [];
  let json;
  try { json = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new HttpError(500, 'index.json is not valid JSON; fix or remove it'); }
  return (Array.isArray(json?.songs) ? json.songs : []).filter(e => e && ID_RE.test(e.id) && typeof e.file === 'string' && e.file.startsWith(URL_BASE) && FILE_RE.test(e.file.slice(URL_BASE.length)));
}

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

const writeIndex = (dir, songs) => writeAtomic(dir, 'index.json', JSON.stringify({songs}, null, 2) + '\n');

// ───────── validation ─────────

function slug(title) {
  const s = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'score';
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Validates a POSTed body → {meta, bytes, format, hash}. Throws HttpError(400). */
export function parseSong(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new HttpError(400, 'expected a JSON object');
  const title = cleanText(fields.title, 200);
  if (!title) throw new HttpError(400, 'a song needs a title');
  let bytes, format;
  if (typeof fields.data === 'string') {
    const text = fields.data.replace(/^\uFEFF/, '');
    if (!/^\s*</.test(text) || !SCORE_RE.test(text)) throw new HttpError(400, 'this does not look like MusicXML or MEI');
    const root = text.match(SCORE_RE)[1];
    format = root === 'mei' ? 'mei' : 'musicxml';
    bytes = Buffer.from(fields.data, 'utf8');
  } else if (typeof fields.mxlBase64 === 'string') {
    const b64 = fields.mxlBase64.replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4) throw new HttpError(400, 'mxlBase64 is not base64');
    bytes = Buffer.from(b64, 'base64');
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new HttpError(400, 'mxlBase64 is not a compressed MusicXML (zip) file');
    format = 'mxl';
  } else throw new HttpError(400, 'send the score as data (MusicXML/MEI text) or mxlBase64');

  const meta = {title};
  const composer = cleanText(fields.composer, 200);
  if (composer) meta.composer = composer;
  if (typeof fields.id === 'string' && ID_RE.test(fields.id)) meta.id = fields.id;
  if (Number.isFinite(fields.added) && fields.added > 0 && fields.added < 1e14) meta.added = Math.round(fields.added);
  if (fields.omr === true) meta.omr = true;
  if (fields.partial === true) meta.partial = true;
  return {meta, bytes, format, hash: createHash('sha256').update(bytes).digest('hex')};
}

// ───────── store operations (sync, so requests can't interleave) ─────────

export function listSongs(dir) {
  return readIndex(dir).sort((a, b) => (b.added || 0) - (a.added || 0));
}

export function addSong(dir, fields) {
  const {meta, bytes, format, hash} = parseSong(fields);
  const songs = readIndex(dir);
  const dup = songs.find(e => e.hash === hash && e.title === meta.title);
  if (dup) return {entry: dup, duplicate: true};
  let id = meta.id;
  if (!id || songs.some(e => e.id === id)) id = 'import:' + randomBytes(12).toString('hex');
  let name;
  do name = `${slug(meta.title)}-${randomBytes(4).toString('hex')}.${format}`;
  while (existsSync(join(dir, name)));
  writeAtomic(dir, name, bytes);
  const entry = {
    id, title: meta.title, ...(meta.composer ? {composer: meta.composer} : {}),
    added: meta.added ?? Date.now(), file: URL_BASE + name, format, hash,
    ...(meta.omr ? {omr: true} : {}), ...(meta.partial ? {partial: true} : {}),
  };
  try { writeIndex(dir, [...songs, entry]); }
  catch (e) { rmSync(join(dir, name), {force: true}); throw e; }
  return {entry, duplicate: false};
}

export function deleteSong(dir, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'bad song id');
  const songs = readIndex(dir);
  const entry = songs.find(e => e.id === id);
  if (!entry) throw new HttpError(404, 'no such song');
  writeIndex(dir, songs.filter(e => e !== entry));
  rmSync(join(dir, entry.file.slice(URL_BASE.length)), {force: true});
  return entry;
}

// ───────── HTTP ─────────

function readBody(req, limit) {
  return new Promise((done, fail) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return fail(new HttpError(413, 'score is larger than 50 MB'));
    const chunks = [];
    let size = 0, over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; fail(new HttpError(413, 'score is larger than 50 MB')); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!over) done(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', fail);
  });
}

/** Connect-style handler, mounted at /__songs (req.url is the rest: "/" or "/<id>"). */
export function songsHandler(dir = SONGS_DIR, {maxBody = MAX_BODY} = {}) {
  return async (req, res, next) => {
    const path = (req.url || '/').split('?')[0];
    try {
      if (path === '/' || path === '') {
        if (req.method === 'GET') return send(res, 200, {store: 'disk', songs: listSongs(dir)});
        if (req.method === 'POST') {
          if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'send JSON');
          const body = await readBody(req, maxBody);
          let fields;
          try { fields = JSON.parse(body); } catch { throw new HttpError(400, 'not JSON'); }
          const {entry, duplicate} = addSong(dir, fields);
          return send(res, duplicate ? 200 : 201, duplicate ? {...entry, duplicate: true} : entry);
        }
        return next();
      }
      const m = path.match(/^\/([^/]+)$/);
      if (m && req.method === 'DELETE') {
        let id;
        try { id = decodeURIComponent(m[1]); } catch { throw new HttpError(400, 'bad song id'); }
        deleteSong(dir, id);
        return send(res, 200, {ok: true});
      }
      return next();
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[song-store]', e);
      if (e.status === 413) res.setHeader('connection', 'close');
      send(res, e.status || 500, {error: e instanceof HttpError ? e.message : 'could not save the song'});
    }
  };
}

/** Serves the stored files directly, so a just-saved song plays before Vite notices the new file. */
export function filesHandler(dir = SONGS_DIR) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const name = (req.url || '').split('?')[0].replace(/^\//, '');
    if (!FILE_RE.test(name)) return next();
    const path = join(dir, name);
    let stat;
    try { stat = statSync(path); } catch { return next(); }
    res.setHeader('content-type', MIME[name.split('.').pop()]);
    res.setHeader('content-length', stat.size);
    res.setHeader('cache-control', 'no-cache');
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).pipe(res);
  };
}

export function songStore({dir = SONGS_DIR} = {}) {
  return {
    name: 'song-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__songs', songsHandler(dir));
      server.middlewares.use('/' + URL_BASE.replace(/\/$/, ''), filesHandler(dir));
    },
  };
}
