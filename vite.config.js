import {defineConfig} from 'vite';
import {annotate} from './annotate/plugin.js';
import {midiRelay} from './midi-relay/plugin.js';
import {songStore} from './song-store/plugin.js';
import {progressStore} from './progress-store/plugin.js';
import {teacher} from './teacher/plugin.js';
import {backup} from './backup/plugin.js';
import {recordings} from './recordings/plugin.js';
import {errorLog} from './error-log/plugin.js';
import {collectionsStore} from './src/collections/plugin.js';
import {pwa} from './src/pwa/plugin.js';
import {readFileSync, rmSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {resolve} from 'node:path';

// Private songs (public/songs/local/) are for the dev server only: drop them
// from production builds unless INCLUDE_LOCAL_SONGS=1.
// Runs right after public/ is copied (before the service worker's precache list is made), for
// whatever outDir the build uses.
const excludeLocalSongs = () => {
  let outDir = resolve('dist');
  return {
    name: 'exclude-local-songs',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle: {
      sequential: true,
      order: 'pre',
      handler() {
        if (!process.env.INCLUDE_LOCAL_SONGS) rmSync(resolve(outDir, 'songs/local'), {recursive: true, force: true});
      },
    },
  };
};

// Settings → Diagnostics shows the app version and the commit it was built from.
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
let APP_COMMIT = process.env.APP_COMMIT || '';
if (!APP_COMMIT) try { APP_COMMIT = execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch {}

export default defineConfig({
  // BASE=./ builds a copy that works from any sub-path (the public GitHub Pages site).
  base: process.env.BASE || '/',
  define: {__APP_VERSION__: JSON.stringify(APP_VERSION), __APP_COMMIT__: JSON.stringify(APP_COMMIT)},
  // ANNOTATE=1 npm run dev adds the in-page notes overlay (dev server only).
  // midiRelay forwards a Mac's MIDI keyboard to an iPad (npm run dev:ipad).
  // songStore saves imported scores to public/songs/local/imports (dev server only).
  // progressStore saves practice progress to .data/progress.json (dev server only).
  // teacher keeps the Teacher panel's conversation in .teacher/ (dev server only; teacher/cli.js answers).
  // recordings keeps recorded takes and mock-exam sheets in .data/recordings (dev server only; RECORDINGS_DIR overrides).
  // collectionsStore keeps favourites and collections (setlists) in .data/collections.json (dev server only).
  // backup exports/restores .data, .teacher and imported scores at /__backup (dev server only).
  // errorLog appends browser errors (window error / unhandledrejection) to .data/errors.log at /__errors
  //   (dev server only; ERRORS_DIR overrides; `node tools/errors.mjs` lists them).
  // pwa writes the offline cache's service worker (dist/sw.js; /sw.js in dev, see src/pwa/sw-register.js).
  plugins: [midiRelay(), songStore(), progressStore(), collectionsStore(), teacher(), recordings(), backup(), errorLog(), pwa(), excludeLocalSongs(), ...(process.env.ANNOTATE ? [annotate()] : [])],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 9000,
  },
  esbuild: {target: 'es2022'},
  optimizeDeps: {esbuildOptions: {target: 'es2022'}},
  server: {port: 5173},
  // Vitest (npm test). Tests run in Node; a file can opt into jsdom with
  // `// @vitest-environment jsdom`.
  test: {include: ['tests/**/*.test.js', 'annotate/**/*.test.js']},
});
