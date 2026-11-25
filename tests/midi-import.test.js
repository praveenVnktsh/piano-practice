// @vitest-environment jsdom
// MIDI import round trips: hand-built MIDI bytes → midiToMusicXml → Verovio → buildScore, the
// same path an imported score takes in the player (loadSong {data}).
import {beforeAll, describe, expect, test} from 'vitest';

import {midiToMusicXml, spellingFor} from '../src/midi-file/to-musicxml.mjs';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';
import {keySig, noteTrack, smf, tempo, timeSig, trackName} from './midi-bytes.js';
import {notes as xmlNotes} from './xml-helpers.js';

const Q = 480; // ticks per quarter in these files
let tk;
beforeAll(async () => { tk = await createToolkit(); }, 30_000);

function engrave(xml) {
  tk.setOptions({breaks: 'none'});
  expect(tk.loadData(xml)).toBeTruthy();
  return buildScore(tk);
}
const ev = score => score.events.map(e => [e.n, +e.t.toFixed(3), +e.d.toFixed(3), e.hand]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const bars = score => score.measures.map(m => [m.start, m.end, `${m.meter.count}/${m.meter.unit}`]);

describe('midiToMusicXml() round trips', () => {
  test('a C major scale (format 0, no meta events) becomes two bars of quarter notes', () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72].map((n, i) => [i * Q, n, Q - 30]); // slightly detached
    const r = midiToMusicXml(smf({format: 0, tracks: [noteTrack(scale)]}), {fileName: 'c-major_scale.mid'});
    expect(r.title).toBe('c major scale');
    expect(r.quality).toBe(1);
    expect(r.fallingPreferred).toBe(false);
    expect(r.stats).toMatchObject({notes: 8, measures: 2, grid: 'sixteenths', hands: 'pitch', key: {fifths: 0, mode: 'major', from: 'estimate'}, time: '4/4', tempo: 120});
    const score = engrave(r.xml);
    expect(bars(score)).toEqual([[0, 4, '4/4'], [4, 8, '4/4']]);
    expect(ev(score)).toEqual([60, 62, 64, 65, 67, 69, 71, 72].map((n, i) => [n, i, 1, 'r']));
    expect(score.tempo).toBe(120);
    // Bar 1 left hand: a whole-bar rest.
    expect(r.xml).toMatch(/<rest measure="yes"\/><duration>48<\/duration><voice>5<\/voice><staff>2<\/staff>/);
  });

  test('a two-hand piece (two tracks, 3/4, G major) keeps hands, ties over the barline, chords and rests', () => {
    const rh = [[0, 67, Q], [Q, 71, Q], [2 * Q, 74, Q], // G B D
      [3 * Q, 72, Q / 2], [3.5 * Q, 71, Q / 2], [4 * Q, 69, Q], // C B A (eighths, quarter)
      [6 * Q, 67, 2 * Q], [6 * Q, 71, 2 * Q]]; // G+B chord, half note; then a quarter rest
    const lh = [[0, 43, 4 * Q], // G2 held 4 beats: tied into bar 2
      [4 * Q, 54, Q], [5 * Q, 50, Q], [6 * Q, 43, 3 * Q]]; // F#3 (in the key: no accidental) D3, G2
    const bytes = smf({tracks: [
      [0, ...trackName('Little Waltz'), 0, ...tempo(96), 0, ...timeSig(3, 4), 0, ...keySig(1)],
      noteTrack(rh, {head: [trackName('Piano RH')]}),
      noteTrack(lh, {channel: 1, head: [trackName('Piano LH')]}),
    ]});
    const r = midiToMusicXml(bytes);
    expect(r.title).toBe('Little Waltz');
    expect(r.stats).toMatchObject({hands: 'tracks', key: {fifths: 1, mode: 'major', from: 'file'}, time: '3/4', tempo: 96, measures: 3});
    expect(r.quality).toBe(1);
    const score = engrave(r.xml);
    expect(bars(score)).toEqual([[0, 3, '3/4'], [3, 6, '3/4'], [6, 9, '3/4']]);
    expect(score.measures[0].key).toMatchObject({fifths: 1});
    expect(ev(score)).toEqual([
      [43, 0, 4, 'l'], [67, 0, 1, 'r'], [71, 1, 1, 'r'], [74, 2, 1, 'r'],
      [72, 3, 0.5, 'r'], [71, 3.5, 0.5, 'r'], [54, 4, 1, 'l'], [69, 4, 1, 'r'],
      [50, 5, 1, 'l'], [43, 6, 3, 'l'], [67, 6, 2, 'r'], [71, 6, 2, 'r'],
    ]);
    const n = xmlNotes(r.xml);
    expect(n.filter(x => x.pitch === 'G2' && x.tieStart).length).toBe(1); // the tie over the barline
    expect(n.find(x => x.pitch === 'F#3').accidental).toBeNull(); // F# is in the key signature
    expect(n.filter(x => x.chord).map(x => x.pitch)).toEqual(['B4']);
    expect(n.some(x => x.rest && x.staff === '1' && x.type === 'quarter')).toBe(true);
  });

  test('one track with both hands is split by pitch around middle C, a line crossing C4 staying in its hand', () => {
    // RH melody E4 D4 C4 B3 C4 (dips below middle C), LH G2 / C3 under it.
    const notes = [[0, 64, Q], [Q, 62, Q], [2 * Q, 60, Q], [3 * Q, 59, Q], [4 * Q, 60, 4 * Q],
      [0, 43, 2 * Q], [2 * Q, 48, 2 * Q], [4 * Q, 36, 4 * Q]];
    const r = midiToMusicXml(smf({format: 0, tracks: [noteTrack(notes)]}));
    expect(r.stats.hands).toBe('pitch');
    const hands = Object.fromEntries(ev(engrave(r.xml)).map(([n, t, , h]) => [`${n}@${t}`, h]));
    expect(hands).toEqual({'64@0': 'r', '62@1': 'r', '60@2': 'r', '59@3': 'r', '60@4': 'r', '43@0': 'l', '48@2': 'l', '36@4': 'l'});
  });

  test('a held note under moving notes goes to a second voice', () => {
    const notes = [[0, 72, 4 * Q], [0, 64, Q], [Q, 65, Q], [2 * Q, 67, 2 * Q], [0, 48, 4 * Q]];
    const r = midiToMusicXml(smf({tracks: [noteTrack(notes.slice(0, 4)), noteTrack(notes.slice(4), {channel: 1})]}));
    const score = engrave(r.xml);
    expect(ev(score)).toEqual([[48, 0, 4, 'l'], [64, 0, 1, 'r'], [72, 0, 4, 'r'], [65, 1, 1, 'r'], [67, 2, 2, 'r']]);
    expect(new Set(xmlNotes(r.xml).filter(x => x.staff === '1').map(x => x.voice))).toEqual(new Set(['1', '2']));
  });

  test('eighth-note triplets are found beat by beat and written as tuplets', () => {
    const t3 = Q / 3;
    const notes = [[0, 60, t3], [t3, 62, t3], [2 * t3, 64, t3], [Q, 65, Q / 2], [1.5 * Q, 67, Q / 2], [2 * Q, 72, 2 * Q]];
    const r = midiToMusicXml(smf({format: 0, tracks: [noteTrack(notes)]}));
    expect(r.stats.grid).toBe('sixteenths+triplets');
    expect(r.quality).toBe(1);
    const n = xmlNotes(r.xml).filter(x => !x.rest && x.staff === '1');
    expect(n.map(x => [x.pitch, x.type, x.tuplet])).toEqual([
      ['C4', 'eighth', true], ['D4', 'eighth', true], ['E4', 'eighth', true],
      ['F4', 'eighth', false], ['G4', 'eighth', false], ['C5', 'half', false],
    ]);
    expect(ev(engrave(r.xml)).map(([n, t, d]) => [n, t, d])).toEqual([[60, 0, 0.333], [62, 0.333, 0.333], [64, 0.667, 0.333], [65, 1, 0.5], [67, 1.5, 0.5], [72, 2, 2]]);
  });

  test('a loose, performed file scores low and prefers falling notes, but still engraves', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const notes = [];
    for (let i = 0, t = 13; i < 40; i++) { notes.push([Math.round(t), 60 + (i * 5) % 17, 200 + Math.round(rand() * 200)]); t += 180 + rand() * 260; }
    const r = midiToMusicXml(smf({format: 0, tracks: [noteTrack(notes)]}));
    expect(r.quality).toBeLessThan(0.75);
    expect(r.fallingPreferred).toBe(true);
    expect(r.warnings[0]).toMatch(/falling notes/);
    const score = engrave(r.xml);
    expect(score.events.length).toBeGreaterThan(30);
  });

  test('keys: estimated from the notes when the file has none, a default C major overruled when the notes disagree', () => {
    const dMajor = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62].map((n, i) => [i * Q, n, Q]);
    const none = midiToMusicXml(smf({format: 0, tracks: [noteTrack(dMajor)]}));
    expect(none.stats.key).toEqual({fifths: 2, mode: 'major', from: 'estimate'});
    const cDefault = midiToMusicXml(smf({format: 0, tracks: [noteTrack(dMajor, {head: [keySig(0)]})]}));
    expect(cDefault.stats.key.fifths).toBe(2);
    const eFlat = midiToMusicXml(smf({format: 0, tracks: [noteTrack(dMajor, {head: [keySig(-3)]})]}));
    expect(eFlat.stats.key).toEqual({fifths: -3, mode: 'major', from: 'file'}); // a real key signature is kept
    // Accidentals outside the key are written, and cancelled with a natural.
    const chromatic = midiToMusicXml(smf({format: 0, tracks: [noteTrack([[0, 66, Q], [Q, 65, Q], [2 * Q, 66, Q], [3 * Q, 67, Q]], {head: [keySig(0)]})]}));
    expect(xmlNotes(chromatic.xml).filter(x => !x.rest && x.staff === '1').map(x => [x.pitch, x.accidental])).toEqual([['F#4', 'sharp'], ['F4', 'natural'], ['F#4', 'sharp'], ['G4', null]]);
  });

  test('drops drums and leading empty bars; sustain pedal becomes Ped. marks', () => {
    const lead = 4 * Q; // one empty bar first
    const bytes = smf({tracks: [
      noteTrack([[lead, 60, 2 * Q], [lead + 2 * Q, 64, 2 * Q]], {pedal: [[lead, 127], [lead + 2 * Q - 10, 0], [lead + 2 * Q, 127], [lead + 4 * Q, 0]]}),
      noteTrack([[0, 36, Q], [Q, 38, Q]], {channel: 9}),
    ]});
    const r = midiToMusicXml(bytes);
    const score = engrave(r.xml);
    expect(bars(score)).toEqual([[0, 4, '4/4']]);
    expect(ev(score)).toEqual([[60, 0, 2, 'r'], [64, 2, 2, 'r']]);
    expect(score.marks.pedals.map(p => [Math.round(p.t * 2) / 2, p.dir])).toEqual([[0, 'down'], [2, 'bounce'], [4, 'up']]);
    expect(() => midiToMusicXml(smf({tracks: [noteTrack([[0, 36, Q]], {channel: 9})]}))).toThrow(/no notes/);
  });
});

describe('spellingFor()', () => {
  test('spells in the key, with raised 6th and 7th in minor', () => {
    const name = (f, mode, pc) => { const s = spellingFor(f, mode)(pc); return s.step + ({1: '#', '-1': 'b', 0: ''})[s.alter]; };
    expect([0, 1, 3, 6, 8, 10].map(pc => name(0, 'major', pc))).toEqual(['C', 'C#', 'Eb', 'F#', 'G#', 'Bb']);
    expect(name(-1, 'minor', 1)).toBe('C#'); // D minor: leading note
    expect(name(-3, 'minor', 11)).toBe('B'); // C minor: B natural
    expect(name(6, 'major', 5)).toBe('E#');
    expect(name(-2, 'major', 6)).toBe('Gb');
  });
});

describe('importing a .mid file (src/app/imports.js)', () => {
  test('becomes a MusicXML import record marked as from MIDI; loose timing asks for falling notes', async () => {
    const {recordFromFile, ACCEPTED} = await import('../src/app/imports.js');
    expect(ACCEPTED.test('song.mid') && ACCEPTED.test('SONG.MIDI')).toBe(true);
    const clean = smf({format: 0, tracks: [noteTrack([60, 64, 67, 72].map((n, i) => [i * Q, n, Q]))]});
    const rec = await recordFromFile(new File([clean], 'Arpeggio.mid'));
    expect(rec).toMatchObject({title: 'Arpeggio', midi: true, quality: 1});
    expect(rec.id).toMatch(/^import:/);
    expect(rec.data).toMatch(/<score-partwise/);
    expect(rec).not.toHaveProperty('view');
    expect(rec.warning).toBeUndefined();

    const loose = smf({format: 0, tracks: [noteTrack([[17, 60, 300], [431, 64, 200], [1013, 67, 333], [1290, 72, 410], [1771, 71, 150], [2049, 67, 380]])]});
    const rough = await recordFromFile(new File([loose], 'take.midi'));
    expect(rough.view).toBe('falling');
    expect(rough.warning).toMatch(/falling notes/);

    await expect(recordFromFile(new File([new TextEncoder().encode('hello')], 'bad.mid'))).rejects.toThrow(/couldn’t be read: This is not a MIDI file/);
  });
});
