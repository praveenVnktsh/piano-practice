// Grand piano built from Salamander Grand Piano samples (CC-BY 3.0, Alexander Holm).
// One recording every three semitones; notes in between are pitch-shifted from
// the nearest sample. Velocity shapes both loudness and brightness, the way
// harder strikes on a real piano sound brighter, not just louder.

const SAMPLE_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3',
  'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
const SAMPLE_MIDI = SAMPLE_NAMES.map((_, i) => 21 + i * 3);
const BASE = import.meta.env.BASE_URL + 'samples/piano/';

export function createPiano(onError = () => {}) {
  let ctx = null, out = null, master = null, loading = null;
  const samples = new Map(); // midi -> {buffer, offset}
  const voices = new Set();
  const byNote = new Map(); // midi -> Set of voices, for re-striking the same string
  let muted = false;
  let clickOut = null, clickVolume = .6;

  function roomImpulse() {
    // Filtered, decaying noise with a short pre-delay: a soft, dark room rather than hiss.
    const rate = ctx.sampleRate, len = Math.floor(rate * 2.4), pre = Math.floor(rate * .018);
    const ir = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate;
        lp += (Math.random() * 2 - 1 - lp) * Math.max(.04, .5 * Math.exp(-t * 2.5)); // darkens over time
        d[i] = lp * Math.exp(-t * 2.6);
      }
    }
    return ir;
  }

  function setup() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
    master = ctx.createGain();
    master.gain.value = muted ? 0 : .9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 12; comp.ratio.value = 2; comp.attack.value = .01; comp.release.value = .25;
    const verb = ctx.createConvolver(), wet = ctx.createGain(), wetTone = ctx.createBiquadFilter();
    verb.buffer = roomImpulse();
    wet.gain.value = .22;
    wetTone.type = 'lowpass'; wetTone.frequency.value = 3500;
    out = ctx.createGain();
    out.connect(comp);
    out.connect(verb); verb.connect(wetTone); wetTone.connect(wet); wet.connect(comp);
    comp.connect(master); master.connect(ctx.destination);
    // Metronome: its own volume, straight to the speakers (not through the piano's room).
    clickOut = ctx.createGain();
    clickOut.gain.value = muted ? 0 : clickVolume;
    clickOut.connect(ctx.destination);
  }

  // Skip the encoder's leading silence so chord notes start together.
  function onset(buffer) {
    const d = buffer.getChannelData(0), limit = Math.min(d.length, buffer.sampleRate * .2);
    for (let i = 0; i < limit; i++) if (Math.abs(d[i]) > .004) return Math.max(0, i / buffer.sampleRate - .002);
    return 0;
  }

  // Download and decode samples (safe to call before any user gesture).
  function load() {
    setup();
    loading ??= Promise.all(SAMPLE_NAMES.map(async (name, i) => {
      const data = await fetch(BASE + name + '.mp3').then(r => { if (!r.ok) throw Error('Missing sample ' + name); return r.arrayBuffer(); });
      const buffer = await ctx.decodeAudioData(data);
      samples.set(SAMPLE_MIDI[i], {buffer, offset: onset(buffer)});
    })).catch(e => { loading = null; onError(e); });
    return loading;
  }

  function nearest(n) {
    let best = SAMPLE_MIDI[0];
    for (const s of SAMPLE_MIDI) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
    return best;
  }

  function damp(voice, when, time = .08) {
    try {
      voice.g.gain.cancelScheduledValues(when);
      voice.g.gain.setTargetAtTime(0, when, time / 3);
      voice.src.stop(when + time * 2);
    } catch {}
  }

  // Play MIDI note n with the key (or pedal) held for d seconds, then damp it.
  // `delay` (seconds) schedules the strike on the audio clock.
  function tone(n, d = 1.5, velocity = .7, delay = 0) {
    try {
      load();
      if (muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const s = nearest(n), sample = samples.get(s);
      if (!sample) return; // still loading
      const now = ctx.currentTime + Math.max(0, delay);

      // Re-striking a string that is still ringing damps the old vibration.
      for (const v of byNote.get(n) ?? []) damp(v, now, .05);

      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = Math.pow(2, (n - s) / 12);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400 + velocity * velocity * 12000 + (n - 21) * 40;
      filter.Q.value = .5;

      const g = ctx.createGain();
      const level = Math.pow(velocity, 1.6);
      const hold = Math.max(.1, d);
      const release = n < 45 ? .9 : n < 64 ? .55 : .35; // dampers stop treble strings faster
      g.gain.setValueAtTime(level, now);
      g.gain.setValueAtTime(level, now + hold);
      g.gain.setTargetAtTime(0, now + hold, release / 4);

      src.connect(filter); filter.connect(g); g.connect(out);
      src.start(now, sample.offset);
      src.stop(now + hold + release * 1.5);

      const voice = {src, g};
      voices.add(voice);
      if (!byNote.has(n)) byNote.set(n, new Set());
      byNote.get(n).add(voice);
      src.onended = () => {
        src.disconnect(); filter.disconnect(); g.disconnect();
        voices.delete(voice); byNote.get(n)?.delete(voice);
      };
    } catch (e) { onError(e); }
  }

  // Lift every damper: fade out everything that is sounding.
  function silence() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const v of voices) damp(v, now, .12);
  }

  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.setTargetAtTime(muted ? 0 : .9, ctx.currentTime, .02);
    if (clickOut) clickOut.gain.setTargetAtTime(muted ? 0 : clickVolume, ctx.currentTime, .02);
    if (muted) silence();
  }

  // A metronome tick `delay` seconds from now; the bar's downbeat is higher and louder.
  const clicks = new Set();
  function click(delay = 0, accent = false) {
    try {
      setup();
      if (muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const when = ctx.currentTime + Math.max(0, delay);
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = accent ? 1760 : 1175;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(accent ? 1 : .6, when + .002);
      g.gain.exponentialRampToValueAtTime(.001, when + .06);
      osc.connect(g); g.connect(clickOut);
      osc.start(when); osc.stop(when + .08);
      clicks.add(osc);
      osc.onended = () => { osc.disconnect(); g.disconnect(); clicks.delete(osc); };
    } catch (e) { onError(e); }
  }
  // Cancel ticks that are scheduled but have not sounded yet.
  function stopClicks() {
    if (!ctx) return;
    for (const osc of clicks) try { osc.stop(ctx.currentTime); } catch {}
  }
  function setClickVolume(v) {
    clickVolume = Math.max(0, Math.min(1, +v || 0));
    if (clickOut) clickOut.gain.setTargetAtTime(muted ? 0 : clickVolume, ctx.currentTime, .02);
  }

  return {tone, silence, load, setMuted, click, stopClicks, setClickVolume, get muted() { return muted; }};
}
