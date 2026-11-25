// Teacher, Phase 3 app side: assignments, letters, the progress report and the new CLI commands.
import {createServer} from 'node:http';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {formatContext, main} from '../teacher/cli.js';
import {teacherHandler} from '../teacher/plugin.js';
import {progressReport, readCatalog, readProgressDoc} from '../teacher/report.js';
import {
  addAssignment, addLetter, isDay, markLetterRead, readAssignments, readLetters, readThread, setAssignmentDone,
} from '../teacher/store.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'teacher-learning-'));
const run = (argv, dir, opts) => {
  const out = [], err = [];
  const code = main(argv, dir, s => out.push(s), s => err.push(s), opts);
  return {code, out: out.join('\n'), err: err.join('\n')};
};

describe('assignments and letters in the store', () => {
  test('assignments: validated, numbered, ticked off', () => {
    const dir = fresh();
    const a = addAssignment(dir, {task: '  Bars 5–8, left hand  ', action: {type: 'open_song', id: 'fur-elise'}, due: '2026-12-01'});
    expect(a).toMatchObject({id: 1, task: 'Bars 5–8, left hand', due: '2026-12-01', done: false, action: {type: 'open_song', id: 'fur-elise'}});
    expect(addAssignment(dir, {task: 'C major scale'})).toMatchObject({id: 2, done: false});
    expect(() => addAssignment(dir, {task: ''})).toThrow(/task/);
    expect(() => addAssignment(dir, {task: 'x', due: '2026-02-30'})).toThrow(/date/);
    expect(() => addAssignment(dir, {task: 'x', action: {type: 'set_tempo', bpm: 900}})).toThrow(/bpm/);
    expect(() => addAssignment(dir, {task: 'x'.repeat(301)})).toThrow(/300/);
    expect(setAssignmentDone(dir, 1)).toMatchObject({done: true});
    expect(readAssignments(dir)[0].doneAt).toBeTruthy();
    expect(setAssignmentDone(dir, '1', false)).not.toHaveProperty('doneAt');
    expect(() => setAssignmentDone(dir, 9)).toThrow(/no assignment 9/);
    expect(readThread(dir).assignments).toHaveLength(2);
  });
  test('letters: written, then marked read once', () => {
    const dir = fresh();
    expect(() => addLetter(dir, '  ')).toThrow(/text/);
    const l = addLetter(dir, '# Week 1\n\nMuch steadier.');
    expect(l).toMatchObject({id: 1, text: '# Week 1\n\nMuch steadier.'});
    expect(readLetters(dir)[0]).not.toHaveProperty('readAt');
    const read = markLetterRead(dir, 1);
    expect(read.readAt).toBeTruthy();
    expect(markLetterRead(dir, 1).readAt).toBe(read.readAt);
    expect(() => markLetterRead(dir, 2)).toThrow(/no letter/);
  });
  test('isDay checks real dates; corrupt files read as empty', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('26-1-1')).toBe(false);
    const dir = fresh();
    writeFileSync(join(dir, 'assignments.json'), '{oops');
    writeFileSync(join(dir, 'letters.json'), JSON.stringify({letters: [{id: 'x'}, {id: 3, text: 'ok', at: 'now'}]}));
    expect(readAssignments(dir)).toEqual([]);
    expect(readLetters(dir).map(l => l.id)).toEqual([3]);
  });
});

describe('CLI: assign, assignments, done, letter, letters, progress', () => {
  test('assign with --action and --due, list, tick off', () => {
    const dir = fresh();
    let r = run(['assign', 'Left', 'hand', 'bars 9–12', '--action', '{"type":"open_exercise","id":"ex:scale:G:major:both:2:up-down"}', '--due', '2026-12-02'], dir);
    expect(r).toMatchObject({code: 0});
    expect(r.out).toMatch(/Assigned #1: Left hand bars 9–12 \(due 2026-12-02\)/);
    expect(readAssignments(dir)[0].action.id).toBe('ex:scale:G:major:both:2:up-down');
    r = run(['assignments'], dir);
    expect(r.out).toMatch(/#1 \[ \] Left hand bars 9–12 · due 2026-12-02/);
    expect(run(['done', '1'], dir).out).toMatch(/Done: #1/);
    expect(run(['assignments'], dir).out).toBe('No open assignments.');
    expect(run(['assignments', '--all'], dir).out).toMatch(/#1 \[done\]/);
    expect(run(['done', '1', '--undo'], dir).out).toMatch(/Open again/);
  });
  test('assign refuses bad input with a reason', () => {
    const dir = fresh();
    expect(run(['assign', 'x', '--action', '{bad'], dir)).toMatchObject({code: 1, err: expect.stringMatching(/not valid JSON/)});
    expect(run(['assign', 'x', '--action', '{"type":"plan","items":[{"label":"a"}]}'], dir).err).toMatch(/not a plan/);
    expect(run(['assign', 'x', '--due'], dir).err).toMatch(/--due needs a value/);
    expect(run(['assign', 'x', '--action', '{"type":"set_hands","hands":"three"}'], dir).err).toMatch(/hands must be one of/);
    expect(run(['done', '4'], dir)).toMatchObject({code: 1, err: 'no assignment 4'});
    expect(readAssignments(dir)).toEqual([]);
  });
  test('letter and letters (newest first, read state)', () => {
    const dir = fresh();
    expect(run(['letter', '# Week 1\nGood start.'], dir).out).toMatch(/Letter 1 written/);
    run(['letter', '# Week 2\nSteadier left hand.'], dir);
    markLetterRead(dir, 1);
    const r = run(['letters'], dir);
    expect(r.out.indexOf('#2')).toBeLessThan(r.out.indexOf('#1'));
    expect(r.out).toMatch(/#2 · \d{4}-\d\d-\d\d · unread/);
    expect(r.out).toMatch(/#1 · .* · read/);
    expect(run(['letter'], dir).code).toBe(1);
  });
  test('progress prints the report from a progress document', () => {
    const now = Date.now();
    const pass = (over = {}) => ({type: 'practice:result', songId: 'fur-elise', title: 'Für Elise', section: [8, 11], mode: 'wait', hands: 'both', tempo: 60, accuracy: 78, at: now - 3 * 864e5, tz: new Date().getTimezoneOffset(), misses: [{measure: '10', expected: ['E5'], played: ['F5']}], ...over});
    const progress = {
      events: [0, 1, 2, 3].map(d => pass({at: now - (3 - d) * 864e5 - 3600e3})),
      totals: {days: {}, songs: {'fur-elise': {title: 'Für Elise', attempts: 4, best: 78}}, trainer: {}},
      settings: {dailyGoalMin: 20}, journal: [{id: 'jjjjjjjj', at: now - 3600e3, tz: 0, text: 'Bar 10 keeps tripping me', mood: 'hard'}],
      goals: [{id: 'gggggggg', songId: 'fur-elise', title: 'Für Elise', bpm: 72, accuracy: 90, by: '2027-03-01'}],
    };
    const r = run(['progress', '--days', '7'], fresh(), {progress, catalog: [{id: 'fur-elise', title: 'Für Elise', tempo: 72}]});
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Für Elise \[fur-elise\]: learning · 4 passes · best 78%/);
    expect(r.out).toMatch(/weakest bars: 10 \(0% of 4\)/);
    expect(r.out).toMatch(/Plateaus/);
    expect(r.out).toMatch(/section \[8, 11\] \(bars 9–12\): 4 days/);
    expect(r.out).toMatch(/Graded path: Beginner/);
    expect(r.out).toMatch(/Für Elise at 72 BPM by 2027-03-01: best clean – BPM/);
    expect(r.out).toMatch(/hard: Bar 10 keeps tripping me/);
  });
  test('the report reads files that are missing or broken without throwing', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'p.json'), 'nope');
    expect(readProgressDoc(join(dir, 'p.json')).events).toEqual([]);
    expect(readCatalog([join(dir, 'missing.json')])).toEqual([]);
    expect(progressReport(readProgressDoc(join(dir, 'p.json')), [], {now: Date.UTC(2026, 0, 5)})).toMatch(/nothing practised yet/);
  });
  test('formatContext shows mastery, weak bars, reviews, plateaus, path, goals, journal and assignments', () => {
    const text = formatContext({
      player: null,
      progress: {
        todayMinutes: 5, dailyGoalMin: 15,
        mastery: [{id: 'fur-elise', title: 'Für Elise', status: 'secure', bestCleanTempo: 60, targetTempo: 72, coverage: 80, measureCount: 100}],
        bars: {songId: 'fur-elise', weakest: [{label: '12', accuracy: 40, attempts: 5}]},
        dueReviews: [{id: 'minuet-in-g', title: 'Minuet in G'}],
        plateaus: [{songId: 'fur-elise', title: 'Für Elise', section: [8, 11], days: 4, firstBest: 78, lastBest: 79}],
        path: {level: 'Grade 1', done: 40, techniqueLeft: ['ex:scale:G:major:both:1:up-down'], readingLeft: ['bass']},
        goals: [{songId: 'fur-elise', title: 'Für Elise', bpm: 72, by: '2027-03-01', bestTempo: 60, daysLeft: 90, met: false}],
        journal: [{at: '2026-11-20T10:00:00Z', text: 'Left hand better', mood: 'good'}],
      },
      assignments: [{id: 3, task: 'C major scale, hands together', due: '2026-11-30'}],
    });
    expect(text).toMatch(/mastery Für Elise \[fur-elise\]: secure, clean up to 60 BPM \(target 72\), 80% of 100 bars secure/);
    expect(text).toMatch(/weakest bars in fur-elise: 12 40% \(5 passes\)/);
    expect(text).toMatch(/due for review: Minuet in G \[minuet-in-g\]/);
    expect(text).toMatch(/PLATEAU Für Elise/);
    expect(text).toMatch(/path: Grade 1 40%/);
    expect(text).toMatch(/goal Für Elise 72 BPM by 2027-03-01: best 60 BPM, 90 days left/);
    expect(text).toMatch(/journal 2026-11-20 \(good\): Left hand better/);
    expect(text).toMatch(/assignment #3: C major scale, hands together \(due 2026-11-30\)/);
  });
  test('formatContext prints the musicality of a result and a recording', () => {
    const musicality = {
      shape: {score: 72, hint: 'Taper the cadence in bar 8.', phrases: [{bars: 'bars 1–4', score: 85}, {bars: 'bars 5–8', score: 60}]},
      flex: {label: 'expressive', meanBpm: 72, driftPct: -2, flexPct: 4.5, jitterPct: 3.1, remark: 'The tempo breathes with the phrases.'},
      voicing: {score: 80, melody: 'through', meanDiff: 3, covered: [], remark: 'The melody comes through.'},
    };
    const text = formatContext({
      player: null,
      recentResults: [{title: 'Minuet', songId: 'm', section: [0, 7], hands: 'both', mode: 'timed', tempo: 72, accuracy: 96, right: 50, wrong: 2, musicality}],
      recording: {takeId: 'abcdefgh12', songId: 'm', title: 'Minuet', accuracy: 95, missed: 1, wrong: 0, extra: 0, musicality},
    });
    expect(text).toMatch(/ {6}Phrasing: 72\/100 \(bars 1–4 85, bars 5–8 60\) · Taper the cadence in bar 8\./);
    expect(text).toMatch(/ {6}Tempo feel: expressive · ♩ ≈ 72 · flex ±4.5% · beat-to-beat ±3.1% · drift -2%/);
    expect(text).toMatch(/ {6}Voicing: 80\/100 · The melody comes through\./);
    expect(text.match(/Phrasing:/g)).toHaveLength(2);
  });
});

describe('endpoints: tick homework, read letters', () => {
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
  const post = (url, body) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: body === undefined ? '' : JSON.stringify(body)});

  test('POST /assignments/<id>/done and /letters/<id>/read', async () => {
    const dir = fresh();
    addAssignment(dir, {task: 'Scale of G'});
    addLetter(dir, 'Dear student');
    const url = await serve(dir);
    let res = await post(url + '/assignments/1/done');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({id: 1, done: true});
    res = await post(url + '/assignments/1/done', {done: false});
    expect((await res.json()).done).toBe(false);
    expect((await post(url + '/assignments/7/done')).status).toBe(404);
    res = await post(url + '/letters/1/read');
    expect((await res.json()).readAt).toBeTruthy();
    expect((await post(url + '/letters/2/read')).status).toBe(404);
    expect((await post(url + '/letters/abc/read')).status).toBe(404); // falls through
    const thread = await (await fetch(url)).json();
    expect(thread.assignments[0]).toMatchObject({id: 1, done: false});
    expect(thread.letters[0].readAt).toBeTruthy();
  });
});
