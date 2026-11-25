import {describe, expect, test} from 'vitest';
import {curriculum, evaluateLevel, exerciseSatisfies, LEVELS, levelById} from '../src/curriculum/levels.js';
import {parseExerciseId} from '../src/exercises/index.js';
import {LEVELS as READING_LEVELS} from '../src/trainer/levels.js';
import {LESSONS} from '../src/lessons/lessons.js';
import {readFileSync} from 'node:fs';

const T0 = Date.UTC(2026, 0, 5, 12);
let n = 0;
const pass = (songId, over = {}) => ({type: 'practice:result', id: 'c' + String(++n).padStart(6, '0'), songId, section: [0, 3], mode: 'wait', hands: 'both', tempo: 200, accuracy: 96, at: T0, tz: 0, ...over});
const drill = (level, accuracy = 95) => ({type: 'trainer:result', level, right: 19, wrong: 1, accuracy, at: T0, tz: 0});
const lesson = (id, accuracy = 90) => ({type: 'trainer:result', level: 'lesson:' + id, right: 18, wrong: 2, accuracy, at: T0, tz: 0});
const ALL_LESSONS = ['keyboard', 'fingers', 'middle-c', 'first-tunes'];
const docOf = (events = [], songs = {}) => ({events, totals: {songs, days: {}, trainer: {}}, settings: {}});
const LIB = [{id: 'twinkle-twinkle', title: 'Twinkle', tempo: 96}, {id: 'ode-to-joy', title: 'Ode to Joy', tempo: 100}, {id: 'minuet-in-g', title: 'Minuet in G', tempo: 108}];

describe('curriculum data', () => {
  test('Beginner then Grade 1–5, every exercise and reading id valid', () => {
    expect(LEVELS.map(l => l.id)).toEqual(['beginner', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5']);
    const reading = new Set(READING_LEVELS.map(l => l.id));
    for (const l of LEVELS) {
      for (const t of l.technique) expect(parseExerciseId(t.id), t.id).not.toBeNull();
      for (const r of l.reading) expect(reading.has(r), r).toBe(true);
      expect(l.repertoire.need).toBeGreaterThan(0);
    }
    expect(levelById('grade-3').name).toBe('Grade 3');
  });
  test('Beginner: the first lessons, a dozen Grade 0 pieces in the catalog, and a reading track from C position', () => {
    const b = levelById('beginner');
    expect(b.lessons).toEqual(LESSONS.map(l => l.id));
    expect(b.lessons).toEqual(ALL_LESSONS);
    expect(LEVELS.slice(1).every(l => !l.lessons?.length)).toBe(true);
    expect(b.reading).toEqual(['c-position', 'landmarks', 'treble']);
    const catalog = JSON.parse(readFileSync(process.cwd() + '/public/songs/catalog.json', 'utf8')).songs;
    expect(b.repertoire.ids.length).toBeGreaterThanOrEqual(12);
    for (const id of b.repertoire.ids) expect(catalog.find(s => s.id === id), id).toMatchObject({grade: 0, difficulty: 'beginner'});
    // Learning order: one hand alone before hands taking turns, before both hands.
    expect(b.repertoire.ids.slice(0, 2)).toEqual(['hot-cross-buns', 'mary-had-a-little-lamb']);
    expect(b.repertoire.need).toBeLessThanOrEqual(b.repertoire.ids.length);
  });
});

describe('exercise matching', () => {
  const p = id => parseExerciseId(id);
  test('a wider or two-handed version satisfies a narrower requirement', () => {
    expect(exerciseSatisfies(p('ex:scale:C:major:both:2:up-down'), p('ex:scale:C:major:right:1:up-down'))).toBe(true);
    expect(exerciseSatisfies(p('ex:scale:C:major:right:1:up-down'), p('ex:scale:C:major:right:1:up-down'))).toBe(true);
    expect(exerciseSatisfies(p('ex:scale:C:major:left:1:up-down'), p('ex:scale:C:major:right:1:up-down'))).toBe(false);
    expect(exerciseSatisfies(p('ex:scale:C:major:right:2:up-down'), p('ex:scale:C:major:both:1:up-down'))).toBe(false);
    expect(exerciseSatisfies(p('ex:scale:C:major:both:1:up-down'), p('ex:scale:C:major:both:2:up-down'))).toBe(false);
    expect(exerciseSatisfies(p('ex:scale:A:minor:both:1:up-down'), p('ex:scale:A:harmonic-minor:both:1:up-down'))).toBe(true);
    expect(exerciseSatisfies(p('ex:scale:A:natural-minor:both:1:up-down'), p('ex:scale:A:harmonic-minor:both:1:up-down'))).toBe(false);
    expect(exerciseSatisfies(p('ex:scale:Fs:major:both:4:up-down'), p('ex:scale:Gb:major:both:4:up-down'))).toBe(false); // spelling matters
    expect(exerciseSatisfies(p('ex:progression:C:major:I-IV-V-I'), p('ex:progression:C:major:I-IV-V-I'))).toBe(true);
  });
});

describe('evaluating levels', () => {
  test('pieces missing from the library are skipped; need shrinks to what is available', () => {
    const lp = evaluateLevel(levelById('beginner'), docOf(), {library: LIB});
    expect(lp.repertoire.items.map(i => i.id)).toEqual(['twinkle-twinkle', 'ode-to-joy']); // in the level's order
    expect(lp.repertoire.need).toBe(2);
    const g1 = evaluateLevel(levelById('grade-1'), docOf(), {library: LIB});
    expect(g1.repertoire.items.map(i => i.id)).toEqual(['minuet-in-g']);
    expect(g1.repertoire.need).toBe(1); // three wanted, one available
    const none = evaluateLevel(levelById('grade-5'), docOf(), {library: []});
    expect(none.repertoire).toMatchObject({need: 0, done: true});
  });
  test('library pieces tagged with the grade join the level', () => {
    const lp = evaluateLevel(levelById('grade-2'), docOf(), {library: [...LIB, {id: 'new-piece', title: 'New', grade: 2}]});
    expect(lp.repertoire.items.map(i => i.id)).toEqual(['new-piece']);
  });
  test('completing Beginner: lessons passed, two secure pieces, technique ≥ 90 %, reading ≥ 90 %', () => {
    const songs = {
      'ex:five-finger:C:major:both': {best: 95}, 'ex:five-finger:G:major:both': {best: 91},
      'ex:scale:C:major:both:1:up-down': {best: 93}, // covers right and left hand requirements
    };
    const events = [pass('twinkle-twinkle'), pass('twinkle-twinkle'), pass('ode-to-joy'), pass('ode-to-joy'), drill('c-position'), drill('landmarks'), drill('treble'), ...ALL_LESSONS.map(id => lesson(id))];
    const path = curriculum(docOf(events, songs), {library: LIB, now: T0});
    expect(path.levels[0]).toMatchObject({done: true, fraction: 1});
    expect(path.current.level.id).toBe('grade-1');
    expect(path.next.technique.id).toBe('ex:scale:G:major:both:1:up-down'); // C major (both hands) is already done
    expect(path.next.reading.id).toBe('bass');
    expect(path.next.piece.id).toBe('minuet-in-g');
    expect(path.next.lesson).toBeNull(); // Grade 1 has no first lessons
  });
  test('the first lessons: each passed once at ≥ 80 %, from raw events or the running totals', () => {
    const songs = {'ex:five-finger:C:major:both': {best: 95}, 'ex:five-finger:G:major:both': {best: 95}, 'ex:scale:C:major:both:1:up-down': {best: 95}};
    const events = [pass('twinkle-twinkle'), pass('twinkle-twinkle'), pass('ode-to-joy'), pass('ode-to-joy'), drill('c-position'), drill('landmarks'), drill('treble'),
      lesson('keyboard'), lesson('fingers', 70)];
    const doc = docOf(events, songs);
    let path = curriculum(doc, {library: LIB, now: T0});
    expect(path.current.level.id).toBe('beginner'); // everything else is done, but the lessons aren't
    expect(path.levels[0].lessons.items.map(l => [l.id, l.done])).toEqual([['keyboard', true], ['fingers', false], ['middle-c', false], ['first-tunes', false]]);
    expect(path.levels[0].lessons.items[1]).toMatchObject({label: 'Fingers and posture', best: 70});
    expect(path.next.lesson.id).toBe('fingers');
    expect(path.levels[0].fraction).toBeCloseTo((2 + 4 + 3 + 1) / (2 + 4 + 3 + 4));
    // Pruned events still count through totals.skills.lesson (src/progress/model.js).
    doc.totals.skills = {lesson: {levels: {fingers: 85, 'middle-c': 100, 'first-tunes': 80}}};
    path = curriculum(doc, {library: LIB, now: T0});
    expect(path.levels[0].lessons.done).toBe(true);
    expect(path.current.level.id).toBe('grade-1');
  });
  test('reading needs enough notes and accuracy; technique needs ≥ 90 %', () => {
    const short = {...drill('landmarks'), right: 5, wrong: 0};
    const lp = evaluateLevel(levelById('beginner'), docOf([short, drill('treble', 85)], {'ex:five-finger:C:major:both': {best: 89}}), {library: LIB});
    expect(lp.reading.items.map(r => r.done)).toEqual([false, false, false]);
    expect(lp.technique.items[0]).toMatchObject({best: 89, done: false});
  });
  test('settings.pathStart skips earlier levels', () => {
    const doc = docOf();
    doc.settings.pathStart = 'grade-2';
    const path = curriculum(doc, {library: LIB});
    expect(path.current.level.id).toBe('grade-2');
    expect(path.levels[0].skipped).toBe(true);
    expect(path.start).toBe('grade-2');
    expect(curriculum(docOf(), {library: LIB, start: 'nonsense'}).current.level.id).toBe('beginner');
  });
});
