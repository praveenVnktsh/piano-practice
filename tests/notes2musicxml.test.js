import {describe, expect, test} from 'vitest';

import {parseNotes, toMusicXML} from '../tools/notes2musicxml.mjs';
import {measures, notes} from './xml-helpers.js';

const song = (header, body) => `${header}\n---\n${body}\n`;
const convert = (header, body) => toMusicXML(parseNotes(song(header, body), 't.notes'), 't.notes');
const voice = (xml, v) => notes(xml).filter(n => n.voice === v);

describe('parseNotes()', () => {
  test('reads header fields and concatenates lines of the same voice', () => {
    const parsed = parseNotes(
      song('title: Test  # a comment\nTime: 3/4\nkey: -1', 'RH: c4 d4 | e4\nLH: c3/2. # comment\nRH: | f4\nLH: | c3'),
    );
    expect(parsed.meta).toEqual({title: 'Test', time: '3/4', key: '-1'});
    expect(parsed.voices.RH.split(/\s+/).filter(Boolean)).toEqual(['c4', 'd4', '|', 'e4', '|', 'f4']);
    expect(parsed.voices.LH).toContain('c3/2.');
  });

  test('requires the --- separator', () => {
    expect(() => parseNotes('title: x\nRH: c4', 'x.notes')).toThrow(/missing '---'/);
  });

  test('requires RH and LH', () => {
    expect(() => parseNotes(song('', 'RH: c4/1'))).toThrow(/needs at least RH and LH/);
  });

  test('rejects unknown voice names', () => {
    expect(() => parseNotes(song('', 'RH: c4\nXX: c4'))).toThrow(/must start with RH/);
  });
});

describe('toMusicXML()', () => {
  test('writes durations, carried-over lengths, dots, staves and voices', () => {
    const xml = convert('time: 4/4', 'RH: c5/4. d5/8 e5/2 |\nLH: c3/1 |');
    expect(voice(xml, '1').map(n => [n.pitch, n.duration, n.type, n.dots, n.staff])).toEqual([
      ['C5', 12, 'quarter', 1, '1'],
      ['D5', 4, 'eighth', 0, '1'],
      ['E5', 16, 'half', 0, '1'],
    ]);
    expect(voice(xml, '5')).toMatchObject([{pitch: 'C3', type: 'whole', staff: '2'}]);
    expect(xml).toContain('<backup><duration>32</duration></backup>');
  });

  test('chords and rests', () => {
    const xml = convert('', 'RH: [c4 e4 g4]/2 r/2 |\nLH: r/1 |');
    expect(voice(xml, '1').map(n => [n.pitch, n.chord, n.rest])).toEqual([
      ['C4', false, false],
      ['E4', true, false],
      ['G4', true, false],
      [null, false, true],
    ]);
  });

  describe('measure-length validation', () => {
    test('a short measure is an error naming the voice and measure', () => {
      expect(() => convert('time: 3/4', 'RH: c4/4 d4 e4 | f4/2 |\nLH: c3/2. | c3/2. |')).toThrow(
        /RH measure 2 lasts 2 quarters, expected 3/,
      );
    });

    test('voices must have the same number of measures', () => {
      expect(() => convert('', 'RH: c4/1 | c4/1 |\nLH: c3/1 |')).toThrow(/LH has 1 measures but RH has 2/);
    });

    test('bad tokens and durations are reported', () => {
      expect(() => convert('', 'RH: c4/3 |\nLH: c3/1 |')).toThrow(/bad duration \/3/);
      expect(() => convert('', 'RH: h4/1 |\nLH: c3/1 |')).toThrow(/can't read "h4\/1"/);
    });
  });

  describe('pickup measure', () => {
    test('is numbered 0, implicit, and may be short', () => {
      const xml = convert('time: 3/4\npickup: yes', 'RH: d5/4 | g4/2. |\nLH: r/4 | g3/2. |');
      expect(measures(xml).map(m => [m.number, m.implicit])).toEqual([
        [0, true],
        [1, false],
      ]);
    });

    test('all voices of the pickup must still agree', () => {
      expect(() => convert('time: 3/4\npickup: yes', 'RH: d5/4 | g4/2. |\nLH: r/2 | g3/2. |')).toThrow(
        /voices have different lengths/,
      );
    });

    test('without a pickup the first measure must be full', () => {
      expect(() => convert('time: 3/4', 'RH: d5/4 | g4/2. |\nLH: r/4 | g3/2. |')).toThrow(/measure 1 lasts 1 quarters/);
    });
  });

  describe('accidentals vs key signature', () => {
    test('notes in the key get no accidental; others do, once per measure', () => {
      // G major (F#): f#4 is in the key, f4 needs a natural, then f4 again needs nothing.
      const xml = convert('key: 1', 'RH: f#4/4 f4 f4 f#4 | f4/1 |\nLH: c3/1 | c3/1 |');
      expect(voice(xml, '1').map(n => [n.pitch, n.accidental])).toEqual([
        ['F#4', null],
        ['F4', 'natural'],
        ['F4', null],
        ['F#4', 'sharp'],
        ['F4', 'natural'], // new measure: the key signature applies again
      ]);
    });

    test('flat keys and explicit naturals', () => {
      const xml = convert('key: -2', 'RH: bb4/4 b4 eb5 en5 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => [n.pitch, n.accidental])).toEqual([
        ['Bb4', null],
        ['B4', 'natural'],
        ['Eb5', null],
        ['E5', 'natural'],
      ]);
    });

    test('accidentals are per octave (sharps)', () => {
      const xml = convert('', 'RH: c#4/4 c#5 c5 c4 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => n.accidental)).toEqual(['sharp', 'sharp', 'natural', 'natural']);
    });

    test('accidentals are per octave', () => {
      const xml = convert('', 'RH: eb4/4 eb5 e5 e4 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => n.accidental)).toEqual(['flat', 'flat', 'natural', 'natural']);
    });

    test('an accidental carries through the measure and resets at the barline', () => {
      const xml = convert('key: 0', 'RH: bb4/4 bb4 b4 b4 | bb4/1 |\nLH: c3/1 | c3/1 |');
      expect(voice(xml, '1').map(n => n.accidental)).toEqual(['flat', null, 'natural', null, 'flat']);
    });
  });

  describe('ties', () => {
    test('tie across a barline starts and stops, and the tied-to note shows no accidental', () => {
      const xml = convert('', 'RH: c4/2 bb4/2~ | bb4/2 g4 |\nLH: c3/1 | c3/1 |');
      const rh = voice(xml, '1');
      expect(rh.map(n => [n.pitch, n.tieStart, n.tieStop, n.accidental])).toEqual([
        ['C4', false, false, null],
        ['Bb4', true, false, 'flat'],
        ['Bb4', false, true, null],
        ['G4', false, false, null],
      ]);
      expect(xml).toContain('<tied type="start"/>');
      expect(xml).toContain('<tied type="stop"/>');
    });

    test('tied chords stop only the matching pitches', () => {
      const xml = convert('', 'RH: [c4 e4]/2~ [c4 g4]/2 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => [n.pitch, n.tieStart, n.tieStop])).toEqual([
        ['C4', true, false],
        ['E4', true, false],
        ['C4', false, true],
        ['G4', false, false],
      ]);
    });
  });

  describe('beams', () => {
    test('eighths beam in pairs per quarter beat in 4/4', () => {
      const xml = convert('', 'RH: c4/8 d4 e4 f4 g4/4 r/4 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => n.beams)).toEqual([['1:begin'], ['1:end'], ['1:begin'], ['1:end'], [], []]);
    });

    test('sixteenths get a second beam', () => {
      const xml = convert('', 'RH: c4/16 d4 e4 f4 g4/4 a4/2 |\nLH: c3/1 |');
      expect(
        voice(xml, '1')
          .slice(0, 4)
          .map(n => n.beams),
      ).toEqual([
        ['1:begin', '2:begin'],
        ['1:continue', '2:continue'],
        ['1:continue', '2:continue'],
        ['1:end', '2:end'],
      ]);
    });

    test('eighth + two sixteenths: the sixteenths share a secondary beam', () => {
      const xml = convert('', 'RH: c4/8 d4/16 e4 f4/4 g4/2 |\nLH: c3/1 |');
      expect(
        voice(xml, '1')
          .slice(0, 3)
          .map(n => n.beams),
      ).toEqual([['1:begin'], ['1:continue', '2:begin'], ['1:end', '2:end']]);
    });

    test('6/8 beams eighths in groups of three', () => {
      const xml = convert('time: 6/8', 'RH: c4/8 d4 e4 f4 g4 a4 |\nLH: c3/4. c3 |');
      expect(voice(xml, '1').map(n => n.beams[0])).toEqual([
        '1:begin',
        '1:continue',
        '1:end',
        '1:begin',
        '1:continue',
        '1:end',
      ]);
    });

    test('rests break beams', () => {
      const xml = convert('', 'RH: c4/8 r/8 e4/8 f4/8 g4/2 |\nLH: c3/1 |');
      expect(voice(xml, '1').map(n => n.beams)).toEqual([[], [], ['1:begin'], ['1:end'], []]);
    });
  });

  test('header metadata and a final barline', () => {
    const xml = convert('title: A & B\ncomposer: Anon\ntempo: 90\nlicense: Public Domain', 'RH: c4/1 |\nLH: c3/1 |');
    expect(xml).toContain('<work-title>A &amp; B</work-title>');
    expect(xml).toContain('<creator type="composer">Anon</creator>');
    expect(xml).toContain('<rights>Public Domain</rights>');
    expect(xml).toContain('<sound tempo="90"/>');
    expect(xml).toContain('light-heavy');
  });

  test('a clef= in the first measure sets the starting clef; later ones change it', () => {
    const xml = convert('', 'RH: c5/1 | c5/1 |\nLH: clef=treble e4/1 | clef=bass c3/1 |');
    expect(xml).toContain('<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes>');
    expect(xml.match(/<clef number="2">/g)).toHaveLength(2);
    expect(xml).toContain('<attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>');
  });
});
