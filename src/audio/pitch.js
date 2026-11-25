// Monophonic pitch detection (YIN, de Cheveigné & Kawahara 2002) and a small
// note tracker that turns a stream of pitch frames into note-on / note-off.
// Pure functions: no Web Audio here, so they run in Node tests and in the browser.
//
//   const p = detectPitch(frame, 48000);        // {freq, clarity, rms} or {freq: 0, …}
//   const t = createNoteTracker({sensitivity: .5});
//   t.push(p, timeMs) → [{type: 'on', note, velocity, time}] | [{type: 'off', note, time}] | []
//
// Works for single notes only: chords, or a note over a ringing bass, confuse it.

export const midiToFreq = n => 440 * Math.pow(2, (n - 69) / 12);
export const freqToMidi = f => 69 + 12 * Math.log2(f / 440);

// YIN on one frame. `threshold` is the aperiodicity cut-off (lower = stricter).
// Searches periods for minFreq…maxFreq (default A0…C8 range clipped to what one
// frame can hold: a frame must contain at least two periods).
export function detectPitch(frame, sampleRate, {threshold = .15, minFreq = 27.5, maxFreq = 4200} = {}) {
  const n = frame.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / n);
  const none = {freq: 0, clarity: 0, rms};
  if (!rms) return none;
  const w = Math.floor(n / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(w - 1, Math.ceil(sampleRate / minFreq));
  if (tauMax <= tauMin) return none;

  // Difference function d(τ) and its cumulative-mean-normalised form d'(τ).
  const d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) { const x = frame[i] - frame[i + tau]; s += x * x; }
    d[tau] = s;
  }
  const cm = new Float32Array(tauMax + 2);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; cm[tau] = run ? d[tau] * tau / run : 1; }

  // First dip below the threshold (then walk to its local minimum); else the global minimum.
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cm[tau] < threshold) {
      while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++;
      best = tau; break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau] < min) { min = cm[tau]; best = tau; }
    if (min > .35) return {...none, clarity: Math.max(0, 1 - min)};
  }
  // Parabolic interpolation around the dip for sub-sample accuracy.
  let t = best;
  if (best > 1 && best < tauMax + 1) {
    const a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a + c - 2 * b;
    if (den > 0) t = best + (a - c) / (2 * den);
  }
  return {freq: sampleRate / t, clarity: Math.max(0, Math.min(1, 1 - cm[best])), rms};
}

// Sensitivity 0…1 → the gates the tracker uses. Higher sensitivity hears softer,
// less clean notes (and more false ones in a noisy room).
export function trackerGates(sensitivity = .5) {
  const s = Math.max(0, Math.min(1, +sensitivity || 0));
  return {
    minRms: .03 * Math.pow(10, -2 * s), // .03 (s=0) … .0003 (s=1)
    minClarity: .9 - .25 * s,            // .9 … .65
  };
}

// Frames → notes. A note starts once the same semitone is seen in `stable`
// consecutive voiced frames; while it is held, repeats are ignored. A held note
// is re-struck only after a clear rise in level (a new attack on the same key).
// It ends after `release` unvoiced or quiet frames.
export function createNoteTracker({sensitivity = .5, stable = 3, release = 4, minNote = 21, maxNote = 108} = {}) {
  let gates = trackerGates(sensitivity);
  let cand = null, candCount = 0, candAt = 0, held = null, quiet = 0, floor = Infinity, peak = 0, rising = false, level = 0;
  let prev1 = 0, prev2 = 0;                          // the last two frames' levels
  let restrike = 0, restrikeAt = 0, restrikeRms = 0; // a same-key attack waiting for confirmation
  let lastOff = null;                                // {note, rms, time}: the tail of a note that just ended
  return {
    setSensitivity(s) { gates = trackerGates(s); },
    get held() { return held; },
    reset() { cand = null; candCount = 0; held = null; quiet = 0; floor = Infinity; peak = 0; rising = false; restrike = 0; lastOff = null; prev1 = prev2 = 0; },
    // → events, each timed at the first frame of its attack (not when it was confirmed).
    push({freq, clarity, rms}, time = 0) {
      const out = [];
      // An attack is sudden; the slow swell of beating unison strings is not.
      const sudden = rms > 1.5 * prev1 || (rms > 2.2 * prev2 && rms > 1.3 * prev1);
      prev2 = prev1; prev1 = rms;
      // Hysteresis: a sounding note keeps going down to half the gate it needed to start.
      const k = held != null ? .5 : 1;
      const voiced = freq > 0 && rms >= gates.minRms * k && clarity >= gates.minClarity - (held != null ? .1 : 0);
      const note = voiced ? Math.round(freqToMidi(freq)) : null;
      if (note == null || note < minNote || note > maxNote) {
        cand = null; candCount = 0; restrike = 0;
        if (held != null && ++quiet >= release) { out.push({type: 'off', note: held, time}); lastOff = {note: held, rms: level, time}; held = null; }
        return out;
      }
      quiet = 0;
      if (held === note) {
        cand = null; candCount = 0; level = rms;
        // Same key struck again: once the tail is decaying, a jump well above it is a new
        // attack — if the pitch stays put (at a change of note the next attack's first
        // frame still reads as the old pitch).
        if (restrike) {
          if (++restrike >= stable) {
            out.push({type: 'off', note: held, time: restrikeAt}, {type: 'on', note, velocity: velocityFor(restrikeRms), time: restrikeAt});
            restrike = 0; peak = Math.max(rms, restrikeRms); floor = rms; rising = true;
          }
        } else if (rising) { if (rms < peak * .97) rising = false; peak = Math.max(peak, rms); floor = rms; }
        else if (sudden && rms > 2 * floor && rms > gates.minRms * 2) { restrike = 1; restrikeAt = time; restrikeRms = rms; }
        else floor = Math.min(floor, rms);
        return out;
      }
      restrike = 0;
      // A fading tail flickering back above the gate is not a new note: the same pitch
      // right after it ended needs a real rise in level.
      if (held == null && lastOff?.note === note && time - lastOff.time < 600 && rms < lastOff.rms * 2) return out;
      if (cand === note) candCount++; else { cand = note; candCount = 1; candAt = time; }
      // A neighbour of the sounding note with no new attack is more likely the old
      // note drifting in noise than a new key: wait longer for it.
      const needed = held != null && Math.abs(note - held) <= 1 && rms < level * 1.3 ? stable * 3 : stable;
      if (candCount >= needed) {
        if (held != null) out.push({type: 'off', note: held, time: candAt});
        held = note; peak = rms; floor = rms; level = rms; rising = true; cand = null; candCount = 0; lastOff = null;
        out.push({type: 'on', note, velocity: velocityFor(rms), time: candAt});
      }
      return out;
    },
  };
}

// Rough MIDI velocity from frame level (mic gain is unknown, so this is only a guess).
export function velocityFor(rms) {
  const db = 20 * Math.log10(Math.max(1e-5, rms));
  return Math.max(20, Math.min(127, Math.round(127 + (db + 6) * 2.4)));
}
