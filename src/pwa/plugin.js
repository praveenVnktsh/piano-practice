// Vite plugin for the offline cache (src/pwa/sw.js; see docs in that file and README "iPad").
//   build:  writes dist/sw.js = `self.PRECACHE = {version, files}` + src/pwa/sw.js, listing every
//           built file (minus private songs unless INCLUDE_LOCAL_SONGS=1); `version` is a hash
//           of their contents, so each build that changes anything installs a fresh cache.
//   serve:  /sw.js in dev mode (network first; registered only when asked, see sw-register.js).
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'sw.js');
// Not precached: the multi-layer grand (≈9 MB) and harpsichord samples are cached on first use
// instead (the worker serves /samples/ cache-first), and the Mutopia index is fetched on demand.
// The 2 MB single-layer piano in samples/piano/ stays precached, so the app always has a sound offline.
const SKIP = [/^sw\.js$/, /^songs\/local\//, /\.map$/, /^THIRD-PARTY-NOTICES\.txt$/, /(^|\/)\.[^/]+$/,
  /^samples\/(grand|harpsichord)\//, /^songs\/mutopia-index\.json$/];

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, root, out);
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}

/** {version, files} for a build directory. */
export function precacheList(outDir, {includeLocal = !!process.env.INCLUDE_LOCAL_SONGS} = {}) {
  const files = walk(outDir).filter(f => !SKIP.some(re => re.test(f)) || (includeLocal && f.startsWith('songs/local/'))).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
  // index.html is served as "./" (navigation fallback) and as itself.
  return {version: hash.digest('hex').slice(0, 12), files};
}

export const workerSource = precache => `self.PRECACHE = ${JSON.stringify(precache)};\n` + readFileSync(SOURCE, 'utf8');

export function pwa() {
  let outDir = 'dist';
  return {
    name: 'pwa-offline-cache',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/sw.js') return next();
        res.setHeader('content-type', 'text/javascript');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('service-worker-allowed', '/');
        res.end(workerSource({version: 'dev', files: [], dev: true}));
      });
    },
    writeBundle: {
      // After the bundle and public/ are in place, before closeBundle hooks prune anything.
      sequential: true,
      order: 'post',
      handler() {
        const precache = precacheList(outDir);
        writeFileSync(join(outDir, 'sw.js'), workerSource(precache));
        this.info?.(`service worker: ${precache.files.length} files, version ${precache.version}`);
      },
    },
  };
}
