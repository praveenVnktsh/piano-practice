import {describe, expect, it} from 'vitest';
import {prepareCompare} from '../src/record/compare.mjs';
import {validateTake} from '../src/record/take.mjs';

// Four bars of 4/4, right hand in quarters; the take plays them at 600 ms per quarter, bar 3 slower.
const PITCHES = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 69, 67, 65];
const song = {
  measures: [0, 1, 2, 3].map(i => ({index: i, label: String(i + 1), start: 4 * i, end: 4 * i + 4, meter: {count: 4, unit: 4}})),
  events: PITCHES.map((n, i) => ({id: 'r' + i, t: i, d: 1, n, hand: 'r', staff: 1})),
  marks: {dynamics: [{t: 0, mark: 'p', staff: 1}, {t: 8, mark: 'f', staff: 1}]},
  tempo: 100,
};
const timeOf = t => 500 + (t <= 8 ? t * 600 : 8 * 600 + (Math.min(t, 12) - 8) * 900 + Math.max(0, t - 12) * 600);
const take = (extra = [], more = {}) => validateTake({id: 'abcdefgh12', songId: 'p', title: 'P', at: Date.UTC(2026, 10, 24), tempo: 100, section: [0, 3], hands: 'both', mode: 'free', source: 'midi',
  notes: [...PITCHES.map((n, i) => [Math.round(timeOf(i)), n, 70 + i, 500]), ...extra], pedal: [], ...more});

describe('prepareCompare', () => {
  it('lists the bars of the take', () => {
    expect(prepareCompare(song, take()).bars).toEqual([{i: 0, label: '1'}, {i: 1, label: '2'}, {i: 2, label: '3'}, {i: 3, label: '4'}]);
  });
  it('plays the score evenly at the take’s tempo in that bar', () => {
    const c = prepareCompare(song, take()).clip(0);
    expect(c.reference.map(x => x.n)).toEqual([60, 62, 64, 65]);
    c.reference.forEach((x, k) => expect(x.delay).toBeCloseTo(.6 * k));
    expect(c.reference[0].dur).toBeCloseTo(.6);
    expect(c.reference[0].velocity).toBeCloseTo(50 / 127); // p
    expect(c.seconds.reference).toBeCloseTo(2.4);
  });
  it('follows a slower bar', () => {
    const c = prepareCompare(song, take()).clip(2);
    expect(c.reference[1].delay).toBeCloseTo(.9);
    expect(c.reference[0].velocity).toBeCloseTo(92 / 127); // f
    expect(c.take.map(x => x.n)).toEqual([60, 64, 67, 72]);
    c.take.forEach((x, k) => expect(x.delay).toBeCloseTo(.9 * k));
    expect(c.take[0].dur).toBeCloseTo(.5);
    expect(c.take[0].velocity).toBeCloseTo(78 / 127);
    expect(c.seconds.take).toBeCloseTo(3.6);
  });
  it('keeps the take’s own extra notes and a slightly early note in the bar', () => {
    const c = prepareCompare(song, take([[Math.round(timeOf(4) - 40), 61, 60, 100], [Math.round(timeOf(5.5)), 70, 60, 100]])).clip(1);
    expect(c.take.map(x => x.n)).toEqual([61, 67, 65, 70, 64, 62]);
    expect(c.take[0].delay).toBe(0);
  });
  it('is null outside the section', () => {
    const cmp = prepareCompare(song, take([], {section: [1, 2]}));
    expect(cmp.clip(0)).toBeNull();
    expect(cmp.clip(3)).toBeNull();
    expect(cmp.clip(1).reference).toHaveLength(4);
  });
});
