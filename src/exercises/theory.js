// Music theory for the technique exercises: key spelling, scales, triads, diatonic chords.
// Pure functions, no DOM. A pitch is {step: 'C'..'B', alter: -2..2, octave}; a pitch class
// without an octave is {step, alter}.
//
// Key choices (what the builder offers; ids use `s` for sharp and `b` for flat):
//   major: C G D A E B F♯ D♭ A♭ E♭ B♭ F   (6 sharps as F♯ rather than G♭; 5 flats as D♭ rather than C♯)
//   minor: A E B F♯ C♯ G♯ E♭ B♭ F C G D   (6 flats as E♭ minor rather than D♯ minor: it is the
//          parallel of E♭ major, and its harmonic form needs no double sharp)
// The enharmonic alternatives G♭, C♯, C♭ major and D♯, A♯, A♭ minor are accepted too; any key
// with at most 7 sharps or flats spells correctly (F♯ major has E♯, G♭ major has C♭,
// G♯ harmonic minor has F𝄪).

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const LINE_OF_FIFTHS = {F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5};

/** Circle-of-fifths order of the default keys, as id strings. */
export const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'Fs', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const MINOR_KEYS = ['A', 'E', 'B', 'Fs', 'Cs', 'Gs', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];
/** Twelve chromatic starting notes (chromatic scales). */
export const CHROMATIC_STARTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Fs', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11], // ascending form; descending is natural minor
};
export const isMinor = mode => mode !== 'major';

/** 'C' | 'Fs' | 'F#' | 'F♯' | 'Bb' | 'B♭' | 'Css' → {step, alter}, or null. */
export function parseKey(text) {
  const m = String(text ?? '').trim().match(/^([A-Ga-g])(ss|bb|##|s|b|#|♯|♭|𝄪|𝄫)?$/);
  if (!m) return null;
  const alter = {s: 1, '#': 1, '♯': 1, ss: 2, '##': 2, '𝄪': 2, b: -1, '♭': -1, bb: -2, '𝄫': -2}[m[2]] ?? 0;
  return {step: m[1].toUpperCase(), alter};
}
/** {step, alter} → URL-safe id ('Fs', 'Bb'). */
export const keyId = p => p.step + ({1: 's', 2: 'ss', '-1': 'b', '-2': 'bb'}[p.alter] ?? '');
/** {step, alter} → display name ('F♯', 'B♭'). */
export const pitchName = p => p.step + ({1: '♯', 2: '𝄪', '-1': '♭', '-2': '𝄫'}[p.alter] ?? '');
export const keyLabel = id => { const p = parseKey(id); return p ? pitchName(p) : String(id); };

export const pitchClass = p => (((NATURAL[LETTERS.indexOf(p.step)] + p.alter) % 12) + 12) % 12;
export const midi = p => (p.octave + 1) * 12 + NATURAL[LETTERS.indexOf(p.step)] + p.alter;
export const isBlackKey = pc => [1, 3, 6, 8, 10].includes(((pc % 12) + 12) % 12);

/** The octave that puts {step, alter} at MIDI number `m` (m must be that pitch class). */
export function atMidi(p, m) {
  const octave = (m - NATURAL[LETTERS.indexOf(p.step)] - p.alter) / 12 - 1;
  if (!Number.isInteger(octave)) throw Error(`${pitchName(p)} is not MIDI ${m}`);
  return {step: p.step, alter: p.alter, octave};
}

/** Key signature: number of sharps (> 0) or flats (< 0). Throws for keys beyond 7. */
export function keyFifths(tonic, mode = 'major') {
  const fifths = LINE_OF_FIFTHS[tonic.step] + 7 * tonic.alter - (isMinor(mode) ? 3 : 0);
  if (Math.abs(fifths) > 7) throw Error(`${pitchName(tonic)} ${isMinor(mode) ? 'minor' : 'major'} needs more than 7 sharps or flats`);
  return fifths;
}

/** Alterations in a key signature: {F: 1, C: 1, …}. */
export function keySignatureAlters(fifths) {
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const alters = {};
  if (fifths > 0) order.slice(0, fifths).forEach(s => (alters[s] = 1));
  if (fifths < 0) [...order].reverse().slice(0, -fifths).forEach(s => (alters[s] = -1));
  return alters;
}

/** The pitch class `semis` semitones above `tonic`, spelled on the letter `degree` steps above. */
export function spellInterval(tonic, degree, semis) {
  const li = LETTERS.indexOf(tonic.step);
  const step = LETTERS[(li + degree) % 7];
  const target = NATURAL[li] + tonic.alter + semis;
  let alter = (((target - NATURAL[LETTERS.indexOf(step)]) % 12) + 12) % 12;
  if (alter > 6) alter -= 12;
  if (Math.abs(alter) > 2) throw Error(`Cannot spell ${semis} semitones above ${pitchName(tonic)} on ${step}`);
  return {step, alter};
}

/** Seven spelled degrees of a scale (no octaves). */
export function scaleDegrees(tonic, mode = 'major') {
  const steps = SCALE_STEPS[mode];
  if (!steps) throw Error('Unknown scale mode: ' + mode);
  return steps.map((s, i) => spellInterval(tonic, i, s));
}

/**
 * `count` consecutive notes of a scale starting on the tonic at `octave`, ascending.
 * Octave numbers follow the letter (C♭5 sounds as B4), as MusicXML expects.
 */
export function scaleRun(tonic, mode, octave, count) {
  const degrees = scaleDegrees(tonic, mode);
  const li = LETTERS.indexOf(tonic.step);
  return Array.from({length: count}, (_, i) => ({...degrees[i % 7], octave: octave + Math.floor((li + i) / 7)}));
}

const QUALITY = {'4,3': 'major', '3,4': 'minor', '3,3': 'diminished', '4,4': 'augmented'};

/** Triad on scale degree `degree` (1–7): {root, third, fifth, tones: [r, 3, 5], quality}. */
export function triad(tonic, mode, degree) {
  const d = scaleDegrees(tonic, mode);
  const tones = [0, 2, 4].map(k => d[(degree - 1 + k) % 7]);
  const pcs = tones.map(pitchClass);
  const gap = (a, b) => (((b - a) % 12) + 12) % 12;
  const quality = QUALITY[`${gap(pcs[0], pcs[1])},${gap(pcs[1], pcs[2])}`] ?? 'other';
  return {root: tones[0], third: tones[1], fifth: tones[2], tones, quality};
}

const NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

/**
 * Roman numeral ('I', 'ii', 'V', 'vii°', 'VII') → triad in the key. Major keys use the major
 * scale. Minor keys use natural minor, except V and vii° which take the raised leading note
 * (harmonic minor); write v or VII for the natural-minor chords.
 */
export function chordFromNumeral(tonic, mode, numeral) {
  const name = String(numeral).replace(/[°ø+]/g, '');
  const degree = NUMERALS.indexOf(name.toLowerCase()) + 1;
  if (!degree) throw Error('Unknown chord: ' + numeral);
  let scale = 'major';
  if (isMinor(mode)) scale = (name === 'V' || name === 'vii') ? 'harmonic-minor' : 'natural-minor';
  return {numeral, degree, ...triad(tonic, scale, degree)};
}

/** The seven diatonic triads with their roman numerals. */
export function diatonicChords(tonic, mode = 'major') {
  const names = isMinor(mode) ? ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  return names.map(n => chordFromNumeral(tonic, mode, n));
}

/** Relative and parallel keys. */
export const relativeMinor = tonic => spellInterval(tonic, 5, 9);
export const relativeMajor = tonic => spellInterval(tonic, 2, 3);
