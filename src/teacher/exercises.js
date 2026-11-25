// Exercises the teacher composed (teacher/exercises.js, `node teacher/cli.js exercise …`), served by
// the dev server. Ids are `tex:<n>`; src/app/catalog.js resolves them here. Without the dev server
// there are none.
import {onMac} from '../app/mac.js';

const API = '/__teacher';

/** The teacher's exercises → [{id: 'tex:<n>', title, about?, songId?, first?, last?, at}] ([] without a teacher). */
export async function teacherExercises({api = API} = {}) {
  if (!onMac()) return [];
  try {
    const res = await fetch(`${api}/exercises`, {cache: 'no-store'});
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return [];
    const data = await res.json();
    return (Array.isArray(data?.exercises) ? data.exercises : [])
      .filter(e => Number.isInteger(e?.id) && typeof e.title === 'string')
      .map(e => ({...e, id: `tex:${e.id}`}))
      .reverse(); // newest first
  } catch {
    return [];
  }
}

export const isTeacherExercise = id => /^tex:\d{1,9}$/.test(String(id));

/** `tex:<n>` → {entry, source} for the player, or null when there is no such exercise. */
export async function resolveTeacherExercise(id, {api = API} = {}) {
  if (!isTeacherExercise(id)) return null;
  const ex = (await teacherExercises({api})).find(e => e.id === id);
  if (!ex) return null;
  const source = {url: `${api}/exercises/${id.slice(4)}.musicxml`};
  const entry = {id, title: ex.title, composer: 'From your teacher', kind: 'exercise', source, teacher: true};
  return {entry, source};
}
