// Pure aggregate helpers over a progress document (see ./model.js). No DOM, no I/O.
// Every helper takes `now` (ms) so results are testable; days are local calendar days.
import {dayKey} from './model.js';

export {dayKey};
export const STREAK_MIN_MINUTES = 5;

/** 'YYYY-MM-DD' shifted by n days (pure calendar arithmetic, no DST issues). */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const days = doc => doc?.totals?.days || {};

/** → {'YYYY-MM-DD': minutes} — listening, practising and note-reading drills combined. */
export function minutesByDay(doc) {
  const out = {};
  for (const [day, d] of Object.entries(days(doc))) out[day] = (d.ms || 0) / 60000;
  return out;
}

export function minutesOn(doc, day) {
  return (days(doc)[day]?.ms || 0) / 60000;
}

export const todayMinutes = (doc, now = Date.now()) => minutesOn(doc, dayKey(now));

/** Last n days, oldest first → [{day, minutes, practiceMin, listenMin, trainerMin}]. */
export function lastDays(doc, n, now = Date.now()) {
  const today = dayKey(now), all = days(doc), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i), d = all[day] || {};
    out.push({day, minutes: (d.ms || 0) / 60000, practiceMin: (d.practiceMs || 0) / 60000, listenMin: (d.listenMs || 0) / 60000, trainerMin: (d.trainerMs || 0) / 60000});
  }
  return out;
}

/**
 * Streaks of days with ≥ minMinutes. The current streak counts back from today, or
 * from yesterday while today's goal isn't met yet (so the streak isn't "lost" at breakfast).
 * → {current, longest, todayDone}
 */
export function streaks(doc, {now = Date.now(), minMinutes = STREAK_MIN_MINUTES} = {}) {
  const good = new Set(Object.entries(minutesByDay(doc)).filter(([, m]) => m >= minMinutes).map(([d]) => d));
  const today = dayKey(now);
  const todayDone = good.has(today);
  let current = 0;
  for (let day = todayDone ? today : addDays(today, -1); good.has(day); day = addDays(day, -1)) current++;
  let longest = 0, run = 0, prev = null;
  for (const day of [...good].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return {current, longest, todayDone};
}

/** ex:<kind>:<key>:<quality>:… → {kind, key, quality, pc, label} | null. */
const PC = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
export function parseExerciseId(id) {
  const m = /^ex:([a-z-]+):([A-G])(s|b)?:(major|minor)\b/.exec(String(id || ''));
  if (!m) return null;
  const [, kind, letter, acc, quality] = m;
  const pc = (PC[letter] + (acc === 's' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  return {kind, key: letter + (acc || ''), quality, pc, label: letter + (acc === 's' ? '♯' : acc === 'b' ? '♭' : '') + (quality === 'minor' ? 'm' : '')};
}

const songRows = doc => Object.entries(doc?.totals?.songs || {}).map(([id, s]) => ({
  id, title: s.title || id, attempts: s.attempts || 0, best: s.best ?? null, latest: s.latest ?? null,
  lastAt: s.lastAt || 0, minutes: (s.ms || 0) / 60000, bestTempo: s.bestTempo || 0,
}));

/** Songs (not exercises or generated sight-reading pieces), most recently practised first. */
export function songStats(doc) {
  return songRows(doc).filter(s => !s.id.startsWith('ex:') && !s.id.startsWith('sr:')).sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Sight-reading, rhythm, theory and ear training at a glance →
 * {sightReading: {pieces, best, lastAt} | null, rhythm|theory|ear: {drills, accuracy, lastAccuracy, levels, lastAt} | null}
 * (theory.levels = lessons with a pass, i.e. ≥ 80 %).
 */
export function skillSummary(doc) {
  const sr = songRows(doc).filter(s => s.id.startsWith('sr:') && s.attempts);
  const out = {sightReading: sr.length ? {pieces: sr.length, best: Math.max(...sr.map(s => s.best ?? 0)), lastAt: Math.max(...sr.map(s => s.lastAt))} : null};
  for (const k of ['rhythm', 'theory', 'ear']) {
    const t = doc?.totals?.skills?.[k];
    out[k] = t?.drills ? {drills: t.drills, accuracy: t.right + t.wrong ? (100 * t.right) / (t.right + t.wrong) : null, lastAccuracy: t.lastAccuracy ?? null,
      levels: Object.values(t.levels || {}).filter(v => k !== 'theory' || v >= 80).length, lastAt: t.lastAt || 0} : null;
  }
  return out;
}

/** Exercises (ids starting `ex:`), most recently practised first, with parsed key info. */
export function exerciseStats(doc) {
  return songRows(doc).filter(s => s.id.startsWith('ex:')).map(s => ({...s, exercise: parseExerciseId(s.id)})).sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Per key (pitch class + quality, so Fs/Gb count together):
 * → {'major:6': {attempts, best, lastAt, minutes, recent}} where `recent` = practised in the last `recentDays`.
 */
export function keyStats(doc, {now = Date.now(), recentDays = 14} = {}) {
  const out = {}, since = now - recentDays * 864e5;
  for (const s of exerciseStats(doc)) {
    if (!s.exercise) continue;
    const k = `${s.exercise.quality}:${s.exercise.pc}`;
    const o = (out[k] ||= {attempts: 0, best: null, lastAt: 0, minutes: 0, recent: false, kinds: []});
    o.attempts += s.attempts;
    if (s.best != null) o.best = Math.max(o.best ?? 0, s.best);
    o.lastAt = Math.max(o.lastAt, s.lastAt);
    o.minutes += s.minutes;
    if (!o.kinds.includes(s.exercise.kind)) o.kinds.push(s.exercise.kind);
    o.recent = o.lastAt >= since;
  }
  return out;
}

/** Note-reading drills per day for the last n days with any drill, oldest first → [{day, drills, accuracy, avgMs, notes}]. */
export function readingTrend(doc, {n = 14} = {}) {
  return Object.entries(doc?.totals?.trainer || {})
    .sort(([a], [b]) => (a < b ? -1 : 1)).slice(-n)
    .map(([day, t]) => {
      const notes = (t.right || 0) + (t.wrong || 0);
      return {day, drills: t.drills || 0, notes, accuracy: notes ? (100 * (t.right || 0)) / notes : null, avgMs: t.notes ? t.msTotal / t.notes : null, bestLevel: t.bestLevel ?? null};
    });
}

/** Overall note-reading summary → {drills, accuracy, avgMs} (null fields with no data). */
export function readingSummary(doc) {
  let drills = 0, right = 0, wrong = 0, msTotal = 0, notes = 0;
  for (const t of Object.values(doc?.totals?.trainer || {})) {
    drills += t.drills || 0; right += t.right || 0; wrong += t.wrong || 0; msTotal += t.msTotal || 0; notes += t.notes || 0;
  }
  return {drills, accuracy: right + wrong ? (100 * right) / (right + wrong) : null, avgMs: notes ? msTotal / notes : null};
}

export function totalMinutes(doc) {
  return Object.values(days(doc)).reduce((a, d) => a + (d.ms || 0), 0) / 60000;
}
