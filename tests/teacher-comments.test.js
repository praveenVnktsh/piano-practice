// Teacher, Phase 14: bar comments (store, CLI, endpoints), "Ask about these bars" (context.ask)
// and the progress report's heat strip, tempo ladder and learn plans. Every test writes to a
// fresh temp dir, never to .teacher/ or .data/.
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {askLines, formatContext, main} from '../teacher/cli.js';
import {teacherHandler} from '../teacher/plugin.js';
import {progressReport, readProgressDoc} from '../teacher/report.js';
import {heatStrip, ladderLine, learnPlan, learnPlans, planLine, tempoLadder} from '../teacher/insights.js';
import {
  addComment, addMessage, dismissComment, markCommentRead, readComments, readMessages, readThread, removeComment,
} from '../teacher/store.js';
import {
  askAttachment, barsLabel, commentsFor, commentsOver, compactResult, isLiveComment, lastResultFor, unreadCount,
} from '../src/teacher/comments.mjs';
import {readExerciseScore} from '../teacher/exercises.js';
import {addExercise} from '../teacher/compose.js';
import {resolveTeacherExercise, teacherExercises} from '../src/teacher/exercises.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'teacher-comments-'));
const run = (argv, dir, opts) => {
  const out = [], err = [];
  const code = main(argv, dir, s => out.push(s), s => err.push(s), opts);
  return {code, out: out.join('\n'), err: err.join('\n')};
};
const CATALOG = [{id: 'fur-elise', title: 'Für Elise', tempo: 72}];

describe('bar comments in the store', () => {
  test('added, validated, read, dismissed and removed; ids are never reused', () => {
    const dir = fresh();
    const c = addComment(dir, {songId: 'fur-elise', first: 4, last: 7, text: '  Lift the wrist here.  '});
    expect(c).toMatchObject({id: 1, songId: 'fur-elise', first: 4, last: 7, text: 'Lift the wrist here.'});
    expect(addComment(dir, {songId: 'fur-elise', first: 0, text: 'Count in'})).toMatchObject({id: 2, first: 0, last: 0});
    expect(() => addComment(dir, {songId: '', first: 0, text: 'x'})).toThrow(/song id/);
    expect(() => addComment(dir, {songId: 'a b', first: 0, text: 'x'})).toThrow(/song id/);
    expect(() => addComment(dir, {songId: 'x', first: -1, text: 'x'})).toThrow(/first bar/);
    expect(() => addComment(dir, {songId: 'x', first: 3, last: 2, text: 'x'})).toThrow(/last bar/);
    expect(() => addComment(dir, {songId: 'x', first: 0, text: ' '})).toThrow(/text/);
    expect(() => addComment(dir, {songId: 'x', first: 0, text: 'x'.repeat(501)})).toThrow(/500/);

    const read = markCommentRead(dir, 1);
    expect(read.readAt).toBeTruthy();
    expect(markCommentRead(dir, '1').readAt).toBe(read.readAt);
    const gone = dismissComment(dir, 2);
    expect(gone.dismissedAt).toBeTruthy();
    expect(gone.readAt).toBe(gone.dismissedAt);
    expect(() => markCommentRead(dir, 9)).toThrow(/no comment 9/);
    expect(readThread(dir).comments.map(x => x.id)).toEqual([1, 2]);

    expect(removeComment(dir, 2).id).toBe(2);
    expect(() => removeComment(dir, 2)).toThrow(/no comment/);
    expect(addComment(dir, {songId: 'fur-elise', first: 8, text: 'New'}).id).toBe(3); // 2 stays retired
    expect(JSON.parse(readFileSync(join(dir, 'comments.json'), 'utf8')).lastId).toBe(3);
  });
  test('a broken file reads as no comments', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'comments.json'), '{nope');
    expect(readComments(dir)).toEqual([]);
    expect(addComment(dir, {songId: 'x', first: 0, text: 'ok'}).id).toBe(1);
  });
});

describe('CLI: comment, comments, uncomment', () => {
  test('bar numbers count from 1; listing hides dismissed comments unless --all', () => {
    const dir = fresh();
    let r = run(['comment', 'fur-elise', '5', '8', 'Lift', 'the', 'wrist'], dir, {catalog: CATALOG});
    expect(r).toMatchObject({code: 0, err: ''});
    expect(r.out).toMatch(/Comment #1 pinned to bars 5–8 of fur-elise/);
    expect(readComments(dir)[0]).toMatchObject({first: 4, last: 7, text: 'Lift the wrist'});

    r = run(['comment', 'unknown-piece', '2', '2', 'Hello'], dir, {catalog: CATALOG});
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/bar 2 of unknown-piece/);
    expect(r.err).toMatch(/isn't in the bundled or local catalog/);
    expect(run(['comment', 'import:abc', '1', '1', 'Imported'], dir, {catalog: CATALOG}).err).toBe('');

    expect(run(['comment', 'fur-elise', '0', '3', 'x'], dir, {catalog: CATALOG})).toMatchObject({code: 1, err: /bar number/});
    expect(run(['comment', 'fur-elise', '4', '3', 'x'], dir, {catalog: CATALOG}).code).toBe(1);
    expect(run(['comment', 'fur-elise', '4'], dir).err).toMatch(/usage/);

    dismissComment(dir, 2);
    r = run(['comments'], dir);
    expect(r.out).toMatch(/#1 fur-elise bars 5–8 · unread · \d{4}-\d\d-\d\d: Lift the wrist/);
    expect(r.out).not.toMatch(/unknown-piece/);
    expect(run(['comments', '--all'], dir).out).toMatch(/#2 unknown-piece bar 2 · dismissed/);
    expect(run(['comments', 'fur-elise'], dir).out.split('\n')).toHaveLength(1);
    expect(run(['comments', 'nothing'], dir).out).toBe('No bar comments on nothing.');

    expect(run(['uncomment', '1'], dir).out).toBe('Removed comment #1 (fur-elise).');
    expect(run(['uncomment', '1'], dir)).toMatchObject({code: 1, err: 'no comment 1'});
  });
});

describe('endpoints: GET /comments, read and dismiss', () => {
  let server, handler;
  afterEach(() => { handler?.close(); server?.closeAllConnections?.(); server?.close(); });
  async function serve(dir) {
    handler = teacherHandler(dir, {pollMs: 100});
    server = createServer((req, res) => {
      req.url = req.url.slice('/__teacher'.length) || '/';
      handler(req, res, () => { res.statusCode = 404; res.end('next'); });
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${server.address().port}/__teacher`;
  }
  const post = url => fetch(url, {method: 'POST'});

  test('lists (per song), marks read, dismisses; the thread carries them', async () => {
    const dir = fresh();
    addComment(dir, {songId: 'fur-elise', first: 4, last: 7, text: 'Wrist'});
    addComment(dir, {songId: 'minuet-in-g', first: 0, last: 1, text: 'Light'});
    const url = await serve(dir);
    expect((await (await fetch(url + '/comments')).json()).comments).toHaveLength(2);
    const one = await (await fetch(url + '/comments?songId=fur-elise')).json();
    expect(one.comments.map(c => c.text)).toEqual(['Wrist']);
    let res = await post(url + '/comments/1/read');
    expect(res.status).toBe(200);
    expect((await res.json()).readAt).toBeTruthy();
    res = await post(url + '/comments/2/dismiss');
    expect((await res.json()).dismissedAt).toBeTruthy();
    expect((await post(url + '/comments/9/read')).status).toBe(404);
    expect((await post(url + '/comments/1/delete')).status).toBe(404); // not an endpoint: falls through
    const thread = await (await fetch(url)).json();
    expect(thread.comments.map(c => [c.id, !!c.readAt, !!c.dismissedAt])).toEqual([[1, true, false], [2, true, true]]);
  });
});

describe('src/teacher/comments.mjs', () => {
  const list = [
    {id: 1, songId: 'a', first: 4, last: 7, text: 'x'},
    {id: 2, songId: 'a', first: 0, last: 0, text: 'y', readAt: 'r'},
    {id: 3, songId: 'a', first: 30, last: 40, text: 'past the end'},
    {id: 4, songId: 'a', first: 10, last: 20, text: 'clamped'},
    {id: 5, songId: 'b', first: 0, last: 0, text: 'other piece'},
    {id: 6, songId: 'a', first: 1, last: 1, text: 'gone', dismissedAt: 'd'},
    {id: 'bad', songId: 'a', first: 0, last: 0, text: 'z'},
  ];
  test('commentsFor: this piece, live, clamped, in bar order, minus ones hidden here', () => {
    expect(commentsFor(list, 'a', 16).map(c => [c.id, c.first, c.last])).toEqual([[2, 0, 0], [1, 4, 7], [4, 10, 15]]);
    expect(commentsFor(list, 'a', 16, new Set([1])).map(c => c.id)).toEqual([2, 4]);
    expect(commentsFor(list, 'a', 0)).toEqual([]);
    expect(commentsFor(null, 'a', 10)).toEqual([]);
    expect(isLiveComment(list[5])).toBe(false);
    expect(unreadCount(commentsFor(list, 'a', 16))).toBe(2);
    expect(commentsOver(commentsFor(list, 'a', 16), 6, 11).map(c => c.id)).toEqual([1, 4]);
  });
  test('barsLabel and lastResultFor prefer the same section, then covering, then overlapping passes', () => {
    expect(barsLabel(4, 7)).toBe('bars 5–8');
    expect(barsLabel(4, 4)).toBe('bar 5');
    expect(barsLabel(0, 3, i => (i === 0 ? 'pickup' : String(i)))).toBe('bars pickup–3');
    const results = [
      {songId: 'a', section: [6, 9], accuracy: 50},
      {songId: 'a', section: [0, 15], accuracy: 70},
      {songId: 'a', section: [4, 7], accuracy: 80},
      {songId: 'b', section: [4, 7], accuracy: 99},
    ];
    expect(lastResultFor(results, 'a', [4, 7]).accuracy).toBe(80);
    expect(lastResultFor(results, 'a', [3, 7]).accuracy).toBe(70);
    expect(lastResultFor(results, 'a', [8, 20]).accuracy).toBe(50);
    expect(lastResultFor(results, 'a', [30, 31])).toBe(null);
    expect(lastResultFor(undefined, 'a', [0, 0])).toBe(null);
  });
  test('askAttachment carries the piece, the bars, a trimmed last pass and the comments', () => {
    const pass = {songId: 'a', title: 'A', section: [4, 7], mode: 'wait', hands: 'both', tempo: 60, right: 20, wrong: 3, accuracy: 87,
      misses: Array.from({length: 40}, (_, i) => ({measure: String(5 + (i % 4)), expected: ['E5'], played: ['F5']})),
      dynamics: {remarks: ['A little loud in bars 5–6.']}, evenness: {score: 80}, at: 1};
    const a = askAttachment({songId: 'a', title: 'A', section: [4, 7], bars: 'bars 5–8', tempo: 59.6, hands: 'both',
      results: [pass], comments: [{id: 1, first: 4, last: 7, text: 'Wrist', at: 'x', songId: 'a'}]});
    expect(a).toMatchObject({songId: 'a', section: [4, 7], bars: 'bars 5–8', tempo: 60, hands: 'both', comments: [{id: 1, first: 4, last: 7, text: 'Wrist'}]});
    expect(a.lastResult.misses).toHaveLength(30);
    expect(a.lastResult.remarks).toEqual(['A little loud in bars 5–6.']);
    expect(a.lastResult).not.toHaveProperty('evenness');
    expect(askAttachment({songId: 'a', section: [0, 1]})).toMatchObject({title: 'a', bars: 'bars 1–2', lastResult: null});
    expect(compactResult(null)).toBe(null);
  });
});

describe('Ask about these bars: what the CLI shows', () => {
  const ask = {
    songId: 'fur-elise', title: 'Für Elise', section: [4, 7], bars: 'bars 5–8', tempo: 60, hands: 'both',
    lastResult: {section: [4, 7], mode: 'wait', hands: 'both', tempo: 60, right: 20, wrong: 3, accuracy: 87, at: Date.UTC(2026, 10, 25),
      misses: [{measure: '6', expected: ['E5'], played: ['F5']}], remarks: ['Keep the left hand lighter.']},
    comments: [{id: 2, first: 4, last: 7, text: 'Lift the wrist here'}],
  };
  test('formatContext and show print the attachment; list --open too', () => {
    const text = formatContext({route: '#/play/fur-elise', player: null, ask});
    expect(text).toMatch(/ASKING ABOUT bars 5–8 of Für Elise \[fur-elise\] · section \[4, 7\] · ♩ = 60 · both hands/);
    expect(text).toMatch(/last pass here: bars 5–8 · both · wait · 60 BPM · 87% \(20 right, 3 wrong\)/);
    expect(text).toMatch(/miss bar 6: expected E5; played F5/);
    expect(text).toMatch(/remark: Keep the left hand lighter\./);
    expect(text).toMatch(/your comment #2 on bars 5–8: Lift the wrist here/);
    expect(askLines({songId: 'x', section: [0, 0]}).join('\n')).toMatch(/bars 1–1 of x[\s\S]*no practice pass over these bars yet/);

    const dir = fresh();
    addMessage(dir, {text: 'About bars 5–8: why do I trip here?', context: {ask}});
    expect(readMessages(dir)[0].context.ask.section).toEqual([4, 7]);
    expect(run(['show', '1'], dir).out).toMatch(/ASKING ABOUT bars 5–8/);
    expect(run(['list', '--open'], dir).out).toMatch(/last pass here/);
  });
});

describe('progress: heat strip, tempo ladder, learn plans, comments', () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const pass = (over = {}) => ({type: 'practice:result', songId: 'fur-elise', title: 'Für Elise', section: [0, 7], mode: 'timed', hands: 'both',
    tempo: 60, accuracy: 96, right: 40, wrong: 1, at: now - 864e5, tz: 0, misses: [], ...over});
  const doc = () => ({
    events: [
      pass({tempo: 56}),
      pass({tempo: 60, at: now - 80e6}),
      pass({tempo: 66, accuracy: 80, misses: [{measure: '6', expected: ['E5'], played: ['F5']}], at: now - 70e6}),
      pass({section: [8, 11], mode: 'wait', tempo: 50, accuracy: 70, misses: [{measure: '10', expected: ['A4'], played: []}], at: now - 60e6}),
      pass({section: [8, 11], mode: 'timed', tempo: 66, accuracy: 99, strategy: 'dotted', at: now - 50e6}),
      pass({section: [0, 7], hands: 'right', tempo: 72, at: now - 40e6}),
    ],
    totals: {days: {}, songs: {'fur-elise': {title: 'Für Elise', attempts: 6}}, trainer: {},
      learn: {'fur-elise': {title: 'Für Elise', active: true, done: ['p1-listen', 'p1-right'], total: 12, next: {key: 'p1-left', label: 'Bars 1–8, left hand alone'}, lastAt: now},
        'minuet-in-g': {title: 'Minuet in G', active: false, done: [], total: 10, next: {key: 'p1-listen', label: 'Listen to bars 1–8'}, lastAt: now - 1}}},
    settings: {dailyGoalMin: 20}, journal: [], goals: [],
  });

  test('heatStrip: one character per bar, grouped by four', () => {
    const h = heatStrip(doc(), 'fur-elise', {measureCount: 14});
    expect(h.counts).toEqual({good: 10, fair: 0, weak: 2}); // bar 6: 3 of 4 passes clean; bar 10: 1 of 2
    expect(h.text).toBe('1 GGGG  5 GWGG  9 GWGG  13 ··');
    expect(heatStrip(doc(), 'nothing')).toBe(null);
  });
  test('tempoLadder: best clean play-along tempo per section and hands, with the next step', () => {
    const rows = tempoLadder(doc(), 'fur-elise', {target: 72});
    const both = rows.find(r => r.hands === 'both' && r.section[0] === 0);
    expect(both).toMatchObject({best: 60, next: 63, atTarget: false, passes: 3});
    expect(ladderLine(both)).toBe('bars 1–8: clean at ♩ 60 → next ♩ 63 (target 72)');
    const right = rows.find(r => r.hands === 'right');
    expect(ladderLine(right)).toBe('bars 1–8 (right hand): clean at ♩ 72 (at target 72)');
    const later = rows.find(r => r.section[0] === 8);
    expect(later.best).toBe(null); // wait mode, and a dotted-rhythm pass doesn't count
    expect(ladderLine(later)).toMatch(/bars 9–12: no clean play-along pass yet, best 99% at ♩ 66/);
    expect(rows[0].hands).toBe('right'); // most recent first
  });
  test('learnPlan reads totals.learn defensively', () => {
    expect(learnPlan(doc(), 'fur-elise')).toMatchObject({active: true, done: 2, total: 12, next: 'Bars 1–8, left hand alone'});
    expect(planLine(learnPlan(doc(), 'fur-elise'))).toBe('2 of 12 steps done · next: Bars 1–8, left hand alone');
    expect(planLine({done: 10, total: 10, active: true})).toBe('10 of 10 steps done, finished');
    expect(planLine(learnPlan(doc(), 'minuet-in-g'))).toMatch(/0 of 10 steps done \(stopped\) · next: Listen/);
    expect(learnPlan({totals: {learn: {x: 'junk'}}}, 'x')).toBe(null);
    expect(learnPlan({}, 'x')).toBe(null);
    expect(learnPlans({totals: {learn: []}})).toEqual([]);
    expect(learnPlans(doc()).map(p => p.songId)).toEqual(['fur-elise', 'minuet-in-g']);
  });
  test('the report shows them per piece, with the teacher\'s comments', () => {
    const dir = fresh();
    addComment(dir, {songId: 'fur-elise', first: 4, last: 7, text: 'Wrist'});
    addComment(dir, {songId: 'fur-elise', first: 9, last: 9, text: 'gone'});
    dismissComment(dir, 2);
    const r = run(['progress'], dir, {progress: doc(), catalog: CATALOG});
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/heat strip \(G clean ≥95% · f ≥80% · W below · · not yet\): 10 G, 0 f, 2 W/);
    expect(r.out).toMatch(/ {8}1 GGGG {2}5 GWGG {2}9 GWGG$/m);
    expect(r.out).toMatch(/tempo ladder: .*bars 1–8: clean at ♩ 60 → next ♩ 63 \(target 72\)/);
    expect(r.out).toMatch(/learn plan: 2 of 12 steps done · next: Bars 1–8, left hand alone/);
    expect(r.out).toMatch(/your bar comments: #1 bars 5–8 \(unread\)$/m);
    expect(r.out).toMatch(/Learn plans \(pieces with no practice passes yet\):\n {2}Minuet in G \[minuet-in-g\]: 0 of 10/);
    expect(progressReport(doc(), CATALOG, {now})).not.toMatch(/your bar comments/);
  });
  test('readProgressDoc keeps totals.learn from the file', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'p.json'), JSON.stringify(doc()));
    expect(readProgressDoc(join(dir, 'p.json')).totals.learn['fur-elise'].total).toBe(12);
  });
});

describe('teacher exercises (P2): composed from .notes, served, resolved as tex:<n>', () => {
  const NOTES = 'time: 4/4\nkey: 1\ntempo: 60\n---\nRH: g4/4 a4 b4 c5 | d5/2 d5 |\nLH: g3/1 | d3/1 |\n';
  let server, handler;
  afterEach(() => { handler?.close(); server?.closeAllConnections?.(); server?.close(); });

  test('store and CLI: exercise, exercises, unexercise', () => {
    const dir = fresh();
    expect(() => addExercise(dir, {title: '', notes: NOTES})).toThrow(/title/);
    expect(() => addExercise(dir, {title: 'x', notes: 'RH: c4 |'})).toThrow(/RH and LH/);
    const ex = addExercise(dir, {title: 'Thumb under', notes: NOTES, about: 'for the run', songId: 'fur-elise', first: 4, last: 7});
    expect(ex).toMatchObject({id: 1, title: 'Thumb under', about: 'for the run', songId: 'fur-elise', first: 4, last: 7});
    const xml = readExerciseScore(dir, 1);
    expect(xml).toMatch(/<work-title>Thumb under<\/work-title>/);
    expect(xml).toMatch(/Your teacher/);
    expect(readExerciseScore(dir, 2)).toBe(null);

    const file = join(dir, 'x.notes');
    writeFileSync(file, 'RH: c4/1 |\nLH: c3/1 |\n'); // music only: the header is optional
    const r = run(['exercise', 'C, slowly', file, '--song', 'fur-elise', '--bars', '9-12', '--about', 'Evenness'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/tex:2 “C, slowly” is in Exercises → From your teacher/);
    expect(run(['exercises'], dir).out).toMatch(/tex:2 · \d{4}-\d\d-\d\d · C, slowly · for fur-elise bars 9–12 — Evenness/);
    expect(run(['exercise', 'x', join(dir, 'missing.notes')], dir)).toMatchObject({code: 1, err: /can't read/});
    expect(run(['exercise', 'x', file, '--bars', 'nine'], dir).code).toBe(1);
    expect(run(['unexercise', 'tex:1'], dir).out).toBe('Removed exercise tex:1.');
    expect(readExerciseScore(dir, 1)).toBe(null);
    expect(addExercise(dir, {title: 'Again', notes: NOTES}).id).toBe(3);
  });

  test('endpoints and the browser side', async () => {
    const dir = fresh();
    addExercise(dir, {title: 'Thumb under', notes: NOTES});
    handler = teacherHandler(dir, {pollMs: 100});
    server = createServer((req, res) => {
      req.url = req.url.slice('/__teacher'.length) || '/';
      handler(req, res, () => { res.statusCode = 404; res.end('next'); });
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const api = `http://127.0.0.1:${server.address().port}/__teacher`;
    expect((await (await fetch(api + '/exercises')).json()).exercises[0].title).toBe('Thumb under');
    const res = await fetch(api + '/exercises/1.musicxml');
    expect(res.headers.get('content-type')).toMatch(/musicxml/);
    expect(await res.text()).toMatch(/<score-partwise/);
    expect((await fetch(api + '/exercises/7.musicxml')).status).toBe(404);

    expect(await teacherExercises({api})).toMatchObject([{id: 'tex:1', title: 'Thumb under'}]);
    expect(await resolveTeacherExercise('tex:1', {api})).toMatchObject({
      entry: {id: 'tex:1', title: 'Thumb under', composer: 'From your teacher', kind: 'exercise'},
      source: {url: `${api}/exercises/1.musicxml`},
    });
    expect(await resolveTeacherExercise('tex:9', {api})).toBe(null);
    expect(await resolveTeacherExercise('ex:9', {api})).toBe(null);
    expect(await teacherExercises({api: 'http://127.0.0.1:1/__teacher'})).toEqual([]);
  });
});
