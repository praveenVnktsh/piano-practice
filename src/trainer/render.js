// Engraves a short staff (treble, bass or grand) with one or two whole notes as
// SVG, using real SMuFL glyphs (Leipzig) for clefs, noteheads and accidentals.
// Pure string output so it can be tested and rendered without Verovio.

import {GLYPHS} from './glyphs.js';
import {diatonic, keyAlters, keySignatureSteps, parsePitch, pitchLabel} from './levels.js';

const SP = 10;               // user units per staff space
const GS = SP / 250;         // glyph units → user units
const LINE = .13 * SP;       // staff line thickness
const LEDGER = .2 * SP;
const W = {gClef: 2.7, fClef: 2.7, noteWhole: 1.62, sharp: .8, flat: .78, natural: .64, doubleSharp: 1, doubleFlat: 1.3};
const ACC_GLYPH = {'-2': 'doubleFlat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'doubleSharp'};

// Bottom-line pitch of each staff, and the line each clef glyph sits on (staff position, 0 = bottom line).
const BOTTOM = {treble: diatonic(parsePitch('E4')), bass: diatonic(parsePitch('G2'))};
const CLEF = {treble: {glyph: 'gClef', pos: 2}, bass: {glyph: 'fClef', pos: 6}};
// Where each key-signature accidental sits, by clef (treble positions; bass is two steps lower).
const SHARP_POS = {F: 8, C: 5, G: 9, D: 6, A: 3, E: 7, B: 4};
const FLAT_POS = {B: 4, E: 7, A: 3, D: 6, G: 2, C: 5, F: 1};

const MARGIN = 4.2;          // staff spaces above/below each staff (room for two ledger lines and the clefs)
const GAP = 6;               // between treble and bass staves of a grand staff

const f = n => +n.toFixed(2);
const glyph = (name, x, y, cls = '') => `<path${cls ? ` class="${cls}"` : ''} transform="translate(${f(x)} ${f(y)}) scale(${GS} ${-GS})" d="${GLYPHS[name]}"/>`;
const hline = (x1, x2, y, w, cls = '') => `<rect${cls ? ` class="${cls}"` : ''} x="${f(x1)}" y="${f(y - w / 2)}" width="${f(x2 - x1)}" height="${f(w)}"/>`;

/** Staff layout: the y of each staff's bottom line, the overall height. */
export function layout(staff) {
  if (staff === 'grand') {
    const top = MARGIN * SP;
    const trebleBottom = top + 4 * SP;
    const bassBottom = trebleBottom + GAP * SP + 4 * SP;
    return {staves: {treble: trebleBottom, bass: bassBottom}, height: bassBottom + MARGIN * SP};
  }
  const bottom = (MARGIN + 4) * SP;
  return {staves: {[staff]: bottom}, height: bottom + MARGIN * SP};
}

/** Staff position of a pitch on a clef (0 = bottom line, 8 = top line). */
export const staffPos = (p, clef) => diatonic(p) - BOTTOM[clef];

function brace(x, y1, y2) {
  // A filled brace: two mirrored halves, thick in the middle of each, sharp at the tips and centre.
  const h = y2 - y1, w = 1.25 * SP, m = y1 + h / 2;
  const half = s => {
    const Y = t => f(m - s * (h / 2) * t);
    return `M${f(x + w)} ${Y(1)} C${f(x + .05 * w)} ${Y(.85)} ${f(x + .95 * w)} ${Y(.2)} ${f(x)} ${Y(0)} `
      + `C${f(x + 1.55 * w)} ${Y(.18)} ${f(x + .55 * w)} ${Y(.85)} ${f(x + w)} ${Y(1)}Z`;
  };
  return `<path class="tr-brace" d="${half(1)} ${half(-1)}"/>`;
}

/**
 * renderStaff({staff, key, item}) → SVG markup.
 * staff: 'treble' | 'bass' | 'grand'. key: fifths (+sharps / -flats).
 * item: {clef, pitches: [{step, alter, octave}]} or null for an empty staff.
 * Accidentals are printed only where the pitch differs from the key signature.
 */
export function renderStaff({staff = 'treble', key = 0, item = null} = {}) {
  const {staves, height} = layout(staff);
  const clefs = Object.keys(staves);
  const grand = staff === 'grand';
  const left = (grand ? 2.4 : 1) * SP;
  const keySteps = keySignatureSteps(key);
  const keyW = keySteps.length ? keySteps.length * (key > 0 ? 1 : .95) * SP + .6 * SP : 0;
  const clefX = left + .9 * SP;
  const keyX = clefX + 3.5 * SP;
  const bodyX = keyX + keyW;
  const bodyW = (grand ? 13 : 12) * SP;
  const width = bodyX + bodyW + .6 * SP;
  const noteX = bodyX + bodyW / 2 - W.noteWhole * SP / 2;

  const out = [];
  // Staff lines, clefs, key signatures.
  for (const clef of clefs) {
    const b = staves[clef];
    for (let i = 0; i < 5; i++) out.push(hline(left, width - .6 * SP, b - i * SP, LINE, 'tr-line'));
    const c = CLEF[clef];
    out.push(glyph(c.glyph, clefX, b - c.pos * SP / 2, 'tr-clef'));
    keySteps.forEach((step, i) => {
      const pos = (key > 0 ? SHARP_POS : FLAT_POS)[step] - (clef === 'bass' ? 2 : 0);
      out.push(glyph(key > 0 ? 'sharp' : 'flat', keyX + i * (key > 0 ? 1 : .95) * SP, b - pos * SP / 2, 'tr-keysig'));
    });
  }
  // System line and brace.
  const top = staves[clefs[0]] - 4 * SP, bottom = staves[clefs[clefs.length - 1]];
  out.push(`<rect class="tr-line" x="${f(left - LINE)}" y="${f(top - LINE / 2)}" width="${f(LINE * 1.6)}" height="${f(bottom - top + LINE)}"/>`);
  if (grand) out.push(brace(left - 1.75 * SP, top - LINE, bottom + LINE));

  // Notes.
  if (item?.pitches?.length) {
    const clef = item.clef ?? clefs[0];
    const b = staves[clef];
    const alters = keyAlters(key);
    const notes = item.pitches.map(p => ({p, pos: staffPos(p, clef)})).sort((a, c) => a.pos - c.pos);
    // A second between the notes: the upper head moves to the right of the stem line.
    notes.forEach((n, i) => { n.x = noteX + (i > 0 && n.pos - notes[i - 1].pos === 1 && !notes[i - 1].shift ? W.noteWhole * SP : 0); n.shift = n.x !== noteX; });
    const lo = notes[0].pos, hi = notes[notes.length - 1].pos;
    const minX = Math.min(...notes.map(n => n.x)), maxX = Math.max(...notes.map(n => n.x)) + W.noteWhole * SP;
    const lx1 = minX - .45 * SP, lx2 = maxX + .45 * SP;
    const ledgers = [];
    for (let pos = -2; pos >= lo; pos -= 2) ledgers.push(pos);
    for (let pos = 10; pos <= hi; pos += 2) ledgers.push(pos);
    const parts = ledgers.map(pos => hline(lx1, lx2, b - pos * SP / 2, LEDGER, 'tr-ledger'));
    // Accidentals, right to left from the top note, stepping left when they would collide.
    const accEdge = minX - .3 * SP;
    let prevPos = null, prevLeft = accEdge;
    for (const n of [...notes].reverse()) {
      if (n.p.alter === (alters[n.p.step] ?? 0)) continue;
      const g = ACC_GLYPH[n.p.alter];
      const right = prevPos != null && prevPos - n.pos < 6 ? prevLeft - .2 * SP : accEdge;
      prevLeft = right - W[g] * SP;
      parts.push(glyph(g, prevLeft, b - n.pos * SP / 2, 'tr-acc'));
      prevPos = n.pos;
    }
    for (const n of notes) parts.push(glyph('noteWhole', n.x, b - n.pos * SP / 2, 'tr-head'));
    const name = item.pitches.map(p => pitchLabel(p)).join(' and ');
    out.push(`<g class="tr-notes" data-name="${name}">${parts.join('')}</g>`);
  }

  const label = `${grand ? 'Grand staff' : clefs[0] === 'treble' ? 'Treble clef' : 'Bass clef'}${item?.pitches?.length ? '' : ', empty'}`;
  return `<svg class="tr-staff" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(width)} ${f(height)}" role="img" aria-label="${label}">${out.join('')}</svg>`;
}
