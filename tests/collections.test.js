// Favourites, collections / setlists, periods, smart collections and filters (src/collections/),
// the dev-server store (src/collections/plugin.js) and collections in backups (backup/plugin.js).
import {createServer} from 'node:http';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';

import {
  addToCollection, anyFilter, cleanName, collectionsWith, composerKey, createCollection, deleteCollection, emptyDoc, filterPredicate,
  isFavourite, MAX_COLLECTIONS, moveCollection, moveItem, newer, normalizeDoc, normalizeFilters, periodOf, removeFromCollection,
  renameCollection, setFavourite, smartCollections, validateDoc,
} from '../src/collections/model.js';
import {collectionsHandler} from '../src/collections/plugin.js';
import {collectServer, restoreServer, validateServerPart, FORMAT} from '../backup/plugin.js';

const T = Date.UTC(2026, 5, 1);
const withC = (doc, name, items = [], id = 'c-' + name.toLowerCase().replace(/\W/g, '').padEnd(4, 'x').slice(0, 12)) => createCollection(doc, name, {items, now: T, id});

describe('collections model', () => {
  test('normalizeDoc keeps what is valid and drops the rest without throwing', () => {
    const doc = normalizeDoc({
      favourites: ['fur-elise', 'fur-elise', '../etc/passwd', 42, 'import:5f1c', 'ex:scale:C:major:both:2:up-down'],
      collections: [
        {id: 'c-recital1', name: '  Grade 2\n recital ', items: ['a', 'a', 'b', '<x>'], createdAt: T},
        {id: 'c-recital1', name: 'duplicate id', items: []},
        {id: 'nope', name: 'bad id'},
        {id: 'c-noname1', name: '   '},
      ],
      updatedAt: T,
    }, T);
    expect(doc.favourites).toEqual(['fur-elise', 'import:5f1c', 'ex:scale:C:major:both:2:up-down']);
    expect(doc.collections).toEqual([{id: 'c-recital1', name: 'Grade 2 recital', items: ['a', 'b'], createdAt: T, updatedAt: T}]);
    expect(normalizeDoc(null)).toEqual(emptyDoc());
    expect(normalizeDoc('junk').collections).toEqual([]);
  });

  test('validateDoc rejects malformed documents with a reason', () => {
    expect(() => validateDoc([])).toThrow(/object/);
    expect(() => validateDoc({version: 9})).toThrow(/version/);
    expect(() => validateDoc({favourites: 'x'})).toThrow(/favourites/);
    expect(() => validateDoc({collections: [{id: 'bad', name: 'x'}]})).toThrow(/id/);
    expect(() => validateDoc({collections: [{id: 'c-abcd1', name: ''}]})).toThrow(/no name/);
    expect(() => validateDoc({collections: Array.from({length: MAX_COLLECTIONS + 1}, (_, i) => ({id: `c-x${String(i).padStart(4, '0')}`, name: 'n'}))})).toThrow(/at most/);
    expect(() => validateDoc({favourites: Array.from({length: 20000}, (_, i) => 'piece-' + i)})).toThrow(/too large/);
    expect(validateDoc({favourites: ['a'], collections: [], updatedAt: T})).toEqual({version: 1, favourites: ['a'], collections: [], updatedAt: T});
  });

  test('cleanName trims, collapses and caps names', () => {
    expect(cleanName('  Bach \t\u0007 pieces ')).toBe('Bach pieces');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
    expect(cleanName(null)).toBe('');
  });

  test('favourites: add (newest first), remove, no-ops return the same document', () => {
    let doc = emptyDoc();
    doc = setFavourite(doc, 'a', true, T);
    doc = setFavourite(doc, 'b', true, T + 1);
    expect(doc.favourites).toEqual(['b', 'a']);
    expect(isFavourite(doc, 'a')).toBe(true);
    expect(setFavourite(doc, 'a', true, T + 2)).toBe(doc);
    expect(setFavourite(doc, 'bad id!', true)).toBe(doc);
    doc = setFavourite(doc, 'a', false, T + 3);
    expect(doc.favourites).toEqual(['b']);
    expect(doc.updatedAt).toBe(T + 3);
  });

  test('create, rename, add, reorder, remove and delete a collection; the input is never changed', () => {
    const start = emptyDoc();
    const {doc: d1, collection} = withC(start, 'Grade 2 recital', ['minuet-in-g']);
    expect(start.collections).toEqual([]);
    expect(collection).toMatchObject({name: 'Grade 2 recital', items: ['minuet-in-g']});
    let doc = renameCollection(d1, collection.id, '  Spring recital ', T + 1);
    expect(doc.collections[0].name).toBe('Spring recital');
    expect(renameCollection(doc, collection.id, '   ')).toBe(doc);
    doc = addToCollection(doc, collection.id, 'fur-elise', T + 2);
    doc = addToCollection(doc, collection.id, 'satie-gymnopedie-1', T + 3);
    expect(addToCollection(doc, collection.id, 'fur-elise')).toBe(doc); // already in it
    expect(doc.collections[0].items).toEqual(['minuet-in-g', 'fur-elise', 'satie-gymnopedie-1']);
    doc = moveItem(doc, collection.id, 2, 0, T + 4);
    expect(doc.collections[0].items).toEqual(['satie-gymnopedie-1', 'minuet-in-g', 'fur-elise']);
    doc = moveItem(doc, collection.id, 0, 99, T + 5); // clamped to the end
    expect(doc.collections[0].items).toEqual(['minuet-in-g', 'fur-elise', 'satie-gymnopedie-1']);
    expect(moveItem(doc, collection.id, 1, 1)).toBe(doc);
    expect(collectionsWith(doc, 'fur-elise').map(c => c.id)).toEqual([collection.id]);
    doc = removeFromCollection(doc, collection.id, 'fur-elise', T + 6);
    expect(doc.collections[0].items).toEqual(['minuet-in-g', 'satie-gymnopedie-1']);
    expect(doc.collections[0].updatedAt).toBe(T + 6);
    doc = deleteCollection(doc, collection.id, T + 7);
    expect(doc.collections).toEqual([]);
    expect(doc.updatedAt).toBe(T + 7);
  });

  test('collections can be reordered; names must not be empty; ids are unique', () => {
    let doc = emptyDoc();
    doc = withC(doc, 'Bach').doc;
    doc = withC(doc, 'Recital').doc;
    doc = withC(doc, 'Warm-ups').doc;
    expect(withC(doc, '   ').collection).toBeNull();
    expect(createCollection(doc, 'Again', {id: doc.collections[0].id}).collection).toBeNull();
    doc = moveCollection(doc, doc.collections[2].id, 0, T + 9);
    expect(doc.collections.map(c => c.name)).toEqual(['Warm-ups', 'Bach', 'Recital']);
  });

  test('updatedAt always moves forward, and newer() picks the later document', () => {
    const a = {...emptyDoc(), updatedAt: T + 100};
    const b = setFavourite(a, 'x', true, T); // a clock behind the document's own time
    expect(b.updatedAt).toBe(T + 101);
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
  });
});

describe('periods, smart collections and filters', () => {
  test('periodOf files composers by surname (accents, attributions and notes ignored)', () => {
    expect(periodOf('Johann Sebastian Bach (Notebook for Anna Magdalena Bach)')).toBe('Baroque');
    expect(periodOf('Christian Petzold (attr.)')).toBe('Baroque');
    expect(periodOf('Wolfgang Amadeus Mozart')).toBe('Classical');
    expect(periodOf('Ludwig van Beethoven')).toBe('Classical');
    expect(periodOf('Friedrich Burgmüller')).toBe('Romantic');
    expect(periodOf('Pyotr Ilyich Tchaikovsky')).toBe('Romantic');
    expect(periodOf('Erik Satie')).toBe('Modern');
    expect(periodOf('Béla Bartók')).toBe('Modern');
    expect(periodOf('Traditional')).toBeNull();
    expect(periodOf('')).toBeNull();
    expect(composerKey('Christian Petzold (attr.)')).toBe('Christian Petzold');
  });

  test('every bundled piece has a period that matches its composer', () => {
    const {songs} = JSON.parse(readFileSync('public/songs/catalog.json', 'utf8'));
    for (const s of songs) {
      expect(s.period ?? null, s.id).toBe(periodOf(s.composer));
      if (s.composer !== 'Traditional') expect(['Baroque', 'Classical', 'Romantic', 'Modern'], s.id).toContain(s.period);
    }
  });

  const entries = [
    {id: 'a', composer: 'Johann Sebastian Bach', grade: 1},
    {id: 'b', composer: 'Johann Sebastian Bach (Notebook for Anna Magdalena Bach)', grade: 2},
    {id: 'c', composer: 'Robert Schumann', grade: 2},
    {id: 'd', composer: 'Traditional', grade: 0},
    {id: 'e', composer: 'Erik Satie', grade: 4, period: 'Modern'},
  ];

  test('smart collections by grade, by period and by composer (two or more pieces)', () => {
    const smart = smartCollections(entries);
    const byKind = k => smart.filter(s => s.kind === k).map(s => [s.name, s.items]);
    expect(byKind('grade')).toEqual([['Beginner', ['d']], ['Grade 1', ['a']], ['Grade 2', ['b', 'c']], ['Grade 4', ['e']]]);
    expect(byKind('period')).toEqual([['Baroque', ['a', 'b']], ['Romantic', ['c']], ['Modern', ['e']]]);
    expect(byKind('composer')).toEqual([['Johann Sebastian Bach', ['a', 'b']]]);
  });

  test('filters combine, and normalizeFilters cleans what was stored', () => {
    expect(normalizeFilters({grade: '2', period: 'Rococo', composer: '  ', status: 'secure', fav: 'yes'})).toEqual({grade: null, period: null, composer: null, status: 'secure', fav: false});
    expect(anyFilter(normalizeFilters({}))).toBe(false);
    const statusOf = id => ({a: 'learning', c: 'polished'})[id] ?? null;
    const favourite = id => id === 'b' || id === 'c';
    const pick = f => entries.filter(filterPredicate(normalizeFilters(f), {statusOf, favourite})).map(e => e.id);
    expect(pick({grade: 2})).toEqual(['b', 'c']);
    expect(pick({period: 'Baroque'})).toEqual(['a', 'b']);
    expect(pick({composer: 'Johann Sebastian Bach'})).toEqual(['a', 'b']);
    expect(pick({status: 'polished'})).toEqual(['c']);
    expect(pick({fav: true})).toEqual(['b', 'c']);
    expect(pick({grade: 2, period: 'Romantic', fav: true})).toEqual(['c']);
    expect(pick({grade: 2, status: 'learning'})).toEqual([]);
  });
});

// ───────── the dev-server store ─────────

let server;
afterEach(() => server?.close());
async function serve(dir) {
  const handler = collectionsHandler(dir);
  server = createServer((req, res) => {
    const next = () => { res.statusCode = 404; res.end('next'); };
    if (req.url.startsWith('/__collections')) { req.url = req.url.slice('/__collections'.length) || '/'; return handler(req, res, next); }
    next();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}/__collections`;
}
const temp = () => mkdtempSync(join(tmpdir(), 'collections-'));
const put = (url, body, type = 'application/json') => fetch(url, {method: 'PUT', headers: {'content-type': type}, body: typeof body === 'string' ? body : JSON.stringify(body)});

describe('collections store (dev server)', () => {
  test('GET on a fresh install is an empty document; nothing is written', async () => {
    const dir = temp(), url = await serve(dir);
    expect(await (await fetch(url)).json()).toEqual({store: 'disk', ...emptyDoc()});
    expect(existsSync(join(dir, 'collections.json'))).toBe(false);
  });

  test('PUT stores a validated document; a stale PUT gets the newer one back (409)', async () => {
    const dir = temp(), url = await serve(dir);
    const {doc} = withC(setFavourite(emptyDoc(), 'fur-elise', true, T), 'Recital', ['minuet-in-g']);
    const res = await put(url, doc);
    expect(res.status).toBe(200);
    expect((await res.json()).doc).toEqual(doc);
    expect(JSON.parse(readFileSync(join(dir, 'collections.json'), 'utf8'))).toEqual(doc);
    const older = {...emptyDoc(), updatedAt: T - 5};
    const stale = await put(url, older);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ok: false, stale: true, doc: {favourites: ['fur-elise']}});
    expect(JSON.parse(readFileSync(join(dir, 'collections.json'), 'utf8')).favourites).toEqual(['fur-elise']);
  });

  test('rejects what is not a collections document', async () => {
    const dir = temp(), url = await serve(dir);
    expect((await put(url, 'not json')).status).toBe(400);
    expect((await put(url, {collections: [{id: '../x', name: 'n'}]})).status).toBe(400);
    expect((await put(url, {}, 'text/plain')).status).toBe(415);
    expect((await put(url, 'x'.repeat(400 * 1024))).status).toBe(413);
    expect(existsSync(join(dir, 'collections.json'))).toBe(false);
    expect((await fetch(url + '/other')).status).toBe(404); // not ours: next()
  });
});

describe('collections in backups', () => {
  test('collections.json travels with the other .data files and is validated on restore', () => {
    const root = mkdtempSync(join(tmpdir(), 'pp-coll-backup-'));
    try {
      const dirs = {dataDir: join(root, 'data'), teacherDir: join(root, 'teacher'), songsDir: join(root, 'imports'), recordingsDir: join(root, 'recordings')};
      mkdirSync(dirs.dataDir, {recursive: true});
      const doc = withC(setFavourite(emptyDoc(), 'fur-elise', true, T), 'Bach', ['bach-invention-1']).doc;
      writeFileSync(join(dirs.dataDir, 'collections.json'), JSON.stringify(doc));
      const b = collectServer(dirs);
      expect(b.server.data['collections.json']).toEqual(doc);
      expect(validateServerPart(b).summary).toMatchObject({collections: 1, favourites: 1});
      // Restoring into an empty Mac brings them back.
      const fresh = {dataDir: join(root, 'd2'), teacherDir: join(root, 't2'), songsDir: join(root, 'i2'), recordingsDir: join(root, 'r2')};
      restoreServer(JSON.parse(JSON.stringify(b)), fresh);
      expect(JSON.parse(readFileSync(join(fresh.dataDir, 'collections.json'), 'utf8'))).toEqual(doc);
      // A damaged collections file stops the restore before anything is written.
      const bad = JSON.parse(JSON.stringify(b));
      bad.server.data['collections.json'] = {collections: [{id: '../../x', name: 'evil'}]};
      expect(() => validateServerPart(bad)).toThrow(/collections\.json/);
      expect(() => validateServerPart({format: FORMAT, version: 1, server: {data: {'collections.json': 'nope'}}})).toThrow(/collections\.json/);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});
