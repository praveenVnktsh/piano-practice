import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';

import {progressHandler, progressStore} from '../progress-store/plugin.js';

let server;
afterEach(() => server?.close());

async function serve(dir, opts) {
  const handler = progressHandler(dir, opts);
  server = createServer((req, res) => {
    const next = () => { res.statusCode = 404; res.end('next'); };
    if (req.url.startsWith('/__progress')) { req.url = req.url.slice('/__progress'.length) || '/'; return handler(req, res, next); }
    next();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
}

const temp = () => mkdtempSync(join(tmpdir(), 'progress-store-'));
const post = (base, body, path = '/events') => fetch(base + '/__progress' + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const get = async base => (await fetch(base + '/__progress')).json();
const stored = dir => JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));

const NOW = Date.now();
const session = (over = {}) => ({type: 'practice:session', songId: 'fur-elise', title: 'Für Elise', kind: 'practice', durationMs: 600000, at: NOW - 3600e3, tz: 0, ...over});
const result = (over = {}) => ({type: 'practice:result', songId: 'fur-elise', title: 'Für Elise', section: [0, 7], mode: 'wait', hands: 'both', tempo: 72, right: 45, wrong: 5, accuracy: 90, timing: null, durationMs: 60000, at: NOW - 3000e3, tz: 0, ...over});
const drill = (over = {}) => ({type: 'trainer:result', level: 2, right: 18, wrong: 2, accuracy: 90, avgMs: 1400, durationMs: 90000, at: NOW - 2000e3, tz: 0, ...over});

describe('progress store', () => {
  test('GET on a fresh install returns an empty document', async () => {
    const dir = temp(), base = await serve(dir);
    const doc = await get(base);
    expect(doc).toMatchObject({store: 'disk', events: [], settings: {dailyGoalMin: 15}});
    expect(existsSync(join(dir, 'progress.json'))).toBe(false);
  });

  test('POST appends the three event types and keeps aggregates', async () => {
    const dir = temp(), base = await serve(dir);
    const res = await post(base, [session(), result(), drill()]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true, added: 3, rejected: 0, total: 3});
    const doc = await get(base);
    expect(doc.events.map(e => e.type)).toEqual(['practice:session', 'practice:result', 'trainer:result']);
    expect(doc.totals.songs['fur-elise']).toMatchObject({title: 'Für Elise', attempts: 1, best: 90, latest: 90});
    const day = new Date(NOW - 3600e3).toISOString().slice(0, 10);
    expect(doc.totals.days[day].practiceMs).toBe(600000);
    expect(stored(dir).events).toHaveLength(3);
    expect(readdirSync(dir).filter(f => f.startsWith('.tmp'))).toEqual([]);
  });

  test('accepts {events: [...]} too, and dedupes by id', async () => {
    const dir = temp(), base = await serve(dir);
    await post(base, {events: [session({id: 'abcdef123'})]});
    const again = await (await post(base, [session({id: 'abcdef123'}), session({id: 'zzzzzz999'})])).json();
    expect(again).toMatchObject({added: 1, total: 2});
  });

  test('rejects invalid events and drops unknown fields', async () => {
    const dir = temp(), base = await serve(dir);
    const res = await (await post(base, [
      {type: 'evil', at: NOW},
      session({durationMs: 1000}),               // too short
      session({at: NOW + 7 * 864e5}),            // far future
      result({accuracy: 'high'}),
      result({accuracy: 140, file: '../../etc/passwd', __proto__: {x: 1}, title: 'x'.repeat(5000)}),
      'nope', null,
    ])).json();
    expect(res).toMatchObject({added: 1, rejected: 6});
    const [ev] = (await get(base)).events;
    expect(ev.accuracy).toBe(100);
    expect(ev.title).toHaveLength(200);
    expect(ev).not.toHaveProperty('file');
  });

  test('rejects non-JSON, wrong content type, oversize bodies and too many events', async () => {
    const dir = temp(), base = await serve(dir, {maxBody: 2000, maxPerRequest: 3});
    expect((await post(base, '{nope')).status).toBe(400);
    expect((await post(base, {not: 'a list'})).status).toBe(400);
    expect((await fetch(base + '/__progress/events', {method: 'POST', headers: {'content-type': 'text/plain'}, body: '[]'})).status).toBe(415);
    expect((await post(base, [session(), session(), session(), session()])).status).toBe(413);
    expect((await post(base, [session({title: 'x'.repeat(3000)})])).status).toBe(413);
    expect(existsSync(join(dir, 'progress.json'))).toBe(false);
  });

  test('prunes the oldest raw events past the cap but keeps aggregates', async () => {
    const dir = temp(), base = await serve(dir, {maxEvents: 3});
    const events = [0, 1, 2, 3, 4].map(i => result({id: 'event-' + i + 'xx', at: NOW - (10 - i) * 864e5, accuracy: 50 + i * 10}));
    await post(base, events.slice(0, 2));
    await post(base, events.slice(2));
    const doc = await get(base);
    expect(doc.events.map(e => e.id)).toEqual(['event-2xx', 'event-3xx', 'event-4xx']);
    expect(doc.totals.pruned).toBe(2);
    expect(doc.totals.songs['fur-elise']).toMatchObject({attempts: 5, best: 90, latest: 90});
    expect(Object.keys(doc.totals.days)).toHaveLength(5);
  });

  test('settings: daily goal is validated and stored', async () => {
    const dir = temp(), base = await serve(dir);
    const put = body => fetch(base + '/__progress/settings', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    expect(await (await put({dailyGoalMin: 25, path: '/etc'})).json()).toEqual({ok: true, settings: {dailyGoalMin: 25}});
    expect(await (await put({dailyGoalMin: -3})).json()).toEqual({ok: true, settings: {dailyGoalMin: 25}});
    expect(stored(dir).settings).toEqual({dailyGoalMin: 25});
  });

  test('a corrupt file is reported, not overwritten', async () => {
    const dir = temp(), base = await serve(dir);
    writeFileSync(join(dir, 'progress.json'), '{broken');
    expect((await fetch(base + '/__progress')).status).toBe(500);
    expect((await post(base, [session()])).status).toBe(500);
    expect(readFileSync(join(dir, 'progress.json'), 'utf8')).toBe('{broken');
  });

  test('unknown paths and methods fall through', async () => {
    const dir = temp(), base = await serve(dir);
    expect((await fetch(base + '/__progress/../../etc/passwd')).status).toBe(404);
    expect((await fetch(base + '/__progress', {method: 'DELETE'})).status).toBe(404);
  });

  test('plugin is dev-server only', () => {
    expect(progressStore()).toMatchObject({name: 'progress-store', apply: 'serve'});
  });
});
