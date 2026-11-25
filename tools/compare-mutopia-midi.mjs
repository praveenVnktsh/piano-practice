#!/usr/bin/env node
// Checks the bundled Mutopia repertoire against the MIDI file that LilyPond itself made from
// each piece's source (published next to it on mutopiaproject.org): an independent rendering
// of the same notes. Every converted note should be in that file at the same time and pitch.
//
//   node tools/compare-mutopia-midi.mjs [--cache DIR] [--only id,id] [--bars FROM-TO]
//
// The conversion is compared as printed (repeats once) and with repeats written out; the
// closer one is reported, as Mutopia's MIDI files are made either way. Notes that only moved
// a little (grace notes, appoggiaturas: Verovio and LilyPond time them differently) are counted
// as "shifted", not as differences. Differences that remain need a look in the source: a MIDI
// file can be older than a later correction of the .ly file (see each file's history on GitHub).
// --bars prints both, bar by bar, for the bars given (measure indices as played).

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {expandIncludes, lilypondToEvents, eventsToMusicXML} from './ly2musicxml-core.mjs';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';
import {parseMidi} from '../src/midi-file/parse.mjs';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const manifest = JSON.parse(readFileSync(join(ROOT, 'songs/repertoire.json'), 'utf8'));
const only = opt('only')?.split(',');
const cache = opt('cache');
const bars = opt('bars')?.split('-').map(Number);

async function fetchFile(url, local, binary) {
  if (local && existsSync(local)) return binary ? readFileSync(local) : readFileSync(local, 'utf8');
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  const data = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  if (local) { mkdirSync(dirname(local), {recursive: true}); writeFileSync(local, data); }
  return data;
}
const lySource = path => fetchFile(`https://raw.githubusercontent.com/${manifest.repo}/${manifest.commit}/${path.split('/').map(encodeURIComponent).join('/')}`, cache && join(cache, path), false);
function midiOf(p) {
  let dir = dirname(p.ly);
  if (dir.endsWith('-lys')) dir = dirname(dir);
  const path = `${dir}/${dir.split('/').at(-1)}.mid`;
  return fetchFile(`https://www.mutopiaproject.org/${path}`, cache && join(cache, 'midi', path), true);
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nm = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const once = list => { const seen = new Set(); return list.filter(x => { const k = `${x.n}@${x.t.toFixed(3)}`; return !seen.has(k) && seen.add(k); }); };

function compare(events, midiNotes) {
  const mid = midiNotes.map(x => ({...x}));
  let missing = [];
  for (const e of events) {
    const m = mid.find(x => !x.used && x.n === e.n && Math.abs(x.t - e.t) < .13);
    if (m) m.used = true; else missing.push(e);
  }
  const shifted = [];
  missing = missing.filter(e => {
    const m = mid.find(x => !x.used && x.n === e.n && Math.abs(x.t - e.t) < .6);
    if (!m) return true;
    m.used = true; shifted.push(e); return false;
  });
  return {missing, extra: mid.filter(x => !x.used), shifted};
}

const tk = await createToolkit();
tk.setOptions({breaks: 'none'});
let differences = 0;
for (const p of manifest.pieces) {
  if (only && !only.includes(p.id)) continue;
  const [src, midiBytes] = await Promise.all([lySource(p.ly), midiOf(p)]);
  if (!midiBytes) { console.log(`${p.id}: no MIDI file on mutopiaproject.org`); continue; }
  let full = await expandIncludes(src, path => lySource(path), {path: p.ly});
  for (const fix of p.fixes ?? []) full = full.replace(fix.from, fix.to);
  const midi = parseMidi(new Uint8Array(midiBytes));
  const midiNotes = once(midi.notes.map(x => ({n: x.n, t: x.tick / midi.division})));
  const runs = [false, true].map(unfold => {
    tk.loadData(eventsToMusicXML(lilypondToEvents(full, {unfold}), {title: p.title}));
    const s = buildScore(tk);
    return {unfold, s, ...compare(once(s.events), midiNotes)};
  }).sort((a, b) => a.missing.length + a.extra.length - b.missing.length - b.extra.length);
  const {unfold, s, missing, extra, shifted} = runs[0];
  const at = t => { const m = s.measures.find(m => m.start <= t + 1e-6 && t < m.end - 1e-6) ?? s.measures.at(-1); return `bar ${m.label}${m.visit > 1 ? "'" : ''}+${(t - m.start).toFixed(2)}`; };
  differences += missing.length + extra.length;
  console.log(`${p.id}: ${unfold ? 'repeats written out' : 'as printed'}, ${s.events.length} notes; ${missing.length} not in the MIDI file, ${extra.length} only there, ${shifted.length} shifted`);
  if (missing.length) console.log('  not in the MIDI file:', missing.slice(0, 12).map(e => `${nm(e.n)} ${at(e.t)}`).join(', '));
  if (extra.length) console.log('  only in the MIDI file:', extra.slice(0, 12).map(x => `${nm(x.n)} ${at(x.t)}`).join(', '));
  if (bars) for (const m of s.measures.slice(bars[0], bars[1] + 1)) {
    const fmt = list => list.filter(x => x.t >= m.start - 1e-6 && x.t < m.end - 1e-6).sort((a, b) => a.t - b.t || a.n - b.n).map(x => `${nm(x.n)}@${(x.t - m.start).toFixed(2)}`).join(' ');
    console.log(`  bar ${m.label}  ours: ${fmt(s.events)}\n          MIDI: ${fmt(midiNotes)}`);
  }
}
console.log(`${differences} differences`);
process.exit(0);
