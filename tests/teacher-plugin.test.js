import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {teacher, teacherHandler} from '../teacher/plugin.js';
import {addReply, readMessages} from '../teacher/store.js';

let server, handler;
afterEach(() => {
  handler?.close();
  server?.closeAllConnections?.();
  server?.close();
});

async function serve(dir) {
  handler = teacherHandler(dir, {pollMs: 100});
  // Like Vite's connect: mounted at /__teacher, with the prefix stripped from req.url.
  server = createServer((req, res) => {
    if (!req.url.startsWith('/__teacher')) return res.end('other');
    req.url = req.url.slice('/__teacher'.length) || '/';
    handler(req, res, () => res.end('next'));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}/__teacher`;
}

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Reads SSE `thread` events until `until(thread)` is true. */
async function waitForThread(url, until, act) {
  const res = await fetch(url + '/stream');
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    acted = false;
  const deadline = Date.now() + 3000;
  try {
    while (Date.now() < deadline) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      let at;
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = /^event: thread\ndata: (.*)$/m.exec(chunk)?.[1];
        if (!data) continue;
        const thread = JSON.parse(data);
        if (until(thread)) return thread;
        if (!acted) {
          acted = true;
          await act();
        }
      }
    }
  } finally {
    reader.cancel();
  }
  throw new Error('no matching thread event');
}

describe('the teacher endpoints', () => {
  test('POST /messages stores the message with its context; GET returns the thread', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teacher-plugin-'));
    const url = await serve(dir);
    const res = await post(url + '/messages', {
      text: 'How do I practise this?',
      context: {route: '#/play/x', player: null},
    });
    expect(res.status).toBe(201);
    const shown = await res.json();
    expect(shown).toMatchObject({id: 1, text: 'How do I practise this?'});
    expect(shown).not.toHaveProperty('context');
    expect(readMessages(dir)[0].context).toEqual({route: '#/play/x', player: null});

    const thread = await (await fetch(url)).json();
    expect(thread).toEqual({
      messages: [{id: 1, at: shown.at, text: 'How do I practise this?'}],
      replies: [],
      status: {thinking: null, at: null},
      assignments: [],
      letters: [],
      comments: [],
    });
  });

  test.each([['{not json'], ['[1]'], ['"text"'], ['{}'], ['{"text":"  "}'], ['{"text":"x","context":"y"}']])(
    'refuses %s with 400',
    async body => {
      const dir = mkdtempSync(join(tmpdir(), 'teacher-plugin-'));
      const url = await serve(dir);
      const res = await post(url + '/messages', body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
      expect(readMessages(dir)).toEqual([]);
    },
  );

  test('refuses oversized bodies', async () => {
    const url = await serve(mkdtempSync(join(tmpdir(), 'teacher-plugin-')));
    const res = await post(url + '/messages', {text: 'x', context: {pad: 'x'.repeat(300 * 1024)}}).catch(e => e);
    expect(res instanceof Error || res.status === 413).toBe(true);
  });

  test('POST /status sets and clears "thinking"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teacher-plugin-'));
    const url = await serve(dir);
    expect((await post(url + '/status', {thinking: 1})).status).toBe(400); // no such message
    await post(url + '/messages', {text: 'hi'});
    expect(await (await post(url + '/status', {thinking: 1})).json()).toMatchObject({thinking: 1});
    expect((await (await fetch(url)).json()).status.thinking).toBe(1);
    expect((await post(url + '/status', {nope: 1})).status).toBe(400);
    expect(await (await post(url + '/status', {thinking: null})).json()).toMatchObject({thinking: null});
  });

  test('passes other paths and methods on', async () => {
    const url = await serve(mkdtempSync(join(tmpdir(), 'teacher-plugin-')));
    expect(await (await fetch(url + '/other')).text()).toBe('next');
    expect(await (await fetch(url, {method: 'DELETE'})).text()).toBe('next');
    expect(await (await fetch(url + '/messages')).text()).toBe('next');
  });

  test('the stream pushes a reply written by the CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teacher-plugin-'));
    const url = await serve(dir);
    await post(url + '/messages', {text: 'help'});
    const thread = await waitForThread(
      url,
      t => t.replies.length === 1,
      () => addReply(dir, 1, 'Slow down', [{type: 'set_tempo', bpm: 50}]),
    );
    expect(thread.replies[0]).toMatchObject({replyTo: 1, text: 'Slow down', actions: [{type: 'set_tempo', bpm: 50}]});
  });

  test('is a dev-server-only plugin that keeps .teacher/ out of the file watcher', () => {
    const plugin = teacher();
    expect(plugin.apply).toBe('serve');
    expect(plugin.config().server.watch.ignored).toContain('**/.teacher/**');
  });
});
