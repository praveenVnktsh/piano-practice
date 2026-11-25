import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test, vi} from 'vitest';
import {main} from '../teacher/cli.js';
import {
  addMessage,
  addReply,
  openMessages,
  readProfile,
  readStatus,
  readThread,
  setThinking,
} from '../teacher/store.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'teacher-'));
const ctx = {
  route: '#/play/fur-elise',
  player: {
    songId: 'fur-elise',
    title: 'Für Elise',
    section: [0, 7],
    sectionLabel: 'Measures 1–8',
    measureCount: 100,
    tempo: 60,
    hands: 'both',
    mode: 'wait',
    loop: true,
  },
  recentResults: [
    {
      songId: 'fur-elise',
      title: 'Für Elise',
      section: [0, 7],
      mode: 'wait',
      hands: 'both',
      tempo: 60,
      right: 40,
      wrong: 6,
      accuracy: 87,
      timing: null,
      at: 0,
      misses: [{measure: '5', expected: ['D♯5'], played: ['E5']}],
    },
  ],
};

describe('teacher store', () => {
  test('messages get increasing integer ids and keep their context', () => {
    const dir = fresh();
    expect(addMessage(dir, {text: '  hi  ', context: ctx})).toMatchObject({id: 1, text: 'hi', context: ctx});
    expect(addMessage(dir, {text: 'again', id: 99})).toMatchObject({id: 2, context: null});
    const lines = readFileSync(join(dir, 'messages.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    expect(lines.map(l => l.id)).toEqual([1, 2]);
    expect(lines[0].context.player.songId).toBe('fur-elise');
    // The thread the app reads leaves contexts out.
    expect(readThread(dir).messages[0]).not.toHaveProperty('context');
  });

  test.each([
    [null],
    [[]],
    [{}],
    [{text: '   '}],
    [{text: 5}],
    [{text: 'x'.repeat(4001)}],
    [{text: 'ok', context: 'no'}],
    [{text: 'ok', context: [1]}],
    [{text: 'ok', context: {big: 'x'.repeat(70000)}}],
  ])('refuses message %#', fields => {
    const dir = fresh();
    expect(() => addMessage(dir, fields)).toThrow();
    expect(readThread(dir).messages).toEqual([]);
  });

  test('replies validate the message, the text and the actions, and clear "thinking"', () => {
    const dir = fresh();
    addMessage(dir, {text: 'help'});
    expect(() => addReply(dir, 2, 'x')).toThrow('no message 2');
    expect(() => addReply(dir, 1, ' ')).toThrow('needs text');
    expect(() => addReply(dir, 1, 'x', [{type: 'set_tempo', bpm: 'fast'}])).toThrow('actions[0]');
    setThinking(dir, 1);
    expect(readStatus(dir).thinking).toBe(1);
    expect(openMessages(dir).map(m => m.id)).toEqual([1]);
    const reply = addReply(dir, '1', 'Slow down.', [{type: 'set_tempo', bpm: 50}]);
    expect(reply).toMatchObject({id: 1, replyTo: 1, text: 'Slow down.', actions: [{type: 'set_tempo', bpm: 50}]});
    expect(addReply(dir, 1, 'And breathe.')).not.toHaveProperty('actions');
    expect(readStatus(dir).thinking).toBe(null);
    expect(openMessages(dir)).toEqual([]);
  });

  test('skips corrupt lines instead of failing', () => {
    const dir = fresh();
    addMessage(dir, {text: 'one'});
    writeFileSync(join(dir, 'messages.jsonl'), readFileSync(join(dir, 'messages.jsonl'), 'utf8') + '{oops\n"str"\n');
    expect(addMessage(dir, {text: 'two'}).id).toBe(2);
    expect(readThread(dir).messages.map(m => m.text)).toEqual(['one', 'two']);
  });

  test('thinking needs a real message', () => {
    const dir = fresh();
    expect(() => setThinking(dir, 3)).toThrow('no message 3');
    expect(setThinking(dir, null).thinking).toBe(null);
  });
});

describe('teacher CLI', () => {
  const run = (dir, ...argv) => {
    const out = vi.fn(),
      err = vi.fn();
    const code = main(argv, dir, out, err);
    return {code, out: out.mock.calls.flat().join('\n'), err: err.mock.calls.flat().join('\n')};
  };

  test('list --open shows unanswered messages with their context', () => {
    const dir = fresh();
    expect(run(dir, 'list', '--open').out).toBe('No unanswered messages.');
    addMessage(dir, {text: 'Why do I miss bar 5?', context: ctx});
    const {code, out} = run(dir, 'list', '--open');
    expect(code).toBe(0);
    expect(out).toContain('#1');
    expect(out).toContain('Why do I miss bar 5?');
    expect(out).toContain('Für Elise');
    expect(out).toContain('Measures 1–8 (section [0, 7])');
    expect(out).toContain('miss bar 5: expected D♯5; played E5');
  });

  test('reply with actions, then list shows it answered', () => {
    const dir = fresh();
    addMessage(dir, {text: 'help'});
    const ok = run(
      dir,
      'reply',
      '1',
      'Try **slowly**.',
      '--actions',
      '[{"type":"set_tempo","bpm":50},{"type":"set_hands","hands":"right"}]',
    );
    expect(ok).toMatchObject({code: 0});
    expect(ok.out).toContain('2 action(s)');
    expect(readThread(dir).replies[0].actions).toHaveLength(2);
    expect(run(dir, 'list', '--open').out).toBe('No unanswered messages.');
    expect(run(dir, 'list').out).toContain('reply 1: Try **slowly**.');
  });

  test('refuses bad replies with a reason', () => {
    const dir = fresh();
    addMessage(dir, {text: 'help'});
    expect(run(dir, 'reply', '1', 'x', '--actions', '{nope').err).toContain('not valid JSON');
    const bad = run(dir, 'reply', '1', 'x', '--actions', '[{"type":"set_mode","mode":"fast"}]');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('mode must be one of wait, timed');
    expect(run(dir, 'reply', '7', 'x').err).toContain('no message 7');
    expect(readThread(dir).replies).toEqual([]);
  });

  test('thinking, show, profile and usage', () => {
    const dir = fresh();
    addMessage(dir, {text: 'help', context: ctx});
    expect(run(dir, 'thinking', '1').code).toBe(0);
    expect(readStatus(dir).thinking).toBe(1);
    expect(run(dir, 'thinking', '1', '--off').code).toBe(0);
    expect(readStatus(dir).thinking).toBe(null);
    expect(run(dir, 'show', '1').out).toContain('"songId": "fur-elise"');
    expect(run(dir, 'profile').out).toContain('Student profile');
    expect(readProfile(dir)).toBe(null);
    writeFileSync(join(dir, 'student.md'), '# Ana\nGoal: Für Elise by June');
    expect(run(dir, 'profile').out).toBe('# Ana\nGoal: Für Elise by June');
    expect(run(dir, 'actions').out).toContain('open_exercise');
    expect(run(dir, 'bogus')).toMatchObject({code: 1});
    expect(run(dir, 'bogus').err).toContain('usage');
  });
});
