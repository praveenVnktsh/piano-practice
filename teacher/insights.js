// Per-piece detail for the teacher's progress report (Phase 14): the per-bar heat strip the
// student sees on the score, the tempo ladder (highest clean play-along tempo per section and
// the suggested next step) and, when present, the "Learn this piece" plan (Phase 12, recorded
// by the progress store in totals.learn — read defensively, it may not exist).
// Pure: takes a progress document, returns plain data and text.
import {barStatsFrom, resultsFor} from '../src/progress/mastery.js';
import {heatLevel, nextTempoStep} from '../src/practice-core.mjs';

export const CLEAN = 95; // the player's "clean" pass (src/player.js), for best tempos
const HEAT_CHAR = {good: 'G', fair: 'f', weak: 'W'};
const NO_TEMPO = ['dotted', 'reversed', 'blocked']; // strategies that change the rhythm: no best tempo
export const barsName = s => (s[0] === s[1] ? `bar ${s[0] + 1}` : `bars ${s[0] + 1}–${s[1] + 1}`);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The heat strip as text, one character per bar (G ≥ 95 % clean, f ≥ 80 %, W below, · not practised
 * or unknown), in groups of four after the first bar's number: "1 GGfW  5 ··GG".
 * → {text, counts: {good, fair, weak}, practised} or null when no bar has been practised.
 */
export function heatStrip(doc, songId, {measureCount} = {}) {
  const stats = barStatsFrom(doc, songId);
  if (!stats.length) return null;
  const n = Math.max(measureCount || 0, ...stats.map(b => b.index + 1));
  const by = new Map(stats.map(b => [b.index, b]));
  const counts = {good: 0, fair: 0, weak: 0};
  const chars = Array.from({length: n}, (_, i) => {
    const b = by.get(i);
    if (!b || b.accuracy == null) return '·';
    const level = heatLevel(b.accuracy);
    counts[level]++;
    return HEAT_CHAR[level];
  });
  const groups = [];
  for (let i = 0; i < n; i += 4) groups.push(`${i + 1} ${chars.slice(i, i + 4).join('')}`);
  const lines = [];
  for (let i = 0; i < groups.length; i += 8) lines.push(groups.slice(i, i + 8).join('  '));
  return {text: lines.join('\n'), counts, practised: stats.length};
}

/**
 * Tempo ladder per section (both hands and each hand alone): the highest play-along tempo with a
 * clean pass (≥ CLEAN %), and the next step (about 5 % faster, never past the target) — the same
 * rule as the player's "Best clean ♩ = … · Try …". Sections played only in wait mode or never clean
 * show their best accuracy instead. Most recent first.
 * → [{section, hands, best, next, target, atTarget, bestAccuracy, bestAccuracyTempo, passes, lastAt}]
 */
export function tempoLadder(doc, songId, {target} = {}) {
  const groups = new Map();
  for (const p of resultsFor(doc, songId)) {
    if (!Array.isArray(p.section)) continue;
    const hands = p.hands || 'both';
    const key = `${p.section[0]}-${p.section[1]}:${hands}`;
    if (!groups.has(key)) groups.set(key, {section: p.section, hands, passes: []});
    groups.get(key).passes.push(p);
  }
  return [...groups.values()]
    .map(({section, hands, passes}) => {
      const clean = passes.filter(p => p.mode === 'timed' && !NO_TEMPO.includes(p.strategy) && p.accuracy >= CLEAN && p.tempo > 0);
      const best = clean.length ? Math.round(Math.max(...clean.map(p => p.tempo))) : null;
      const top = passes.reduce((a, p) => (p.accuracy > a.accuracy || (p.accuracy === a.accuracy && (p.tempo || 0) > (a.tempo || 0)) ? p : a));
      return {
        section, hands, best, target: target || null,
        next: best ? nextTempoStep(best, target || 0) : null,
        atTarget: !!(best && target && best >= target),
        bestAccuracy: top.accuracy, bestAccuracyTempo: top.tempo ?? null,
        passes: passes.length, lastAt: passes.at(-1).at,
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** One tempo-ladder row as text. */
export function ladderLine(r) {
  const who = r.hands === 'both' ? '' : ` (${r.hands} hand)`;
  if (r.best == null)
    return `${barsName(r.section)}${who}: no clean play-along pass yet, best ${Math.round(r.bestAccuracy)}%${r.bestAccuracyTempo ? ` at ♩ ${r.bestAccuracyTempo}` : ''} (${r.passes} passes)`;
  if (r.atTarget || !r.target) return `${barsName(r.section)}${who}: clean at ♩ ${r.best}${r.target ? ` (at target ${r.target})` : ''}`;
  return `${barsName(r.section)}${who}: clean at ♩ ${r.best} → next ♩ ${r.next} (target ${r.target})`;
}

/**
 * The "Learn this piece" plan for a song, read defensively from the progress document
 * (totals.learn[songId] = {title, active, done: [stepKey], total, next: {key, label} | null, startedAt, lastAt}).
 * → {active, done, total, next: label | null, lastAt} or null when there is no plan.
 */
export function learnPlan(doc, songId) {
  const p = doc?.totals?.learn?.[songId];
  if (!isObj(p)) return null;
  const done = Array.isArray(p.done) ? p.done.length : Number.isInteger(p.done) ? p.done : 0;
  const total = Number.isInteger(p.total) && p.total > 0 ? p.total : null;
  const next = isObj(p.next) ? (typeof p.next.label === 'string' ? p.next.label : null) : typeof p.next === 'string' ? p.next : null;
  return {active: p.active !== false, done, total, next, lastAt: Number.isFinite(p.lastAt) ? p.lastAt : null};
}

/** Every plan in the document → [{songId, title, ...learnPlan}] (most recent first). */
export function learnPlans(doc) {
  const all = doc?.totals?.learn;
  if (!isObj(all)) return [];
  return Object.keys(all)
    .map(songId => ({songId, title: (isObj(all[songId]) && all[songId].title) || songId, ...learnPlan(doc, songId)}))
    .filter(p => p.total || p.done || p.next)
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

/** A plan as text: "4 of 12 steps done · next: Bars 5–8, left hand alone" (or "… — finished"). */
export function planLine(p) {
  const of = p.total ? `${p.done} of ${p.total} steps done` : `${p.done} steps done`;
  if (p.total && p.done >= p.total) return `${of}, finished`;
  return `${of}${p.active ? '' : ' (stopped)'}${p.next ? ` · next: ${p.next}` : ''}`;
}
