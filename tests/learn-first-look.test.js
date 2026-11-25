import {describe, expect, test} from 'vitest';

import {firstLook, handRanges, keyOf, meterText, noteName, scalePitchClasses, trickyBars, valueName} from '../src/learn/first-look.mjs';

const bars = (n, {len = 4, meter = {count: 4, unit: 4}, key = {fifths: 0, mode: null}} = {}) =>
  Array.from({length: n}, (_, i) => ({id: 'm' + i, label: String(i + 1), index: i, start: i * len, end: (i + 1) * len, meter, key}));
let uid = 0;
const ev = (n, t, d = 1, hand = 'r') => ({id: 'e' + uid++, n, t, d, hand});
// A calm bar: crotchets stepping in C major, a held bass.
const calm = b => [...[60, 62, 64, 62].map((n, k) => ev(n, b * 4 + k)), ev(48, b * 4, 4, 'l')];

describe('key, time, ranges', () => {
  test('key names from the signature, minor when the file says so', () => {
    expect(keyOf(bars(1, {key: {fifths: 1, mode: 'major'}})).name).toBe('G major');
    expect(keyOf(bars(1, {key: {fifths: -3, mode: 'minor'}})).name).toBe('C minor');
    expect(keyOf(bars(1, {key: {fifths: 6, mode: 'major'}})).name).toBe('F♯ major');
  });

  test('no mode in the file: minor when the last bass note is the relative minor’s tonic', () => {
    const m = bars(2);
    expect(keyOf(m, [ev(60, 0), ev(57, 4, 4, 'l'), ev(64, 4)]).name).toBe('A minor');
    expect(keyOf(m, [ev(64, 0), ev(48, 4, 4, 'l'), ev(60, 4)]).name).toBe('C major');
  });

  test('time signature, and when it changes', () => {
    expect(meterText(bars(2, {meter: {count: 3, unit: 4}}))).toBe('3/4');
    expect(meterText([...bars(1), ...bars(1, {meter: {count: 2, unit: 4}})])).toBe('4/4, then 2/4');
    expect(meterText([])).toBe('4/4');
  });

  test('note names and hand ranges', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(70)).toBe('A♯4');
    expect(noteName(70, true)).toBe('B♭4');
    expect(handRanges([ev(60, 0), ev(79, 1), ev(48, 0, 1, 'l')])).toEqual({r: {low: 60, high: 79, span: 19}, l: {low: 48, high: 48, span: 0}});
    expect(handRanges([ev(60, 0)])).toEqual({r: {low: 60, high: 60, span: 0}});
  });

  test('scale pitch classes from fifths', () => {
    expect([...scalePitchClasses(0)].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses(1).has(6)).toBe(true);   // F♯ in G major
    expect(scalePitchClasses(-1).has(10)).toBe(true); // B♭ in F major
  });

  test('note values', () => {
    expect(valueName(.25)).toBe('semiquavers');
    expect(valueName(.5)).toBe('quavers');
    expect(valueName(1 / 3)).toBe('quaver triplets');
  });
});

describe('tricky bars', () => {
  test('finds a wide leap, a bar of accidentals and the fastest notes, in bar order', () => {
    const measures = bars(8);
    const events = [];
    for (let b = 0; b < 8; b++) events.push(...calm(b));
    // Bar 3: an octave-and-a-bit leap in the melody.
    events.push(ev(76, 2 * 4 + 1.5, .5), ev(62, 2 * 4 + 2, .5));
    // Bar 5: four chromatic notes.
    events.push(...[61, 63, 66, 68].map((n, k) => ev(n, 4 * 4 + k + .5, .5)));
    // Bar 7: a run of semiquavers, the fastest notes in the piece.
    for (let k = 0; k < 8; k++) events.push(ev(65 + (k % 3), 6 * 4 + k * .25, .25));
    const tricky = trickyBars(measures, events, {fifths: 0});
    expect(tricky.map(t => t.label)).toEqual(['Bar 3', 'Bar 5', 'Bar 7']);
    expect(tricky[0].reasons[0]).toMatch(/wide leap/);
    expect(tricky[1].reasons.join()).toMatch(/accidentals/);
    expect(tricky[2].reasons.join()).toMatch(/fastest notes \(semiquavers\)/);
  });

  test('at most four, never two neighbours, at least two when anything is tricky', () => {
    const measures = bars(12), events = [];
    for (let b = 0; b < 12; b++) {
      events.push(...calm(b));
      events.push(ev(61 + (b % 4), b * 4 + .5, .5), ev(63, b * 4 + 1.5, .5), ev(66, b * 4 + 2.5, .5)); // accidentals everywhere
    }
    const t = trickyBars(measures, events);
    expect(t.length).toBeLessThanOrEqual(4);
    expect(t.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < t.length; i++) expect(t[i].index - t[i - 1].index).toBeGreaterThan(1);
  });

  test('a calm piece: few or no tricky bars; nothing to read, nothing to show', () => {
    const measures = bars(4), events = [0, 1, 2, 3].flatMap(calm);
    expect(trickyBars(measures, events)).toEqual([]);
    expect(trickyBars([], [])).toEqual([]);
  });

  test('a repeat played again is not named twice', () => {
    const measures = bars(4).map((b, i) => ({...b, visit: i >= 2 ? 2 : 1, label: String((i % 2) + 1)}));
    const events = [0, 1, 2, 3].flatMap(calm);
    events.push(ev(76, 1.5, .5), ev(62, 2, .5), ev(76, 9.5, .5), ev(62, 10, .5)); // the leap in bar 1, and again on the repeat
    expect(trickyBars(measures, events).map(t => t.index)).toEqual([0]);
  });

  test('a passage written out again note for note is not named twice', () => {
    const measures = bars(8), events = [];
    for (let b = 0; b < 8; b++) { const k = b % 4; events.push(...[0, 1, 2, 3].map(q => ev(60 + k * 2 + (q % 2), b * 4 + q)), ev(40 + k, b * 4, 4, 'l')); }
    events.push(ev(79, 1 * 4 + 1.5, .5), ev(64, 1 * 4 + 2, .5), ev(79, 5 * 4 + 1.5, .5), ev(64, 5 * 4 + 2, .5));
    const picked = trickyBars(measures, events).map(t => t.index);
    expect(picked).toContain(1);
    expect(picked.some(i => i >= 4)).toBe(false); // bars 5–8 repeat bars 1–4
  });

  test('the pickup is named as such', () => {
    const measures = bars(3);
    measures[0] = {...measures[0], label: 'Pickup', pickup: true};
    const events = [ev(60, 0, .5), ev(72, .5, .5), ev(61, 1, .5), ev(63, 1.5, .5), ...calm(1), ...calm(2)];
    expect(trickyBars(measures, events)[0].label).toBe('The pickup');
  });
});

describe('firstLook', () => {
  test('everything the card shows', () => {
    const measures = bars(4, {key: {fifths: -1, mode: 'major'}, meter: {count: 3, unit: 4}, len: 3});
    const events = [ev(65, 0), ev(70, 1), ev(77, 2), ev(41, 0, 3, 'l'), ev(53, 3, 3, 'l')];
    const look = firstLook({measures, events}, {tempo: 92.4});
    expect(look).toMatchObject({key: 'F major', meter: '3/4', tempo: 92, bars: 4, ranges: {r: 'F4–F5', l: 'F2–F3'}, spans: {r: 12, l: 12}});
    expect(Array.isArray(look.tricky)).toBe(true);
    expect(firstLook({measures, events}).tempo).toBeNull();
    expect(firstLook({measures, events: [ev(70, 0)]}).ranges).toEqual({r: 'B♭4'});
  });
});
