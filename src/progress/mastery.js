// Mastery: how well each piece (and each bar of it) is known, worked out from the
// practice:result history in a progress document (./model.js). Pure functions, no DOM or I/O,
// except a one-slot cache of the latest document so the player can ask `barStats(songId)`
// synchronously (src/progress/store.js keeps it filled).
//
// Repertoire status, per piece:  learning → secure → polished → maintained
//   learning    any practice or listening recorded
//   secure      among the last SECURE.window both-hands passes covering a bar, at least
//               SECURE.passes reach ≥ SECURE.accuracy % at ≥ SECURE.tempoFrac × target tempo
//   polished    SECURE plus POLISHED.passes passes in play-along (timed) mode at
//               ≥ POLISHED.accuracy % and ≥ POLISHED.tempoFrac × target tempo, on at least
//               POLISHED.days different days
//   maintained  polished, reviewed on schedule at least once, and not overdue
// A piece's status is the *weakest* bar's status: every bar of the piece (measureCount from
// the results, when the player reported it; otherwise every bar ever practised) has to be
// secure for the piece to be secure. Status never drops back: a bad day doesn't "unlearn"
// a piece; instead polished pieces come back for review.
//
// Spaced repetition: a polished piece is due for review REVIEW_INTERVALS[0] day(s) after it
// was polished. A review is the best both-hands pass on a day on/after the due day; at
// ≥ REVIEW.accuracy % the interval grows (1, 3, 7, 14, 30, 60, 120 days), below it the
// schedule starts again from 1 day.
//
// Target tempo: the catalog's `tempo` (pass `targets: {songId: bpm}`); with no target, the
// tempo conditions are skipped (play-along mode is still required for polished).
import {dayKey} from './model.js';

export const SECURE = {accuracy: 90, tempoFrac: 0.75, passes: 2, window: 5};
export const POLISHED = {accuracy: 95, tempoFrac: 0.97, passes: 3, days: 2};
export const REVIEW = {accuracy: 90};
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 120];
export const BAR_WINDOW = 10;          // per-bar accuracy uses the last N passes covering the bar
export const PLATEAU = {days: 3, lookbackDays: 14, minGain: 5};
export const STATUSES = ['learning', 'secure', 'polished', 'maintained'];
const RANK = {learning: 1, secure: 2, polished: 3, maintained: 4};
const MAX_BARS = 2000;

const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayOf = e => dayKey(e.at, e.tz);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** practice:result events for one song (or all), oldest first. */
export function resultsFor(doc, songId) {
  return (doc?.events || []).filter(e => e.type === 'practice:result' && (songId == null || e.songId === songId)).sort((a, b) => a.at - b.at);
}

const tempoOk = (p, target, frac) => !target || (p.tempo || 0) >= target * frac - 0.5;

/**
 * Status of one bar range from the passes that cover it (oldest first, any hands).
 * → {status: 'learning'|'secure'|'polished', securedAt, polishedAt}
 */
export function evaluatePasses(passes, {target} = {}) {
  let status = passes.length ? 'learning' : null, securedAt = null, polishedAt = null;
  const recent = [], polishHits = [];
  for (const p of passes) {
    if (p.hands && p.hands !== 'both') continue;
    recent.push(p);
    if (recent.length > SECURE.window) recent.shift();
    if (status === 'learning' && recent.filter(q => q.accuracy >= SECURE.accuracy && tempoOk(q, target, SECURE.tempoFrac)).length >= SECURE.passes) {
      status = 'secure'; securedAt = p.at;
    }
    if (p.mode === 'timed' && p.accuracy >= POLISHED.accuracy && tempoOk(p, target, POLISHED.tempoFrac)) polishHits.push(p);
    if (status === 'secure' && polishHits.length >= POLISHED.passes && new Set(polishHits.map(dayOf)).size >= POLISHED.days) {
      status = 'polished'; polishedAt = p.at;
    }
  }
  return {status, securedAt, polishedAt};
}

const covers = (p, i) => Array.isArray(p.section) && p.section[0] <= i && i <= p.section[1];

/** Bars the piece is judged on: 0…measureCount-1 when known, else every bar ever practised. */
function barsOf(passes) {
  const mc = Math.max(0, ...passes.map(p => p.measureCount || 0));
  if (mc) return {bars: Array.from({length: Math.min(mc, MAX_BARS)}, (_, i) => i), measureCount: mc};
  const set = new Set();
  for (const p of passes) if (Array.isArray(p.section)) for (let i = p.section[0]; i <= Math.min(p.section[1], p.section[0] + MAX_BARS); i++) set.add(i);
  return {bars: [...set].sort((a, b) => a - b), measureCount: null};
}

/**
 * Spaced-repetition schedule of a polished piece from the passes after it was polished.
 * → {step, due: 'YYYY-MM-DD', reviews, lapses, lastReview}
 */
export function reviewSchedule(polishedAt, passes, {tz} = {}) {
  let step = 0, reviews = 0, lapses = 0, lastReview = null;
  let due = addDays(dayKey(polishedAt, tz), REVIEW_INTERVALS[0]);
  const best = new Map(); // day → best both-hands accuracy that day
  for (const p of passes) {
    if (p.at <= polishedAt || (p.hands && p.hands !== 'both')) continue;
    const d = dayOf(p);
    best.set(d, Math.max(best.get(d) ?? 0, p.accuracy));
  }
  for (const d of [...best.keys()].sort()) {
    if (d < due) continue;
    if (best.get(d) >= REVIEW.accuracy) {
      reviews++; lastReview = d;
      step = Math.min(step + 1, REVIEW_INTERVALS.length - 1);
      due = addDays(d, REVIEW_INTERVALS[step]);
    } else {
      lapses++; step = 0;
      due = addDays(d, REVIEW_INTERVALS[0]);
    }
  }
  return {step, due, reviews, lapses, lastReview};
}

/**
 * Everything about one piece.
 * → {songId, title, status, attempts, best, bestCleanTempo, target, lastAt, measureCount,
 *    coverage (0–1 of bars at secure or better), securedAt, polishedAt, review: {…, isDue} | null,
 *    weakest: [bar indices still learning]}
 */
export function pieceMastery(doc, songId, {target, now = Date.now()} = {}) {
  const passes = resultsFor(doc, songId);
  const total = doc?.totals?.songs?.[songId];
  const listened = (total?.ms || 0) > 0;
  const base = {songId, title: total?.title || passes.at(-1)?.title || songId, target: target || null, attempts: passes.length,
    best: passes.length ? Math.max(...passes.map(p => p.accuracy)) : (total?.best ?? null),
    bestCleanTempo: Math.max(0, ...passes.filter(p => p.accuracy >= SECURE.accuracy && (p.hands || 'both') === 'both').map(p => p.tempo || 0)) || null,
    lastAt: Math.max(total?.lastAt || 0, passes.at(-1)?.at || 0) || null};
  if (!passes.length) return {...base, status: listened || total?.attempts ? 'learning' : null, measureCount: null, coverage: 0, securedAt: null, polishedAt: null, review: null, weakest: []};

  const {bars, measureCount} = barsOf(passes);
  let worst = 'polished', securedAt = 0, polishedAt = 0, good = 0;
  const weakest = [];
  for (const i of bars) {
    const r = evaluatePasses(passes.filter(p => covers(p, i)), {target});
    const st = r.status || 'learning';
    if (RANK[st] < RANK[worst]) worst = st;
    if (st === 'learning') weakest.push(i); else good++;
    securedAt = Math.max(securedAt, r.securedAt || 0);
    polishedAt = Math.max(polishedAt, r.polishedAt || 0);
  }
  if (!bars.length) worst = 'learning';
  let status = worst, review = null;
  if (status === 'polished') {
    const sched = reviewSchedule(polishedAt, passes, {tz: passes.at(-1)?.tz});
    const today = dayKey(now, passes.at(-1)?.tz);
    review = {...sched, isDue: sched.due <= today, overdueDays: Math.max(0, daysBetween(sched.due, today))};
    if (sched.reviews >= 1 && !review.isDue) status = 'maintained';
  }
  return {...base, status, measureCount, coverage: bars.length ? good / bars.length : 0,
    securedAt: status === 'learning' ? null : securedAt || null,
    polishedAt: RANK[status] >= RANK.polished ? polishedAt : null, review, weakest: weakest.slice(0, 50)};
}

/** Every song (not ex: exercises) with any practice → pieceMastery rows, most recent first. */
export function repertoire(doc, {targets = {}, now = Date.now()} = {}) {
  const ids = new Set([...Object.keys(doc?.totals?.songs || {}), ...resultsFor(doc).map(e => e.songId)]);
  return [...ids].filter(id => !id.startsWith('ex:'))
    .map(id => pieceMastery(doc, id, {target: targets[id], now}))
    .filter(m => m.status)
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

/** Polished pieces due for review today (most overdue first). */
export function dueReviews(doc, {targets = {}, now = Date.now()} = {}) {
  return repertoire(doc, {targets, now}).filter(m => m.review?.isDue).sort((a, b) => b.review.overdueDays - a.review.overdueDays || a.review.due.localeCompare(b.review.due));
}

/** Status per exact bar range practised (both hands) → [{section, status, attempts, best, lastAt, days}]. */
export function sectionMastery(doc, songId, {target} = {}) {
  const groups = new Map();
  for (const p of resultsFor(doc, songId)) {
    if (!Array.isArray(p.section)) continue;
    const k = p.section.join('-');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()].map(ps => ({
    section: ps[0].section, status: evaluatePasses(ps, {target}).status, attempts: ps.length,
    best: Math.max(...ps.map(p => p.accuracy)), lastAt: ps.at(-1).at, days: new Set(ps.map(dayOf)).size,
  })).sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Per-bar accuracy for the player's "trouble spots" strip.
 * `measures`: the song's measures ([{label, index?, pickup?}], from src/song.js) — gives exact
 * labels; without them bars are guessed from the sections practised (label = index + 1, or
 * label = index when a miss was ever labelled "Pickup").
 * A pass "covers" a bar when the bar is inside its section; the bar was clean in that pass
 * when no miss carries its label. accuracy = clean / covering passes (last BAR_WINDOW), or
 * null when no covering pass recorded misses.
 * → [{label, index, accuracy, attempts}] in bar order (bars never practised are left out).
 */
export function barStatsFrom(doc, songId, {measures, window = BAR_WINDOW} = {}) {
  const passes = resultsFor(doc, songId).filter(p => Array.isArray(p.section)).reverse(); // newest first
  if (!passes.length) return [];
  let bars;
  if (Array.isArray(measures) && measures.length) bars = measures.map((m, i) => ({index: Number.isInteger(m.index) ? m.index : i, label: String(m.label ?? i + 1)}));
  else {
    // A miss labelled "Pickup" means measure 0 is a pickup, so index i is bar i.
    const pickup = passes.some(p => (p.misses || []).some(m => /^pickup$/i.test(String(m.measure))));
    bars = barsOf(passes).bars.map(i => ({index: i, label: pickup ? (i === 0 ? 'Pickup' : String(i)) : String(i + 1)}));
  }
  const out = [];
  for (const {index, label} of bars) {
    const covering = passes.filter(p => covers(p, index)).slice(0, window);
    if (!covering.length) continue;
    const known = covering.filter(p => Array.isArray(p.misses) || p.accuracy >= 100);
    const clean = known.filter(p => !(p.misses || []).some(m => sameBar(m.measure, label, index, !measures)));
    out.push({label, index, accuracy: known.length ? Math.round((100 * clean.length) / known.length) : null, attempts: covering.length});
  }
  return out;
}

function sameBar(missLabel, label, index, guessed) {
  const m = String(missLabel ?? '');
  if (m === label) return true;
  return guessed && /^pickup$/i.test(m) && index === 0;
}

/** The weakest bars (lowest accuracy first) → up to n rows of barStatsFrom. */
export function troubleSpots(doc, songId, {measures, n = 5, below = 90} = {}) {
  return barStatsFrom(doc, songId, {measures}).filter(b => b.accuracy != null && b.accuracy < below)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts).slice(0, n);
}

// ───── a cached document for synchronous callers (the player) ─────
let cachedDoc = null;
/** Called by src/progress/store.js whenever it has a fresher document. */
export function setMasteryDoc(doc) { cachedDoc = doc || null; }
/**
 * barStats(songId, {measures}) → [{label, index, accuracy, attempts}] from the latest progress
 * this tab knows (window event 'progress:change' fires when it changes).
 */
export function barStats(songId, {measures, doc = cachedDoc, window} = {}) {
  return doc ? barStatsFrom(doc, songId, {measures, window}) : [];
}

/**
 * Sections stuck below target: practised on ≥ PLATEAU.days different days within the last
 * PLATEAU.lookbackDays, still 'learning', and the best accuracy of the latest day is less
 * than PLATEAU.minGain points above the first day's.
 * → [{songId, title, section, days, firstBest, lastBest, bestTempo, since}]
 */
export function plateaus(doc, {now = Date.now(), targets = {}} = {}) {
  const since = now - PLATEAU.lookbackDays * 864e5;
  const groups = new Map();
  for (const p of resultsFor(doc)) {
    if (p.at < since || !Array.isArray(p.section) || p.songId.startsWith('ex:') || (p.hands && p.hands !== 'both')) continue;
    const k = p.songId + '|' + p.section.join('-');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = [];
  for (const ps of groups.values()) {
    const byDay = new Map();
    for (const p of ps) byDay.set(dayOf(p), Math.max(byDay.get(dayOf(p)) ?? 0, p.accuracy));
    if (byDay.size < PLATEAU.days) continue;
    const st = evaluatePasses(resultsFor(doc, ps[0].songId).filter(p => p.section?.join('-') === ps[0].section.join('-')), {target: targets[ps[0].songId]}).status;
    if (st !== 'learning') continue;
    const days = [...byDay.keys()].sort();
    const firstBest = byDay.get(days[0]), lastBest = byDay.get(days.at(-1));
    if (lastBest - firstBest >= PLATEAU.minGain) continue;
    out.push({songId: ps[0].songId, title: ps.at(-1).title || ps[0].songId, section: ps[0].section, days: days.length,
      firstBest, lastBest, bestTempo: Math.max(0, ...ps.map(p => p.tempo || 0)) || null, since: days[0]});
  }
  return out.sort((a, b) => b.days - a.days);
}

/**
 * Progress toward a dated goal ({songId, bpm, accuracy, by}).
 * → {bestTempo, fraction (0–1), met, daysLeft, overdue}
 */
export function goalProgress(goal, doc, {now = Date.now()} = {}) {
  const need = goal.accuracy ?? SECURE.accuracy;
  const passes = resultsFor(doc, goal.songId).filter(p => p.accuracy >= need && (p.hands || 'both') === 'both');
  const bestTempo = Math.max(0, ...passes.map(p => p.tempo || 0)) || null;
  const met = !!bestTempo && bestTempo >= goal.bpm;
  const daysLeft = daysBetween(dayKey(now), goal.by);
  return {bestTempo, fraction: bestTempo ? Math.min(1, bestTempo / goal.bpm) : 0, met, daysLeft, overdue: !met && daysLeft < 0};
}

export const statusRank = s => RANK[s] || 0;
export const STATUS_LABEL = {learning: 'Learning', secure: 'Secure', polished: 'Polished', maintained: 'Maintained'};
