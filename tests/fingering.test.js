// @vitest-environment jsdom
// Suggested fingering (src/fingering/): the Viterbi search on known cases, its accuracy against the
// conventional scale and arpeggio fingerings (src/exercises/fingering.js), printed fingering read
// from Verovio's MEI, and whole songs (bars with printed fingering are left alone).
import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {suggestFingering, suggestForSong} from '../src/fingering/suggest.mjs';
import {printedFingering} from '../src/fingering/printed.mjs';
import {scaleFingering, arpeggioFingering} from '../src/exercises/fingering.js';
import {resolveExercise} from '../src/exercises/index.js';
import {loadSong} from '../src/song.js';

const P = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
// 'C4 D4 F#4' → MIDI; one note per beat unless times are given.
const midi = s => 12 * (+s.at(-1) + 1) + P[s[0]] + (s.includes('#') ? 1 : s.includes('b') && s.length > 2 ? -1 : 0);
const line = (text, dur = 1) => text.split(/\s+/).map((s, i) => ({id: 'n' + i, n: midi(s), t: i * dur, end: (i + 1) * dur}));
const fingers = (notes, opts) => { const m = suggestFingering(notes, opts); return notes.map(e => m.get(e.id)).join(''); };
const upDown = notes => [...notes, ...notes.slice(0, -1).reverse()].map((n, i) => ({id: 'n' + i, n, t: i * .5, end: i * .5 + .5}));
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const scale = (pc, hand, octaves = 1, steps = MAJOR) => {
  const base = (hand === 'r' ? 60 : 48) + pc, up = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) up.push(base + 12 * o + s);
  return upDown([...up, base + 12 * octaves]);
};

describe('suggestFingering(): known cases', () => {
  test('C major scale, one octave up: RH 1-2-3-1-2-3-4-5, LH 5-4-3-2-1-3-2-1', () => {
    expect(fingers(line('C4 D4 E4 F4 G4 A4 B4 C5', .5), {hand: 'r'})).toBe('12312345');
    expect(fingers(line('C3 D3 E3 F3 G3 A3 B3 C4', .5), {hand: 'l'})).toBe('54321321');
  });
  test('C major scale down and back: the same fingers on the same notes', () => {
    expect(fingers(scale(0, 'r'), {hand: 'r'})).toBe('123123454321321');
    expect(fingers(scale(0, 'l'), {hand: 'l'})).toBe('543213212312345');
  });
  test('G major (F♯ under the fourth finger)', () => {
    expect(fingers(line('G4 A4 B4 C5 D5 E5 F#5 G5', .5), {hand: 'r'})).toBe('12312345');
    expect(fingers(line('G2 A2 B2 C3 D3 E3 F#3 G3', .5), {hand: 'l'})).toBe('54321321');
  });
  test('F major: the thumb never lands on B♭ (RH 1-2-3-4-1-2-3-4)', () => {
    expect(fingers(line('F4 G4 A4 Bb4 C5 D5 E5 F5', .5), {hand: 'r'})).toBe('12341234');
  });
  test('five-finger position: one finger per key, both hands', () => {
    expect(fingers(line('C4 D4 E4 F4 G4 F4 E4 D4 C4'), {hand: 'r', beginner: true})).toBe('123454321');
    expect(fingers(line('C3 D3 E3 F3 G3 F3 E3 D3 C3'), {hand: 'l', beginner: true})).toBe('543212345');
    expect(fingers(line('G4 A4 B4 C5 D5 C5 B4 A4 G4'), {hand: 'r', beginner: true})).toBe('123454321');
  });
  test('Ode to Joy, C position: 3 3 4 5 5 4 3 2 1 1 2 3 3 2 2', () => {
    const tune = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4';
    expect(fingers(line(tune), {hand: 'r', beginner: true})).toBe('334554321123322');
    expect(fingers(line(tune), {hand: 'r'})).toBe('334554321123322');
  });
  test('Mary Had a Little Lamb: 3 2 1 2 3 3 3, 2 2 2, 3 5 5', () => {
    expect(fingers(line('E4 D4 C4 D4 E4 E4 E4 D4 D4 D4 E4 G4 G4'), {hand: 'r', beginner: true})).toBe('3212333222355');
  });
  test('simple arpeggio: RH C E G C = 1 2 3 5; LH 5 4 2 1 or 5 3 2 1', () => {
    expect(fingers(upDown([60, 64, 67, 72]), {hand: 'r'})).toBe('1235321');
    expect(['5421245', '5321235']).toContain(fingers(upDown([48, 52, 55, 60]), {hand: 'l'}));
  });
  test('chords: fingers rise bottom → top in the right hand, fall in the left', () => {
    const chord = (ns, t = 0) => ns.map((n, i) => ({id: `c${t}-${i}`, n, t, end: t + 1}));
    const rh = suggestFingering(chord([60, 64, 67]), {hand: 'r'});
    expect([...rh.values()]).toEqual([1, 3, 5]);
    const lh = suggestFingering(chord([48, 52, 55]), {hand: 'l'});
    expect([lh.get('c0-0'), lh.get('c0-1'), lh.get('c0-2')]).toEqual([5, 3, 1]);
    // C → F (second inversion, C F A) → C: the common position keeps the thumb on C.
    const prog = [...chord([60, 64, 67], 0), ...chord([60, 65, 69], 1), ...chord([60, 64, 67], 2)];
    const m = suggestFingering(prog, {hand: 'r'});
    expect(['c0-0', 'c1-0', 'c2-0'].map(id => m.get(id))).toEqual([1, 1, 1]);
    expect(['c1-1', 'c1-2'].map(id => m.get(id))).toEqual([3, 5]);
  });
  test('a held note keeps its finger busy', () => {
    const notes = [{id: 'held', n: 60, t: 0, end: 4}, ...['E4', 'F4', 'G4'].map((s, i) => ({id: 'm' + i, n: midi(s), t: i + 1, end: i + 2}))];
    const m = suggestFingering(notes, {hand: 'r'});
    for (const id of ['m0', 'm1', 'm2']) expect(m.get(id)).not.toBe(m.get('held'));
  });
  test('a repeated note keeps its finger; a fast one changes it', () => {
    expect(fingers(line('G4 G4 G4 G4'), {hand: 'r'})).toMatch(/^(\d)\1\1\1$/);
    expect(fingers(line('G4 G4 G4 G4', .25), {hand: 'r'})).not.toMatch(/^(\d)\1\1\1$/);
  });
  test('printed fingers are kept and the rest fits around them', () => {
    const notes = line('C4 D4 E4 F4 G4');
    const m = suggestFingering(notes, {hand: 'r', fixed: new Map([['n0', 2]])});
    expect(notes.map(e => m.get(e.id)).join('')).toBe('23123'); // from 2, the thumb passes under at E
  });
  test('more than five notes in one hand at once are left unfingered', () => {
    const notes = [48, 52, 55, 60, 64, 67].map((n, i) => ({id: 'x' + i, n, t: 0, end: 1}));
    expect(suggestFingering(notes, {hand: 'r'}).size).toBe(0);
  });
});

describe('accuracy against the conventional fingerings (all 12 major keys, both hands)', () => {
  const measure = (gen, ref, octaves) => {
    let ok = 0, all = 0, exact = 0;
    for (let pc = 0; pc < 12; pc++) for (const hand of ['r', 'l']) {
      const notes = gen(pc, hand, octaves);
      const m = suggestFingering(notes, {hand});
      const r = ref(pc, hand === 'r' ? 'right' : 'left', octaves);
      const want = [...r.up, ...r.down];
      const hits = notes.filter((e, i) => m.get(e.id) === want[i]).length;
      ok += hits; all += want.length; exact += hits === want.length;
    }
    return {notes: ok / all, exact};
  };
  const scales = (pc, hand, o) => scale(pc, hand, o);
  const arps = (pc, hand, o) => scale(pc, hand, o, [0, 4, 7]);
  test('scales: one octave ≥ 95 % of notes, two octaves ≥ 80 %', () => {
    const one = measure(scales, (pc, h, o) => scaleFingering(pc, 'major', h, o), 1);
    const two = measure(scales, (pc, h, o) => scaleFingering(pc, 'major', h, o), 2);
    expect(one.notes).toBeGreaterThanOrEqual(.95);
    expect(one.exact).toBeGreaterThanOrEqual(18);
    expect(two.notes).toBeGreaterThanOrEqual(.8);
  });
  test('arpeggios: one octave ≥ 70 % of notes', () => {
    const one = measure(arps, (pc, h, o) => arpeggioFingering(pc, 'major', h, o), 1);
    expect(one.notes).toBeGreaterThanOrEqual(.7);
  });
});

describe('printedFingering()', () => {
  const mei = `<mei><music><body><mdiv><score><section>
    <measure xml:id="m1" n="1"><staff xml:id="s1" n="1"><layer><note xml:id="a" pname="c" oct="4"/><note xml:id="b" pname="d" oct="4"/></layer></staff>
      <staff xml:id="s2" n="2"><layer><note xml:id="c" pname="c" oct="3"/></layer></staff>
      <fing xml:id="f1" place="above" staff="1" startid="#a">1</fing><fing xml:id="f2" startid="#c"><rend>5</rend></fing><fing xml:id="f3" staff="1" startid="#b">2-3</fing></measure>
    <measure xml:id="m2" n="2"><staff n="1"><layer><note xml:id="d" pname="e" oct="4"/></layer></staff></measure>
  </section></score></mdiv></body></music></mei>`;
  test('fingers by note, and the bars and staves that print any', () => {
    const {fingers, bars} = printedFingering(mei);
    expect([...fingers]).toEqual([['a', 1], ['c', 5]]); // '2-3' (a substitution) is not a single finger
    expect([...bars].sort()).toEqual(['m1:1', 'm1:2']);
  });
  test('no fingering, no work', () => {
    expect(printedFingering('<mei/>').bars.size).toBe(0);
    expect(printedFingering(null).fingers.size).toBe(0);
  });
});

describe('suggestForSong()', () => {
  const song = {
    measures: [{id: 'm1', start: 0, end: 4}, {id: 'm2', start: 4, end: 8}],
    segments: [
      ...line('C4 D4 E4 F4 G4 F4 E4 D4').map(e => ({...e, staff: 1, hand: 'r', root: e.id})),
      {id: 'tie', n: 62, t: 7.5, end: 8, staff: 1, hand: 'r', root: 'n7'}, // a tied continuation
      ...line('C3 G3 C3 G3 C3 G3 C3 G3').map(e => ({...e, id: 'l' + e.id, staff: 2, hand: 'l', root: 'l' + e.id})),
    ],
  };
  test('every struck note gets a finger; tied continuations do not', () => {
    const m = suggestForSong(song);
    expect(m.size).toBe(16);
    expect(m.has('tie')).toBe(false);
    expect(['n0', 'n1', 'n2', 'n3', 'n4'].map(id => m.get(id)).join('')).toBe('12345');
  });
  test('a bar and staff with printed fingering gets no suggestion there', () => {
    const printed = {fingers: new Map([['n0', 1]]), bars: new Set(['m1:1'])};
    const m = suggestForSong(song, {printed});
    for (const id of ['n0', 'n1', 'n2', 'n3']) expect(m.has(id)).toBe(false);
    expect(m.has('n4')).toBe(true); // bar 2 of the right hand
    expect(m.has('ln0')).toBe(true); // the left hand in bar 1
  });
});

describe('real scores (Verovio)', () => {
  test('a generated exercise is fully fingered: nothing suggested', async () => {
    const s = await loadSong({data: resolveExercise('ex:scale:C:major:both:1:up-down').source.data});
    expect(s.printedFingering.fingers.size).toBeGreaterThan(20);
    expect(suggestForSong(s, {printed: s.printedFingering}).size).toBe(0);
  }, 30_000);
  test('Ode to Joy (no printed fingering): every note suggested, the tune in C position', async () => {
    const s = await loadSong({data: readFileSync('public/songs/ode-to-joy.musicxml', 'utf8')});
    expect(s.printedFingering.bars.size).toBe(0);
    const m = suggestForSong(s, {printed: s.printedFingering, beginner: true});
    const struck = s.segments.filter(e => e.id === e.root);
    expect(m.size).toBe(struck.length);
    const rh = struck.filter(e => e.hand === 'r').sort((a, b) => a.t - b.t);
    expect(rh.slice(0, 15).map(e => m.get(e.id)).join('')).toBe('334554321123322');
  }, 30_000);
});
