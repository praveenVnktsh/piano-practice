// Pure maths for the sampled instruments: which recording to play for a note
// and velocity, how loud, where in the stereo field, and how struck notes feed
// the sympathetic-resonance strings. No Web Audio here (unit-tested in Node).

// ── Sample maps ──────────────────────────────────────────────────────────────

// The nearest recorded note to n, and the playback-rate ratio to reach n.
export function nearestSample(n, notes) {
  let best = notes[0];
  for (const s of notes) if (Math.abs(s - n) < Math.abs(best - n) || (Math.abs(s - n) === Math.abs(best - n) && s > best)) best = s;
  return {note: best, rate: Math.pow(2, (n - best) / 12)};
}

// ── Velocity layers ──────────────────────────────────────────────────────────

// Which layer(s) to sound for velocity v (0…1), given the centre velocity of
// each recorded layer (ascending). Between two centres the nearer layer plays
// alone, except inside a crossfade zone (± zone/2 around the midpoint), where
// both play with equal-power weights (w₁² + w₂² = 1) so loudness stays even.
// Layers that are not loaded yet (available[i] false) are skipped.
//   layerWeights(.6, [.25,.44,.63,.81,1]) → [{layer: 2, w: 1}]
export function layerWeights(v, centres, {zone = .08, available = null} = {}) {
  const idx = centres.map((c, i) => i).filter(i => !available || available[i]);
  if (!idx.length) return [];
  v = Math.max(0, Math.min(1, +v || 0));
  if (v <= centres[idx[0]]) return [{layer: idx[0], w: 1}];
  const last = idx[idx.length - 1];
  if (v >= centres[last]) return [{layer: last, w: 1}];
  let k = 0;
  while (k < idx.length - 1 && centres[idx[k + 1]] < v) k++;
  const lo = idx[k], hi = idx[k + 1];
  const mid = (centres[lo] + centres[hi]) / 2, half = Math.min(zone / 2, (centres[hi] - centres[lo]) / 2);
  if (v <= mid - half) return [{layer: lo, w: 1}];
  if (v >= mid + half) return [{layer: hi, w: 1}];
  const x = (v - (mid - half)) / (2 * half); // 0…1 across the zone
  return [{layer: lo, w: Math.cos(x * Math.PI / 2)}, {layer: hi, w: Math.sin(x * Math.PI / 2)}];
}

// Target loudness (linear gain, 1 at v = 1) for velocity v: a dB-linear curve
// spanning `rangeDb` from the softest key to the loudest, close to a real grand.
export function velocityLevel(v, rangeDb = 34) {
  v = Math.max(0, Math.min(1, +v || 0));
  return Math.pow(10, (-rangeDb * (1 - v) * (1 - v * .35)) / 20);
}

// Gain to apply to a layer's sample so it lands on the target loudness:
// target / the layer's measured loudness (both relative to the loudest layer).
export function layerGain(v, layerLevel, rangeDb) {
  return velocityLevel(v, rangeDb) / Math.max(1e-4, layerLevel);
}

// ── Stereo ───────────────────────────────────────────────────────────────────

// Pan position (−1 left … +1 right) for MIDI note n: low notes to the left as
// the pianist hears them, spread over `width`.
export function panForNote(n, width = .7) {
  const x = (Math.max(21, Math.min(108, n)) - 64.5) / 43.5; // −1 … +1 across A0…C8
  return Math.max(-1, Math.min(1, x * width));
}

// Equal-power gains for a mono source at pan p (−1…1): L² + R² = 1.
export function equalPowerGains(p) {
  const x = (Math.max(-1, Math.min(1, p)) + 1) / 2;
  return {left: Math.cos(x * Math.PI / 2), right: Math.sin(x * Math.PI / 2)};
}

// ── Damping ──────────────────────────────────────────────────────────────────

// Felt dampers stop treble strings quickly and bass strings slowly; the top
// 1½ octaves (from F#6 / MIDI 90 up) have no dampers at all.
export const UNDAMPED_FROM = 90;
export function dampTime(n) {
  if (n >= UNDAMPED_FROM) return Infinity;
  const x = Math.max(0, Math.min(1, (n - 21) / 69)); // 0 bass … 1 treble
  return .32 * Math.pow(1 - x, 1.5) + .06;           // seconds (time constant ×3)
}

// ── Sympathetic resonance ────────────────────────────────────────────────────
// With the sustain pedal down every string is free, so a struck note sets the
// strings that share its partials ringing. The engine keeps one tuned comb
// filter per pitch class (a "string" at a low octave, whose harmonics cover
// every octave of that pitch class). A struck note excites the combs of its own
// pitch class and of its strongest partials: the octave (same class), the
// twelfth (a fifth up) and the 17th (a major third up).
export const RESONANCE_PARTIALS = [{interval: 0, w: 1}, {interval: 7, w: .45}, {interval: 4, w: .22}];

// Send weights from a note's pitch class into the 12 combs.
export function resonanceSends(n) {
  const w = new Array(12).fill(0);
  for (const p of RESONANCE_PARTIALS) w[(((n + p.interval) % 12) + 12) % 12] += p.w;
  return w;
}

// The comb for pitch class pc, tuned near MIDI 36–47 (C2…B2): delay = one period.
export function combDelay(pc, sampleRate = 48000) {
  const f = 440 * Math.pow(2, (36 + pc - 69) / 12);
  return {freq: f, delay: 1 / f, samples: sampleRate / f};
}

// Feedback gain for a comb with loop delay d (s) to decay 60 dB in t60 seconds.
export function combFeedback(delay, t60) {
  return Math.pow(10, -3 * delay / Math.max(1e-3, t60));
}

// ── Instrument choice ────────────────────────────────────────────────────────

const BAROQUE = /\b(bach|handel|händel|haendel|scarlatti|couperin|rameau|purcell|telemann|vivaldi|pachelbel|petzold|buxtehude|frescobaldi|froberger|byrd|sweelinck|corelli|zipoli|krieger|graupner|stölzel|stolzel|daquin|pasquini)\b/i;

// 'auto' → harpsichord for Baroque catalog entries (period hint, BWV/HWV number
// or a Baroque composer), else piano.
export function chooseInstrument(setting, entry) {
  if (setting === 'piano' || setting === 'harpsichord') return setting;
  if (!entry) return 'piano';
  const period = String(entry.period || entry.era || '').toLowerCase();
  if (period) return period.includes('baroque') ? 'harpsichord' : 'piano';
  const text = [entry.composer, entry.title, ...(entry.tags || [])].filter(Boolean).join(' ');
  return BAROQUE.test(text) || /\b(BWV|HWV|TWV)\b/.test(text) ? 'harpsichord' : 'piano';
}
