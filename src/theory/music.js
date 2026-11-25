// Shared music helpers for the reading / theory / ear exercises (pure, no DOM):
// a seeded random generator, interval and chord spelling on top of src/exercises/theory.js,
// and small naming helpers. A pitch is {step, alter, octave}; MIDI 60 = C4.
import {LETTERS, midi, pitchName, spellInterval, parseKey, atMidi, pitchClass, chordFromNumeral} from '../exercises/theory.js';

export {midi, pitchName, parseKey, atMidi, LETTERS};

// ───────── Seeded randomness ─────────

/** mulberry32: a small, fast, seedable PRNG → () => [0, 1). */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const newSeed = () => Math.floor(Math.random() * 0xffffff) + 1;
export const pickOne = (r, list) => list[Math.floor(r() * list.length)];
/** Weighted choice: entries [[value, weight], …]. */
export function weighted(r, entries) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) { if ((x -= w) < 0) return v; }
  return entries.at(-1)[0];
}
export function shuffle(r, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ───────── Intervals ─────────
// degree = letter steps above the lower note (0 = unison), semis = semitones.
export const INTERVALS = [
  {id: 'P1', degree: 0, semis: 0, name: 'unison', short: 'Unison'},
  {id: 'm2', degree: 1, semis: 1, name: 'minor 2nd', short: 'm2'},
  {id: 'M2', degree: 1, semis: 2, name: 'major 2nd', short: 'M2'},
  {id: 'm3', degree: 2, semis: 3, name: 'minor 3rd', short: 'm3'},
  {id: 'M3', degree: 2, semis: 4, name: 'major 3rd', short: 'M3'},
  {id: 'P4', degree: 3, semis: 5, name: 'perfect 4th', short: 'P4'},
  {id: 'A4', degree: 3, semis: 6, name: 'augmented 4th', short: 'Aug 4'},
  {id: 'd5', degree: 4, semis: 6, name: 'diminished 5th', short: 'Dim 5'},
  {id: 'P5', degree: 4, semis: 7, name: 'perfect 5th', short: 'P5'},
  {id: 'm6', degree: 5, semis: 8, name: 'minor 6th', short: 'm6'},
  {id: 'M6', degree: 5, semis: 9, name: 'major 6th', short: 'M6'},
  {id: 'm7', degree: 6, semis: 10, name: 'minor 7th', short: 'm7'},
  {id: 'M7', degree: 6, semis: 11, name: 'major 7th', short: 'M7'},
  {id: 'P8', degree: 7, semis: 12, name: 'octave', short: 'Octave'},
];
export const intervalById = id => INTERVALS.find(i => i.id === id) || null;
/** The interval name for a semitone distance (tritone → 'A4'), ignoring spelling. */
export const intervalBySemis = s => INTERVALS.find(i => i.semis === s && i.id !== 'd5') || null;

/** Spelled pitch `id` above `p` (with octave). */
export function intervalAbove(p, id) {
  const iv = intervalById(id);
  if (!iv) throw Error('Unknown interval ' + id);
  const pc = spellInterval(p, iv.degree % 7, iv.semis % 12);
  const li = LETTERS.indexOf(p.step);
  const octave = p.octave + Math.floor((li + iv.degree) / 7);
  const q = {...pc, octave};
  if (midi(q) - midi(p) !== iv.semis) throw Error(`Bad spelling of ${id} above ${pitchName(p)}`);
  return q;
}
/** Spelled pitch `id` below `p`. */
export function intervalBelow(p, id) {
  const iv = intervalById(id);
  const li = LETTERS.indexOf(p.step);
  const d = p.octave * 7 + li - iv.degree;
  const step = LETTERS[((d % 7) + 7) % 7], octave = Math.floor(d / 7);
  const natural = midi({step, alter: 0, octave});
  const alter = midi(p) - iv.semis - natural;
  if (Math.abs(alter) > 2) throw Error(`Cannot spell ${id} below ${pitchName(p)}`);
  return {step, alter, octave};
}
/** Name the interval between two spelled pitches (lower first) → interval id or null. */
export function nameInterval(a, b) {
  const [lo, hi] = midi(a) <= midi(b) ? [a, b] : [b, a];
  const degree = (hi.octave * 7 + LETTERS.indexOf(hi.step)) - (lo.octave * 7 + LETTERS.indexOf(lo.step));
  const semis = midi(hi) - midi(lo);
  return INTERVALS.find(i => i.degree === degree && i.semis === semis)?.id ?? null;
}

// ───────── Chords ─────────
// Intervals stacked from the root (interval ids).
export const CHORDS = {
  major: {name: 'major', symbol: '', tones: ['P1', 'M3', 'P5']},
  minor: {name: 'minor', symbol: 'm', tones: ['P1', 'm3', 'P5']},
  diminished: {name: 'diminished', symbol: '°', tones: ['P1', 'm3', 'd5']},
  augmented: {name: 'augmented', symbol: '+', tones: ['P1', 'M3', 'm6']},
  dom7: {name: 'dominant 7th', symbol: '7', tones: ['P1', 'M3', 'P5', 'm7']},
  maj7: {name: 'major 7th', symbol: 'maj7', tones: ['P1', 'M3', 'P5', 'M7']},
  min7: {name: 'minor 7th', symbol: 'm7', tones: ['P1', 'm3', 'P5', 'm7']},
};
// Augmented fifth is spelled as a 5th, not a 6th.
const AUG5 = {degree: 4, semis: 8};

/** Root-position chord tones from a root pitch, spelled: [root, 3rd, 5th(, 7th)]. */
export function chordTones(root, quality) {
  const c = CHORDS[quality];
  if (!c) throw Error('Unknown chord quality ' + quality);
  return c.tones.map(id => {
    if (quality === 'augmented' && id === 'm6') {
      const pc = spellInterval(root, AUG5.degree, AUG5.semis);
      return {...pc, octave: root.octave + Math.floor((LETTERS.indexOf(root.step) + 4) / 7)};
    }
    return intervalAbove(root, id);
  });
}
/** Inversion n (0 = root position): the lowest n tones move up an octave. */
export function invert(tones, n) {
  const out = tones.map(t => ({...t}));
  for (let i = 0; i < n; i++) { const t = out.shift(); out.push({...t, octave: t.octave + 1}); }
  return out;
}
/** Pitch-class set (relative to the lowest note) → {quality, inversion, root (index)} or null. */
export function classifyChord(midis) {
  const pcs = [...new Set(midis.map(m => ((m % 12) + 12) % 12))];
  if (pcs.length < 3) return null;
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  for (const [quality, c] of Object.entries(CHORDS)) {
    if (c.tones.length !== pcs.length) continue;
    const shape = c.tones.map(id => quality === 'augmented' && id === 'm6' ? 8 : intervalById(id).semis);
    for (const root of pcs) {
      const set = new Set(pcs.map(p => (p - root + 12) % 12));
      if (shape.every(s => set.has(s))) {
        const inversion = shape.findIndex(s => (root + s) % 12 === bass);
        return {quality, inversion, rootPc: root};
      }
    }
  }
  return null;
}

export const ACC = {'-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪'};
export const noteLabel = (p, {octave = false} = {}) => p.step + ACC[p.alter] + (octave ? p.octave : '');
const SHARP_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const midiName = n => SHARP_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
/** A natural-ish spelling for a MIDI number (for keys the student plays). */
export function spellMidi(n, preferFlats = false) {
  const pc = ((n % 12) + 12) % 12, octave = Math.floor(n / 12) - 1;
  const sharp = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const flat = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
  const [step, alter] = (preferFlats ? flat : sharp)[pc];
  return {step, alter, octave};
}

/**
 * Four-part block chords for roman numerals in a key: the bass on the root (G2–F♯3), the right hand in
 * close position moving as little as possible (G3–G5). → [{numeral, chord, pitches: [bass, …rh]}]
 */
export function voiceProgression(tonic, mode, numerals) {
  let prev = null;
  return numerals.map(numeral => {
    const chord = chordFromNumeral(tonic, mode, numeral);
    let best = null;
    for (let inv = 0; inv < 3; inv++) {
      const tones = [...chord.tones.slice(inv), ...chord.tones.slice(0, inv)];
      for (let base = 55; base <= 72; base++) {
        if (pitchClass(tones[0]) !== base % 12) continue;
        const ps = [atMidi(tones[0], base)];
        for (const t of tones.slice(1)) { let m = midi(ps.at(-1)) + 1; while (m % 12 !== pitchClass(t)) m++; ps.push(atMidi(t, m)); }
        const ms = ps.map(midi);
        if (ms[0] < 59 || ms[2] > 79) continue;
        const cost = prev ? ms.reduce((a, m, i) => a + Math.abs(m - prev[i]), 0) : Math.abs(ms[1] - 67) + inv * .5;
        if (!best || cost < best.cost) best = {ps, ms, cost};
      }
    }
    prev = best.ms;
    let b = 43; while (b % 12 !== pitchClass(chord.root)) b++;
    return {numeral, chord, pitches: [atMidi(chord.root, b), ...best.ps]};
  });
}
