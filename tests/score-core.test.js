import {describe, expect, test} from 'vitest';

import {
  FollowNotes, MissLog, TimedGrader, beatInfo, beatsOf, classifyTiming, countIn, handGroups, measureBeats, passage, speedUpTempo, staffHand,
} from '../src/score-core.mjs';

// A tiny fake score: three 4-quarter measures. Times are in quarter notes.
const fakeScore = () => ({
  measures: [
    {label: '1', index: 0, start: 0, end: 4},
    {label: '2', index: 1, start: 4, end: 8},
    {label: '3', index: 2, start: 8, end: 12},
  ],
  events: [
    {id: 'a', n: 60, t: 0, d: 1},
    {id: 'b', n: 64, t: 0, d: 1},
    {id: 'c', n: 67, t: 2, d: 4}, // crosses the 1|2 barline
    {id: 'd', n: 62, t: 4, d: 1},
    {id: 'e', n: 62, t: 5, d: 1}, // same pitch as d, later
    {id: 'f', n: 48, t: 7, d: 3}, // crosses the 2|3 barline
    {id: 'g', n: 72, t: 8, d: 2},
  ],
});

describe('passage()', () => {
  test('covers the requested measures', () => {
    const p = passage(fakeScore(), 1, 1);
    expect(p).toMatchObject({start: 4, end: 8, first: 1, last: 1});
  });

  test('clips notes that start before or end after the passage', () => {
    const p = passage(fakeScore(), 1, 1);
    expect(p.events.map(e => [e.id, e.t, e.d])).toEqual([
      ['c', 4, 2],
      ['d', 4, 1],
      ['e', 5, 1],
      ['f', 7, 1],
    ]);
  });

  test("does not mutate the score's events", () => {
    const score = fakeScore();
    passage(score, 1, 1);
    expect(score.events.find(e => e.id === 'c')).toMatchObject({t: 2, d: 4});
  });

  test('groups simultaneous notes, sorted by time, with distinct pitches', () => {
    const p = passage(fakeScore(), 0, 2);
    expect(p.groups.map(g => [g.t, g.notes])).toEqual([
      [0, [60, 64]],
      [2, [67]],
      [4, [62]],
      [5, [62]],
      [7, [48]],
      [8, [72]],
    ]);
    expect(p.groups[0].events.map(e => e.id)).toEqual(['a', 'b']);
  });

  test('a clipped note joins the group at the passage start', () => {
    const p = passage(fakeScore(), 1, 2);
    expect(p.groups[0]).toMatchObject({t: 4, notes: [67, 62]});
  });

  test.each([
    [-1, 0],
    [0, 3],
    [2, 1],
  ])('rejects the range %i..%i', (first, last) => {
    expect(() => passage(fakeScore(), first, last)).toThrow(/valid measure range/);
  });
});

describe('FollowNotes', () => {
  const groups = () => passage(fakeScore(), 0, 0).groups; // [60,64] then [67]

  test('starts active at the first group', () => {
    const f = new FollowNotes(groups());
    expect(f.active).toBe(true);
    expect(f.index).toBe(0);
    expect(f.current.notes).toEqual([60, 64]);
  });

  test('a chord needs every note before advancing', () => {
    const f = new FollowNotes(groups());
    expect(f.attack(60)).toBe('partial');
    expect(f.attack(60)).toBe('partial'); // repeating a collected note is harmless
    expect(f.attack(64)).toBe('advanced');
    expect(f.index).toBe(1);
  });

  test("wrong notes don't advance or clear collected notes", () => {
    const f = new FollowNotes(groups());
    expect(f.attack(64)).toBe('partial');
    expect(f.attack(61)).toBe('wrong');
    expect(f.index).toBe(0);
    expect(f.attack(60)).toBe('advanced');
  });

  test('finishes after the last group and then goes inactive', () => {
    const f = new FollowNotes(groups());
    f.attack(60);
    f.attack(64);
    expect(f.attack(67)).toBe('finished');
    expect(f.active).toBe(false);
    expect(f.attack(67)).toBe('inactive');
  });

  test('reset() starts over', () => {
    const f = new FollowNotes(groups());
    f.attack(60);
    f.attack(64);
    f.reset();
    expect(f.index).toBe(0);
    expect(f.attack(64)).toBe('partial');
  });

  test('an empty passage is inactive', () => {
    const f = new FollowNotes([]);
    expect(f.active).toBe(false);
    expect(f.attack(60)).toBe('inactive');
  });
});

describe('FollowNotes.skip()', () => {
  test('moves past a group and finishes at the end', () => {
    const f = new FollowNotes(passage(fakeScore(), 0, 0).groups);
    expect(f.skip()).toBe('advanced');
    expect(f.current.notes).toEqual([67]);
    expect(f.skip()).toBe('finished');
    expect(f.skip()).toBe('inactive');
  });
});

// Two hands: right-hand melody over a left-hand bass, by staff.
const handScore = () => ({
  measures: [
    {label: '1', index: 0, start: 0, end: 4},
    {label: '2', index: 1, start: 4, end: 8},
  ],
  events: [
    {id: 'r1', n: 72, t: 0, d: 1, hand: 'r'},
    {id: 'l1', n: 48, t: 0, d: 4, hand: 'l'},
    {id: 'l2', n: 55, t: 1, d: 1, hand: 'l'}, // LH only
    {id: 'r2', n: 74, t: 2, d: 3, hand: 'r'}, // crosses into measure 2
    {id: 'r3', n: 50, t: 4, d: 1, hand: 'r'}, // low note, still the right hand (staff 1)
    {id: 'l3', n: 67, t: 5, d: 1, hand: 'l'}, // high note, still the left hand (staff 2)
  ],
});

describe('handGroups()', () => {
  test('both hands: every note is expected, nothing auto-played', () => {
    const g = handGroups(passage(handScore(), 0, 1), 'both');
    expect(g.map(x => [x.t, x.notes, x.auto.length])).toEqual([[0, [72, 48], 0], [1, [55], 0], [2, [74], 0], [4, [50], 0], [5, [67], 0]]);
  });

  test('right hand: left-hand notes become auto groups, split by staff not pitch', () => {
    const g = handGroups(passage(handScore(), 0, 1), 'right');
    expect(g.map(x => [x.t, x.notes, x.auto.map(e => e.id)])).toEqual([
      [0, [72], ['l1']],
      [1, [], ['l2']],
      [2, [74], []],
      [4, [50], []],
      [5, [], ['l3']],
    ]);
  });

  test('left hand', () => {
    const g = handGroups(passage(handScore(), 0, 1), 'left');
    expect(g.map(x => [x.t, x.notes])).toEqual([[0, [48]], [1, [55]], [2, []], [4, []], [5, [67]]]);
  });

  test('notes carried over the start of the passage are not expected again', () => {
    const g = handGroups(passage(handScore(), 1, 1), 'both');
    expect(g.map(x => [x.t, x.notes])).toEqual([[4, [50]], [5, [67]]]);
  });
});

describe('staffHand()', () => {
  test('staff 1 is the right hand, staff 2 the left', () => {
    expect(staffHand(1)).toBe('r');
    expect(staffHand(2)).toBe('l');
  });
  test('a single staff follows its clef', () => {
    expect(staffHand(1, 'G')).toBe('r');
    expect(staffHand(1, 'F')).toBe('l');
  });
});

describe('classifyTiming()', () => {
  test.each([
    [0, 'perfect'], [120, 'perfect'], [-120, 'perfect'],
    [-121, 'early'], [-250, 'early'], [121, 'late'], [250, 'late'],
    [251, null], [-400, null],
  ])('%i ms → %s', (ms, want) => expect(classifyTiming(ms)).toBe(want));
});

describe('TimedGrader', () => {
  // 60 BPM: a quarter note is 1000 ms.
  const notes = [{id: 'a', n: 60, t: 0}, {id: 'b', n: 62, t: 1}, {id: 'c', n: 64, t: 2}, {id: 'd', n: 60, t: 3}];

  test('grades hits by timing and sweeps misses', () => {
    const g = new TimedGrader(notes);
    expect(g.attack(60, 0.05, 1000).result).toBe('perfect');
    expect(g.attack(62, 0.8, 1000).result).toBe('early');
    expect(g.attack(61, 1.0, 1000).result).toBe('wrong');
    expect(g.sweep(2.3, 1000).map(n => n.id)).toEqual(['c']);
    expect(g.attack(60, 3.2, 1000).result).toBe('late');
    expect(g.summary).toEqual({right: 3, wrong: 2, missed: 1, extra: 1, accuracy: 60, timing: {early: 1, late: 1, onTime: 1}});
    expect(g.grades.get('c')).toBe('miss');
  });

  test('a press outside every window is wrong; same pitch picks the nearest note', () => {
    const g = new TimedGrader(notes);
    expect(g.attack(60, 1.5, 1000).result).toBe('wrong');
    expect(g.attack(60, 2.9, 1000)).toMatchObject({result: 'perfect', note: {id: 'd'}});
  });

  test('windows scale with tempo', () => {
    const g = new TimedGrader(notes);
    // 120 BPM: 0.2 quarters = 100 ms → perfect.
    expect(g.attack(60, 0.2, 500).result).toBe('perfect');
  });

  test('finish() misses everything left', () => {
    const g = new TimedGrader(notes);
    expect(g.finish()).toHaveLength(4);
    expect(g.summary.accuracy).toBe(0);
  });
});

describe('beats', () => {
  test('simple and compound meters', () => {
    expect(beatInfo({count: 3, unit: 4})).toEqual({len: 1, beats: 3, bar: 3});
    expect(beatInfo({count: 6, unit: 8})).toEqual({len: 1.5, beats: 2, bar: 3});
    expect(beatInfo({count: 2, unit: 2})).toEqual({len: 2, beats: 2, bar: 4});
    expect(beatInfo()).toEqual({len: 1, beats: 4, bar: 4});
  });

  test('beats of full measures, accent on the downbeat', () => {
    const m = {index: 1, start: 3, end: 6, meter: {count: 3, unit: 4}};
    expect(measureBeats(m)).toEqual([{t: 3, beat: 0, accent: true}, {t: 4, beat: 1, accent: false}, {t: 5, beat: 2, accent: false}]);
  });

  test('a pickup is counted from the end of the bar', () => {
    const m = {index: 0, start: 0, end: 1, pickup: true, meter: {count: 3, unit: 4}};
    expect(measureBeats(m)).toEqual([{t: 0, beat: 2, accent: false}]);
  });

  test('beatsOf counts across measures (time signature per measure)', () => {
    const ms = [{index: 0, start: 0, end: 4, meter: {count: 4, unit: 4}}, {index: 1, start: 4, end: 7, meter: {count: 6, unit: 8}}];
    expect(beatsOf(ms).map(b => [b.t, b.accent])).toEqual([[0, true], [1, false], [2, false], [3, false], [4, true], [5.5, false]]);
  });

  test('count-in: one bar, plus the beats a pickup skips', () => {
    const full = countIn({index: 2, start: 8, end: 11, meter: {count: 3, unit: 4}});
    expect(full.from).toBe(5);
    expect(full.beats.map(b => [b.t, b.accent])).toEqual([[5, true], [6, false], [7, false]]);
    const pickup = countIn({index: 0, start: 0, end: 1, pickup: true, meter: {count: 3, unit: 4}});
    expect(pickup.beats.map(b => [b.t, b.accent])).toEqual([[-5, true], [-4, false], [-3, false], [-2, true], [-1, false]]);
  });
});

describe('speedUpTempo()', () => {
  test('clean passes add 5% (at least 1 BPM) up to the target', () => {
    expect(speedUpTempo(60, 80, 95)).toBe(63);
    expect(speedUpTempo(20, 80, 100)).toBe(21);
    expect(speedUpTempo(78, 80, 100)).toBe(80);
    expect(speedUpTempo(80, 80, 100)).toBe(80);
  });
  test('no change below the threshold or above the target', () => {
    expect(speedUpTempo(60, 80, 94)).toBe(60);
    expect(speedUpTempo(90, 80, 100)).toBe(90);
  });
});

describe('MissLog', () => {
  test('merges entries per moment and caps the list', () => {
    const log = new MissLog(2);
    log.add(0, '1', {expected: ['C4'], played: ['D4']});
    log.add(0, '1', {played: ['D4', 'E4']});
    log.add(1, '1', {expected: ['G4']});
    log.add(2, '2', {expected: ['A4']}); // over the cap
    expect(log.list()).toEqual([
      {measure: '1', expected: ['C4'], played: ['D4', 'E4']},
      {measure: '1', expected: ['G4'], played: []},
    ]);
  });
});
