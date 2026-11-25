// Collections document: favourites and the student's own collections (setlists), shared by the
// dev-server store (src/collections/plugin.js) and the browser (src/collections/store.js).
// Pure functions, no DOM or Node APIs.
//
// doc = {
//   version: 1,
//   favourites: ['<piece id>', ...],                 newest first, no duplicates
//   collections: [{id: 'c-<8–24 chars>', name, items: ['<piece id>', ...], createdAt, updatedAt}, ...],
//   updatedAt,                                       ms; the newer document wins when two disagree
// }
// A collection is ordered: "Play setlist" plays its items in this order. Piece ids are whatever
// the library uses (catalog ids, "import:…", "mutopia:…", "ex:…", "sr:…").
//
// Smart collections (by grade, period, composer) are not stored: smartCollections(entries)
// derives them from the catalog.

export const VERSION = 1;
export const MAX_COLLECTIONS = 100;
export const MAX_ITEMS = 500;
export const MAX_FAVOURITES = 2000;
export const MAX_NAME = 80;
export const MAX_BYTES = 256 * 1024;
const PIECE_RE = /^[A-Za-z0-9][A-Za-z0-9:._~%+@-]{0,199}$/;
const COLLECTION_RE = /^c-[A-Za-z0-9_-]{4,24}$/;
const MIN_AT = Date.UTC(2020, 0, 1);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isPieceId = v => typeof v === 'string' && PIECE_RE.test(v);
export const isCollectionId = v => typeof v === 'string' && COLLECTION_RE.test(v);
const time = (v, fallback) => (Number.isFinite(v) && v >= MIN_AT && v < 4e12 ? Math.round(v) : fallback);

/** Trims, collapses spaces and drops control characters; '' when nothing is left. */
export function cleanName(v) {
  if (typeof v !== 'string') return '';
  const visible = [...v].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
  return visible.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

const uniqueIds = (list, max) => {
  const out = [], seen = new Set();
  for (const id of Array.isArray(list) ? list : []) {
    if (!isPieceId(id) || seen.has(id)) continue;
    seen.add(id); out.push(id);
    if (out.length >= max) break;
  }
  return out;
};

export const emptyDoc = (now = 0) => ({version: VERSION, favourites: [], collections: [], updatedAt: now});

/** Any input → a valid document (invalid parts are dropped, never thrown). */
export function normalizeDoc(input, now = Date.now()) {
  const src = isObj(input) ? input : {};
  const doc = emptyDoc(time(src.updatedAt, 0));
  doc.favourites = uniqueIds(src.favourites, MAX_FAVOURITES);
  const ids = new Set();
  for (const c of Array.isArray(src.collections) ? src.collections : []) {
    if (!isObj(c) || !isCollectionId(c.id) || ids.has(c.id)) continue;
    const name = cleanName(c.name);
    if (!name) continue;
    ids.add(c.id);
    const createdAt = time(c.createdAt, now);
    doc.collections.push({id: c.id, name, items: uniqueIds(c.items, MAX_ITEMS), createdAt, updatedAt: time(c.updatedAt, createdAt)});
    if (doc.collections.length >= MAX_COLLECTIONS) break;
  }
  return doc;
}

/** Strict check for documents arriving over HTTP or in a backup. → normalized doc; throws Error(message). */
export function validateDoc(input) {
  if (!isObj(input)) throw Error('expected a collections document (a JSON object)');
  if (input.version != null && input.version !== VERSION) throw Error(`collections version ${input.version} is not supported`);
  const size = JSON.stringify(input).length;
  if (size > MAX_BYTES) throw Error('the collections document is too large');
  if (input.favourites != null && !Array.isArray(input.favourites)) throw Error('favourites must be a list');
  if (input.collections != null && !Array.isArray(input.collections)) throw Error('collections must be a list');
  if ((input.collections?.length ?? 0) > MAX_COLLECTIONS) throw Error(`at most ${MAX_COLLECTIONS} collections`);
  for (const c of input.collections ?? []) {
    if (!isObj(c) || !isCollectionId(c.id)) throw Error('a collection has a missing or malformed id');
    if (!cleanName(c.name)) throw Error('a collection has no name');
    if (c.items != null && !Array.isArray(c.items)) throw Error(`“${cleanName(c.name)}”: items must be a list`);
    if ((c.items?.length ?? 0) > MAX_ITEMS) throw Error(`“${cleanName(c.name)}” has more than ${MAX_ITEMS} pieces`);
  }
  return normalizeDoc(input);
}

// ───────── operations: each returns a new document (the input is not changed) ─────────

const touch = (doc, now) => ({...doc, updatedAt: Math.max(now, (doc.updatedAt || 0) + 1)});
const mapCollection = (doc, id, fn, now) => {
  let hit = false;
  const collections = doc.collections.map(c => {
    if (c.id !== id) return c;
    hit = true;
    return {...fn(c), updatedAt: now};
  });
  return hit ? touch({...doc, collections}, now) : doc;
};

export const isFavourite = (doc, pieceId) => doc.favourites.includes(pieceId);

export function setFavourite(doc, pieceId, on, now = Date.now()) {
  if (!isPieceId(pieceId) || on === isFavourite(doc, pieceId)) return doc;
  const favourites = on ? [pieceId, ...doc.favourites].slice(0, MAX_FAVOURITES) : doc.favourites.filter(id => id !== pieceId);
  return touch({...doc, favourites}, now);
}

export function newCollectionId(rand = Math.random) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += abc[Math.floor(rand() * abc.length)];
  return 'c-' + s;
}

/** → {doc, collection} (collection null when the name is empty or the limit is reached). */
export function createCollection(doc, name, {items = [], now = Date.now(), id = newCollectionId()} = {}) {
  const clean = cleanName(name);
  if (!clean || doc.collections.length >= MAX_COLLECTIONS || !isCollectionId(id) || doc.collections.some(c => c.id === id)) return {doc, collection: null};
  const collection = {id, name: clean, items: uniqueIds(items, MAX_ITEMS), createdAt: now, updatedAt: now};
  return {doc: touch({...doc, collections: [...doc.collections, collection]}, now), collection};
}

export function renameCollection(doc, id, name, now = Date.now()) {
  const clean = cleanName(name);
  if (!clean) return doc;
  return mapCollection(doc, id, c => ({...c, name: clean}), now);
}

export function deleteCollection(doc, id, now = Date.now()) {
  if (!doc.collections.some(c => c.id === id)) return doc;
  return touch({...doc, collections: doc.collections.filter(c => c.id !== id)}, now);
}

export function addToCollection(doc, id, pieceId, now = Date.now()) {
  const c = doc.collections.find(x => x.id === id);
  if (!c || !isPieceId(pieceId) || c.items.includes(pieceId) || c.items.length >= MAX_ITEMS) return doc;
  return mapCollection(doc, id, x => ({...x, items: [...x.items, pieceId]}), now);
}

export function removeFromCollection(doc, id, pieceId, now = Date.now()) {
  const c = doc.collections.find(x => x.id === id);
  if (!c || !c.items.includes(pieceId)) return doc;
  return mapCollection(doc, id, x => ({...x, items: x.items.filter(p => p !== pieceId)}), now);
}

/** Moves the item at `from` to index `to` (clamped). */
export function moveItem(doc, id, from, to, now = Date.now()) {
  const c = doc.collections.find(x => x.id === id);
  if (!c || from < 0 || from >= c.items.length) return doc;
  to = Math.max(0, Math.min(c.items.length - 1, to));
  if (from === to) return doc;
  const items = [...c.items];
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  return mapCollection(doc, id, x => ({...x, items}), now);
}

/** Moves a whole collection within the list (the order Pieces shows them in). */
export function moveCollection(doc, id, to, now = Date.now()) {
  const from = doc.collections.findIndex(c => c.id === id);
  if (from < 0) return doc;
  to = Math.max(0, Math.min(doc.collections.length - 1, to));
  if (from === to) return doc;
  const collections = [...doc.collections];
  const [c] = collections.splice(from, 1);
  collections.splice(to, 0, c);
  return touch({...doc, collections}, now);
}

/** Which collections hold a piece. */
export const collectionsWith = (doc, pieceId) => doc.collections.filter(c => c.items.includes(pieceId));

/** The newer of two documents (ties keep `a`). */
export const newer = (a, b) => ((b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a);

// ───────── periods and smart collections ─────────

export const PERIODS = ['Baroque', 'Classical', 'Romantic', 'Modern'];

// Composer surname (accents folded) → period. Composers who straddle two periods are filed where
// most of their teaching repertoire sits (Beethoven: Classical; Czerny: Romantic).
const PERIOD_BY_NAME = {
  Baroque: ['bach', 'petzold', 'handel', 'telemann', 'scarlatti', 'couperin', 'rameau', 'purcell', 'vivaldi', 'pachelbel', 'graupner', 'krieger', 'bohm', 'buxtehude', 'frescobaldi', 'zipoli', 'mattheson', 'stolzel', 'hasse'],
  Classical: ['mozart', 'haydn', 'clementi', 'kuhlau', 'beethoven', 'diabelli', 'dussek', 'hummel', 'turk', 'gluck', 'cimarosa', 'salieri', 'boccherini', 'latour', 'attwood', 'hook', 'pleyel', 'wanhal', 'vanhal', 'andre', 'muller'],
  Romantic: ['schumann', 'chopin', 'tchaikovsky', 'burgmuller', 'grieg', 'czerny', 'mendelssohn', 'schubert', 'liszt', 'brahms', 'gurlitt', 'heller', 'streabbog', 'lemoine', 'duvernoy', 'kohler', 'reinecke', 'dvorak', 'field', 'gade', 'rebikov', 'gretchaninov', 'franck', 'faure', 'mussorgsky', 'rachmaninoff', 'rachmaninov', 'scriabin', 'elgar', 'albeniz', 'granados', 'chaminade', 'beach', 'lyadov', 'liadov', 'kullak', 'spindler', 'concone', 'bertini', 'loeschhorn', 'schytte', 'ellmenreich', 'lichner', 'hunten', 'pierpont'],
  Modern: ['satie', 'debussy', 'ravel', 'bartok', 'kabalevsky', 'prokofiev', 'shostakovich', 'khachaturian', 'joplin', 'poulenc', 'milhaud', 'stravinsky', 'gershwin', 'copland', 'tansman', 'kurtag', 'glass', 'schoenberg', 'hindemith', 'ibert', 'villa-lobos', 'mompou', 'janacek', 'sibelius', 'nielsen', 'scott'],
};
const PERIOD_OF = new Map(Object.entries(PERIOD_BY_NAME).flatMap(([p, names]) => names.map(n => [n, p])));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Johann Sebastian Bach (Notebook for Anna Magdalena Bach)" → "Baroque"; null when unknown or traditional. */
export function periodOf(composer) {
  const name = fold(composer).replace(/\(.*?\)/g, ' ').replace(/[^a-z\s-]/g, ' ').trim();
  if (!name) return null;
  const words = name.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const p = PERIOD_OF.get(words[i]);
    if (p) return p;
  }
  return null;
}

/** The surname a composer is filed under ("Christian Petzold (attr.)" → "Petzold"). */
export function composerKey(composer) {
  const name = String(composer || '').replace(/\(.*?\)/g, '').trim();
  return name || 'Anonymous';
}

/**
 * Collections derived from the library: by grade, by period, by composer.
 * → [{id: 'smart:grade:2' | 'smart:period:Baroque' | 'smart:composer:<name>', kind, value, name, items: [ids]}]
 * Only groups with at least one piece; composers with two or more.
 */
export function smartCollections(entries) {
  const out = [];
  const group = (kind, keyOf, label, min = 1) => {
    const map = new Map();
    for (const e of entries) {
      const k = keyOf(e);
      if (k == null || k === '') continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e.id);
    }
    const keys = [...map.keys()].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b
      : kind === 'period' ? PERIODS.indexOf(a) - PERIODS.indexOf(b) : String(a).localeCompare(String(b))));
    for (const k of keys) if (map.get(k).length >= min) out.push({id: `smart:${kind}:${k}`, kind, value: k, name: label(k), items: map.get(k)});
  };
  group('grade', e => (Number.isInteger(e.grade) ? e.grade : null), g => (g === 0 ? 'Beginner' : `Grade ${g}`));
  group('period', e => e.period || periodOf(e.composer), p => p);
  group('composer', e => (e.composer && !/^(traditional|anon)/i.test(e.composer) ? composerKey(e.composer) : null), c => c, 2);
  return out;
}

// ───────── filters (Pieces' filter row) ─────────

export const STATUS_FILTERS = ['learning', 'secure', 'polished', 'maintained'];

/** Any stored value → {grade: 0–5 | null, period: name | null, composer: name | null, status: id | null, fav: bool}. */
export function normalizeFilters(v) {
  const f = isObj(v) ? v : {};
  return {
    grade: Number.isInteger(f.grade) && f.grade >= 0 && f.grade <= 8 ? f.grade : null,
    period: PERIODS.includes(f.period) ? f.period : null,
    composer: typeof f.composer === 'string' && f.composer.trim() ? f.composer.trim().slice(0, 120) : null,
    status: STATUS_FILTERS.includes(f.status) ? f.status : null,
    fav: f.fav === true,
  };
}

export const anyFilter = f => f.grade != null || f.period != null || f.composer != null || f.status != null || f.fav;

/** A predicate over library entries. `statusOf(id)` and `favourite(id)` come from the caller. */
export function filterPredicate(f, {statusOf = () => null, favourite = () => false} = {}) {
  return e => (f.grade == null || e.grade === f.grade)
    && (f.period == null || (e.period || periodOf(e.composer)) === f.period)
    && (f.composer == null || composerKey(e.composer) === f.composer)
    && (f.status == null || statusOf(e.id) === f.status)
    && (!f.fav || favourite(e.id));
}
