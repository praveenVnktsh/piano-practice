import {describe, expect, test} from 'vitest';

import {eventsToMusicXML, lilypondToEvents} from '../tools/ly2musicxml.mjs';
import {measures, notes} from './xml-helpers.js';

const Q = 480; // ticks per quarter note
const score = music => lilypondToEvents(String.raw`\score { ${music} }`);
// [kind, t, dur, "pitch names"] for every event, in time order
const events = music =>
  score(music)
    .events.slice()
    .sort((a, b) => a.t - b.t)
    .map(e => [
      e.kind,
      e.t / Q,
      e.dur / Q,
      (e.pitches ?? [])
        .map(p => `${p.step}${{'-2': 'bb', '-1': 'b', 1: '#', 2: '##'}[p.alter] ?? ''}${p.octave}`)
        .join(' '),
    ]);
const pitches = music =>
  events(music)
    .filter(e => e[0] === 'note')
    .map(e => e[3]);
const midis = music => score(music).events.flatMap(e => (e.pitches ?? []).map(p => p.midi));
const xmlOf = (music, opts) => eventsToMusicXML(score(music), opts);

describe('lilypondToEvents(): pitch', () => {
  test("absolute pitch: c is C3, c' is middle C, commas go down", () => {
    expect(pitches("{ c4 c' c'' c, cis' bes' eeses' fisis' }")).toEqual([
      'C3',
      'C4',
      'C5',
      'C2',
      'C#4',
      'Bb4',
      'Ebb4',
      'F##4',
    ]);
    expect(midis("{ c4 c' c, }")).toEqual([48, 60, 36]);
  });

  test('MusicXML octave and MIDI number agree', () => {
    for (const p of score("{ a,,4 c f' b'' }").events.flatMap(e => e.pitches))
      expect(p.midi).toBe((p.octave + 1) * 12 + {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[p.step] + p.alter);
  });

  test('\\relative picks the nearest octave', () => {
    expect(pitches("\\relative c' { c4 e g c b d, f }")).toEqual(['C4', 'E4', 'G4', 'C5', 'B4', 'D4', 'F4']);
  });

  test("\\relative: ' and , jump octaves from the nearest pitch", () => {
    expect(pitches("\\relative c' { c4 c' c, g'' f,, }")).toEqual(['C4', 'C5', 'C4', 'G5', 'F3']);
  });

  test('\\relative: the nearest-octave rule ignores accidentals (fourths go up)', () => {
    expect(pitches("\\relative c' { c4 fis f bes, }")).toEqual(['C4', 'F#4', 'F4', 'Bb3']);
  });

  test("\\relative chords: each note is relative to the previous chord note; the next note to the chord's first", () => {
    expect(events("\\relative c' { <c e g c>2 <g' b d>2 e4 }").map(e => e[3])).toEqual([
      'C4 E4 G4 C5',
      'G4 B4 D5',
      'E4',
    ]);
  });

  test("\\relative with no start pitch uses f (F3), so c' is middle C", () => {
    expect(pitches('\\relative { c4 }')).toEqual(['C3']);
    expect(pitches("\\relative { c'4 d e }")).toEqual(['C4', 'D4', 'E4']);
  });

  test('\\fixed adds the octave to every note', () => {
    expect(pitches("\\fixed c' { c4 g b, d' }")).toEqual(['C4', 'G4', 'B3', 'D5']);
  });
});

describe('lilypondToEvents(): rhythm', () => {
  test('durations carry over; dots and double dots', () => {
    expect(events("{ c'2 d' e'4. f'8 g'4.. a'16 b'1 }").map(e => e[2])).toEqual([2, 2, 1.5, 0.5, 1.75, 0.25, 4]);
  });

  test('*n/m scales a duration', () => {
    expect(events("{ c'4*2/3 c'2*3 c'8*1/2 }").map(e => e[2])).toEqual([2 / 3, 6, 0.25]);
  });

  test('\\times 2/3 and \\tuplet 3/2 make triplets', () => {
    expect(events("{ \\times 2/3 { c'8 d' e' } \\tuplet 3/2 { f'8 g' a' } b'4 }").map(e => [e[1], e[2]])).toEqual([
      [0, 1 / 3],
      [1 / 3, 1 / 3],
      [2 / 3, 1 / 3],
      [1, 1 / 3],
      [4 / 3, 1 / 3],
      [5 / 3, 1 / 3],
      [2, 1],
    ]);
  });

  test('\\tuplet with a span duration', () => {
    expect(events("{ \\tuplet 3/2 4 { c'8 d' e' f' g' a' } }").map(e => e[2])).toEqual(Array(6).fill(1 / 3));
  });

  test("rests, skips and whole-measure rests advance time; skips are kept as kind 'skip'", () => {
    expect(events("{ c'4 r s2 R1 R1*2 d'4 }")).toEqual([
      ['note', 0, 1, 'C4'],
      ['rest', 1, 1, ''],
      ['skip', 2, 2, ''],
      ['rest', 4, 4, ''],
      ['rest', 8, 8, ''],
      ['note', 16, 1, 'D4'],
    ]);
  });

  test('pitched rests (c\\rest) are rests', () => {
    expect(events("{ c'4\\rest d'4 }").map(e => e[0])).toEqual(['rest', 'note']);
  });

  test('ties mark the first note', () => {
    const evs = score("{ c'2~ c'2 <c' e'>2 ~ <c' e'>2 d'1 }").events;
    expect(evs.map(e => !!e.tie)).toEqual([true, false, true, false, false]);
  });

  test('\\partial sets the pickup length', () => {
    expect(score("{ \\time 3/4 \\partial 8 g'8 | c''2. }")).toMatchObject({pickup: Q / 2, time: [3, 4]});
  });

  test('grace notes are dropped without taking time', () => {
    expect(events("{ \\grace d'16 c'4 \\acciaccatura { e'16 } d'4 }")).toEqual([
      ['note', 0, 1, 'C4'],
      ['note', 1, 1, 'D4'],
    ]);
  });
});

describe('lilypondToEvents(): repeats', () => {
  test('\\repeat volta with \\alternative is unfolded', () => {
    expect(pitches("\\relative c'' { \\repeat volta 2 { c4 d } \\alternative { { e2 } { f2 } } g1 }")).toEqual([
      'C5',
      'D5',
      'E5',
      'C5',
      'D5',
      'F5',
      'G5',
    ]);
  });

  test('more repeats than alternatives: the first alternative is reused', () => {
    expect(pitches("{ \\repeat volta 3 { c'4 } \\alternative { { d'4 } { e'4 } } }")).toEqual([
      'C4',
      'D4',
      'C4',
      'D4',
      'C4',
      'E4',
    ]);
  });

  test('\\repeat unfold and \\repeat volta without alternatives', () => {
    expect(pitches("{ \\repeat unfold 3 { c'8 } \\repeat volta 2 { d'4 } }")).toEqual(['C4', 'C4', 'C4', 'D4', 'D4']);
  });

  test('timing continues correctly after an unfolded repeat', () => {
    expect(events("{ \\repeat volta 2 { c'2 } \\alternative { { d'2 } { e'2 } } f'1 }").map(e => e[1])).toEqual([
      0, 2, 4, 6, 8,
    ]);
  });
});

describe('lilypondToEvents(): staves, voices and ignored markup', () => {
  const piano = String.raw`
    \new PianoStaff <<
      \new Staff = "up" { \clef treble \key g \major \time 3/4 c''4 d'' \change Staff = "down" c4 }
      \new Staff = "down" { \clef bass c2. }
    >>`;

  test('staves are numbered in order of appearance and \\change Staff moves notes', () => {
    const s = score(piano);
    expect(s.staffNames).toEqual(['up', 'down']);
    expect(s.events.map(e => [e.pitches[0].step + e.pitches[0].octave, e.staff, e.t / Q])).toEqual([
      ['C5', 1, 0],
      ['D5', 1, 1],
      ['C3', 2, 2],
      ['C3', 2, 0],
    ]);
    expect(s).toMatchObject({key: 1, time: [3, 4], clefs: {1: 'G', 2: 'F'}});
  });

  test('minor keys and flat keys', () => {
    expect(score("{ \\key a \\minor c'1 }").key).toBe(0);
    expect(score("{ \\key c \\minor c'1 }").key).toBe(-3);
    expect(score("{ \\key bes \\major c'1 }").key).toBe(-2);
  });

  test('<< { } \\\\ { } >> voices run in parallel', () => {
    const s = score("{ << { e''2 f'' } \\\\ { c''1 } >> g'1 }");
    expect(s.events.map(e => [e.t / Q, e.dur / Q])).toEqual([
      [0, 2],
      [2, 2],
      [0, 4],
      [4, 4],
    ]);
    expect(new Set(s.events.slice(0, 3).map(e => e.voice)).size).toBe(2);
  });

  test('fingering, dynamics, articulations, slurs, markup, \\override, \\set and \\tweak are ignored', () => {
    const music = String.raw`{
      \override Staff.TimeSignature.stencil = ##f
      \set Staff.pedalSustainStyle = #'mixed
      \once \override Beam.positions = #'(1 . 1)
      c'4-3\p( d'4^"dolce"\< e'4_\markup { \italic legato }\! \tweak color #red f'4)->
      g'4\sustainOn a'4-.\fermata b'8[ c''8]\sustainOff \bar "|." }`;
    expect(pitches(music)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
    expect(events(music).map(e => e[1])).toEqual([0, 1, 2, 3, 4, 5, 6, 6.5]);
  });

  test('variables are expanded and Dynamics contexts are discarded', () => {
    const src = String.raw`
      melody = \relative c'' { c4 d e f }
      dyn = { s1\p }
      \score { << \new Staff \melody \new Dynamics \dyn >> }`;
    const s = lilypondToEvents(src);
    expect(s.events.filter(e => e.kind === 'note').map(e => e.pitches[0].midi)).toEqual([72, 74, 76, 77]);
    expect(s.events.some(e => e.kind === 'skip')).toBe(false);
  });

  test('reads title and composer from \\header', () => {
    const s = lilypondToEvents(String.raw`
      \header {
        title = "Für Elise"
        composer = "L. van Beethoven"
      }
      \score { { c'1 } }`);
    expect(s).toMatchObject({title: 'Für Elise', composer: 'L. van Beethoven'});
  });

  test('\\tempo sets quarter-note BPM', () => {
    expect(score('{ \\tempo "Allegro" 4 = 120 c\'1 }').tempo).toBe(120);
    expect(score("{ \\tempo 2 = 60 c'1 }").tempo).toBe(120);
  });
});

describe('eventsToMusicXML()', () => {
  const music = String.raw`\new Staff { \time 3/4 \partial 4 g'4 | \times 2/3 { c''8 d'' e'' } s4 r4 | c''2. ~ | c''4 fis'' f'' }`;

  test('pickup measure is numbered 0 and implicit', () => {
    expect(measures(xmlOf(music)).map(m => [m.number, m.implicit])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
    ]);
  });

  test('triplets get time-modification, tuplet brackets and beams', () => {
    const ns = notes(measures(xmlOf(music))[1].body).filter(n => n.tuplet);
    expect(ns.map(n => [n.pitch, n.type, n.duration, n.beams[0]])).toEqual([
      ['C5', 'eighth', 160, '1:begin'],
      ['D5', 'eighth', 160, '1:continue'],
      ['E5', 'eighth', 160, '1:end'],
    ]);
  });

  test('skips become <forward>, rests stay rests', () => {
    const body = measures(xmlOf(music))[1].body;
    expect(body).toMatch(/<forward><duration>480<\/duration>/);
    expect(notes(body).filter(n => n.rest)).toHaveLength(1);
  });

  test('ties across barlines and accidentals within a measure', () => {
    const ns = notes(xmlOf(music)).slice(-4);
    expect(ns.map(n => [n.pitch, n.tieStart, n.tieStop, n.accidental])).toEqual([
      ['C5', true, false, null],
      ['C5', false, true, null],
      ['F#5', false, false, 'sharp'],
      ['F5', false, false, 'natural'],
    ]);
  });

  test('a note crossing a barline is split and tied', () => {
    const ns = notes(xmlOf("{ \\time 2/4 c'4 d'2 e'4 }"));
    expect(ns.map(n => [n.pitch, n.duration / Q, n.tieStart, n.tieStop])).toEqual([
      ['C4', 1, false, false],
      ['D4', 1, true, false],
      ['D4', 1, false, true],
      ['E4', 1, false, false],
    ]);
  });

  test("durations that aren't one note value are split into tied notes", () => {
    const ns = notes(xmlOf("{ c'4*5 r4*3 }")); // 5 quarters in a 4/4 bar → spills into the next
    expect(ns.filter(n => n.pitch).map(n => [n.duration / Q, n.type, n.dots])).toEqual([
      [4, 'whole', 0],
      [1, 'quarter', 0],
    ]);
  });

  test('key signature notes have no accidental', () => {
    const ns = notes(xmlOf("{ \\key d \\major fis'4 cis'' f' c'' }"));
    expect(ns.map(n => n.accidental)).toEqual([null, null, 'natural', 'natural']);
  });

  test('eighths beam per beat; 6/8 beams in threes', () => {
    expect(notes(xmlOf("{ c'8 d' e' f' g'2 }")).map(n => n.beams[0] ?? null)).toEqual([
      '1:begin',
      '1:end',
      '1:begin',
      '1:end',
      null,
    ]);
    expect(notes(xmlOf("{ \\time 6/8 c'8 d' e' f' g' a' }")).map(n => n.beams[0])).toEqual([
      '1:begin',
      '1:continue',
      '1:end',
      '1:begin',
      '1:continue',
      '1:end',
    ]);
  });

  test('two staves become staff 1 and 2 with a backup between voices', () => {
    const xml = xmlOf(
      String.raw`\new PianoStaff << \new Staff = "up" { c''1 } \new Staff = "down" { \clef bass c1 } >>`,
    );
    expect(notes(xml).map(n => [n.pitch, n.staff, n.voice])).toEqual([
      ['C5', '1', '1'],
      ['C3', '2', '2'],
    ]);
    expect(xml).toContain('<backup><duration>1920</duration></backup>');
  });

  test('metadata options override the header and are escaped', () => {
    const xml = xmlOf("{ c'1 }", {
      title: 'A & B',
      composer: 'Anon',
      rights: 'CC BY-SA 2.5',
      source: 'https://example.org/?a=1&b=2',
    });
    expect(xml).toContain('<work-title>A &amp; B</work-title>');
    expect(xml).toContain('<rights>CC BY-SA 2.5</rights>');
    expect(xml).toContain('<source>https://example.org/?a=1&amp;b=2</source>');
  });
});
