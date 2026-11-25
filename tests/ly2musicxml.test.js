import {describe, expect, test} from 'vitest';

import {eventsToMusicXML, expandIncludes, lilypondToEvents, measureGrid} from '../tools/ly2musicxml.mjs';
import * as core from '../tools/ly2musicxml-core.mjs';
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

  test('a duration may be separated from its note by spaces ("g 2", BWV Anh. 127)', () => {
    expect(events("\\relative c'' { << { c4 bes2 as4 } \\\\ { as4 g 2 f 4 } >> r 2. s 4 }").map(e => [e[0], e[1], e[2]])).toEqual([
      ['note', 0, 1], ['note', 0, 1], ['note', 1, 2], ['note', 1, 2], ['note', 3, 1], ['note', 3, 1], ['rest', 4, 3], ['skip', 7, 1],
    ]);
    // Not after other words: \repeat volta 2 still repeats twice.
    expect(pitches("{ \\repeat volta 2 { c'4 } }")).toEqual(['C4', 'C4']);
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

  test('grace notes are kept, take no time and come before their main note', () => {
    const s = score("{ \\grace d'16 c'4 \\acciaccatura { e'16 } d'4 }");
    expect(events("{ \\grace d'16 c'4 \\acciaccatura { e'16 } d'4 }")).toEqual([
      ['note', 0, 0.25, 'D4'],
      ['note', 0, 1, 'C4'],
      ['note', 1, 0.25, 'E4'],
      ['note', 1, 1, 'D4'],
    ]);
    expect(s.events.map(e => e.grace ?? null)).toEqual([{slash: false}, null, {slash: true}, null]);
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

  test('cautionary accidentals where Verovio would read the note name’s last accidental in the bar', () => {
    // Verovio plays a note without <accidental> by the bar's last accidental on that letter (any
    // octave or staff), so the bass F under an F♯ and a sharp tied into the next bar get one.
    const xml = xmlOf(String.raw`<< \new Staff { \time 2/4 fis''4 c''4 | c''4 fis'4 ~ | fis'4 f' } \new Staff { \clef bass c4 f | c2 | c2 } >>`);
    const acc = n => n.match(/<accidental( cautionary="yes")?>([^<]*)</)?.slice(1, 3) ?? null;
    const byPitch = m => [...measures(xml)[m].body.matchAll(/<note>[\s\S]*?<\/note>/g)].map(([n]) => [notes(n)[0].pitch, acc(n)]);
    expect(byPitch(0)).toEqual([['F#5', [undefined, 'sharp']], ['C5', null], ['C3', null], ['F3', [' cautionary="yes"', 'natural']]]);
    expect(byPitch(2)).toEqual([['F#4', [' cautionary="yes"', 'sharp']], ['F4', [undefined, 'natural']], ['C3', null]]);
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

describe('converter coverage: grace notes, ornaments, tremolos', () => {
  test('grace notes become MusicXML <grace/> notes without a duration, before the main note', () => {
    const ns = notes(xmlOf("{ \\appoggiatura d''8 c''2 \\acciaccatura b'8 c''2 }"));
    expect(ns.map(n => [n.pitch, n.duration || 0, n.type])).toEqual([
      ['D5', 0, 'eighth'],
      ['C5', 960, 'half'],
      ['B4', 0, 'eighth'],
      ['C5', 960, 'half'],
    ]);
    const xml = xmlOf("{ \\appoggiatura d''8 c''2 \\acciaccatura b'8 c''2 }");
    expect(xml).toMatch(/<note><grace\/><pitch><step>D/);
    expect(xml).toMatch(/<note><grace slash="yes"\/><pitch><step>B/);
  });

  test('\\afterGrace: the grace notes follow the main note', () => {
    expect(events("{ \\afterGrace c''2 { b'16 c'' } d''2 }")).toEqual([
      ['note', 0, 2, 'C5'],
      ['note', 2, 0.25, 'B4'],
      ['note', 2, 0.25, 'C5'],
      ['note', 2, 2, 'D5'],
    ]);
  });

  test('trills, mordents and turns become ornaments; fermata and arpeggio notations', () => {
    const xml = xmlOf("{ c''4\\trill d''\\prall e''-\\mordent f''^\\turn <c' e' g'>\\arpeggio g'\\fermata r2 }");
    expect(xml).toContain('<ornaments><trill-mark/></ornaments>');
    expect(xml).toContain('<ornaments><inverted-mordent/></ornaments>');
    expect(xml).toContain('<ornaments><mordent/></ornaments>');
    expect(xml).toContain('<ornaments><turn/></ornaments>');
    expect(xml.match(/<arpeggiate\/>/g)).toHaveLength(3);
    expect(xml).toContain('<fermata type="upright"/>');
    expect(pitches("{ c''4\\trill d''\\prall e''-\\mordent f''^\\turn }")).toEqual(['C5', 'D5', 'E5', 'F5']);
  });

  test('a single-note tremolo is one note with tremolo strokes', () => {
    expect(events("{ c''2:16 d''4:32 r4 }").map(e => e.slice(0, 3))).toEqual([
      ['note', 0, 2],
      ['note', 2, 1],
      ['rest', 3, 1],
    ]);
    const xml = xmlOf("{ c''2:16 d''4:32 r4 }");
    expect(xml).toContain('<tremolo type="single">2</tremolo>');
    expect(xml).toContain('<tremolo type="single">3</tremolo>');
  });

  test('\\repeat tremolo is written out over its full length', () => {
    const e = events("{ \\repeat tremolo 4 { c'16 e' } d'2 }");
    expect(e.map(x => x[3])).toEqual(['C4', 'E4', 'C4', 'E4', 'C4', 'E4', 'C4', 'E4', 'D4']);
    expect(e.at(-1)[1]).toBe(2);
  });
});

describe('converter coverage: key, meter and pickup changes', () => {
  test('a mid-piece \\key change is written at its bar and changes the accidentals', () => {
    const xml = xmlOf("{ \\key g \\major fis'1 \\key f \\major fis'1 bes'1 }");
    const ms = measures(xml);
    expect(ms[1].body).toContain('<key><fifths>-1</fifths></key>');
    expect(notes(xml).map(n => n.accidental)).toEqual([null, 'sharp', null]);
    expect(score("{ \\key g \\major c'1 \\key f \\major c'1 }").keys.map(k => [k.t / Q, k.fifths])).toEqual([
      [0, 1],
      [4, -1],
    ]);
  });

  test('a mid-piece \\time change sets the following bar lengths', () => {
    const s = score("{ \\time 4/4 c'1 \\time 3/4 d'2. e'2. \\time 2/4 f'2 }");
    expect(measureGrid(s).map(b => [b.start / Q, b.len / Q])).toEqual([
      [0, 4],
      [4, 3],
      [7, 3],
      [10, 2],
    ]);
    const ms = measures(eventsToMusicXML(s));
    expect(ms[1].body).toContain('<time><beats>3</beats><beat-type>4</beat-type></time>');
    expect(ms[2].body).not.toContain('<time>');
    expect(ms[3].body).toContain('<time><beats>2</beats><beat-type>4</beat-type></time>');
  });

  test('a mid-piece \\partial starts a new section with a short bar', () => {
    // A 4/4 section ending on a 3-beat bar, then an upbeat into the next section.
    const s = score("{ \\partial 4 g'4 | c''1 | d''2. \\bar \"||\" \\partial 4 e''4 | f''1 }");
    expect(measureGrid(s).map(b => [b.start / Q, b.len / Q])).toEqual([
      [0, 1],
      [1, 4],
      [5, 4],
      [9, 4],
    ]);
    const cut = score("{ c''1 | d''2 \\partial 4 e''4 | f''1 }"); // \partial where the bar isn't full yet
    expect(measureGrid(cut).map(b => [b.start / Q, b.len / Q])).toEqual([
      [0, 4],
      [4, 2],
      [6, 1],
      [7, 4],
    ]);
  });

  test('a repeated section that opens with its pickup keeps the bar lines on the second time', () => {
    // BWV Anh. 120 style: the last bar of the section is full (a skip fills the upbeat's beat),
    // so the replayed pickup is its own short bar again.
    const full = score("{ \\time 3/4 \\repeat volta 2 { \\partial 4 e'4 | a'2. | gis'2 s4 } c''2. }");
    expect(measureGrid(full).map(b => [b.start / Q, b.len / Q])).toEqual([
      [0, 1], [1, 3], [4, 3], [7, 1], [8, 3], [11, 3], [14, 3],
    ]);
    // The usual engraving: the section's last bar is short and the replayed pickup completes it.
    const short = score("{ \\time 3/4 \\repeat volta 2 { \\partial 4 e'4 | a'2. | gis'2 } }");
    expect(measureGrid(short).map(b => [b.start / Q, b.len / Q])).toEqual([
      [0, 1], [1, 3], [4, 3], [7, 3], [10, 3],
    ]);
  });
});

describe('converter coverage: repeats', () => {
  test('repeat bar lines (\\bar ".|:" … ":|.") are unfolded', () => {
    expect(pitches("{ c'1 \\bar \".|:\" d'1 e'1 \\bar \":|.\" f'1 }")).toEqual(['C4', 'D4', 'E4', 'D4', 'E4', 'F4']);
    expect(pitches("{ c'1 d'1 \\bar \":|.\" e'1 }")).toEqual(['C4', 'D4', 'C4', 'D4', 'E4']);
  });

  test('\\set Score.repeatCommands with first and second endings', () => {
    const music = String.raw`{
      \set Score.repeatCommands = #'(start-repeat) c'1
      \set Score.repeatCommands = #'((volta "1")) d'1
      \set Score.repeatCommands = #'((volta #f) (volta "2") end-repeat) e'1
      \set Score.repeatCommands = #'((volta #f)) f'1 }`;
    expect(pitches(music)).toEqual(['C4', 'D4', 'C4', 'E4', 'F4']);
  });

  test('a voice may write a volta passage out once: the repeat applies to every staff', () => {
    const src = String.raw`<<
      \new Staff = "up" { \repeat volta 2 { c''1 } \alternative { { d''1 } { e''1 } } f''1 }
      \new Staff = "down" { c1 d1 e1 f1 } >>`;
    const s = score(src);
    const at = staff => s.events.filter(e => e.staff === staff).map(e => `${e.t / Q}:${e.pitches[0].step}`);
    expect(at(1)).toEqual(['0:C', '4:D', '8:C', '12:E', '16:F']);
    expect(at(2)).toEqual(['0:C', '4:D', '8:C', '12:E', '16:F']);
  });

  test('\\relative inside a repeat is lexical: every pass has the same octaves', () => {
    expect(pitches("\\relative c' { \\repeat unfold 3 { <fis, c' es>8 } g'4 }")).toEqual([
      'F#3 C4 Eb4',
      'F#3 C4 Eb4',
      'F#3 C4 Eb4',
      'G4', // relative to the chord's first note (F#3) as written once, not to the third pass
    ]);
    expect(pitches("\\relative c'' { \\repeat volta 2 { c4 g' } \\alternative { { e2 } { c2 } } d1 }")).toEqual([
      'C5',
      'G5',
      'E5',
      'C5',
      'G5',
      'C5',
      'D5',
    ]);
  });
});

describe('converter coverage: pitch entry and structure', () => {
  test('chord repetition q repeats the last chord', () => {
    expect(pitches("\\relative c' { <c e g>4 q q8 q d4 }")).toEqual(['C4 E4 G4', 'C4 E4 G4', 'C4 E4 G4', 'C4 E4 G4', 'D4']);
  });

  test('\\relative continues after a \\context / \\new block (Gymnopédie No. 1, BWV Anh. 115)', () => {
    // LilyPond's \relative is lexical: e, is an octave below the e that ends the inner voice.
    expect(pitches("\\relative c { e2. << \\context Voice = \"x\" { c'4\\rest b e } e,2. >> d2. }")).toEqual(['E3', 'E3', 'B3', 'E4', 'D3']); // in time order
    expect(pitches("\\relative c'' { \\new Voice { c4 g } e4 }")).toEqual(['C5', 'G4', 'E4']);
  });

  test('\\transpose moves pitches by the interval, spelled', () => {
    expect(pitches("{ \\transpose c d { c'4 fis' bes' } }")).toEqual(['D4', 'G#4', 'C5']);
    expect(pitches("\\transpose c f, \\relative c' { c4 e g }")).toEqual(['F3', 'A3', 'C4']);
  });

  test('note-name languages: \\language and \\include "english.ly"', () => {
    const names = src => lilypondToEvents(src).events.map(e => e.pitches.map(p => p.step + ({'-1': 'b', 1: '#', 2: '##'}[p.alter] ?? '') + p.octave).join(' '));
    expect(names("\\language \"english\"\n\\score { { cs'4 ef' fss' bf' } }")).toEqual(['C#4', 'Eb4', 'F##4', 'Bb4']);
    expect(names("\\include \"english.ly\"\n\\score { { af'4 gs' } }")).toEqual(['Ab4', 'G#4']);
    expect(names("\\language \"deutsch\"\n\\score { { h'4 b' fis' es' } }")).toEqual(['B4', 'Bb4', 'F#4', 'Eb4']);
    expect(names("\\language \"italiano\"\n\\score { { do'4 sib' fad' } }")).toEqual(['C4', 'Bb4', 'F#4']);
  });

  test('\\include is read through a reader (sync) or expandIncludes (async)', async () => {
    const files = {'dir/notes.ily': "tune = { c'4 d' }"};
    const src = "\\include \"notes.ily\"\n\\score { \\tune }";
    const read = path => files[path] ?? null;
    expect(lilypondToEvents(src, {read, path: 'dir/main.ly'}).events).toHaveLength(2);
    const text = await expandIncludes(src, async path => files[path] ?? null, {path: 'dir/main.ly'});
    expect(lilypondToEvents(text).events).toHaveLength(2);
    const warnings = [];
    expandIncludes("\\include \"missing.ily\"", () => null, {warnings});
    expect(warnings).toEqual(['could not include "missing.ily"']);
  });

  test('\\keepWithTag and \\tag choose between versions', () => {
    expect(pitches("{ \\keepWithTag #'one { c'4 \\tag #'one d'4 \\tag #'two e'4 f'4 } }")).toEqual(['C4', 'D4', 'F4']);
    expect(pitches("{ \\removeWithTag #'one { \\tag #'one d'4 \\tag #'two e'4 } }")).toEqual(['E4']);
  });

  test('an empty chord <> takes no time', () => {
    expect(events("{ c'4 <>\\f d'4 }").map(e => e[1])).toEqual([0, 1]);
  });

  test('a tie inside a chord ties only that note', () => {
    const xml = xmlOf("{ <c' e'~>2 <d' e'>2 }");
    expect(notes(xml).map(n => [n.pitch, n.tieStart, n.tieStop])).toEqual([
      ['C4', false, false],
      ['E4', true, false],
      ['D4', false, false],
      ['E4', false, true],
    ]);
  });

  test('definitions: one expression each, with or without spaces around =', () => {
    const src = String.raw`
      Treble = \clef treble
      upper= \relative c'' { \Treble c4 d }
      title = \markup \bold \piece
      \score { \new Staff = "up" \upper }`;
    expect(lilypondToEvents(src).events.map(e => e.pitches[0].midi)).toEqual([72, 74]);
  });

  test('a markup variable does not swallow the music after it', () => {
    const src = String.raw`
      num = "1."
      \score { \new PianoStaff << \set PianoStaff.instrumentName = \markup \huge \bold \num
        \new Staff = "up" { c''1 } \new Staff = "down" { c1 } >> }`;
    expect(lilypondToEvents(src).events.map(e => e.staff)).toEqual([1, 2]);
  });

  test('a markup function with only Scheme arguments ends the markup (Morning Prayer: \\finger \\markup \\tied-lyric #"1~5" b8)', () => {
    expect(pitches(String.raw`\relative c'' { c4\finger \markup \tied-lyric #"1~5" b8 a c4^\markup \char ##x2014 d }`)).toEqual(['C5', 'B4', 'A4', 'C5', 'D5']);
  });

  test('\\context Staff without a name is the current staff; the last clef at the start wins', () => {
    const src = String.raw`\new PianoStaff <<
      \new Staff = "up" << \context Staff { c''1 } >>
      \new Staff = "down" { \clef bass \clef treble c'1 } >>`;
    const s = lilypondToEvents(`\\score { ${src} }`);
    expect(s.staffNames).toEqual(['up', 'down']);
    expect(s.clefs).toEqual({2: 'G'});
    expect(s.clefChanges).toEqual([]);
  });

  test('bar checks and \\barNumberCheck are recorded for verification (unfold: false)', () => {
    const s = lilypondToEvents("\\score { { c'1 | d'1 | \\barNumberCheck #3 e'1 } }", {unfold: false});
    expect(s.checks.bars.map(c => c.t / Q)).toEqual([4, 8]);
    expect(s.checks.numbers).toMatchObject([{t: 8 * Q, n: 3}]);
  });

  test('the core module has no Node imports (it runs in the browser)', () => {
    expect(typeof core.lilypondToEvents).toBe('function');
    expect(typeof core.convertLilyPond("\\score { { c'1 } }").xml).toBe('string');
  });
});
