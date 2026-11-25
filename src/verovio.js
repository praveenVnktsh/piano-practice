// One WebAssembly module shared by every toolkit; each caller gets its own
// toolkit (the player keeps one for every song it loads; see song.js).
// The engine (≈7 MB) is imported on first use, in its own chunk, so it never holds up
// the first paint of the app: Today, Pieces and the drills don't need it.
let vendor, modulePromise;
const loadVendor = () => vendor ??= Promise.all([import('./vendor/verovio-module.mjs'), import('./vendor/verovio.mjs')]);
export const verovioModule = () => modulePromise ??= loadVendor().then(([m]) => m.default());
export const createToolkit = async () => {
  const [, {VerovioToolkit}] = await loadVendor();
  return new VerovioToolkit(await verovioModule());
};
/** Starts fetching and compiling the engine in the background (e.g. when the browser is idle). */
export const warmVerovio = () => { verovioModule().catch(() => { modulePromise = null; vendor = null; }); };
// In the browser, warm it once the first screen has painted and the main thread is idle,
// so opening a piece doesn't wait for the download.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !globalThis.__vitest_worker__) {
  const idle = window.requestIdleCallback ? fn => window.requestIdleCallback(fn, {timeout: 4000}) : fn => setTimeout(fn, 2500); // Safari: no rIC
  idle(warmVerovio);
}
