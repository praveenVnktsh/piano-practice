// Metronome voices, synthesised (nothing to download or license).
//   wood   a wood block: two inharmonic modes of a struck hardwood bar + a short
//          filtered tap; the downbeat is a higher, brighter block.
//   click  a dry, tight tick (filtered noise burst), accent louder and brighter.
//   beep   the classic electronic metronome: a short sine pip.
export const METRONOME_SOUNDS = ['wood', 'click', 'beep'];
const TICK_LEVEL = .5; // full click volume peaks near −6 dBFS, about a loud piano chord

// Parameters for one tick (pure, so the voicing is unit-tested).
export function tickSpec(kind, accent) {
  if (kind === 'click') return {
    kind, level: accent ? 1 : .62,
    noise: {freq: accent ? 5200 : 3800, q: 1.2, decay: accent ? .012 : .009},
    modes: [{freq: accent ? 2600 : 2100, gain: .25, decay: .01}],
  };
  if (kind === 'beep') return {
    kind, level: accent ? .55 : .36, noise: null,
    modes: [{freq: accent ? 1568 : 1046.5, gain: 1, decay: .045, sustain: .03}],
  };
  // Wood block: mode ratios of a free bar (1 : 2.76) and a fast decay.
  const f = accent ? 1180 : 880;
  return {
    kind: 'wood', level: accent ? 1 : .7,
    noise: {freq: f * 2.2, q: 2, decay: .006},
    modes: [{freq: f, gain: 1, decay: .055}, {freq: f * 2.76, gain: .38, decay: .022}, {freq: f * 5.4, gain: .1, decay: .01}],
  };
}

let noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .05), ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

// Schedule one tick at `when` into `out`. Returns the source nodes (so pending
// ticks can be cancelled) — the last one's onended fires when all are done.
export function playTick(ctx, out, when, accent, kind = 'wood') {
  const spec = tickSpec(kind, accent);
  const bus = ctx.createGain();
  bus.gain.value = spec.level * TICK_LEVEL;
  bus.connect(out);
  const sources = [];
  let end = when;
  for (const m of spec.modes) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = m.freq;
    const hold = m.sustain || 0;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(m.gain, when + .0008);
    if (hold) g.gain.setValueAtTime(m.gain, when + hold);
    g.gain.setTargetAtTime(0, when + hold + .0008, m.decay / 3);
    osc.connect(g); g.connect(bus);
    const stop = when + hold + m.decay * 2.5 + .01;
    osc.start(when); osc.stop(stop);
    end = Math.max(end, stop);
    sources.push({src: osc, nodes: [g]});
  }
  if (spec.noise) {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer(ctx);
    bp.type = 'bandpass'; bp.frequency.value = spec.noise.freq; bp.Q.value = spec.noise.q;
    g.gain.setValueAtTime(.9, when);
    g.gain.setTargetAtTime(0, when + .0005, spec.noise.decay / 3);
    src.connect(bp); bp.connect(g); g.connect(bus);
    const stop = when + spec.noise.decay * 2.5 + .01;
    src.start(when); src.stop(stop);
    sources.push({src, nodes: [bp, g]});
  }
  for (const s of sources) s.src.onended = () => { s.src.disconnect(); s.nodes.forEach(n => n.disconnect()); };
  // Disconnect the shared bus once the longest voice has finished.
  setTimeout(() => { try { bus.disconnect(); } catch {} }, Math.max(0, (end - ctx.currentTime) * 1000 + 200));
  return sources.map(s => s.src);
}
