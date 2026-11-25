import {createToolkit} from './verovio.js';
import {buildScore} from './score-core.mjs';

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
  tk.setOptions(OPTIONS);
  const ok = input.zip ? tk.loadZipDataBase64(input.zip) : tk.loadData(input.text);
  if (!ok || !tk.getPageCount()) throw Error('Could not read this score. Is it MusicXML, MXL or MEI?');
  const score = buildScore(tk);
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
    noteNames: noteNames(score.mei, score.segments),
    fullSvg: () => svg,
  };
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
  const dom = new DOMParser().parseFromString(meiText, 'application/xml');
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
