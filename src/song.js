import {createToolkit} from './verovio.js';
import {buildScore} from './score-core.mjs';
import {prepareMusicXml} from './musicxml.mjs';

// Turns a score (MusicXML, compressed MXL or MEI) into a playable song:
// measures and note events with times in quarter notes, plus the whole
// piece rendered as one long, unbroken system for the sheet view.
//
//   loadSong({url})        fetch a file (MusicXML / MEI / .mxl)
//   loadSong({data})       MusicXML or MEI text
//   loadSong({mxlBase64})  compressed MusicXML, base64 encoded
//
// One toolkit is shared by every song the player loads. Each load parses,
// times and renders synchronously after its input arrives, so overlapping
// loads never see each other's document.

const OPTIONS = {
  breaks: 'none', scale: 42, pageHeight: 60000, pageWidth: 60000, adjustPageHeight: true, adjustPageWidth: true,
  pageMarginLeft: 30, pageMarginRight: 30, pageMarginTop: 10, pageMarginBottom: 10,
  mnumInterval: 1, svgHtml5: false, svgViewBox: true, svgRemoveXlink: true, header: 'none', footer: 'none',
  // Unfold repeats / endings so the timeline and the drawn score are linear.
  expandAlways: true,
};

let toolkitPromise;
const sharedToolkit = () => toolkitPromise ??= createToolkit();

export async function loadSong(source = {}) {
  if (typeof source === 'string') source = {url: source};
  const [tk, input] = await Promise.all([sharedToolkit(), readSource(source)]);
  // A MusicXML score with several parts: keep the piano (or join a two-part piano), as on import
  // (src/musicxml.mjs). Scores imported before that existed get the same treatment here.
  if (input.text && /<score-partwise[\s>]/.test(input.text.slice(0, 4000)) && (input.text.match(/<score-part[\s>]/g) || []).length > 1) {
    try { input.text = prepareMusicXml(input.text).xml; } catch { /* Verovio reports what's wrong */ }
  }
  tk.setOptions(OPTIONS);
  const ok = input.zip ? tk.loadZipDataBase64(input.zip) : tk.loadData(input.text);
  if (!ok || !tk.getPageCount()) throw Error('Could not read this score. Is it MusicXML, MXL or MEI?');
  // MusicXML (and MXL) imports carry every sounding pitch in the MEI: read them in one pass.
  const fromXml = !!input.zip || /<score-(partwise|timewise)[\s>]/.test(input.text.slice(0, 4000));
  const score = buildScore(fromXml ? withMeiPitches(tk) : tk);
  if (!score.events.length) throw Error('This score has no playable notes');
  const svg = safeSvg(tk.renderToSVG(1));
  const meta = scoreInfo(score.mei);
  return {
    title: meta.title,
    composer: meta.composer,
    tempo: score.tempo, // quarter notes per minute, or null if the score has none
    measures: score.measures,
    events: score.events,
    segments: score.segments,
    marks: score.marks, // {dynamics, hairpins, pedals, slurs} from the score, timed in quarter notes
    noteNames: noteNames(score.mei, score.segments),
    fullSvg: () => svg,
  };
}

// ───────── Fast pitches ─────────
// buildScore() asks Verovio for each note's MIDI pitch, one call per note (≈ 0.2 ms each: half
// the load time of a 150-bar sonata). Verovio's MusicXML import writes every sounding alteration
// (@accid.ges) and octave-line shift (@oct.ges) into its MEI, so for MusicXML / MXL the pitches
// can be read from that MEI in one pass. The toolkit is wrapped, not changed: getMEI() is
// remembered, and getMIDIValuesForElement() answers from the MEI after a spot check of 16
// notes against Verovio agrees (any disagreement, transposition, or an unreadable note → Verovio).
const STEP = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};
const ALTER = {s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0, xs: 3, sx: 3, ts: 3, tf: -3, nf: -1, ns: 1, su: 1, sd: 1, fu: -1, fd: -1};
const attrOf = (attrs, name) => attrs.match(new RegExp(`\\s${name.replace('.', '\\.')}="([^"]*)"`))?.[1];

/** MIDI pitch from a <note>'s attribute text and inner markup (or undefined). */
export function meiNotePitch(attrs, inner = '') {
  const step = STEP[attrOf(attrs, 'pname')];
  const oct = parseInt(attrOf(attrs, 'oct.ges') ?? attrOf(attrs, 'oct'), 10);
  if (step == null || !Number.isFinite(oct)) return undefined;
  let acc = attrOf(attrs, 'accid.ges') ?? attrOf(attrs, 'accid');
  if (acc == null) {
    const tag = inner.match(/<accid\b([^>]*)>/)?.[1];
    if (tag != null) acc = attrOf(tag, 'accid.ges') ?? attrOf(tag, 'accid');
  }
  if (acc != null && !(acc in ALTER)) return undefined;
  return 12 * (oct + 1) + step + (acc ? ALTER[acc] : 0);
}

function withMeiPitches(tk) {
  let mei = null, pitches = null;
  const slow = id => tk.getMIDIValuesForElement(id);
  const build = () => {
    pitches = new Map();
    if (!mei || /\strans\.(semi|diat)="/.test(mei)) return;
    for (const m of mei.matchAll(/<note\b([^>]*?)(?:\/>|>([\s\S]*?)<\/note>)/g)) {
      const id = attrOf(m[1], 'xml:id');
      const p = id && meiNotePitch(m[1], m[2]);
      if (p != null) pitches.set(id, p);
    }
    const ids = [...pitches.keys()];
    const every = Math.max(1, Math.floor(ids.length / 16));
    for (let i = 0; i < ids.length; i += every) if (slow(ids[i]).pitch !== pitches.get(ids[i])) { pitches.clear(); return; }
  };
  return new Proxy(tk, {
    get(target, key) {
      if (key === 'getMEI') return (...a) => { mei = target.getMEI(...a); pitches = null; return mei; };
      if (key === 'getMIDIValuesForElement') return id => {
        if (!pitches) build();
        const p = pitches.get(id);
        return p != null ? {pitch: p} : slow(id);
      };
      const v = target[key];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// Spelled note names for every drawn notehead: the written letter (pname)
// with the accidental implied by the sounding pitch, so B♭ stays B♭ and
// F♯ in G major shows as F♯ even without a printed sharp.
// Map: notehead id -> {name: 'F♯', hollow: true for half/whole notes}.
const NATURAL = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};
const ACCIDENTAL = {'-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪'};
function noteNames(meiText, segments) {
  const pitch = new Map(segments.map(s => [s.id, s.n]));
  const out = new Map();
  const doc = new DOMParser().parseFromString(meiText, 'application/xml');
  for (const el of doc.getElementsByTagName('note')) {
    const id = el.getAttribute('xml:id'), pname = el.getAttribute('pname'), oct = +el.getAttribute('oct');
    if (!id || !pname || !(pname in NATURAL)) continue;
    const midi = pitch.get(id);
    let alter = 0;
    if (Number.isFinite(midi) && Number.isFinite(oct)) {
      alter = midi - ((oct + 1) * 12 + NATURAL[pname]);
      if (Math.abs(alter) > 2) alter = 0; // octave-shifted passages: trust the letter
    }
    const dur = el.getAttribute('dur') ?? el.closest('chord')?.getAttribute('dur');
    out.set(id, {name: pname.toUpperCase() + ACCIDENTAL[alter], hollow: ['1', '2', 'breve', 'long'].includes(dur)});
  }
  return out;
}

async function readSource({url, data, mxlBase64}) {
  if (mxlBase64) return {zip: mxlBase64};
  if (typeof data === 'string') return {text: data};
  if (!url) throw Error('No score to load');
  const res = await fetch(url).catch(() => { throw Error('Could not download the score'); });
  if (!res.ok) throw Error(res.status === 404 ? 'Score file is missing' : `Could not download the score (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Compressed MusicXML is a zip file ("PK…").
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return {zip: toBase64(bytes)};
  const text = new TextDecoder().decode(bytes);
  // A dev server or host may answer a missing file with the app's own page.
  if (/^\s*<!doctype html|^\s*<html[\s>]/i.test(text)) throw Error('Score file is missing');
  return {text};
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function scoreInfo(meiText) {
  // Only the header is needed: parse that, not the whole score again.
  const dom = new DOMParser().parseFromString(meiText.match(/<meiHead\b[\s\S]*?<\/meiHead>/)?.[0] || '<meiHead/>', 'application/xml');
  const stmt = dom.getElementsByTagName('titleStmt')[0];
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const title = text(stmt?.getElementsByTagName('title')[0]);
  const people = stmt ? [...stmt.getElementsByTagName('persName'), ...stmt.getElementsByTagName('composer')] : [];
  const composerEl = people.find(p => /composer/i.test(p.getAttribute('role') || p.localName));
  return {title, composer: text(composerEl)};
}

function safeSvg(text) {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  for (const node of dom.querySelectorAll('script,foreignObject')) node.remove();
  for (const node of dom.querySelectorAll('*'))
    for (const a of [...node.attributes])
      if (a.name.startsWith('on') || (a.name.endsWith('href') && !a.value.startsWith('#'))) node.removeAttribute(a.name);
  return new XMLSerializer().serializeToString(dom.documentElement);
}
