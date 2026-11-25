import {describe, it, expect} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {nearestSample, layerWeights, velocityLevel, layerGain, panForNote, equalPowerGains, dampTime, UNDAMPED_FROM,
  resonanceSends, combDelay, combFeedback, chooseInstrument} from '../src/audio/layers.js';
import {detectPitch, createNoteTracker, freqToMidi, midiToFreq, trackerGates} from '../src/audio/pitch.js';
import {hallImpulse} from '../src/audio/reverb.js';
import {tickSpec, METRONOME_SOUNDS} from '../src/audio/metronome.js';
import manifest from '../src/audio/sample-manifest.json';

const CENTRES = manifest.grand.layers.map(l => l.centre);

describe('velocity layers', () => {
  it('plays one layer near a layer centre', () => {
    for (let i = 0; i < CENTRES.length; i++) expect(layerWeights(CENTRES[i], CENTRES)).toEqual([{layer: i, w: 1}]);
  });
  it('clamps below the softest and above the loudest layer', () => {
    expect(layerWeights(0, CENTRES)).toEqual([{layer: 0, w: 1}]);
    expect(layerWeights(1, CENTRES)).toEqual([{layer: CENTRES.length - 1, w: 1}]);
  });
  it('crossfades with equal power around the midpoint of two layers', () => {
    const mid = (CENTRES[2] + CENTRES[3]) / 2;
    const w = layerWeights(mid, CENTRES);
    expect(w.map(x => x.layer)).toEqual([2, 3]);
    expect(w[0].w).toBeCloseTo(Math.SQRT1_2, 6);
    expect(w[0].w ** 2 + w[1].w ** 2).toBeCloseTo(1, 9);
    // Monotonic: the upper layer's weight rises through the zone.
    let prev = -1;
    for (let v = mid - .04; v <= mid + .04; v += .005) {
      const ws = layerWeights(v, CENTRES);
      const up = ws.find(x => x.layer === 3)?.w ?? 0;
      expect(up).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(ws.reduce((s, x) => s + x.w * x.w, 0)).toBeCloseTo(1, 9);
      prev = up;
    }
  });
  it('outside the zone only the nearer layer sounds', () => {
    expect(layerWeights(CENTRES[2] + .02, CENTRES)).toEqual([{layer: 2, w: 1}]);
    expect(layerWeights(CENTRES[3] - .02, CENTRES)).toEqual([{layer: 3, w: 1}]);
  });
  it('skips layers that have not loaded yet', () => {
    const available = [false, false, true, false, false];
    for (const v of [0, .3, .6, .8, 1]) expect(layerWeights(v, CENTRES, {available})).toEqual([{layer: 2, w: 1}]);
    expect(layerWeights(.9, CENTRES, {available: [false, false, true, true, false]})).toEqual([{layer: 3, w: 1}]);
    expect(layerWeights(.5, CENTRES, {available: [false, false, false, false, false]})).toEqual([]);
  });
  it('loudness rises smoothly with velocity and gain compensates each layer', () => {
    let prev = 0;
    for (let v = 0; v <= 1; v += .05) { const l = velocityLevel(v, manifest.grand.rangeDb); expect(l).toBeGreaterThan(prev); prev = l; }
    expect(velocityLevel(1)).toBeCloseTo(1, 9);
    expect(20 * Math.log10(velocityLevel(0, 30))).toBeCloseTo(-30, 6);
    const l = manifest.grand.layers[1];
    expect(layerGain(.5, l.level, 20) * l.level).toBeCloseTo(velocityLevel(.5, 20), 9);
  });
});

describe('sample maps', () => {
  it('finds the nearest recorded note and the pitch-shift ratio', () => {
    const notes = manifest.grand.notes;
    expect(nearestSample(60, notes)).toEqual({note: 60, rate: 1});
    expect(nearestSample(61, notes).note).toBe(60);
    expect(nearestSample(62, notes).note).toBe(63);
    expect(nearestSample(62, notes).rate).toBeCloseTo(Math.pow(2, -1 / 12), 12);
    for (let n = 21; n <= 108; n++) expect(Math.abs(nearestSample(n, notes).note - n)).toBeLessThanOrEqual(1);
  });
  it('every sample in the manifest exists on disk', () => {
    for (const kind of ['grand', 'harpsichord']) {
      const d = manifest[kind];
      for (const l of d.layers) for (const n of d.notes) expect(existsSync(`public/${d.base}${l.name}/${n}.mp3`), `${kind} ${l.name} ${n}`).toBe(true);
      for (const n of d.release.notes) expect(existsSync(`public/${d.base}${d.release.dir}/${n}.mp3`)).toBe(true);
    }
  });
  it('keeps the download modest', () => {
    expect((manifest.grand.bytes + manifest.harpsichord.bytes) / 1e6).toBeLessThan(25);
  });
});

describe('stereo and damping', () => {
  it('pans low notes left and high notes right, equal power', () => {
    expect(panForNote(21)).toBeLessThan(0);
    expect(panForNote(108)).toBeGreaterThan(0);
    expect(Math.abs(panForNote(64.5))).toBeLessThan(1e-9);
    for (const p of [-1, -.5, 0, .3, 1]) { const g = equalPowerGains(p); expect(g.left ** 2 + g.right ** 2).toBeCloseTo(1, 12); }
    expect(equalPowerGains(0).left).toBeCloseTo(Math.SQRT1_2, 12);
  });
  it('damps bass slower than treble, and leaves the top strings undamped', () => {
    expect(dampTime(30)).toBeGreaterThan(dampTime(60));
    expect(dampTime(60)).toBeGreaterThan(dampTime(85));
    expect(dampTime(UNDAMPED_FROM)).toBe(Infinity);
  });
});

describe('sympathetic resonance routing', () => {
  it('sends a note to its own string, the fifth and the major third', () => {
    const c = resonanceSends(60);
    expect(c[0]).toBe(1);
    expect(c[7]).toBeCloseTo(.45);
    expect(c[4]).toBeCloseTo(.22);
    expect(c.filter(Boolean).length).toBe(3);
    const a = resonanceSends(57); // A → A, E, C#
    expect(a[9]).toBe(1); expect(a[4]).toBeCloseTo(.45); expect(a[1]).toBeCloseTo(.22);
  });
  it('tunes each comb to its pitch class and decays in the asked time', () => {
    const {freq, delay} = combDelay(9, 48000); // A2
    expect(freq).toBeCloseTo(110, 6);
    expect(delay).toBeCloseTo(1 / 110, 9);
    const g = combFeedback(delay, 1.3);
    // After t60 seconds of round trips the level is −60 dB.
    expect(20 * Math.log10(Math.pow(g, 1.3 / delay))).toBeCloseTo(-60, 6);
    // Every comb's loop is longer than one render quantum (Web Audio's minimum delay in a cycle).
    for (let pc = 0; pc < 12; pc++) expect(combDelay(pc).delay).toBeGreaterThan(128 / 44100);
  });
});

describe('instrument choice', () => {
  const catalog = JSON.parse(readFileSync('public/songs/catalog.json', 'utf8')).songs;
  it('Auto picks the harpsichord for Bach and other Baroque entries', () => {
    expect(chooseInstrument('auto', {composer: 'Johann Sebastian Bach (Notebook for Anna Magdalena Bach)'})).toBe('harpsichord');
    expect(chooseInstrument('auto', {composer: 'Christian Petzold (attr.)', title: 'Minuet in G, BWV Anh. 114'})).toBe('harpsichord');
    expect(chooseInstrument('auto', {composer: 'Frédéric Chopin'})).toBe('piano');
    expect(chooseInstrument('auto', {composer: 'Robert Schumann', period: 'Romantic'})).toBe('piano');
    expect(chooseInstrument('auto', {composer: 'Anon.', period: 'Baroque'})).toBe('harpsichord');
    expect(chooseInstrument('auto', null)).toBe('piano');
    const harp = catalog.filter(e => chooseInstrument('auto', e) === 'harpsichord');
    expect(harp.length).toBeGreaterThan(0);
    expect(harp.every(e => /Bach|Petzold|Handel/.test(e.composer))).toBe(true); // the Baroque pieces
  });
  it('an explicit choice wins', () => {
    expect(chooseInstrument('piano', {composer: 'Johann Sebastian Bach'})).toBe('piano');
    expect(chooseInstrument('harpsichord', {composer: 'Chopin'})).toBe('harpsichord');
  });
});

// ── Pitch detection ──
const RATE = 48000;
function sine(f, n = 2048, amp = .3, phase = 0) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / RATE + phase);
  return x;
}
// Piano-like: stretched (inharmonic) partials with falling amplitude, a decay and a little noise.
function pianoLike(midi, {n = 2048, start = 0, amp = .3, B = .0004, weakFundamental = false, noise = .003, seed = 1} = {}) {
  const f0 = midiToFreq(midi), x = new Float32Array(n);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 * 2 - 1; };
  for (let k = 1; k <= 10; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > RATE / 2.2) break;
    const a = (k === 1 && weakFundamental ? .15 : 1) / k;
    for (let i = 0; i < n; i++) x[i] += amp * a * Math.sin(2 * Math.PI * fk * (i + start) / RATE + k);
  }
  for (let i = 0; i < n; i++) x[i] = x[i] * Math.exp(-(i + start) / RATE * 1.5) + noise * rnd();
  return x;
}

describe('pitch detection (YIN)', () => {
  it('finds sine pitches across the keyboard within a few cents', () => {
    for (const midi of [33, 40, 48, 57, 60, 69, 76, 84, 93, 96]) {
      const p = detectPitch(sine(midiToFreq(midi)), RATE, {threshold: .12});
      expect(Math.abs(freqToMidi(p.freq) - midi) * 100, `midi ${midi}`).toBeLessThan(5);
      expect(p.clarity).toBeGreaterThan(.9);
    }
  });
  it('names piano-like tones (inharmonic partials, noise) to the right semitone', () => {
    let hit = 0, total = 0;
    for (let midi = 36; midi <= 96; midi++) {
      total++;
      const p = detectPitch(pianoLike(midi), RATE, {threshold: .12, maxFreq: 2100});
      if (Math.round(freqToMidi(p.freq)) === midi) hit++;
    }
    expect(hit / total).toBeGreaterThanOrEqual(.95);
  });
  it('copes with a weak fundamental (strong octave partial)', () => {
    let hit = 0;
    for (let midi = 40; midi <= 80; midi++) if (Math.round(freqToMidi(detectPitch(pianoLike(midi, {weakFundamental: true}), RATE, {threshold: .12}).freq)) === midi) hit++;
    expect(hit / 41).toBeGreaterThanOrEqual(.85);
  });
  it('reports silence and noise as unvoiced', () => {
    expect(detectPitch(new Float32Array(2048), RATE).freq).toBe(0);
    let s = 3; const noise = new Float32Array(2048).map(() => { s = (s * 16807) % 2147483647; return (s / 2147483647 - .5) * .2; });
    const p = detectPitch(noise, RATE);
    expect(p.freq === 0 || p.clarity < trackerGates(.5).minClarity).toBe(true);
  });
});

describe('note tracker', () => {
  const frames = (midi, count, opts = {}) => Array.from({length: count}, (_, i) => detectPitch(pianoLike(midi, {start: i * 1024, ...opts}), RATE, {threshold: .12}));
  const silent = count => Array.from({length: count}, () => ({freq: 0, clarity: 0, rms: 0}));
  it('emits one note-on per held note, then note-off after silence', () => {
    const t = createNoteTracker();
    const ev = [...frames(60, 30), ...silent(6), ...frames(64, 20), ...silent(6)].flatMap((f, i) => t.push(f, i));
    expect(ev.filter(e => e.type === 'on').map(e => e.note)).toEqual([60, 64]);
    expect(ev.filter(e => e.type === 'off').map(e => e.note)).toEqual([60, 64]);
  });
  it('needs a few stable frames (ignores a one-frame blip)', () => {
    const t = createNoteTracker();
    const ev = [...frames(60, 1), ...silent(5), ...frames(62, 2), ...silent(5)].flatMap((f, i) => t.push(f, i));
    expect(ev).toEqual([]);
  });
  it('a melody moving straight from note to note gives every note', () => {
    const t = createNoteTracker();
    const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60];
    const ev = melody.flatMap(m => frames(m, 10)).flatMap((f, i) => t.push(f, i));
    expect(ev.filter(e => e.type === 'on').map(e => e.note)).toEqual(melody);
  });
  it('hears the same key struck again (a new attack over the decaying tail)', () => {
    const t = createNoteTracker();
    const a = frames(67, 30), b = frames(67, 15);
    const ev = [...a, ...b].flatMap((f, i) => t.push(f, i));
    expect(ev.filter(e => e.type === 'on').map(e => e.note)).toEqual([67, 67]);
  });
  it('a slow swell (beating unison strings) is not a new attack', () => {
    const t = createNoteTracker();
    const base = frames(81, 40);
    // Level dips and swells back ×2 over several frames, as beating strings do.
    const swell = base.map((f, i) => ({...f, rms: f.rms * (i > 8 ? 1 + .5 * Math.sin((i - 8) / 6) : 1)}));
    expect(swell.flatMap((f, i) => t.push(f, i)).filter(e => e.type === 'on').length).toBe(1);
  });
  it('a fading tail flickering around the gate does not re-trigger the note', () => {
    const t = createNoteTracker();
    const f = frames(72, 1)[0];
    const seq = [...frames(72, 10), ...silent(5), {...f, rms: .002}, {...f, rms: .002}, {...f, rms: .002}, {...f, rms: .002}, ...silent(5)];
    expect(seq.flatMap((x, i) => t.push(x, i)).filter(e => e.type === 'on').length).toBe(1);
  });
  it('times each note at the first frame of its attack', () => {
    const t = createNoteTracker();
    const ev = [...silent(4), ...frames(64, 10)].flatMap((f, i) => t.push(f, i * 21));
    expect(ev[0]).toMatchObject({type: 'on', note: 64, time: 4 * 21});
  });
  it('sensitivity gates soft notes', () => {
    const soft = frames(60, 10, {amp: .004, noise: 0});
    const deaf = createNoteTracker({sensitivity: 0}), keen = createNoteTracker({sensitivity: 1});
    expect(soft.flatMap(f => deaf.push(f))).toEqual([]);
    expect(soft.flatMap(f => keen.push(f)).filter(e => e.type === 'on').length).toBe(1);
  });
});

describe('room and metronome', () => {
  it('the hall impulse is deterministic, stereo-decorrelated and decays', () => {
    const [l, r] = hallImpulse(16000, {seconds: 1.5, rt60: 1.2});
    const [l2] = hallImpulse(16000, {seconds: 1.5, rt60: 1.2});
    expect(l).toEqual(l2);
    const energy = (x, a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e; };
    const early = energy(l, 0, 4000), late = energy(l, 16000, 20000);
    expect(late).toBeLessThan(early / 100);
    let dot = 0; for (let i = 0; i < l.length; i++) dot += l[i] * r[i];
    expect(Math.abs(dot) / Math.sqrt(energy(l, 0, l.length) * energy(r, 0, r.length))).toBeLessThan(.5);
    expect(Math.abs(l[l.length - 1])).toBeLessThan(1e-3); // no click at the end
  });
  it('every metronome sound accents the downbeat', () => {
    for (const k of METRONOME_SOUNDS) {
      const a = tickSpec(k, true), b = tickSpec(k, false);
      expect(a.level).toBeGreaterThan(b.level);
      expect(a.modes[0].freq).toBeGreaterThan(b.modes[0].freq);
    }
  });
});
