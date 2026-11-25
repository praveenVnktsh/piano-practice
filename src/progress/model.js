// Progress document: validation and aggregation, shared by the dev-server store
// (progress-store/plugin.js) and the browser fallback (src/progress/store.js).
// Pure functions, no DOM or Node APIs.
//
// doc = {
//   version: 1,
//   settings: {dailyGoalMin},
//   events: [event, ...]            raw events, oldest first, capped (oldest pruned)
//   totals: {                       aggregates over *every* event ever added (survive pruning)
//     days:    {'YYYY-MM-DD': {ms, listenMs, practiceMs, trainerMs, sessions, results}},
//     songs:   {songId: {title, attempts, best, latest, lastAt, ms, bestTempo}},
//     trainer: {'YYYY-MM-DD': {drills, right, wrong, msTotal, notes, bestLevel}},
//     pruned,                       number of raw events dropped so far
//   },
//   updatedAt,
// }
// event = {type: 'practice:result' | 'practice:session' | 'trainer:result', id, at, tz, ...payload}
// `tz` is the client's Date#getTimezoneOffset() when the event happened, so day
// keys are the player's *local* day even when the server runs elsewhere.

export const VERSION = 1;
export const EVENT_TYPES = ['practice:result', 'practice:session', 'trainer:result'];
export const DEFAULT_GOAL_MIN = 15;
export const MIN_SESSION_MS = 3000;
export const MAX_EVENTS = 20000;          // raw events kept on disk
export const MAX_EVENTS_PER_REQUEST = 500;
const MIN_AT = Date.UTC(2020, 0, 1);
const MAX_DURATION = 12 * 3600e3;         // one event can't claim more than 12 h
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const text = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const int = (v, lo, hi) => { const n = num(v, lo, hi); return n == null ? null : Math.round(n); };

/** Local calendar day ('YYYY-MM-DD') of a timestamp, for a getTimezoneOffset()-style offset in minutes. */
export function dayKey(at, tz = new Date(at).getTimezoneOffset()) {
  return new Date(at - tz * 60000).toISOString().slice(0, 10);
}

/** Validates one raw event → a clean event or null. `now` bounds future timestamps. */
export function sanitizeEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = raw.type;
  if (!EVENT_TYPES.includes(type)) return null;
  const at = int(raw.at, 0, Number.MAX_SAFE_INTEGER);
  if (at == null || at < MIN_AT || at > now + 864e5) return null;
  const tz = int(raw.tz, -840, 840) ?? 0;
  const ev = {type, at, tz};
  if (typeof raw.id === 'string' && ID_RE.test(raw.id)) ev.id = raw.id;
  const durationMs = int(raw.durationMs, 0, MAX_DURATION);

  if (type === 'practice:session') {
    const songId = text(raw.songId, 200);
    if (!songId || durationMs == null || durationMs < MIN_SESSION_MS) return null;
    ev.songId = songId;
    ev.title = text(raw.title, 200);
    ev.kind = raw.kind === 'listen' ? 'listen' : 'practice';
    ev.durationMs = durationMs;
    return ev;
  }
  if (type === 'practice:result') {
    const songId = text(raw.songId, 200);
    const accuracy = num(raw.accuracy, 0, 100);
    if (!songId || accuracy == null) return null;
    ev.songId = songId;
    ev.title = text(raw.title, 200);
    ev.accuracy = Math.round(accuracy * 10) / 10;
    if (Array.isArray(raw.section) && raw.section.length === 2) {
      const [a, b] = raw.section.map(v => int(v, 0, 100000));
      if (a != null && b != null) ev.section = [a, b];
    }
    ev.mode = raw.mode === 'timed' ? 'timed' : 'wait';
    ev.hands = ['right', 'left'].includes(raw.hands) ? raw.hands : 'both';
    const tempo = num(raw.tempo, 1, 400);
    if (tempo != null) ev.tempo = Math.round(tempo);
    ev.right = int(raw.right, 0, 1e6) ?? 0;
    ev.wrong = int(raw.wrong, 0, 1e6) ?? 0;
    if (raw.timing && typeof raw.timing === 'object') {
      ev.timing = {early: int(raw.timing.early, 0, 1e6) ?? 0, late: int(raw.timing.late, 0, 1e6) ?? 0, onTime: int(raw.timing.onTime, 0, 1e6) ?? 0};
    } else ev.timing = null;
    ev.durationMs = durationMs ?? 0;
    // Optional detail for the AI teacher (docs/ARCHITECTURE.md, Teacher hooks v2.1).
    if (Array.isArray(raw.misses)) {
      const notes = v => (Array.isArray(v) ? v.slice(0, 12).map(n => text(String(n ?? ''), 8)).filter(Boolean) : []);
      ev.misses = raw.misses.slice(0, 50).filter(isObj).map(m => ({measure: text(String(m.measure ?? ''), 16), expected: notes(m.expected), played: notes(m.played)}));
    }
    return ev;
  }
  // trainer:result
  const accuracy = num(raw.accuracy, 0, 100);
  if (accuracy == null) return null;
  ev.level = typeof raw.level === 'number' ? int(raw.level, 0, 1000) : text(String(raw.level ?? ''), 40);
  ev.right = int(raw.right, 0, 1e6) ?? 0;
  ev.wrong = int(raw.wrong, 0, 1e6) ?? 0;
  ev.accuracy = Math.round(accuracy * 10) / 10;
  ev.avgMs = int(raw.avgMs, 0, 600000) ?? 0;
  ev.durationMs = durationMs ?? 0;
  return ev;
}

export function emptyDoc() {
  return {version: VERSION, settings: {dailyGoalMin: DEFAULT_GOAL_MIN}, events: [], totals: {days: {}, songs: {}, trainer: {}, pruned: 0}, updatedAt: 0};
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** Coerces a stored/received document into the expected shape (never throws). */
export function normalizeDoc(json) {
  const doc = emptyDoc();
  if (!isObj(json)) return doc;
  doc.settings = sanitizeSettings(json.settings, doc.settings);
  if (Array.isArray(json.events)) doc.events = json.events.map(e => sanitizeEvent(e, Infinity)).filter(Boolean);
  if (isObj(json.totals)) {
    for (const k of ['days', 'songs', 'trainer']) if (isObj(json.totals[k])) doc.totals[k] = json.totals[k];
    doc.totals.pruned = int(json.totals.pruned, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  } else for (const ev of doc.events) addToTotals(doc.totals, ev); // totals missing: rebuild from raw events
  doc.updatedAt = int(json.updatedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  return doc;
}

export function sanitizeSettings(raw, base = {dailyGoalMin: DEFAULT_GOAL_MIN}) {
  const out = {...base};
  if (isObj(raw)) {
    const goal = raw.dailyGoalMin;
    if (typeof goal === 'number' && goal >= 1 && goal <= 600) out.dailyGoalMin = Math.round(goal);
  }
  return out;
}

function addToTotals(totals, ev) {
  const day = dayKey(ev.at, ev.tz);
  const d = (totals.days[day] ||= {ms: 0, listenMs: 0, practiceMs: 0, trainerMs: 0, sessions: 0, results: 0});
  if (ev.type === 'practice:session') {
    d.ms += ev.durationMs; d.sessions++;
    if (ev.kind === 'listen') d.listenMs += ev.durationMs; else d.practiceMs += ev.durationMs;
    const s = song(totals, ev);
    s.ms += ev.durationMs;
    s.lastAt = Math.max(s.lastAt, ev.at);
  } else if (ev.type === 'practice:result') {
    d.results++;
    const s = song(totals, ev);
    s.attempts++;
    s.best = Math.max(s.best ?? 0, ev.accuracy);
    if (ev.at >= (s.latestAt || 0)) { s.latest = ev.accuracy; s.latestAt = ev.at; }
    if (ev.tempo && ev.accuracy >= 90) s.bestTempo = Math.max(s.bestTempo || 0, ev.tempo);
    s.lastAt = Math.max(s.lastAt, ev.at);
  } else {
    d.ms += ev.durationMs; d.trainerMs += ev.durationMs;
    const t = (totals.trainer[day] ||= {drills: 0, right: 0, wrong: 0, msTotal: 0, notes: 0, bestLevel: null});
    const notes = ev.right + ev.wrong;
    t.drills++; t.right += ev.right; t.wrong += ev.wrong;
    t.msTotal += ev.avgMs * notes; t.notes += notes;
    if (typeof ev.level === 'number') t.bestLevel = Math.max(t.bestLevel ?? 0, ev.level);
  }
}

function song(totals, ev) {
  const s = (totals.songs[ev.songId] ||= {title: '', attempts: 0, best: null, latest: null, latestAt: 0, lastAt: 0, ms: 0, bestTempo: 0});
  if (ev.title) s.title = ev.title;
  return s;
}

/**
 * Appends already-sanitized events to `doc` (mutates it): skips ids already present,
 * updates totals, then drops the oldest raw events beyond `maxEvents` (totals keep them).
 * → {added, pruned}
 */
export function appendEvents(doc, events, {maxEvents = MAX_EVENTS, now = Date.now()} = {}) {
  const seen = new Set(doc.events.map(e => e.id).filter(Boolean));
  let added = 0;
  for (const ev of events) {
    if (ev.id) { if (seen.has(ev.id)) continue; seen.add(ev.id); }
    doc.events.push(ev);
    addToTotals(doc.totals, ev);
    added++;
  }
  if (added) doc.events.sort((a, b) => a.at - b.at);
  const over = doc.events.length - maxEvents;
  if (over > 0) { doc.events.splice(0, over); doc.totals.pruned += over; }
  if (added) doc.updatedAt = now;
  return {added, pruned: Math.max(0, over)};
}
