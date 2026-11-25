// Making a student's own MusicXML playable (docs/ROADMAP.md Phase 7: "better handling of user
// MusicXML"). Used by the import dialog before a score is saved, and by loadSong() for any
// multi-part MusicXML it is given. Needs a DOMParser (the browser's, or jsdom in tests).
//
//   prepareMusicXml(text, {fileName}) → {xml, changed, title, composer, warnings: [..], info}
//     info = {parts: [{id, name, staves, notes}], kept: ['P1'], merged: bool, pickup: bool}
//     Throws Error(message) — a sentence for the import dialog — when the file can't be used.
//   unzipMxl(bytes) → Promise<string>  the score inside a compressed .mxl
//
// What it does:
//  • Parts. One part is left alone. With several, the piano is kept: a part named piano /
//    keyboard / harpsichord… (or with a General MIDI piano sound, or two staves); the others are
//    left out with a warning. A piano written as two one-staff parts ("Right hand" / "Left hand",
//    or a treble part over a bass part) is merged into one two-staff part. With no piano at all
//    every part is kept, the top staff playing as the right hand, with a warning. Percussion
//    and empty parts are dropped.
//  • Pickup bars. A first bar shorter than its time signature is marked implicit="yes", so it is
//    counted and labelled as a pickup.
//  • Titles. No <work-title>: the movement title, then a credit marked as the title, then the
//    largest credit text, then the file name.
//  • Repeats and voltas need nothing here: Verovio writes them out (song.js, expandAlways).

const PIANO_RE = /\b(piano|pianoforte|klavier|clavier|keyboard|keys|harpsichord|cembalo|clavecin|clavichord|fortepiano|celesta|organ|pno|pf|kl)\b/i;
const HAND_RE = /\b(right|left|r\.?\s*h|l\.?\s*h|rh|lh|treble|bass|upper|lower|primo|secondo|m\.?d|m\.?s)\b/i;

const kids = (el, name) => [...el.children].filter(c => c.localName === name);
const kid = (el, name) => [...el.children].find(c => c.localName === name) || null;
const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const num = (el, name, fallback = 0) => { const v = parseFloat(text(kid(el, name))); return Number.isFinite(v) ? v : fallback; };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// <name><child>text</child>…</name> in the score's own document.
function make(doc, name, children = []) {
  const el = doc.createElement(name);
  for (const [n, t] of children) { const c = doc.createElement(n); c.textContent = String(t); el.append(c); }
  return el;
}
const lcm = (a, b) => (a && b ? (a / gcd(a, b)) * b : a || b);

/** Text of the first <score-partwise> / <score-timewise> / <mei> root, or why it isn't one. */
function parse(textIn) {
  const clean = String(textIn).replace(/^\uFEFF/, '').replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/i, '');
  const doc = new DOMParser().parseFromString(clean, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    const line = text(err).split(/(?<=[.:])\s/)[0].slice(0, 140);
    throw Error(`This file isn’t valid XML, so it can’t be read as MusicXML${line ? ` (${line})` : ''}. Export it again from your notation program.`);
  }
  return doc;
}

// ───────── parts ─────────

function partInfo(doc) {
  const list = doc.getElementsByTagName('part-list')[0];
  const meta = new Map();
  for (const sp of list ? kids(list, 'score-part') : []) {
    const id = sp.getAttribute('id');
    const inst = sp.getElementsByTagName('instrument-name')[0];
    const program = parseInt(text(sp.getElementsByTagName('midi-program')[0]), 10);
    meta.set(id, {name: text(kid(sp, 'part-name')) || text(kid(sp, 'part-abbreviation')) || text(inst), instrument: text(inst), program: Number.isFinite(program) ? program : null, el: sp});
  }
  return kids(doc.documentElement, 'part').map((part, i) => {
    const id = part.getAttribute('id') || `P${i + 1}`;
    const m = meta.get(id) || {name: '', instrument: '', program: null, el: null};
    let staves = 1;
    for (const s of part.getElementsByTagName('staves')) staves = Math.max(staves, parseInt(text(s), 10) || 1);
    let pitched = 0, unpitched = 0;
    for (const n of part.getElementsByTagName('note')) {
      if (kid(n, 'pitch')) pitched++;
      else if (kid(n, 'unpitched')) unpitched++;
    }
    const firstClef = part.getElementsByTagName('clef')[0];
    const clef = firstClef ? text(kid(firstClef, 'sign')) : 'G';
    const label = m.name || m.instrument || `Part ${i + 1}`;
    const piano = PIANO_RE.test(`${m.name} ${m.instrument}`) || (m.program != null && m.program >= 1 && m.program <= 8);
    const generic = HAND_RE.test(m.name) || /^(part|staff|stave|track|music|voice|p)?\s*\d*$/i.test(label);
    return {id, name: label, staves, notes: pitched, unpitched, clef, piano, hand: HAND_RE.test(m.name), generic, el: part, listEl: m.el};
  });
}

const names = parts => parts.map(p => `“${p.name}”`).join(', ');

function dropParts(doc, parts) {
  for (const p of parts) { p.el.remove(); p.listEl?.remove(); }
  // Part groups that no longer hold anything are harmless, but tidy the brackets around them.
  const list = doc.getElementsByTagName('part-list')[0];
  if (list && !kids(list, 'score-part').length) list.remove();
}

// ───────── merging a two-part piano into one grand-staff part ─────────

// Every duration in a part rescaled to `to` divisions per quarter.
function rescale(part, to) {
  let div = 1;
  for (const m of kids(part, 'measure')) {
    for (const el of m.children) {
      if (el.localName === 'attributes') {
        const d = kid(el, 'divisions');
        if (d) { div = parseFloat(text(d)) || div; d.textContent = String(to); }
      }
      const dur = el.localName === 'note' || el.localName === 'backup' || el.localName === 'forward' ? kid(el, 'duration') : null;
      if (dur) dur.textContent = String(Math.round(parseFloat(text(dur)) * to / div));
    }
  }
}
function divisionsOf(part) {
  const out = new Set();
  for (const d of part.getElementsByTagName('divisions')) { const v = parseFloat(text(d)); if (v > 0 && Number.isInteger(v)) out.add(v); }
  return out.size ? [...out] : [1];
}

// Where the cursor ends after a measure's contents (in divisions).
function measureCursor(m) {
  let pos = 0, max = 0;
  for (const el of m.children) {
    const dur = parseFloat(text(kid(el, 'duration'))) || 0;
    if (el.localName === 'note') { if (!kid(el, 'chord') && !kid(el, 'grace') && !kid(el, 'cue')) pos += dur; }
    else if (el.localName === 'backup') pos -= dur;
    else if (el.localName === 'forward') pos += dur;
    max = Math.max(max, pos);
  }
  return {pos, max};
}

// <staff> goes after type / dot / accidental / time-modification / stem / notehead and before
// beam / notations / lyric / play (the MusicXML element order).
const AFTER_STAFF = ['beam', 'notations', 'lyric', 'play', 'listen'];
function setChild(el, name, value, before = AFTER_STAFF) {
  let c = kid(el, name);
  if (!c) {
    c = el.ownerDocument.createElement(name);
    const at = [...el.children].find(x => before.includes(x.localName));
    el.insertBefore(c, at || null);
  }
  c.textContent = value;
  return c;
}
const setStaff = (el, n) => setChild(el, 'staff', String(n), el.localName === 'direction' ? ['sound', 'listening'] : el.localName === 'forward' ? [] : AFTER_STAFF);
function setVoice(note, offset) {
  const v = kid(note, 'voice');
  const n = (parseInt(text(v), 10) || 1) + offset;
  if (v) v.textContent = String(n);
  else setChild(note, 'voice', String(n), ['type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', ...AFTER_STAFF]);
}

/** Merges part `low` into part `high` as its second staff. → false (and nothing changed) when the bars don't line up. */
function mergeInto(doc, high, low) {
  const mh = kids(high.el, 'measure'), ml = kids(low.el, 'measure');
  if (!mh.length || mh.length !== ml.length) return false;
  const L = [...divisionsOf(high.el), ...divisionsOf(low.el)].reduce(lcm, 1);
  rescale(high.el, L);
  rescale(low.el, L);
  mh.forEach((a, i) => {
    const b = ml[i];
    // The upper part's own music: staff 1.
    for (const el of a.children) {
      if (el.localName === 'note' || el.localName === 'direction' || el.localName === 'forward') { if (!kid(el, 'staff')) setStaff(el, 1); }
      if (el.localName === 'attributes') for (const c of kids(el, 'clef')) c.setAttribute('number', '1');
    }
    if (i === 0) {
      // Two staves from the first bar, with the lower part's clef as staff 2.
      let attrs = kid(a, 'attributes');
      if (!attrs) { attrs = doc.createElement('attributes'); a.insertBefore(attrs, a.firstElementChild); }
      const after = [...attrs.children].find(c => ['part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'directive', 'measure-style'].includes(c.localName));
      const staves = kid(attrs, 'staves') || attrs.insertBefore(doc.createElement('staves'), after || null);
      staves.textContent = '2';
      const lowClef = b.getElementsByTagName('clef')[0];
      const clef = lowClef ? lowClef.cloneNode(true) : make(doc, 'clef', [['sign', 'F'], ['line', 4]]);
      clef.setAttribute('number', '2');
      const clefs = kids(attrs, 'clef');
      attrs.insertBefore(clef, clefs.at(-1)?.nextSibling || [...attrs.children].find(c => ['staff-details', 'transpose', 'directive', 'measure-style'].includes(c.localName)) || null);
      if (!clefs.length) {
        const top = make(doc, 'clef', high.clef === 'F' ? [['sign', 'F'], ['line', 4]] : [['sign', 'G'], ['line', 2]]);
        top.setAttribute('number', '1');
        attrs.insertBefore(top, clef);
      }
    }
    const {pos} = measureCursor(a);
    if (pos > 0) {
      a.append(make(doc, 'backup', [['duration', pos]]));
    }
    for (const el of [...b.children]) {
      const name = el.localName;
      if (name === 'note') { setStaff(el, 2); setVoice(el, 4); a.append(el); }
      else if (name === 'backup') a.append(el);
      else if (name === 'forward') { setStaff(el, 2); a.append(el); }
      else if (name === 'direction') { setStaff(el, 2); a.append(el); }
      else if (name === 'attributes') {
        if (i === 0) continue; // its clef went into the first bar's attributes
        for (const c of [...el.children]) if (c.localName !== 'clef') c.remove();
        for (const c of kids(el, 'clef')) c.setAttribute('number', '2');
        if (el.children.length) a.append(el);
      }
      // barline, print, harmony, sound…: the upper part's are kept
    }
  });
  low.el.remove();
  low.listEl?.remove();
  const name = high.listEl && kid(high.listEl, 'part-name');
  if (name && !PIANO_RE.test(text(name))) name.textContent = 'Piano';
  return true;
}

// ───────── pickup bars ─────────

function markPickup(doc) {
  const part = kids(doc.documentElement, 'part')[0];
  const measures = part ? kids(part, 'measure') : [];
  if (measures.length < 2) return false;
  const first = measures[0];
  if (first.getAttribute('implicit') === 'yes') return true;
  const attrs = kid(first, 'attributes');
  const time = attrs && kid(attrs, 'time');
  const div = attrs ? num(attrs, 'divisions', 0) : 0;
  if (!time || !div) return false;
  const beats = String(text(kid(time, 'beats'))).split('+').reduce((s, x) => s + (parseFloat(x) || 0), 0), type = num(time, 'beat-type', 4);
  const full = beats * (4 / type) * div;
  const {max} = measureCursor(first);
  // Every part's first bar must be short (a full bar in another part means it isn't a pickup).
  const allShort = kids(doc.documentElement, 'part').every(p => { const m = kids(p, 'measure')[0]; return !m || measureCursor(m).max < full - 1e-6; });
  if (!(max > 0 && max < full - 1e-6) || !allShort) return false;
  for (const p of kids(doc.documentElement, 'part')) kids(p, 'measure')[0]?.setAttribute('implicit', 'yes');
  return true;
}

// ───────── titles ─────────

export function titleAndComposer(doc, fileName = '') {
  const root = doc.documentElement;
  const first = sel => text(root.getElementsByTagName(sel)[0]);
  const work = root.getElementsByTagName('work')[0];
  const credits = [...root.getElementsByTagName('credit')];
  const creditOf = type => credits.find(c => kids(c, 'credit-type').some(t => text(t) === type));
  let title = text(work && work.getElementsByTagName('work-title')[0]) || first('movement-title') || text(creditOf('title')?.getElementsByTagName('credit-words')[0]);
  if (!title) {
    // The largest credit on the first page is usually the title.
    const words = credits.flatMap(c => [...c.getElementsByTagName('credit-words')]).filter(w => text(w).length > 1);
    const size = w => parseFloat(w.getAttribute('font-size')) || 0;
    title = text(words.sort((a, b) => size(b) - size(a))[0]);
  }
  if (!title && fileName) title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const creator = [...root.getElementsByTagName('creator')].find(c => c.getAttribute('type') === 'composer');
  const composer = text(creator) || text(creditOf('composer')?.getElementsByTagName('credit-words')[0]);
  return {title: title || 'Untitled score', composer};
}

// ───────── the whole preparation ─────────

export function prepareMusicXml(input, {fileName = ''} = {}) {
  const doc = parse(input);
  const rootName = doc.documentElement.localName;
  if (rootName === 'mei') return {xml: input, changed: false, ...meiMeta(doc, fileName), warnings: [], info: {parts: [], kept: [], merged: false, pickup: false}};
  if (rootName === 'score-timewise') throw Error('This is a “timewise” MusicXML file, which can’t be played here. Export it again as ordinary (partwise) MusicXML — MuseScore, Finale, Sibelius and Dorico all do by default.');
  if (rootName !== 'score-partwise') throw Error('This file doesn’t look like MusicXML (no <score-partwise>). Choose a .musicxml, .xml or .mxl file exported from a notation program.');
  const warnings = [];
  let changed = false, merged = false;
  let parts = partInfo(doc);
  const info = {parts: parts.map(({id, name, staves, notes}) => ({id, name, staves, notes})), kept: [], merged: false, pickup: false};
  if (!parts.length) throw Error('This MusicXML file has no parts, so there is nothing to play.');
  const playable = parts.filter(p => p.notes > 0);
  if (!playable.length) throw Error(parts.some(p => p.unpitched) ? 'This score only has percussion (unpitched) parts, so there are no piano notes to play.' : 'This score has no notes in it — only rests or empty bars.');
  const silent = parts.filter(p => !p.notes);
  if (silent.length && playable.length) {
    dropParts(doc, silent);
    changed = true;
    if (silent.some(p => p.unpitched)) warnings.push(`Left out the percussion: ${names(silent.filter(p => p.unpitched))}.`);
  }
  parts = playable;
  if (parts.length > 1) {
    const pianos = parts.filter(p => p.piano);
    const grand = pianos.filter(p => p.staves >= 2);
    const singles = parts.filter(p => p.staves === 1);
    // A piano split into two one-staff parts: both called piano / hands, or (with no piano) a treble part over a bass part.
    const pair = (() => {
      const named = singles.filter(p => p.piano || p.hand);
      if (!grand.length && named.length === 2) return named;
      if (!pianos.length && parts.length === 2 && singles.length === 2 && parts[0].clef !== 'F' && parts[1].clef === 'F' && parts.every(p => p.generic)) return parts;
      return null;
    })();
    if (grand.length) {
      const keep = grand[0];
      const others = parts.filter(p => p !== keep);
      dropParts(doc, others);
      changed = true;
      info.kept = [keep.id];
      warnings.push(`Kept the piano part (“${keep.name}”) and left out ${others.length === 1 ? 'the other part' : `${others.length} other parts`}: ${names(others)}.`);
    } else if (pair && mergeInto(doc, pair[0], pair[1])) {
      merged = true; changed = true;
      const others = parts.filter(p => !pair.includes(p));
      if (others.length) { dropParts(doc, others); warnings.push(`Joined ${names(pair)} as the piano’s two staves and left out ${names(others)}.`); }
      else warnings.push(`Joined ${names(pair)} into one piano part (right hand above, left hand below).`);
      info.kept = [pair[0].id];
    } else if (pianos.length) {
      const keep = pianos[0];
      const others = parts.filter(p => p !== keep);
      dropParts(doc, others);
      changed = true;
      info.kept = [keep.id];
      warnings.push(`Kept the piano part (“${keep.name}”) and left out ${names(others)}.`);
    } else {
      info.kept = parts.map(p => p.id);
      warnings.push(`This score has ${parts.length} parts (${names(parts)}) and none is marked as piano: all are kept, the top staff plays as the right hand and the rest as the left.`);
    }
  } else info.kept = [parts[0].id];
  info.merged = merged;
  const hadImplicit = kids(doc.documentElement, 'part')[0]?.getElementsByTagName('measure')[0]?.getAttribute('implicit') === 'yes';
  info.pickup = markPickup(doc);
  if (info.pickup && !hadImplicit) changed = true;
  const meta = titleAndComposer(doc, fileName);
  return {xml: changed ? serialize(doc) : input, changed, ...meta, warnings, info};
}

function meiMeta(doc, fileName) {
  const t = sel => text(doc.getElementsByTagName(sel)[0]);
  return {title: t('title') || fileName.replace(/\.[^.]+$/, ''), composer: t('composer')};
}

function serialize(doc) {
  const body = new XMLSerializer().serializeToString(doc.documentElement);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

// ───────── compressed MusicXML (.mxl) ─────────

/** The score inside a .mxl (zip): the rootfile named in META-INF/container.xml, else the first .musicxml / .xml. */
export async function unzipMxl(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('This .mxl file is damaged (not a complete zip archive).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= b.length && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    entries.set(name, {method, size, local});
  }
  const read = async name => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const raw = b.subarray(start, start + e.size);
    if (e.method === 0) return dec.decode(raw);
    if (e.method === 8 && typeof DecompressionStream === 'function') {
      const stream = new Response(raw).body.pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    }
    throw Error('This .mxl file uses a compression this browser can’t open.');
  };
  const container = await read('META-INF/container.xml');
  const root = container?.match(/full-path="([^"]+)"/)?.[1];
  const name = (root && entries.has(root)) ? root : [...entries.keys()].find(k => !k.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(k));
  if (!name) throw Error('This .mxl file has no score inside it.');
  return read(name);
}
