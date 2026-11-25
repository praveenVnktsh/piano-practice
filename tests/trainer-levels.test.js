import {describe, expect, it} from 'vitest';
import {
  LEVELS, KEYS, candidates, keyAlters, levelById, matches, midiOf, parsePitch, pick, recordAnswer, weightOf,
} from '../src/trainer/levels.js';
import {renderStaff, staffPos} from '../src/trainer/render.js';

const P = parsePitch;
// Deterministic RNG (mulberry32).
function rng(seed = 1) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

describe('pitches', () => {
  it('converts to MIDI', () => {
    expect(midiOf(P('C4'))).toBe(60);
    expect(midiOf(P('F#3'))).toBe(54);
    expect(midiOf(P('Bb2'))).toBe(46);
    expect(midiOf(P('C6'))).toBe(84);
  });
  it('matches exact pitch or any octave', () => {
    expect(matches(60, {midi: 60})).toBe(true);
    expect(matches(72, {midi: 60})).toBe(false);
    expect(matches(72, {midi: 60}, true)).toBe(true);
    expect(matches(48, {midi: 60}, true)).toBe(true);
    expect(matches(61, {midi: 60}, true)).toBe(false);
  });
});

describe('level ranges', () => {
  const span = (id, opts) => {
    const ms = candidates(levelById(id), opts).flatMap(it => it.pitches.map(p => p.midi));
    return [Math.min(...ms), Math.max(...ms)];
  };
  it('treble is C4–G5 naturals on the treble staff', () => {
    const items = candidates(levelById('treble'));
    expect(span('treble')).toEqual([60, 79]);
    expect(items).toHaveLength(12);
    expect(items.every(it => it.clef === 'treble' && it.pitches[0].alter === 0)).toBe(true);
  });
  it('bass is F2–C4 naturals', () => {
    expect(span('bass')).toEqual([41, 60]);
    expect(candidates(levelById('bass')).every(it => it.clef === 'bass')).toBe(true);
  });
  it('ledger levels extend the ranges', () => {
    expect(span('treble-ledger')).toEqual([57, 84]); // A3–C6
    expect(span('bass-ledger')).toEqual([40, 64]);   // E2–E4
    expect(span('grand-ledger')).toEqual([40, 84]);
  });
  it('grand staff uses both clefs, with middle C on each', () => {
    const items = candidates(levelById('grand'));
    expect(new Set(items.map(it => it.clef))).toEqual(new Set(['treble', 'bass']));
    expect(items.filter(it => it.pitches[0].midi === 60).map(it => it.clef).sort()).toEqual(['bass', 'treble']);
  });
  it('landmarks are the anchor notes', () => {
    const ids = candidates(levelById('landmarks')).map(it => it.id);
    expect(ids).toEqual(expect.arrayContaining(['treble:C4', 'bass:C4', 'treble:G4', 'bass:F3']));
  });
  it('accidentals level adds sharps and flats with common spellings only', () => {
    const items = candidates(levelById('accidentals'));
    const alters = new Set(items.map(it => it.pitches[0].alter));
    expect(alters).toEqual(new Set([-1, 0, 1]));
    const names = items.map(it => it.id.split(':')[1]);
    expect(names).toContain('F#4');
    expect(names).toContain('Bb3');
    expect(names.some(n => /^(E#|B#|Fb|Cb)/.test(n))).toBe(false);
  });
  it('intervals are two notes, a 2nd to an octave apart, on one staff', () => {
    const items = candidates(levelById('intervals'));
    expect(items.length).toBeGreaterThan(50);
    for (const it of items) {
      expect(it.pitches).toHaveLength(2);
      const steps = staffPos(it.pitches[1], it.clef) - staffPos(it.pitches[0], it.clef);
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(steps).toBeLessThanOrEqual(7);
    }
  });
  it('every level yields items', () => {
    for (const l of LEVELS) expect(candidates(l).length).toBeGreaterThan(5);
  });
});

describe('key signatures', () => {
  it('knows the accidentals of each key', () => {
    expect(keyAlters(2)).toEqual({F: 1, C: 1});
    expect(keyAlters(-3)).toEqual({B: -1, E: -1, A: -1});
    expect(keyAlters(0)).toEqual({});
  });
  it('keys level only asks notes diatonic to the key', () => {
    for (const key of KEYS) {
      const items = candidates(levelById('keys'), {key: key.id});
      const alters = keyAlters(key.fifths);
      // Pitch classes of the major scale on the tonic.
      const tonic = midiOf({step: key.id[0], alter: key.id[1] === 'b' ? -1 : 0, octave: 4}) % 12;
      const scale = new Set([0, 2, 4, 5, 7, 9, 11].map(s => (tonic + s) % 12));
      for (const it of items) {
        const p = it.pitches[0];
        expect(p.alter).toBe(alters[p.step] ?? 0);
        expect(scale.has(p.midi % 12)).toBe(true);
        expect(it.key).toBe(key.id);
      }
      expect(new Set(items.map(it => it.pitches[0].midi % 12)).size).toBe(7);
    }
  });
  it('renders the key signature and omits accidentals the key already supplies', () => {
    const svg = renderStaff({staff: 'treble', key: 2, item: {clef: 'treble', pitches: [{...P('F#4'), midi: 66}]}});
    expect(svg.match(/class="tr-keysig"/g)).toHaveLength(2);
    expect(svg).not.toContain('class="tr-acc"');
    const nat = renderStaff({staff: 'treble', key: 2, item: {clef: 'treble', pitches: [P('F4')]}});
    expect(nat.match(/class="tr-acc"/g)).toHaveLength(1);
  });
});

describe('rendering', () => {
  it('draws ledger lines for notes outside the staff', () => {
    const count = (staff, clef, p) => (renderStaff({staff, item: {clef, pitches: [P(p)]}}).match(/tr-ledger/g) || []).length;
    expect(count('treble', 'treble', 'C4')).toBe(1);
    expect(count('treble', 'treble', 'A3')).toBe(2);
    expect(count('treble', 'treble', 'C6')).toBe(2);
    expect(count('treble', 'treble', 'G4')).toBe(0);
    expect(count('bass', 'bass', 'E4')).toBe(2);
    expect(count('bass', 'bass', 'E2')).toBe(1);
    expect(count('grand', 'bass', 'C4')).toBe(1);
  });
  it('draws both clefs and a brace on the grand staff', () => {
    const svg = renderStaff({staff: 'grand', item: null});
    expect(svg.match(/tr-clef/g)).toHaveLength(2);
    expect(svg).toContain('tr-brace');
    expect(svg.match(/tr-line/g).length).toBe(11);
  });
});

describe('picker', () => {
  const items = candidates(levelById('treble'));
  it('never repeats the previous item', () => {
    const r = rng(7);
    let last = null;
    for (let i = 0; i < 500; i++) {
      const it = pick(items, {last, rng: r});
      if (last) expect(it.pitches[0].midi).not.toBe(last.pitches[0].midi);
      last = it;
    }
  });
  it('avoids the same pitch even when written on the other clef', () => {
    const lm = candidates(levelById('landmarks'));
    const trebleC = lm.find(it => it.id === 'treble:C4');
    for (let i = 0; i < 200; i++) expect(pick(lm, {last: trebleC, rng: rng(i)}).pitches[0].midi).not.toBe(60);
  });
  it('falls back to the only item when there is one', () => {
    expect(pick(items.slice(0, 1), {last: items[0]})).toBe(items[0]);
  });
  it('weights missed notes above known ones', () => {
    let stats = {};
    for (const it of items) for (let k = 0; k < 4; k++) stats = recordAnswer(stats, it.id, {correct: true, ms: 900});
    stats = recordAnswer(stats, 'treble:A4', {correct: false});
    expect(weightOf(stats['treble:A4'])).toBeGreaterThan(weightOf(stats['treble:C4']));
    const r = rng(3), counts = {};
    let last = null;
    for (let i = 0; i < 3000; i++) { last = pick(items, {stats, last, rng: r}); counts[last.id] = (counts[last.id] || 0) + 1; }
    const others = Object.entries(counts).filter(([id]) => id !== 'treble:A4').map(([, n]) => n);
    expect(counts['treble:A4']).toBeGreaterThan(3 * Math.max(...others));
  });
  it('moves items between boxes', () => {
    let s = recordAnswer({}, 'x', {correct: true, ms: 800});
    expect(s.x).toMatchObject({box: 1, seen: 1, miss: 0, ms: 800});
    s = recordAnswer(s, 'x', {correct: true, ms: 9000}); // slow: stays put
    expect(s.x.box).toBe(1);
    s = recordAnswer(s, 'x', {correct: false});
    expect(s.x).toMatchObject({box: 0, seen: 3, miss: 1});
    expect(weightOf(undefined)).toBeGreaterThan(weightOf({box: 4}));
  });
});
