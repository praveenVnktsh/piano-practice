import {describe, expect, test} from 'vitest';
import {RHYTHM_LEVELS, generateRhythm, parseCell, onsetsOf, onsetEvents, gradeTaps, clickTrack, countLabels, barLength} from '../src/rhythm/patterns.js';
import {engrave, noteValue} from '../src/theory/engrave.js';

const sum = evs => +evs.reduce((a, e) => a + e.dur, 0).toFixed(6);

describe('rhythm patterns', () => {
  test('cells parse', () => {
    expect(parseCell('dq e')).toEqual([{dur: 1.5}, {dur: .5}]);
    expect(parseCell('re e~ e')).toEqual([{dur: .5, rest: true}, {dur: .5, tie: true}, {dur: .5}]);
    expect(parseCell('t t t').map(e => e.tuplet)).toEqual([3, 3, 3]);
    expect(() => parseCell('x')).toThrow();
  });

  for (const level of RHYTHM_LEVELS) {
    test(`${level.id}: every bar adds up and every note can be engraved`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const p = generateRhythm(level.id, seed);
        expect(level.times.map(t => t.join('/'))).toContain(p.time.join('/'));
        expect(p.bars).toHaveLength(level.bars);
        for (const bar of p.bars) {
          expect(sum(bar)).toBe(barLength(p.time));
          expect(bar.at(-1).tie, 'ties stay inside the bar').toBeFalsy();
          for (const e of bar) expect(noteValue(e.dur, e.tuplet || 0), `${level.id} ${e.dur}`).toBeTruthy();
        }
        expect(p.bars[0][0].rest, 'starts with a note').toBeFalsy();
        expect(p.bars.at(-1).at(-1).rest, 'ends with a note').toBeFalsy();
        expect(p.onsets.length).toBeGreaterThan(1);
        const {events} = engrave({staff: 'line', time: p.time, measures: p.bars});
        expect(events).toHaveLength(p.bars.flat().length);
        for (let i = 1; i < events.length; i++) expect(events[i].x).toBeGreaterThan(events[i - 1].x);
      }
    });
  }

  test('triplets come in whole beats; 6/8 is in two dotted-crotchet beats', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generateRhythm('triplets', seed);
      let run = 0;
      for (const e of p.bars.flat()) { if (e.tuplet) run += e.dur; else { expect(Math.abs(run - Math.round(run))).toBeLessThan(1e-6); run = 0; } }
      const c = generateRhythm('compound', seed);
      expect(c.time).toEqual([6, 8]);
    }
  });

  test('onsets skip rests and tied continuations', () => {
    const bars = [[{dur: 1}, {dur: 1, rest: true}, {dur: 1, tie: true}, {dur: 1}], [{dur: .5}, {dur: .5}, {dur: 3}]];
    expect(onsetsOf(bars)).toEqual([0, 2, 4, 4.5, 5]);
    expect(onsetEvents(bars)).toEqual([0, 2, 4, 5, 6]);
  });

  test('grading uses the play-along windows', () => {
    const expected = [1000, 1500, 2000, 2500, 3000];
    const g = gradeTaps(expected, [1010, 1640, 1820, 2800, 3500]);
    // 1820 goes to 2000 (1500 is taken), 2800 to 3000; nothing is near 2500; 3500 is an extra tap.
    expect(g.notes.map(n => n.result)).toEqual(['perfect', 'late', 'early', 'miss', 'early']);
    expect(g.notes[1].delta).toBe(140);
    expect(g.extra).toBe(1);
    expect(g.wrong).toBe(2);
  });

  test('grading: nearest note wins, extra taps count against you', () => {
    const g = gradeTaps([0, 500, 1000], [5, 495, 1100, 1300]);
    expect(g.notes.map(n => n.result)).toEqual(['perfect', 'perfect', 'perfect']);
    expect(g.right).toBe(3);
    expect(g.extra).toBe(1);
    expect(g.wrong).toBe(1);
    expect(g.accuracy).toBe(75);
    expect(g.timing).toEqual({early: 0, late: 0, onTime: 3});
    expect(gradeTaps([0, 500], []).accuracy).toBe(0);
    expect(gradeTaps([0, 500], [-200, 700]).timing).toEqual({early: 1, late: 1, onTime: 0});
  });

  test('click track: a bar of count-in, then the beats', () => {
    const t = clickTrack([4, 4], 2);
    expect(t.filter(c => c.count).map(c => c.beat)).toEqual([-4, -3, -2, -1]);
    expect(t.filter(c => !c.count).map(c => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.filter(c => c.accent).map(c => c.beat)).toEqual([-4, 0, 4]);
    const c = clickTrack([6, 8], 1);
    expect(c.filter(x => x.count)).toHaveLength(6);
    expect(c.filter(x => !x.count).map(x => x.beat)).toEqual([0, 1.5]);
  });

  test('count labels', () => {
    expect(countLabels([4, 4], [[{dur: 1}, {dur: .5}, {dur: .5}, {dur: 1, rest: true}, {dur: 1}]])).toEqual(['1', '2', '&', '(3)', '4']);
    expect(countLabels([6, 8], [[{dur: .5}, {dur: .5}, {dur: .5}, {dur: 1.5}]])).toEqual(['1', '&', 'a', '2']);
  });
});
