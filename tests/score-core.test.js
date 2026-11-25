import {describe, expect, test} from 'vitest';

import {FollowNotes, passage} from '../src/score-core.mjs';

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
