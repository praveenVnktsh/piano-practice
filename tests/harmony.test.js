// @vitest-environment jsdom
// Score study: the approximate harmonic analysis (src/analysis/harmony.mjs), on simple cadences
// built by hand and on the Bach Prelude in C (BWV 846), whose harmonies are well known
// (songs/bach-prelude-in-c.notes) — and the performance-run score (src/analysis/performance.mjs).
import {beforeAll, describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

import {analyseHarmony, chordSymbol, detectKey, diatonicSet, keyOf, romanNumeral, secondaryTarget} from '../src/analysis/harmony.mjs';
import {performanceScore} from '../src/analysis/performance.mjs';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';

const NAMES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
// 'C4' / 'F#3' / 'Bb2' → MIDI
const midi = s => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); return (+m[3] + 1) * 12 + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
// Block chords, one per bar of 4/4: [['C3', 'E4', 'G4', 'C5'], …] → {events, measures}.
function chorale(chords, {fifths = 0, mode = null, beats = 4} = {}) {
  const events = [], measures = [];
  chords.forEach((notes, i) => {
    const t = i * beats;
    for (const n of notes) events.push({n: midi(n), t, d: beats});
    measures.push({index: i, start: t, end: t + beats, meter: {count: beats, unit: 4}, pickup: false, key: {fifths, mode}});
  });
  return {events, measures};
}
const labels = a => a.chords.map(c => c.label);

describe('keys', () => {
  test('keyOf names the key from the signature', () => {
    expect(keyOf(0)).toMatchObject({tonic: 0, mode: 'major', name: 'C major'});
    expect(keyOf(0, 'minor')).toMatchObject({tonic: 9, name: 'A minor'});
    expect(keyOf(-3, 'minor').name).toBe('C minor');
    expect(keyOf(6).name).toBe('F♯ major');
    expect(keyOf(-2).name).toBe('B♭ major');
  });

  test('major or relative minor is decided by the notes', () => {
    const cMajor = chorale([['C3', 'E4', 'G4', 'C5'], ['F3', 'F4', 'A4', 'C5'], ['G3', 'D4', 'G4', 'B4'], ['C3', 'E4', 'G4', 'C5']]);
    expect(detectKey(cMajor.events, {fifths: 0}).name).toBe('C major');
    const aMinor = chorale([['A2', 'E4', 'A4', 'C5'], ['D3', 'F4', 'A4', 'D5'], ['E3', 'E4', 'G#4', 'B4'], ['A2', 'E4', 'A4', 'C5']]);
    expect(detectKey(aMinor.events, {fifths: 0}).name).toBe('A minor');
    // A mode written in the file is trusted.
    expect(detectKey(aMinor.events, {fifths: 0, mode: 'major'}).name).toBe('C major');
  });

  test('a key signature change starts a new region', () => {
    const a = chorale([['C3', 'E4', 'G4', 'C5'], ['G3', 'D4', 'G4', 'B4'], ['C3', 'E4', 'G4', 'C5']]);
    const b = chorale([['G2', 'D4', 'G4', 'B4'], ['D3', 'D4', 'F#4', 'A4'], ['G2', 'D4', 'G4', 'B4']], {fifths: 1});
    const events = [...a.events, ...b.events.map(e => ({...e, t: e.t + 12}))];
    const measures = [...a.measures, ...b.measures.map((m, i) => ({...m, index: 3 + i, start: m.start + 12, end: m.end + 12}))];
    const r = analyseHarmony({events, measures});
    expect(r.keys.map(k => [k.first, k.last, k.key.name])).toEqual([[0, 2, 'C major'], [3, 5, 'G major']]);
    expect(labels(r)).toEqual(['I', 'V', 'I', 'I', 'V', 'I']);
  });
});

describe('cadences', () => {
  test('perfect cadence with a cadential 6/4 in C: I IV ii6 I6/4 V7 I', () => {
    const r = analyseHarmony(chorale([
      ['C3', 'E4', 'G4', 'C5'], ['F2', 'F4', 'A4', 'C5'], ['F2', 'D4', 'A4', 'D5'], ['G2', 'E4', 'G4', 'C5'], ['G2', 'D4', 'F4', 'B4'], ['C3', 'E4', 'G4', 'C5'],
    ]));
    expect(labels(r)).toEqual(['I', 'IV', 'ii6', 'I6/4', 'V7', 'I']);
    expect(r.chords.map(c => c.symbol)).toEqual(['C', 'F', 'Dm/F', 'C/G', 'G7', 'C']);
  });

  test('plagal and interrupted cadences in G major: I IV I · V vi', () => {
    const r = analyseHarmony(chorale([['G2', 'B3', 'D4', 'G4'], ['C3', 'C4', 'E4', 'G4'], ['G2', 'B3', 'D4', 'G4'], ['D3', 'A3', 'D4', 'F#4'], ['E3', 'B3', 'E4', 'G4']], {fifths: 1}));
    expect(labels(r)).toEqual(['I', 'IV', 'I', 'V', 'vi']);
  });

  test('minor key: i iv V7 i with the raised leading note (A minor: G♯)', () => {
    const r = analyseHarmony(chorale([['A2', 'E4', 'A4', 'C5'], ['D3', 'F4', 'A4', 'D5'], ['E3', 'D4', 'G#4', 'B4'], ['A2', 'E4', 'A4', 'C5']]));
    expect(r.keys[0].key.name).toBe('A minor');
    expect(labels(r)).toEqual(['i', 'iv', 'V7', 'i']);
    expect(r.chords[2].symbol).toBe('E7');
  });

  test('secondary dominants and leading-note sevenths: V7/V, vii°7/V', () => {
    const key = keyOf(0);
    expect(romanNumeral({root: 2, quality: 'dom7', bass: 2}, key).text).toBe('V7/V');
    expect(romanNumeral({root: 2, quality: 'dom7', bass: 0}, key).text).toBe('V4/2/V');
    expect(romanNumeral({root: 6, quality: 'dim7', bass: 6}, key).text).toBe('vii°7/V');
    expect(romanNumeral({root: 4, quality: 'maj', bass: 4}, key).text).toBe('V/vi');
    expect(romanNumeral({root: 10, quality: 'maj', bass: 10}, key).text).toBe('♭VII');
    expect(romanNumeral({root: 11, quality: 'dim', bass: 2}, key).text).toBe('vii°6');
    expect(secondaryTarget(7, 'dom7', key, diatonicSet(key))).toBe(0); // G7 is diatonic in C
    expect(chordSymbol({root: 1, quality: 'dim7', bass: 7}, key)).toBe('C♯°7/G');
    expect(chordSymbol({root: 10, quality: 'maj', bass: 10}, keyOf(-1))).toBe('B♭');
  });

  test('a bare melody is not given chords of its own; rests keep the chord before them', () => {
    const {events, measures} = chorale([['C3', 'E4', 'G4', 'C5'], ['C3', 'E4', 'G4', 'C5']]);
    // Bar 3: a lone melody line; bar 4: silence.
    events.push({n: midi('D5'), t: 8, d: 1}, {n: midi('B4'), t: 9, d: 1}, {n: midi('A4'), t: 10, d: 2});
    measures.push({index: 2, start: 8, end: 12, meter: {count: 4, unit: 4}, key: {fifths: 0}}, {index: 3, start: 12, end: 16, meter: {count: 4, unit: 4}, key: {fifths: 0}});
    const r = analyseHarmony({events, measures});
    expect(labels(r)).toEqual(['I']);
    expect(r.chords[0]).toMatchObject({t: 0, end: 16});
  });

  test('passing notes in a broken figure do not make the chords flicker', () => {
    // C major arpeggio with a passing D and F, over a held C — one chord for the bar.
    const events = [{n: midi('C3'), t: 0, d: 4}, ...['C4', 'D4', 'E4', 'F4', 'G4', 'E4', 'C4', 'G4'].map((n, i) => ({n: midi(n), t: i * 0.5, d: 0.5}))];
    const measures = [{index: 0, start: 0, end: 4, meter: {count: 4, unit: 4}, key: {fifths: 0}}];
    expect(labels(analyseHarmony({events, measures}))).toEqual(['I']);
  });

  test('empty input gives an empty analysis', () => {
    expect(analyseHarmony({events: [], measures: []})).toEqual({keys: [], chords: []});
  });
});

describe('the Bach Prelude in C, BWV 846', () => {
  let byBar;
  beforeAll(async () => {
    const tk = await createToolkit();
    tk.setOptions({breaks: 'none', expandAlways: true});
    expect(tk.loadData(readFileSync('public/songs/bach-prelude-in-c.musicxml', 'utf8'))).toBeTruthy();
    const score = buildScore(tk);
    const a = analyseHarmony(score);
    expect(a.keys.map(k => k.key.name)).toEqual(['C major']);
    byBar = new Map();
    for (const c of a.chords) byBar.set(score.measures[c.measure].label, [...(byBar.get(score.measures[c.measure].label) || []), c]);
  }, 30_000);

  // One harmony per bar, as in any analysis of the piece (labels with inversion figures).
  const EXPECTED = {
    1: ['I', 'C'], 2: ['ii4/2', 'Dm7/C'], 3: ['V6/5', 'G7/B'], 4: ['I', 'C'], 5: ['vi6', 'Am/C'], 6: ['V4/2/V', 'D7/C'],
    7: ['V6', 'G/B'], 8: ['I4/2', 'Cmaj7/B'], 9: ['vi7', 'Am7'], 10: ['V7/V', 'D7'], 11: ['V', 'G'], 12: ['vii°4/3/ii', 'C♯°7/G'],
    13: ['ii6', 'Dm/F'], 14: ['vii°4/3', 'B°7/F'], 15: ['I6', 'C/E'], 16: ['IV4/2', 'Fmaj7/E'], 17: ['ii7', 'Dm7'], 18: ['V7', 'G7'],
    19: ['I', 'C'], 20: ['V7/IV', 'C7'], 21: ['IV7', 'Fmaj7'], 22: ['vii°7/V', 'F♯°7'], 23: ['vii°4/2', 'B°7/A♭'], 24: ['V7', 'G7'],
    35: ['I', 'C'],
  };
  test.each(Object.entries(EXPECTED))('bar %s', (bar, [label, symbol]) => {
    const chords = byBar.get(bar);
    expect(chords?.map(c => [c.label, c.symbol])).toEqual([[label, symbol]]);
  });

  test('the dominant pedal (bars 24–31) reads as V or I6/4 over G, the tonic pedal ends on I', () => {
    for (const bar of ['25', '26', '29', '30']) {
      const c = byBar.get(bar)?.[0];
      expect(c?.bass, `bar ${bar}`).toBe(7);
      expect(['V', 'V7', 'I6/4'], `bar ${bar}`).toContain(c.label);
    }
  });
});

describe('performanceScore()', () => {
  test('accuracy, timing and evenness, and an overall score', () => {
    const r = performanceScore({counts: {perfect: 80, early: 10, late: 10, miss: 5, wrong: 5}, evenness: {score: 90}});
    expect(r).toEqual({accuracy: 91, timing: 90, evenness: 90, score: Math.round(0.5 * 91 + 0.3 * 90 + 0.2 * 90), verdict: 'Well performed.'});
  });
  test('without enough notes for evenness, accuracy and timing carry the score', () => {
    const r = performanceScore({counts: {perfect: 10, early: 0, late: 0, miss: 0, wrong: 0}, evenness: null});
    expect(r).toMatchObject({accuracy: 100, timing: 100, evenness: null, score: 100, verdict: 'A clean performance.'});
  });
  test('nothing played scores nothing', () => {
    expect(performanceScore({counts: {miss: 12}})).toMatchObject({accuracy: 0, timing: 0, score: 0, verdict: 'Keep at it.'});
    expect(performanceScore()).toMatchObject({accuracy: 0, timing: 0, evenness: null, score: 0});
  });
  test('early and late notes count half for timing', () => {
    expect(performanceScore({counts: {perfect: 5, early: 5, late: 0}}).timing).toBe(75);
  });
});
