// Exercise ids ↔ parameters, and catalog entries for generated exercises.
//
// Id grammar (keys use `s` for sharp and `b` for flat: C, Fs, Bb, Eb …):
//   ex:scale:<key>:<mode>:<hands>:<octaves>:<direction>
//        mode = major | natural-minor | harmonic-minor | melodic-minor   (`minor` = harmonic-minor)
//        hands = both | right | left, octaves = 1–4, direction = up-down
//   ex:arpeggio:<key>:<major|minor>:<hands>:<octaves>
//   ex:five-finger:<key>:<major|minor>[:<hands>]
//   ex:progression:<key>:<major|minor>:<numerals joined by ->      e.g. I-IV-V-I, ii-V-I, i-iv-V-i
//   ex:chromatic:<start note>:<hands>:<octaves>                     octaves = 1–2
// Trailing fields may be left out and take their defaults (both hands, 1 octave, up-down).

import {generateExercise, normalizeParams, exerciseTitle, DEFAULT_TEMPO, PROGRESSIONS} from './generate.js';
import {keyId, MAJOR_KEYS, MINOR_KEYS, relativeMinor, parseKey} from './theory.js';

export {PROGRESSIONS};
export const isExerciseId = id => typeof id === 'string' && id.startsWith('ex:');

/** 'ex:…' → normalised params, or null if the id isn't a valid exercise. */
export function parseExerciseId(id) {
  if (!isExerciseId(id)) return null;
  const [, type, key, ...rest] = id.split(':');
  let raw;
  switch (type) {
    case 'scale': raw = {type, key, mode: rest[0], hands: rest[1], octaves: rest[2], direction: rest[3]}; break;
    case 'arpeggio': raw = {type, key, quality: rest[0], hands: rest[1], octaves: rest[2]}; break;
    case 'five-finger': raw = {type, key, quality: rest[0], hands: rest[1]}; break;
    case 'progression': raw = {type, key, mode: rest[0], progression: rest[1]}; break;
    case 'chromatic': raw = {type, key, hands: rest[0], octaves: rest[1]}; break;
    default: return null;
  }
  for (const k of Object.keys(raw)) if (raw[k] === undefined || raw[k] === '') delete raw[k];
  try { return normalizeParams(raw); } catch { return null; }
}

/** Params ({type, key: 'Fs' | {step, alter}, …}) → canonical id. */
export function exerciseId(params) {
  const p = normalizeParams(params);
  const k = keyId(p.tonic);
  switch (p.type) {
    case 'scale': return `ex:scale:${k}:${p.mode}:${p.hands}:${p.octaves}:${p.direction}`;
    case 'arpeggio': return `ex:arpeggio:${k}:${p.quality}:${p.hands}:${p.octaves}`;
    case 'five-finger': return `ex:five-finger:${k}:${p.quality}:${p.hands}`;
    case 'progression': return `ex:progression:${k}:${p.mode}:${p.progression}`;
    case 'chromatic': return `ex:chromatic:${k}:${p.hands}:${p.octaves}`;
  }
  return null;
}

const blackKeyCount = p => Math.abs(p.tonic.alter) + (['F', 'B'].includes(p.tonic.step) ? 1 : 0);

export function exerciseDifficulty(p) {
  if (p.type === 'five-finger') return 'beginner';
  if (p.type === 'progression') return blackKeyCount(p) ? 'easy' : 'beginner';
  if (p.type === 'chromatic') return p.hands === 'both' ? 'intermediate' : 'easy';
  const hard = p.octaves >= 3 || (p.hands === 'both' && p.octaves >= 2) || p.mode === 'melodic-minor';
  if (hard) return p.octaves >= 3 ? 'advanced' : 'intermediate';
  return p.hands === 'both' || blackKeyCount(p) ? 'easy' : 'beginner';
}

/** Title only (no MusicXML), or null for an invalid id. */
export function exerciseTitleFor(id) {
  const p = parseExerciseId(id);
  return p ? exerciseTitle(p) : null;
}

/** 'ex:…' → {entry, source: {data}} with a generated, fingered score; null for an invalid id. */
export function resolveExercise(id) {
  const p = parseExerciseId(id);
  if (!p) return null;
  const {title, musicxml} = generateExercise(p);
  return {
    entry: {id, title, composer: 'Technique', difficulty: exerciseDifficulty(p), tempo: DEFAULT_TEMPO[p.type], section: null},
    source: {data: musicxml},
  };
}

/** Index into the circle of fifths for a date: today's warm-up key. */
export function warmupKeyIndex(date = new Date()) {
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return ((day % 12) + 12) % 12;
}

/** Today's warm-up: the key of the day through the circle of fifths. */
export function dailyWarmup(date = new Date()) {
  const key = MAJOR_KEYS[warmupKeyIndex(date)];
  const minor = keyId(relativeMinor(parseKey(key)));
  const ids = [
    exerciseId({type: 'scale', key, mode: 'major', hands: 'both', octaves: 2}),
    exerciseId({type: 'arpeggio', key, quality: 'major', hands: 'both', octaves: 2}),
    exerciseId({type: 'scale', key: minor, mode: 'harmonic-minor', hands: 'both', octaves: 2}),
    exerciseId({type: 'progression', key, mode: 'major', progression: 'I-IV-V-I'}),
  ];
  return {key, minor, items: ids.map(id => ({id, title: exerciseTitleFor(id)}))};
}

/** Preset exercises for the builder, grouped. */
export function listPresets() {
  const group = (title, list) => ({title, items: list.map(params => {
    const id = exerciseId(params);
    return {id, title: exerciseTitleFor(id), type: params.type};
  })});
  return [
    group('First steps', [
      {type: 'five-finger', key: 'C', quality: 'major', hands: 'both'},
      {type: 'scale', key: 'C', mode: 'major', hands: 'right', octaves: 1},
      {type: 'scale', key: 'C', mode: 'major', hands: 'left', octaves: 1},
      {type: 'progression', key: 'C', mode: 'major', progression: 'I-IV-V-I'},
    ]),
    group('Building up', [
      {type: 'scale', key: 'G', mode: 'major', hands: 'both', octaves: 2},
      {type: 'scale', key: 'A', mode: 'harmonic-minor', hands: 'both', octaves: 2},
      {type: 'arpeggio', key: 'C', quality: 'major', hands: 'both', octaves: 2},
      {type: 'progression', key: 'G', mode: 'major', progression: 'I-vi-IV-V'},
    ]),
    group('Stretch', [
      {type: 'scale', key: 'B', mode: 'major', hands: 'both', octaves: 4},
      {type: 'scale', key: 'Fs', mode: 'melodic-minor', hands: 'both', octaves: 2},
      {type: 'arpeggio', key: 'Db', quality: 'major', hands: 'both', octaves: 3},
      {type: 'chromatic', key: 'C', hands: 'both', octaves: 2},
    ]),
  ];
}

export {MAJOR_KEYS, MINOR_KEYS};
