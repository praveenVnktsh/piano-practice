// Exercises the teacher composes (docs/ROADMAP.md, Phase 14 P2): a few bars in the `.notes` format
// (songs/README.md) turned into MusicXML by tools/notes2musicxml.mjs and kept in the teacher's dir:
//   exercises.json        {lastId, exercises: [{id, at, title, about?, songId?, first?, last?}]}
//   exercises/<id>.musicxml
// Composing (addExercise) lives in ./compose.js: it needs the converter, which the dev-server
// plugin (bundled into vite.config.js) must not import.
// The app lists them under Exercises → "From your teacher" and opens them as `tex:<id>`.
import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const MAX_EXERCISES = 100;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function readDoc(dir) {
  try {
    const json = JSON.parse(readFileSync(join(dir, 'exercises.json'), 'utf8'));
    const list = Array.isArray(json?.exercises) ? json.exercises.filter(e => isObj(e) && Number.isInteger(e.id)) : [];
    return {lastId: Number.isInteger(json?.lastId) ? json.lastId : 0, exercises: list};
  } catch {
    return {lastId: 0, exercises: []};
  }
}
export function writeDoc(dir, doc) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `exercises.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n');
  renameSync(tmp, join(dir, 'exercises.json'));
}

export const readExercises = dir => readDoc(dir).exercises;

/** The MusicXML of exercise `id`, or null. */
export function readExerciseScore(dir, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || !readExercises(dir).some(e => e.id === n)) return null;
  try {
    return readFileSync(join(dir, 'exercises', `${n}.musicxml`), 'utf8');
  } catch {
    return null;
  }
}

/** Removes an exercise (and its score) → the removed exercise. */
export function removeExercise(dir, id) {
  const n = Number(id);
  const doc = readDoc(dir);
  const ex = doc.exercises.find(e => e.id === n);
  if (!ex) throw new Error(`no exercise ${id}`);
  writeDoc(dir, {lastId: Math.max(doc.lastId, n), exercises: doc.exercises.filter(e => e !== ex)});
  rmSync(join(dir, 'exercises', `${n}.musicxml`), {force: true});
  return ex;
}
