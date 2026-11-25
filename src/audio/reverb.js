// A short, warm hall impulse response, generated (no recording, so nothing to
// license): sparse early reflections, then a dense noise tail that decays
// exponentially and darkens as it decays (air and walls absorb highs first).
// Deterministic for a given seed, so the room sounds the same every time.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

// → [left, right] Float32Arrays of length seconds × rate.
//   rt60       time to decay 60 dB (s) at low frequencies
//   predelay   gap before the first reflection (s)
//   brightness 0…1, how much treble the tail keeps
export function hallImpulse(rate, {seconds = 2.2, rt60 = 1.7, predelay = .016, brightness = .35, seed = 7} = {}) {
  const len = Math.max(1, Math.floor(seconds * rate));
  const out = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.floor(predelay * rate);
  // Early reflections: a handful of taps between 8 and 70 ms, slightly different per ear.
  const taps = [[.0, .0], [.0071, .0089], [.0113, .0127], [.0172, .0151], [.0233, .0261], [.0311, .0287], [.0397, .0421], [.0518, .0493]];
  for (let c = 0; c < 2; c++) {
    const r = rng(seed + c * 7919);
    const d = out[c];
    taps.forEach((t, i) => {
      const at = pre + Math.floor(t[c] * rate);
      if (at < len) d[at] += (i ? .55 : .8) * Math.pow(.82, i) * (r() > 0 ? 1 : -1);
    });
    // Diffuse tail: noise → one-pole lowpass whose cutoff falls with time.
    let lp = 0;
    const k = 6.91 / rt60; // e^(−k t) is −60 dB at rt60
    const fade = Math.floor(rate * .012);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const a = Math.max(.02, (.2 + .75 * brightness) * Math.exp(-t * 3.2)); // smoothing: darker over time
      lp += (r() - lp) * a;
      const onset = Math.min(1, (i - pre) / fade);                          // tail swells in over 12 ms
      const end = i > len - rate * .1 ? (len - i) / (rate * .1) : 1;          // no click at the end
      d[i] += lp * Math.exp(-k * t) * .9 * onset * end;
    }
  }
  // Normalise energy so the wet level means the same whatever the length.
  let e = 0;
  for (const d of out) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 || 1) * .5;
  for (const d of out) for (let i = 0; i < len; i++) d[i] *= g;
  return out;
}
