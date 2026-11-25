// Bundled + local song catalogs (public/songs/catalog.json, public/songs/local/catalog.json),
// plus generated technique exercises ("ex:…" ids, src/exercises/index.js).
import {isExerciseId, resolveExercise} from '../exercises/index.js';
import {PERIODS, periodOf} from '../collections/model.js';
import {isStaticOrigin} from './mac.js';

const BASE = import.meta.env.BASE_URL || '/';

async function fetchCatalog(path, optional) {
  try {
    const res = await fetch(BASE + path, {cache: 'no-cache'});
    if (!res.ok) throw Error(res.status + ' ' + res.statusText);
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) throw Error('not found'); // dev-server SPA fallback
    const json = await res.json();
    return (Array.isArray(json?.songs) ? json.songs : []).filter(s => s && s.id && s.file);
  } catch (e) {
    if (!optional) console.warn('Could not load ' + path + ':', e.message);
    return [];
  }
}

// `period` (Baroque | Classical | Romantic | Modern) is in the bundled catalog; other entries get it
// from the composer (src/collections/model.js periodOf) so Pieces can filter them too.
const withPeriod = e => (PERIODS.includes(e.period) ? e : {...e, period: periodOf(e.composer) || undefined});

/** → {bundled: entry[], local: entry[]}; each entry gets `kind` (and a `period` when the composer is known). */
export async function loadCatalogs() {
  const [bundled, local] = await Promise.all([
    fetchCatalog('songs/catalog.json', false),
    // Private songs are never published: the public site doesn't ask for them.
    isStaticOrigin() ? [] : fetchCatalog('songs/local/catalog.json', true),
  ]);
  return {
    bundled: bundled.map(e => withPeriod({...e, kind: 'bundled'})),
    local: local.map(e => withPeriod({...e, kind: 'local'})),
  };
}

/**
 * Entries that aren't in a catalog file: "ex:…" exercise ids are generated on demand.
 * → {entry (kind: 'exercise'), source: {data}} or null for unknown / invalid ids.
 */
export function resolveEntry(id) {
  // Unverified pieces from the Mutopia library, converted in the browser on demand.
  if (id.startsWith('mutopia:')) return import('../mutopia/convert.js').then(m => m.resolveMutopiaEntry(id));
  // Generated sight-reading pieces (src/sightread/): "sr:<level>:<seed>".
  if (id.startsWith('sr:')) return import('../sightread/index.js').then(m => m.resolveSightReading(id));
  // Exercises the teacher composed (dev server): "tex:<n>".
  if (id.startsWith('tex:')) return import('../teacher/exercises.js').then(m => m.resolveTeacherExercise(id));
  if (!isExerciseId(id)) return null;
  const r = resolveExercise(id);
  return r && {entry: {...r.entry, kind: 'exercise', source: r.source}, source: r.source};
}
export {resolveExercise, isExerciseId};

/** Song source for loadSong() from any library entry. */
export function songSource(entry) {
  if (entry.kind === 'exercise') return entry.source ?? resolveExercise(entry.id)?.source;
  // Imports saved on the Mac have a file (served from public/); browser-only ones carry their data.
  if (entry.kind === 'import' && !entry.file) return entry.mxlBase64 ? {mxlBase64: entry.mxlBase64} : {data: entry.data};
  return {url: entry.file};
}
