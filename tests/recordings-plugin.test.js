import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {recordingsHandler} from '../recordings/plugin.js';
import {listTakes, readTake, saveTake} from '../recordings/store.js';
import {newId, songDir, songIdFromDir, validateExam, validateTake, MAX_NOTES} from '../src/record/take.mjs';
import {main} from '../teacher/cli.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pp-rec-')); });
afterEach(() => rmSync(dir, {recursive: true, force: true}));

const take = (extra = {}) => ({id: 'take000001', songId: 'fur-elise', title: 'Für Elise', at: 1764000000000, tempo: 72, section: [0, 7],
  hands: 'both', mode: 'free', source: 'midi', notes: [[0, 64, 80, 200], [250, 63, 70, 200]], pedal: [[0, 127]], ...extra});

// Calls the connect handler like the dev server would → {status, body}.
function call(handler, method, url, body, {type = 'application/json'} = {}) {
  return new Promise(resolve => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = Readable.from(text ? [Buffer.from(text)] : []);
    Object.assign(req, {method, url, headers: {'content-type': type, 'content-length': String(Buffer.byteLength(text))}});
    const res = {statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      end(out) { resolve({status: this.statusCode, body: out ? JSON.parse(out) : null}); }};
    handler(req, res, () => resolve({status: 'next'}));
  });
}

describe('take validation', () => {
  it('accepts a good take and normalises it', () => {
    const t = validateTake({...take(), notes: [[250, 63, 70.4, 200], [0, 64, 80, 200]], name: '  First\u0007 go ', extra: 'dropped'});
    expect(t.notes).toEqual([[0, 64, 80, 200], [250, 63, 70, 200]]);
    expect(t.name).toBe('First  go');
    expect(t).not.toHaveProperty('extra');
    expect(t.durationMs).toBe(450);
  });
  it.each([
    ['bad id', {id: '../etc'}],
    ['bad song id', {songId: ''}],
    ['note out of range', {notes: [[0, 128, 80, 10]]}],
    ['velocity 0', {notes: [[0, 60, 0, 10]]}],
    ['negative time', {notes: [[-5, 60, 80, 10]]}],
    ['notes not an array', {notes: 'x'}],
    ['too many notes', {notes: Array.from({length: MAX_NOTES + 1}, (_, i) => [i, 60, 80, 1])}],
    ['bad pedal', {pedal: [[0, 300]]}],
    ['bad exam id', {exam: 'NOPE'}],
  ])('refuses %s', (_, patch) => {
    expect(() => validateTake(take(patch))).toThrow();
  });
  it('makes song ids path-safe, reversibly', () => {
    for (const id of ['fur-elise', 'import:3f2a', 'ex:scale:Fs:minor:both:2:up-down', 'mutopia:BachJS/BWV846', '../../etc', 'é è', '_exams', 'a_b'])
      expect(songIdFromDir(songDir(id))).toBe(id);
    expect(songDir('../x')).not.toMatch(/[./]/);
    expect(songDir('_exams')).not.toBe('_exams');
    expect(songIdFromDir('_exams')).toBeNull();
    expect(songIdFromDir('..')).toBeNull();
  });
  it('makes unique-looking ids', () => {
    const a = newId(), b = newId();
    expect(a).toMatch(/^[a-z0-9]{17}$/);
    expect(a).not.toBe(b);
  });
  it('validates exam sheets', () => {
    const e = validateExam({id: 'exam000001', at: 1, items: [{kind: 'piece', title: 'A', mark: 25, max: 30, band: 'Merit', songId: 'a', takeId: 'take000001'}]});
    expect(e).toMatchObject({total: 25, max: 30, name: 'Mock exam'});
    expect(() => validateExam({id: 'exam000001', at: 1, items: [{mark: 40, max: 30}]})).toThrow(/mark/);
    expect(() => validateExam({id: 'exam000001', at: 1, items: []})).toThrow();
  });
});

describe('recordings endpoints', () => {
  it('saves, lists, reads, renames and deletes a take', async () => {
    const h = recordingsHandler(dir);
    let r = await call(h, 'PUT', '/takes/take000001', take());
    expect(r.status).toBe(200);
    expect(r.body.take).toMatchObject({id: 'take000001', songId: 'fur-elise', notes: 2});
    expect(existsSync(join(dir, 'fur-elise', 'take000001.json'))).toBe(true);
    expect(readdirSync(join(dir, 'fur-elise'))).toEqual(['take000001.json']); // no temp files left
    await call(h, 'PUT', '/takes/take000002', take({id: 'take000002', songId: 'ex:scale:C:major:both:2:up-down', at: 1764000001000}));
    r = await call(h, 'GET', '/');
    expect(r.body.store).toBe('disk');
    expect(r.body.takes.map(t => t.id)).toEqual(['take000002', 'take000001']);
    r = await call(h, 'GET', '/?songId=fur-elise');
    expect(r.body.takes.map(t => t.id)).toEqual(['take000001']);
    r = await call(h, 'GET', '/takes/take000001');
    expect(r.body.notes).toHaveLength(2);
    r = await call(h, 'PATCH', '/takes/take000001', {name: 'Sunday', sentAt: 5});
    expect(r.body.take).toMatchObject({name: 'Sunday', sentAt: 5});
    expect(readTake(dir, 'take000001').name).toBe('Sunday');
    r = await call(h, 'DELETE', '/takes/take000001');
    expect(r.status).toBe(200);
    expect((await call(h, 'GET', '/takes/take000001')).status).toBe(404);
    expect((await call(h, 'DELETE', '/takes/take000001')).status).toBe(404);
  });

  it('refuses bad input with clear errors', async () => {
    const h = recordingsHandler(dir, {maxBody: 4096});
    expect((await call(h, 'PUT', '/takes/take000001', take({id: 'take000009'}))).status).toBe(400);
    expect((await call(h, 'PUT', '/takes/take000001', take({notes: [[0, 200, 1, 1]]}))).status).toBe(400);
    expect((await call(h, 'PUT', '/takes/take000001', 'not json')).status).toBe(400);
    expect((await call(h, 'PUT', '/takes/take000001', take(), {type: 'text/plain'})).status).toBe(415);
    expect((await call(h, 'PUT', '/takes/take000001', take({notes: Array.from({length: 400}, (_, i) => [i, 60, 80, 1])}))).status).toBe(413);
    expect((await call(h, 'GET', '/takes/..%2F..%2Fetc')).status).toBe(400);
    expect((await call(h, 'GET', '/?songId=')).status).toBe(400);
    expect((await call(h, 'GET', '/elsewhere')).status).toBe('next');
  });

  it('keeps a take with its piece and caps takes per piece', () => {
    saveTake(dir, take());
    expect(() => saveTake(dir, take({songId: 'other'}))).toThrow(/another piece/);
    saveTake(dir, take({id: 'take000002'}), {maxPerSong: 2});
    expect(() => saveTake(dir, take({id: 'take000003'}), {maxPerSong: 2})).toThrow(/at most 2/);
  });

  it('skips unreadable files when listing', () => {
    saveTake(dir, take());
    mkdirSync(join(dir, 'broken'), {recursive: true});
    writeFileSync(join(dir, 'broken', 'take000005.json'), '{oops');
    writeFileSync(join(dir, 'fur-elise', 'take000006.json'), JSON.stringify({id: 'take000006'}));
    expect(listTakes(dir).map(t => t.id)).toEqual(['take000001']);
  });

  it('stores exam sheets', async () => {
    const h = recordingsHandler(dir);
    const sheet = {id: 'exam000001', at: 2, items: [{kind: 'scale', title: 'C major', mark: 18, max: 21}], band: 'Distinction'};
    expect((await call(h, 'PUT', '/exams/exam000001', sheet)).status).toBe(200);
    expect((await call(h, 'GET', '/exams')).body.exams).toHaveLength(1);
    expect((await call(h, 'GET', '/exams/exam000001')).body).toMatchObject({total: 18, max: 21});
    expect(JSON.parse(readFileSync(join(dir, '_exams', 'exam000001.json'), 'utf8')).band).toBe('Distinction');
    expect(listTakes(dir)).toEqual([]); // exam sheets are not takes
    expect((await call(h, 'DELETE', '/exams/exam000001')).status).toBe(200);
  });
});

describe('teacher CLI: recordings and review', () => {
  it('lists takes and prints a review', () => {
    saveTake(dir, take());
    const out = [], err = [];
    expect(main(['recordings'], dir, s => out.push(s), s => err.push(s), {recordingsDir: dir})).toBe(0);
    expect(out.join('\n')).toMatch(/take000001 · .* Für Elise \[fur-elise\].*not compared yet/);
    out.length = 0;
    expect(main(['recordings', 'nope'], dir, s => out.push(s), s => err.push(s), {recordingsDir: dir})).toBe(0);
    expect(out.join('\n')).toMatch(/No recordings of nope/);
    out.length = 0;
    expect(main(['review', 'take000001'], dir, s => out.push(s), s => err.push(s), {recordingsDir: dir})).toBe(0);
    expect(out.join('\n')).toMatch(/Not compared with the score yet/);
    expect(main(['review', 'take000099'], dir, s => out.push(s), s => err.push(s), {recordingsDir: dir})).toBe(1);
    expect(err.join('\n')).toMatch(/no take take000099/);
  });
});
