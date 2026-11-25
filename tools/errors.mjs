#!/usr/bin/env node
// Lists the browser errors the dev server collected (error-log/plugin.js → .data/errors.log).
//
//   node tools/errors.mjs                 the last 20, newest last
//   node tools/errors.mjs -n 100          the last 100
//   node tools/errors.mjs --follow        print new ones as they arrive (Ctrl-C to stop)
//   node tools/errors.mjs --json          raw JSON lines
//   node tools/errors.mjs --clear         empty the log
//   --dir <path>                          another folder (default .data, or $ERRORS_DIR)
import {existsSync, rmSync, statSync, watchFile} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FILE, readErrors} from '../error-log/plugin.js';

export function parseArgs(argv) {
  const opts = {limit: 20, follow: false, json: false, clear: false, dir: process.env.ERRORS_DIR || '.data', help: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-n' || a === '--limit') opts.limit = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (a === '-f' || a === '--follow') opts.follow = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--clear') opts.clear = true;
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  opts.dir = resolve(opts.dir);
  return opts;
}

const device = ua => {
  const d = /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : ua ? 'browser' : '?';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${d} ${b}`.trim();
};

export function formatEntry(e, {json = false} = {}) {
  if (json) return JSON.stringify(e);
  const when = new Date(e.at || e.received || 0).toLocaleString();
  const head = `${when} · ${device(e.ua || '')}${e.count > 1 ? ` · ×${e.count}` : ''}${e.url ? ` · ${e.url.replace(/^https?:\/\/[^/]+/, '')}` : ''}`;
  const stack = String(e.stack || '').split('\n').filter(l => l.trim() && !l.includes(e.message)).slice(0, 4).map(l => '    ' + l.trim());
  return [head, '  ' + e.message, ...stack].join('\n');
}

export function main(argv = process.argv.slice(2), out = console.log) {
  const opts = parseArgs(argv);
  if (opts.help) { out('node tools/errors.mjs [-n N] [--follow] [--json] [--clear] [--dir PATH]'); return 0; }
  const path = join(opts.dir, FILE);
  if (opts.clear) { rmSync(path, {force: true}); out(`cleared ${path}`); return 0; }
  const list = readErrors(opts.dir, {limit: opts.limit});
  if (!list.length && !opts.follow) out(existsSync(path) ? 'No errors logged.' : `No errors logged (${path} does not exist yet).`);
  for (const e of list) out(formatEntry(e, opts) + (opts.json ? '' : '\n'));
  if (opts.follow) {
    // Remember the last entry printed, not a count: the plugin trims the oldest half now and then.
    const keyOf = e => (e ? JSON.stringify(e) : null);
    let last = keyOf(readErrors(opts.dir, {limit: 1})[0]);
    watchFile(path, {interval: 500}, () => {
      if (!existsSync(path) || !statSync(path).size) { last = null; return; }
      const all = readErrors(opts.dir, {limit: 0});
      const from = last ? all.findLastIndex(e => keyOf(e) === last) + 1 : 0;
      for (const e of all.slice(from)) out(formatEntry(e, opts) + (opts.json ? '' : '\n'));
      last = keyOf(all.at(-1));
    });
    return null;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const code = main();
  if (code !== null) process.exitCode = code;
}
