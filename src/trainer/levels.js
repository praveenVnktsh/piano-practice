// Note-reading levels and the note picker (pure logic; no DOM).
//
// A level produces a finite list of "items" (one or two pitches on one staff).
// pick() chooses the next item: never the same pitches twice in a row, and
// weighted towards items the reader misses or answers slowly (a small
// Leitner-box scheme whose stats are kept per item id in localStorage).

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMI = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const ACC_TEXT = {'-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: 'x'};
const ACC_SYMBOL = {'-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪'};

/** "F#4" | "Bb3" | "C4" → {step, alter, octave}. */
export function parsePitch(text) {
  const m = /^([A-G])(bb|b|#|x|)(-?\d)$/.exec(text);
  if (!m) throw Error('Bad pitch ' + text);
  const alter = {bb: -2, b: -1, '': 0, '#': 1, x: 2}[m[2]];
  return {step: m[1], alter, octave: +m[3]};
}
export const pitchText = p => p.step + ACC_TEXT[p.alter] + p.octave;
/** Display name with real accidental symbols, e.g. "F♯4". */
export const pitchLabel = (p, {octave = true} = {}) => p.step + ACC_SYMBOL[p.alter] + (octave ? p.octave : '');
export const midiOf = p => 12 * (p.octave + 1) + STEP_SEMI[p.step] + p.alter;
/** Diatonic index: one per staff position (C4 = 28). */
export const diatonic = p => p.octave * 7 + STEPS.indexOf(p.step);
const fromDiatonic = (d, alter = 0) => ({step: STEPS[((d % 7) + 7) % 7], alter, octave: Math.floor(d / 7)});

const NAME_OF_MIDI = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const midiLabel = n => NAME_OF_MIDI[n % 12] + (Math.floor(n / 12) - 1);

// ───────── Keys ─────────
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** Major keys offered by the key-signature level (fifths: + sharps, - flats). */
export const KEYS = [
  {id: 'G', name: 'G major', fifths: 1},
  {id: 'D', name: 'D major', fifths: 2},
  {id: 'A', name: 'A major', fifths: 3},
  {id: 'E', name: 'E major', fifths: 4},
  {id: 'B', name: 'B major', fifths: 5},
  {id: 'F', name: 'F major', fifths: -1},
  {id: 'Bb', name: 'B♭ major', fifths: -2},
  {id: 'Eb', name: 'E♭ major', fifths: -3},
  {id: 'Ab', name: 'A♭ major', fifths: -4},
  {id: 'Db', name: 'D♭ major', fifths: -5},
  {id: 'C', name: 'C major', fifths: 0},
];
export const keyById = id => KEYS.find(k => k.id === id) ?? KEYS.find(k => k.id === 'C');
/** The accidental each step carries in a key: {F: 1, C: 1} for D major. */
export function keyAlters(fifths) {
  const out = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(s => out[s] = 1);
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach(s => out[s] = -1);
  return out;
}
/** Steps of the key signature in engraving order. */
export const keySignatureSteps = fifths => fifths > 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths);

// ───────── Levels ─────────
// staff: which staff (or both) the level draws on; ranges are inclusive and natural.
const TREBLE = ['C4', 'G5'], BASS = ['F2', 'C4'];
const TREBLE_LEDGER = ['A3', 'C6'], BASS_LEDGER = ['E2', 'E4'];

export const LEVELS = [
  {id: 'c-position', name: 'C position', short: 'C position', staff: 'grand',
    blurb: 'The ten notes under your fingers in C position: C to G in each hand.', ranges: {treble: ['C4', 'G4'], bass: ['C3', 'G3']}},
  {id: 'landmarks', name: 'Landmark notes', short: 'Landmarks', staff: 'grand',
    blurb: 'Middle C, treble G, bass F and their neighbours: anchors to read everything else from.',
    pool: [['treble', 'C4'], ['bass', 'C4'], ['treble', 'G4'], ['bass', 'F3'], ['treble', 'C5'], ['bass', 'C3'], ['treble', 'F5'], ['bass', 'G2']]},
  {id: 'treble', name: 'Treble clef', short: 'Treble', staff: 'treble', blurb: 'Naturals from middle C to G5.', ranges: {treble: TREBLE}},
  {id: 'bass', name: 'Bass clef', short: 'Bass', staff: 'bass', blurb: 'Naturals from F2 to middle C.', ranges: {bass: BASS}},
  {id: 'grand', name: 'Grand staff', short: 'Grand', staff: 'grand', blurb: 'Both clefs, F2 to G5.', ranges: {treble: TREBLE, bass: BASS}},
  {id: 'treble-ledger', name: 'Treble + ledger lines', short: 'Treble ledger', staff: 'treble',
    blurb: 'A3 to C6, with ledger lines above and below.', ranges: {treble: TREBLE_LEDGER}},
  {id: 'bass-ledger', name: 'Bass + ledger lines', short: 'Bass ledger', staff: 'bass',
    blurb: 'E2 to E4, with ledger lines above and below.', ranges: {bass: BASS_LEDGER}},
  {id: 'grand-ledger', name: 'Grand staff + ledger lines', short: 'Grand ledger', staff: 'grand',
    blurb: 'Both clefs, E2 to C6.', ranges: {treble: TREBLE_LEDGER, bass: BASS_LEDGER}},
  {id: 'accidentals', name: 'Sharps and flats', short: 'Accidentals', staff: 'grand',
    blurb: 'Grand staff with ♯ and ♭ notes mixed in.', ranges: {treble: TREBLE, bass: BASS}, accidentals: true},
  {id: 'keys', name: 'Key signatures', short: 'Keys', staff: 'grand',
    blurb: 'Notes in a key, written with its key signature: remember which notes are sharp or flat.', ranges: {treble: TREBLE, bass: BASS}, usesKey: true},
  {id: 'intervals', name: 'Intervals (two notes)', short: 'Intervals', staff: 'grand',
    blurb: 'Two notes at once, a 2nd to an octave apart: play both.', ranges: {treble: TREBLE, bass: BASS}, dyads: true},
];
export const levelById = id => LEVELS.find(l => l.id === id) ?? LEVELS.find(l => l.id === 'treble');

function naturalsIn([lo, hi]) {
  const out = [];
  for (let d = diatonic(parsePitch(lo)); d <= diatonic(parsePitch(hi)); d++) out.push(fromDiatonic(d));
  return out;
}
const withMidi = p => ({...p, midi: midiOf(p)});
// The "spellings" a reader meets: no E#, B#, Fb or Cb in the accidentals level.
const ACCIDENTAL_OK = {1: ['C', 'D', 'F', 'G', 'A'], [-1]: ['D', 'E', 'G', 'A', 'B']};

/**
 * Every item a level can ask: {id, clef, key, pitches: [{step, alter, octave, midi}]}.
 * `key` is the key id (only for the key-signature level; "C" otherwise).
 * Pitches within an item are sorted low to high.
 */
export function candidates(level, {key = 'G'} = {}) {
  const k = level.usesKey ? keyById(key) : keyById('C');
  const alters = keyAlters(k.fifths);
  const items = [];
  const add = (clef, pitches) => {
    pitches = pitches.map(withMidi).sort((a, b) => a.midi - b.midi);
    const id = (level.usesKey ? `${k.id}|` : '') + clef + ':' + pitches.map(pitchText).join('+');
    items.push({id, clef, key: k.id, pitches});
  };
  if (level.pool) {
    for (const [clef, text] of level.pool) add(clef, [parsePitch(text)]);
    return items;
  }
  for (const [clef, range] of Object.entries(level.ranges)) {
    const naturals = naturalsIn(range);
    if (level.dyads) {
      for (let i = 0; i < naturals.length; i++)
        for (let j = i + 1; j < naturals.length && j - i <= 7; j++) add(clef, [naturals[i], naturals[j]]);
    } else {
      for (const p of naturals) {
        if (level.usesKey) add(clef, [{...p, alter: alters[p.step] ?? 0}]);
        else add(clef, [p]);
        if (level.accidentals) for (const alter of [1, -1]) if (ACCIDENTAL_OK[alter].includes(p.step)) add(clef, [{...p, alter}]);
      }
    }
  }
  return items;
}

/** Lowest and highest MIDI note a level can ask (for sizing the keyboard). */
export function levelSpan(level, opts) {
  let lo = 127, hi = 0;
  for (const it of candidates(level, opts)) for (const p of it.pitches) { lo = Math.min(lo, p.midi); hi = Math.max(hi, p.midi); }
  return [lo, hi];
}

// ───────── Spaced repetition ─────────
// stats: {[itemId]: {box: 0..4, seen, miss, ms (smoothed response time), at}}
const BOX_WEIGHT = [8, 4, 2, 1, .5];
const NEW_WEIGHT = 3;
export const SLOW_MS = 4000;

export function weightOf(stat) {
  if (!stat) return NEW_WEIGHT;
  let w = BOX_WEIGHT[Math.max(0, Math.min(4, stat.box))];
  if (stat.ms > SLOW_MS) w *= 1.5; // slow but right still needs practice
  return w;
}

/** Returns a new stats object with one answer recorded. */
export function recordAnswer(stats, id, {correct, ms = null, at = Date.now()}) {
  const s = {box: 0, seen: 0, miss: 0, ms: null, ...stats[id]};
  s.seen++;
  if (correct) {
    // A correct but slow answer stays in its box instead of moving up.
    s.box = ms != null && ms > SLOW_MS ? s.box : Math.min(4, s.box + 1);
  } else {
    s.miss++;
    s.box = 0;
  }
  if (ms != null) s.ms = s.ms == null ? ms : Math.round(s.ms * .6 + ms * .4);
  s.at = at;
  return {...stats, [id]: s};
}

const samePitches = (a, b) => !!a && !!b && a.pitches.length === b.pitches.length && a.pitches.every((p, i) => p.midi === b.pitches[i].midi);

/**
 * Weighted random choice among items, never repeating `last` (by id or by
 * identical pitches) when there is any alternative.
 */
export function pick(items, {stats = {}, last = null, rng = Math.random} = {}) {
  if (!items.length) return null;
  let pool = items.filter(it => it.id !== last?.id && !samePitches(it, last));
  if (!pool.length) pool = items;
  const weights = pool.map(it => weightOf(stats[it.id]));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) < 0) return pool[i];
  return pool[pool.length - 1];
}

/** Does a played MIDI note answer target pitch p? */
export const matches = (midi, p, anyOctave = false) => anyOctave ? (midi - p.midi) % 12 === 0 : midi === p.midi;

// ───────── Storage ─────────
const STATS_KEY = 'trainer:reading:stats';
export function loadStats(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(STATS_KEY)) || {}; } catch { return {}; }
}
export function saveStats(stats, storage = globalThis.localStorage) {
  try { storage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}
