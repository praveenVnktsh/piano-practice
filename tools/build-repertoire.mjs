#!/usr/bin/env node
// Rebuilds the Mutopia part of the bundled repertoire from songs/repertoire.json:
// downloads every .ly file (and its \include files) at the pinned Mutopia commit,
// converts it with ly2musicxml and writes public/songs/<id>.musicxml, then updates
// those pieces' entries in public/songs/catalog.json (other entries are kept).
//
//   node tools/build-repertoire.mjs [--cache DIR] [--only id,id] [--no-catalog]
//
// --cache DIR keeps downloaded sources in DIR (re-used on the next run).
// A piece's optional "fixes" ([{from, to, why}]) correct engraving errors in its source text.
// Always re-check a piece by hand after its source or the converter changes
// (songs/README.md, "Verify").

import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {periodOf} from '../src/collections/model.js';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandIncludes, lilypondToEvents, eventsToMusicXML} from './ly2musicxml-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const manifest = JSON.parse(readFileSync(join(ROOT, 'songs/repertoire.json'), 'utf8'));
const only = opt('only')?.split(',');
const cache = opt('cache');

const LICENSES = {
  'Public Domain': {name: 'Public Domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/'},
  'CC BY-SA 2.5': {name: 'Creative Commons Attribution-ShareAlike 2.5', url: 'https://creativecommons.org/licenses/by-sa/2.5/'},
  'CC BY-SA 3.0': {name: 'Creative Commons Attribution-ShareAlike 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/'},
  'CC BY-SA 4.0': {name: 'Creative Commons Attribution-ShareAlike 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/'},
};

async function fetchText(path) {
  const local = cache && join(cache, path);
  if (local && existsSync(local)) return readFileSync(local, 'utf8');
  const url = `https://raw.githubusercontent.com/${manifest.repo}/${manifest.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  const text = await res.text();
  if (local) { mkdirSync(dirname(local), {recursive: true}); writeFileSync(local, text); }
  return text;
}

export const pieceInfoUrl = id => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;

export function catalogEntry(p) {
  const pd = p.license === 'Public Domain';
  const by = `Mutopia Project – typeset by ${p.typesetter}${p.edition ? ` (${p.edition})` : ''}; converted with tools/ly2musicxml.mjs, repeats unfolded`;
  return {
    id: p.id,
    title: p.title,
    composer: p.composer,
    difficulty: p.grade === 0 ? 'beginner' : p.grade <= 2 ? 'easy' : p.grade <= 4 ? 'intermediate' : 'advanced',
    grade: p.grade,
    ...(periodOf(p.composer) ? {period: periodOf(p.composer)} : {}),
    file: `songs/${p.id}.musicxml`,
    license: p.license,
    source: pd ? by : `${by}. Adaptations shared under ${p.license}`,
    sourceUrl: pieceInfoUrl(p.mutopiaId),
    typesetter: p.typesetter,
    tempo: p.tempo,
    ...(p.section ? {section: p.section} : {}),
  };
}

function rights(p) {
  const lic = LICENSES[p.license];
  if (!lic) throw Error(`${p.id}: unknown licence ${p.license}`);
  const by = `Typeset by ${p.typesetter} for the Mutopia Project (${pieceInfoUrl(p.mutopiaId)})`;
  return p.license === 'Public Domain'
    ? `Public Domain. ${by}; converted to MusicXML by Piano Practice.`
    : `${lic.name} (${lic.url}). ${by}; converted to MusicXML by Piano Practice. This adaptation is licensed under the same licence.`;
}

async function build(p) {
  const src = await fetchText(p.ly);
  if (src == null) throw Error(`${p.id}: ${p.ly} not found`);
  const warnings = [];
  let full = await expandIncludes(src, path => fetchText(path), {path: p.ly, warnings});
  // Corrections of plain engraving errors, each with its reason (songs/repertoire.json, "fixes").
  for (const fix of p.fixes ?? []) {
    if (!full.includes(fix.from)) throw Error(`${p.id}: fix not applicable: ${fix.from}`);
    full = full.replace(fix.from, fix.to);
  }
  const score = lilypondToEvents(full);
  score.warnings.unshift(...warnings);
  score.tempo = p.tempo;
  const xml = eventsToMusicXML(score, {title: p.title, composer: p.composer, rights: rights(p), source: pieceInfoUrl(p.mutopiaId)});
  writeFileSync(join(ROOT, 'public/songs', `${p.id}.musicxml`), xml);
  const measures = (xml.match(/<measure /g) || []).length;
  console.error(`${p.id}: ${measures} measures, ${score.events.filter(e => e.kind === 'note').length} notes${score.warnings.length ? ' — ' + [...new Set(score.warnings)].join('; ') : ''}`);
  return catalogEntry(p);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const entries = [];
  for (const p of manifest.pieces) if (!only || only.includes(p.id)) entries.push(await build(p));
  if (!args.includes('--no-catalog')) {
    const file = join(ROOT, 'public/songs/catalog.json');
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    const byId = new Map(entries.map(e => [e.id, e]));
    const songs = catalog.songs.map(s => byId.get(s.id) ?? s);
    for (const e of entries) if (!songs.some(s => s.id === e.id)) songs.push(e);
    const rank = s => s.grade ?? {beginner: 0, easy: 1.5, intermediate: 3.5, advanced: 5}[s.difficulty] ?? 3;
    songs.sort((a, b) => rank(a) - rank(b)); // stable: keeps the hand-made order within a grade
    writeFileSync(file, JSON.stringify({songs}, null, 2) + '\n');
  }
}
