import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';

import {filesHandler, songsHandler, songStore} from '../song-store/plugin.js';

const XML = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/><part id="P1"/></score-partwise>';
const MEI = '<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei"><music/></mei>';
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).toString('base64');

let server;
afterEach(() => server?.close());

async function serve(dir, opts) {
  const songs = songsHandler(dir, opts), files = filesHandler(dir);
  server = createServer((req, res) => {
    const next = () => res.end('next');
    if (req.url.startsWith('/__songs')) { req.url = req.url.slice('/__songs'.length) || '/'; return songs(req, res, next); }
    if (req.url.startsWith('/files')) { req.url = req.url.slice('/files'.length); return files(req, res, next); }
    next();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
}

const temp = () => mkdtempSync(join(tmpdir(), 'song-store-'));
const post = (base, body) => fetch(base + '/__songs', {method: 'POST', headers: {'content-type': 'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const list = async base => (await (await fetch(base + '/__songs')).json()).songs;
const index = dir => JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).songs;
const scoreFiles = dir => readdirSync(dir).filter(f => f !== 'index.json');

describe('saving songs', () => {
  test('POST writes the file and the index entry, with a server-made filename', async () => {
    const dir = temp(), base = await serve(dir);
    const res = await post(base, {title: 'Für Elise / ../../etc', composer: 'Beethoven', data: XML, file: '../evil.js'});
    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry).toMatchObject({title: 'Für Elise / ../../etc', composer: 'Beethoven', format: 'musicxml'});
    expect(entry.id).toMatch(/^import:[0-9a-f]{24}$/);
    expect(entry.file).toMatch(/^songs\/local\/imports\/fur-elise-etc-[0-9a-f]{8}\.musicxml$/);
    const name = entry.file.split('/').pop();
    expect(scoreFiles(dir)).toEqual([name]);
    expect(readFileSync(join(dir, name), 'utf8')).toBe(XML);
    expect(index(dir)).toEqual([entry]);
    // No temp files left behind.
    expect(readdirSync(dir).some(f => f.startsWith('.tmp'))).toBe(false);
  });

  test('MEI and compressed MusicXML get their own extensions', async () => {
    const dir = temp(), base = await serve(dir);
    const mei = await (await post(base, {title: 'M', data: MEI})).json();
    const mxl = await (await post(base, {title: 'Z', mxlBase64: ZIP})).json();
    expect(mei).toMatchObject({format: 'mei'});
    expect(mei.file).toMatch(/\.mei$/);
    expect(mxl).toMatchObject({format: 'mxl'});
    expect(readFileSync(join(dir, mxl.file.split('/').pop()))).toEqual(Buffer.from(ZIP, 'base64'));
  });

  test('keeps a well-formed client id and date (migration), but never a clashing one', async () => {
    const dir = temp(), base = await serve(dir);
    const a = await (await post(base, {id: 'import:abc-123', added: 1000, title: 'A', data: XML})).json();
    expect(a).toMatchObject({id: 'import:abc-123', added: 1000});
    const b = await (await post(base, {id: 'import:abc-123', title: 'B', data: XML})).json();
    expect(b.id).not.toBe('import:abc-123');
    const c = await (await post(base, {id: '../../x', title: 'C', data: XML})).json();
    expect(c.id).toMatch(/^import:[0-9a-f]{24}$/);
  });

  test('the same title and content is a duplicate, not a second copy', async () => {
    const dir = temp(), base = await serve(dir);
    const first = await (await post(base, {title: 'A', data: XML})).json();
    const again = await post(base, {title: 'A', data: XML});
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({...first, duplicate: true});
    expect(scoreFiles(dir)).toHaveLength(1);
    expect((await post(base, {title: 'A (copy)', data: XML})).status).toBe(201);
  });

  test.each([
    ['not JSON', '{nope'],
    ['an array', '[1]'],
    ['no title', {data: XML}],
    ['no score', {title: 'x'}],
    ['HTML', {title: 'x', data: '<html><body><script>alert(1)</script></body></html>'}],
    ['plain text', {title: 'x', data: 'hello score-partwise'}],
    ['bad base64', {title: 'x', mxlBase64: 'not base64!'}],
    ['base64 that is not a zip', {title: 'x', mxlBase64: Buffer.from('hello world').toString('base64')}],
  ])('refuses %s with 400', async (_, body) => {
    const dir = temp(), base = await serve(dir);
    const res = await post(base, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
  });

  test('refuses bodies over the size limit with 413', async () => {
    const dir = temp(), base = await serve(dir, {maxBody: 1024});
    const res = await post(base, {title: 'big', data: XML + ' '.repeat(2048)});
    expect(res.status).toBe(413);
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
  });

  test('refuses non-JSON content types', async () => {
    const base = await serve(temp());
    const res = await fetch(base + '/__songs', {method: 'POST', headers: {'content-type': 'text/plain'}, body: XML});
    expect(res.status).toBe(415);
  });
});

describe('listing and deleting', () => {
  test('GET lists metadata only, newest first', async () => {
    const dir = temp(), base = await serve(dir);
    expect(await list(base)).toEqual([]);
    await post(base, {title: 'Old', data: XML, added: 1});
    await post(base, {title: 'New', data: MEI, added: 2});
    const songs = await list(base);
    expect(songs.map(s => s.title)).toEqual(['New', 'Old']);
    for (const s of songs) {
      expect(Object.keys(s).sort()).toEqual(['added', 'file', 'format', 'hash', 'id', 'title']);
    }
  });

  test('DELETE removes the file and the index entry', async () => {
    const dir = temp(), base = await serve(dir);
    const keep = await (await post(base, {title: 'Keep', data: XML})).json();
    const gone = await (await post(base, {title: 'Gone', data: MEI})).json();
    const res = await fetch(base + '/__songs/' + encodeURIComponent(gone.id), {method: 'DELETE'});
    expect(res.status).toBe(200);
    expect(index(dir)).toEqual([keep]);
    expect(scoreFiles(dir)).toEqual([keep.file.split('/').pop()]);
    expect((await fetch(base + '/__songs/' + encodeURIComponent(gone.id), {method: 'DELETE'})).status).toBe(404);
  });

  test.each([
    ['..%2F..%2Fpackage.json'],
    ['import%3Aa%2Fb'],
    ['import%3A..%2Fx'],
    ['import%3A'],
    ['index.json'],
    ['%E0%A4%A'],
  ])('DELETE refuses the id %s', async id => {
    const dir = temp(), base = await serve(dir);
    const keep = await (await post(base, {title: 'Keep', data: XML})).json();
    const res = await fetch(base + '/__songs/' + id, {method: 'DELETE'});
    expect(res.status).toBe(400);
    expect(index(dir)).toEqual([keep]);
  });

  test('ignores tampered index entries that point outside the folder', async () => {
    const dir = temp(), base = await serve(dir);
    writeFileSync(join(dir, 'index.json'), JSON.stringify({songs: [
      {id: 'import:bad', title: 'x', file: 'songs/local/imports/../../../package.json'},
      {id: 'import:bad2', title: 'y', file: '/etc/passwd'},
    ]}));
    expect(await list(base)).toEqual([]);
    expect((await fetch(base + '/__songs/import%3Abad', {method: 'DELETE'})).status).toBe(404);
  });

  test('passes other paths and methods on', async () => {
    const base = await serve(temp());
    expect(await (await fetch(base + '/__songs', {method: 'PUT'})).text()).toBe('next');
    expect(await (await fetch(base + '/__songs/a/b', {method: 'DELETE'})).text()).toBe('next');
  });
});

describe('serving stored files', () => {
  test('serves saved scores, nothing else', async () => {
    const dir = temp(), base = await serve(dir);
    const entry = await (await post(base, {title: 'A', data: XML})).json();
    const res = await fetch(base + '/files/' + entry.file.split('/').pop());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/musicxml/);
    expect(await res.text()).toBe(XML);
    expect(await (await fetch(base + '/files/index.json')).text()).toBe('next');
    expect(await (await fetch(base + '/files/..%2Findex.json')).text()).toBe('next');
  });
});

test('the plugin only runs on the dev server', () => {
  expect(songStore()).toMatchObject({name: 'song-store', apply: 'serve'});
});
