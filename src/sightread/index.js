// Sight-reading ids ↔ generated pieces.
//
//   sr:<level>:<seed>     level = a src/sightread/levels.js id (beginner, grade-1 … grade-5),
//                         seed  = a positive integer; the same id always gives the same piece.
//
// resolveSightReading(id) → {entry, source: {data}} for src/app/catalog.js resolveEntry. The entry
// carries `mode: 'timed'` and `intent: 'practice'`: sight-reading opens in Play along with a bar of count-in.
import {generateSightReading} from './generate.js';
import {SR_LEVELS, srLevelById} from './levels.js';
import {newSeed} from '../theory/music.js';

export {SR_LEVELS, srLevelById, generateSightReading};
export const isSightReadingId = id => typeof id === 'string' && id.startsWith('sr:');
const DIFFICULTY = {beginner: 'beginner', 'grade-1': 'beginner', 'grade-2': 'easy', 'grade-3': 'easy', 'grade-4': 'intermediate', 'grade-5': 'intermediate'};

export function parseSightReadingId(id) {
  const m = /^sr:([a-z0-9-]+):(\d{1,10})$/.exec(String(id || ''));
  if (!m || !srLevelById(m[1])) return null;
  const seed = +m[2];
  return seed > 0 && seed < 2 ** 31 ? {level: m[1], seed} : null;
}
export const sightReadingId = (level, seed = newSeed()) => `sr:${level}:${seed}`;

/** 'sr:…' → {entry, source} or null for an invalid id. */
export function resolveSightReading(id) {
  const p = parseSightReadingId(id);
  if (!p) return null;
  const g = generateSightReading(p.level, p.seed);
  const level = srLevelById(p.level);
  return {
    entry: {id, title: g.title, composer: `Sight-reading · ${level.name}`, difficulty: DIFFICULTY[p.level], grade: level.grade,
      tempo: g.tempo, section: [0, g.bars - 1], mode: 'timed', intent: 'practice', kind: 'exercise'},
    source: {data: g.musicxml},
  };
}

/** Just the title (e.g. for a "recently read" list), or null for an invalid id. */
export function sightReadingTitle(id) {
  const p = parseSightReadingId(id);
  if (!p) return null;
  try { return generateSightReading(p.level, p.seed).title; } catch { return null; }
}
