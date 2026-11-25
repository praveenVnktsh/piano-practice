// @vitest-environment jsdom
// The beginner (Grade 0) arrangements (songs/repertoire.json "arrangements", Phase 13): every one
// parses, renders through Verovio into the expected measures, stays inside its five-finger
// position(s), gives each hand its own staff, and has a matching catalog entry.
import {readFileSync, existsSync} from 'node:fs';
import {beforeAll, describe, expect, test} from 'vitest';

import {parseNotes, toMusicXML, arrangementEntry, syncArrangements} from '../tools/notes2musicxml.mjs';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';
import {notes as xmlNotes} from './xml-helpers.js';

const root = process.cwd() + '/';
const manifest = JSON.parse(readFileSync(root + 'songs/repertoire.json', 'utf8'));
const catalog = JSON.parse(readFileSync(root + 'public/songs/catalog.json', 'utf8'));
const ARR = manifest.arrangements;

// id → measures (a pickup counts as one), and the MIDI range each hand may use.
const C_RH = [60, 67], C_LH = [48, 55], MID_RH = [60, 67], MID_LH = [53, 60];
const EXPECT = {
  'hot-cross-buns': {measures: 4, r: C_RH, l: null},
  'mary-had-a-little-lamb': {measures: 8, r: C_RH, l: null},
  'au-clair-de-la-lune': {measures: 8, r: null, l: C_LH},
  'when-the-saints': {measures: 16, r: null, l: C_LH},
  'old-macdonald': {measures: 8, r: MID_RH, l: MID_LH},
  'london-bridge': {measures: 8, r: MID_RH, l: MID_LH},
  'yankee-doodle': {measures: 8, r: MID_RH, l: MID_LH},
  'lightly-row': {measures: 16, r: C_RH, l: C_LH},
  'jingle-bells': {measures: 16, r: C_RH, l: C_LH},
  'brahms-lullaby': {measures: 17, r: [67, 74], l: [60, 67]},
};
const PD = /^Public domain \((traditional|[A-Z][a-z]+, \d{4})\), arrangement MIT$/;

const scores = {};
beforeAll(async () => {
  const tk = await createToolkit();
  tk.setOptions({breaks: 'none'});
  for (const a of ARR) {
    const xml = readFileSync(root + `public/songs/${a.id}.musicxml`, 'utf8');
    expect(tk.loadData(xml), a.id).toBeTruthy();
    scores[a.id] = buildScore(tk);
  }
}, 60_000);

describe('beginner arrangements', () => {
  test('ten or more, all Grade 0, in learning order: right hand, left hand, taking turns, both', () => {
    expect(ARR.length).toBeGreaterThanOrEqual(10);
    expect(ARR.map(a => a.id).sort()).toEqual(Object.keys(EXPECT).sort());
    const order = {right: 0, left: 1, alternating: 2, both: 3};
    const stages = ARR.map(a => order[a.hands]);
    expect(stages.every(s => s != null)).toBe(true);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    for (const a of ARR) {
      expect(a.grade, a.id).toBe(0);
      expect(a.license, a.id).toMatch(PD);
    }
  });

  test('the sources parse and the bundled MusicXML is up to date (npm run songs)', () => {
    for (const a of ARR) {
      const src = readFileSync(root + `songs/${a.id}.notes`, 'utf8');
      const parsed = parseNotes(src, a.id);
      expect(parsed.meta.title, a.id).toBe(a.title);
      expect(parsed.meta.license, a.id).toBe(a.license);
      expect(+parsed.meta.tempo, a.id).toBe(a.tempo);
      expect(readFileSync(root + `public/songs/${a.id}.musicxml`, 'utf8'), a.id).toBe(toMusicXML(parsed, a.id));
    }
  });

  test('each renders to the expected number of measures', () => {
    for (const a of ARR) expect(scores[a.id].measures.length, a.id).toBe(EXPECT[a.id].measures);
  });

  test('every note sits in its hand’s five-finger position, on that hand’s staff', () => {
    for (const a of ARR) {
      const {r, l} = EXPECT[a.id];
      const evs = scores[a.id].events;
      expect(evs.length, a.id).toBeGreaterThan(8);
      const byHand = {r: evs.filter(e => e.hand === 'r'), l: evs.filter(e => e.hand === 'l')};
      for (const [hand, range] of [['r', r], ['l', l]]) {
        if (!range) { expect(byHand[hand], `${a.id} ${hand}`).toHaveLength(0); continue; }
        expect(byHand[hand].length, `${a.id} ${hand}`).toBeGreaterThan(0);
        for (const e of byHand[hand]) {
          expect(e.staff, a.id).toBe(hand === 'r' ? 1 : 2);
          expect(e.n, `${a.id} ${hand} ${e.n}`).toBeGreaterThanOrEqual(range[0]);
          expect(e.n, `${a.id} ${hand} ${e.n}`).toBeLessThanOrEqual(range[1]);
          expect([1, 3, 6, 8, 10], `${a.id}: white keys only`).not.toContain(e.n % 12);
        }
      }
    }
  });

  test('“hands take turns” pieces never sound both hands at once', () => {
    for (const a of ARR.filter(x => x.hands === 'alternating')) {
      const evs = scores[a.id].events;
      const rh = evs.filter(e => e.hand === 'r'), lh = evs.filter(e => e.hand === 'l');
      for (const x of rh) for (const y of lh) expect(x.start < y.end && y.start < x.end, `${a.id} at ${x.start}`).toBe(false);
    }
  });

  test('the written notes match the sources (the left hand holds whole notes in the both-hands pieces)', () => {
    for (const a of ARR.filter(x => x.hands === 'both' && x.id !== 'brahms-lullaby')) {
      const xml = readFileSync(root + `public/songs/${a.id}.musicxml`, 'utf8');
      const lh = xmlNotes(xml).filter(n => n.staff === '2');
      expect(lh.every(n => n.type === 'whole' && !n.rest), a.id).toBe(true);
    }
  });

  test('catalog entries match the manifest, with an open licence and an existing file', () => {
    for (const a of ARR) {
      const e = catalog.songs.find(s => s.id === a.id);
      expect(e, a.id).toEqual(arrangementEntry(a));
      expect(e).toMatchObject({difficulty: 'beginner', grade: 0, license: a.license});
      expect(e.source).toBeTruthy();
      expect(e.sourceUrl).toMatch(/^https:\/\//);
      expect(existsSync(root + 'public/' + e.file), e.file).toBe(true);
    }
    // Grade 0 comes first; the arrangements lead it, in learning order.
    expect(catalog.songs.slice(0, ARR.length).map(s => s.id)).toEqual(ARR.map(a => a.id));
  });

  test('syncArrangements replaces entries in place of their grade and keeps the rest', () => {
    const songs = [{id: 'old', grade: 0}, {id: 'g1', grade: 1}, {id: 'x', grade: 0, title: 'stale'}];
    const out = syncArrangements(songs, [{id: 'x', title: 'X', composer: 'T', grade: 0, tempo: 90, license: 'L'}]);
    expect(out.map(s => s.id)).toEqual(['x', 'old', 'g1']);
    expect(out[0].title).toBe('X');
  });
});
