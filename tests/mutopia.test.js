import {existsSync, readFileSync} from 'node:fs';
import {afterEach, describe, expect, test, vi} from 'vitest';

import {findPieces, headerFields, isSoloPiano, normaliseLicense} from '../tools/mutopia-index.mjs';
import {catalogEntry} from '../tools/build-repertoire.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('tools/mutopia-index.mjs', () => {
  test('accepts public domain and CC BY / BY-SA / CC0 licences only', () => {
    expect(normaliseLicense('Public Domain')).toBe('Public Domain');
    expect(normaliseLicense('Creative Commons Attribution-ShareAlike 3.0')).toBe('CC BY-SA 3.0');
    expect(normaliseLicense('Creative Commons Attribution 4.0')).toBe('CC BY 4.0');
    expect(normaliseLicense('CC0')).toBe('CC0');
    expect(normaliseLicense('Creative Commons Attribution-NonCommercial-ShareAlike 3.0')).toBeNull();
    expect(normaliseLicense('Creative Commons Attribution-NoDerivs 3.0')).toBeNull();
    expect(normaliseLicense('All rights reserved')).toBeNull();
    expect(normaliseLicense(undefined)).toBeNull();
  });

  test('solo keyboard only', () => {
    for (const ok of ['Piano', 'Harpsichord, Piano', 'Harpsichord,Clavichord', 'Clavier', 'Piano/Harpsichord/Clavichord'])
      expect(isSoloPiano(ok)).toBe(true);
    for (const no of ['Voice and Piano', 'Piano Duet', 'Organ', 'Violin, Piano', 'Piano (4 hands)', ''])
      expect(isSoloPiano(no)).toBe(false);
  });

  test('reads header fields', () => {
    const f = headerFields('\\header {\n  title = "Menuet"\n  mutopiainstrument = "Harpsichord, Piano"\n  license = "Public Domain"\n footer = "Mutopia-2013/01/06-77"\n}\n');
    expect(f).toMatchObject({title: 'Menuet', mutopiainstrument: 'Harpsichord, Piano', license: 'Public Domain', footer: 'Mutopia-2013/01/06-77'});
  });

  test('finds single-file and -lys pieces in the repository tree', () => {
    const tree = [
      'ftp/BachJS/BWV772/bach-invention-01/bach-invention-01.ly',
      'ftp/ChopinFF/O28/Chop-28-7/Chop-28-7-lys/chopin_prelude_op28_no7.ly',
      'ftp/ChopinFF/O28/Chop-28-7/Chop-28-7-lys/header.ly',
      'ftp/ChopinFF/O28/Chop-28-7/Chop-28-7-lys/paper-defs.ily',
      'ftp/Other/misc/notes.ly',
    ].map(path => ({path, type: 'blob'}));
    expect(findPieces(tree)).toEqual([
      {dir: 'ftp/BachJS/BWV772/bach-invention-01', candidates: ['ftp/BachJS/BWV772/bach-invention-01/bach-invention-01.ly']},
      {dir: 'ftp/ChopinFF/O28/Chop-28-7', candidates: ['ftp/ChopinFF/O28/Chop-28-7/Chop-28-7-lys/chopin_prelude_op28_no7.ly', 'ftp/ChopinFF/O28/Chop-28-7/Chop-28-7-lys/header.ly']},
    ]);
  });

  test('the bundled index is small and well formed', () => {
    const text = read('public/songs/mutopia-index.json');
    expect(text.length).toBeLessThan(1 << 20);
    const index = JSON.parse(text);
    expect(index.count).toBe(index.pieces.length);
    expect(index.commit).toMatch(/^[0-9a-f]{40}$/);
    for (const p of index.pieces) {
      expect(p.path).toMatch(/^ftp\/.+\.ly$/);
      expect(p.url).toBe(`https://raw.githubusercontent.com/${index.repo}/${index.commit}/${p.path.split('/').map(encodeURIComponent).join('/')}`);
      expect(normaliseLicense(p.license)).toBe(p.license);
      expect(p.title && p.composer).toBeTruthy();
    }
  });
});

describe('bundled repertoire (songs/repertoire.json → public/songs/catalog.json)', () => {
  const manifest = JSON.parse(read('songs/repertoire.json'));
  const catalog = JSON.parse(read('public/songs/catalog.json')).songs;

  test('every catalog entry is complete, graded, licensed and has its file', () => {
    const ids = new Set();
    for (const s of catalog) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(['beginner', 'easy', 'intermediate', 'advanced']).toContain(s.difficulty);
      expect(Number.isInteger(s.grade) && s.grade >= 0 && s.grade <= 5).toBe(true);
      expect(s.license && s.source && s.sourceUrl).toBeTruthy();
      expect(existsSync(new URL('../public/' + s.file, import.meta.url))).toBe(true);
    }
    // Ordered from beginner to advanced.
    expect(catalog.map(s => s.grade)).toEqual(catalog.map(s => s.grade).sort((a, b) => a - b));
  });

  test('every Mutopia piece is in the catalog with the entry the build script writes', () => {
    for (const p of manifest.pieces) expect(catalog.find(s => s.id === p.id)).toEqual(catalogEntry(p));
  });

  test('share-alike pieces say so in the file', () => {
    for (const p of manifest.pieces.filter(p => p.license !== 'Public Domain')) {
      const xml = read(`public/songs/${p.id}.musicxml`);
      expect(xml).toMatch(new RegExp(`<rights>Creative Commons Attribution-ShareAlike ${p.license.split(' ').at(-1).replace('.', '\\.')}`));
      expect(xml).toContain('This adaptation is licensed under the same licence');
    }
  });

  test('every piece is credited in THIRD-PARTY-NOTICES', () => {
    const notices = read('public/THIRD-PARTY-NOTICES.txt');
    for (const p of manifest.pieces) expect(notices).toContain(`piece-info.cgi?id=${p.mutopiaId}`);
  });
});

describe('src/mutopia/convert.js', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('converts a catalogue piece fetched from GitHub, includes and all, labelled unverified', async () => {
    const index = {repo: 'MutopiaProject/MutopiaProject', commit: 'a'.repeat(40), count: 1, pieces: [
      {id: 7, title: 'Test piece', composer: 'Anon', license: 'Public Domain', path: 'ftp/Anon/test/test.ly'},
    ]};
    const files = {
      'ftp/Anon/test/test.ly': '\\include "english.ly"\n\\include "music.ily"\n\\score { \\new Staff \\tune }',
      'ftp/Anon/test/music.ily': "tune = \\relative c' { c4 ds e f }",
    };
    const fetched = [];
    vi.stubGlobal('fetch', vi.fn(async url => {
      fetched.push(String(url));
      if (String(url).endsWith('mutopia-index.json')) return new Response(JSON.stringify(index), {headers: {'content-type': 'application/json'}});
      const path = decodeURIComponent(String(url).split(`/${index.commit}/`)[1] ?? '');
      return files[path] ? new Response(files[path]) : new Response('', {status: 404});
    }));
    const {resolveMutopiaEntry, isMutopiaId} = await import('../src/mutopia/convert.js');
    expect(isMutopiaId('mutopia:ftp/Anon/test/test.ly')).toBe(true);
    const r = await resolveMutopiaEntry('mutopia:ftp/Anon/test/test.ly');
    expect(r.entry).toMatchObject({id: 'mutopia:ftp/Anon/test/test.ly', title: 'Test piece', kind: 'mutopia', unverified: true, license: 'Public Domain'});
    expect(r.entry.composer).toMatch(/unverified/);
    expect(r.source.data).toContain('<step>D</step><alter>1</alter>');
    expect(fetched.some(u => u.startsWith('https://raw.githubusercontent.com/MutopiaProject/MutopiaProject/'))).toBe(true);
    expect(await resolveMutopiaEntry('mutopia:ftp/Not/indexed.ly')).toBeNull();
    expect(await resolveMutopiaEntry('ex:scale')).toBeNull();
  });
});
