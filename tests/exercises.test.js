// @vitest-environment jsdom
import {describe, expect, test} from 'vitest';

import {
  parseKey, pitchName, scaleDegrees, keyFifths, triad, diatonicChords, chordFromNumeral, isBlackKey, pitchClass,
  MAJOR_KEYS, MINOR_KEYS, CHROMATIC_STARTS, relativeMinor,
} from '../src/exercises/theory.js';
import {scaleFingering, scaleTable, arpeggioFingering, arpeggioTable, chromaticFinger} from '../src/exercises/fingering.js';
import {generateExercise} from '../src/exercises/generate.js';
import {resolveExercise, parseExerciseId, exerciseId, listPresets, dailyWarmup} from '../src/exercises/index.js';
import {measures, notes} from './xml-helpers.js';

const names = (key, mode) => scaleDegrees(parseKey(key), mode).map(pitchName).join(' ');
const fingers = xml => [...xml.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(([, n]) => n.match(/<fingering[^>]*>(\d)</)?.[1]);

describe('theory: spelling', () => {
  test('major keys spell with one letter per degree', () => {
    expect(names('C', 'major')).toBe('C D E F G A B');
    expect(names('Fs', 'major')).toBe('F♯ G♯ A♯ B C♯ D♯ E♯');
    expect(names('Gb', 'major')).toBe('G♭ A♭ B♭ C♭ D♭ E♭ F');
    expect(names('Db', 'major')).toBe('D♭ E♭ F G♭ A♭ B♭ C');
    expect(names('Cs', 'major')).toBe('C♯ D♯ E♯ F♯ G♯ A♯ B♯');
  });
  test('minor forms', () => {
    expect(names('A', 'natural-minor')).toBe('A B C D E F G');
    expect(names('B', 'harmonic-minor')).toBe('B C♯ D E F♯ G A♯');
    expect(names('Gs', 'harmonic-minor')).toBe('G♯ A♯ B C♯ D♯ E F𝄪');
    expect(names('Eb', 'harmonic-minor')).toBe('E♭ F G♭ A♭ B♭ C♭ D');
    expect(names('D', 'melodic-minor')).toBe('D E F G A B C♯');
  });
  test('key signatures', () => {
    expect(MAJOR_KEYS.map(k => keyFifths(parseKey(k)))).toEqual([0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1]);
    expect(MINOR_KEYS.map(k => keyFifths(parseKey(k), 'harmonic-minor'))).toEqual([0, 1, 2, 3, 4, 5, -6, -5, -4, -3, -2, -1]);
    expect(() => keyFifths(parseKey('Gs'), 'major')).toThrow(/more than 7/);
  });
  test('every scale degree of every default key is a correctly spelled pitch', () => {
    const steps = {major: [0, 2, 4, 5, 7, 9, 11], 'harmonic-minor': [0, 2, 3, 5, 7, 8, 11]};
    for (const [mode, keys] of [['major', MAJOR_KEYS], ['harmonic-minor', MINOR_KEYS]])
      for (const k of keys) {
        const t = parseKey(k), d = scaleDegrees(t, mode);
        expect(new Set(d.map(p => p.step)).size).toBe(7);
        d.forEach((p, i) => expect((pitchClass(p) - pitchClass(t) + 12) % 12).toBe(steps[mode][i]));
      }
  });
  test('triads and diatonic chords', () => {
    expect(triad(parseKey('C'), 'major', 5).tones.map(pitchName)).toEqual(['G', 'B', 'D']);
    expect(diatonicChords(parseKey('D'), 'major').map(c => c.quality)).toEqual(['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished']);
    expect(chordFromNumeral(parseKey('A'), 'minor', 'V').tones.map(pitchName)).toEqual(['E', 'G♯', 'B']);
    expect(chordFromNumeral(parseKey('A'), 'minor', 'VII').tones.map(pitchName)).toEqual(['G', 'B', 'D']);
    expect(pitchName(relativeMinor(parseKey('Eb')))).toBe('C');
  });
});

describe('fingering tables', () => {
  test('classic samples', () => {
    expect(scaleFingering(0, 'major', 'right', 1)).toEqual({up: [1, 2, 3, 1, 2, 3, 4, 5], down: [4, 3, 2, 1, 3, 2, 1]});
    expect(scaleFingering(0, 'major', 'left', 1).up).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
    expect(scaleFingering(0, 'major', 'right', 2).up).toEqual([1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]);
    expect(scaleFingering(0, 'major', 'left', 2).up).toEqual([5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]);
    expect(scaleFingering(11, 'major', 'left', 1).up).toEqual([4, 3, 2, 1, 4, 3, 2, 1]);
    expect(scaleFingering(5, 'major', 'right', 1).up).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(scaleFingering(10, 'major', 'right', 2).up).toEqual([2, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4]);
    expect(scaleFingering(6, 'major', 'right', 1).up).toEqual([2, 3, 4, 1, 2, 3, 1, 2]);
    expect(scaleFingering(1, 'major', 'right', 1).up).toEqual([2, 3, 1, 2, 3, 4, 1, 2]);
    expect(arpeggioFingering(0, 'major', 'right', 2).up).toEqual([1, 2, 3, 1, 2, 3, 5]);
    expect(arpeggioFingering(0, 'major', 'left', 1).up).toEqual([5, 4, 2, 1]);
    expect(arpeggioFingering(1, 'major', 'right', 1).up).toEqual([4, 1, 2, 4]);
    expect(chromaticFinger(1, 'right')).toBe(3);
    expect(chromaticFinger(5, 'right')).toBe(2);
    expect(chromaticFinger(4, 'left')).toBe(2);
  });

  const forms = ['major', 'natural-minor', 'harmonic-minor', 'melodic-minor'];
  test('scale fingerings keep the thumb on white keys and move by step or by a thumb crossing', () => {
    for (const mode of forms)
      for (let pc = 0; pc < 12; pc++)
        for (const hand of ['right', 'left']) {
          const t = scaleTable(pc, mode, hand);
          const steps = (mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : mode === 'natural-minor' ? [0, 2, 3, 5, 7, 8, 10] : mode === 'harmonic-minor' ? [0, 2, 3, 5, 7, 8, 11] : [0, 2, 3, 5, 7, 9, 11]);
          const seq = [...t.degrees, t.mid, ...t.degrees.slice(1)];
          seq.forEach((f, i) => { if (f === 1) expect(isBlackKey(pc + steps[i % 7]), `${mode} ${hand} pc${pc} deg${(i % 7) + 1}`).toBe(false); });
          for (let i = 1; i < seq.length; i++) {
            const [a, b] = [seq[i - 1], seq[i]];
            const ok = hand === 'right' ? b === a + 1 || b === 1 : b === a - 1 || (a === 1 && (b === 3 || b === 4));
            expect(ok, `${mode} ${hand} pc${pc}: ${a}→${b}`).toBe(true);
          }
        }
  });
  test('arpeggio fingerings: thumb on white keys unless the triad is all black', () => {
    for (const q of ['major', 'minor'])
      for (let pc = 0; pc < 12; pc++)
        for (const hand of ['right', 'left']) {
          const t = arpeggioTable(pc, q, hand);
          const tones = [pc + (q === 'minor' ? 3 : 4), pc + 7, pc];
          const allBlack = [pc, ...tones].every(isBlackKey);
          t.cycle.forEach((f, i) => { if (f === 1 && !allBlack) expect(isBlackKey(tones[i]), `${q} ${hand} pc${pc}`).toBe(false); });
        }
  });
});

describe('generateExercise()', () => {
  const xmlOf = id => resolveExercise(id).source.data;

  test('every exercise has full 4/4 bars on both staves and a fingering on every note', () => {
    const ids = [];
    for (const k of MAJOR_KEYS) for (const o of [1, 2, 3, 4]) ids.push(`ex:scale:${k}:major:both:${o}:up-down`, `ex:arpeggio:${k}:major:right:${o}`);
    for (const k of MINOR_KEYS) for (const m of ['natural-minor', 'harmonic-minor', 'melodic-minor']) ids.push(`ex:scale:${k}:${m}:left:2:up-down`);
    for (const k of MINOR_KEYS) ids.push(`ex:arpeggio:${k}:minor:both:2`, `ex:five-finger:${k}:minor:both`, `ex:progression:${k}:minor:i-iv-V-i`);
    for (const k of MAJOR_KEYS) ids.push(`ex:progression:${k}:major:I-vi-IV-V`, `ex:progression:${k}:major:ii-V-I`);
    for (const k of CHROMATIC_STARTS) ids.push(`ex:chromatic:${k}:both:2`);
    for (const id of ids) {
      const xml = xmlOf(id);
      for (const m of measures(xml)) {
        const [rh, lh] = m.body.split('<backup>');
        const sum = s => notes(s).filter(n => !n.chord).reduce((a, n) => a + n.duration, 0);
        expect(sum(rh), `${id} m${m.number} RH`).toBe(16);
        expect(sum(lh), `${id} m${m.number} LH`).toBe(16);
      }
      const pitched = notes(xml).filter(n => n.pitch);
      expect(fingers(xml).filter((f, i) => notes(xml)[i].pitch).every(Boolean), id).toBe(true);
      expect(pitched.length).toBeGreaterThan(3);
    }
  }, 30000); // hundreds of exercises: slow on a busy CI runner

  test('is well-formed MusicXML', () => {
    for (const id of ['ex:scale:Fs:major:both:2:up-down', 'ex:progression:Bb:major:I-IV-V-I', 'ex:chromatic:Eb:left:1']) {
      const doc = new DOMParser().parseFromString(xmlOf(id), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length).toBe(0);
      expect(doc.documentElement.getAttribute('version')).toBe('4.0');
      expect(doc.querySelector('key fifths').textContent).toMatch(/^-?\d$/);
    }
  });

  test('C major scale, 1 octave, hands together', () => {
    const xml = xmlOf('ex:scale:C:major:both:1:up-down');
    const rh = notes(xml).filter(n => n.staff === '1');
    expect(rh.map(n => n.pitch).join(' ')).toBe('C4 D4 E4 F4 G4 A4 B4 C5 B4 A4 G4 F4 E4 D4 C4');
    expect(rh.at(-1).type).toBe('quarter');
    expect(rh[0].beams).toEqual(['1:begin']);
    const lh = notes(xml).filter(n => n.staff === '2');
    expect(lh[0].pitch).toBe('C3');
    const f = fingers(xml), all = notes(xml);
    expect(f.filter((_, i) => all[i].staff === '1').join('')).toBe('123123454321321');
    expect(f.filter((_, i) => all[i].staff === '2').join('')).toBe('543213212312345');
    expect(xml).toContain('<fingering placement="below">5</fingering>');
  });

  test('accidentals follow the key signature', () => {
    const fs = xmlOf('ex:scale:Fs:major:right:1:up-down');
    expect(fs).toContain('<fifths>6</fifths>');
    expect(notes(fs).map(n => n.pitch)).toContain('E#5');
    expect(notes(fs).filter(n => n.accidental).length).toBe(0);
    const bm = xmlOf('ex:scale:B:harmonic-minor:right:1:up-down');
    const as = notes(bm).filter(n => n.pitch === 'A#4');
    expect(as[0].accidental).toBe('sharp');
    const gb = notes(xmlOf('ex:scale:Gb:major:right:1:up-down')).map(n => n.pitch);
    expect(gb).toContain('Cb5');
    // Melodic minor: raised going up, natural (with a courtesy accidental) coming down.
    const am = xmlOf('ex:scale:A:melodic-minor:right:1:up-down');
    expect(notes(am).filter(n => n.staff === '1').map(n => n.pitch).join(' ')).toBe('A3 B3 C4 D4 E4 F#4 G#4 A4 G4 F4 E4 D4 C4 B3 A3');
    expect(am).toMatch(/<accidental cautionary="yes">natural<\/accidental>/);
  });

  test('hands-separate exercises rest in the other hand', () => {
    const xml = xmlOf('ex:scale:D:major:left:2:up-down');
    expect(notes(xml).filter(n => n.staff === '1').every(n => n.rest)).toBe(true);
    expect(notes(xml).filter(n => n.staff === '2').some(n => n.pitch)).toBe(true);
  });

  test('progressions voice-lead close-position triads over the root', () => {
    const xml = xmlOf('ex:progression:C:major:I-IV-V-I');
    const rh = notes(xml).filter(n => n.staff === '1').map(n => n.pitch);
    expect(rh).toEqual(['C4', 'E4', 'G4', 'C4', 'F4', 'A4', 'B3', 'D4', 'G4', 'C4', 'E4', 'G4']);
    expect(notes(xml).filter(n => n.staff === '2').map(n => n.pitch)).toEqual(['C3', 'F2', 'G2', 'C3']);
  });

  test('rejects invalid parameters', () => {
    expect(() => generateExercise({type: 'scale', key: 'H'})).toThrow();
    expect(() => generateExercise({type: 'scale', key: 'C', octaves: 5})).toThrow();
    expect(() => generateExercise({type: 'progression', key: 'C', progression: 'I-X'})).toThrow();
  });
});

describe('exercise ids', () => {
  test('round trip and entries', () => {
    const id = 'ex:arpeggio:Fs:minor:right:2';
    expect(exerciseId(parseExerciseId(id))).toBe(id);
    const r = resolveExercise('ex:scale:C:major:both:2:up-down');
    expect(r.entry).toMatchObject({id: 'ex:scale:C:major:both:2:up-down', title: 'C major scale · hands together · 2 octaves', composer: 'Technique', section: null});
    expect(r.entry.tempo).toBeGreaterThan(0);
    expect(resolveExercise('ex:five-finger:G:major:both').entry.title).toBe('G major five-finger pattern · hands together');
    expect(resolveExercise('ex:progression:Bb:major:I-IV-V-I').entry.title).toBe('B♭ major chords · I–IV–V–I');
    expect(resolveExercise('ex:nope')).toBeNull();
    expect(resolveExercise('ex:scale:H:major')).toBeNull();
    expect(resolveExercise('fur-elise')).toBeNull();
  });
  test('presets and warm-up resolve', () => {
    for (const g of listPresets()) for (const item of g.items) expect(resolveExercise(item.id)).not.toBeNull();
    const w = dailyWarmup(new Date(2026, 0, 1));
    expect(MAJOR_KEYS).toContain(w.key);
    expect(w.items.every(i => resolveExercise(i.id))).toBe(true);
  });
});
