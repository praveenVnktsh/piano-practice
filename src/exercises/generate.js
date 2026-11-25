// Generates fingered two-staff MusicXML 4.0 exercises: scales, arpeggios, five-finger patterns,
// chord progressions and chromatic scales.
//
//   generateExercise({type: 'scale', key: 'Fs', mode: 'harmonic-minor', hands: 'both', octaves: 2})
//     → {title, musicxml}
//
// Layout: RH on the treble staff, LH on the bass staff an octave lower; a hand that doesn't play
// gets whole-bar rests. 4/4 throughout; every note carries a <fingering> (above for RH, below
// for LH), accidentals are printed relative to the key signature, eighths are beamed in half
// bars, and a staff switches clef when a run climbs or falls far out of it.

import {
  parseKey, pitchName, pitchClass, midi, atMidi, keyFifths, keySignatureAlters, spellInterval,
  scaleRun, chordFromNumeral,
} from './theory.js';
import {scaleFingering, arpeggioFingering, fiveFingerFingering, chromaticFinger, triadFingering} from './fingering.js';

const DIV = 4; // divisions per quarter: an eighth is 2
const MEASURE = 16;
const TYPES = {2: ['eighth', 0], 4: ['quarter', 0], 6: ['quarter', 1], 8: ['half', 0], 12: ['half', 1], 16: ['whole', 0]};
const HANDS = {right: 'right hand', left: 'left hand', both: 'hands together'};
const MODE_NAMES = {major: 'major', 'natural-minor': 'natural minor', 'harmonic-minor': 'harmonic minor', 'melodic-minor': 'melodic minor', minor: 'minor'};

export const PROGRESSIONS = {
  major: ['I-IV-V-I', 'I-vi-IV-V', 'ii-V-I', 'I-V-vi-IV', 'I-IV-I-V-I'],
  minor: ['i-iv-V-i', 'i-VI-iv-V', 'ii°-V-i', 'i-VI-III-VII'],
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ───── note sequences ─────
// A note: {pitches: [{step, alter, octave}], fingers: [n], dur}.
const note = (pitches, fingers, dur) => ({pitches: [].concat(pitches), fingers: [].concat(fingers), dur});

/** Up-and-down run of `up` (bottom → top) and `down` (back to the bottom) in eighths, ending on a long note. */
function runUpDown(up, down, fUp, fDown) {
  const pitches = [...up, ...down], fingers = [...fUp, ...fDown];
  const seq = pitches.slice(0, -1).map((p, i) => note(p, fingers[i], 2));
  const used = seq.length * 2;
  seq.push(note(pitches.at(-1), fingers.at(-1), MEASURE - (used % MEASURE)));
  return seq;
}

function octavesFor(octaves, tonic) {
  // [RH, LH] octave of the starting tonic: one octave apart, lower for long scales, and an octave
  // lower for A and B so short left-hand runs stay on the bass staff.
  if (octaves >= 3) return [3, 2];
  return ['A', 'B'].includes(tonic.step) ? [3, 2] : [4, 3];
}

function scaleNotes({tonic, mode, octaves}, hand, octave) {
  const n = octaves * 7;
  const upForm = mode, downForm = mode === 'melodic-minor' ? 'natural-minor' : mode;
  const up = scaleRun(tonic, upForm, octave, n + 1);
  const down = scaleRun(tonic, downForm, octave, n).reverse();
  const f = scaleFingering(pitchClass(tonic), mode, hand, octaves);
  return runUpDown(up, down, f.up, f.down);
}

function arpeggioNotes({tonic, quality, octaves}, hand, octave) {
  const third = spellInterval(tonic, 2, quality === 'minor' ? 3 : 4), fifth = spellInterval(tonic, 4, 7);
  const tones = [tonic, third, fifth];
  const n = octaves * 3;
  const up = [{...tonic, octave}];
  for (let i = 1; i <= n; i++) {
    let p = {...tones[i % 3], octave: octave - 1};
    while (midi(p) <= midi(up.at(-1))) p = {...p, octave: p.octave + 1};
    up.push(p);
  }
  const f = arpeggioFingering(pitchClass(tonic), quality, hand, octaves);
  return runUpDown(up, up.slice(0, -1).reverse(), f.up, f.down);
}

function fiveFingerNotes({tonic, quality}, hand, octave) {
  const run = scaleRun(tonic, quality === 'minor' ? 'natural-minor' : 'major', octave, 5);
  const f = fiveFingerFingering(hand);
  const order = [0, 1, 2, 3, 4, 3, 2, 1];
  return [...order.map(i => note(run[i], f[i], 4)), note(run[0], f[0], MEASURE)];
}

const SHARP_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function chromaticNotes({tonic, octaves}, hand, octave) {
  const start = midi({...tonic, octave}), n = octaves * 12;
  const spell = (m, names) => ((m - start) % 12 === 0 ? atMidi(tonic, m) : atMidi(parseKey(names[m % 12]), m));
  const up = Array.from({length: n + 1}, (_, i) => spell(start + i, SHARP_NAMES));
  const down = Array.from({length: n}, (_, i) => spell(start + n - 1 - i, FLAT_NAMES));
  const finger = p => chromaticFinger(pitchClass(p), hand);
  const edge = finger(tonic) === 2 && hand !== 'left' ? 1 : finger(tonic); // RH starting on C or F: thumb
  const fUp = up.map((p, i) => (i === 0 ? edge : finger(p)));
  const fDown = down.map((p, i) => (i === n - 1 ? edge : finger(p)));
  return runUpDown(up, down, fUp, fDown);
}

/** Close-position RH voicings with smooth voice leading, LH roots, one whole-note chord per bar. */
function progressionNotes({tonic, mode, progression}) {
  const chords = progression.split('-').map(n => chordFromNumeral(tonic, mode, n));
  const rh = [], lh = [];
  let prev = null;
  for (const chord of chords) {
    const options = [];
    for (let inv = 0; inv < 3; inv++) {
      const tones = [...chord.tones.slice(inv), ...chord.tones.slice(0, inv)];
      for (let base = 52; base <= 72; base++) {
        if (pitchClass(tones[0]) !== ((base % 12) + 12) % 12) continue;
        const ps = [atMidi(tones[0], base)];
        for (const t of tones.slice(1)) {
          let m = midi(ps.at(-1)) + 1;
          while ((m % 12) !== pitchClass(t)) m++;
          ps.push(atMidi(t, m));
        }
        const ms = ps.map(midi);
        if (ms[0] < 55 || ms[2] > 79) continue;
        const cost = prev ? ms.reduce((a, m, i) => a + Math.abs(m - prev[i]), 0) + Math.abs(ms[2] - 69) * 0.01
          : (inv ? 100 : 0) + Math.abs(ms[0] - 62);
        options.push({ps, ms, inv, cost});
      }
    }
    options.sort((a, b) => a.cost - b.cost);
    const best = options[0];
    prev = best.ms;
    rh.push(note(best.ps, triadFingering(best.inv), MEASURE));
    let bass = 41;
    while ((bass % 12) !== pitchClass(chord.root)) bass++;
    lh.push(note(atMidi(chord.root, bass), 5, MEASURE));
  }
  return {rh, lh, chords};
}

// ───── parameters and titles ─────

/** Normalises exercise parameters; throws on anything invalid. */
export function normalizeParams(params) {
  const type = params.type;
  const key = params.key ?? params.tonic;
  const tonic = typeof key === 'string' ? parseKey(key) : key;
  if (!tonic) throw Error('Unknown key: ' + params.key);
  const hands = params.hands ?? 'both';
  if (!HANDS[hands]) throw Error('Hands must be both, right or left');
  const octaves = +(params.octaves ?? 1);
  const p = {type, tonic, hands, octaves};
  if (type === 'scale') {
    p.mode = params.mode === 'minor' ? 'harmonic-minor' : params.mode ?? 'major';
    if (!['major', 'natural-minor', 'harmonic-minor', 'melodic-minor'].includes(p.mode)) throw Error('Unknown scale: ' + params.mode);
    p.direction = params.direction ?? 'up-down';
    if (p.direction !== 'up-down') throw Error('Only up-down scales are supported');
    if (![1, 2, 3, 4].includes(octaves)) throw Error('Octaves must be 1–4');
  } else if (type === 'arpeggio' || type === 'five-finger') {
    p.quality = params.quality ?? params.mode ?? 'major';
    if (!['major', 'minor'].includes(p.quality)) throw Error('Arpeggios and five-finger patterns are major or minor');
    p.mode = p.quality;
    if (type === 'arpeggio' && ![1, 2, 3, 4].includes(octaves)) throw Error('Octaves must be 1–4');
  } else if (type === 'progression') {
    p.mode = params.mode === 'minor' ? 'minor' : params.mode ?? 'major';
    if (!['major', 'minor'].includes(p.mode)) throw Error('Progressions are in a major or minor key');
    p.progression = params.progression ?? (p.mode === 'major' ? 'I-IV-V-I' : 'i-iv-V-i');
    p.progression.split('-').forEach(n => chordFromNumeral(p.tonic, p.mode, n)); // validates
    p.hands = 'both';
  } else if (type === 'chromatic') {
    p.mode = 'major';
    if (![1, 2].includes(octaves)) throw Error('Chromatic scales are 1 or 2 octaves');
  } else throw Error('Unknown exercise type: ' + type);
  if (type !== 'chromatic') keyFifths(p.tonic, p.mode); // throws for keys beyond 7 accidentals
  return p;
}

export function exerciseTitle(params) {
  const p = params.tonic ? params : normalizeParams(params);
  const key = pitchName(p.tonic);
  const hands = HANDS[p.hands];
  switch (p.type) {
    case 'scale': return `${key} ${MODE_NAMES[p.mode]} scale · ${hands} · ${plural(p.octaves, 'octave')}`;
    case 'arpeggio': return `${key} ${p.quality} arpeggio · ${hands} · ${plural(p.octaves, 'octave')}`;
    case 'five-finger': return `${key} ${p.quality} five-finger pattern · ${hands}`;
    case 'progression': return `${key} ${p.mode} chords · ${p.progression.replace(/-/g, '–')}`;
    case 'chromatic': return `Chromatic scale from ${key} · ${hands} · ${plural(p.octaves, 'octave')}`;
  }
  return 'Exercise';
}

// ───── MusicXML writing ─────

function splitMeasures(seq, hand) {
  const out = [];
  let cur = [], pos = 0;
  for (const n of seq) {
    if (!TYPES[n.dur]) throw Error(`${hand}: unsupported note length ${n.dur / DIV} quarters`);
    if (pos + n.dur > MEASURE) throw Error(`${hand}: note crosses the bar line in measure ${out.length + 1}`);
    cur.push(n); pos += n.dur;
    if (pos === MEASURE) { out.push(cur); cur = []; pos = 0; }
  }
  if (cur.length) throw Error(`${hand}: last measure lasts ${pos / DIV} quarters, expected ${MEASURE / DIV}`);
  return out;
}

/** Beam eighths in half-bar groups (MusicXML beam values per note index). */
function beams(notes) {
  const result = notes.map(() => null);
  let pos = 0, run = [];
  const flush = () => {
    if (run.length > 1) run.forEach((i, k) => (result[i] = k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue'));
    run = [];
  };
  notes.forEach((n, i) => {
    const group = Math.floor(pos / 8);
    if (n.dur !== 2 || (run.length && run.group !== group)) flush();
    if (n.dur === 2) { if (!run.length) run.group = group; run.push(i); }
    pos += n.dur;
  });
  flush();
  return result;
}

const ACC = {'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'};
const CLEF = {G: '<sign>G</sign><line>2</line>', F: '<sign>F</sign><line>4</line>'};

// `clef` is the staff's running state: {sign, drawn, altered (notes altered in the previous bar)}.
function staffXml(measureNotes, {staff, voice, keyAlt, clef, placement}) {
  if (!measureNotes) { clef.altered = {}; return `   <note><rest measure="yes"/><duration>${MEASURE}</duration><voice>${voice}</voice><staff>${staff}</staff></note>\n`; }
  const shown = {};
  const bm = beams(measureNotes);
  let xml = '';
  measureNotes.forEach((n, ni) => {
    // Clef with hysteresis: treble down to G3, bass up to G4 (three ledger lines either way).
    const ms = n.pitches.map(midi);
    const lo = Math.min(...ms), hi = Math.max(...ms);
    if (clef.sign === 'G' && hi < 55) clef.sign = 'F';
    else if (clef.sign === 'F' && lo > 67) clef.sign = 'G';
    if (clef.sign !== clef.drawn) {
      xml += `   <attributes><clef number="${staff}">${CLEF[clef.sign]}</clef></attributes>\n`;
      clef.drawn = clef.sign;
    }
    const [type, dots] = TYPES[n.dur];
    n.pitches.forEach((p, pi) => {
      let x = '   <note>' + (pi ? '<chord/>' : '');
      x += `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
      x += `<duration>${n.dur}</duration><voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}`;
      const k = p.step + p.octave;
      if ((shown[k] ?? keyAlt[p.step] ?? 0) !== p.alter) x += `<accidental>${ACC[p.alter]}</accidental>`;
      // Courtesy accidental when the previous bar altered this note.
      else if (!(k in shown) && k in clef.altered && clef.altered[k] !== p.alter) x += `<accidental cautionary="yes">${ACC[p.alter]}</accidental>`;
      shown[k] = p.alter;
      x += `<staff>${staff}</staff>`;
      if (pi === 0 && bm[ni]) x += `<beam number="1">${bm[ni]}</beam>`;
      x += `<notations><technical><fingering placement="${placement}">${n.fingers[pi]}</fingering></technical></notations>`;
      xml += x + '</note>\n';
    });
  });
  clef.altered = Object.fromEntries(Object.entries(shown).filter(([k, a]) => a !== (keyAlt[k[0]] ?? 0)));
  return xml;
}

function toMusicXML({title, fifths, tempo, rh, lh}) {
  const count = Math.max(rh?.length ?? 0, lh?.length ?? 0);
  if (rh && lh && rh.length !== lh.length) throw Error(`RH has ${rh.length} measures but LH has ${lh.length}`);
  const keyAlt = keySignatureAlters(fifths);
  const first = (ms, fallback) => ms ? midi(ms[0][0].pitches[0]) : fallback;
  const clefs = {
    1: {sign: first(rh, 60) < 55 ? 'F' : 'G'},
    2: {sign: first(lh, 48) > 67 ? 'G' : 'F'},
  };
  for (const c of Object.values(clefs)) { c.drawn = c.sign; c.altered = {}; }
  let body = '';
  for (let mi = 0; mi < count; mi++) {
    let xml = `  <measure number="${mi + 1}">\n`;
    if (mi === 0) {
      xml += `   <attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key>` +
        `<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
        `<clef number="1">${CLEF[clefs[1].sign]}</clef><clef number="2">${CLEF[clefs[2].sign]}</clef></attributes>\n`;
      if (tempo) xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${tempo}"/></direction>\n`;
    }
    xml += staffXml(rh?.[mi], {staff: 1, voice: 1, keyAlt, clef: clefs[1], placement: 'above'});
    xml += `   <backup><duration>${MEASURE}</duration></backup>\n`;
    xml += staffXml(lh?.[mi], {staff: 2, voice: 5, keyAlt, clef: clefs[2], placement: 'below'});
    if (mi === count - 1) xml += '   <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
    body += xml + '  </measure>\n';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${esc(title)}</work-title></work>
 <identification><creator type="composer">Technique</creator><rights>CC0-1.0</rights><encoding><software>piano-practice exercises</software></encoding></identification>
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
${body} </part>
</score-partwise>
`;
}

export const DEFAULT_TEMPO = {scale: 80, arpeggio: 72, 'five-finger': 90, progression: 72, chromatic: 72};

/** → {title, musicxml, params} */
export function generateExercise(params) {
  const p = normalizeParams(params);
  const title = exerciseTitle(p);
  const [rhOct, lhOct] = octavesFor(p.type === 'five-finger' ? 1 : p.octaves, p.tonic);
  let rh = null, lh = null;
  if (p.type === 'progression') {
    const r = progressionNotes(p);
    rh = r.rh; lh = r.lh;
  } else {
    const make = {scale: scaleNotes, arpeggio: arpeggioNotes, 'five-finger': fiveFingerNotes, chromatic: chromaticNotes}[p.type];
    if (p.hands !== 'left') rh = make(p, 'right', rhOct);
    if (p.hands !== 'right') lh = make(p, 'left', lhOct);
  }
  const fifths = p.type === 'chromatic' ? 0 : keyFifths(p.tonic, p.mode);
  const musicxml = toMusicXML({
    title, fifths, tempo: params.tempo ?? DEFAULT_TEMPO[p.type],
    rh: rh && splitMeasures(rh, 'RH'), lh: lh && splitMeasures(lh, 'LH'),
  });
  return {title, musicxml, params: p};
}
