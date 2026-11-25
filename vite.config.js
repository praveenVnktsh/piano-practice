import {defineConfig} from 'vite';
import {annotate} from './annotate/plugin.js';
import {midiRelay} from './midi-relay/plugin.js';
import {songStore} from './song-store/plugin.js';
import {progressStore} from './progress-store/plugin.js';
import {teacher} from './teacher/plugin.js';
import {backup} from './backup/plugin.js';
import {recordings} from './recordings/plugin.js';
import {collectionsStore} from './src/collections/plugin.js';
import {pwa} from './src/pwa/plugin.js';
import {rmSync} from 'node:fs';
import {resolve} from 'node:path';

// Private songs (public/songs/local/) are for the dev server only: drop them
// from production builds unless INCLUDE_LOCAL_SONGS=1.
const excludeLocalSongs = () => ({
  name: 'exclude-local-songs',
  apply: 'build',
  closeBundle() {
    if (!process.env.INCLUDE_LOCAL_SONGS) rmSync(resolve('dist/songs/local'), {recursive: true, force: true});
  },
});

export default defineConfig({
  // ANNOTATE=1 npm run dev adds the in-page notes overlay (dev server only).
  // midiRelay forwards a Mac's MIDI keyboard to an iPad (npm run dev:ipad).
  // songStore saves imported scores to public/songs/local/imports (dev server only).
  // progressStore saves practice progress to .data/progress.json (dev server only).
  // teacher keeps the Teacher panel's conversation in .teacher/ (dev server only; teacher/cli.js answers).
  // recordings keeps recorded takes and mock-exam sheets in .data/recordings (dev server only; RECORDINGS_DIR overrides).
  // collectionsStore keeps favourites and collections (setlists) in .data/collections.json (dev server only).
  // backup exports/restores .data, .teacher and imported scores at /__backup (dev server only).
  // pwa writes the offline cache's service worker (dist/sw.js; /sw.js in dev, see src/pwa/sw-register.js).
  plugins: [midiRelay(), songStore(), progressStore(), collectionsStore(), teacher(), recordings(), backup(), pwa(), excludeLocalSongs(), ...(process.env.ANNOTATE ? [annotate()] : [])],
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
