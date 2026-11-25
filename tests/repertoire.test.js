// @vitest-environment jsdom
// Every bundled piece (public/songs/catalog.json) loads the way the app loads it (Verovio with
// repeats unfolded, then buildScore()) and is checked automatically:
//   • the number of measures is the one verified against the source (repeats written out),
//   • Verovio plays exactly the notes the MusicXML file writes, at their written times and pitches
//     (it reads a note's pitch from the accidentals shown in the bar, not from <alter>, and can
//     misplace a voice, so a converter slip shows up here),
//   • both hands play, within the piano's range, the right hand above the left,
//   • a measure without notes is a written rest, not lost music,
//   • tempo, grade, difficulty and default section make sense.
// The Mutopia pieces' notes were also compared with the MIDI file LilyPond made from the same
// source (songs/README.md, "Verify"); the measure counts below are those of that check.
import {readFileSync} from 'node:fs';
import {beforeAll, describe, expect, test} from 'vitest';

import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';

const root = process.cwd() + '/';
const catalog = JSON.parse(readFileSync(root + 'public/songs/catalog.json', 'utf8')).songs;
const manifest = JSON.parse(readFileSync(root + 'songs/repertoire.json', 'utf8'));
const OPTIONS = {breaks: 'none', expandAlways: true}; // as src/song.js

// id → measures as played (pickup bars count; repeats written out).
const MEASURES = {
  // Grade 0
  'hot-cross-buns': 4, 'mary-had-a-little-lamb': 8, 'au-clair-de-la-lune': 8, 'when-the-saints': 16, 'old-macdonald': 8,
  'london-bridge': 8, 'yankee-doodle': 8, 'lightly-row': 16, 'jingle-bells': 16, 'brahms-lullaby': 17, 'twinkle-twinkle': 12,
  'ode-to-joy': 16,
  // Grade 1
  'minuet-in-g': 32, 'bach-minuet-anh116': 80, 'bach-minuet-anh113': 64, 'schumann-melodie': 24, 'mozart-minuet-k2': 32,
  'bach-minuet-anh120': 60, 'bach-air-anh131': 32, 'schumann-humming-song': 24,
  // Grade 2
  'bach-minuet-anh115': 64, 'bach-musette-anh126': 40, 'burgmuller-candeur': 38, 'schumann-soldiers-march': 48,
  'schumann-poor-orphan': 33, 'schumann-wild-rider': 33, 'tchaikovsky-morning-prayer': 24, 'tchaikovsky-old-french-song': 33,
  'bach-minuet-anh121': 48, 'bach-minuet-anh118': 48, 'bach-polonaise-anh119': 32, 'bach-polonaise-anh128': 36,
  'schumann-little-piece': 25, 'schumann-chorale': 32, 'handel-menuet-d-minor': 32, 'handel-menuet-d': 41, 'pleyel-minuet-c': 64,
  'streabbog-valse': 96,
  // Grade 3
  'burgmuller-pastorale': 37, 'burgmuller-arabesque': 55, 'schumann-happy-farmer': 21, 'schumann-first-loss': 49,
  'tchaikovsky-wooden-soldiers': 48, 'bach-little-prelude-bwv939': 16, 'clementi-sonatina-op36-1': 76,
  'bach-polonaise-anh117b': 32, 'bach-march-anh127': 60, 'schumann-hunting-song': 57, 'schumann-folk-song': 24,
  'schumann-little-study': 96, 'schumann-reapers-song': 44, 'burgmuller-petite-reunion': 54, 'burgmuller-innocence': 32,
  'burgmuller-progres': 24, 'burgmuller-courant-limpide': 24, 'burgmuller-gracieuse': 24, 'burgmuller-tendre-fleur': 48,
  'burgmuller-consolation': 42, 'kuhlau-sonatina-op20-1-2': 25, 'handel-gavotte-g': 41, 'wanhal-rondo-op42-1': 56,
  'andre-sonatina-op34-1': 114, 'muller-siciliano': 30, 'czerny-op840-1': 65, 'czerny-op840-2': 65,
  // Grade 4
  'bach-prelude-in-c': 35, 'fur-elise': 126, 'czerny-op821-1': 8, 'burgmuller-ballade': 112, 'kuhlau-sonatina-op20-1': 111,
  'chopin-prelude-op28-7': 17, 'grieg-albumblatt-op12-7': 65, 'satie-gymnopedie-1': 78, 'czerny-op821-2': 8,
  'burgmuller-chasse': 65, 'burgmuller-bergeronnette': 45, 'beethoven-minuet-woo82': 123, 'beethoven-sonata-op49-2-2': 121,
  // Grade 5
  'moonlight-sonata-1': 69, 'chopin-prelude-op28-4': 26, 'chopin-prelude-op28-20': 13, 'bach-invention-1': 22,
  'bach-invention-8': 34, 'beethoven-sonata-op49-2-1': 174, 'mozart-sonata-k545-1': 146,
};
// Beginner arrangements for one hand (tests/beginner-songs.test.js checks their positions).
const ONE_HAND = new Set(manifest.arrangements.filter(a => a.hands === 'right' || a.hands === 'left').map(a => a.id));

const STEP = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const tag = (s, t) => s.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];

/** The notes a MusicXML file writes: [{measure, at (quarters into the bar), dur, n, afterGrace, arpeggio}], grace notes left out. */
function writtenNotes(xml) {
  const out = [];
  let divisions = 1;
  [...xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].forEach(([, body], measure) => {
    let t = 0, last = 0, lastAfterGrace = false;
    const graceBefore = new Map(); // voice → a grace note came just before
    for (const [el] of body.matchAll(/<(note|backup|forward)\b[^>]*>[\s\S]*?<\/\1>|<attributes>[\s\S]*?<\/attributes>/g)) {
      if (el.startsWith('<attributes')) { divisions = +(tag(el, 'divisions') ?? divisions); continue; }
      const dur = +(tag(el, 'duration') ?? 0) / divisions;
      if (el.startsWith('<backup')) { t -= dur; continue; }
      if (el.startsWith('<forward')) { t += dur; continue; }
      const voice = tag(el, 'voice');
      if (el.includes('<grace')) { graceBefore.set(voice, true); continue; }
      const chord = el.includes('<chord/>');
      const at = chord ? last : t;
      if (!chord) { last = t; t += dur; }
      if (el.includes('<pitch>')) {
        const n = 12 * (+tag(el, 'octave') + 1) + STEP[tag(el, 'step')] + +(tag(el, 'alter') ?? 0);
        out.push({measure, at, dur, n, afterGrace: chord ? lastAfterGrace : !!graceBefore.get(voice), arpeggio: el.includes('<arpeggiate')});
      }
      if (!chord) { lastAfterGrace = !!graceBefore.get(voice); graceBefore.set(voice, false); }
    }
  });
  return out;
}

const scores = {};
beforeAll(async () => {
  const tk = await createToolkit();
  for (const s of catalog) {
    const xml = readFileSync(root + 'public/' + s.file, 'utf8');
    tk.setOptions(OPTIONS);
    expect(tk.loadData(xml), s.id).toBeTruthy();
    const score = buildScore(tk);
    const graceIds = new Set([...score.mei.matchAll(/<note\b([^>]*)>/g)].filter(([, a]) => /\sgrace="/.test(a)).map(([, a]) => a.match(/xml:id="([^"]+)"/)?.[1]));
    scores[s.id] = {score, xml, graceIds, written: writtenNotes(xml), xmlMeasures: (xml.match(/<measure\b/g) || []).length};
  }
}, 240_000);

describe('every bundled piece', () => {
  test('has its verified measure count (repeats written out, the file without repeats)', () => {
    expect(Object.keys(MEASURES).sort()).toEqual(catalog.map(s => s.id).sort());
    for (const s of catalog) {
      const {score, xmlMeasures} = scores[s.id];
      expect(score.measures.length, s.id).toBe(MEASURES[s.id]);
      if (s.source?.startsWith('Mutopia')) expect(xmlMeasures, s.id).toBe(MEASURES[s.id]);
    }
  });

  test('sounds exactly as written: every note at its written time and pitch, nothing extra', () => {
    for (const s of catalog) {
      const {score, graceIds, written} = scores[s.id];
      const played = score.segments.filter(g => !graceIds.has(g.id)).map(g => ({...g, at: g.t - score.measures[g.measure]?.start, used: false}));
      const unmatched = [];
      for (const w of written) {
        // Verovio plays a note after a grace note late (the grace note takes up to half its value)
        // and rolls an arpeggiated chord.
        const hit = played.find(p => !p.used && p.measure === w.measure && p.n === w.n &&
          (Math.abs(p.at - w.at) < .01 || (w.afterGrace && p.at > w.at && p.at <= w.at + w.dur / 2 + .01) ||
            (w.arpeggio && p.at > w.at && p.at <= w.at + .25)));
        if (hit) hit.used = true; else unmatched.push(`bar ${w.measure + 1} +${w.at} n${w.n}`);
      }
      expect(unmatched, `${s.id}: written but not played so`).toEqual([]);
      expect(played.filter(p => !p.used).map(p => `bar ${p.measure + 1} +${p.at} n${p.n}`), `${s.id}: played but not written`).toEqual([]);
    }
  });

  test('both hands play (except one-hand beginner pieces), on a piano, the right hand above the left', () => {
    const median = xs => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
    for (const s of catalog) {
      const evs = scores[s.id].score.events;
      expect(evs.length, s.id).toBeGreaterThan(8);
      for (const e of evs) expect(e.n >= 21 && e.n <= 108, `${s.id}: ${e.n}`).toBe(true);
      if (ONE_HAND.has(s.id)) continue;
      const r = evs.filter(e => e.hand === 'r').map(e => e.n), l = evs.filter(e => e.hand === 'l').map(e => e.n);
      expect(r.length && l.length, `${s.id}: both hands`).toBeTruthy();
      expect(median(r), `${s.id}: right hand above left`).toBeGreaterThan(median(l));
    }
  });

  test('a measure without notes is a written rest', () => {
    for (const s of catalog) {
      const {score, written} = scores[s.id];
      const silent = score.measures.map((m, i) => i).filter(i => !score.segments.some(g => g.measure === i));
      for (const i of silent) expect(written.some(w => w.measure === i), `${s.id}: bar ${i + 1}`).toBe(false);
      expect(silent.length, `${s.id}: silent bars`).toBeLessThanOrEqual(Math.max(2, score.measures.length / 10));
    }
  });

  test('tempo, grade, difficulty and default section are sensible', () => {
    const DIFFICULTY = g => (g === 0 ? 'beginner' : g <= 2 ? 'easy' : g <= 4 ? 'intermediate' : 'advanced');
    for (const s of catalog) {
      expect(s.tempo >= 40 && s.tempo <= 200, `${s.id}: tempo ${s.tempo}`).toBe(true);
      expect(s.difficulty, s.id).toBe(DIFFICULTY(s.grade));
      if (s.section) {
        const [a, b] = s.section;
        expect(a >= 0 && a <= b && b < MEASURES[s.id], `${s.id}: section ${s.section}`).toBe(true);
      }
    }
  });
});
