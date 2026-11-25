import createVerovioModule from './vendor/verovio-module.mjs';
import {VerovioToolkit} from './vendor/verovio.mjs';

// One WebAssembly module shared by every toolkit; each caller gets its own
// toolkit (the player keeps one for every song it loads; see song.js).
let modulePromise;
export const verovioModule = () => modulePromise ??= createVerovioModule();
export const createToolkit = async () => new VerovioToolkit(await verovioModule());
