#!/usr/bin/env node
// Builds public/songs/mutopia-index.json: the solo keyboard pieces of the Mutopia
// Project (github.com/MutopiaProject/MutopiaProject) with an accepted licence
// (Public Domain, CC0, CC BY, CC BY-SA), for the experimental "Browse Mutopia" page.
//
//   node tools/mutopia-index.mjs [--commit SHA] [--cache DIR] [--out FILE]
//
// Reads the repository tree once (GitHub API, through `gh api` when available),
// then the header of every piece's main .ly file from raw.githubusercontent.com.
// Each entry: {id, title, composer, opus, date, style, license, instrument, path, url}
// where `path` is the main .ly file and `url` its raw URL at the indexed commit.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'MutopiaProject/MutopiaProject';
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const cache = opt('cache');
const out = opt('out') ?? join(ROOT, 'public/songs/mutopia-index.json');

function githubApi(path) {
  try { return JSON.parse(execFileSync('gh', ['api', path], {maxBuffer: 64 << 20, encoding: 'utf8'})); }
  catch { return null; }
}
async function api(path) {
  const viaGh = githubApi(path);
  if (viaGh) return viaGh;
  const res = await fetch('https://api.github.com/' + path, {headers: {accept: 'application/vnd.github+json'}});
  if (!res.ok) throw Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

export const rawUrl = (commit, path) => `https://raw.githubusercontent.com/${REPO}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function fetchText(commit, path) {
  const local = cache && join(cache, path);
  if (local && existsSync(local)) return readFileSync(local, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(rawUrl(commit, path));
      if (res.status === 404) return null;
      if (!res.ok) throw Error(String(res.status));
      const text = await res.text();
      if (local) { mkdirSync(dirname(local), {recursive: true}); writeFileSync(local, text); }
      return text;
    } catch (e) {
      if (attempt >= 3) { console.error('skip', path, e.message); return null; }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

// ── header fields ──
const FIELD = /(?:^|\n)\s*([A-Za-z]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
export function headerFields(text) {
  const fields = {};
  for (const block of text.matchAll(/\\header\s*\{([\s\S]*?)\n\s*\}/g))
    for (const [, k, v] of block[1].matchAll(FIELD)) if (!(k in fields)) fields[k] = v.replace(/\\"/g, '"').trim();
  return fields;
}

/** Normalised licence name, or null for licences we don't accept. */
export function normaliseLicense(text = '') {
  const t = String(text);
  if (/non-?commercial|no-?deriv|\bBY-NC|\bBY-ND/i.test(t)) return null;
  if (/public\s*domain/i.test(t)) return 'Public Domain';
  if (/CC0|zero/i.test(t)) return 'CC0';
  const v = t.match(/(\d\.\d)/)?.[1] ?? '';
  if (/share-?alike|\bBY-SA\b/i.test(t)) return `CC BY-SA${v ? ' ' + v : ''}`;
  if (/attribution|\bCC BY\b/i.test(t)) return `CC BY${v ? ' ' + v : ''}`;
  return null;
}

const KEYBOARD = new Set(['piano', 'harpsichord', 'clavichord', 'clavier', 'keyboard', 'fortepiano', 'pianoforte', 'piano solo', 'virginal', 'spinet']);
/** Solo keyboard only: every listed instrument is a keyboard (not organ, not 4 hands). */
export function isSoloPiano(instrument = '') {
  const parts = instrument.toLowerCase().split(/\s*(?:,|&|\/|\band\b|\bor\b)\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => KEYBOARD.has(p)) && !/duet|4 hands|four hands|two pianos|2 pianos/i.test(instrument);
}

// ── pieces in the tree ──
// A piece is a directory ftp/<Composer>/[...]/<name>/ holding <name>.ly, or a <name>-lys/ folder.
export function findPieces(tree) {
  const blobs = tree.filter(x => x.type === 'blob' && x.path.startsWith('ftp/'));
  const byDir = new Map();
  for (const b of blobs) {
    const parts = b.path.split('/');
    const dir = parts.slice(0, -1).join('/');
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)).push(parts.at(-1));
  }
  const pieces = [];
  for (const [dir, files] of byDir) {
    const name = dir.split('/').at(-1);
    if (name.endsWith('-lys')) {
      const pieceDir = dir.slice(0, -('/' + name).length);
      if (pieceDir.split('/').at(-1) + '-lys' !== name) continue;
      const lys = files.filter(f => f.endsWith('.ly'));
      if (lys.length) pieces.push({dir: pieceDir, candidates: lys.map(f => `${dir}/${f}`)});
    } else if (files.includes(name + '.ly')) pieces.push({dir, candidates: [`${dir}/${name}.ly`]});
  }
  return pieces;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: n}, async () => { while (next < items.length) { const k = next++; results[k] = await fn(items[k], k); } }));
  return results;
}

async function describe(commit, piece) {
  // The main file: the only .ly, else the one with \score / \book.
  const texts = await Promise.all(piece.candidates.map(async p => [p, await fetchText(commit, p)]));
  const usable = texts.filter(([, t]) => t);
  if (!usable.length) return null;
  const base = piece.dir.split('/').at(-1);
  const rank = ([p, t]) => {
    const name = p.split('/').at(-1).replace(/\.ly$/, '');
    return (/\\(score|book)\s*\{/.test(t) ? 0 : 4) + (name === base ? 0 : 2) + (/(^|[-_])(defs?|header|midi?|notes|parts?)([-_]|$)/i.test(name) ? 1 : 0);
  };
  const main = usable.slice().sort((a, b) => rank(a) - rank(b))[0];
  let fields = {};
  for (const [, t] of [main, ...usable]) fields = {...headerFields(t), ...fields};
  if (!fields.mutopiainstrument && !fields.instrument) {
    // Header in an included file (e.g. header.ly next to the main file).
    for (const inc of main[1].matchAll(/\\include\s+"([^"]+)"/g)) {
      const p = `${dirname(main[0])}/${inc[1]}`;
      if (!/\.(ly|ily)$/.test(p) || /english|deutsch|nederlands|italiano/.test(inc[1])) continue;
      const t = await fetchText(commit, p);
      if (t) fields = {...headerFields(t), ...fields};
    }
  }
  const instrument = fields.mutopiainstrument ?? fields.instrument ?? '';
  if (!isSoloPiano(instrument)) return null;
  const license = normaliseLicense(fields.license ?? fields.copyright);
  if (!license) return null;
  const id = +(fields.footer ?? '').match(/-(\d+)\s*$/)?.[1] || null;
  const clean = s => (s ?? '').replace(/\s+/g, ' ').trim() || undefined;
  return {
    id,
    title: clean(fields.mutopiatitle ?? fields.title) ?? piece.dir.split('/').at(-1),
    composer: clean(fields.composer?.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '')) ?? clean(fields.mutopiacomposer) ?? piece.dir.split('/')[1],
    composerId: clean(fields.mutopiacomposer) ?? piece.dir.split('/')[1],
    opus: clean(fields.opus ?? fields.mutopiaopus),
    date: clean(fields.date),
    style: clean(fields.style),
    license,
    instrument: clean(instrument),
    path: main[0],
    url: rawUrl(commit, main[0]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const commit = opt('commit') ?? (await api(`repos/${REPO}/commits/master`)).sha;
  const tree = await api(`repos/${REPO}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) console.error('warning: the GitHub tree listing was truncated');
  const pieces = findPieces(tree.tree);
  console.error(`${pieces.length} pieces in the tree; reading headers…`);
  let done = 0;
  const entries = (await pool(pieces, 12, async p => {
    const e = await describe(commit, p);
    if (++done % 200 === 0) console.error(`  ${done}/${pieces.length}`);
    return e;
  })).filter(Boolean);
  // One spelling per composer (Mutopia's composer id): the most common full name.
  const names = new Map();
  for (const e of entries) {
    const m = names.get(e.composerId) ?? names.set(e.composerId, new Map()).get(e.composerId);
    m.set(e.composer, (m.get(e.composer) ?? 0) + 1);
  }
  for (const e of entries) {
    e.composer = [...names.get(e.composerId)].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    delete e.composerId;
  }
  entries.sort((a, b) => a.composer.localeCompare(b.composer) || a.title.localeCompare(b.title));
  const index = {
    about: 'Solo keyboard pieces of the Mutopia Project with an open licence. Generated by tools/mutopia-index.mjs; conversions are unverified.',
    repo: REPO, commit, generated: new Date().toISOString().slice(0, 10), count: entries.length, pieces: entries,
  };
  const json = JSON.stringify(index);
  writeFileSync(out, json + '\n');
  console.error(`${entries.length} piano pieces → ${out} (${(json.length / 1024).toFixed(0)} KB)`);
}
