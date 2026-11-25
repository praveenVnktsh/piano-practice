// The client error log: browser reporter (dedupe, rate limit, off when there's no endpoint), the
// dev-server plugin (always a temp dir here, never the real .data/) and tools/errors.mjs.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {FILE, appendErrors, errorLog, errorsHandler, readErrors, sanitizeError} from '../error-log/plugin.js';
import {createErrorReporter, normalizeError} from '../src/errors/reporter.js';
import {formatEntry, main, parseArgs} from '../tools/errors.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pp-errors-')); });
afterEach(() => rmSync(dir, {recursive: true, force: true}));

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

describe('reporter', () => {
  const setup = (opts = {}) => {
    let t = 1000;
    const sent = [];
    const r = createErrorReporter({send: async e => { sent.push(e); return true; }, now: () => t, ua: 'UA', url: 'http://x/#/today', ...opts});
    return {r, sent, tick: ms => { t += ms; }};
  };
  it('normalises errors, events and odd values', () => {
    const err = new TypeError('boom');
    expect(normalizeError(err)).toMatchObject({message: 'TypeError: boom'});
    expect(normalizeError({error: err, message: 'Uncaught TypeError: boom'}).message).toBe('TypeError: boom');
    expect(normalizeError({reason: new Error('nope')}).message).toBe('nope');
    expect(normalizeError({reason: 'plain'}).message).toBe('plain');
    expect(normalizeError({message: 'Script error.', error: null, filename: 'a.js', lineno: 3, colno: 4})).toEqual({message: 'Script error.', stack: '(a.js:3:4)'});
    expect(normalizeError({reason: {code: 7}}).message).toBe('{"code":7}');
    expect(normalizeError(undefined).message).toBe('Unknown error');
  });
  it('sends {message, stack, url, ua, at}', async () => {
    const {r, sent} = setup();
    await r.report(new Error('first'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({message: 'first', url: 'http://x/#/today', ua: 'UA', at: 1000});
    expect(sent[0].stack).toContain('first');
    expect(r.stats).toMatchObject({sent: 1, dropped: 0, last: 'first'});
  });
  it('dedupes the same error for a minute, then sends it with a repeat count', async () => {
    const {r, sent, tick} = setup();
    const e = new Error('again');
    await r.report(e); await r.report(e); await r.report(e);
    expect(sent).toHaveLength(1);
    tick(61000);
    await r.report(e);
    expect(sent).toHaveLength(2);
    expect(sent[1].count).toBe(3);
  });
  it('rate-limits to perMinute and perSession', async () => {
    const {r, sent, tick} = setup({perMinute: 3, perSession: 5});
    for (let i = 0; i < 6; i++) await r.report(new Error('e' + i));
    expect(sent).toHaveLength(3);
    expect(r.stats.dropped).toBe(3);
    tick(60001);
    for (let i = 6; i < 12; i++) await r.report(new Error('e' + i));
    expect(sent).toHaveLength(5);
  });
  it('turns itself off when the endpoint is missing (production build)', async () => {
    let calls = 0;
    const r = createErrorReporter({send: async () => { calls++; return false; }});
    expect(await r.report(new Error('a'))).toBe(false);
    expect(await r.report(new Error('b'))).toBe(false);
    expect(calls).toBe(1);
    expect(r.stats.enabled).toBe(false);
    const r2 = createErrorReporter({send: async () => { calls++; throw new Error('offline'); }});
    await r2.report(new Error('a')); await r2.report(new Error('b'));
    expect(calls).toBe(2);
  });
});

describe('error-log plugin', () => {
  it('sanitises entries', () => {
    expect(sanitizeError({message: ''})).toBeNull();
    expect(sanitizeError([])).toBeNull();
    const e = sanitizeError({message: 'x\u0007y'.padEnd(5000, 'z'), stack: 's', url: 'u', ua: 'a', at: 5, count: 3, extra: 1}, 100);
    expect(e.message).toHaveLength(1000);
    expect(e.message.startsWith('xy')).toBe(true);
    expect(e).toEqual({message: e.message, stack: 's', url: 'u', ua: 'a', at: 5, count: 3, received: 100});
    expect(sanitizeError({message: 'm', at: 1e15}, 100).at).toBe(100);
  });
  it('POST appends JSON lines; GET lists the newest', async () => {
    const h = errorsHandler(dir, {now: () => 42});
    expect(await call(h, 'POST', '/', {message: 'one', stack: 'at a.js:1:1', url: '/', ua: 'UA', at: 40})).toEqual({status: 200, body: {ok: true, added: 1}});
    expect(await call(h, 'POST', '/', [{message: 'two'}, {message: ''}, {message: 'three'}])).toEqual({status: 200, body: {ok: true, added: 2}});
    const lines = readFileSync(join(dir, FILE), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({message: 'one', at: 40, received: 42});
    const got = await call(h, 'GET', '/?limit=2');
    expect(got.body.errors.map(e => e.message)).toEqual(['two', 'three']);
    // sendBeacon-style text/plain bodies are fine too
    expect((await call(h, 'POST', '/', {message: 'beacon'}, {type: 'text/plain;charset=UTF-8'})).status).toBe(200);
  });
  it('refuses bad requests', async () => {
    const h = errorsHandler(dir);
    expect((await call(h, 'POST', '/', 'not json')).status).toBe(400);
    expect((await call(h, 'POST', '/', {message: 'x'}, {type: 'application/x-www-form-urlencoded'})).status).toBe(415);
    expect((await call(h, 'POST', '/', Array.from({length: 21}, () => ({message: 'x'})))).status).toBe(413);
    expect((await call(h, 'POST', '/', {message: 'x'.repeat(70000)})).status).toBe(413);
    expect((await call(h, 'DELETE', '/')).status).toBe(405);
    expect((await call(h, 'GET', '/other')).status).toBe('next');
    expect(existsSync(join(dir, FILE))).toBe(false);
  });
  it('caps the file by dropping the oldest entries', () => {
    const max = 4096;
    for (let i = 0; i < 200; i++) appendErrors(dir, [sanitizeError({message: `error ${i} `.padEnd(80, '.')}, i)], {maxBytes: max});
    expect(statSync(join(dir, FILE)).size).toBeLessThanOrEqual(max);
    const all = readErrors(dir, {limit: 0});
    expect(all.at(-1).message).toMatch(/^error 199 /);
    expect(all[0].message).not.toMatch(/^error 0 /);
  });
  it('skips broken lines and missing files', () => {
    expect(readErrors(dir)).toEqual([]);
    appendErrors(dir, [{message: 'ok'}]);
    appendFileSync(join(dir, FILE), '{broken\n\n');
    appendErrors(dir, [{message: 'ok 2'}]);
    expect(readErrors(dir).map(e => e.message)).toEqual(['ok', 'ok 2']);
  });
  it('is a dev-server plugin with a configurable directory', () => {
    const p = errorLog({dir});
    expect(p.apply).toBe('serve');
    const used = [];
    p.configureServer({middlewares: {use: (path, fn) => used.push(path)}});
    expect(used).toEqual(['/__errors']);
  });
});

describe('tools/errors.mjs', () => {
  it('parses arguments', () => {
    expect(parseArgs(['-n', '5', '--json', '--dir', dir])).toMatchObject({limit: 5, json: true, dir, follow: false});
  });
  it('lists recent errors from the given folder', () => {
    appendErrors(dir, [
      {message: 'TypeError: a is undefined', stack: 'TypeError: a is undefined\n    at f (http://x/src/player.js:10:5)', url: 'http://192.168.1.5:5173/#/play/x', ua: 'Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1', at: Date.UTC(2026, 10, 25), count: 2},
      {message: 'second', at: Date.UTC(2026, 10, 25, 1)},
    ]);
    const out = [];
    expect(main(['--dir', dir, '-n', '1'], s => out.push(s))).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('second');
    out.length = 0;
    main(['--dir', dir], s => out.push(s));
    expect(out[0]).toContain('iPad Safari · ×2 · /#/play/x');
    expect(out[0]).toContain('at f (http://x/src/player.js:10:5)');
    expect(formatEntry({message: 'm', at: 1}, {json: true})).toBe('{"message":"m","at":1}');
    main(['--dir', dir, '--clear'], () => {});
    expect(existsSync(join(dir, FILE))).toBe(false);
    out.length = 0;
    main(['--dir', dir], s => out.push(s));
    expect(out[0]).toMatch(/No errors logged/);
  });
});
