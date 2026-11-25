// The app's instruments: a sampled grand piano and a harpsichord, with a room,
// sympathetic pedal resonance, a limiter and the metronome.
//
// Grand: Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0), five of its 16
// velocity layers, one recording every minor third, folded to mono and panned by
// pitch. The layer is picked by velocity with equal-power crossfades between
// neighbours (src/audio/layers.js). The middle layer loads first so the first note
// sounds quickly; the others follow in the background or when a velocity needs them.
// If the layered set can't load, the original single-layer set (samples/piano/)
// is the fallback. Harpsichord: VCSL "Harpsichord, French" (Versilian Studios, CC0).
//
//   const piano = createPiano(onError);
//   piano.tone(midi, seconds, velocity 0…1, delay, {pedal, key})
//     seconds = how long the string is undamped (key or pedal), key = how long the
//     key itself is held (the harpsichord, which has no pedal, uses this one).
//   piano.silence() · load() · setMuted(v) · click(delay, accent) · stopClicks() · setClickVolume(v)
//   piano.setInstrument('auto'|'piano'|'harpsichord') · setSong(catalogEntry) · setRoom(0…1)
//   piano.setMetronomeSound('wood'|'click'|'beep') · setPedal(down) · meter() (peak metering)
//   piano.setProfile('auto'|'light'|'full') · memory() → {bytes, sets: {grand, harpsichord, fallback}}
//     'light' (small-memory devices, src/audio/budget.js) keeps three of the five grand layers,
//     loaded nearest-to-mezzo-forte first; 'full' is the desktop behaviour described above.
import manifest from './audio/sample-manifest.json';
import {nearestSample, layerWeights, layerGain, velocityLevel, panForNote, dampTime, UNDAMPED_FROM,
  resonanceSends, combDelay, combFeedback, chooseInstrument} from './audio/layers.js';
import {allowedLayers, decodedBytes, layerLoadOrder, pianoProfile} from './audio/budget.js';
import {hallImpulse} from './audio/reverb.js';
import {playTick} from './audio/metronome.js';

const BASE = (import.meta.env?.BASE_URL ?? '/');
const FALLBACK_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3',
  'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
const HEADROOM = .42;          // instrument bus level: ten-note chords stay below the limiter most of the time
const GRAND_REF = manifest.grand.level;
const RESONANCE_SEND = .07; // measured: the halo sits ≈ 25 dB under the struck note (offline render)
const HARP_GAIN = GRAND_REF * .5 / manifest.harpsichord.level;

const deviceInfo = () => (typeof navigator === 'undefined' ? {} : {deviceMemory: navigator.deviceMemory, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints});

export function createPiano(onError = () => {}, {context = null, profile: profileSetting = 'auto', device = deviceInfo()} = {}) {
  let ctx = null, master = null, bus = null, dry = null, wet = null, clickOut = null, limiter = null, post = null;
  let muted = false, clickVolume = .6, room = .35, metroSound = 'wood';
  let instrumentSetting = 'auto', song = null, pedalDown = false;
  const voices = new Set();
  const byNote = new Map();               // midi -> Set of voices, for re-striking the same string
  const sets = {grand: null, harpsichord: null, fallback: null}; // loaded sample sets
  let resonance = null;                   // lazily built comb bank
  let releaseCount = [];                  // recent release-noise times (keeps dense chords from clattering)
  let lastStrike = 0;                     // audio-clock time of the latest strike (for the mic's echo gate)
  let profile = pianoProfile(profileSetting, device);               // 'light' | 'full'
  const grandCentres = manifest.grand.layers.map(l => l.centre);
  const allowedMask = () => { const ok = new Set(allowedLayers(grandCentres.length, profile)); return grandCentres.map((c, i) => ok.has(i)); };
  let allowed = allowedMask();

  // ───────── Graph ─────────
  function softClipCurve() {
    // Transparent below 0.8, then a smooth knee to ±1: the last guard after the limiter.
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      c[i] = Math.sign(x) * (a <= .8 ? a : .8 + .2 * Math.tanh((a - .8) / .2));
    }
    return c;
  }
  function setup() {
    if (ctx) return;
    ctx = context || new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
    bus = ctx.createGain(); bus.gain.value = HEADROOM;
    dry = ctx.createGain();
    const verb = ctx.createConvolver();
    const [l, r] = hallImpulse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
    ir.getChannelData(0).set(l); ir.getChannelData(1).set(r);
    verb.normalize = false;
    verb.buffer = ir;
    wet = ctx.createGain();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 20;
    limiter.attack.value = .002; limiter.release.value = .15;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1;
    post = ctx.createWaveShaper(); post.curve = softClipCurve();
    bus.connect(dry); bus.connect(verb); verb.connect(wet);
    dry.connect(limiter); wet.connect(limiter);
    limiter.connect(master); master.connect(post); post.connect(ctx.destination);
    // Metronome: its own level, past the room and the limiter (but through the final guard).
    clickOut = ctx.createGain();
    clickOut.gain.value = muted ? 0 : clickVolume;
    clickOut.connect(post);
    applyRoom();
  }
  function applyRoom() {
    if (!ctx) return;
    // Dry/wet: the room never swallows the direct sound.
    dry.gain.setTargetAtTime(1 - room * .35, ctx.currentTime, .05);
    wet.gain.setTargetAtTime(room * .9, ctx.currentTime, .05);
  }

  // Sympathetic resonance: 12 tuned combs (one per pitch class, C2…B2), fed only
  // while the pedal is down, at a low, darkened level. Built on first use.
  function resonanceBank() {
    if (resonance) return resonance;
    const input = [], out = ctx.createGain();
    out.gain.value = .5;
    const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 2600;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const combs = [];
    for (let pc = 0; pc < 12; pc++) {
      const {delay, freq} = combDelay(pc, ctx.sampleRate);
      const inG = ctx.createGain(); inG.gain.value = 1;
      const d = ctx.createDelay(.05); d.delayTime.value = delay;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(5000, freq * 24); lp.Q.value = -6; // no resonant peak: loop gain stays below 1
      const fb = ctx.createGain(); fb.gain.value = combFeedback(delay, 1.3);
      inG.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      lp.connect(out);
      combs.push({inG, d, lp, fb});
    }
    // One send bus per pitch class, fanned out to the combs that share its partials.
    for (let pc = 0; pc < 12; pc++) {
      const send = ctx.createGain(); send.gain.value = RESONANCE_SEND;
      resonanceSends(pc).forEach((w, k) => {
        if (!w) return;
        const g = ctx.createGain(); g.gain.value = w;
        send.connect(g); g.connect(combs[k].inG);
      });
      input.push(send);
    }
    out.connect(pre); pre.connect(hp); hp.connect(bus);
    resonance = {input, out, combs};
    return resonance;
  }

  // ───────── Samples ─────────
  // Skip the encoder's leading silence so chord notes start together.
  function onset(buffer) {
    const d = buffer.getChannelData(0), limit = Math.min(d.length, buffer.sampleRate * .3);
    let peak = 0;
    for (let i = 0; i < limit; i++) peak = Math.max(peak, Math.abs(d[i]));
    const th = Math.max(.0008, peak * .03);
    for (let i = 0; i < limit; i++) if (Math.abs(d[i]) > th) return Math.max(0, i / buffer.sampleRate - .0015);
    return 0;
  }
  async function fetchBuffer(url) {
    const r = await fetch(url);
    if (!r.ok) throw Error('Missing sample ' + url);
    const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
    return {buffer, offset: onset(buffer)};
  }
  // Load a list of files with limited parallelism (the iPad decodes faster that way).
  async function loadAll(items, run, width = 6) {
    let i = 0;
    await Promise.all(Array.from({length: width}, async () => { while (i < items.length) await run(items[i++]); }));
  }
  function makeSet(kind) {
    const def = manifest[kind];
    return {kind, def, layers: def.layers.map(() => new Map()), ready: def.layers.map(() => false),
      loading: def.layers.map(() => null), release: new Map(), releaseLoading: null};
  }
  // A grand layer the memory profile leaves out never loads (and one dropped mid-load stops filling).
  const layerAllowed = (set, i) => set.kind !== 'grand' || allowed[i];
  function loadLayer(set, i) {
    if (!layerAllowed(set, i)) return Promise.resolve();
    if (!set.loading[i]) {
      const dir = set.def.base + set.def.layers[i].name + '/';
      set.loading[i] = loadAll(set.def.notes, async n => {
        const sample = await fetchBuffer(BASE + dir + n + '.mp3');
        if (layerAllowed(set, i)) set.layers[i].set(n, sample);
      })
        .then(() => { if (layerAllowed(set, i)) set.ready[i] = true; else set.layers[i].clear(); })
        .catch(e => { set.loading[i] = null; throw e; });
    }
    return set.loading[i];
  }
  function loadReleases(set) {
    set.releaseLoading ??= loadAll(set.def.release.notes, async n => set.release.set(n, await fetchBuffer(BASE + set.def.base + set.def.release.dir + '/' + n + '.mp3')), 4)
      .catch(() => {}); // release noises are optional
    return set.releaseLoading;
  }
  function loadFallback() {
    if (!sets.fallback) {
      const map = new Map();
      sets.fallback = {kind: 'fallback', map, loading: Promise.all(FALLBACK_NAMES.map(async (name, i) => map.set(21 + i * 3, await fetchBuffer(BASE + 'samples/piano/' + name + '.mp3'))))};
    }
    return sets.fallback.loading;
  }
  // The grand: middle layer first (that is the one most notes use), then its
  // neighbours and the release noises in the background. The softest and loudest
  // layers load when a velocity first asks for them.
  // Lighter profile: its three layers nearest-first (mezzo forte, then the others
  // in the background), the release noises right after the first.
  function backgroundLayers(g) {
    if (profile === 'light') {
      const [, ...rest] = layerLoadOrder(grandCentres, allowedLayers(grandCentres.length, profile));
      rest.reduce((p, i) => p.then(() => loadLayer(g, i)), loadReleases(g)).catch(() => {});
    } else Promise.resolve().then(() => loadLayer(g, 3)).then(() => loadReleases(g)).then(() => loadLayer(g, 1)).catch(() => {});
  }
  let loading = null;
  function load() {
    setup();
    loading ??= (async () => {
      sets.grand ??= makeSet('grand');
      const g = sets.grand, first = layerLoadOrder(grandCentres, allowedLayers(grandCentres.length, profile))[0] ?? 2;
      try { await loadLayer(g, first); }
      catch (e) { await loadFallback().catch(err => { loading = null; onError(err); throw err; }); return; }
      backgroundLayers(g);
      if (effectiveInstrument() === 'harpsichord') loadHarpsichord();
    })().catch(() => {});
    return loading;
  }
  // Switching profile: a lighter grand drops the layers it leaves out (freeing their memory);
  // a full one fetches its usual background layers again.
  function setProfile(setting) {
    const next = pianoProfile(setting, device);
    if (next === profile) return;
    profile = next;
    allowed = allowedMask();
    const g = sets.grand;
    if (!g) return;
    g.def.layers.forEach((l, i) => { if (!allowed[i]) { g.layers[i].clear(); g.ready[i] = false; g.loading[i] = null; } });
    if (g.ready.some(Boolean)) {
      const first = layerLoadOrder(grandCentres, allowedLayers(grandCentres.length, profile))[0];
      loadLayer(g, first).then(() => backgroundLayers(g)).catch(() => {});
    }
  }
  // Decoded sample memory (4 bytes per sample per channel), per instrument.
  function memory() {
    const count = set => (set?.layers ?? []).map(m => m.size);
    const grand = sets.grand, harp = sets.harpsichord, fb = sets.fallback;
    const bufs = set => [...(set?.layers ?? []).flatMap(m => [...m.values()]), ...(set?.release?.values() ?? [])].map(x => x.buffer);
    const out = {
      grand: {profile, layers: manifest.grand.layers.length, allowed: allowed.filter(Boolean).length,
        ready: grand?.ready.filter(Boolean).length ?? 0, samples: count(grand), releases: grand?.release.size ?? 0, bytes: decodedBytes(bufs(grand))},
      harpsichord: {ready: !!harp?.ready[0], samples: count(harp), releases: harp?.release.size ?? 0, bytes: decodedBytes(bufs(harp))},
      fallback: {ready: !!fb, samples: fb?.map.size ?? 0, bytes: decodedBytes([...(fb?.map.values() ?? [])].map(x => x.buffer))},
    };
    return {bytes: out.grand.bytes + out.harpsichord.bytes + out.fallback.bytes, sets: out};
  }
  function loadHarpsichord() {
    sets.harpsichord ??= makeSet('harpsichord');
    const h = sets.harpsichord;
    return loadLayer(h, 0).then(() => loadReleases(h)).catch(e => onError(e));
  }

  // ───────── Instruments ─────────
  function effectiveInstrument() { return chooseInstrument(instrumentSetting, song); }
  function setInstrument(v) {
    instrumentSetting = ['auto', 'piano', 'harpsichord'].includes(v) ? v : 'auto';
    if (ctx && effectiveInstrument() === 'harpsichord') loadHarpsichord();
  }
  function setSong(entry) {
    song = entry || null;
    if (ctx && effectiveInstrument() === 'harpsichord') loadHarpsichord();
  }

  // ───────── Voices ─────────
  function damp(voice, when, time = .08) {
    try {
      voice.g.gain.cancelScheduledValues(when);
      voice.g.gain.setValueAtTime(voice.g.gain.value, when);
      voice.g.gain.setTargetAtTime(0, when, time / 3);
      for (const s of voice.srcs) s.stop(when + time * 2);
    } catch {}
  }
  function startSource(sample, rate, when, dest) {
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start(when, sample.offset);
    return src;
  }
  function panner(n, width) {
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = panForNote(n, width); return p; }
    return ctx.createGain(); // very old browsers: centred
  }
  function releaseNoise(set, n, when, level) {
    const sample = set?.release.get(nearestSample(n, set.def.release.notes).note);
    if (!sample) return;
    releaseCount = releaseCount.filter(t => Math.abs(t - when) < .05);
    if (releaseCount.length >= 4) return; // a whole chord lifting: a few noises are enough
    releaseCount.push(when);
    const g = ctx.createGain();
    g.gain.value = level;
    const p = panner(n, .6);
    const src = startSource(sample, nearestSample(n, set.def.release.notes).rate, when, g);
    g.connect(p); p.connect(bus);
    src.onended = () => { src.disconnect(); g.disconnect(); p.disconnect(); };
  }

  // Play MIDI note n with the string undamped for d seconds, then damp it.
  // `delay` (seconds) schedules the strike on the audio clock.
  function tone(n, d = 1.5, velocity = .7, delay = 0, {pedal = pedalDown, key = null} = {}) {
    try {
      load();
      if (muted) return;
      if (ctx.state === 'suspended' && !context) ctx.resume();
      const now = ctx.currentTime + Math.max(0, delay);
      const harp = effectiveInstrument() === 'harpsichord' && sets.harpsichord?.ready[0];
      const v = Math.max(0, Math.min(1, +velocity || 0));

      // Re-striking a string that is still ringing damps the old vibration.
      for (const old of byNote.get(n) ?? []) damp(old, now, .05);

      const g = ctx.createGain(), srcs = [];
      let hold, tail, set = null, filter = null;
      if (harp) {
        set = sets.harpsichord;
        const {note, rate} = nearestSample(n, set.def.notes);
        const sample = set.layers[0].get(note);
        if (!sample) return;
        hold = Math.max(.08, key ?? d);             // no pedal on a harpsichord
        g.gain.setValueAtTime(HARP_GAIN * (.85 + .15 * v), now);
        srcs.push(startSource(sample, rate, now, g));
        g.gain.setValueAtTime(HARP_GAIN * (.85 + .15 * v), now + hold);
        g.gain.setTargetAtTime(0, now + hold, .03); // the damper cloth stops the string at once
        tail = .25;
        releaseNoise(set, n, now + hold, manifest.harpsichord.release.level * HARP_GAIN * .6);
      } else if (sets.grand?.ready.some(Boolean)) {
        set = sets.grand;
        const {note, rate} = nearestSample(n, set.def.notes);
        const weights = layerWeights(v, set.def.layers.map(l => l.centre), {available: set.ready});
        // Ask for the layer this velocity really wants, for next time.
        const want = layerWeights(v, grandCentres, {available: allowed})[0]?.layer;
        if (want != null && !set.ready[want]) loadLayer(set, want).catch(() => {});
        // A gentle tone colour for velocities between layers: brighter above the layer centre.
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const main = weights.reduce((a, b) => (b.w > a.w ? b : a), weights[0]);
        const centre = set.def.layers[main.layer].centre;
        filter.frequency.value = Math.max(2500, Math.min(20000, 11000 * Math.pow(2, (v - centre) * 4) + (n - 21) * 70));
        filter.Q.value = .4;
        for (const {layer, w} of weights) {
          const sample = set.layers[layer].get(note);
          if (!sample) continue;
          const lg = ctx.createGain();
          lg.gain.value = w * layerGain(v, set.def.layers[layer].level, set.def.rangeDb);
          srcs.push(startSource(sample, rate, now, lg));
          lg.connect(filter);
        }
        if (!srcs.length) return;
        filter.connect(g);
        hold = Math.max(.1, d);
        g.gain.setValueAtTime(1, now);
        const undamped = n >= UNDAMPED_FROM;
        if (!undamped) {
          g.gain.setValueAtTime(1, now + hold);
          g.gain.setTargetAtTime(0, now + hold, dampTime(n) / 3);
          releaseNoise(set, n, now + hold, set.def.release.level * velocityLevel(v, set.def.rangeDb));
        }
        tail = undamped ? Infinity : dampTime(n) * 2.5;
      } else if (sets.fallback) {
        const {note, rate} = nearestSample(n, [...sets.fallback.map.keys()]);
        const sample = sets.fallback.map.get(note);
        if (!sample) return;
        srcs.push(startSource(sample, rate, now, g));
        hold = Math.max(.1, d);
        const level = Math.pow(v, 1.6) * 1.6;
        g.gain.setValueAtTime(level, now);
        g.gain.setValueAtTime(level, now + hold);
        g.gain.setTargetAtTime(0, now + hold, dampTime(n) / 3);
        tail = dampTime(n) * 2.5;
      } else return; // still loading

      const p = panner(n, harp ? .45 : .7);
      g.connect(p); p.connect(bus);
      // Pedal down: every string is free, so this note feeds the sympathetic strings.
      let send = null;
      if (pedal && !harp && set) { send = resonanceBank().input[n % 12]; g.connect(send); }
      const end = Number.isFinite(tail) ? now + hold + tail : Infinity;
      if (Number.isFinite(end)) for (const s of srcs) s.stop(end);

      const voice = {srcs, g, n, at: now};
      voices.add(voice);
      if (!byNote.has(n)) byNote.set(n, new Set());
      byNote.get(n).add(voice);
      lastStrike = Math.max(lastStrike, now);
      let ended = 0;
      for (const s of srcs) s.onended = () => {
        if (++ended < srcs.length) return;
        for (const x of srcs) x.disconnect();
        filter?.disconnect(); g.disconnect(); p.disconnect();
        voices.delete(voice); byNote.get(n)?.delete(voice);
      };
    } catch (e) { onError(e); }
  }

  // Lift every damper: fade out everything that is sounding (and the sympathetic strings).
  function silence() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const v of voices) damp(v, now, .12);
    if (resonance) {
      resonance.out.gain.cancelScheduledValues(now);
      resonance.out.gain.setTargetAtTime(0, now, .04);
      resonance.out.gain.setTargetAtTime(.5, now + .4, .05);
    }
  }

  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .02);
    if (clickOut) clickOut.gain.setTargetAtTime(muted ? 0 : clickVolume, ctx.currentTime, .02);
    if (muted) silence();
  }

  // ───────── Metronome ─────────
  // A tick `delay` seconds from now; the bar's downbeat is accented.
  const clicks = new Set();
  function click(delay = 0, accent = false) {
    try {
      setup();
      if (muted) return;
      if (ctx.state === 'suspended' && !context) ctx.resume();
      const when = ctx.currentTime + Math.max(0, delay);
      for (const src of playTick(ctx, clickOut, when, accent, metroSound)) {
        clicks.add(src);
        const prev = src.onended;
        src.onended = e => { prev?.(e); clicks.delete(src); };
      }
    } catch (e) { onError(e); }
  }
  // Cancel ticks that are scheduled but have not sounded yet.
  function stopClicks() {
    if (!ctx) return;
    for (const src of clicks) try { src.stop(ctx.currentTime); } catch {}
  }
  function setClickVolume(v) {
    clickVolume = Math.max(0, Math.min(1, +v || 0));
    if (clickOut) clickOut.gain.setTargetAtTime(muted ? 0 : clickVolume, ctx.currentTime, .02);
  }

  // Peak meter for tests and diagnostics: at the final output ('out', after the
  // limiter and soft clip) or ahead of the limiter ('prelimit', dry + room).
  function meter({at = 'out'} = {}) {
    setup();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    const buf = new Float32Array(an.fftSize);
    const taps = at === 'prelimit' ? [dry, wet] : [post];
    for (const t of taps) t.connect(an);
    let peak = 0;
    const timer = setInterval(read, 20);
    function read() { an.getFloatTimeDomainData(buf); for (const x of buf) peak = Math.max(peak, Math.abs(x)); }
    return {get peak() { read(); return peak; }, reset() { peak = 0; }, stop() { clearInterval(timer); for (const t of taps) t.disconnect(an); }};
  }

  return {
    tone, silence, load, setMuted, click, stopClicks, setClickVolume,
    setInstrument, setSong, setPedal(v) { pedalDown = !!v; }, setProfile, memory,
    get profile() { return profile; },
    setRoom(v) { room = Math.max(0, Math.min(1, +v || 0)); applyRoom(); },
    setMetronomeSound(v) { metroSound = ['wood', 'click', 'beep'].includes(v) ? v : 'wood'; },
    meter,
    get instrument() { return effectiveInstrument(); },
    get muted() { return muted; },
    get context() { return ctx; },
    // For the microphone's echo gate: is the app itself sounding a fresh note right now?
    recentlyStruck(windowS = .35) { return !!ctx && voices.size > 0 && ctx.currentTime - lastStrike < windowS; },
    get loaded() { return {grand: sets.grand?.ready.slice() ?? [], harpsichord: sets.harpsichord?.ready[0] ?? false, fallback: !!sets.fallback, profile, allowed: allowed.slice()}; },
  };
}
