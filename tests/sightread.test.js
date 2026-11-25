// @vitest-environment jsdom
import {beforeAll, describe, expect, test} from 'vitest';
import {generateSightReading} from '../src/sightread/generate.js';
import {SR_LEVELS} from '../src/sightread/levels.js';
import {parseSightReadingId, resolveSightReading, sightReadingId, isSightReadingId} from '../src/sightread/index.js';
import {barLength} from '../src/rhythm/patterns.js';
import {noteValue} from '../src/theory/engrave.js';
import {midi, pitchClass, parseKey, LETTERS} from '../src/exercises/theory.js';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';
import {measures, notes} from './xml-helpers.js';

const SEEDS = Array.from({length: 25}, (_, i) => i * 7919 + 3);
const sum = evs => +evs.reduce((a, e) => a + e.dur, 0).toFixed(6);
const diat = p => p.octave * 7 + LETTERS.indexOf(p.step);
const melody = g => g.rh.flat().filter(e => !e.rest).map(e => e.pitches[0]);

describe('sight-reading generator', () => {
  for (const level of SR_LEVELS) {
    test(`${level.id}: bars, metre, key, range and cadence`, () => {
      const maxStep = Math.max(...Object.keys(level.steps).map(Number));
      for (const seed of SEEDS) {
        const g = generateSightReading(level.id, seed);
        expect(g.rh).toHaveLength(level.bars);
        expect(g.lh).toHaveLength(level.bars);
        expect(level.times.map(t => t.join('/'))).toContain(g.time.join('/'));
        expect(level.keys.map(k => k.join())).toContain([g.key, g.mode].join());
        const L = barLength(g.time);
        for (let b = 0; b < level.bars; b++) {
          expect(sum(g.rh[b]), `RH bar ${b + 1}, seed ${seed}`).toBe(L);
          expect(sum(g.lh[b]), `LH bar ${b + 1}, seed ${seed}`).toBe(L);
          for (const e of [...g.rh[b], ...g.lh[b]]) expect(noteValue(e.dur), `duration ${e.dur}`).toBeTruthy();
        }
        expect(g.rh[0][0].rest).toBeFalsy();
        const mel = melody(g);
        for (const p of mel) {
          expect(midi(p)).toBeGreaterThanOrEqual(level.range[0]);
          expect(midi(p)).toBeLessThanOrEqual(level.range[1]);
        }
        const tonic = pitchClass(parseKey(g.key));
        expect(pitchClass(mel.at(-1)), `ends on the tonic (seed ${seed})`).toBe(tonic);
        expect(Math.abs(diat(mel.at(-1)) - diat(mel.at(-2))), 'approached by step').toBeLessThanOrEqual(1);
        expect(g.rh.at(-1).at(-1).dur, 'the last note is held').toBeGreaterThanOrEqual(1.5);
        for (let i = 1; i < mel.length; i++) {
          const steps = Math.abs(diat(mel[i]) - diat(mel[i - 1]));
          expect(steps, `leap at note ${i + 1}, seed ${seed}`).toBeLessThanOrEqual(Math.max(maxStep, 2));
          if (g.mode === 'minor' && steps === 1) expect(Math.abs(midi(mel[i]) - midi(mel[i - 1])), 'no augmented 2nd').toBeLessThan(3);
        }
        if (level.id === 'beginner') {
          const ds = mel.map(diat);
          expect(Math.max(...ds) - Math.min(...ds), 'five-finger position').toBeLessThanOrEqual(4);
        }
        expect(g.harmony.at(-1)).toMatch(/^[Ii]$/);
        expect(g.harmony.at(-2)).toBe('V');
      }
    });
  }

  test('the same seed gives the same piece; different seeds differ', () => {
    expect(generateSightReading('grade-2', 42).musicxml).toBe(generateSightReading('grade-2', 42).musicxml);
    const pieces = new Set(SEEDS.map(s => generateSightReading('grade-2', s).musicxml));
    expect(pieces.size).toBeGreaterThan(SEEDS.length * .9);
  });

  test('MusicXML: two staves per bar that add up, accidentals against the key, beams in pairs', () => {
    for (const level of SR_LEVELS) for (const seed of SEEDS.slice(0, 6)) {
      const g = generateSightReading(level.id, seed);
      const ms = measures(g.musicxml);
      expect(ms).toHaveLength(level.bars);
      const L = barLength(g.time) * 12;
      for (const m of ms) {
        const [rh, lh] = m.body.split('<backup>');
        for (const part of [rh, lh]) {
          const total = notes(part).filter(n => !n.chord).reduce((a, n) => a + n.duration, 0);
          expect(total).toBe(L);
          const beams = notes(part).flatMap(n => n.beams.filter(b => b.startsWith('1:')));
          expect(beams.filter(b => b === '1:begin').length).toBe(beams.filter(b => b === '1:end').length);
        }
      }
      expect(g.musicxml).toContain(`<fifths>${g.fifths}</fifths>`);
      expect(g.musicxml).toContain(`<beats>${g.time[0]}</beats><beat-type>${g.time[1]}</beat-type>`);
    }
  });

  test('ids', () => {
    expect(parseSightReadingId('sr:grade-3:1234')).toEqual({level: 'grade-3', seed: 1234});
    for (const bad of ['sr:grade-9:1', 'sr:grade-1:0', 'sr:grade-1:x', 'ex:scale:C', 'sr:grade-1', '']) expect(parseSightReadingId(bad)).toBeNull();
    expect(isSightReadingId(sightReadingId('beginner'))).toBe(true);
    expect(parseSightReadingId(sightReadingId('grade-5'))?.level).toBe('grade-5');
    const r = resolveSightReading('sr:grade-1:77');
    expect(r.entry).toMatchObject({id: 'sr:grade-1:77', mode: 'timed', intent: 'practice', kind: 'exercise', section: [0, 3]});
    expect(r.source.data).toContain('<score-partwise');
    expect(resolveSightReading('sr:nope:1')).toBeNull();
  });
});

describe('sight-reading pieces through Verovio', () => {
  let tk;
  beforeAll(async () => { tk = await createToolkit(); tk.setOptions({breaks: 'none'}); }, 30_000);
  test('every level loads with the right bars, metre and note count', () => {
    for (const level of SR_LEVELS) for (const seed of [1, 2]) {
      const g = generateSightReading(level.id, seed);
      expect(tk.loadData(g.musicxml)).toBeTruthy();
      const score = buildScore(tk);
      expect(score.measures).toHaveLength(level.bars);
      for (const m of score.measures) expect([m.meter.count, m.meter.unit]).toEqual(g.time);
      const sounding = g.rh.flat().filter(e => !e.rest).length + g.lh.flat().reduce((a, e) => a + (e.rest ? 0 : e.pitches.length), 0);
      expect(score.events.length).toBe(sounding);
      expect(score.events.some(e => e.hand === 'l')).toBe(true);
    }
  });
});
