import {describe, expect, test} from 'vitest';

import {parseMidi} from '../src/midi-file/parse.mjs';
import {keySig, noteTrack, smf, tempo, timeSig, trackName} from './midi-bytes.js';

const header = (format, ntracks, division) => [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, ntracks, division >> 8, division & 255];
const chunk = body => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body];

describe('parseMidi()', () => {
  test('reads a format 0 file byte by byte: running status, velocity-0 note-offs, meta events', () => {
    const track = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000 µs = 120 bpm
      0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
      0x00, 0xff, 0x59, 0x02, 0xfe, 0x01, // 2 flats, minor (G minor)
      0x00, 0x90, 0x3c, 0x40, // C4 on
      0x60, 0x3c, 0x00, // (running status) 96 ticks later: C4 velocity 0 = off
      0x00, 0x3e, 0x50, // D4 on
      0x81, 0x40, 0x80, 0x3e, 0x00, // 192 ticks later: explicit note-off
      0x00, 0xb0, 0x40, 0x7f, // sustain down
      0x10, 0x40, 0x00, // (running status) sustain up
      0x00, 0xff, 0x2f, 0x00,
    ];
    const midi = parseMidi(new Uint8Array([...header(0, 1, 96), ...chunk(track)]));
    expect(midi.format).toBe(0);
    expect(midi.division).toBe(96);
    expect(midi.notes.map(n => [n.n, n.tick, n.end, n.vel])).toEqual([[60, 0, 96, 64], [62, 96, 288, 80]]);
    expect(midi.tempos).toEqual([{tick: 0, usPerQuarter: 500000, bpm: 120}]);
    expect(midi.timeSigs).toEqual([{tick: 0, num: 3, den: 4}]);
    expect(midi.keySigs).toEqual([{tick: 0, fifths: -2, minor: true}]);
    expect(midi.pedal.map(p => [p.tick, p.value])).toEqual([[288, 127], [304, 0]]);
    expect(midi.endTick).toBe(304);
  });

  test('reads format 1 tracks with names, and keeps their notes apart', () => {
    const bytes = smf({
      format: 1, division: 480, tracks: [
        [0, ...trackName('Minuet'), 0, ...tempo(90), 0, ...timeSig(4, 4), 0, ...keySig(1)],
        noteTrack([[0, 72, 480], [480, 74, 480]], {head: [trackName('Right')]}),
        noteTrack([[0, 48, 960]], {channel: 1, head: [trackName('Left')]}),
      ],
    });
    const midi = parseMidi(bytes);
    expect(midi.format).toBe(1);
    expect(midi.title).toBe('Minuet');
    expect(midi.tracks.map(t => [t.name, t.noteCount])).toEqual([['Minuet', 0], ['Right', 2], ['Left', 1]]);
    expect(midi.notes.map(n => [n.track, n.channel, n.n, n.tick, n.end])).toEqual([
      [2, 1, 48, 0, 960], [1, 0, 72, 0, 480], [1, 0, 74, 480, 960],
    ]);
    expect(Math.round(midi.tempos[0].bpm)).toBe(90);
    expect(midi.keySigs[0]).toEqual({tick: 0, fifths: 1, minor: false});
  });

  test('pairs overlapping notes of the same pitch first on, first off; closes hanging notes at the track end', () => {
    const track = [
      0x00, 0x90, 60, 70,
      0x10, 60, 71, // a second C4 while the first sounds
      0x10, 0x80, 60, 0, // first off
      0x10, 60, 0, // second off (running status 0x80)
      0x00, 0x90, 64, 90, // never released
      0x20, 0xff, 0x2f, 0x00,
    ];
    const midi = parseMidi(new Uint8Array([...header(0, 1, 96), ...chunk(track)]));
    expect(midi.notes.map(n => [n.n, n.tick, n.end, n.vel])).toEqual([[60, 0, 32, 70], [60, 16, 48, 71], [64, 48, 80, 90]]);
  });

  test('skips SysEx, program changes, pitch bend and unknown chunks', () => {
    const track = [
      0x00, 0xf0, 0x03, 0x7e, 0x09, 0xf7, // SysEx
      0x00, 0xc0, 0x05, // program change (one data byte)
      0x00, 0xe0, 0x00, 0x40, // pitch bend
      0x00, 0x90, 67, 60,
      0x30, 67, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const junk = [0x58, 0x58, 0x58, 0x58, 0, 0, 0, 2, 1, 2];
    const midi = parseMidi(new Uint8Array([...header(0, 1, 96), ...junk, ...chunk(track)]));
    expect(midi.notes.map(n => [n.n, n.tick, n.end])).toEqual([[67, 0, 48]]);
    expect(midi.programs.map(p => p.program)).toEqual([5]);
  });

  test('turns SMPTE division into ticks per quarter at 120 bpm', () => {
    // 25 fps × 40 ticks per frame = 1000 ticks/s → 500 per quarter at 120 bpm
    const bytes = new Uint8Array([...header(0, 1, 0), ...chunk([0, 0x90, 60, 64, 0x83, 0x74, 60, 0, 0, 0xff, 0x2f, 0])]);
    bytes[12] = 0xe7; bytes[13] = 40; // -25
    expect(parseMidi(bytes).division).toBe(500);
  });

  test('explains files that are not MIDI', () => {
    expect(() => parseMidi(new TextEncoder().encode('<score-partwise/>'))).toThrow(/not a MIDI file/);
    expect(() => parseMidi(new Uint8Array([...header(0, 1, 96), ...chunk([0x00, 0x90, 60])]))).toThrow(/cut short/);
    expect(() => parseMidi(new Uint8Array([...header(0, 1, 96), ...chunk([0x00, 60, 64, 0, 0xff, 0x2f, 0])]))).toThrow(/data byte/);
  });
});
