// Browse Mutopia (experimental): the piano catalogue of the Mutopia Project
// (public/songs/mutopia-index.json, built by tools/mutopia-index.mjs) and
// in-browser conversion of a piece's LilyPond source to MusicXML.
//
// Ids are "mutopia:<path of the main .ly file>", e.g.
// "mutopia:ftp/BachJS/BWV772/bach-invention-01/bach-invention-01.ly".
// resolveMutopiaEntry(id) → {entry, source: {data: '<MusicXML>'}} for the player.
// Conversions are automatic and unverified; entries carry `unverified: true`.

import {expandIncludes, lilypondToEvents, eventsToMusicXML} from '../../tools/ly2musicxml-core.mjs';

const BASE = import.meta.env?.BASE_URL || '/';
export const MUTOPIA_PREFIX = 'mutopia:';
export const isMutopiaId = id => typeof id === 'string' && id.startsWith(MUTOPIA_PREFIX);
export const mutopiaId = piece => MUTOPIA_PREFIX + piece.path;
export const pieceInfoUrl = piece => (piece.id ? `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${piece.id}` : null);

const MAX_FILE = 2 << 20; // 2 MB per .ly file is far more than any Mutopia piece needs

let indexPromise = null;
/** The catalogue: {repo, commit, count, pieces: [...]}. */
export function loadIndex() {
  indexPromise ??= fetch(BASE + 'songs/mutopia-index.json', {cache: 'no-cache'}).then(async res => {
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('text/html')) throw Error('The Mutopia catalogue is not available');
    const index = await res.json();
    if (!Array.isArray(index?.pieces)) throw Error('The Mutopia catalogue is damaged');
    return index;
  });
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

const rawUrl = (index, path) => `https://raw.githubusercontent.com/${index.repo}/${index.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
// Only files inside the Mutopia ftp/ tree, without .. tricks.
const safePath = path => /^ftp\/[\w.+\-/ ]+\.(ly|ily|lyi)$/i.test(path) && !path.split('/').includes('..');

async function fetchSource(index, path) {
  if (!safePath(path)) return null;
  const res = await fetch(rawUrl(index, path));
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`Could not download ${path.split('/').at(-1)} (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_FILE) throw Error('This piece is too large to convert');
  return text;
}

const conversions = new Map(); // path → Promise<{xml, warnings, measures, score}>

/** Downloads and converts one catalogue piece (cached for the session). */
export function convertPiece(piece) {
  if (!conversions.has(piece.path)) {
    const job = (async () => {
      const index = await loadIndex();
      const src = await fetchSource(index, piece.path);
      if (src == null) throw Error('The LilyPond source is missing from the Mutopia repository');
      const warnings = [];
      const text = await expandIncludes(src, path => fetchSource(index, path), {path: piece.path, warnings});
      const score = lilypondToEvents(text);
      if (!score.events.some(e => e.kind === 'note')) throw Error('No notes could be read from this score');
      const xml = eventsToMusicXML(score, {
        title: piece.title,
        composer: piece.composer,
        rights: `${piece.license}. Mutopia Project${piece.id ? ` piece ${piece.id}` : ''}; unverified automatic conversion.`,
        source: pieceInfoUrl(piece) ?? rawUrl(index, piece.path),
      });
      return {xml, score, warnings: [...new Set([...warnings, ...score.warnings])], measures: (xml.match(/<measure /g) || []).length};
    })();
    conversions.set(piece.path, job);
    job.catch(() => conversions.delete(piece.path));
  }
  return conversions.get(piece.path);
}

/** The library entry the player shows for a Mutopia piece. */
export function mutopiaEntry(piece, conversion) {
  return {
    id: mutopiaId(piece),
    title: piece.title,
    composer: `${piece.composer} · unverified conversion`,
    kind: 'mutopia',
    unverified: true,
    license: piece.license,
    source: 'Mutopia Project — automatic, unverified conversion of the LilyPond source',
    sourceUrl: pieceInfoUrl(piece) ?? undefined,
    ...(conversion?.score?.tempo ? {tempo: conversion.score.tempo} : {}),
  };
}

/** For the shell: "mutopia:<path>" → {entry, source: {data}} (null for an unknown id). */
export async function resolveMutopiaEntry(id) {
  if (!isMutopiaId(id)) return null;
  const path = id.slice(MUTOPIA_PREFIX.length);
  const index = await loadIndex();
  const piece = index.pieces.find(p => p.path === path);
  if (!piece) return null;
  const conversion = await convertPiece(piece);
  return {entry: mutopiaEntry(piece, conversion), source: {data: conversion.xml}};
}
