#!/usr/bin/env node
// Builds the app's instrument samples from the original sample libraries.
// Node only (not imported by the app). Needs ffmpeg with libmp3lame.
//
//   node src/audio/build-samples.mjs <salamander-dir> <vcsl-french-harpsichord-dir>
//
//   <salamander-dir>  the 44.1khz16bit folder of SalamanderGrandPianoV3_44.1khz16bit.tar.bz2
//                     (https://archive.org/details/SalamanderGrandPianoV3, CC BY 3.0, Alexander Holm)
//   <vcsl-dir>        a folder with sus/ and rel/ holding VCSL "Harpsichord, French"
//                     Sustains (rr1) and Releases (https://github.com/sgossner/VCSL, CC0), with
//                     '#' in the file names written as 's'
//
// Writes public/samples/grand/<layer>/<midi>.mp3, public/samples/grand/release/<midi>.mp3,
// public/samples/harpsichord/{sus,rel}/<midi>.mp3 and src/audio/sample-manifest.json
// (note lists, per-layer loudness measured from the source, and file sizes).
//
// Every sample is folded to mono (the engine pans each note by pitch), trimmed to a
// length that suits its register with a smooth fade, and encoded as VBR MP3, which
// every browser (including Safari on iPad) decodes.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [salDir, vcslDir] = process.argv.slice(2).map(p => resolve(p));
if (!salDir || !vcslDir) { console.error('usage: node src/audio/build-samples.mjs <salamander-44.1khz16bit-dir> <vcsl-dir>'); process.exit(1); }

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const salName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1); // A0, C1, D#1 …
const GRAND_NOTES = Array.from({length: 30}, (_, i) => 21 + i * 3);
// Salamander layers kept (of 16) and their velocity centres from the library's own .sfz.
const LAYERS = [
  {name: 'v4', centre: 40 / 127}, {name: 'v7', centre: 53.5 / 127}, {name: 'v10', centre: 76.5 / 127},
  {name: 'v13', centre: 100.5 / 127}, {name: 'v16', centre: 124 / 127},
];
const grandLength = n => n <= 36 ? 16 : n <= 55 ? 12 : n <= 72 ? 9 : n <= 84 ? 6 : 4;
const harpLength = n => n < 48 ? 5 : n < 72 ? 4 : 3;

function decode(file, seconds) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-t', String(seconds), '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], {maxBuffer: 1 << 28});
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}
// Loudness of the attack: the loudest 50 ms RMS window in the first half second.
function attackRms(x) {
  const win = 2205;
  let best = 0;
  for (let s = 0; s + win <= Math.min(x.length, 22050); s += 1102) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += x[i] * x[i];
    best = Math.max(best, Math.sqrt(e / win));
  }
  return best;
}
function encode(src, dest, seconds, {fade = 1.5, quality = 2, gain = 1} = {}) {
  mkdirSync(dirname(dest), {recursive: true});
  const filters = [`pan=mono|c0=0.5*c0+0.5*c1`, `atrim=0:${seconds}`, `afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}:curve=exp`];
  if (gain !== 1) filters.push(`volume=${gain}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', filters.join(','), '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', String(quality), dest]);
  return statSync(dest).size;
}
const db = x => 20 * Math.log10(x);
let total = 0;

// ── Grand piano ──
const out = join(ROOT, 'public/samples/grand');
const levels = {};
for (const layer of LAYERS) {
  const rms = [];
  for (const n of GRAND_NOTES) {
    const src = join(salDir, `${salName(n)}${layer.name}.wav`);
    rms.push(attackRms(decode(src, .6)));
    total += encode(src, join(out, layer.name, `${n}.mp3`), grandLength(n));
  }
  levels[layer.name] = rms;
}
const ref = levels.v16;
const layers = LAYERS.map(l => ({
  ...l, centre: +l.centre.toFixed(3),
  // Mean loudness relative to the loudest layer, note by note (dB averaged, then linear).
  level: +Math.pow(10, levels[l.name].reduce((s, r, i) => s + db(r / ref[i]), 0) / GRAND_NOTES.length / 20).toFixed(4),
}));
// Release (damper / hammer return) noises, one per key; kept short.
const RELEASE_NOTES = Array.from({length: 88}, (_, i) => 21 + i);
let relPeak = 0;
for (const n of RELEASE_NOTES) {
  const src = join(salDir, `rel${n - 20}.wav`);
  relPeak = Math.max(relPeak, attackRms(decode(src, .6)));
  total += encode(src, join(out, 'release', `${n}.mp3`), .6, {fade: .25, quality: 6});
}
// dB range a velocity curve should span to match the layers' natural loudness.
const fit = layers.map(l => ({v: l.centre, dB: db(l.level)}));
let bestRange = 30, bestErr = Infinity;
for (let r = 15; r <= 50; r += .5) {
  const err = fit.reduce((s, p) => s + Math.pow(-r * (1 - p.v) * (1 - p.v * .35) - p.dB, 2), 0);
  if (err < bestErr) { bestErr = err; bestRange = r; }
}

// ── Harpsichord (VCSL French, CC0). File names use the VCSL octave (C3 = middle C), so +1 octave. ──
const harpOut = join(ROOT, 'public/samples/harpsichord');
const vcslMidi = name => {
  const m = /_(?:Normal|Rel)_([A-G])(s?)(\d)_/.exec(name);
  return m ? (NAMES.indexOf(m[1] + (m[2] ? '#' : '')) + 12 * (+m[3] + 2)) : null;
};
const harp = {sus: [], rel: []};
const harpRms = [];
for (const kind of ['sus', 'rel']) {
  for (const f of readdirSync(join(vcslDir, kind)).filter(f => f.endsWith('.wav')).sort()) {
    const n = vcslMidi(f);
    if (n == null || harp[kind].includes(n)) continue;
    const src = join(vcslDir, kind, f);
    if (kind === 'sus') harpRms.push(attackRms(decode(src, .6)));
    total += kind === 'sus' ? encode(src, join(harpOut, 'sus', `${n}.mp3`), harpLength(n), {fade: .8}) : encode(src, join(harpOut, 'rel', `${n}.mp3`), .5, {fade: .2, quality: 6});
    harp[kind].push(n);
  }
  harp[kind].sort((a, b) => a - b);
}

const size = dir => readdirSync(dir, {recursive: true}).reduce((s, f) => { const st = statSync(join(dir, f)); return s + (st.isFile() ? st.size : 0); }, 0);
const manifest = {
  generated: 'src/audio/build-samples.mjs',
  grand: {
    base: 'samples/grand/', notes: GRAND_NOTES, layers, rangeDb: bestRange,
    release: {dir: 'release', notes: RELEASE_NOTES, level: +(.0158 / Math.max(1e-4, relPeak / ref[15])).toFixed(4)},
    bytes: size(out),
  },
  harpsichord: {
    base: 'samples/harpsichord/', notes: harp.sus, layers: [{name: 'sus', centre: 1, level: 1}],
    release: {dir: 'rel', notes: harp.rel, level: .5},
    level: +(Math.pow(10, harpRms.reduce((s, r) => s + db(r), 0) / harpRms.length / 20)).toFixed(4),
    bytes: size(harpOut),
  },
};
manifest.grand.level = +(Math.pow(10, ref.reduce((s, r) => s + db(r), 0) / ref.length / 20)).toFixed(4);
writeFileSync(join(ROOT, 'src/audio/sample-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({layers, rangeDb: bestRange, relPeak, harp: harp.sus.length + '/' + harp.rel.length, totalMB: (total / 1e6).toFixed(2)}, null, 1));
