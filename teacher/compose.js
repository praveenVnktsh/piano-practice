// Composes a teacher exercise from `.notes` text (CLI only; see ./exercises.js for the storage).
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseNotes, toMusicXML} from '../tools/notes2musicxml.mjs';
import {MAX_EXERCISES, readDoc, writeDoc} from './exercises.js';

export const MAX_NOTES_BYTES = 32 * 1024;

/**
 * Composes an exercise from `.notes` text → the stored exercise. The title (and composer
 * "Your teacher") are set in the score; `songId` + `first`/`last` (0-based) say which bars of
 * which piece it prepares. Throws with the converter's message when the notes don't parse.
 */
export function addExercise(dir, {title, notes, about, songId, first, last} = {}) {
  const name = typeof title === 'string' ? title.trim() : '';
  if (!name || name.length > 80) throw new Error('an exercise needs a title (≤ 80 characters)');
  if (typeof notes !== 'string' || !notes.trim()) throw new Error('an exercise needs notes (the .notes format, see songs/README.md)');
  if (Buffer.byteLength(notes) > MAX_NOTES_BYTES) throw new Error('the notes are too long for an exercise');
  const why = typeof about === 'string' ? about.trim() : '';
  if (why.length > 300) throw new Error('--about is at most 300 characters');
  if (songId != null && (typeof songId !== 'string' || !/^\S{1,200}$/.test(songId))) throw new Error('--song must be a song id');
  if (first != null && !(Number.isInteger(first) && first >= 0 && Number.isInteger(last) && last >= first))
    throw new Error('--bars must be like 5-8 (bar numbers from 1)');
  // A header without '---' is music only: give it one.
  const text = /^---\s*$/m.test(notes) ? notes : `---\n${notes}`;
  const parsed = parseNotes(text, 'exercise');
  parsed.meta.title = name;
  parsed.meta.composer = 'Your teacher';
  const xml = toMusicXML(parsed, 'exercise');
  const doc = readDoc(dir);
  if (doc.exercises.length >= MAX_EXERCISES) throw new Error(`there are already ${MAX_EXERCISES} exercises; remove some first`);
  const id = Math.max(doc.lastId, 0, ...doc.exercises.map(e => e.id)) + 1;
  mkdirSync(join(dir, 'exercises'), {recursive: true});
  writeFileSync(join(dir, 'exercises', `${id}.musicxml`), xml);
  const ex = {
    id, at: new Date().toISOString(), title: name,
    ...(why ? {about: why} : {}),
    ...(songId ? {songId} : {}),
    ...(first != null ? {first, last} : {}),
  };
  writeDoc(dir, {lastId: id, exercises: [...doc.exercises, ex]});
  return ex;
}

