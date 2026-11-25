// Sight-reading pieces: a fresh, short two-hand piece at a level, generated from a seed.
//
//   generateSightReading('grade-2', 4821) → {title, musicxml, level, key, mode, time, tempo, bars, rh, lh, harmony}
//
// How a piece is made:
//   1. key, metre and a harmony plan (one chord a bar, ending V – I) from the level;
//   2. a rhythm for every right-hand bar from the level's figures (the last bar ends on a long note);
//   3. a melody walked through the scale: mostly steps, skips and leaps by the level's weights,
//      chord tones on strong beats, leaps recovered by step, no augmented 2nds in minor, never
//      outside the level's range; it starts on a tonic-chord note and ends 2–1 or 7–1;
//   4. a left hand in the level's style (long roots, held fifths, root–fifth, broken chords, Alberti);
//   5. MusicXML 4.0 (two staves, accidentals relative to the key signature, beams by beat, a
//      starting finger for each hand).
import {parseKey, keyFifths, keySignatureAlters, scaleRun, chordFromNumeral, midi, atMidi, pitchClass, pitchName} from '../exercises/theory.js';
import {fillBar, barLength} from '../rhythm/patterns.js';
import {noteValue, beatLength} from '../theory/engrave.js';
import {rng, pickOne, weighted} from '../theory/music.js';
import {srLevelById} from './levels.js';

const PLANS = {
  4: [['I', 'IV', 'V', 'I'], ['I', 'V', 'V', 'I'], ['I', 'I', 'V', 'I'], ['I', 'ii', 'V', 'I'], ['I', 'vi', 'V', 'I']],
  8: [['I', 'IV', 'V', 'I', 'I', 'IV', 'V', 'I'], ['I', 'V', 'I', 'V', 'I', 'IV', 'V', 'I'], ['I', 'vi', 'IV', 'V', 'I', 'IV', 'V', 'I'],
    ['I', 'IV', 'I', 'V', 'vi', 'IV', 'V', 'I'], ['I', 'I', 'IV', 'V', 'I', 'vi', 'V', 'I']],
};
const MINOR = {I: 'i', IV: 'iv', V: 'V', vi: 'VI', ii: 'iv'};
// Last bars: the final note is held.
const FINAL = {'4/4': [['w', 3], ['h h', 2], ['q q h', 2]], '3/4': [['dh', 3], ['q h', 2]], '2/4': [['h', 1]], '6/8': [['dh', 3], ['dq dq', 1]]};
const DIV = 12;

/** A deterministic random stream per (level, seed). */
function streamFor(levelId, seed) {
  let h = 2166136261;
  for (const c of String(levelId)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return rng((h ^ Math.imul(Number(seed) | 0, 2654435761)) >>> 0);
}

export function generateSightReading(levelId, seed = 1) {
  const level = srLevelById(levelId);
  if (!level) throw Error('Unknown sight-reading level ' + levelId);
  const r = streamFor(level.id, seed);
  const [keyId, mode] = pickOne(r, level.keys);
  const tonic = parseKey(keyId);
  const time = pickOne(r, level.times);
  const compound = time[1] === 8;
  const fifths = keyFifths(tonic, mode === 'minor' ? 'harmonic-minor' : 'major');
  const plan = pickOne(r, PLANS[level.bars]).map(n => (mode === 'minor' ? MINOR[n] : n));
  const chords = plan.map(n => chordFromNumeral(tonic, mode, n));

  // ───── right-hand rhythm ─────
  const cells = {cells: compound ? level.cells.compound : level.cells.simple};
  const rhythm = [];
  for (let b = 0; b < level.bars; b++) {
    if (b === level.bars - 1) {
      const fin = FINAL[time.join('/')].filter(([t]) => level.id !== 'beginner' || t === 'w' || t === 'q q h');
      rhythm.push(fillBar({cells: [[weighted(r, fin.map(f => [f[0], f[1]])), 1]]}, time, r));
    } else rhythm.push(fillBar(cells, time, r, {first: b === 0}));
  }

  // ───── melody ─────
  const scaleMode = mode === 'minor' ? 'harmonic-minor' : 'major';
  const pool = scaleRun(tonic, scaleMode, 1, 50)
    .map((p, i) => ({p, m: midi(p), deg: i % 7}))
    .filter(x => x.m >= level.range[0] && x.m <= level.range[1]);
  const chordDegs = chords.map(c => c.tones.map(t => pool.find(x => sameClass(x.p, t))?.deg).filter(d => d != null));
  const slots = [];
  rhythm.forEach((bar, b) => { let pos = 0; for (const e of bar) { if (!e.rest) slots.push({b, e, pos}); pos += e.dur; } });
  const beat = beatLength(time);
  const centre = (pool.length - 1) / 2;
  const tonicIdx = pool.map((x, i) => (x.deg === 0 ? i : -1)).filter(i => i >= 0);
  let idx = weighted(r, pool.map((x, i) => [i, chordDegs[0].includes(x.deg) ? (x.deg === 0 ? 3 : 2) / (1 + Math.abs(i - centre)) : 0]));
  let prevStep = 0;
  // Five-finger levels stay in one position: never more than four steps apart.
  const span = level.range[1] - level.range[0] <= 7 ? 4 : 99;
  slots.forEach((slot, n) => {
    const left = slots.length - 1 - n;
    if (n === 0) { slot.idx = idx; return; }
    let options = [];
    const strong = Math.abs(slot.pos / beat - Math.round(slot.pos / beat)) < 1e-6;
    for (const [s, w0] of Object.entries(level.steps)) {
      for (const dir of +s === 0 ? [0] : [-1, 1]) {
        const j = idx + dir * +s;
        if (j < 0 || j >= pool.length) continue;
        let w = w0;
        const deg = pool[j].deg;
        if (strong) w *= chordDegs[slot.b].includes(deg) ? 3 : .35;
        if (Math.abs(prevStep) >= 3 && Math.sign(prevStep) === dir) w *= .15;       // recover from a leap
        if (+s === 0 && prevStep === 0) w *= .1;                                     // no long repeats
        if (mode === 'minor' && +s === 1 && [pool[idx].deg, deg].sort().join() === '5,6') w = 0; // augmented 2nd
        if (Math.abs(pool[j].m - pool[idx].m) === 6) w *= .1;                        // tritone leap
        if (mode === 'minor' && deg === 6 && !['V'].includes(plan[slot.b]) && left > 2) w *= .3; // raised 7th mostly over V
        w *= 1 / (1 + Math.max(0, Math.abs(j - centre) - pool.length / 3));        // stay near the middle
        options.push([j, w]);
      }
    }
    // Head for home in time: with `left` notes to go, stay within `left` steps of a tonic.
    const home = j => Math.min(...tonicIdx.map(t => Math.abs(t - j)));
    if (left >= 1 && left <= 4) {
      const near = options.filter(([j]) => home(j) <= left);
      options = near.length ? near : options.map(([j, w]) => [j, w / (1 + home(j))]);
    }
    // The end: 2–1 or 7–1 onto a tonic.
    if (left === 0) options = tonicIdx.filter(t => Math.abs(t - idx) <= 2).map(t => [t, 1]);
    else if (left === 1) {
      options = options.filter(([j]) => [1, 6].includes(pool[j].deg) && tonicIdx.some(t => Math.abs(t - j) === 1));
      if (!options.length) options = [1, 6].flatMap(d => pool.map((x, i) => [i, x.deg === d && Math.abs(i - idx) <= 3 && tonicIdx.some(t => Math.abs(t - i) === 1) ? 1 : 0]));
    }
    if (span < 99) options = options.filter(([j]) => {
      const all = [...slots.slice(0, n).map(s => s.idx), j];
      return Math.max(...all) - Math.min(...all) <= span;
    });
    options = options.filter(([, w]) => w > 0);
    if (!options.length) options = tonicIdx.map(t => [t, 1 / (1 + Math.abs(t - idx))]);
    const j = weighted(r, options);
    prevStep = j - idx;
    idx = j;
    slot.idx = j;
  });
  // A tidy ending: the last note is the tonic nearest the penultimate note.
  const lastSlot = slots.at(-1);
  if (pool[lastSlot.idx].deg !== 0) lastSlot.idx = tonicIdx.reduce((a, t) => (Math.abs(t - slots.at(-2).idx) < Math.abs(a - slots.at(-2).idx) ? t : a), tonicIdx[0]);
  for (const s of slots) s.e.pitches = [pool[s.idx].p];
  const rh = rhythm;

  // ───── left hand ─────
  const L = barLength(time);
  const low = level.id === 'beginner' ? 48 : 43;
  const lh = chords.map((c, b) => {
    let rm = low; while (((rm % 12) + 12) % 12 !== pitchClass(c.root)) rm++;
    const root = atMidi(c.root, rm);
    const above = (t, from) => { let m = from + 1; while (((m % 12) + 12) % 12 !== pitchClass(t)) m++; return atMidi(t, m); };
    const third = above(c.third, rm), fifth = above(c.fifth, rm);
    const N = (dur, ...ps) => ({dur, pitches: ps});
    if (b === level.bars - 1) return level.lh === 'roots' ? [N(L, root)] : [N(L, root, fifth)];
    switch (level.lh) {
      case 'roots': return [N(L, root)];
      case 'fifths': return [N(L, root, fifth)];
      case 'walk': return compound ? [N(1.5, root), N(1.5, fifth)] : L === 4 ? [N(2, root), N(2, fifth)] : L === 3 ? [N(2, root), N(1, fifth)] : [N(1, root), N(1, fifth)];
      case 'broken': return compound ? [N(1, root), N(.5, fifth), N(1, third), N(.5, fifth)]
        : [root, fifth, third, fifth].slice(0, L).map(p => N(1, p));
      case 'alberti': {
        const fig = compound ? [root, fifth, third, fifth, third, fifth] : Array.from({length: L * 2}, (_, i) => [root, fifth, third, fifth][i % 4]);
        return fig.map(p => N(.5, p));
      }
    }
    return [N(L, root)];
  });

  // Starting fingers: RH from its lowest note when the tune fits under five fingers; LH 5 on the root.
  const idxs = slots.map(s => s.idx), lo = Math.min(...idxs), hi = Math.max(...idxs);
  const rhFinger = hi - lo <= 4 ? slots[0].idx - lo + 1 : null;
  const keyName = `${pitchName(tonic)} ${mode}`;
  const title = `Study in ${keyName} · ${time.join('/')}`;
  const tempo = compound ? Math.round(level.tempo * 1.25) : level.tempo;
  const musicxml = toMusicXML({title, fifths, time, tempo, rh, lh, fingers: {rh: rhFinger, lh: 5}});
  return {title, musicxml, level: level.id, key: keyId, mode, fifths, time, tempo, bars: level.bars, rh, lh, harmony: plan, seed};
}

const sameClass = (a, b) => a.step === b.step && a.alter === b.alter;

// ───────── MusicXML ─────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ACC = {'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'};

/** Beam values per event of one bar: 'begin' | 'continue' | 'end' | null, grouped by beat. */
export function beamBar(events, time) {
  const beat = beatLength(time), out = events.map(() => null);
  let pos = 0, run = [], win = null;
  const flush = () => { if (run.length > 1) run.forEach((i, k) => (out[i] = k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue')); run = []; };
  events.forEach((e, i) => {
    const v = noteValue(e.dur);
    const can = !e.rest && v && (v.type === 'eighth' || v.type === '16th');
    const w = Math.floor((pos + 1e-6) / beat);
    if (!can || w !== win) flush();
    if (can) { run.push(i); win = w; }
    pos += e.dur;
  });
  flush();
  return out;
}

function staffXml(events, {staff, voice, keyAlt, time, finger, placement}) {
  const shown = {};
  const bm = beamBar(events, time);
  let xml = '';
  events.forEach((e, i) => {
    const v = noteValue(e.dur);
    if (!v) throw Error(`Unsupported duration ${e.dur}`);
    const dur = Math.round(e.dur * DIV);
    const type = `<type>${v.type}</type>${'<dot/>'.repeat(v.dots)}`;
    if (e.rest) { xml += `   <note><rest/><duration>${dur}</duration><voice>${voice}</voice>${type}<staff>${staff}</staff></note>\n`; return; }
    // 16ths beside 16ths get a second beam; a lone one a hook.
    const sixteenth = v.type === '16th';
    let beam2 = null;
    if (sixteenth && bm[i]) {
      const prev = i > 0 && bm[i - 1] && bm[i] !== 'begin' && noteValue(events[i - 1].dur)?.type === '16th';
      const next = i + 1 < events.length && bm[i + 1] && bm[i] !== 'end' && noteValue(events[i + 1].dur)?.type === '16th';
      beam2 = prev && next ? 'continue' : prev ? 'end' : next ? 'begin' : (bm[i] === 'end' ? 'backward hook' : 'forward hook');
    }
    e.pitches.forEach((p, pi) => {
      let x = '   <note>' + (pi ? '<chord/>' : '');
      x += `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
      x += `<duration>${dur}</duration>`;
      if (e.tie) x += '<tie type="start"/>';
      if (e.tieIn) x += '<tie type="stop"/>';
      x += `<voice>${voice}</voice>${type}`;
      const k = p.step + p.octave;
      if ((shown[k] ?? keyAlt[p.step] ?? 0) !== p.alter) x += `<accidental>${ACC[p.alter]}</accidental>`;
      shown[k] = p.alter;
      x += `<staff>${staff}</staff>`;
      if (pi === 0 && bm[i]) x += `<beam number="1">${bm[i]}</beam>${beam2 ? `<beam number="2">${beam2}</beam>` : ''}`;
      const fing = pi === 0 && i === 0 && finger ? `<technical><fingering placement="${placement}">${finger}</fingering></technical>` : '';
      if (fing) x += `<notations>${fing}</notations>`;
      xml += x + '</note>\n';
    });
  });
  return xml;
}

function toMusicXML({title, fifths, time, tempo, rh, lh, fingers}) {
  const keyAlt = keySignatureAlters(fifths);
  const L = Math.round(barLength(time) * DIV);
  let body = '';
  rh.forEach((bar, mi) => {
    let xml = `  <measure number="${mi + 1}">\n`;
    if (mi === 0) {
      xml += `   <attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key>` +
        `<time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time><staves>2</staves>` +
        '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>\n';
      xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${tempo}"/></direction>\n`;
    }
    xml += staffXml(bar, {staff: 1, voice: 1, keyAlt, time, finger: mi === 0 ? fingers.rh : null, placement: 'above'});
    xml += `   <backup><duration>${L}</duration></backup>\n`;
    xml += staffXml(lh[mi], {staff: 2, voice: 5, keyAlt, time, finger: mi === 0 ? fingers.lh : null, placement: 'below'});
    if (mi === rh.length - 1) xml += '   <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
    body += xml + '  </measure>\n';
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${esc(title)}</work-title></work>
 <identification><creator type="composer">Sight-reading</creator><rights>CC0-1.0</rights><encoding><software>piano-practice sight-reading</software></encoding></identification>
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
${body} </part>
</score-partwise>
`;
}
