// The graded path, evaluated against progress. Pure (no DOM, no I/O).
//
//   curriculum(doc, {library, targets, now}) → {levels: [levelProgress], current, next}
//   levelProgress = {level, done, fraction, repertoire: {items, need, have, done},
//                    technique: {items, done}, reading: {items, done}}
//
// Completion criteria per level (all three must hold):
//   repertoire  `need` of the level's pieces that are in the library at secure or better
//               (src/progress/mastery.js); with fewer pieces available, all available ones;
//               with none available, the requirement doesn't block the level
//   technique   every exercise passed once at ≥ TECHNIQUE_ACCURACY % — a pass of the same
//               exercise in the same key counts when it covers at least as many octaves and
//               (for one-hand requirements) is hands together or that hand
//   reading     every listed note-reading level drilled at ≥ READING_ACCURACY % (≥ 10 notes)
import {LEVELS} from './data.js';
import {parseExerciseId} from '../exercises/index.js';
import {pieceMastery, statusRank} from '../progress/mastery.js';

export {LEVELS};
export const TECHNIQUE_ACCURACY = 90;
export const READING_ACCURACY = 90;
export const READING_MIN_NOTES = 10;

export const levelById = id => LEVELS.find(l => l.id === id) || null;
const LISTED = new Set(LEVELS.flatMap(l => l.repertoire.ids)); // pieces a level names explicitly

const sameKey = (a, b) => a.step === b.step && a.alter === b.alter;

/** Does a practised exercise (params) satisfy a required one? */
export function exerciseSatisfies(done, req) {
  if (!done || !req || done.type !== req.type || !sameKey(done.tonic, req.tonic)) return false;
  if (req.type === 'scale' && done.mode !== req.mode) return false;
  if ((req.type === 'arpeggio' || req.type === 'five-finger') && done.quality !== req.quality) return false;
  if (req.type === 'progression') return done.mode === req.mode && done.progression === req.progression;
  if ((done.octaves || 1) < (req.octaves || 1)) return false;
  if (req.hands === 'both') return done.hands === 'both';
  return done.hands === 'both' || done.hands === req.hands;
}

/** Best accuracy per exercise id practised (from totals, so pruned events still count). */
function exerciseBests(doc) {
  const out = [];
  for (const [id, s] of Object.entries(doc?.totals?.songs || {})) {
    if (!id.startsWith('ex:') || s.best == null) continue;
    const params = parseExerciseId(id);
    if (params) out.push({id, params, best: s.best});
  }
  return out;
}

/** Best accuracy per note-reading level (drills with enough notes). */
function readingBests(doc) {
  const out = {};
  for (const e of doc?.events || []) {
    if (e.type !== 'trainer:result' || typeof e.level !== 'string') continue;
    if ((e.right || 0) + (e.wrong || 0) < READING_MIN_NOTES) continue;
    out[e.level] = Math.max(out[e.level] ?? 0, e.accuracy);
  }
  return out;
}

/** Library entries (flat list or {bundled, local, imports}) → Map id → entry. */
function libraryMap(library) {
  const list = Array.isArray(library) ? library : library ? [...(library.bundled || []), ...(library.local || []), ...(library.imports || [])] : [];
  return new Map(list.filter(e => e && e.id).map(e => [e.id, e]));
}

export function evaluateLevel(level, doc, {library, targets = {}, now = Date.now(), _ex, _rd} = {}) {
  const lib = libraryMap(library);
  const ex = _ex || exerciseBests(doc), rd = _rd || readingBests(doc);
  // Repertoire: listed ids in the library, then any library piece tagged with this grade.
  const ids = [...level.repertoire.ids.filter(id => lib.has(id))];
  for (const [id, e] of lib) if (e.grade === level.grade && !ids.includes(id) && !LISTED.has(id)) ids.push(id);
  const pieces = ids.map(id => {
    const m = pieceMastery(doc, id, {target: targets[id] ?? lib.get(id)?.tempo, now});
    return {id, title: lib.get(id)?.title || id, composer: lib.get(id)?.composer || '', status: m.status, done: statusRank(m.status) >= statusRank('secure')};
  });
  const need = Math.min(level.repertoire.need, pieces.length);
  const have = pieces.filter(p => p.done).length;
  const technique = level.technique.map(t => {
    const req = parseExerciseId(t.id);
    const best = Math.max(-1, ...ex.filter(e => exerciseSatisfies(e.params, req)).map(e => e.best));
    return {id: t.id, label: t.label, best: best < 0 ? null : best, done: best >= TECHNIQUE_ACCURACY};
  });
  const reading = level.reading.map(id => ({id, best: rd[id] ?? null, done: (rd[id] ?? 0) >= READING_ACCURACY}));
  const rep = {items: pieces, need, have: Math.min(have, need), done: have >= need};
  const tech = {items: technique, done: technique.every(t => t.done)};
  const read = {items: reading, done: reading.every(r => r.done)};
  const total = need + technique.length + reading.length;
  const got = Math.min(have, need) + technique.filter(t => t.done).length + reading.filter(r => r.done).length;
  return {level, repertoire: rep, technique: tech, reading: read, done: rep.done && tech.done && read.done, fraction: total ? got / total : 1};
}

/**
 * The whole path. `current` = the first level not yet complete (the last one when all are);
 * `next` = suggestions from the current level: {technique, reading, piece} — the first unmet
 * item of each kind (null when met).
 */
export function curriculum(doc, opts = {}) {
  const ex = exerciseBests(doc), rd = readingBests(doc);
  const levels = LEVELS.map(l => evaluateLevel(l, doc, {...opts, _ex: ex, _rd: rd}));
  // settings.pathStart: the student (or teacher) chose to start at a later level.
  const from = Math.max(0, LEVELS.findIndex(l => l.id === (opts.start ?? doc?.settings?.pathStart)));
  levels.forEach((l, i) => { l.skipped = i < from && !l.done; });
  const current = levels.slice(from).find(l => !l.done) || levels.at(-1);
  const next = {
    technique: current.technique.items.find(t => !t.done) || null,
    reading: current.reading.items.find(r => !r.done) || null,
    piece: current.repertoire.done ? null : current.repertoire.items.find(p => !p.done) || null,
  };
  return {levels, current, next, start: LEVELS[from].id};
}
