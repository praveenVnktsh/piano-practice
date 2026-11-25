import {describe, expect, test} from 'vitest';
import {intervalAbove, intervalBelow, nameInterval, chordTones, invert, classifyChord, voiceProgression, spellMidi, rng} from '../src/theory/music.js';
import {LESSONS, lessonById, lessonQuestions, playedMatches, CIRCLE, keySignatureText, tonicTriad} from '../src/theory/lessons.js';
import {engrave, beatLength} from '../src/theory/engrave.js';
import {soundingEvents} from '../src/theory/play.js';
import {barLength} from '../src/rhythm/patterns.js';
import {midi, parseKey, pitchClass} from '../src/exercises/theory.js';

const P = (s, o, a = 0) => ({step: s, alter: a, octave: o});
const name = p => p.step + ({1: '#', '-1': 'b', 2: 'x', '-2': 'bb'}[p.alter] ?? '') + p.octave;

describe('interval and chord spelling', () => {
  test('intervals above and below', () => {
    const cases = [['C4', 'M3', 'E4'], ['E4', 'm3', 'G4'], ['F4', 'P4', 'Bb4'], ['B3', 'P5', 'F#4'], ['A4', 'M7', 'G#5'], ['D4', 'm6', 'Bb4'],
      ['Eb4', 'M6', 'C5'], ['F#4', 'm2', 'G4'], ['G4', 'P8', 'G5'], ['C4', 'A4', 'F#4'], ['C4', 'd5', 'Gb4'], ['Bb3', 'M2', 'C4']];
    for (const [lo, id, hi] of cases) {
      const p = {step: lo[0], alter: lo.includes('#') ? 1 : lo.slice(1).startsWith('b') ? -1 : 0, octave: +lo.at(-1)};
      expect(name(intervalAbove(p, id)), `${id} above ${lo}`).toBe(hi);
      expect(name(intervalBelow(intervalAbove(p, id), id)), `${id} below ${hi}`).toBe(lo);
      expect(nameInterval(p, intervalAbove(p, id))).toBe(id);
    }
  });
  test('triads and sevenths', () => {
    const spell = (root, q) => chordTones(root, q).map(name).join(' ');
    expect(spell(P('C', 4), 'major')).toBe('C4 E4 G4');
    expect(spell(P('A', 3), 'minor')).toBe('A3 C4 E4');
    expect(spell(P('B', 3), 'diminished')).toBe('B3 D4 F4');
    expect(spell(P('C', 4), 'augmented')).toBe('C4 E4 G#4');
    expect(spell(P('G', 3), 'dom7')).toBe('G3 B3 D4 F4');
    expect(spell(P('E', 4, -1), 'major')).toBe('Eb4 G4 Bb4');
    expect(spell(P('F', 4, 1), 'minor')).toBe('F#4 A4 C#5');
    expect(invert(chordTones(P('C', 4), 'major'), 1).map(name).join(' ')).toBe('E4 G4 C5');
    expect(invert(chordTones(P('C', 4), 'major'), 2).map(name).join(' ')).toBe('G4 C5 E5');
  });
  test('chord recognition from played notes, any inversion', () => {
    expect(classifyChord([60, 64, 67])).toMatchObject({quality: 'major', inversion: 0, rootPc: 0});
    expect(classifyChord([64, 67, 72])).toMatchObject({quality: 'major', inversion: 1});
    expect(classifyChord([55, 60, 64])).toMatchObject({quality: 'major', inversion: 2});
    expect(classifyChord([57, 60, 64])?.quality).toBe('minor');
    expect(classifyChord([59, 62, 65])?.quality).toBe('diminished');
    expect(classifyChord([60, 64, 68])?.quality).toBe('augmented');
    expect(classifyChord([55, 59, 62, 65])?.quality).toBe('dom7');
    expect(classifyChord([60, 62, 64])).toBeNull();
    expect(classifyChord([60, 64])).toBeNull();
  });
  test('cadence voicing: root in the bass, close triads above, smooth', () => {
    for (const key of ['C', 'G', 'F', 'D', 'Bb', 'A']) {
      const v = voiceProgression(parseKey(key), 'major', ['I', 'IV', 'V', 'vi', 'I']);
      let prev = null;
      for (const c of v) {
        const [bass, ...rh] = c.pitches.map(midi);
        expect(pitchClass(c.chord.root)).toBe(bass % 12);
        expect(bass).toBeGreaterThanOrEqual(43); expect(bass).toBeLessThanOrEqual(54);
        expect(new Set(rh.map(m => m % 12))).toEqual(new Set(c.chord.tones.map(pitchClass)));
        expect(rh[2] - rh[0]).toBeLessThanOrEqual(9);
        if (prev) expect(rh.reduce((a, m, i) => a + Math.abs(m - prev[i]), 0)).toBeLessThanOrEqual(9);
        prev = rh;
      }
    }
  });
  test('spelling played keys', () => {
    expect(name(spellMidi(61))).toBe('C#4');
    expect(name(spellMidi(61, true))).toBe('Db4');
  });
});

describe('theory lessons', () => {
  test('lesson data is complete', () => {
    expect(LESSONS.map(l => l.id)).toEqual(['note-values', 'time-signatures', 'key-signatures', 'intervals', 'triads', 'cadences']);
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(lessonById(l.id)).toBe(l);
      expect(l.title && l.blurb).toBeTruthy();
      expect(l.cards.length).toBeGreaterThanOrEqual(3);
      expect(l.cards.length).toBeLessThanOrEqual(6);
      for (const c of l.cards) {
        expect(c.title).toBeTruthy();
        expect(c.text.length).toBeGreaterThan(0);
        for (const t of c.text) expect(t.split('**').length % 2, `unbalanced ** in ${l.id}`).toBe(1);
        if (c.example) checkExample(c.example, `${l.id}: ${c.title}`);
      }
    }
    expect(LESSONS.find(l => l.id === 'key-signatures').cards.some(c => c.widget === 'circle-of-fifths')).toBe(true);
  });

  test('questions: 5–10 per attempt, answerable, with explanations', () => {
    for (const l of LESSONS) for (let seed = 1; seed <= 25; seed++) {
      const qs = lessonQuestions(l, seed);
      expect(qs.length, l.id).toBeGreaterThanOrEqual(5);
      expect(qs.length, l.id).toBeLessThanOrEqual(10);
      for (const q of qs) {
        expect(q.prompt).toBeTruthy();
        expect(q.explain, q.prompt).toBeTruthy();
        if (q.example) checkExample(q.example, `${l.id}: ${q.prompt}`);
        if (q.choices) {
          expect(q.choices.length).toBeGreaterThanOrEqual(2);
          expect(new Set(q.choices.map(c => c.id)).size, q.prompt).toBe(q.choices.length);
          expect(new Set(q.choices.map(c => c.label)).size, q.prompt).toBe(q.choices.length);
          expect(q.choices.map(c => c.id), q.prompt).toContain(q.answer);
        } else {
          expect(q.play.pcs.length).toBe(q.play.count);
          for (const pc of q.play.pcs) expect(pc >= 0 && pc < 12).toBe(true);
        }
      }
    }
  });

  test('answers in the lessons are right', () => {
    // A few generated questions checked against the theory helpers.
    for (let seed = 1; seed <= 40; seed++) {
      for (const q of lessonQuestions(lessonById('intervals'), seed)) {
        if (q.prompt === 'Name this interval.') {
          const [lo, hi] = q.example.measures[0][0].pitches;
          expect(nameInterval(lo, hi)).toBe(q.answer);
        }
      }
      for (const q of lessonQuestions(lessonById('triads'), seed)) {
        if (q.prompt === 'What kind of triad is this?') expect(classifyChord(q.example.measures[0][0].pitches.map(midi)).quality).toBe(q.answer);
        if (q.prompt === 'Which position is this chord in?') expect(String(classifyChord(q.example.measures[0][0].pitches.map(midi)).inversion)).toBe(q.answer);
      }
      for (const q of lessonQuestions(lessonById('key-signatures'), seed)) {
        if (q.prompt === 'Which major key has this key signature?') expect(CIRCLE.find(k => k.fifths === q.example.key).major).toBe(q.answer);
      }
    }
  });

  test('keyboard answers', () => {
    expect(playedMatches({pcs: [0, 4, 7], count: 3}, [64, 72, 55])).toBe(true);
    expect(playedMatches({pcs: [0, 4, 7], count: 3}, [60, 63, 67])).toBe(false);
    expect(playedMatches({pcs: [2], count: 1}, [74])).toBe(true);
  });

  test('circle of fifths', () => {
    expect(CIRCLE.map(k => k.fifths)).toEqual([0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1]);
    expect(keySignatureText(3)).toBe('3 sharps: F♯ C♯ G♯');
    expect(keySignatureText(-1)).toBe('1 flat: B♭');
    expect(keySignatureText(0)).toBe('no sharps or flats');
    for (const k of CIRCLE) {
      const t = tonicTriad(k.major).map(midi);
      expect(t[0] % 12).toBe(pitchClass(parseKey(k.major)));
      expect(t[0]).toBeGreaterThanOrEqual(55); expect(t[0]).toBeLessThanOrEqual(66);
    }
  });
});

function checkExample(ex, where) {
  const out = engrave(ex);
  expect(out.svg, where).toMatch(/^<svg class="eg"/);
  expect(out.events.length, where).toBe(ex.measures.flat().length);
  if (ex.time && ex.barlines !== false) for (const m of ex.measures) expect(+m.reduce((a, e) => a + e.dur, 0).toFixed(6), where).toBe(barLength(ex.time));
  if (ex.play) expect(soundingEvents(ex).length, where).toBeGreaterThan(0);
  expect(beatLength(ex.time)).toBeGreaterThan(0);
}

test('seeded questions repeat', () => {
  const a = lessonQuestions(lessonById('cadences'), 9).map(q => q.prompt + q.answer);
  const b = lessonQuestions(lessonById('cadences'), 9).map(q => q.prompt + q.answer);
  expect(a).toEqual(b);
  expect(rng(1)()).toBe(rng(1)());
});
