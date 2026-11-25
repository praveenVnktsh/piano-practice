import {describe, expect, it, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {collectServer, restoreServer, validateServerPart, backupHandler, FORMAT} from '../backup/plugin.js';
import {emptyDoc} from '../src/progress/model.js';
import {saveTake, listTakes} from '../recordings/store.js';

let root, dirs;
const AT = Date.UTC(2026, 0, 5);
const write = (dir, name, text) => { mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, name), text); };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pp-backup-'));
  dirs = {dataDir: join(root, 'data'), teacherDir: join(root, 'teacher'), songsDir: join(root, 'imports'), recordingsDir: join(root, 'recordings')};
  const doc = emptyDoc();
  doc.events.push({type: 'practice:session', id: 'a1', at: AT, songId: 'x', kind: 'listen', durationMs: 5000});
  doc.journal.push({id: 'journal0001', at: AT, text: 'Slow hands'});
  write(dirs.dataDir, 'progress.json', JSON.stringify(doc));
  write(dirs.teacherDir, 'messages.jsonl', JSON.stringify({id: 1, at: 1, text: 'hello'}) + '\n');
  write(dirs.teacherDir, 'replies.jsonl', JSON.stringify({id: 1, replyTo: 1, at: 2, text: 'Hi'}) + '\n');
  write(dirs.teacherDir, 'student.md', '# Student profile\n');
  write(dirs.teacherDir, 'status.json', '{"thinking":1}');
  write(dirs.songsDir, 'index.json', JSON.stringify({songs: [{id: 'import:abc', title: 'Mine', added: 1, file: 'songs/local/imports/mine-0123abcd.musicxml', format: 'musicxml', hash: 'h1'}]}));
  write(dirs.songsDir, 'mine-0123abcd.musicxml', '<score-partwise/>');
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

const TAKE = {id: 'take000001', songId: 'fur-elise', title: 'Für Elise', at: 1764000000000, tempo: 72, section: [0, 7],
  hands: 'both', mode: 'free', source: 'midi', notes: [[0, 64, 80, 200], [250, 63, 70, 200]], pedal: [[0, 127]]};

describe('backup plugin', () => {
  it('backs up recorded takes and restores only the missing ones', () => {
    saveTake(dirs.recordingsDir, TAKE);
    const b = collectServer(dirs);
    expect(b.server.recordings.takes.map(t => t.id)).toEqual(['take000001']);
    const fresh = {dataDir: join(root, 'd3'), teacherDir: join(root, 't3'), songsDir: join(root, 'i3'), recordingsDir: join(root, 'r3')};
    const out = restoreServer(JSON.parse(JSON.stringify(b)), fresh);
    expect(out.restored.takesAdded).toBe(1);
    expect(listTakes(fresh.recordingsDir).map(t => t.id)).toEqual(['take000001']);
    // Restoring again adds nothing and never overwrites.
    expect(restoreServer(JSON.parse(JSON.stringify(b)), fresh).restored.takesAdded).toBe(0);
  });

  it('skips an invalid take instead of failing the whole restore', () => {
    const b = collectServer(dirs);
    b.server.recordings = {takes: [{id: '../../etc', songId: 'x'}], exams: []};
    const out = restoreServer(b, dirs);
    expect(out.restored.takesAdded).toBe(0);
    expect(out.restored.recordingsSkipped).toBe(1);
  });

  it('collects progress, teacher files (not status) and imported scores', () => {
    const b = collectServer(dirs);
    expect(b.format).toBe(FORMAT);
    expect(b.server.data['progress.json'].events).toHaveLength(1);
    expect(Object.keys(b.server.teacher).sort()).toEqual(['messages.jsonl', 'replies.jsonl', 'student.md']);
    expect(b.server.imports.index).toHaveLength(1);
    expect(Buffer.from(b.server.imports.files['mine-0123abcd.musicxml'], 'base64').toString()).toBe('<score-partwise/>');
  });

  it('round-trips into empty folders and keeps a snapshot of what was there', () => {
    const b = collectServer(dirs);
    const fresh = {dataDir: join(root, 'd2'), teacherDir: join(root, 't2'), songsDir: join(root, 'i2'), recordingsDir: join(root, 'r2')};
    const out = restoreServer(JSON.parse(JSON.stringify(b)), fresh);
    expect(out.restored.events).toBe(1);
    expect(out.restored.journal).toBe(1);
    expect(out.restored.importsAdded).toBe(1);
    expect(JSON.parse(readFileSync(join(fresh.dataDir, 'progress.json'), 'utf8')).journal[0].text).toBe('Slow hands');
    expect(readFileSync(join(fresh.teacherDir, 'student.md'), 'utf8')).toContain('Student profile');
    expect(readFileSync(join(fresh.songsDir, 'mine-0123abcd.musicxml'), 'utf8')).toBe('<score-partwise/>');
    expect(readdirSync(join(fresh.dataDir, 'backups'))).toHaveLength(1);
  });

  it('replaces progress but only adds imports', () => {
    const b = collectServer(dirs);
    b.server.data['progress.json'].events = [];
    b.server.imports.index = [];
    write(dirs.songsDir, 'index.json', JSON.stringify({songs: []}));
    restoreServer(b, dirs);
    expect(JSON.parse(readFileSync(join(dirs.dataDir, 'progress.json'), 'utf8')).events).toHaveLength(0);
    expect(existsSync(join(dirs.songsDir, 'mine-0123abcd.musicxml'))).toBe(true);
    const snapshot = readdirSync(join(dirs.dataDir, 'backups'))[0];
    expect(JSON.parse(readFileSync(join(dirs.dataDir, 'backups', snapshot), 'utf8')).server.data['progress.json'].events).toHaveLength(1);
  });

  it('rejects files that are not backups and unsafe names', () => {
    expect(() => validateServerPart({format: 'x'})).toThrow(/not a Piano Practice backup/);
    expect(() => validateServerPart({format: FORMAT, version: 99})).toThrow(/newer/);
    expect(() => validateServerPart({format: FORMAT, version: 1, server: {data: {'../evil.json': {}}}})).toThrow(/file name/);
    expect(() => validateServerPart({format: FORMAT, version: 1, server: {teacher: {'../../x.md': 'hi'}}})).toThrow(/file name/);
    expect(() => validateServerPart({format: FORMAT, version: 1, server: {teacher: {'status.json': '{}'}}})).toThrow(/file name/);
    expect(() => validateServerPart({format: FORMAT, version: 1, server: {teacher: {'messages.jsonl': 'not json\n'}}})).toThrow(/not JSON/);
    expect(() => validateServerPart({format: FORMAT, version: 1, server: {imports: {index: [{id: 'import:a', title: 't', file: 'songs/local/imports/../../x.musicxml'}]}}})).toThrow(/score file name/);
  });

  it('serves GET /__backup and a dry-run restore over HTTP', async () => {
    const handler = backupHandler(dirs);
    const call = (method, url, body) => new Promise(resolve => {
      const req = Readable.from(body ? [Buffer.from(body)] : []);
      Object.assign(req, {method, url, headers: body ? {'content-type': 'application/json', 'content-length': String(body.length)} : {}});
      const res = {statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { resolve({status: this.statusCode, json: JSON.parse(text)}); }};
      handler(req, res, () => resolve({status: 404}));
    });
    const got = await call('GET', '/');
    expect(got.json.server.data['progress.json'].events).toHaveLength(1);
    const dry = await call('POST', '/restore?dryRun=1', JSON.stringify(got.json));
    expect(dry.json.summary).toMatchObject({events: 1, teacherMessages: 1, teacherReplies: 1, imports: 1});
    const bad = await call('POST', '/restore', '{"format":"nope"}');
    expect(bad.status).toBe(400);
  });
});
