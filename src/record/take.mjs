// A recorded performance ("take") and a mock-exam results sheet: their shape, limits and
// validation. Pure (no DOM, no Node APIs): shared by the browser store (./store.js), the dev
// server plugin (recordings/plugin.js) and the teacher CLI (teacher/cli.js).
//
// Take (JSON, one file per take on the Mac: .data/recordings/<songDir>/<takeId>.json):
//   {v: 1, id, songId, title, composer, name, at (ms epoch), durationMs, tempo (BPM when recorded),
//    section: [first, last] (0-based measure indices), hands: 'both'|'right'|'left',
//    mode: 'free'|'listen'|'practice'|'exam', source: 'midi'|'relay'|'screen'|'mixed',
//    notes: [[onMs, midi, velocity 1–127, durationMs], …]   (onMs from the start of the take)
//    pedal: [[ms, value 0–127], …]                           (sustain pedal, CC 64)
//    report: {…} | null    the comparison with the score (./report.mjs), computed in the browser
//    exam?: examId, examItem?: 0-based index, sentAt?: ms (sent to the teacher)}
// Exam sheet (.data/recordings/_exams/<examId>.json):
//   {v: 1, id, at, name, items: [{kind: 'piece'|'scale'|'sight-reading', songId, title, takeId|null,
//    mark, max, band, comment, …}], total, max, band, remarks: [..]}

export const TAKE_VERSION = 1;
export const MAX_NOTES = 20000;
export const MAX_PEDAL = 8000;
export const MAX_DURATION_MS = 2 * 60 * 60 * 1000; // two hours
export const MAX_TAKE_BYTES = 2 * 1024 * 1024;
export const MAX_REPORT_BYTES = 512 * 1024;
export const MAX_EXAM_BYTES = 256 * 1024;
export const MAX_NAME = 80;
export const MAX_SONG_ID = 200;
export const MAX_TAKES_PER_SONG = 200;
export const ID_RE = /^[a-z0-9]{8,40}$/;
export const MODES = ['free', 'listen', 'practice', 'exam'];
export const SOURCES = ['midi', 'relay', 'screen', 'mixed'];
export const HANDS = ['both', 'right', 'left'];
export const EXAMS_DIR = '_exams';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
// Control characters (U+0000–U+001F, U+007F).
const isControl = c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127;
const text = (v, max) => (typeof v === 'string' ? [...v].map(c => (isControl(c) ? ' ' : c)).join('').trim().slice(0, max) : '');

/** A fresh id: time (base 36) + randomness, lowercase letters and digits. */
export function newId(now = Date.now(), rand = Math.random) {
  let r = '';
  while (r.length < 8) r += Math.floor(rand() * 36).toString(36);
  return Math.max(0, Math.floor(now)).toString(36).padStart(9, '0') + r.slice(0, 8);
}

/** A song id is any short printable string (catalog ids, "import:…", "ex:…", "mutopia:…", "sr:…"). */
export function validSongId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_SONG_ID && ![...id].some(isControl);
}

// Song ids become directory names: letters, digits, "-" and "_" stay; every other byte (and a
// leading "_", so no song can land in _exams) is written "~XX". Reversible and path-safe.
export function songDir(songId) {
  if (!validSongId(songId)) throw new Error('invalid song id');
  const bytes = new TextEncoder().encode(songId);
  let out = '';
  bytes.forEach((b, i) => {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9-]/.test(c) || (c === '_' && i > 0) ? c : '~' + b.toString(16).padStart(2, '0');
  });
  return out;
}
export function songIdFromDir(dir) {
  if (typeof dir !== 'string' || !/^(?:[A-Za-z0-9-]|~[0-9a-f]{2})(?:[A-Za-z0-9_-]|~[0-9a-f]{2})*$/.test(dir)) return null;
  const bytes = [];
  for (let i = 0; i < dir.length; i++) {
    if (dir[i] === '~') { bytes.push(parseInt(dir.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(dir.charCodeAt(i));
  }
  try { return new TextDecoder('utf-8', {fatal: true}).decode(new Uint8Array(bytes)); } catch { return null; }
}

class ValidationError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
const fail = message => { throw new ValidationError(message); };

function cleanNotes(list) {
  if (!Array.isArray(list)) fail('notes must be an array');
  if (list.length > MAX_NOTES) fail(`a take holds at most ${MAX_NOTES} notes`);
  const out = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 3) fail('each note is [onMs, midi, velocity, durationMs]');
    const [at, n, v, d = 0] = row.map(int);
    if (!(at >= 0 && at <= MAX_DURATION_MS)) fail('note time out of range');
    if (!(n >= 0 && n <= 127)) fail('note number out of range');
    if (!(v >= 1 && v <= 127)) fail('velocity out of range');
    if (!(d >= 0 && d <= MAX_DURATION_MS)) fail('note length out of range');
    out.push([at, n, v, d]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function cleanPedal(list = []) {
  if (!Array.isArray(list)) fail('pedal must be an array');
  if (list.length > MAX_PEDAL) fail(`a take holds at most ${MAX_PEDAL} pedal changes`);
  return list.map(row => {
    if (!Array.isArray(row) || row.length < 2) fail('each pedal change is [ms, value]');
    const [at, v] = row.map(int);
    if (!(at >= 0 && at <= MAX_DURATION_MS) || !(v >= 0 && v <= 127)) fail('pedal change out of range');
    return [at, v];
  }).sort((a, b) => a[0] - b[0]);
}

function cleanReport(r) {
  if (r == null) return null;
  if (!isObj(r)) fail('report must be an object');
  const json = JSON.stringify(r);
  if (json.length > MAX_REPORT_BYTES) fail('report is too large');
  return JSON.parse(json);
}

/** Checks and normalises a take → a clean copy. Throws an Error with `status: 400` when invalid. */
export function validateTake(t) {
  if (!isObj(t)) fail('a take is a JSON object');
  if (JSON.stringify(t).length > MAX_TAKE_BYTES) fail('take is too large');
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) fail('invalid take id');
  if (!validSongId(t.songId)) fail('invalid song id');
  const at = int(t.at);
  if (!(at > 0)) fail('invalid time');
  const notes = cleanNotes(t.notes);
  const pedal = cleanPedal(t.pedal);
  const last = Math.max(0, ...notes.map(n => n[0] + n[3]), ...pedal.map(p => p[0]));
  let durationMs = int(t.durationMs);
  if (!(durationMs >= 0)) durationMs = last;
  durationMs = Math.min(MAX_DURATION_MS, Math.max(durationMs, last));
  const tempo = int(t.tempo);
  let section = null;
  if (Array.isArray(t.section) && t.section.length === 2) {
    const [a, b] = t.section.map(int);
    if (a >= 0 && b >= a && b < 100000) section = [a, b];
  }
  const out = {
    v: TAKE_VERSION, id: t.id, songId: t.songId,
    title: text(t.title, 200), composer: text(t.composer, 200), name: text(t.name, MAX_NAME),
    at, durationMs,
    tempo: tempo >= 10 && tempo <= 400 ? tempo : null,
    section,
    hands: HANDS.includes(t.hands) ? t.hands : 'both',
    mode: MODES.includes(t.mode) ? t.mode : 'free',
    source: SOURCES.includes(t.source) ? t.source : 'mixed',
    notes, pedal,
    report: cleanReport(t.report),
  };
  if (t.exam != null) {
    if (typeof t.exam !== 'string' || !ID_RE.test(t.exam)) fail('invalid exam id');
    out.exam = t.exam;
    const k = int(t.examItem);
    if (k >= 0 && k < 20) out.examItem = k;
  }
  const sent = int(t.sentAt);
  if (sent > 0) out.sentAt = sent;
  return out;
}

/** Changes the student may make to a saved take: {name?, report?, sentAt?}. → the updated take. */
export function patchTake(take, patch) {
  if (!isObj(patch)) fail('send a JSON object');
  const next = {...take};
  if ('name' in patch) next.name = text(patch.name, MAX_NAME);
  if ('report' in patch) next.report = cleanReport(patch.report);
  if ('sentAt' in patch) { const s = int(patch.sentAt); if (s > 0) next.sentAt = s; else delete next.sentAt; }
  return validateTake(next);
}

/** The list entry for a take (no notes): what lists and the teacher CLI show. */
export function takeMeta(t) {
  const s = t.report?.summary;
  return {
    id: t.id, songId: t.songId, title: t.title, composer: t.composer, name: t.name, at: t.at, durationMs: t.durationMs,
    tempo: t.tempo, section: t.section, hands: t.hands, mode: t.mode, source: t.source, notes: t.notes.length,
    summary: s ? {accuracy: s.accuracy, right: s.right, missed: s.missed, wrong: s.wrong, extra: s.extra, timing: t.report.timing?.score ?? null,
      tempo: t.report.timing?.meanBpm ?? null, evenness: t.report.evenness?.score ?? null, score: t.report.score ?? null} : null,
    ...(t.exam ? {exam: t.exam, examItem: t.examItem} : {}),
    ...(t.sentAt ? {sentAt: t.sentAt} : {}),
  };
}

const BANDS = ['Distinction', 'Merit', 'Pass', 'Below pass'];
/** Checks a mock-exam results sheet → a clean copy. Throws (status 400) when invalid. */
export function validateExam(e) {
  if (!isObj(e)) fail('an exam sheet is a JSON object');
  if (JSON.stringify(e).length > MAX_EXAM_BYTES) fail('exam sheet is too large');
  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) fail('invalid exam id');
  const at = int(e.at);
  if (!(at > 0)) fail('invalid time');
  if (!Array.isArray(e.items) || !e.items.length || e.items.length > 8) fail('an exam has 1–8 items');
  const items = e.items.map(it => {
    if (!isObj(it)) fail('each exam item is an object');
    const max = int(it.max), mark = int(it.mark);
    if (!(max > 0 && max <= 100)) fail('item max out of range');
    if (!(mark >= 0 && mark <= max)) fail('item mark out of range');
    if (it.songId != null && !validSongId(it.songId)) fail('invalid song id');
    if (it.takeId != null && (typeof it.takeId !== 'string' || !ID_RE.test(it.takeId))) fail('invalid take id');
    return {
      kind: ['piece', 'scale', 'sight-reading'].includes(it.kind) ? it.kind : 'piece',
      songId: it.songId ?? null, title: text(it.title, 200), takeId: it.takeId ?? null,
      mark, max, band: BANDS.includes(it.band) ? it.band : null, comment: text(it.comment, 600),
      accuracy: Number.isFinite(it.accuracy) ? Math.round(it.accuracy) : null,
      timing: Number.isFinite(it.timing) ? Math.round(it.timing) : null,
      evenness: Number.isFinite(it.evenness) ? Math.round(it.evenness) : null,
    };
  });
  const total = items.reduce((a, it) => a + it.mark, 0), max = items.reduce((a, it) => a + it.max, 0);
  return {
    v: TAKE_VERSION, id: e.id, at, name: text(e.name, MAX_NAME) || 'Mock exam', items, total, max,
    band: BANDS.includes(e.band) ? e.band : null,
    remarks: Array.isArray(e.remarks) ? e.remarks.slice(0, 6).map(r => text(r, 300)).filter(Boolean) : [],
  };
}
