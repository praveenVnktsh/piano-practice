// First look at a piece (docs/ROADMAP.md, Phase 12): what to know before the first play.
// Key, time signature, tempo, each hand's range and a few "tricky bars" (wide leaps, many
// accidentals, the fastest notes), computed from buildScore's measures and events
// (src/score-core.mjs; times in quarter notes, `hand` 'r' | 'l'). Pure logic, no DOM.

const EPS = 1e-6;
const MAJOR = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const INTERVALS = {7: 'a fifth', 8: 'a sixth', 9: 'a sixth', 10: 'a seventh', 11: 'a seventh', 12: 'an octave'};

/** MIDI note → "F♯4" (sharps, or flats when `flats`). */
export const noteName = (n, flats = false) => (flats ? FLATS : SHARPS)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

/** Pitch classes of the key signature's scale (the major scale of `fifths`; its relative minor shares them). */
export function scalePitchClasses(fifths = 0) {
  const tonic = ((fifths * 7) % 12 + 12) % 12;
  return new Set(MAJOR_STEPS.map(s => (tonic + s) % 12));
}

/**
 * The key: {fifths, mode, name: 'G major'}. A score that doesn't say major or minor is read
 * as minor when its last bass note is the relative minor's tonic.
 */
export function keyOf(measures = [], events = []) {
  const k = measures.find(m => m.key)?.key || {fifths: 0, mode: null};
  const fifths = Math.max(-7, Math.min(7, k.fifths | 0));
  let mode = k.mode === 'minor' || k.mode === 'major' ? k.mode : null;
  if (!mode) {
    const end = Math.max(0, ...events.map(e => e.t));
    const bass = events.filter(e => e.t >= end - EPS).reduce((lo, e) => (!lo || e.n < lo.n ? e : lo), null);
    const minorTonic = (((fifths * 7) % 12 + 12) % 12 + 9) % 12;
    mode = bass && ((bass.n % 12) + 12) % 12 === minorTonic ? 'minor' : 'major';
  }
  return {fifths, mode, name: `${(mode === 'minor' ? MINOR : MAJOR)[fifths + 7]} ${mode}`};
}

/** "3/4", or "3/4, then 2/4" when it changes (the pickup's meter is the piece's own). */
export function meterText(measures = []) {
  const seen = [];
  for (const m of measures) {
    const t = m.meter ? `${m.meter.count}/${m.meter.unit}` : null;
    if (t && seen.at(-1) !== t) seen.push(t);
  }
  if (!seen.length) return '4/4';
  return seen.length === 1 ? seen[0] : seen.length === 2 ? `${seen[0]}, then ${seen[1]}` : `${seen[0]}, changing`;
}

/** Each hand's range: {r: {low, high, span}, l: …}; a hand without notes is absent. */
export function handRanges(events = []) {
  const out = {};
  for (const h of ['r', 'l']) {
    const ns = events.filter(e => (e.hand === 'l' ? 'l' : 'r') === h).map(e => e.n);
    if (ns.length) { const low = Math.min(...ns), high = Math.max(...ns); out[h] = {low, high, span: high - low}; }
  }
  return out;
}

// The melody line of a hand: the top note (right hand) or bottom note (left hand) at each onset.
function line(events, hand) {
  const at = new Map();
  for (const e of events) {
    if ((e.hand === 'l' ? 'l' : 'r') !== hand) continue;
    const cur = at.get(e.t);
    if (!cur || (hand === 'r' ? e.n > cur.n : e.n < cur.n)) at.set(e.t, e);
  }
  return [...at.values()].sort((a, b) => a.t - b.t);
}

/** "semiquavers" for a note value in quarter notes. */
export function valueName(q) {
  const names = [[1 / 8, 'demisemiquavers'], [1 / 6, 'semiquaver triplets'], [1 / 4, 'semiquavers'], [1 / 3, 'quaver triplets'], [1 / 2, 'quavers'], [1, 'crotchets']];
  for (const [v, name] of names) if (q <= v + EPS) return name;
  return 'minims';
}

/**
 * Score every bar for difficulty and pick the trickiest few:
 *   leap   – the widest jump within a hand's line, between notes at most a beat apart (a fifth or more)
 *   accidentals – notes outside the key signature's scale
 *   fast   – the bar holds the piece's fastest notes (a quaver or shorter, between onsets in one hand)
 * → [{index, label, score, reasons: [text, …]}] in bar order, at most `max`, at least `min`
 * when that many bars have anything tricky in them. Neighbouring bars aren't both picked.
 */
export function trickyBars(measures = [], events = [], {fifths = 0, max = 4, min = 2} = {}) {
  if (!measures.length || !events.length) return [];
  const scale = scalePitchClasses(fifths);
  const barOf = t => { const i = measures.findIndex(m => m.start <= t + EPS && t + EPS < m.end); return i < 0 ? measures.length - 1 : i; };
  const bars = measures.map((m, index) => ({index, leap: 0, acc: 0, iois: []}));
  for (const hand of ['r', 'l']) {
    const ln = line(events, hand);
    for (let k = 1; k < ln.length; k++) {
      const a = ln[k - 1], b = ln[k], gap = b.t - a.t;
      if (gap > 1 + EPS) continue;
      const bar = bars[barOf(b.t)];
      bar.leap = Math.max(bar.leap, Math.abs(b.n - a.n));
      bar.iois.push(gap);
    }
  }
  for (const e of events) if (!scale.has(((e.n % 12) + 12) % 12)) bars[barOf(e.t)].acc++;
  const fastest = Math.min(...bars.flatMap(b => b.iois));
  const fastValue = Number.isFinite(fastest) && fastest <= .5 + EPS ? fastest : null;

  for (const b of bars) {
    const reasons = [];
    let score = 0;
    if (b.leap >= 7) {
      score += (b.leap - 5) / 7;
      reasons.push([(b.leap - 5) / 7, `a wide leap (${INTERVALS[b.leap] || 'more than an octave'})`]);
    }
    if (b.acc >= 2) {
      const s = (b.acc - 1) / 3;
      score += s;
      reasons.push([s, `${b.acc} accidentals`]);
    }
    if (fastValue != null && b.iois.some(x => Math.abs(x - fastValue) < EPS)) {
      const run = b.iois.filter(x => Math.abs(x - fastValue) < EPS).length;
      const s = Math.min(1.5, .5 + run / 8);
      score += s;
      reasons.push([s, `the fastest notes (${valueName(fastValue)})`]);
    }
    b.score = Math.round(score * 100) / 100;
    b.reasons = reasons.sort((x, y) => y[0] - x[0]).map(r => r[1]);
  }
  // A repeat played again is the same bar: only its first visit is named.
  const ranked = bars.filter(b => b.score > 0 && !(measures[b.index].visit > 1)).sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  const near = b => picked.some(p => Math.abs(p.index - b.index) <= 1);
  for (const b of ranked) {
    if (picked.length >= max) break;
    if (near(b)) continue;
    if (b.score >= 1 || picked.length < min) picked.push(b);
  }
  const label = m => (m.pickup ? 'The pickup' : `Bar ${m.label ?? m.index + 1}`);
  return picked.sort((a, b) => a.index - b.index)
    .map(b => ({index: b.index, label: label(measures[b.index]), score: b.score, reasons: b.reasons}));
}

/**
 * Everything the first-look card shows:
 * {key, meter, tempo, ranges: {r?: 'C4–G5', l?: 'C3–G3'}, spans: {r?, l?} (semitones), tricky: […]}.
 * `tempo` is the piece's target tempo (quarter-note BPM), when known.
 */
export function firstLook({measures = [], events = []} = {}, {tempo = null} = {}) {
  const key = keyOf(measures, events);
  const flats = key.fifths < 0;
  const ranges = {}, spans = {};
  for (const [h, r] of Object.entries(handRanges(events))) {
    ranges[h] = r.low === r.high ? noteName(r.low, flats) : `${noteName(r.low, flats)}–${noteName(r.high, flats)}`;
    spans[h] = r.span;
  }
  return {
    key: key.name, meter: meterText(measures), tempo: tempo > 0 ? Math.round(tempo) : null,
    bars: measures.length, ranges, spans, tricky: trickyBars(measures, events, {fifths: key.fifths}),
  };
}
