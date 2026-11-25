// Progress document: validation and aggregation, shared by the dev-server store
// (progress-store/plugin.js) and the browser fallback (src/progress/store.js).
// Pure functions, no DOM or Node APIs.
//
// doc = {
//   version: 1,
//   settings: {dailyGoalMin, pathStart?},
//   events: [event, ...]            raw events, oldest first, capped (oldest pruned)
//   totals: {                       aggregates over *every* event ever added (survive pruning)
//     days:    {'YYYY-MM-DD': {ms, listenMs, practiceMs, trainerMs, sessions, results}},
//     songs:   {songId: {title, attempts, best, latest, lastAt, ms, bestTempo}},
//     trainer: {'YYYY-MM-DD': {drills, right, wrong, msTotal, notes, bestLevel}},
//     pruned,                       number of raw events dropped so far
//   },
//   journal: [entry, ...]           practice-journal notes, oldest first (≤ MAX_JOURNAL)
//   goals:   [goal, ...]            dated goals (≤ MAX_GOALS)
//   updatedAt,
// }
// entry = {id, at, tz, text, mood?: 'good' | 'okay' | 'hard', songId?, title?, minutes?}
// goal  = {id, songId, title, bpm, accuracy, by: 'YYYY-MM-DD', createdAt}
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
export const MAX_JOURNAL = 1000;
export const MAX_JOURNAL_TEXT = 280;
export const MAX_GOALS = 20;
export const MOODS = ['good', 'okay', 'hard'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const measureCount = int(raw.measureCount, 1, 100000);
    if (measureCount != null) ev.measureCount = measureCount;
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
  return {version: VERSION, settings: {dailyGoalMin: DEFAULT_GOAL_MIN}, events: [], totals: {days: {}, songs: {}, trainer: {}, pruned: 0}, journal: [], goals: [], updatedAt: 0};
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
  if (Array.isArray(json.journal)) doc.journal = json.journal.map(e => sanitizeJournalEntry(e, Infinity)).filter(Boolean).slice(-MAX_JOURNAL);
  doc.goals = sanitizeGoals(json.goals, Infinity);
  doc.updatedAt = int(json.updatedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  return doc;
}

/** A real calendar day 'YYYY-MM-DD' (rejects 2026-02-30). */
export function isDayKey(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Validates one practice-journal note → a clean entry or null. */
export function sanitizeJournalEntry(raw, now = Date.now()) {
  if (!isObj(raw)) return null;
  const at = int(raw.at, 0, Number.MAX_SAFE_INTEGER);
  if (at == null || at < MIN_AT || at > now + 864e5) return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  const said = text(raw.text, MAX_JOURNAL_TEXT);
  const mood = MOODS.includes(raw.mood) ? raw.mood : null;
  if (!said && !mood) return null;
  const e = {id: raw.id, at, tz: int(raw.tz, -840, 840) ?? 0, text: said};
  if (mood) e.mood = mood;
  const songId = text(raw.songId, 200);
  if (songId) { e.songId = songId; const title = text(raw.title, 200); if (title) e.title = title; }
  const minutes = int(raw.minutes, 0, 720);
  if (minutes != null) e.minutes = minutes;
  return e;
}

/** Adds journal entries (mutates doc; ids already present are skipped) → number added. */
export function appendJournal(doc, entries, {now = Date.now()} = {}) {
  doc.journal ||= [];
  const seen = new Set(doc.journal.map(e => e.id));
  let added = 0;
  for (const e of entries) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    doc.journal.push(e);
    added++;
  }
  if (added) {
    doc.journal.sort((a, b) => a.at - b.at);
    if (doc.journal.length > MAX_JOURNAL) doc.journal.splice(0, doc.journal.length - MAX_JOURNAL);
    doc.updatedAt = now;
  }
  return added;
}

/** Validates one goal ("Für Elise at 72 BPM by 1 March") → a clean goal or null. */
export function sanitizeGoal(raw, now = Date.now()) {
  if (!isObj(raw)) return null;
  const songId = text(raw.songId, 200);
  const bpm = int(raw.bpm, 20, 300);
  if (!songId || bpm == null || !isDayKey(raw.by)) return null;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  if (!id) return null;
  const createdAt = int(raw.createdAt, 0, Number.MAX_SAFE_INTEGER);
  return {
    id, songId, title: text(raw.title, 200), bpm,
    accuracy: int(raw.accuracy, 50, 100) ?? 90,
    by: raw.by,
    createdAt: createdAt != null && createdAt >= MIN_AT && createdAt <= now + 864e5 ? createdAt : 0,
  };
}

export function sanitizeGoals(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const raw of list.slice(0, MAX_GOALS * 2)) {
    const g = sanitizeGoal(raw, now);
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out.slice(0, MAX_GOALS);
}

export function sanitizeSettings(raw, base = {dailyGoalMin: DEFAULT_GOAL_MIN}) {
  const out = {...base};
  if (isObj(raw)) {
    const goal = raw.dailyGoalMin;
    if (typeof goal === 'number' && goal >= 1 && goal <= 600) out.dailyGoalMin = Math.round(goal);
    // Where the graded path starts (a src/curriculum level id).
    if (typeof raw.pathStart === 'string' && /^[a-z0-9-]{1,24}$/.test(raw.pathStart)) out.pathStart = raw.pathStart;
    else if (raw.pathStart === null) delete out.pathStart;
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
