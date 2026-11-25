import {describe, expect, test} from 'vitest';
import {curriculum, evaluateLevel, exerciseSatisfies, LEVELS, levelById} from '../src/curriculum/levels.js';
import {parseExerciseId} from '../src/exercises/index.js';
import {LEVELS as READING_LEVELS} from '../src/trainer/levels.js';

const T0 = Date.UTC(2026, 0, 5, 12);
let n = 0;
const pass = (songId, over = {}) => ({type: 'practice:result', id: 'c' + String(++n).padStart(6, '0'), songId, section: [0, 3], mode: 'wait', hands: 'both', tempo: 200, accuracy: 96, at: T0, tz: 0, ...over});
const drill = (level, accuracy = 95) => ({type: 'trainer:result', level, right: 19, wrong: 1, accuracy, at: T0, tz: 0});
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
    expect(lp.repertoire.items.map(i => i.id)).toEqual(['twinkle-twinkle', 'ode-to-joy']);
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
  test('completing Beginner: two secure pieces, technique ≥ 90 %, reading ≥ 90 %', () => {
    const songs = {
      'ex:five-finger:C:major:both': {best: 95}, 'ex:five-finger:G:major:both': {best: 91},
      'ex:scale:C:major:both:1:up-down': {best: 93}, // covers right and left hand requirements
    };
    const events = [pass('twinkle-twinkle'), pass('twinkle-twinkle'), pass('ode-to-joy'), pass('ode-to-joy'), drill('landmarks'), drill('treble')];
    const path = curriculum(docOf(events, songs), {library: LIB, now: T0});
    expect(path.levels[0]).toMatchObject({done: true, fraction: 1});
    expect(path.current.level.id).toBe('grade-1');
    expect(path.next.technique.id).toBe('ex:scale:G:major:both:1:up-down'); // C major (both hands) is already done
    expect(path.next.reading.id).toBe('bass');
    expect(path.next.piece.id).toBe('minuet-in-g');
  });
  test('reading needs enough notes and accuracy; technique needs ≥ 90 %', () => {
    const short = {...drill('landmarks'), right: 5, wrong: 0};
    const lp = evaluateLevel(levelById('beginner'), docOf([short, drill('treble', 85)], {'ex:five-finger:C:major:both': {best: 89}}), {library: LIB});
    expect(lp.reading.items.map(r => r.done)).toEqual([false, false]);
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
