import {describe, expect, it} from 'vitest';
import {midiFile, midiFileName, takeToMidi} from '../src/record/midi-file.mjs';

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ');

describe('takeToMidi', () => {
  it('writes a byte-exact type-0 file for a tiny take', () => {
    // ♩ = 120 (500 ms per quarter), 480 ticks per quarter: 1 ms = 0.96 ticks.
    const take = {tempo: 120, name: '', title: '', notes: [[0, 60, 100, 500], [500, 64, 80, 250]], pedal: [[0, 127], [1000, 0]]};
    const bytes = takeToMidi(take, {name: ''});
    const expected = [
      // MThd, length 6, format 0, 1 track, division 480
      '4d 54 68 64', '00 00 00 06', '00 00', '00 01', '01 e0',
      // MTrk + track length
      '4d 54 72 6b', '00 00 00 26', // 38 bytes follow
      '00 ff 51 03 07 a1 20', //   tempo 500000 µs per quarter
      '00 b0 40 7f', //            t=0    pedal down
      '00 90 3c 64', //            t=0    C4 on, velocity 100
      '83 60 80 3c 40', //         t=480  C4 off (delta 480 = 0x83 0x60)
      '00 90 40 50', //            t=480  E4 on, velocity 80
      '81 70 80 40 40', //         t=720  E4 off (delta 240)
      '81 70 b0 40 00', //         t=960  pedal up
      '00 ff 2f 00', //            end of track
    ].join(' ');
    expect(hex(bytes)).toBe(expected);
    // The track length field matches the bytes that follow it.
    const len = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
    expect(len).toBe(bytes.length - 22);
  });

  it('adds a track name and orders note-offs before note-ons on the same tick', () => {
    const bytes = midiFile({name: 'Hi', division: 96, tempoUs: 1000000, events: [
      {tick: 96, order: 2, bytes: [0x90, 62, 90]},
      {tick: 96, order: 0, bytes: [0x80, 60, 64]},
      {tick: 0, order: 2, bytes: [0x90, 60, 90]},
    ]});
    expect(hex(bytes.slice(22))).toBe('00 ff 03 02 48 69 00 ff 51 03 0f 42 40 00 90 3c 5a 60 80 3c 40 00 90 3e 5a 00 ff 2f 00');
    expect(hex(bytes.slice(12, 14))).toBe('00 60');
  });

  it('encodes long gaps as variable-length quantities', () => {
    const bytes = midiFile({events: [{tick: 0x200000, order: 0, bytes: [0x80, 60, 64]}]});
    // 0x200000 → 81 80 80 00
    expect(hex(bytes)).toContain('81 80 80 00 80 3c 40');
  });

  it('names the file after the piece and date', () => {
    expect(midiFileName({title: 'Für Elise', name: 'Take 2', at: Date.UTC(2026, 10, 24)})).toBe('fur-elise-take-2-2026-11-24.mid');
  });
});
