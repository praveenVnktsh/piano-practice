#!/usr/bin/env node
// Converts piano scores written in LilyPond (as published by the Mutopia
// Project) into MusicXML the app can play.
//
//   node tools/ly2musicxml.mjs input.ly [--title T] [--composer C] [--rights R]
//        [--source S] [--tempo BPM] > public/songs/x.musicxml
//
// Always check the result bar by bar (see songs/README.md): unsupported
// constructs are skipped with a warning, not reproduced. The converter itself
// lives in ly2musicxml-core.mjs (no Node APIs, so the browser can use it too);
// this file adds the command line and reads \include files from disk.

import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {lilypondToEvents, eventsToMusicXML} from './ly2musicxml-core.mjs';

export * from './ly2musicxml-core.mjs';

/** Reads \include files relative to the including file (LilyPond's default). */
export const fileReader = (path, from) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const file = args.find((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--'));
  const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  if (!file) { console.error('usage: ly2musicxml.mjs input.ly [--title T] [--composer C] [--rights R] [--source S] [--tempo BPM]'); process.exit(1); }
  const score = lilypondToEvents(readFileSync(file, 'utf8'), {read: fileReader, path: file});
  if (opt('tempo')) score.tempo = Math.round(+opt('tempo'));
  for (const w of new Set(score.warnings)) console.error('warning:', w);
  const counts = {};
  for (const e of score.events) if (e.kind === 'note') counts[e.voice] = (counts[e.voice] ?? 0) + e.pitches.length;
  const xml = eventsToMusicXML(score, {title: opt('title'), composer: opt('composer'), rights: opt('rights'), source: opt('source')});
  console.error(`time ${score.time.join('/')} key ${score.key} pickup ${score.pickup / 480}q tempo ${score.tempo} staves ${score.staffNames.join(',')} measures ${(xml.match(/<measure /g) || []).length} notes`, counts);
  process.stdout.write(xml);
}
