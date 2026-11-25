#!/usr/bin/env node
// Converts the compact `.notes` song format into MusicXML for a two-staff piano.
//
//   node tools/notes2musicxml.mjs songs/minuet-in-g.notes > public/songs/minuet-in-g.musicxml
//   node tools/notes2musicxml.mjs --all      # every songs/*.notes -> public/songs/*.musicxml
//
// Format (see songs/README.md):
//   title: Minuet in G          header lines (`key: value`) until a line `---`
//   composer: Christian Petzold
//   time: 3/4                   key: 1 (fifths; -1 = one flat)   pickup: yes|no
//   ---
//   RH: d5/4 g4/8 a4 b4 c5 | d5/4 g4 g4 | ...
//   LH: [g3 b3 d4]/2 a3/4 | b3/2. | ...
//
// Voices: RH, RH2 (treble staff), LH, LH2 (bass staff). Lines for the same voice
// are concatenated. `|` separates measures. RH2/LH2 are optional second voices:
// leave a measure empty (`| |`) where the second voice has nothing to play. A token is a pitch (c4, f#5, bb3),
// `r` for a rest, or a chord `[c4 e4 g4]`, optionally followed by a duration
// `/1 /2 /4 /8 /16 /32` with dots (`/4.`); the duration carries over to later
// tokens until changed. A trailing `~` ties the note(s) to the next ones.
// A measure may start with `clef=bass` or `clef=treble` to change that staff's clef (in the
// first measure it sets the staff's starting clef instead).
// `#` at the start of a line or after a space starts a comment (`f#4` is a pitch).

import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, basename, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {periodOf} from '../src/collections/model.js';

const DIV = 8; // divisions per quarter note: a 32nd note is 1
const VOICES = {RH: {voice: 1, staff: 1}, RH2: {voice: 2, staff: 1}, LH: {voice: 5, staff: 2}, LH2: {voice: 6, staff: 2}};
const TYPES = {1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd'};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

export function parseNotes(text, file = 'song') {
  const [head, body] = text.split(/^---\s*$/m);
  if (body == null) throw Error(`${file}: missing '---' line between header and music`);
  const meta = {};
  for (const line of head.split('\n')) {
    const m = line.replace(/(^|\s)#.*/, '').match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) meta[m[1].toLowerCase()] = m[2];
  }
  const voices = {};
  for (const raw of body.split('\n')) {
    const line = raw.replace(/(^|\s)#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^(RH2?|LH2?)\s*:(.*)$/);
    if (!m) throw Error(`${file}: line must start with RH:, RH2:, LH: or LH2: → ${line}`);
    voices[m[1]] = (voices[m[1]] ?? '') + ' ' + m[2];
  }
  if (!voices.RH || !voices.LH) throw Error(`${file}: needs at least RH and LH`);
  return {meta, voices};
}

function parseVoice(src, name, file) {
  const measures = src.split('|').map(s => s.trim());
  if (measures.at(-1) === '') measures.pop();
  let len = 4, dots = 0;
  return measures.map((m, mi) => {
    const tokens = m.match(/\[[^\]]*\][^\s]*|\S+/g) ?? [];
    let clef = null;
    if (/^clef=/.test(tokens[0] ?? '')) {
      clef = {treble: 'G', bass: 'F'}[tokens.shift().slice(5)];
      if (!clef) throw Error(`${file}: ${name} measure ${mi + 1}: clef must be clef=treble or clef=bass`);
    }
    const notes = tokens.map(tok => {
      const t = tok.match(/^(\[[^\]]*\]|[a-gA-G](?:##|bb|#|b|n)?-?\d|r)(?:\/(\d+)(\.*))?(~?)$/);
      if (!t) throw Error(`${file}: ${name} measure ${mi + 1}: can't read "${tok}"`);
      if (t[2]) {
        len = +t[2]; dots = t[3].length;
        if (!TYPES[len]) throw Error(`${file}: ${name} measure ${mi + 1}: bad duration /${t[2]}`);
      }
      let dur = DIV * 4 / len, add = dur;
      for (let i = 0; i < dots; i++) { add /= 2; dur += add; }
      if (!Number.isInteger(dur)) throw Error(`${file}: ${name} measure ${mi + 1}: duration too short in "${tok}"`);
      const pitches = t[1] === 'r' ? [] : (t[1].startsWith('[') ? t[1].slice(1, -1).trim().split(/\s+/) : [t[1]]).map(p => {
        const pm = p.match(/^([a-gA-G])(##|bb|#|b|n)?(-?\d)$/);
        if (!pm) throw Error(`${file}: ${name} measure ${mi + 1}: bad pitch "${p}"`);
        const alter = {'#': 1, '##': 2, b: -1, bb: -2, n: 0}[pm[2]] ?? 0;
        return {step: pm[1].toUpperCase(), alter, octave: +pm[3]};
      });
      return {pitches, dur, type: TYPES[len], dots, tie: t[4] === '~'};
    });
    notes.clef = clef;
    return notes;
  });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function keyAlters(fifths) {
  const alters = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(s => alters[s] = 1);
  if (fifths < 0) [...SHARP_ORDER].reverse().slice(0, -fifths).forEach(s => alters[s] = -1);
  return alters;
}

// Beam runs of eighths and shorter inside each beat group.
function beams(notes, beat) {
  const result = notes.map(() => []);
  let pos = 0, run = [];
  const flush = () => {
    if (run.length > 1) {
      run.forEach((i, k) => result[i].push({n: 1, v: k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue'}));
      const short = run.map(i => notes[i].dur <= DIV / 2 && notes[i].type !== 'eighth');
      run.forEach((i, k) => {
        if (!short[k]) return;
        const left = k > 0 && short[k - 1], right = k < run.length - 1 && short[k + 1];
        result[i].push({n: 2, v: left && right ? 'continue' : left ? 'end' : right ? 'begin' : k === 0 ? 'forward hook' : 'backward hook'});
      });
    }
    run = [];
  };
  notes.forEach((note, i) => {
    const group = Math.floor(pos / beat), endGroup = Math.floor((pos + note.dur - 1) / beat);
    const beamable = note.pitches.length && note.dur < DIV && ['eighth', '16th', '32nd'].includes(note.type);
    if (!beamable || group !== endGroup || (run.length && Math.floor(run.posStart / beat) !== group)) flush();
    if (beamable && group === endGroup) { if (!run.length) run.posStart = pos; run.push(i); }
    pos += note.dur;
  });
  flush();
  return result;
}

export function toMusicXML({meta, voices}, file = 'song') {
  const [beats, beatType] = (meta.time ?? '4/4').split('/').map(Number);
  const fifths = +(meta.key ?? 0);
  const measureDur = beats * DIV * 4 / beatType;
  const beat = beatType === 8 && beats % 3 === 0 ? DIV * 3 / 2 * (beats === 3 ? 2 : 1) : DIV * 4 / beatType;
  const pickup = /^(yes|true)$/i.test(meta.pickup ?? '');
  const parsed = Object.fromEntries(Object.entries(voices).map(([k, v]) => [k, parseVoice(v, k, file)]));
  const count = parsed.RH.length;
  for (const [k, ms] of Object.entries(parsed))
    if (ms.length !== count) throw Error(`${file}: ${k} has ${ms.length} measures but RH has ${count}`);

  // A clef= in the first measure is the staff's starting clef, not a change.
  const startClef = {1: 'G', 2: 'F'};
  for (const [name, ms] of Object.entries(parsed)) if (ms[0]?.clef) { startClef[VOICES[name].staff] = ms[0].clef; ms[0].clef = null; }
  const clefXml = (n, sign) => `<clef number="${n}"><sign>${sign}</sign><line>${sign === 'G' ? 2 : 4}</line></clef>`;
  const keyAlt = keyAlters(fifths);
  const lastPitch = {}; // voice -> pitches tied from the previous note
  const out = [];
  for (let mi = 0; mi < count; mi++) {
    const number = pickup ? mi : mi + 1;
    const expected = pickup && mi === 0 ? null : measureDur;
    const optional = k => k.endsWith('2');
    for (const [k, ms] of Object.entries(parsed))
      if (!ms[mi].length && !optional(k)) throw Error(`${file}: ${k} measure ${number} is empty (use a rest)`);
    const durs = Object.entries(parsed).filter(([k, ms]) => ms[mi].length).map(([k, ms]) => [k, ms[mi].reduce((a, n) => a + n.dur, 0)]);
    const first = durs[0][1];
    for (const [k, d] of durs) {
      if (expected != null && d !== expected) throw Error(`${file}: ${k} measure ${number} lasts ${d / DIV} quarters, expected ${expected / DIV}`);
      if (d !== first) throw Error(`${file}: measure ${number}: voices have different lengths (${durs.map(([k, d]) => k + '=' + d / DIV).join(', ')})`);
    }
    const len = first;
    let xml = `  <measure number="${number}"${pickup && mi === 0 ? ' implicit="yes"' : ''}>\n`;
    if (mi === 0) {
      xml += `   <attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key>` +
        `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>` +
        `${clefXml(1, startClef[1])}${clefXml(2, startClef[2])}</attributes>\n`;
      if (meta.tempo) xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${esc(meta.tempo)}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${esc(meta.tempo)}"/></direction>\n`;
    }
    const shown = {1: {}, 2: {}}; // per staff: step+octave -> alter shown in this measure
    let firstVoice = true;
    for (const [name, ms] of Object.entries(parsed)) {
      const {voice, staff} = VOICES[name];
      if (!ms[mi].length) { lastPitch[name] = []; continue; }
      if (!firstVoice) xml += `   <backup><duration>${len}</duration></backup>\n`;
      firstVoice = false;
      const notes = ms[mi];
      if (notes.clef) xml += `   <attributes><clef number="${staff}"><sign>${notes.clef}</sign><line>${notes.clef === 'G' ? 2 : 4}</line></clef></attributes>\n`;
      const bm = beams(notes, beat);
      notes.forEach((note, ni) => {
        const tiedFrom = lastPitch[name] ?? [];
        const ps = note.pitches.length ? note.pitches : [null];
        ps.forEach((p, pi) => {
          let x = '   <note>';
          if (pi > 0) x += '<chord/>';
          const key = p && p.step + p.octave;
          const stop = p && tiedFrom.some(t => t.step === p.step && t.octave === p.octave && t.alter === p.alter);
          if (p) x += `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
          else x += '<rest/>';
          x += `<duration>${note.dur}</duration>`;
          if (stop) x += '<tie type="stop"/>';
          if (note.tie && p) x += '<tie type="start"/>';
          x += `<voice>${voice}</voice><type>${note.type}</type>` + '<dot/>'.repeat(note.dots);
          if (p) {
            const current = shown[staff][key] ?? keyAlt[p.step] ?? 0;
            if (p.alter !== current && !stop) x += `<accidental>${{'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'}[p.alter]}</accidental>`;
            shown[staff][key] = p.alter;
          }
          x += `<staff>${staff}</staff>`;
          if (pi === 0) for (const b of bm[ni]) x += `<beam number="${b.n}">${b.v}</beam>`;
          if (p && (stop || note.tie)) x += `<notations>${stop ? '<tied type="stop"/>' : ''}${note.tie ? '<tied type="start"/>' : ''}</notations>`;
          xml += x + '</note>\n';
        });
        lastPitch[name] = note.tie ? note.pitches : [];
      });
    }
    if (mi === count - 1) xml += '   <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
    out.push(xml + '  </measure>\n');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${esc(meta.title ?? 'Untitled')}</work-title></work>
 <identification><creator type="composer">${esc(meta.composer ?? '')}</creator>${meta.arranger ? `<creator type="arranger">${esc(meta.arranger)}</creator>` : ''}<rights>${esc(meta.license ?? 'CC0-1.0')}</rights><encoding><software>notes2musicxml</software></encoding></identification>
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
${out.join('')} </part>
</score-partwise>
`;
}

// ───── Beginner arrangements (songs/repertoire.json "arrangements") → catalog entries ─────
const REPO_URL = 'https://github.com/praveenVnktsh/una-mattina-practice/blob/main/songs/';

/** One `arrangements` item → its public/songs/catalog.json entry. */
export function arrangementEntry(a) {
  return {
    id: a.id,
    title: a.title,
    composer: a.composer,
    difficulty: 'beginner',
    grade: a.grade ?? 0,
    ...((a.period ?? periodOf(a.composer)) ? {period: a.period ?? periodOf(a.composer)} : {}),
    file: `songs/${a.id}.musicxml`,
    license: a.license,
    source: `Piano Practice contributors – arrangement for beginners (songs/${a.id}.notes)`,
    sourceUrl: REPO_URL + a.id + '.notes',
    tempo: a.tempo,
    ...(a.hands ? {hands: a.hands} : {}),
    ...(a.position ? {arrangement: a.position} : {}),
  };
}

/**
 * Puts the arrangements' entries into a catalog song list (pure): existing entries with the same
 * id are replaced; the arrangements go, in their own order, at the start of their grade's block.
 */
export function syncArrangements(songs, arrangements) {
  const entries = arrangements.map(arrangementEntry);
  const ids = new Set(entries.map(e => e.id));
  const rest = songs.filter(s => !ids.has(s.id));
  const rank = s => s.grade ?? {beginner: 0, easy: 1.5, intermediate: 3.5, advanced: 5}[s.difficulty] ?? 3;
  const at = rest.findIndex(s => rank(s) >= (entries[0] ? rank(entries[0]) : 0));
  rest.splice(at < 0 ? rest.length : at, 0, ...entries);
  return rest;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    const dir = join(root, 'songs');
    for (const f of readdirSync(dir).filter(f => f.endsWith('.notes'))) {
      const xml = toMusicXML(parseNotes(readFileSync(join(dir, f), 'utf8'), f), f);
      writeFileSync(join(root, 'public/songs', basename(f, '.notes') + '.musicxml'), xml);
      console.error('✓', f);
    }
    // Catalog entries of the beginner arrangements (other entries are kept as they are).
    const manifest = JSON.parse(readFileSync(join(root, 'songs/repertoire.json'), 'utf8'));
    if (manifest.arrangements?.length) {
      const file = join(root, 'public/songs/catalog.json');
      const catalog = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({...catalog, songs: syncArrangements(catalog.songs, manifest.arrangements)}, null, 2) + '\n');
      console.error(`✓ catalog: ${manifest.arrangements.length} arrangements`);
    }
  } else if (args[0]) {
    process.stdout.write(toMusicXML(parseNotes(readFileSync(args[0], 'utf8'), args[0]), args[0]));
  } else {
    console.error('usage: notes2musicxml.mjs <file.notes> | --all');
    process.exit(1);
  }
}
