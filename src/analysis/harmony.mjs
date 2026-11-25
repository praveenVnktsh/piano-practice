// Score study: an approximate harmonic analysis (Roman numerals and chord symbols) computed from
// the notes of a score. Pure functions, no DOM; used by the player's Harmony overlay
// (⋯ → View → Harmony) and unit-tested on the Bach Prelude in C and simple cadences.
//
//   analyseHarmony({events, measures}) → {keys: [{first, last, key}], chords: [chord, ...]}
//     events:   [{n (MIDI), t, d (quarters)}]          (src/score-core.mjs buildScore)
//     measures: [{start, end, meter, pickup, key: {fifths, mode}}]
//     key   = {tonic (pitch class 0–11), mode: 'major' | 'minor', fifths, name: 'C major'}
//     chord = {t, end, measure, root, quality, bass, inversion, numeral ('V⁶₅' parts below), symbol, label, key}
//
// The method — simple on purpose, and marked "approximate" wherever it is shown:
//  1. Key. The key signature gives two candidates, the major key and its relative minor
//     (a mode written in the file is trusted). Between them, the notes decide: the
//     pitch-class durations of the passage are correlated with the Krumhansl–Kessler key
//     profiles, plus a bonus when the first and last bass notes are that key's tonic. A key
//     signature change starts a new region.
//  2. Windows. Each bar is cut at its beats (dotted beats in compound time). In each window
//     every sounding note adds its duration in the window to its pitch class (a note attacked
//     inside the window counts fully, one held over from before at 0.6), and the lowest
//     sounding note — the bass — counts extra.
//  3. Templates. Every window is scored against triads and seventh chords on all twelve roots:
//     the share of the window's weight that falls on chord tones, minus a cost for missing
//     tones (a missing third costs most; a seventh chord needs its seventh, and too few sounding
//     chord tones rule a chord out), plus small bonuses
//     for a root-position bass and for chords that belong to the key (or are common chromatic
//     chords: secondary dominants and leading-note sevenths). Augmented triads and sevenths pay a
//     little extra, so the simpler chord wins a tie.
//     Each beat's scores are blended (40 %) with the scores of its half bar (bars of four beats)
//     or whole bar, so a seventh or a third that arrives later in a broken figure still counts.
//  4. Smoothing. The labels are chosen together, Viterbi-style, over the best candidates of each
//     window: changing chord costs a little on a strong beat and more on a weak one, so passing
//     notes and broken figures don't make the chords flicker. Windows without notes keep the
//     chord before them, and so do windows whose best chord scores below 0.6 (a bare melody).
//     Neighbouring windows with the same chord are merged.
//  5. Labels. The root's interval above the tonic gives the degree (♭/♯ for chromatic roots);
//     upper case for major/augmented/dominant chords, lower case for minor/diminished; °, ø, +;
//     inversion figures from the bass (6, 6/4; 7, 6/5, 4/3, 4/2); a chromatic major chord or
//     dominant seventh a fifth above a diatonic degree reads as V/x, a diminished chord a
//     semitone below one as vii°/x. Within a bar, a triad and the seventh chord on the same root
//     merge into the seventh chord; a diminished seventh takes the root a semitone below the
//     chord that follows (else the leading note). Chord symbols use the key's spelling ("D7", "G/B").

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const QUALITIES = {
  maj: {tones: [0, 4, 7], upper: true, mark: '', symbol: ''},
  min: {tones: [0, 3, 7], upper: false, mark: '', symbol: 'm'},
  dim: {tones: [0, 3, 6], upper: false, mark: '°', symbol: '°', cost: 0.04}, // often an incomplete V7 or vii°7
  aug: {tones: [0, 4, 8], upper: true, mark: '+', symbol: '+', cost: 0.08},
  dom7: {tones: [0, 4, 7, 10], upper: true, mark: '', symbol: '7', seventh: true, cost: 0.03},
  maj7: {tones: [0, 4, 7, 11], upper: true, mark: '', symbol: 'maj7', seventh: true, cost: 0.04},
  min7: {tones: [0, 3, 7, 10], upper: false, mark: '', symbol: 'm7', seventh: true, cost: 0.03},
  hdim7: {tones: [0, 3, 6, 10], upper: false, mark: 'ø', symbol: 'm7♭5', seventh: true, cost: 0.03},
  dim7: {tones: [0, 3, 6, 9], upper: false, mark: '°', symbol: '°7', seventh: true, cost: 0.02},
};

const mod = (a, n = 12) => ((a % n) + n) % n;
const EPS = 1e-6;

// ───────── keys ─────────

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// Tonic names on the line of fifths, for key names: fifths −7…7 → C♭ … C♯.
const MAJOR_TONICS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR_TONICS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

/** The key with this signature and mode: {tonic, mode, fifths, name}. */
export function keyOf(fifths = 0, mode = 'major') {
  const f = Math.max(-7, Math.min(7, Math.round(fifths) || 0));
  const major = mod(f * 7);
  const tonic = mode === 'minor' ? mod(major + 9) : major;
  return {tonic, mode, fifths: f, name: `${(mode === 'minor' ? MINOR_TONICS : MAJOR_TONICS)[f + 7]} ${mode}`};
}

function correlate(a, b) {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Pitch-class durations of the events between two times. */
export function pitchProfile(events, from = -Infinity, to = Infinity) {
  const w = new Array(12).fill(0);
  for (const e of events) {
    const a = Math.max(from, e.t), b = Math.min(to, e.t + e.d);
    if (b > a) w[mod(e.n)] += b - a;
  }
  return w;
}

/**
 * Major or relative minor for a key signature, from the notes (see the header, step 1).
 * → key (as keyOf) with `confidence` (the correlation margin, 0 when the file states the mode).
 */
export function detectKey(events, {fifths = 0, mode = null, from = -Infinity, to = Infinity} = {}) {
  if (mode === 'major' || mode === 'minor') return {...keyOf(fifths, mode), confidence: 0};
  const inRange = events.filter(e => e.t + e.d > from + EPS && e.t < to - EPS);
  const w = pitchProfile(inRange, from, to);
  const major = keyOf(fifths, 'major'), minor = keyOf(fifths, 'minor');
  const rot = (profile, tonic) => profile.map((_, i) => profile[mod(i - tonic)]);
  let sMaj = correlate(w, rot(MAJOR_PROFILE, major.tonic));
  let sMin = correlate(w, rot(MINOR_PROFILE, minor.tonic));
  // Opening and closing bass notes: pieces usually begin and nearly always end on the tonic.
  const onsets = [...new Set(inRange.map(e => e.t))].sort((a, b) => a - b);
  const bassAt = t => Math.min(...inRange.filter(e => e.t <= t + EPS && e.t + e.d > t + EPS).map(e => e.n));
  if (onsets.length) {
    const first = mod(bassAt(onsets[0])), last = mod(bassAt(onsets.at(-1)));
    if (first === major.tonic) sMaj += 0.05; if (first === minor.tonic) sMin += 0.05;
    if (last === major.tonic) sMaj += 0.1; if (last === minor.tonic) sMin += 0.1;
  }
  return sMin > sMaj ? {...minor, confidence: sMin - sMaj} : {...major, confidence: sMaj - sMin};
}

/** Regions of the score that share a key signature, each with its key. */
export function keyRegions(events, measures) {
  const out = [];
  let i = 0;
  while (i < measures.length) {
    const k = measures[i].key || {fifths: 0, mode: null};
    let j = i;
    while (j + 1 < measures.length && (measures[j + 1].key?.fifths ?? 0) === k.fifths && (measures[j + 1].key?.mode ?? null) === k.mode) j++;
    const key = detectKey(events, {fifths: k.fifths, mode: k.mode, from: measures[i].start, to: measures[j].end});
    out.push({first: i, last: j, start: measures[i].start, end: measures[j].end, key});
    i = j + 1;
  }
  return out;
}

// ───────── chords in a key ─────────

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** The diatonic chords of a key as "root:quality" strings (minor adds the harmonic-minor V, V7, vii°, vii°7). */
export function diatonicSet(key) {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const pcs = steps.map(s => mod(key.tonic + s));
  const set = new Set();
  const add = (root, quality) => set.add(`${root}:${quality}`);
  for (let d = 0; d < 7; d++) {
    const r = pcs[d], third = mod(pcs[(d + 2) % 7] - r), fifth = mod(pcs[(d + 4) % 7] - r), sev = mod(pcs[(d + 6) % 7] - r);
    const tri = third === 4 && fifth === 7 ? 'maj' : third === 3 && fifth === 7 ? 'min' : third === 3 && fifth === 6 ? 'dim' : third === 4 && fifth === 8 ? 'aug' : null;
    if (tri) add(r, tri);
    const s7 = {maj: {10: 'dom7', 11: 'maj7'}, min: {10: 'min7'}, dim: {10: 'hdim7', 9: 'dim7'}}[tri]?.[sev];
    if (s7) add(r, s7);
  }
  if (key.mode === 'minor') {
    const v = mod(key.tonic + 7), lt = mod(key.tonic + 11);
    add(v, 'maj'); add(v, 'dom7'); add(lt, 'dim'); add(lt, 'dim7'); add(lt, 'hdim7');
  }
  return set;
}

/** Is the chord a secondary dominant / leading-note chord of a diatonic degree? → target degree (1–7) or 0. */
export function secondaryTarget(root, quality, key, diatonic = diatonicSet(key)) {
  if (diatonic.has(`${root}:${quality}`)) return 0;
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const degreeOf = pc => steps.findIndex(s => mod(key.tonic + s) === pc);
  const targetOk = d => d > 0 && !(key.mode === 'major' && d === 6) && !(key.mode === 'minor' && d === 1); // not the tonic, not vii° (major) / ii° (minor)
  if (quality === 'maj' || quality === 'dom7') {
    const d = degreeOf(mod(root - 7));
    if (targetOk(d)) return d + 1;
  }
  if (quality === 'dim' || quality === 'dim7' || quality === 'hdim7') {
    const d = degreeOf(mod(root + 1));
    if (targetOk(d)) return d + 1;
  }
  return 0;
}

// Case and marks of a diatonic degree (for V/ii etc.).
function degreeNumeral(degree, key) {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const pcs = steps.map(s => mod(key.tonic + s));
  const r = pcs[degree - 1], third = mod(pcs[(degree + 1) % 7] - r), fifth = mod(pcs[(degree + 3) % 7] - r);
  const name = ROMAN[degree - 1];
  if (third === 4) return name;
  return name.toLowerCase() + (fifth === 6 ? '°' : '');
}

const FIGURES = {triad: ['', '6', '6/4'], seventh: ['7', '6/5', '4/3', '4/2']};

/** Inversion from the bass: 0 = root position, 1 = third in the bass, … (−1 when the bass is not a chord tone). */
export function inversionOf(root, quality, bass) {
  if (bass == null) return 0;
  return QUALITIES[quality].tones.findIndex(i => mod(root + i) === bass);
}

/**
 * Roman numeral for a chord in a key → {numeral, figure, secondary, text}; e.g. text 'V6/5', 'ii4/2', 'V7/V', '♭VI'.
 */
export function romanNumeral({root, quality, bass}, key) {
  const q = QUALITIES[quality];
  const inv = Math.max(0, inversionOf(root, quality, bass));
  const figure = (q.seventh ? FIGURES.seventh : FIGURES.triad)[inv] ?? '';
  const diatonic = diatonicSet(key);
  const target = secondaryTarget(root, quality, key, diatonic);
  if (target) {
    const fn = quality === 'maj' || quality === 'dom7' ? 'V' : 'vii' + q.mark;
    return {numeral: fn, figure, secondary: degreeNumeral(target, key), text: `${fn}${figure}/${degreeNumeral(target, key)}`};
  }
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const iv = mod(root - key.tonic);
  let degree = steps.indexOf(iv), accidental = '';
  if (degree < 0) {
    if (key.mode === 'minor' && iv === 11) degree = 6;              // raised leading note: vii°
    else if (key.mode === 'minor' && iv === 9) { degree = 5; accidental = '♯'; }
    else if (iv === 6) { degree = 3; accidental = '♯'; }            // ♯iv° (leading note of V)
    else { degree = steps.indexOf(mod(iv + 1)); accidental = '♭'; } // ♭II, ♭III, ♭VI, ♭VII
    if (degree < 0) { degree = steps.indexOf(mod(iv - 1)); accidental = '♯'; }
  }
  const base = ROMAN[degree];
  const numeral = accidental + (q.upper ? base : base.toLowerCase()) + q.mark;
  return {numeral, figure, secondary: null, text: numeral + figure};
}

/** Pitch-class name in a key's spelling: sharps in sharp keys, flats in flat keys (C major: C♯ E♭ F♯ A♭ B♭). */
export function pcName(pc, key = keyOf(0)) {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  // Minor keys raise the sixth and seventh with sharps or naturals (G♯ in A minor, C♯ in D minor).
  if (key.mode === 'minor' && (mod(pc - key.tonic) === 11 || mod(pc - key.tonic) === 9)) return SHARP_NAMES[pc];
  if (key.fifths < 0) return FLAT_NAMES[pc];
  if (key.fifths > 0) {
    // Diatonic pitches keep their key-signature spelling; chromatic ones prefer sharps.
    return SHARP_NAMES[pc];
  }
  return steps.includes(mod(pc - key.tonic)) || ![3, 8, 10].includes(pc) ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
}

/** "D7", "G/B", "C♯°7", "Am". */
export function chordSymbol({root, quality, bass}, key) {
  const name = pcName(root, key) + QUALITIES[quality].symbol;
  return bass != null && bass !== root ? `${name}/${pcName(bass, key)}` : name;
}

// ───────── windows and templates ─────────

/** Beat windows of a bar: [{t, end, strong}] — beats from the meter, dotted in compound time. */
export function beatWindows(m) {
  const {count = 4, unit = 4} = m.meter || {};
  const compound = unit >= 8 && count > 3 && count % 3 === 0;
  const len = (compound ? 3 : 1) * 4 / unit, beats = compound ? count / 3 : count;
  const bar = len * beats;
  const anchor = m.pickup || (m.index === 0 && m.end - m.start < bar - EPS) ? m.end - bar : m.start;
  const out = [];
  for (let j = 0; ; j++) {
    const t = anchor + j * len;
    if (t >= m.end - EPS) break;
    const end = Math.min(m.end, t + len);
    if (end <= m.start + EPS) continue;
    // Strong: the downbeat, and the middle of a bar of four (or two dotted) beats.
    out.push({t: Math.max(m.start, t), end, strong: j === 0 || (beats === 4 && j === 2)});
  }
  return out;
}

/** Weights and bass of one window (see the header, step 2). → {w: [12], total, bass (pc) | null, bassMidi}. */
export function windowWeights(events, t, end) {
  const w = new Array(12).fill(0);
  let bassMidi = Infinity, total = 0;
  const len = end - t;
  for (const e of events) {
    const a = Math.max(t, e.t), b = Math.min(end, e.t + e.d);
    if (b <= a + EPS) continue;
    const attacked = e.t >= t - EPS;
    const weight = (b - a) * (attacked ? 1 : 0.6);
    w[mod(e.n)] += weight;
    total += weight;
    if ((attacked || b - a >= len * 0.25 - EPS) && e.n < bassMidi) bassMidi = e.n;
  }
  const bass = Number.isFinite(bassMidi) ? mod(bassMidi) : null;
  if (bass != null) { w[bass] += len * 0.5; total += len * 0.5; }
  return {w, total, bass, bassMidi: Number.isFinite(bassMidi) ? bassMidi : null};
}

/** All templates scored for one window, best first: [{root, quality, score}]. */
export function scoreTemplates({w, total, bass}, key, diatonic = diatonicSet(key)) {
  if (!(total > EPS)) return [];
  const present = pc => w[pc] > total * 0.04;
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const [quality, q] of Object.entries(QUALITIES)) {
      const tones = q.tones.map(i => mod(root + i));
      let inW = 0;
      for (const pc of tones) inW += w[pc];
      let s = inW / total;
      if (!present(root)) s -= 0.2;
      if (!present(tones[1])) s -= 0.25;
      if (!present(tones[2])) s -= quality === 'dim' || quality === 'aug' || quality === 'dim7' || quality === 'hdim7' ? 0.25 : 0.08;
      if (q.seventh && w[tones[3]] < total * 0.08) s -= 0.4;
      // Too few chord tones sounding (a bare melody): not evidence for this chord.
      const sounding = tones.filter(present).length;
      if (sounding < (q.seventh ? 3 : 2)) s -= 0.5;
      if (bass === root) s += 0.05;
      else if (tones.includes(bass)) s += 0.02;
      else if (bass != null) s -= 0.08;
      if (diatonic.has(`${root}:${quality}`)) s += 0.06;
      else if (secondaryTarget(root, quality, key, diatonic)) s += 0.02;
      s -= q.cost || 0;
      out.push({root, quality, score: s});
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// ───────── the analysis ─────────

// Cost of changing chord on a strong / weak beat, and between a triad and a seventh chord that
// contains it (merged afterwards anyway); candidates kept per window; weight of the context.
const CHANGE_STRONG = 0.06, CHANGE_WEAK = 0.16, NESTED = 0.02, TOP = 8, CONTEXT = 0.4, MIN_SCORE = 0.6;

/** See the header. Options: {smooth: true}. */
export function analyseHarmony({events = [], measures = []} = {}, {smooth = true} = {}) {
  if (!measures.length || !events.length) return {keys: [], chords: []};
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const regions = keyRegions(sorted, measures);
  const windows = [];
  for (const region of regions) {
    const diatonic = diatonicSet(region.key);
    for (let mi = region.first; mi <= region.last; mi++) {
      const m = measures[mi];
      const wins = beatWindows({...m, index: mi});
      // Context: the half bar (bars of four beats) or the whole bar around each beat.
      const groups = wins.length === 4 ? [[0, 1], [2, 3]] : [wins.map((_, i) => i)];
      for (const g of groups) {
        const ct = wins[g[0]].t, ce = wins[g.at(-1)].end;
        const ctxLocal = sorted.filter(e => e.t < ce - EPS && e.t + e.d > ct + EPS);
        const ctx = new Map(scoreTemplates(windowWeights(ctxLocal, ct, ce), region.key, diatonic).map(c => [`${c.root}:${c.quality}`, c.score]));
        for (const i of g) {
          const win = wins[i];
          const local = ctxLocal.filter(e => e.t < win.end - EPS && e.t + e.d > win.t + EPS);
          const ww = windowWeights(local, win.t, win.end);
          const cands = scoreTemplates(ww, region.key, diatonic)
            .map(c => ({...c, score: (1 - CONTEXT) * c.score + CONTEXT * (ctx.get(`${c.root}:${c.quality}`) ?? c.score)}))
            .sort((a, b) => b.score - a.score).slice(0, TOP);
          // A window no chord explains well (a single melodic line) keeps the chord before it.
          const clear = cands.length && cands[0].score >= MIN_SCORE;
          windows.push({...win, measure: mi, key: region.key, bass: ww.bass, cands: clear ? cands : [], empty: !clear});
        }
      }
    }
  }
  // Viterbi over the candidates (empty windows carry the previous chord at no cost).
  const pick = smooth ? viterbi(windows) : windows.map(w => (w.empty ? null : 0));
  const chords = [];
  let last = null;
  windows.forEach((win, i) => {
    const k = pick[i];
    if (k == null) { if (last) last.end = win.end; return; }
    const c = win.cands[k];
    if (last && last.root === c.root && last.quality === c.quality && last.key === win.key) { last.end = win.end; return; }
    last = {t: win.t, end: win.end, measure: win.measure, root: c.root, quality: c.quality, bass: win.bass, key: win.key, score: c.score};
    chords.push(last);
  });
  // A diminished seventh has four possible roots: take the one a semitone below the next chord's
  // root, else the key's leading note, else a leading note of another degree (step 5).
  chords.forEach((c, i) => {
    if (c.quality !== 'dim7') return;
    const pcs = QUALITIES.dim7.tones.map(x => mod(c.root + x));
    const next = chords[i + 1];
    const steps = c.key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS; // leading notes of I, V, ii, vi, IV, iii
    const choice = [next ? mod(next.root - 1) : null, ...[0, 4, 1, 5, 3, 2].map(d => mod(c.key.tonic + steps[d] - 1))].find(pc => pc != null && pcs.includes(pc));
    if (choice != null) c.root = choice;
  });
  // Within a bar, a triad next to a seventh chord that contains it is one chord (G then G7 → G7;
  // E° then C♯°7): broken figures often reach the seventh only on a later beat.
  for (let i = chords.length - 1; i > 0; i--) {
    const a = chords[i - 1], b = chords[i];
    if (a.measure !== b.measure || a.key !== b.key) continue;
    const rich = richer(a, b);
    if (!rich) continue;
    Object.assign(a, {root: rich.root, quality: rich.quality, bass: a.bass, end: b.end});
    chords.splice(i, 1);
  }
  for (const c of chords) {
    if (inversionOf(c.root, c.quality, c.bass) < 0) c.bass = c.root; // a non-chord bass: show root position
    const r = romanNumeral(c, c.key);
    Object.assign(c, {numeral: r.numeral, figure: r.figure, secondary: r.secondary, label: r.text, symbol: chordSymbol(c, c.key), inversion: Math.max(0, inversionOf(c.root, c.quality, c.bass))});
  }
  return {keys: regions.map(r => ({first: r.first, last: r.last, key: r.key})), chords};
}

// Of two chords, the seventh chord whose pitch classes contain the other triad's, or null.
const pcsOf = c => QUALITIES[c.quality].tones.map(x => mod(c.root + x));
function richer(a, b) {
  if (a.root === b.root && a.quality === b.quality) return a;
  const [big, small] = QUALITIES[a.quality].seventh ? [a, b] : [b, a];
  if (!QUALITIES[big.quality].seventh || QUALITIES[small.quality].seventh) return null;
  const pcs = pcsOf(big);
  return pcsOf(small).every(pc => pcs.includes(pc)) ? big : null;
}

function viterbi(windows) {
  const n = windows.length;
  const cost = [], back = [];
  const same = (a, b) => a && b && a.root === b.root && a.quality === b.quality;
  for (let i = 0; i < n; i++) {
    const w = windows[i];
    if (w.empty) { cost.push(null); back.push(null); continue; }
    let p = i - 1;
    while (p >= 0 && windows[p].empty) p--;
    const change = w.strong ? CHANGE_STRONG : CHANGE_WEAK;
    const row = [], from = [];
    w.cands.forEach((c, k) => {
      const emit = -c.score;
      if (p < 0) { row.push(emit); from.push(-1); return; }
      let best = Infinity, arg = 0;
      windows[p].cands.forEach((pc, j) => {
        const v = cost[p][j] + (same(pc, c) ? 0 : richer(pc, c) ? NESTED : change);
        if (v < best) { best = v; arg = j; }
      });
      row.push(best + emit); from.push(arg);
    });
    cost.push(row); back.push({prev: p, from});
  }
  const out = new Array(n).fill(null);
  let i = n - 1;
  while (i >= 0 && windows[i].empty) i--;
  if (i < 0) return out;
  let k = cost[i].indexOf(Math.min(...cost[i]));
  while (i >= 0) {
    out[i] = k;
    const b = back[i];
    if (!b || b.prev < 0) break;
    k = b.from[k];
    i = b.prev;
  }
  return out;
}
