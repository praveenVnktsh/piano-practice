// Pure practice logic for the player's "smarter practising" and touch feedback
// (docs/ROADMAP.md phases 5, 6 and 10). No DOM, no timers: every function takes
// plain data and returns plain data, so all of it is unit-tested
// (tests/practice-core.test.js). Times are in quarter notes unless a name ends
// in Ms; measure indices are 0-based.

import {beatInfo} from './score-core.mjs';

const EPS = 1e-6;
const round = (v, k = 0) => Math.round(v * 10 ** k) / 10 ** k;
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = xs => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// "bar 5" / "bars 5–6" from measure labels.
export function barsText(measures, first, last = first) {
  const a = measures[first]?.label ?? String(first + 1), b = measures[last]?.label ?? String(last + 1);
  if (first === last || a === b) return measures[first]?.pickup ? 'the pickup' : `bar ${a}`;
  return `bars ${measures[first]?.pickup ? 'pickup' : a}–${b}`;
}

// ───────── Trouble spots ─────────
// Per-bar right/wrong counts gathered during this session (the fallback when
// the progress store has no bar statistics yet).
export class BarTally {
  constructor() { this.bars = new Map(); }
  add(index, ok) {
    if (!Number.isInteger(index) || index < 0) return;
    const b = this.bars.get(index) ?? {right: 0, wrong: 0};
    b[ok ? 'right' : 'wrong']++;
    this.bars.set(index, b);
  }
  list() {
    return [...this.bars].sort((a, b) => a[0] - b[0])
      .map(([index, {right, wrong}]) => ({index, accuracy: Math.round(100 * right / Math.max(1, right + wrong)), attempts: right + wrong}));
  }
}

// Normalise bar statistics from any source to Map(index → {accuracy 0–100, attempts}).
// `measures` resolves entries that only carry a label. Accuracies given as
// fractions (every value ≤ 1) are scaled to percent.
export function normaliseBarStats(list, measures = []) {
  const out = new Map();
  if (!Array.isArray(list)) return out;
  const fractions = list.length > 0 && list.every(s => !(+s?.accuracy > 1));
  for (const s of list) {
    if (!s || s.accuracy == null || !Number.isFinite(+s.accuracy)) continue;
    let index = Number.isInteger(s.index) ? s.index : -1;
    if (s.label != null && measures.length && String(measures[index]?.label) !== String(s.label)) {
      const byLabel = measures.findIndex(m => String(m.label) === String(s.label));
      if (byLabel >= 0 && (index < 0 || index >= measures.length)) index = byLabel;
    }
    if (index < 0 || (measures.length && index >= measures.length)) continue;
    const accuracy = clamp(fractions ? +s.accuracy * 100 : +s.accuracy, 0, 100);
    out.set(index, {accuracy: Math.round(accuracy), attempts: Math.max(1, Math.round(+s.attempts || 1))});
  }
  return out;
}

// Long-term statistics win where they exist; this session fills the gaps.
export function mergeBarStats(primary, session) {
  const out = new Map(session);
  for (const [i, s] of primary) out.set(i, s);
  return out;
}

// 'good' | 'fair' | 'weak' for the heat strip.
export const heatLevel = accuracy => (accuracy >= 95 ? 'good' : accuracy >= 80 ? 'fair' : 'weak');

// The bars to loop for "Practise my weak bars": the worst bar below the
// threshold, with a neighbour on each side, widened to take in other weak
// bars close by (up to maxLen bars). Returns {first, last, worst} or null.
export function weakPassage(stats, measureCount, {threshold = 90, neighbours = 1, maxLen = 4} = {}) {
  const weak = [...stats].filter(([i, s]) => i < measureCount && s.accuracy < threshold)
    .sort((a, b) => a[1].accuracy - b[1].accuracy || b[1].attempts - a[1].attempts || a[0] - b[0]);
  if (!weak.length) return null;
  const worst = weak[0][0];
  let first = worst, last = worst;
  // Pull in weak bars right next to the worst one while the window stays short.
  for (const [i] of weak.slice(1)) {
    if (i < first && first - i <= 2 && last - i + 1 <= maxLen) first = i;
    else if (i > last && i - last <= 2 && i - first + 1 <= maxLen) last = i;
  }
  for (let k = 0; k < neighbours; k++) {
    if (last - first + 1 < maxLen && first > 0) first--;
    if (last - first + 1 < maxLen && last < measureCount - 1) last++;
  }
  return {first, last, worst};
}

// ───────── Chaining ─────────
// Loop a growing passage: forward chaining starts from the first bar and adds
// the next bar after each clean pass; backward chaining starts from the last bar
// and adds the one before it. {dir, goal: [first, last], first, last}.
export function startChain(first, last, dir = 'forward') {
  dir = dir === 'backward' ? 'backward' : 'forward';
  return dir === 'forward' ? {dir, goal: [first, last], first, last: first} : {dir, goal: [first, last], first: last, last};
}
// After a pass: {chain, grew, done}. A pass below `threshold` repeats the same bars.
export function chainStep(chain, accuracy, {threshold = 95} = {}) {
  const [g0, g1] = chain.goal;
  const full = chain.first <= g0 && chain.last >= g1;
  if (!(accuracy >= threshold)) return {chain, grew: false, done: false};
  if (full) return {chain, grew: false, done: true};
  const next = chain.dir === 'forward' ? {...chain, last: Math.min(g1, chain.last + 1)} : {...chain, first: Math.max(g0, chain.first - 1)};
  return {chain: next, grew: true, done: false};
}

// ───────── Phrases ─────────
// Split a piece into phrases ({first, last} measure indices) for chunked
// practice. Phrase ends come from the melody (top voice of the right hand):
// a rest after a note, a long note (at least a beat and well above the
// typical note length), the end of a long slur, or a cadence-like moment where
// both hands hold. Phrases are kept between `min` and `max` bars; stretches
// without a clear end are cut in four-bar units.
export function detectPhrases({measures = [], events = [], slurs = []} = {}, {min = 2, max = 8} = {}) {
  const n = measures.length;
  if (!n) return [];
  const measureAt = t => { const i = measures.findIndex(m => m.start <= t + EPS && t + EPS < m.end); return i < 0 ? n - 1 : i; };
  const right = events.filter(e => e.hand !== 'l');
  const line = right.length ? right : events;
  const byTime = new Map();
  for (const e of line) if (!byTime.has(e.t) || byTime.get(e.t).n < e.n) byTime.set(e.t, e);
  const top = [...byTime.values()].sort((a, b) => a.t - b.t);
  const iois = top.slice(1).map((e, i) => e.t - top[i].t).filter(x => x > EPS);
  const typical = median(iois) || 1;
  const strength = new Map(); // measure index → how clearly a phrase ends there
  const mark = (i, s) => { if (i >= 0 && i < n) strength.set(i, Math.max(strength.get(i) ?? 0, s)); };
  const left = events.filter(e => e.hand === 'l');
  top.forEach((e, k) => {
    const next = top[k + 1];
    if (!next) return;
    const gap = next.t - (e.t + e.d);
    const beat = beatInfo(measures[measureAt(e.t)].meter).len;
    const long = e.d >= Math.max(beat, 1.75 * typical) - EPS;
    // A bass note held with the melody's long note reads as a cadence.
    const bassHolds = left.some(b => Math.abs(b.t - e.t) < EPS && b.d >= e.d - EPS);
    let s = 0;
    if (gap >= Math.min(.5, typical) - EPS) s = gap >= beat - EPS ? 3 : 2;
    if (long) s = Math.max(s, bassHolds ? 3 : 2);
    if (!s) return;
    // A boundary right at a barline closes the bar before it.
    const end = e.t + e.d, mi = measureAt(e.t), me = measureAt(Math.max(e.t, end - EPS));
    mark(me > mi && Math.abs(measures[me].start - end) < EPS ? mi : me, s);
  });
  for (const sl of slurs) if (sl.end - sl.start >= 2 - EPS) mark(measureAt(Math.max(sl.start, sl.end - EPS)), 1.5);

  const out = [];
  const lead = measures[0]?.pickup ? 1 : 0; // a pickup joins the first phrase
  let start = 0;
  const bars = i => i - start + 1 - (start === 0 ? lead : 0);
  for (let i = 0; i < n; i++) {
    const len = bars(i);
    if (i === n - 1) { out.push({first: start, last: i}); break; }
    // A clear close (a rest of a beat, a held cadence) may end a short phrase; weaker
    // signs (a long note, a slur's end) only end one of four bars or more.
    const st = strength.get(i) ?? 0;
    if ((st >= 3 && len >= min) || (st >= 1.5 && len >= Math.max(min, 4))) { out.push({first: start, last: i}); start = i + 1; continue; }
    // Four bars in and no clear end before the longest phrase allowed: cut here.
    const ahead = [...strength].some(([k, s]) => s >= 1.5 && k > i && k < i + 1 + max - len);
    if (len >= 4 && !ahead) { out.push({first: start, last: i}); start = i + 1; }
  }
  // A tail shorter than `min` joins the phrase before it.
  if (out.length > 1 && out.at(-1).last - out.at(-1).first + 1 < min) { const tail = out.pop(); out.at(-1).last = tail.last; }
  return out;
}
// The phrase holding measure index i (or the nearest one).
export const phraseAt = (phrases, i) => phrases.find(p => p.first <= i && i <= p.last) ?? phrases.at(-1) ?? null;
// The phrase after the current range (the first one starting after `last`), or null at the end.
export const nextPhrase = (phrases, last) => phrases.find(p => p.first > last) ?? null;

// ───────── Rhythm variations and blocked chords ─────────
// Both return Map(event id → {t, d} | {drop: true}) to apply with applyTiming.

// Dotted ("long–short") or reversed dotted ("short–long") rhythms over runs of
// equal notes: in each run of at least `minRun` evenly spaced onsets (a quarter
// note apart or less) in one hand, every second onset moves so the pair
// becomes 3:1 (dotted) or 1:3 (reversed).
export function rhythmVariation(events, kind = 'dotted', {minRun = 4} = {}) {
  const out = new Map();
  if (kind !== 'dotted' && kind !== 'reversed') return out;
  const ratio = kind === 'dotted' ? 1.5 : .5;
  for (const hand of ['r', 'l']) {
    const evs = events.filter(e => (e.hand === 'l' ? 'l' : 'r') === hand && !e.carried);
    const times = [...new Set(evs.map(e => e.t))].sort((a, b) => a - b);
    const at = t => evs.filter(e => Math.abs(e.t - t) < EPS);
    let i = 0;
    while (i < times.length - 1) {
      const d = times[i + 1] - times[i];
      let j = i + 1;
      const fits = k => at(times[k]).every(e => e.d <= d + EPS);
      if (d > 1 + EPS || !fits(i)) { i++; continue; }
      while (j + 1 < times.length && Math.abs(times[j + 1] - times[j] - d) < EPS && fits(j)) j++;
      if (!fits(j)) j--;
      const len = j - i + 1;
      if (len >= minRun) {
        for (let k = i; k + 1 <= j; k += 2) {
          const t0 = times[k], t1 = t0 + d * ratio;
          for (const e of at(t0)) out.set(e.id, {t: t0, d: d * ratio});
          for (const e of at(times[k + 1])) out.set(e.id, {t: t1, d: 2 * d - d * ratio});
        }
        i = j + 1;
      } else i = Math.max(i + 1, j);
    }
  }
  return out;
}

// Broken-chord figures (Alberti basses, arpeggiated accompaniments) collapsed
// into one simultaneous chord per beat, or per two beats when a beat holds too
// few notes. A figure is at least three single-note onsets of one hand whose
// steps are all leaps (a minor third or more), so scales are left alone.
export function blockChords(events, measures) {
  const out = new Map();
  const qualifies = list => {
    const times = [...new Set(list.map(e => e.t))].sort((a, b) => a - b);
    if (times.length < 3) return false;
    const line = times.map(t => list.filter(e => Math.abs(e.t - t) < EPS));
    if (line.some(g => g.length !== 1)) return false;
    const pitches = line.map(g => g[0].n);
    if (new Set(pitches).size < 2) return false;
    return pitches.slice(1).every((p, k) => Math.abs(p - pitches[k]) >= 3);
  };
  const collapse = list => {
    const t = Math.min(...list.map(e => e.t)), end = Math.max(...list.map(e => e.t + e.d));
    const seen = new Set();
    for (const e of [...list].sort((a, b) => a.t - b.t)) {
      if (seen.has(e.n)) { out.set(e.id, {drop: true}); continue; }
      seen.add(e.n);
      out.set(e.id, {t, d: end - t});
    }
  };
  for (const hand of ['r', 'l']) {
    const evs = events.filter(e => (e.hand === 'l' ? 'l' : 'r') === hand && !e.carried);
    for (const m of measures) {
      const {len} = beatInfo(m.meter);
      const inBar = evs.filter(e => e.t >= m.start - EPS && e.t < m.end - EPS);
      if (inBar.length < 3) continue;
      const done = new Set();
      for (const size of [len, 2 * len]) {
        for (let w = m.start; w < m.end - EPS; w += size) {
          const win = inBar.filter(e => !done.has(e.id) && e.t >= w - EPS && e.t < w + size - EPS);
          if (win.length >= 3 && qualifies(win)) { collapse(win); win.forEach(e => done.add(e.id)); }
        }
      }
    }
  }
  return out;
}

// A passage with changed timings (from rhythmVariation / blockChords), regrouped
// like passage() does. The original passage is not modified.
export function applyTiming(p, changes) {
  if (!changes?.size) return p;
  const events = [];
  for (const e of p.events) {
    const c = changes.get(e.id);
    if (c?.drop) continue;
    events.push(c ? {...e, t: clamp(c.t, p.start, p.end), d: Math.max(.05, Math.min(c.d, p.end - c.t)), varied: true} : e);
  }
  events.sort((a, b) => a.t - b.t);
  const groups = [...new Set(events.map(e => e.t))].sort((a, b) => a - b).map(t => {
    const at = events.filter(e => e.t === t);
    return {t, events: at, notes: [...new Set(at.map(e => e.n))]};
  });
  return {...p, events, groups};
}

// ───────── Tempo: slow-practice ladder and best clean tempo ─────────
// Rungs from `from` × target up to the target, evenly spaced.
export function ladderRungs(target, {from = .6, steps = 5, min = 20} = {}) {
  target = Math.round(target);
  const lo = Math.max(min, Math.round(target * from));
  if (lo >= target) return [target];
  const out = [];
  for (let k = 0; k < steps; k++) out.push(Math.round(lo + (target - lo) * k / (steps - 1)));
  return [...new Set(out)];
}
// After a pass: the next rung above `tempo` when the pass was clean, else `tempo`.
export function ladderNext(tempo, target, accuracy, {threshold = 95, ...opts} = {}) {
  if (!(accuracy >= threshold)) return tempo;
  return ladderRungs(target, opts).find(r => r > tempo + .5) ?? tempo;
}

// Highest clean tempo per section key ("first-last"). Returns {bests, improved}.
export function recordBest(bests = {}, key, tempo, accuracy, {threshold = 95} = {}) {
  if (!(accuracy >= threshold) || !(tempo > 0)) return {bests, improved: false};
  if ((bests[key] ?? 0) >= tempo) return {bests, improved: false};
  return {bests: {...bests, [key]: Math.round(tempo)}, improved: true};
}
// The suggested next tempo after a best clean tempo: about 5% faster, at least
// 2 BPM, never past the target. Null without a best; the target when reached.
export function nextTempoStep(best, target) {
  if (!(best > 0)) return null;
  if (!(target > best)) return Math.round(target > 0 ? target : best);
  return Math.min(Math.round(target), Math.max(Math.round(best) + 2, Math.round(best * 1.05)));
}

// ───────── Touch: evenness, dynamics, articulation, pedal ─────────
// A played note, as the player records it:
// {n, id, t (score time of the note it matched), d (written length), hand ('r'|'l'),
//  measure (index), at (ms, latency corrected), off (ms | null), velocity (1–127), qms (ms per quarter)}

// Least-squares line through (x, y) points → {a, b} with y ≈ a + b·x.
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if (sxx < EPS) return null;
  const b = sxy / sxx;
  return {a: my - b * mx, b};
}

// Timing and velocity evenness of a run (scales, arpeggios). Timing deviation is
// measured against the player's own steady pulse (a line fitted through onset
// time against score time), so a constant delay or a slightly different tempo
// costs nothing; velocity deviation is taken per hand. Score 0–100.
export function evenness(notes, {minNotes = 6} = {}) {
  const list = notes.filter(p => Number.isFinite(p.at) && Number.isFinite(p.t)).sort((a, b) => a.t - b.t || a.at - b.at);
  if (list.length < minNotes) return null;
  const line = fitLine(list.map(p => ({x: p.t, y: p.at})));
  if (!line || line.b <= 0) return null;
  const dev = list.map(p => p.at - (line.a + line.b * p.t));
  const timingSdMs = sd(dev);
  const hands = {};
  for (const h of ['r', 'l']) {
    const v = list.filter(p => (p.hand === 'l' ? 'l' : 'r') === h).map(p => p.velocity).filter(Number.isFinite);
    if (v.length >= 3) hands[h] = {velocityMean: round(mean(v), 1), velocitySd: round(sd(v), 1), notes: v.length};
  }
  const hv = Object.values(hands);
  const velocitySd = hv.length ? mean(hv.map(h => h.velocitySd)) : 0;
  const timingScore = clamp(100 - (timingSdMs - 5) * 1.6, 0, 100);
  const velocityScore = clamp(100 - (velocitySd - 2) * 5, 0, 100);
  const score = Math.round(.6 * timingScore + .4 * velocityScore);
  const vAll = list.map(p => p.velocity).filter(Number.isFinite);
  const vMean = mean(vAll);
  return {
    score, timingSdMs: round(timingSdMs, 1), velocitySd: round(velocitySd, 1), velocityMean: round(vMean, 1), notes: list.length,
    msPerQuarter: round(line.b, 1), hands,
    // One point per note, for the fine-line graph: timing (ms, + = late) and velocity offset.
    points: list.map((p, i) => ({t: p.t, n: p.n, hand: p.hand, measure: p.measure, dt: round(dev[i], 1), dv: round(p.velocity - vMean, 1)})),
  };
}

// One short sentence about an evenness result, or null when it is even.
export function evennessRemark(ev, measures = []) {
  if (!ev) return null;
  const {r, l} = ev.hands;
  if (r && l && Math.abs(r.velocityMean - l.velocityMean) >= 8)
    return `${r.velocityMean > l.velocityMean ? 'Right' : 'Left'} hand a touch heavier than the ${r.velocityMean > l.velocityMean ? 'left' : 'right'}.`;
  const worst = ev.points.reduce((b, p) => (Math.abs(p.dt) > Math.abs(b?.dt ?? 0) ? p : b), null);
  if (worst && Math.abs(worst.dt) >= 35)
    return `A little uneven in ${barsText(measures, worst.measure)}: one note ${worst.dt < 0 ? 'came early' : 'came late'}.`;
  const loud = ev.points.reduce((b, p) => (Math.abs(p.dv) > Math.abs(b?.dv ?? 0) ? p : b), null);
  if (loud && Math.abs(loud.dv) >= 18) return `One ${loud.dv > 0 ? 'bumped' : 'dropped'} note in ${barsText(measures, loud.measure)}.`;
  if (ev.score >= 85) return 'Even and controlled.';
  return null;
}

// Dynamics: MEI marks to MIDI velocity, and back.
export const DYNAMIC_LEVELS = {ppp: 24, pp: 36, p: 50, mp: 64, mf: 78, f: 92, ff: 106, fff: 118};
const LEVEL_ORDER = Object.keys(DYNAMIC_LEVELS);
export function dynamicLevel(mark) {
  const m = String(mark || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (m in DYNAMIC_LEVELS) return DYNAMIC_LEVELS[m];
  if (m === 'sf' || m === 'sfz' || m === 'fz' || m === 'rfz') return null; // accents, not levels
  if (m === 'fp') return DYNAMIC_LEVELS.p;
  return null;
}
export function velocityName(v) {
  let best = LEVEL_ORDER[0];
  for (const k of LEVEL_ORDER) if (Math.abs(DYNAMIC_LEVELS[k] - v) < Math.abs(DYNAMIC_LEVELS[best] - v)) best = k;
  return best;
}
// The written level in force at time t on a staff (a mark on any staff
// applies when the staff has none): {mark, t} or null. `marks` = [{t, mark, staff}].
export function markAt(marks, t, staff) {
  let found = null;
  for (const m of marks) {
    if (dynamicLevel(m.mark) == null || m.t > t + EPS) continue;
    if (m.staff != null && staff != null && m.staff !== staff && marks.some(o => o.staff === staff && dynamicLevel(o.mark) != null)) continue;
    if (!found || m.t >= found.t) found = m;
  }
  return found;
}

// Compare played velocity with the score's dynamics. Returns
// {velocityMean, marks: [{mark, bars, played}], hairpins: [{form, bars, change}],
//  balance: {lhMinusRh, heavy: 'bars 5–6' | null}, remarks: [..]} or null.
export function dynamicsReport(notes, {marks = [], hairpins = [], measures = [], hands = 'both'} = {}) {
  const list = notes.filter(p => Number.isFinite(p.velocity));
  if (list.length < 4) return null;
  const remarks = [];
  const out = {velocityMean: round(mean(list.map(p => p.velocity)), 1), marks: [], hairpins: [], balance: null, remarks};
  // Segments of notes under one written level.
  const segs = new Map();
  for (const p of list) {
    const m = markAt(marks, p.t, p.staff);
    if (!m) continue;
    const key = m.t + ':' + m.mark;
    if (!segs.has(key)) segs.set(key, {mark: m.mark, t: m.t, notes: []});
    segs.get(key).notes.push(p);
  }
  const ordered = [...segs.values()].filter(s => s.notes.length >= 3).sort((a, b) => a.t - b.t);
  for (const s of ordered) {
    const ms = s.notes.map(p => p.measure), played = mean(s.notes.map(p => p.velocity));
    s.played = played; s.bars = barsText(measures, Math.min(...ms), Math.max(...ms));
    out.marks.push({mark: s.mark, bars: s.bars, played: round(played, 1), expected: dynamicLevel(s.mark)});
  }
  // Contrast between neighbouring marks matters more than absolute loudness
  // (every keyboard responds differently).
  for (let k = 1; k < ordered.length && remarks.length < 1; k++) {
    const a = ordered[k - 1], b = ordered[k];
    const want = dynamicLevel(b.mark) - dynamicLevel(a.mark), got = b.played - a.played;
    if (Math.abs(want) >= 14 && (Math.sign(got) !== Math.sign(want) || Math.abs(got) < 5))
      remarks.push(`The ${b.mark} in ${b.bars} could ${want > 0 ? 'step out' : 'drop back'} more from the ${a.mark} before it.`);
  }
  if (!remarks.length) for (const s of ordered) {
    const want = LEVEL_ORDER.indexOf(String(s.mark).toLowerCase()), got = LEVEL_ORDER.indexOf(velocityName(s.played));
    if (want >= 0 && Math.abs(got - want) >= 2) { remarks.push(`${cap(s.bars)}, marked ${s.mark}, came out nearer ${LEVEL_ORDER[got]}.`); break; }
  }
  for (const h of hairpins) {
    const inside = list.filter(p => p.t >= h.t - EPS && p.t <= h.end + EPS && (h.staff == null || p.staff == null || p.staff === h.staff || !list.some(q => q.staff === h.staff)));
    if (inside.length < 3) continue;
    const fit = fitLine(inside.map(p => ({x: p.t, y: p.velocity})));
    const change = fit ? fit.b * (h.end - h.t) : 0;
    const ms = inside.map(p => p.measure), bars = barsText(measures, Math.min(...ms), Math.max(...ms));
    out.hairpins.push({form: h.form, bars, change: round(change, 1)});
    const grows = h.form === 'dim' ? -change : change;
    if (grows < 5 && remarks.length < 2) remarks.push(`The ${h.form === 'dim' ? 'diminuendo' : 'crescendo'} in ${bars} stayed rather level.`);
  }
  // Hand balance: the left hand (usually accompaniment) louder than the right.
  if (hands === 'both') {
    const bars = new Map();
    for (const p of list) {
      const b = bars.get(p.measure) ?? {r: [], l: []};
      b[p.hand === 'l' ? 'l' : 'r'].push(p.velocity); bars.set(p.measure, b);
    }
    const diffs = [...bars].filter(([, b]) => b.r.length >= 2 && b.l.length >= 2).map(([i, b]) => [i, mean(b.l) - mean(b.r)]).sort((a, b) => a[0] - b[0]);
    if (diffs.length) {
      out.balance = {lhMinusRh: round(mean(diffs.map(d => d[1])), 1), heavy: null};
      let best = null, cur = null;
      for (const [i, d] of diffs) {
        if (d >= 6) { cur = cur && i === cur.last + 1 ? {...cur, last: i} : {first: i, last: i}; if (!best || cur.last - cur.first > best.last - best.first) best = cur; }
        else cur = null;
      }
      if (best) {
        out.balance.heavy = barsText(measures, best.first, best.last);
        if (remarks.length < 2) remarks.unshift(`Left hand a touch heavy in ${out.balance.heavy}.`);
      }
    }
  }
  remarks.splice(2);
  return out;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Legato and staccato from note-off times. `slurs` = [{start, end}] (score
// time); `legato` treats every pair as slurred (scales). Returns
// {legatoPairs, detachedPairs, overlapMs, staccato: {count, held}, remarks} or null.
export function articulationReport(notes, {slurs = [], legato = false, measures = []} = {}) {
  const list = notes.filter(p => Number.isFinite(p.at) && Number.isFinite(p.off));
  if (list.length < 3) return null;
  const remarks = [];
  let legatoPairs = 0, detached = 0;
  const overlaps = [], detachedAt = [];
  for (const h of ['r', 'l']) {
    const line = list.filter(p => (p.hand === 'l' ? 'l' : 'r') === h).sort((a, b) => a.at - b.at);
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k], b = line[k + 1];
      if (b.at - a.at < 25 || b.t <= a.t + EPS) continue; // chord notes
      const slurred = legato || slurs.some(s => a.t >= s.start - EPS && b.t <= s.end + EPS);
      if (!slurred || a.stacc || b.stacc) continue;
      legatoPairs++;
      const overlap = a.off - b.at; // + = keys overlap (legato), − = a gap
      overlaps.push(overlap);
      if (overlap < -30) { detached++; detachedAt.push(a.measure); }
    }
  }
  const stacc = list.filter(p => p.stacc && p.d > 0 && p.qms > 0);
  const held = stacc.filter(p => (p.off - p.at) / (p.d * p.qms) > .75);
  if (legatoPairs >= 3 && detached / legatoPairs > .3) {
    const ms = detachedAt.filter(Number.isInteger);
    remarks.push(`${legato ? 'The line' : 'The slurred notes'}${ms.length ? ` in ${barsText(measures, Math.min(...ms), Math.max(...ms))}` : ''} came out a little detached: join them.`);
  }
  if (stacc.length >= 2 && held.length / stacc.length > .5) {
    const ms = held.map(p => p.measure).filter(Number.isInteger);
    remarks.push(`The staccato notes${ms.length ? ` in ${barsText(measures, Math.min(...ms), Math.max(...ms))}` : ''} are held a little long.`);
  }
  return {legatoPairs, detachedPairs: detached, overlapMs: overlaps.length ? round(mean(overlaps), 1) : null,
    staccato: {count: stacc.length, held: held.length}, remarks};
}

// Pedal: user presses ([{pos (score time), down}]) against the score's marks
// ([{t, dir: 'down' | 'up' | 'bounce'}]). A mark is caught when the pedal goes
// down within a beat of it. Returns {presses, marks, caught, remark}.
export function pedalReport(presses, marks = [], {window = 1} = {}) {
  const downs = presses.filter(p => p.down);
  const want = marks.filter(m => m.dir === 'down' || m.dir === 'bounce');
  const caught = want.filter(m => downs.some(p => p.pos >= m.t - .75 && p.pos <= m.t + window)).length;
  let remark = null;
  if (want.length && !downs.length) remark = 'The score asks for pedal here; none was used.';
  else if (want.length >= 2 && caught / want.length < .5) remark = 'Some pedal changes in the score were missed.';
  return {presses: downs.length, marks: want.length, caught, remark};
}

// ───────── Latency calibration ─────────
// Clicks at known times and the user's taps along with them (both in ms):
// each tap is paired with the nearest click (within half the interval); the
// first `skip` clicks are a run-in. → {ms (median offset, + = taps late),
// spread (median absolute deviation), n} or null with fewer than `min` taps.
export function measureLatency(clicks, taps, {skip = 2, min = 4} = {}) {
  if (clicks.length < 2) return null;
  const interval = median(clicks.slice(1).map((c, i) => c - clicks[i]));
  const offsets = [];
  const used = new Set();
  for (const tap of taps) {
    let best = -1;
    clicks.forEach((c, i) => { if (best < 0 || Math.abs(tap - c) < Math.abs(tap - clicks[best])) best = i; });
    if (best < skip || used.has(best) || Math.abs(tap - clicks[best]) > interval / 2) continue;
    used.add(best);
    offsets.push(tap - clicks[best]);
  }
  if (offsets.length < min) return null;
  const ms = median(offsets);
  return {ms: Math.round(ms), spread: Math.round(median(offsets.map(o => Math.abs(o - ms)))), n: offsets.length};
}
export const clampLatency = ms => clamp(Math.round(+ms || 0), -100, 400);

// ───────── Page-turn mode ─────────
// Measure boxes [{x0, x1}] (one long system, pixels) → pages of whole measures
// fitting `width`: [{first, last, x0, x1}]. A measure wider than a page gets one to itself.
export function paginate(boxes, width) {
  const pages = [];
  let page = null;
  boxes.forEach((b, i) => {
    if (!b) return;
    if (page && b.x1 - page.x0 <= width) { page.last = i; page.x1 = b.x1; return; }
    page = {first: i, last: i, x0: i === 0 ? Math.min(0, b.x0) : b.x0, x1: b.x1};
    pages.push(page);
  });
  return pages;
}
export const pageOf = (pages, measureIndex) => Math.max(0, pages.findIndex(p => p.first <= measureIndex && measureIndex <= p.last));
// The page to show at score time t: turned `lead` quarter notes (a beat) early.
export function pageAtTime(pages, measures, t, lead = 1) {
  if (!pages.length) return 0;
  const look = t + lead;
  let i = measures.findIndex(m => m.start <= look + EPS && look + EPS < m.end);
  if (i < 0) i = look < (measures[0]?.start ?? 0) ? 0 : measures.length - 1;
  return pageOf(pages, i);
}
