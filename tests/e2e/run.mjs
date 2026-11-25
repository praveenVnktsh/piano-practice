// End-to-end tests: npm run e2e [-- <name filter>] [--no-build] [--keep]
//
// Builds the app into a temporary folder, serves it with `vite preview` on a free port and runs
// every tests/e2e/*.test.mjs in headless Chrome (always --mute-audio) through tests/e2e/cdp.mjs.
// Nothing touches the repository's .data/ or .teacher/: preview has no dev-server stores (the app
// falls back to this throwaway Chrome profile's localStorage) and TEACHER_DIR points at the temp dir.
//
// A test file exports `tests = [{name, run: async ctx => …}]`; ctx = {base, page(viewport), assert,
// sleep, catalog}. Pages opened with ctx.page() are checked for console errors after each test.
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {launchChrome, sleep} from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const args = process.argv.slice(2);
const filter = args.find(a => !a.startsWith('--'));
const keep = args.includes('--keep');
const TMP_ROOT = process.env.E2E_TMP || tmpdir();
mkdirSync(TMP_ROOT, {recursive: true});
const tmp = mkdtempSync(join(TMP_ROOT, 'pp-e2e-'));
const outDir = join(tmp, 'dist');
const env = {...process.env, TEACHER_DIR: join(tmp, 'teacher'), BROWSER: 'none'};
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');

// Errors that say nothing about the app (no network in a sandbox, fonts CDN hiccups).
const IGNORED = [/fonts\.(googleapis|gstatic)\.com/, /favicon\.ico/];

const children = [];
let browser = null;
async function cleanup() {
  for (const c of children) try { c.kill('SIGTERM'); } catch {}
  await browser?.close().catch(() => {});
  browser = null;
  if (!keep) try { rmSync(tmp, {recursive: true, force: true}); } catch {}
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().finally(() => process.exit(130)));

function run(cmd, argv, opts = {}) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, argv, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], ...opts});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => code === 0 ? done(out) : fail(new Error(`${cmd} ${argv.join(' ')} exited ${code}\n${out.slice(-3000)}`)));
  });
}

const freePort = () => new Promise((done, fail) => {
  const srv = createServer();
  srv.once('error', fail);
  srv.listen(0, '127.0.0.1', () => { const {port} = srv.address(); srv.close(() => done(port)); });
});

async function startPreview() {
  const port = await freePort();
  const child = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  children.push(child);
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('vite preview exited:\n' + log);
    try { if ((await fetch(base)).ok) return base; } catch {}
    await sleep(150);
  }
  throw new Error('vite preview did not start:\n' + log);
}

async function main() {
  const started = Date.now();
  if (!args.includes('--no-build')) {
    process.stdout.write('building… ');
    await run(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn']);
    console.log(`done (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
  const base = await startPreview();
  console.log('serving', base);
  browser = await launchChrome({profileRoot: process.env.E2E_PROFILE_ROOT || tmp});
  const catalog = await (await fetch(base + 'songs/catalog.json')).json();

  const files = readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).sort();
  const results = [];
  for (const file of files) {
    const {tests = []} = await import(pathToFileURL(join(HERE, file)).href);
    for (const t of tests) {
      const name = `${file.replace('.test.mjs', '')} › ${t.name}`;
      if (filter && !name.includes(filter)) continue;
      const pages = [];
      const ctx = {
        base, assert, sleep, catalog,
        page: async (viewport = {}) => { const p = await browser.newPage(viewport); pages.push(p); return p; },
      };
      const t0 = Date.now();
      let error = null;
      try {
        await Promise.race([t.run(ctx), sleep(t.timeout || 90000).then(() => { throw new Error('test timed out'); })]);
        const errors = pages.flatMap(p => p.errors).filter(e => !IGNORED.some(re => re.test(e)) && !(t.allowErrors || []).some(re => re.test(e)));
        if (errors.length) throw new Error('console errors:\n    ' + errors.join('\n    '));
      } catch (e) { error = e; }
      // Closing can hang if Chrome stops answering: never wait more than a few seconds.
      for (const p of pages) { await Promise.race([p.send('Page.close').catch(() => {}), sleep(3000)]); p.close(); }
      const ms = Date.now() - t0;
      results.push({name, error});
      console.log(`${error ? '✗' : '✓'} ${name} (${ms} ms)${error ? '\n    ' + String(error.stack || error).split('\n').slice(0, 6).join('\n    ') : ''}`);
    }
  }
  const failed = results.filter(r => r.error);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!results.length) { console.log('no tests matched'); return 1; }
  return failed.length ? 1 : 0;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error(e); }
finally { await Promise.race([cleanup(), new Promise(r => setTimeout(r, 10000))]); }
process.exit(code);
