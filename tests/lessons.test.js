// @vitest-environment jsdom
// First lessons for the absolute beginner (src/lessons/): checking logic, task generation,
// illustrations, the view end to end, and the beginner score aids (src/curriculum/aids.js).
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  LESSONS, PASS, blackGroup, fingerNote, lessonBests, lessonById, lessonOfLevel, lessonTasks, noteName, score, startTask, step, targets, toPitch, tuneExample,
} from '../src/lessons/lessons.js';
import {art, handsSvg, keyboardSvg} from '../src/lessons/art.js';
import {engrave} from '../src/theory/engrave.js';
import {mountLesson, mountLessons, loadLessons, STORE_KEY} from '../src/lessons/view.js';
import {parseRoute} from '../src/app/router.js';
import {aidsFor, isBeginnerPiece, studentIsBeginner} from '../src/curriculum/aids.js';
import {curriculum} from '../src/curriculum/levels.js';
import {appendEvents, emptyDoc, sanitizeEvent, skillOf, isSkillLevel} from '../src/progress/model.js';
import {readingSummary, skillSummary} from '../src/progress/stats.js';

/** Feeds notes to step() → the verdicts. */
function run(task, notes) {
  let state = startTask();
  return notes.map(n => { const r = step(task, state, n); state = r.state; return r.verdict; });
}

/** Keys that answer a task correctly. */
function answer(task) {
  if (task.kind === 'note') return [task.midi];
  if (task.kind === 'tune') return task.notes;
  if (task.kind === 'group') return task.size === 2 ? [61, 63] : [66, 68, 70];
  return Array.from({length: task.count}, (_, i) => 48 + task.pcs[0] + 12 * i);
}

describe('checking what was played', () => {
  it('note names and black-key groups', () => {
    expect([60, 61, 62, 63, 64, 70].map(noteName)).toEqual(['C', 'C♯', 'D', 'E♭', 'E', 'B♭']);
    expect(blackGroup(61)).toEqual({size: 2, id: 10});
    expect(blackGroup(63)).toEqual(blackGroup(61));
    expect(blackGroup(73)).not.toEqual(blackGroup(61)); // the next octave's group
    expect(blackGroup(66).size).toBe(3);
    expect(blackGroup(70)).toEqual(blackGroup(66));
    expect(blackGroup(60)).toBeNull();
  });

  it('a key by name: any octave, different keys, wrong names are slips', () => {
    const t = {kind: 'pc', pcs: [0], count: 3};
    expect(run(t, [60, 62, 60, 48, 72, 84])).toEqual(['ok', 'wrong', 'ignore', 'ok', 'done', 'ignore']);
  });

  it('a group of black keys: all keys of one group, starting afresh in another group', () => {
    const two = {kind: 'group', size: 2};
    expect(run(two, [61, 63])).toEqual(['ok', 'done']);
    expect(run(two, [63, 66, 61])).toEqual(['ok', 'wrong', 'done']);
    expect(run(two, [61, 73, 75])).toEqual(['ok', 'ok', 'done']); // moved up an octave: that group counts
    expect(run(two, [61, 61, 60])).toEqual(['ok', 'ignore', 'wrong']);
    expect(run({kind: 'group', size: 3}, [66, 68, 70])).toEqual(['ok', 'ok', 'done']);
    expect(run({kind: 'group', size: 3}, [66, 61])).toEqual(['ok', 'wrong']);
  });

  it('one exact key: the octave matters', () => {
    expect(run({kind: 'note', midi: 60}, [72, 60, 60])).toEqual(['wrong', 'done', 'ignore']);
  });

  it('a tune: notes in order; a slip does not restart it', () => {
    const t = {kind: 'tune', notes: [64, 62, 60]};
    expect(run(t, [64, 60, 62, 60])).toEqual(['ok', 'wrong', 'ok', 'done']);
  });

  it('targets: where the answer is, or the next note of a tune', () => {
    expect(targets({kind: 'pc', pcs: [0], count: 2}, {...startTask(), played: [60]}, 48, 72)).toEqual([48, 72]);
    expect(targets({kind: 'group', size: 2}, startTask(), 60, 72)).toEqual([61, 63]);
    expect(targets({kind: 'note', midi: 64})).toEqual([64]);
    expect(targets({kind: 'tune', notes: [64, 62]}, {...startTask(), pos: 1})).toEqual([62]);
  });

  it('score: accuracy over every key, and the pass mark', () => {
    expect(score(8, 2)).toEqual({right: 8, wrong: 2, accuracy: 80, passed: true});
    expect(score(7, 3).passed).toBe(false);
    expect(score(0, 0)).toMatchObject({accuracy: 0, passed: false});
    expect(PASS).toBe(80);
  });
});

describe('the lessons', () => {
  it('four lessons in order, each with cards and things to play', () => {
    expect(LESSONS.map(l => l.id)).toEqual(['keyboard', 'fingers', 'middle-c', 'first-tunes']);
    for (const l of LESSONS) {
      expect(l.cards.length, l.id).toBeGreaterThan(0);
      for (const c of l.cards) expect(c.art || c.example, `${l.id}: ${c.title}`).toBeTruthy();
      const tasks = lessonTasks(l, 7);
      expect(tasks.length, l.id).toBeGreaterThanOrEqual(6);
      expect(tasks.length, l.id).toBeLessThanOrEqual(10);
      for (const t of tasks) {
        expect(t.prompt, l.id).toBeTruthy();
        expect(t.hint, `${l.id}: ${t.prompt}`).toBeTruthy();
        // The answer plays through cleanly; the last key completes the task.
        const verdicts = run(t, answer(t));
        expect(verdicts.at(-1), `${l.id}: ${t.prompt}`).toBe('done');
        expect(verdicts.includes('wrong')).toBe(false);
      }
    }
    expect(lessonById('fingers').title).toBe('Fingers and posture');
    expect(lessonById('nope')).toBeNull();
  });

  it('the same seed gives the same tasks; another seed may shuffle them', () => {
    const l = lessonById('fingers');
    expect(lessonTasks(l, 42)).toEqual(lessonTasks(l, 42));
    const seen = new Set([1, 2, 3, 4, 5, 6].map(s => lessonTasks(l, s).map(t => t.prompt).join('|')));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('finger numbers: C position and middle-C position', () => {
    expect(fingerNote('c', 'r', 3)).toBe(64);      // E4
    expect(fingerNote('c', 'r', 1)).toBe(60);      // middle C
    expect(fingerNote('c', 'l', 5)).toBe(48);      // C3
    expect(fingerNote('c', 'l', 1)).toBe(55);      // G3
    expect(fingerNote('middle-c', 'l', 1)).toBe(60);
    expect(fingerNote('middle-c', 'l', 5)).toBe(53); // F3
    const fingers = lessonTasks(lessonById('fingers'), 3);
    expect(fingers).toHaveLength(8);
    expect(new Set(fingers.map(t => t.prompt)).size).toBe(8);
    for (const t of fingers) expect(t.midi).toBe(fingerNote('c', t.hand, t.finger));
    const e4 = lessonTasks(lessonById('fingers'), 1).concat(lessonTasks(lessonById('fingers'), 2)).find(t => t.hand === 'r' && t.finger === 3);
    if (e4) expect(e4).toMatchObject({kind: 'note', midi: 64, prompt: 'Right hand, finger 3'});
  });

  it('every tune stays in a five-finger position and engraves with its fingering', () => {
    for (const l of LESSONS) for (const t of lessonTasks(l, 1).filter(x => x.kind === 'tune')) {
      expect(t.fingers).toHaveLength(t.notes.length);
      expect(Math.max(...t.notes) - Math.min(...t.notes), t.prompt).toBeLessThanOrEqual(t.staff === 'grand' ? 14 : 7);
      const ex = tuneExample(t);
      const {svg, events} = engrave(ex);
      expect(svg).toContain('<svg');
      expect(events.filter(e => !ex.measures.flat()[e.i]?.rest)).toHaveLength(t.notes.length);
      for (const m of ex.measures) expect(m.reduce((a, e) => a + e.dur, 0), t.prompt).toBeCloseTo(4);
    }
    expect(toPitch(61)).toEqual({step: 'C', alter: 1, octave: 4});
    expect(toPitch(55, 'bass')).toEqual({step: 'G', alter: 0, octave: 3, clef: 'bass'});
  });

  it('lessons passed, from progress events and totals', () => {
    expect(lessonOfLevel('lesson:keyboard')).toBe('keyboard');
    expect(lessonOfLevel('treble')).toBeNull();
    const doc = {events: [{type: 'trainer:result', level: 'lesson:keyboard', accuracy: 70}, {type: 'trainer:result', level: 'lesson:keyboard', accuracy: 90}, {type: 'trainer:result', level: 'treble', accuracy: 100}],
      totals: {skills: {lesson: {levels: {fingers: 85}}}}};
    expect(lessonBests(doc)).toEqual({keyboard: 90, fingers: 85});
    expect(lessonBests(null)).toEqual({});
  });
});

describe('illustrations', () => {
  it('every art id draws, with colours only from classes (tokens in lessons.css)', () => {
    const ids = ['groups', 'cde', 'middle-c', 'posture', 'hand-shape', 'hands', 'c-position', 'middle-c-position', 'group-2', 'group-3', 'hand-r', 'hand-l'];
    for (const id of ids) {
      const svg = art(id);
      expect(svg, id).toMatch(/^<svg[^>]*class="la-art/);
      expect(svg, id).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(|fill="[a-z]|stroke="[a-z]/i);
      expect(svg, id).toContain('aria-hidden="true"');
    }
    for (const l of LESSONS) for (const c of l.cards) if (c.art) expect(art(c.art), c.art).not.toBe('');
    expect(art('nothing')).toBe('');
  });
  it('keyboards mark keys; hands number the fingers', () => {
    const kb = keyboardSvg({lo: 60, hi: 64, marks: {60: 'on'}, labels: {60: 'C'}, fingers: {60: 1}});
    expect(kb.match(/la-white/g)).toHaveLength(3);
    expect(kb.match(/la-black/g)).toHaveLength(2);
    expect(kb).toContain('is-on');
    expect(kb).toContain('>C<');
    const h = handsSvg({hands: ['r'], on: {hand: 'r', finger: 3}});
    for (const n of [1, 2, 3, 4, 5]) expect(h).toContain(`>${n}</text>`);
    expect(h.match(/la-digit is-on/g)).toHaveLength(1);
  });
});

describe('progress: lesson results are their own skill', () => {
  it('lesson:<id> levels count as practice but stay out of note reading', () => {
    expect(skillOf('lesson:middle-c')).toEqual({skill: 'lesson', id: 'middle-c'});
    expect(isSkillLevel('lesson:keyboard')).toBe(true);
    expect(isSkillLevel('rhythm:quavers')).toBe(true);
    expect(isSkillLevel('treble')).toBe(false);
    const at = Date.UTC(2026, 10, 20, 12);
    const ev = (level, right, wrong) => sanitizeEvent({type: 'trainer:result', at, tz: 0, level, right, wrong, accuracy: 100 * right / (right + wrong), avgMs: 900, durationMs: 60000});
    const doc = emptyDoc();
    appendEvents(doc, [ev('treble', 18, 2), ev('lesson:keyboard', 9, 1), ev('lesson:fingers', 6, 4)], {now: at});
    expect(readingSummary(doc)).toMatchObject({drills: 1});
    expect(doc.totals.skills.lesson.levels).toEqual({keyboard: 90, fingers: 60});
    expect(skillSummary(doc).lesson).toMatchObject({drills: 2, levels: 1}); // only passed lessons count
  });
});

describe('beginner score aids', () => {
  const lib = [{id: 'hot-cross-buns', grade: 0, difficulty: 'beginner'}, {id: 'minuet-in-g', grade: 1, difficulty: 'easy'}];
  it('Grade 0 pieces, never exercises or generated pieces', () => {
    expect(isBeginnerPiece({id: 'hot-cross-buns', grade: 0})).toBe(true);
    expect(isBeginnerPiece({id: 'twinkle', difficulty: 'beginner'})).toBe(true);
    expect(isBeginnerPiece({id: 'x', grade: 1, difficulty: 'beginner'})).toBe(false);
    expect(isBeginnerPiece({id: 'ex:scale:C:major:both:1:up-down', difficulty: 'beginner'})).toBe(false);
    expect(isBeginnerPiece({id: 'sr:beginner:4', grade: 0})).toBe(false);
    expect(isBeginnerPiece(null)).toBe(false);
  });
  it('on while the path is at Beginner, off from Grade 1 (or when the path starts later)', () => {
    expect(studentIsBeginner(null, lib, curriculum)).toBe(true);
    expect(studentIsBeginner({events: [], totals: {songs: {}}, settings: {pathStart: 'grade-1'}}, lib, curriculum)).toBe(false);
    expect(studentIsBeginner(null, lib, () => { throw Error('no path'); })).toBe(true);
    expect(aidsFor({id: 'hot-cross-buns', grade: 0}, {beginner: true})).toEqual({names: true, large: true});
    expect(aidsFor({id: 'hot-cross-buns', grade: 0}, {beginner: false})).toBeNull();
    expect(aidsFor({id: 'minuet-in-g', grade: 1}, {beginner: true})).toBeNull();
  });
});

describe('routes', () => {
  it('the lessons live under Exercises', () => {
    expect(parseRoute('#/exercises/lessons')).toEqual({name: 'lessons'});
    expect(parseRoute('#/exercises/lessons/middle-c')).toEqual({name: 'lesson', arg: 'middle-c'});
    expect(parseRoute('#/exercises/lessons/Bad Id')).toEqual({name: 'today'});
  });
});

describe('the lessons view', () => {
  let results, view;
  const onResult = e => results.push(e.detail);
  const note = n => window.dispatchEvent(new CustomEvent('piano:note', {detail: {note: n, velocity: 80, source: 'midi', time: performance.now()}}));
  const click = el => el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  beforeEach(() => {
    const data = new Map();
    vi.stubGlobal('localStorage', {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), clear: () => data.clear()});
    results = [];
    window.addEventListener('trainer:result', onResult);
  });
  afterEach(() => {
    view?.destroy(); view = null;
    window.removeEventListener('trainer:result', onResult);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('the list shows four lessons and their state', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({lessons: {keyboard: {best: 92, done: true}}}));
    view = mountLessons(document.body);
    const items = [...document.querySelectorAll('.th-item')];
    expect(items.map(a => a.getAttribute('href'))).toEqual(LESSONS.map(l => `#/exercises/lessons/${l.id}`));
    expect(items[0].classList.contains('is-done')).toBe(true);
    expect(items[0].textContent).toContain('Done · 92%');
  });

  it('cards, then every task answered on the keys: a result with a lesson: level', () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const seed = Math.floor(.5 * 0xffffff) + 1;
    const lesson = lessonById('keyboard');
    view = mountLesson(document.body, {lesson: 'keyboard'});
    expect(view.title).toBe('Finding your way');
    expect(document.querySelector('.ls-art svg')).toBeTruthy();
    for (let i = 0; i < lesson.cards.length; i++) click(document.querySelector('.th-next'));
    const tasks = lessonTasks(lesson, seed);
    tasks.forEach((t, i) => {
      expect(document.querySelector('.th-prompt').textContent).toBe(t.prompt);
      if (i === 0) { note(60); expect(document.querySelector('.th-feedback').textContent).toContain('Not quite'); } // one slip
      for (const n of answer(t)) note(n);
      expect(document.querySelector('.th-feedback').textContent).toMatch(/Clean|There it is/);
      vi.advanceTimersByTime(1200); // moves on by itself
    });
    expect(results).toHaveLength(1);
    const right = tasks.reduce((a, t) => a + answer(t).length, 0);
    expect(results[0]).toMatchObject({level: 'lesson:keyboard', right, wrong: 1, passed: true});
    expect(results[0].accuracy).toBe(Math.round(100 * right / (right + 1)));
    expect(loadLessons().lessons.keyboard).toMatchObject({done: true, attempts: 1});
    expect(document.querySelector('.th-results h2').textContent).toBe('Lesson complete');
    expect(document.querySelector('.th-results .btn-primary').getAttribute('href')).toBe('#/exercises/lessons/fingers');
  });

  it('a tune lights its notes as they are played', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    view = mountLesson(document.body, {lesson: 'first-tunes'});
    for (let i = 0; i < lessonById('first-tunes').cards.length; i++) click(document.querySelector('.th-next'));
    expect(document.querySelectorAll('.ls-tune .eg-ev.is-next')).toHaveLength(1);
    note(60); note(62);
    expect(document.querySelectorAll('.ls-tune .eg-ev.is-done')).toHaveLength(2);
    note(70); // a slip: the next key is shown
    expect(document.querySelector('.kb-key.target')?.dataset.note).toBe('64');
  });

  it('an unknown lesson says so', () => {
    view = mountLesson(document.body, {lesson: 'nope'});
    expect(document.body.textContent).toContain('No such lesson');
  });
});
