// A small engraver for exercise examples: one staff (treble, bass, or a one-line rhythm staff) or
// a grand staff, with clef, key and time signatures, notes and rests from semibreves to
// semiquavers, dots, ties, beams, triplets, accidentals, ledger lines and text labels.
// Pure string output (SVG) using the Leipzig SMuFL glyphs, like src/trainer/render.js.
//
//   engrave({staff, key, time, measures, perLine, labels}) → {svg, width, height, events}
//
//   staff     'treble' | 'bass' | 'grand' | 'line' (rhythm: every note on one line, stems up)
//   key       fifths (+ sharps, - flats)
//   time      [beats, unit] or null (no time signature); showTime: false beams by it without printing it
//   measures  [[event, …], …]; event = {dur (in crotchets: 1 = ♩, .5 = ♪, 1/3 = a triplet ♪),
//               pitches?: [{step, alter, octave, clef?}], rest?: true, tie?: true (to the next event),
//               tuplet?: 3, label?: text below, above?: text above, cls?: extra class}
//             Pitches on a grand staff go to the bass staff below middle C unless `clef` says otherwise.
//   perLine   measures per system (default: all on one line)
//   final     end with a final barline (default true); `barlines: false` draws none at all
//
// events: [{i, measure, start (crotchets from the beginning), x (centre of the notehead), line, y0, y1}]
// so views can put a cursor on, or colour, the n-th event (`<g class="eg-ev" data-i="n">`).
import {GLYPHS} from './glyphs.js';
import {midi, LETTERS} from '../exercises/theory.js';

const SP = 10;
const GS = SP / 250;
const LINE = .13 * SP, LEDGER = .2 * SP, STEM = .12 * SP, BEAM = .5 * SP;
const HEAD = {black: 1.256 * SP, half: 1.256 * SP, whole: 1.69 * SP};
const ACC_W = {'-2': 1.3 * SP, '-1': .78 * SP, 0: .64 * SP, 1: .8 * SP, 2: 1 * SP};
const ACC_GLYPH = {'-2': 'doubleFlat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'doubleSharp'};
const SHARP_POS = {F: 8, C: 5, G: 9, D: 6, A: 3, E: 7, B: 4};
const FLAT_POS = {B: 4, E: 7, A: 3, D: 6, G: 2, C: 5, F: 1};
const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const BOTTOM = {treble: 4 * 7 + 2, bass: 2 * 7 + 4}; // diatonic index of E4 / G2
const EPS = 1e-6;

const f = n => +n.toFixed(2);
const glyph = (name, x, y, cls = '') => `<path${cls ? ` class="${cls}"` : ''} transform="translate(${f(x)} ${f(y)}) scale(${GS} ${-GS})" d="${GLYPHS[name]}"/>`;
const rect = (x, y, w, h, cls = '') => `<rect${cls ? ` class="${cls}"` : ''} x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/>`;
const hline = (x1, x2, y, w, cls) => rect(x1, y - w / 2, x2 - x1, w, cls);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const diatonic = p => p.octave * 7 + LETTERS.indexOf(p.step);

/** Note value for a duration in crotchets → {type, dots} (tuplets: the written value), or null. */
export function noteValue(dur, tuplet = 0) {
  const d = tuplet ? dur * tuplet / 2 : dur;
  const table = [[4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0], [.75, 'eighth', 1], [.5, 'eighth', 0], [.375, '16th', 1], [.25, '16th', 0]];
  const hit = table.find(([v]) => Math.abs(v - d) < 1e-4);
  return hit ? {type: hit[1], dots: hit[2]} : null;
}
const beams = type => (type === 'eighth' ? 1 : type === '16th' ? 2 : 0);

/** Length of a beaming group in crotchets for a time signature. */
export function beatLength(time) {
  if (!time) return 1;
  const [beats, unit] = time;
  if (unit === 8 && beats % 3 === 0) return 1.5;
  if (unit === 2) return 2;
  return 4 / unit >= 1 ? 4 / unit : 1;
}

export function engrave({staff = 'treble', key = 0, time = null, showTime = true, measures = [], perLine = 0, final = true, barlines = true, clef = true, spacing = 1, minWidth = 0} = {}) {
  const grand = staff === 'grand', line = staff === 'line';
  const clefs = grand ? ['treble', 'bass'] : [line ? 'line' : staff];
  const beat = beatLength(time);

  // ───── flatten events with timing, values, beams and tuplet groups ─────
  const evs = [];
  let start = 0;
  measures.forEach((m, mi) => {
    let pos = 0;
    m.forEach((e, k) => {
      const v = noteValue(e.dur, e.tuplet || 0) || {type: 'quarter', dots: 0};
      evs.push({...e, ...v, measure: mi, k, start, inBar: pos, i: evs.length});
      start += e.dur; pos += e.dur;
    });
  });
  // Tuplet groups: consecutive tuplet events until they add up to whole crotchets.
  let tg = null;
  for (const e of evs) {
    if (!e.tuplet) { tg = null; continue; }
    if (!tg) { tg = {events: [], sum: 0}; }
    tg.events.push(e); tg.sum += e.dur; e.tg = tg;
    if (Math.abs(tg.sum - Math.round(tg.sum)) < 1e-4) tg = null;
  }
  // Beam groups: beamable notes within one beat (or one tuplet group), in the same bar.
  const groups = [];
  let cur = null;
  for (const e of evs) {
    const can = !e.rest && beams(e.type) > 0;
    const win = e.tg ? e.tg : Math.floor((e.inBar + EPS) / beat);
    if (!can || !cur || cur.measure !== e.measure || cur.win !== win) {
      if (cur && cur.events.length > 1) groups.push(cur);
      cur = can ? {events: [e], measure: e.measure, win} : null;
    } else cur.events.push(e);
  }
  if (cur && cur.events.length > 1) groups.push(cur);
  for (const g of groups) for (const e of g.events) e.beam = g;

  // ───── vertical layout ─────
  const MARGIN_TOP = line ? 5 * SP : 5.5 * SP, MARGIN_BOTTOM = line ? 3.5 * SP : 5.5 * SP, GAP = 7 * SP;
  const staffH = grand ? 8 * SP + GAP : 4 * SP;
  const systemH = MARGIN_TOP + staffH + MARGIN_BOTTOM;
  const hasLabels = evs.some(e => e.label);
  const labelH = hasLabels ? 2.6 * SP : 0;

  // ───── horizontal layout ─────
  const keySteps = key > 0 ? SHARPS.slice(0, key) : FLATS.slice(0, -key);
  const left = (grand ? 2.6 : 1) * SP;
  const clefW = clef ? (line ? 2.8 : 3.6) * SP : .6 * SP;
  const keyW = keySteps.length ? keySteps.length * SP + .6 * SP : 0;
  const timeDigits = time ? Math.max(String(time[0]).length, String(time[1]).length) : 0;
  const timeW = time && showTime ? timeDigits * 1.65 * SP + 1.2 * SP : 0;
  const width0 = dur => SP * (1.7 + 2.3 * Math.pow(dur, .62)) * spacing;
  const lines = [];
  const per = perLine > 0 ? perLine : measures.length || 1;
  for (let i = 0; i < Math.max(1, measures.length); i += per) lines.push(measures.slice(i, i + per).map((_, j) => i + j));

  // Natural x positions per system; bars[mi] = x of the barline ending measure mi.
  const bars = {};
  const sys = lines.map((mis, li) => {
    let x = left + clefW + keyW + (li === 0 ? timeW : 0) + .4 * SP;
    const xs = [];
    for (const mi of mis) {
      x += 1.1 * SP;
      for (const e of evs.filter(v => v.measure === mi)) {
        const accs = (e.pitches || []).filter(p => p.alter).length;
        const pre = accs ? .4 * SP + Math.min(2, accs) * .9 * SP : 0;
        x += pre;
        e.x = x; e.line = li;
        x += width0(e.dur) + (e.dots ? .6 * SP : 0);
        xs.push(e);
      }
      x += .3 * SP;
      bars[mi] = x;
      x += .2 * SP;
    }
    return {width: x + (final ? .8 * SP : .2 * SP), events: xs};
  });
  let width = Math.max(minWidth, ...sys.map(s => s.width));
  // Justify every system to the widest one (only the space after the prefix stretches).
  sys.forEach((s, li) => {
    const startX = left + clefW + keyW + (li === 0 ? timeW : 0) + .4 * SP;
    const k = (width - startX - (final ? .8 : .2) * SP) / (s.width - startX - (final ? .8 : .2) * SP);
    if (!Number.isFinite(k) || k <= 1.001) return;
    for (const e of s.events) e.x = startX + (e.x - startX) * k;
    for (const mi of lines[li]) bars[mi] = startX + (bars[mi] - startX) * k;
  });
  const height = lines.length * (systemH + labelH);

  const out = [];
  const staffBottom = (li, c) => li * (systemH + labelH) + MARGIN_TOP + (c === 'bass' ? staffH : 4 * SP);
  const posY = (li, c, pos) => staffBottom(li, c) - pos * SP / 2;

  // ───── staves, clefs, signatures ─────
  lines.forEach((mis, li) => {
    for (const c of clefs) {
      const b = staffBottom(li, c);
      if (c === 'line') out.push(hline(left, width - .4 * SP, b - 2 * SP, LINE, 'eg-line'));
      else for (let i = 0; i < 5; i++) out.push(hline(left, width - .4 * SP, b - i * SP, LINE, 'eg-line'));
      const cx = left + .9 * SP;
      if (clef && c === 'line') { out.push(rect(cx, b - 3 * SP, .45 * SP, 2 * SP, 'eg-clef'), rect(cx + .9 * SP, b - 3 * SP, .45 * SP, 2 * SP, 'eg-clef')); }
      else if (clef) out.push(glyph(c === 'treble' ? 'gClef' : 'fClef', cx, b - (c === 'treble' ? 2 : 6) * SP / 2, 'eg-clef'));
      if (c !== 'line') keySteps.forEach((step, i) => {
        const pos = (key > 0 ? SHARP_POS : FLAT_POS)[step] - (c === 'bass' ? 2 : 0);
        out.push(glyph(key > 0 ? 'sharp' : 'flat', left + clefW + .2 * SP + i * SP, b - pos * SP / 2, 'eg-keysig'));
      });
      if (time && showTime && li === 0) {
        const tx = left + clefW + keyW + .3 * SP;
        const digits = (n, pos) => {
          const s = String(n), w = 1.6 * SP;
          const x0 = tx + (timeDigits - s.length) * w / 2;
          return [...s].map((d, i) => glyph('t' + d, x0 + i * w, b - pos * SP / 2, 'eg-time')).join('');
        };
        out.push(digits(time[0], 6), digits(time[1], 2));
      }
    }
    // System line (and brace) at the left; barlines.
    const top = staffBottom(li, clefs[0]) - (line ? 3 : 4) * SP, bottom = staffBottom(li, clefs.at(-1)) - (line ? 1 : 0) * SP;
    if (grand || !line) out.push(rect(left - LINE / 2, top, LINE * 1.4, bottom - top, 'eg-line'));
    if (grand) out.push(brace(left - 1.9 * SP, top, bottom));
    if (barlines) mis.forEach(mi => {
      const x = bars[mi];
      const last = mi === measures.length - 1 && final;
      if (last) out.push(rect(x - 1.1 * SP, top, LINE * 1.2, bottom - top, 'eg-bar'), rect(x - .55 * SP, top, .5 * SP, bottom - top, 'eg-bar'));
      else out.push(rect(x - .3 * SP, top, LINE * 1.2, bottom - top, 'eg-bar'));
    });
  });

  // ───── notes ─────
  const alters = {};
  keySteps.forEach(s => (alters[s] = key > 0 ? 1 : -1));
  let shownBar = -1, shown = {};
  const info = [];
  const tiesFrom = new Map();
  for (const e of evs) {
    if (e.measure !== shownBar) { shown = {}; shownBar = e.measure; }
    const parts = [];
    const li = e.line;
    // Split the pitches over the staves.
    const byClef = {};
    if (!e.rest) for (const p of e.pitches || [{step: 'B', alter: 0, octave: 4}]) {
      const c = line ? 'line' : grand ? (p.clef || (midi(p) >= 60 ? 'treble' : 'bass')) : clefs[0];
      (byClef[c] ||= []).push(p);
    }
    const headKind = e.type === 'whole' ? 'whole' : e.type === 'half' ? 'half' : 'black';
    const hw = HEAD[headKind];
    let y0 = Infinity, y1 = -Infinity;
    if (e.rest) {
      for (const c of clefs) {
        const whole = e.type === 'whole' && measures[e.measure].length === 1;
        const x = whole ? (barStart(e.measure) + bars[e.measure]) / 2 - .6 * SP : e.x;
        const name = {whole: 'restWhole', half: 'restHalf', quarter: 'restQuarter', eighth: 'rest8th', '16th': 'rest16th'}[e.type];
        const pos = e.type === 'whole' ? 6 : 4;
        parts.push(glyph(name, x, posY(li, c, pos), 'eg-rest'));
        if (e.dots) parts.push(`<circle class="eg-dot" cx="${f(x + 1.6 * SP)}" cy="${f(posY(li, c, 5))}" r="${f(.2 * SP)}"/>`);
        y0 = Math.min(y0, posY(li, c, 8)); y1 = Math.max(y1, posY(li, c, 0));
      }
    }
    for (const [c, ps] of Object.entries(byClef)) {
      const b = c === 'line' ? null : c;
      const notes = ps.map(p => ({p, pos: c === 'line' ? 4 : diatonic(p) - BOTTOM[c]})).sort((a, z) => a.pos - z.pos);
      const lo = notes[0].pos, hi = notes.at(-1).pos;
      const g = e.beam;
      let up;
      if (c === 'line') up = true;
      else if (g) up = (g.dir ||= dirOf(g, c)) === 'up';
      else up = (4 - lo) >= (hi - 4);
      // Seconds in a chord: shift one head to the other side of the stem.
      notes.forEach(n => { n.dx = 0; });
      for (let i = 1; i < notes.length; i++) {
        if (notes[i].pos - notes[i - 1].pos === 1 && !notes[i - 1].dx) {
          if (up) notes[i].dx = hw - STEM; else notes[i - 1].dx = -(hw - STEM);
        }
      }
      const yLine = pos => posY(li, b || 'line', pos);
      // Ledger lines.
      if (c !== 'line') {
        const lx1 = e.x - .45 * SP + Math.min(0, ...notes.map(n => n.dx)), lx2 = e.x + hw + .45 * SP + Math.max(0, ...notes.map(n => n.dx));
        for (let pos = -2; pos >= lo; pos -= 2) parts.push(hline(lx1, lx2, yLine(pos), LEDGER, 'eg-ledger'));
        for (let pos = 10; pos <= hi; pos += 2) parts.push(hline(lx1, lx2, yLine(pos), LEDGER, 'eg-ledger'));
      }
      // Accidentals (relative to the key signature and earlier notes in the bar).
      let accX = e.x + Math.min(0, ...notes.map(n => n.dx)) - .25 * SP, prevPos = null;
      for (const n of [...notes].reverse()) {
        if (c === 'line') break;
        const k = n.p.step + n.p.octave;
        const now = shown[k] ?? alters[n.p.step] ?? 0;
        if (now === n.p.alter) continue;
        shown[k] = n.p.alter;
        if (prevPos != null && prevPos - n.pos < 6) accX -= ACC_W[n.p.alter] + .15 * SP;
        else accX = e.x + Math.min(0, ...notes.map(nn => nn.dx)) - .25 * SP - ACC_W[n.p.alter];
        parts.push(glyph(ACC_GLYPH[n.p.alter], accX, yLine(n.pos), 'eg-acc'));
        prevPos = n.pos;
      }
      // Heads and dots.
      for (const n of notes) {
        parts.push(glyph(headKind === 'whole' ? 'noteWhole' : headKind === 'half' ? 'noteHalf' : 'noteBlack', e.x + n.dx, yLine(n.pos), 'eg-head'));
        if (e.dots) {
          const dp = n.pos % 2 === 0 ? n.pos + 1 : n.pos;
          parts.push(`<circle class="eg-dot" cx="${f(e.x + hw + .55 * SP + Math.max(0, ...notes.map(m => m.dx)))}" cy="${f(yLine(dp))}" r="${f(.2 * SP)}"/>`);
        }
        if (e.tie) tiesFrom.set(`${e.i}:${midi(n.p)}`, {x: e.x + n.dx + hw, y: yLine(n.pos), up, c});
        const prevTie = tiesFrom.get(`${e.i - 1}:${midi(n.p)}`);
        if (prevTie) parts.push(tie(prevTie.x, e.x + n.dx, prevTie.y, prevTie.up));
        y0 = Math.min(y0, yLine(Math.max(hi, 8))); y1 = Math.max(y1, yLine(Math.min(lo, 0)));
      }
      // Stem, flag (beams are drawn per group below).
      if (headKind !== 'whole') {
        const sx = up ? e.x + hw - STEM / 2 : e.x + STEM / 2;
        const yTop = yLine(hi), yBot = yLine(lo);
        let end = up ? Math.min(yTop - 3.5 * SP, yLine(4)) : Math.max(yBot + 3.5 * SP, yLine(4));
        if (c === 'line') end = yLine(4) - 3.5 * SP;
        const stem = {x: sx, from: up ? yBot : yTop, end, up, e, c};
        if (g) (g.stems ||= []).push(stem);
        else {
          parts.push(rect(sx - STEM / 2, Math.min(stem.from, end), STEM, Math.abs(end - stem.from), 'eg-stem'));
          const nb = beams(e.type);
          if (nb) parts.push(glyph(up ? (nb === 2 ? 'flag16thUp' : 'flag8thUp') : (nb === 2 ? 'flag16thDown' : 'flag8thDown'), sx - STEM / 2, end, 'eg-flag'));
          e.stemEnd = end; e.up = up;
        }
      } else { e.stemEnd = up ? yLine(hi) - 2 * SP : yLine(lo) + 2 * SP; e.up = up; }
      e.dir = up ? 'up' : 'down';
    }
    if (e.label) parts.push(`<text class="eg-label" x="${f(e.x + hw / 2)}" y="${f(staffBottom(li, clefs.at(-1)) + (line ? -1 : 0) * SP + MARGIN_BOTTOM - .6 * SP + labelH * .6)}" text-anchor="middle">${esc(e.label)}</text>`);
    if (e.above) parts.push(`<text class="eg-above" x="${f(e.x + hw / 2)}" y="${f(staffBottom(li, clefs[0]) - (line ? 3 : 4) * SP - 3.6 * SP)}" text-anchor="middle">${esc(e.above)}</text>`);
    out.push(`<g class="eg-ev${e.cls ? ' ' + esc(e.cls) : ''}" data-i="${e.i}">${parts.join('')}</g>`);
    info.push({i: e.i, measure: e.measure, start: e.start, dur: e.dur, rest: !!e.rest, x: e.x + hw / 2, line: li,
      y0: staffBottom(li, clefs[0]) - (line ? 3 : 4) * SP - 1.5 * SP, y1: staffBottom(li, clefs.at(-1)) + (line ? -1 : 0) * SP + 1.5 * SP});
  }
  function barStart(mi) {
    const li = evs.find(v => v.measure === mi)?.line ?? 0;
    const prev = lines[li].indexOf(mi) > 0 ? bars[mi - 1] : left + clefW + keyW + (li === 0 ? timeW : 0);
    return prev;
  }

  // ───── beams ─────
  for (const g of groups) {
    const st = g.stems || [];
    if (st.length < 2) continue;
    const up = st[0].up;
    const first = st[0], last = st.at(-1);
    let slope = (last.end - first.end) / Math.max(1, last.x - first.x);
    const maxRise = SP;
    if (Math.abs(slope * (last.x - first.x)) > maxRise) slope = Math.sign(slope) * maxRise / (last.x - first.x);
    if (first.c === 'line') slope = 0;
    let base = first.end;
    // Every stem at least 2.8 spaces long.
    for (const s of st) {
      const y = base + slope * (s.x - first.x);
      const need = up ? s.from - 2.8 * SP : s.from + 2.8 * SP;
      if (up && y > need) base -= y - need;
      if (!up && y < need) base += need - y;
    }
    const yAt = x => base + slope * (x - first.x);
    const parts = [];
    for (const s of st) {
      const y = yAt(s.x);
      parts.push(rect(s.x - STEM / 2, Math.min(s.from, y), STEM, Math.abs(y - s.from), 'eg-stem'));
      s.e.stemEnd = y; s.e.up = up;
    }
    const beamAt = (x1, x2, level) => {
      const off = (up ? 1 : -1) * level * .75 * SP;
      const ya = yAt(x1) + off, yb = yAt(x2) + off, t = up ? BEAM : -BEAM;
      return `<path class="eg-beam" d="M${f(x1)} ${f(ya)} L${f(x2)} ${f(yb)} L${f(x2)} ${f(yb + t)} L${f(x1)} ${f(ya + t)}Z"/>`;
    };
    parts.push(beamAt(first.x - STEM / 2, last.x + STEM / 2, 0));
    // Secondary beams for semiquavers (stubs for a lone one).
    for (let i = 0; i < st.length; i++) {
      if (beams(st[i].e.type) < 2) continue;
      if (i + 1 < st.length && beams(st[i + 1].e.type) >= 2) { parts.push(beamAt(st[i].x - STEM / 2, st[i + 1].x + STEM / 2, 1)); continue; }
      if (i > 0 && beams(st[i - 1].e.type) >= 2) continue;
      const toward = i > 0 ? -1 : 1;
      const x2 = st[i].x + toward * 1.2 * SP;
      parts.push(beamAt(Math.min(st[i].x, x2) - (toward < 0 ? 0 : STEM / 2), Math.max(st[i].x, x2) + (toward < 0 ? STEM / 2 : 0), 1));
    }
    out.push(`<g class="eg-beams">${parts.join('')}</g>`);
  }

  // ───── tuplet numbers (and brackets when not one beam) ─────
  const seen = new Set();
  for (const e of evs) {
    if (!e.tg || seen.has(e.tg)) continue;
    seen.add(e.tg);
    const es = e.tg.events;
    const li = es[0].line;
    const x1 = es[0].x, x2 = es.at(-1).x + HEAD.black;
    const beamed = es.every(v => v.beam && v.beam === es[0].beam);
    const upAll = es.every(v => v.rest || v.up !== false);
    const staffTop = staffBottom(li, clefs[0]) - (line ? 2 : 4) * SP;
    const tops = es.filter(v => !v.rest && v.up).map(v => v.stemEnd);
    const y = Math.min(staffTop - .8 * SP, ...(upAll ? tops : []).map(t => t - .8 * SP));
    const cx = (x1 + x2) / 2;
    const parts = [glyph('tuplet3', cx - .5 * SP, y, 'eg-tuplet')];
    if (!beamed) {
      const yb = y - .6 * SP;
      parts.push(`<path class="eg-bracket" d="M${f(x1)} ${f(yb + .8 * SP)} L${f(x1)} ${f(yb)} L${f(cx - .9 * SP)} ${f(yb)} M${f(cx + .9 * SP)} ${f(yb)} L${f(x2)} ${f(yb)} L${f(x2)} ${f(yb + .8 * SP)}"/>`);
    }
    out.push(`<g class="eg-tuplets">${parts.join('')}</g>`);
  }

  const svg = `<svg class="eg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(width)} ${f(height)}" role="img">${out.join('')}</svg>`;
  return {svg, width, height, events: info};
}

function dirOf(g, c) {
  if (c === 'line') return 'up';
  const ps = g.events.flatMap(e => (e.pitches || []).map(p => diatonic(p) - BOTTOM[c === 'bass' ? 'bass' : 'treble']));
  const avg = ps.reduce((a, b) => a + b, 0) / Math.max(1, ps.length);
  return avg < 4 ? 'up' : 'down';
}

function tie(x1, x2, y, up) {
  // Below the heads when stems are up, above when down: a thin crescent.
  const s = up ? 1 : -1, ya = y + s * .55 * SP, mid = (x1 + x2) / 2;
  const h1 = s * Math.min(1.6 * SP, .25 * (x2 - x1) + .5 * SP), h2 = h1 - s * .28 * SP;
  return `<path class="eg-tie" d="M${f(x1 + .1 * SP)} ${f(ya)} Q${f(mid)} ${f(ya + h1)} ${f(x2 - .1 * SP)} ${f(ya)} Q${f(mid)} ${f(ya + h2)} ${f(x1 + .1 * SP)} ${f(ya)}Z"/>`;
}

function brace(x, y1, y2) {
  const h = y2 - y1, w = 1.25 * SP, m = y1 + h / 2;
  const half = s => {
    const Y = t => f(m - s * (h / 2) * t);
    return `M${f(x + w)} ${Y(1)} C${f(x + .05 * w)} ${Y(.85)} ${f(x + .95 * w)} ${Y(.2)} ${f(x)} ${Y(0)} `
      + `C${f(x + 1.55 * w)} ${Y(.18)} ${f(x + .55 * w)} ${Y(.85)} ${f(x + w)} ${Y(1)}Z`;
  };
  return `<path class="eg-brace" d="${half(1)} ${half(-1)}"/>`;
}
