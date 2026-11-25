// MIDI → MusicXML for imports: quantise a parsed Standard MIDI File (./parse.mjs) onto a grid and
// write a two-staff piano score the normal pipeline (loadSong {data} → Verovio → buildScore)
// engraves and plays. Pure, no dependencies; tests in tests/midi-import.test.js.
//
//   midiToMusicXml(bytesOrParsed, {title, fileName}) → {
//     xml, title, quality (0–1), fallingPreferred, warnings: [string],
//     stats: {notes, measures, grid, hands, key: {fifths, mode, from}, time, tempo},
//   }
//
// How it works
// - Grid: 16th notes (3 MusicXML divisions; a quarter is DIV = 12). In 2/4, 3/4, 4/4 … each
//   quarter-note beat whose onsets fit eighth-note triplets clearly better than 16ths is written
//   as triplets instead (4 divisions each, <time-modification> 3:2).
// - Quality: how close the onsets were to the chosen grid. A file written in a sequencer or
//   notation program lands on the grid (≈ 1); a recorded performance doesn't (≈ 0.3). Below
//   FALLING_BELOW the import is marked "falling notes preferred": the sheet is only a rough guide.
// - Hands: two or more tracks (or channels) with notes are split by track, the higher one on
//   average being the right hand; otherwise by pitch around middle C, with notes near the split
//   going to the hand that last played closest to them (hysteresis, so a line crossing C4 stays
//   in one hand).
// - Bars from the time signature meta events (4/4 when there are none); notes crossing a barline
//   (or a triplet beat) are tied; gaps are rests; notes starting and ending together are chords;
//   a held note under moving notes goes to a second voice in that staff.
// - Key from the key signature meta event, else estimated from the pitch classes
//   (Krumhansl–Kessler profiles, weighted by duration); a "C major" meta event that clearly
//   doesn't fit the notes (a sequencer default) is overruled by the estimate.
// - Tempo from the first tempo event; sustain pedal (CC64) as Ped. marks under the bass staff.
// - Drums (channel 10) are left out. Leading empty bars are dropped.

import {parseMidi} from './parse.mjs';

export const DIV = 12; // divisions per quarter note: 16ths are 3, eighth-note triplets 4
export const FALLING_BELOW = 0.75;

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const ACC_NAME = {'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'};
// Krumhansl–Kessler key profiles (C major / C minor).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mod = (a, n) => ((a % n) + n) % n;

export function midiToMusicXml(input, {title = '', fileName = ''} = {}) {
  const midi = input instanceof Uint8Array || input instanceof ArrayBuffer ? parseMidi(input) : input;
  const tpq = midi.division;
  const warnings = [];
  const raw = midi.notes.filter(n => n.channel !== 9 && n.end >= n.tick);
  if (!raw.length) throw Error('This MIDI file has no notes to play' + (midi.notes.length ? ' (drum tracks are left out).' : '.'));

  // ───── meters (quantised to whole quarters' grid) ─────
  const toUnit = tick => Math.round(tick * DIV / tpq);
  let meters = midi.timeSigs.filter(t => [1, 2, 4, 8, 16].includes(t.den)).map(t => ({u: toUnit(t.tick), num: t.num, den: t.den}));
  if (!meters.length || meters[0].u > 0) meters.unshift({u: 0, num: meters[0]?.u > 0 ? meters[0].num : 4, den: meters[0]?.u > 0 ? meters[0].den : 4});
  const allowTriplets = meters.every(m => m.den <= 4);

  // ───── grid: 16ths, or eighth-note triplets beat by beat ─────
  const triplet = new Set();
  if (allowTriplets) {
    const fracs = new Map();
    for (const n of raw) {
      const x = n.tick / tpq;
      let k = Math.floor(x), f = x - k;
      if (f > 7 / 8) { k++; f = 0; }
      if (!fracs.has(k)) fracs.set(k, []);
      fracs.get(k).push(f);
    }
    const dist = (f, g) => Math.abs(f - Math.round(f * g) / g);
    for (const [k, fs] of fracs) {
      const e4 = fs.reduce((s, f) => s + dist(f, 4), 0), e3 = fs.reduce((s, f) => s + dist(f, 3), 0);
      const tripletOnly = fs.some(f => dist(f, 3) < 1 / 24 && dist(f, 4) > 1 / 24);
      if (tripletOnly && e3 < 0.5 * e4) triplet.add(k);
    }
  }
  const gridAt = tick => triplet.has(Math.floor(tick / tpq)) ? 3 : 4;
  const quant = tick => {
    const x = tick / tpq, k = Math.floor(x), g = triplet.has(k) ? 3 : 4;
    return k * DIV + Math.round((x - k) * g) * (DIV / g);
  };
  const minStep = u => triplet.has(Math.floor(u / DIV)) ? 4 : 3;

  // ───── quality: how well the onsets fit the grid ─────
  let onGrid = 0, errSum = 0;
  for (const n of raw) {
    const err = Math.abs(n.tick / tpq - quant(n.tick) / DIV); // in quarters
    if (err <= 1 / 48) onGrid++;
    errSum += Math.min(1, err / (0.5 / gridAt(n.tick)));
  }
  const quality = Math.round((0.6 * onGrid / raw.length + 0.4 * (1 - errSum / raw.length)) * 100) / 100;
  const fallingPreferred = quality < FALLING_BELOW;

  // ───── quantised notes ─────
  const notes = raw.map(n => {
    const s = quant(n.tick);
    return {n: n.n, vel: n.vel, s, e: Math.max(quant(n.end), s + minStep(s)), group: n.track * 16 + n.channel};
  });

  // ───── hands ─────
  const groups = new Map();
  for (const n of notes) {
    if (!groups.has(n.group)) groups.set(n.group, []);
    groups.get(n.group).push(n);
  }
  let handsBy;
  if (groups.size >= 2) {
    handsBy = midi.tracks.filter(t => t.noteCount).length >= 2 ? 'tracks' : 'channels';
    const means = [...groups].map(([g, list]) => [g, list.reduce((s, n) => s + n.n, 0) / list.length]).sort((a, b) => b[1] - a[1]);
    const hi = means[0][1], lo = means.at(-1)[1];
    const handOf = new Map(means.map(([g, m], i) => [g, i === 0 ? 'r' : i === means.length - 1 ? 'l' : hi - m <= m - lo ? 'r' : 'l']));
    for (const n of notes) n.hand = handOf.get(n.group);
  } else {
    handsBy = 'pitch';
    let lastR = 67, lastL = 48;
    for (const n of [...notes].sort((a, b) => a.s - b.s || b.n - a.n)) {
      if (n.n >= 64) n.hand = 'r';
      else if (n.n <= 55) n.hand = 'l';
      else {
        const dr = Math.abs(n.n - lastR), dl = Math.abs(n.n - lastL);
        n.hand = dr < dl ? 'r' : dl < dr ? 'l' : n.n >= 60 ? 'r' : 'l';
      }
      if (n.hand === 'r') lastR = n.n; else lastL = n.n;
    }
  }

  // ───── key ─────
  const key = chooseKey(midi, notes, raw[0].tick);
  const keyChanges = midi.keySigs.filter(k => toUnit(k.tick) > 0 && key.from === 'file').map(k => ({u: toUnit(k.tick), fifths: k.fifths, mode: k.minor ? 'minor' : 'major'}));

  // ───── voices per hand ─────
  const voices = {r: voicesOf(notes.filter(n => n.hand === 'r')), l: voicesOf(notes.filter(n => n.hand === 'l'))};

  // ───── measures ─────
  const end = Math.max(...notes.map(n => n.e));
  const firstStart = Math.min(...notes.map(n => n.s));
  const measures = [];
  for (let pos = 0, i = 0; pos < end && measures.length < 10000;) {
    while (i + 1 < meters.length && meters[i + 1].u <= pos) i++;
    const {num, den} = meters[i];
    const len = num * 4 * DIV / den;
    measures.push({start: pos, end: pos + len, len, num, den});
    pos += len;
  }
  while (measures.length > 1 && measures[0].end <= firstStart) measures.shift();

  // ───── tempo ─────
  const tempoEvent = midi.tempos.filter(t => t.tick <= raw[0].tick).at(-1) || midi.tempos[0];
  const bpm = tempoEvent ? Math.max(10, Math.min(400, Math.round(tempoEvent.bpm))) : 120;
  if (new Set(midi.tempos.map(t => Math.round(t.bpm))).size > 3) warnings.push('The tempo changes often in this file; the score uses the opening tempo.');

  // ───── pedal: quantised down/up changes ─────
  const pedalMarks = [];
  if (!fallingPreferred) {
    let down = false;
    for (const p of midi.pedal.filter(p => p.channel !== 9)) {
      const isDown = p.value >= 64;
      if (isDown === down) continue;
      down = isDown;
      const u = quant(p.tick);
      const last = pedalMarks.at(-1);
      if (last && last.u === u && last.type === 'stop' && isDown) last.type = 'change';
      else pedalMarks.push({u, type: isDown ? 'start' : 'stop'});
    }
  }

  // ───── write ─────
  const name = pickTitle(title, midi.title, fileName);
  const xml = writeScore({name, measures, voices, key, keyChanges, bpm, pedalMarks, triplet});
  if (fallingPreferred) warnings.unshift('The timing in this MIDI file is loose (it sounds like a recorded performance), so it opens in falling notes; the sheet music is only a rough guide.');
  const time = `${measures[0].num}/${measures[0].den}`;
  return {
    xml, title: name, quality, fallingPreferred, warnings,
    stats: {
      notes: notes.length, measures: measures.length, grid: triplet.size ? 'sixteenths+triplets' : 'sixteenths',
      hands: handsBy, key: {fifths: key.fifths, mode: key.mode, from: key.from}, time, tempo: bpm,
    },
  };
}

function pickTitle(given, fromFile, fileName) {
  if (given) return given;
  if (fromFile && !/^(track|piano|untitled|sequence|seq|midi|grand piano|acoustic grand( piano)?)\s*\d*$/i.test(fromFile)) return fromFile.slice(0, 200);
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported MIDI';
}

// ───────── key ─────────

const majorTonicFifths = pc => { const f = mod(pc * 7, 12); return f > 6 ? f - 12 : f; };

function estimateKey(notes) {
  const w = new Array(12).fill(0);
  for (const n of notes) w[n.n % 12] += n.e - n.s;
  let best = {r: -Infinity};
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const r = correlation(w, i => prof[mod(i - tonic, 12)]);
      if (r > best.r) best = {r, tonic, mode};
    }
  }
  const fifths = best.mode === 'major' ? majorTonicFifths(best.tonic) : majorTonicFifths(best.tonic + 3);
  return {fifths, mode: best.mode};
}

function correlation(xs, prof) {
  const ys = xs.map((_, i) => prof(i));
  const mx = xs.reduce((a, b) => a + b, 0) / 12, my = ys.reduce((a, b) => a + b, 0) / 12;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < 12; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

const scalePcs = fifths => new Set(STEPS.map(s => mod(STEP_PC[s] + keyAlters(fifths)[s], 12)));
function outOfKey(notes, fifths) {
  const pcs = scalePcs(fifths);
  let out = 0, all = 0;
  for (const n of notes) { const d = n.e - n.s; all += d; if (!pcs.has(n.n % 12)) out += d; }
  return all ? out / all : 0;
}

function chooseKey(midi, notes, firstTick) {
  const est = estimateKey(notes);
  const meta = midi.keySigs.filter(k => k.tick <= firstTick).at(-1) || midi.keySigs[0];
  if (!meta) return {...est, from: 'estimate'};
  const given = {fifths: meta.fifths, mode: meta.minor ? 'minor' : 'major'};
  // A sequencer's default C major that the notes don't fit: trust the notes.
  if (given.fifths === 0 && !meta.minor && est.fifths !== 0) {
    const a = outOfKey(notes, 0), b = outOfKey(notes, est.fifths);
    if (a > 0.15 && b < a / 2) return {...est, from: 'estimate'};
  }
  return {...given, from: 'file'};
}

export function keyAlters(fifths) {
  const alters = {C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0};
  if (fifths > 0) for (const s of SHARPS.slice(0, fifths)) alters[s] = 1;
  if (fifths < 0) for (const s of [...SHARPS].reverse().slice(0, -fifths)) alters[s] = -1;
  return alters;
}

/** pc (0–11) → {step, alter} for a key: diatonic notes as in the key, raised 6th/7th in minor, else sharps / flats. */
export function spellingFor(fifths, mode = 'major') {
  const alters = keyAlters(fifths);
  const map = new Map();
  for (const s of STEPS) map.set(mod(STEP_PC[s] + alters[s], 12), {step: s, alter: alters[s]});
  const majorTonic = mod(fifths * 7, 12);
  if (mode === 'minor') {
    const tonic = mod(majorTonic + 9, 12);
    const tonicStep = [...map.values()].find(v => mod(STEP_PC[v.step] + v.alter, 12) === tonic).step;
    for (const degree of [5, 6]) { // raised 6th and 7th
      const step = STEPS[(STEPS.indexOf(tonicStep) + degree) % 7];
      const pc = mod(STEP_PC[step] + alters[step] + 1, 12);
      if (!map.has(pc)) map.set(pc, {step, alter: alters[step] + 1});
    }
  }
  const C_MAJOR = {1: ['C', 1], 3: ['E', -1], 6: ['F', 1], 8: ['G', 1], 10: ['B', -1]};
  for (let pc = 0; pc < 12; pc++) {
    if (map.has(pc)) continue;
    if (fifths === 0 && C_MAJOR[pc]) { map.set(pc, {step: C_MAJOR[pc][0], alter: C_MAJOR[pc][1]}); continue; }
    const natural = STEPS.find(s => STEP_PC[s] === (fifths >= 0 ? mod(pc - 1, 12) : mod(pc + 1, 12)));
    map.set(pc, natural ? {step: natural, alter: fifths >= 0 ? 1 : -1} : {step: STEPS.find(s => STEP_PC[s] === pc), alter: 0});
  }
  return pc => map.get(pc);
}

// ───────── voices ─────────

/** A hand's notes → up to two voices of non-overlapping chords [{s, e, ns: [midi]}]. */
function voicesOf(list) {
  // The same pitch twice: drop exact repeats, cut a note short where the next one starts.
  const byPitch = new Map();
  for (const n of [...list].sort((a, b) => a.s - b.s || b.e - a.e)) {
    const prev = byPitch.get(n.n);
    if (prev && prev.s === n.s) continue;
    if (prev && prev.e > n.s) prev.e = n.s;
    byPitch.set(n.n, n);
    n.keep = true;
  }
  const kept = list.filter(n => n.keep);
  const chords = new Map();
  for (const n of kept) {
    const k = n.s + ':' + n.e;
    if (!chords.has(k)) chords.set(k, {s: n.s, e: n.e, ns: []});
    chords.get(k).ns.push(n.n);
  }
  const sorted = [...chords.values()].sort((a, b) => a.s - b.s || b.e - a.e);
  const v = [[], []];
  const endOf = i => v[i].at(-1)?.e ?? -Infinity;
  for (const c of sorted) {
    c.ns.sort((a, b) => a - b);
    const free = [0, 1].filter(i => endOf(i) <= c.s);
    if (free.length) {
      // Keep a line in the voice it was in: the free voice that ended latest.
      const i = free.length === 2 && endOf(1) > endOf(0) && v[1].length ? 1 : free[0];
      v[i].push(c);
      continue;
    }
    const last = v[0].at(-1);
    if (last.s === c.s) { for (const n of c.ns) if (!last.ns.includes(n)) last.ns.push(n); last.ns.sort((a, b) => a - b); }
    else { last.e = c.s; v[0].push(c); }
  }
  // Voice 1 should carry the music when there is only one line.
  if (!v[0].length && v[1].length) v.reverse();
  return v;
}

// ───────── durations ─────────

const VALUES = [[72, 'whole', 1], [48, 'whole', 0], [36, 'half', 1], [24, 'half', 0], [18, 'quarter', 1], [12, 'quarter', 0], [9, 'eighth', 1], [6, 'eighth', 0], [3, '16th', 0]];
const ALIGN_SIMPLE = {72: 72, 48: 48, 36: 12, 24: 12, 18: 12, 12: 12, 9: 12, 6: 6, 3: 3};
const ALIGN_COMPOUND = {72: 72, 48: 72, 36: 36, 24: 36, 18: 18, 12: 6, 9: 18, 6: 6, 3: 3};

/** [a, b) inside measure m → notatable pieces [{a, b, type, dots, tm?}]. */
function pieces(a, b, m, triplet) {
  const out = [];
  // Cut at the edges of triplet beats.
  const cuts = [a];
  for (let k = Math.ceil(a / DIV); k * DIV < b; k++) if (k * DIV > a) cuts.push(k * DIV);
  cuts.push(b);
  const compound = m.den === 8 && m.num % 3 === 0 && m.num > 3;
  const align = compound ? ALIGN_COMPOUND : ALIGN_SIMPLE;
  let straightFrom = null;
  const flush = to => {
    for (let p = straightFrom; p < to;) {
      const rel = p - m.start;
      const [len, type, dots] = VALUES.find(([len]) => p + len <= to && rel % align[len] === 0 && len <= m.len) || [3, '16th', 0];
      out.push({a: p, b: p + len, type, dots});
      p += len;
    }
    straightFrom = null;
  };
  for (let i = 0; i + 1 < cuts.length; i++) {
    const x = cuts[i], y = cuts[i + 1];
    const k = Math.floor(x / DIV);
    if (triplet.has(k) && y - x !== DIV) {
      if (straightFrom != null) flush(x);
      out.push({a: x, b: y, type: y - x === 8 ? 'quarter' : 'eighth', dots: 0, tm: true});
    } else if (straightFrom == null) straightFrom = x;
  }
  if (straightFrom != null) flush(b);
  return out;
}

// ───────── MusicXML ─────────

function writeScore({name, measures, voices, key, keyChanges, bpm, pedalMarks, triplet}) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="4.0">');
  lines.push(`  <work><work-title>${esc(name)}</work-title></work>`);
  lines.push('  <identification><encoding><software>Piano Practice MIDI import</software></encoding></identification>');
  lines.push('  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  lines.push('  <part id="P1">');
  let curKey = {fifths: key.fifths, mode: key.mode}, curTime = '';
  measures.forEach((m, mi) => {
    lines.push(`    <measure number="${mi + 1}">`);
    const change = keyChanges.filter(k => k.u < m.end && (mi === 0 ? k.u <= m.start : k.u > measures[mi - 1].start)).at(-1);
    const keyNow = change && mi > 0 && (change.fifths !== curKey.fifths || change.mode !== curKey.mode) ? {fifths: change.fifths, mode: change.mode} : curKey;
    const time = `${m.num}/${m.den}`;
    const attrs = [];
    if (mi === 0) attrs.push(`<divisions>${DIV}</divisions>`);
    if (mi === 0 || keyNow !== curKey) attrs.push(`<key><fifths>${keyNow.fifths}</fifths><mode>${keyNow.mode}</mode></key>`);
    if (time !== curTime) attrs.push(`<time><beats>${m.num}</beats><beat-type>${m.den}</beat-type></time>`);
    if (mi === 0) attrs.push('<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>');
    curKey = keyNow; curTime = time;
    if (attrs.length) lines.push('      <attributes>' + attrs.join('') + '</attributes>');
    if (mi === 0) lines.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${bpm}"/></direction>`);

    const spell = spellingFor(curKey.fifths, curKey.mode);
    // Pedal marks sit at the start of the bar, each placed by its <offset> into it.
    for (const p of pedalMarks.filter(p => p.u >= m.start && (p.u < m.end || (mi === measures.length - 1 && p.u === m.end)))) lines.push(pedalXml(p, p.u - m.start));
    let first = true;
    for (const [hand, staff, voiceNos] of [['r', 1, [1, 2]], ['l', 2, [5, 6]]]) {
      // Every voice's pieces for this staff, then accidentals in time order across them.
      const staffVoices = [];
      voices[hand].forEach((chords, vi) => {
        const inBar = chords.filter(c => c.s < m.end && c.e > m.start);
        if (vi === 1 && !inBar.length) return;
        staffVoices.push({voice: voiceNos[vi], items: inBar.length ? barItems(inBar, m, triplet, spell) : null});
      });
      markAccidentals(staffVoices.flatMap(v => v.items || []), keyAlters(curKey.fifths));
      for (const {voice, items} of staffVoices) {
        if (!first) lines.push(`      <backup><duration>${m.len}</duration></backup>`);
        first = false;
        if (!items) {
          lines.push(`      <note><rest measure="yes"/><duration>${m.len}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`);
          continue;
        }
        markTuplets(items);
        for (const it of items) {
          lines.push(...noteXml(it, voice, staff));
        }
      }
    }
    lines.push('    </measure>');
  });
  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join('\n') + '\n';
}

const pedalXml = (p, offset) => `      <direction placement="below"><direction-type><pedal type="${p.type}" line="no"/></direction-type>${offset ? `<offset>${offset}</offset>` : ''}<staff>2</staff></direction>`;

/** Chords in a bar (one voice) → pieces with rests and ties: [{a, b, type, dots, tm?, notes: [{step, alter, octave, tieStart, tieStop}] | null}]. */
function barItems(chords, m, triplet, spell) {
  const out = [];
  let cursor = m.start;
  const emit = (a, b, chord) => {
    const ps = pieces(a, b, m, triplet);
    ps.forEach((p, i) => {
      if (!chord) { out.push({...p, notes: null}); return; }
      const tieStop = i > 0 || chord.s < a, tieStart = i < ps.length - 1 || chord.e > b;
      out.push({...p, notes: chord.ns.map(n => ({...pitchOf(n, spell), tieStart, tieStop}))});
    });
  };
  for (const c of chords) {
    const a = Math.max(c.s, m.start), b = Math.min(c.e, m.end);
    if (a > cursor) emit(cursor, a, null);
    emit(a, b, c);
    cursor = b;
  }
  if (cursor < m.end) emit(cursor, m.end, null);
  return out;
}

function pitchOf(n, spell) {
  const {step, alter} = spell(n % 12);
  return {step, alter, octave: Math.floor((n - alter) / 12) - 1};
}

function markAccidentals(items, alters) {
  const state = new Map();
  const notes = items.filter(it => it.notes).sort((x, y) => x.a - y.a).flatMap(it => it.notes);
  for (const n of notes) {
    const k = n.step + n.octave;
    const current = state.has(k) ? state.get(k) : alters[n.step];
    if (current !== n.alter && !n.tieStop) n.accidental = ACC_NAME[n.alter];
    state.set(k, n.alter);
  }
}

function markTuplets(items) {
  const beats = new Map();
  for (const it of items) if (it.tm) {
    const k = Math.floor(it.a / DIV);
    if (!beats.has(k)) beats.set(k, []);
    beats.get(k).push(it);
  }
  for (const list of beats.values()) { list[0].tupletStart = true; list.at(-1).tupletStop = true; }
}

function noteXml(it, voice, staff) {
  const dur = it.b - it.a;
  const tail = [
    `<voice>${voice}</voice>`, `<type>${it.type}</type>`, it.dots ? '<dot/>' : '',
  ];
  const tm = it.tm ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '';
  const tuplet = (it.tupletStart ? '<tuplet type="start" bracket="yes"/>' : '') + (it.tupletStop ? '<tuplet type="stop"/>' : '');
  if (!it.notes) {
    const notations = tuplet ? `<notations>${tuplet}</notations>` : '';
    return [`      <note><rest/><duration>${dur}</duration>${tail.join('')}${tm}<staff>${staff}</staff>${notations}</note>`];
  }
  return it.notes.map((n, i) => {
    const pitch = `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>`;
    const ties = (n.tieStop ? '<tie type="stop"/>' : '') + (n.tieStart ? '<tie type="start"/>' : '');
    const tied = (n.tieStop ? '<tied type="stop"/>' : '') + (n.tieStart ? '<tied type="start"/>' : '');
    const acc = n.accidental ? `<accidental>${n.accidental}</accidental>` : '';
    const notations = tied || (i === 0 && tuplet) ? `<notations>${tied}${i === 0 ? tuplet : ''}</notations>` : '';
    return `      <note>${i ? '<chord/>' : ''}${pitch}<duration>${dur}</duration>${ties}${tail.join('')}${acc}${tm}<staff>${staff}</staff>${notations}</note>`;
  });
}
