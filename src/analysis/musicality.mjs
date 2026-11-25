// Musicality (docs/ROADMAP.md phase 15): how a passage was shaped, not only whether the notes
// were right. Three measures, each optional and each with at most one short, restrained remark.
// Pure; no DOM. Unit-tested in tests/musicality.test.js.
//
// Notes are the player's linked notes (practice-core's touch shape):
//   {n, t (score quarters), d, hand ('r'|'l'), staff, measure (index), at (ms), velocity (1–127)}
//
// phraseShape(notes, {phrases, measures, marks})            → shape | null
//   For each detected phrase, the melody (the top voice of the right hand) is compared with a
//   simple model of a shaped phrase: the line rises toward its peak (the highest note; among
//   equals the longest, then the first) and tapers at the cadence, a little below where it
//   began. Written dynamics come first: the model follows the marks in force (practice-core's
//   levels) and any hairpin, which then outweighs the arch. Per phrase:
//     score = (60 + 40·r) · (0.7 + 0.3·min(1, sd/6))   r = correlation of played and model
//   velocities, sd = the played velocity spread (a flat line earns little whatever r is).
//   At most one hint for the whole passage: the phrase that most missed its arrival or its
//   taper ("Let bar 6 arrive — the line peaks there.", "Taper the cadence in bar 8.").
//   → {score, phrases: [{first, last, bars, score, peak: {t, measure}, points: [{t, v, m}]}], hint}
//     (points: played velocity v and the model m, centred on the played mean, per melody note)
//
// tempoFlex(onsets, {measures, first, last})                → flex | null
//   Local tempo per beat from the performance-time warp through the onsets ({t, at}, one per
//   score time), in log space; a triangular moving average over about a bar is the shaped
//   tempo, a straight line through that the steady drift. flexPct = spread of the shaped tempo
//   around the drift line (phrase-level give and take), jitterPct = spread of the beat tempo
//   around the shaped tempo (beat-to-beat unsteadiness), both as % of tempo.
//     label: 'unsteady' when jitter > 9 %, else 'expressive' when flex ≥ 3.5 %, else 'steady'.
//   → {label, meanBpm, driftPct, flexPct, jitterPct, curve: [[t, bpm|null, shapedBpm|null], …], remark}
//
// voicingReport(notes, {measures, hand})                     → voicing | null
//   Within one hand (the right by default), notes struck together (same score time, two or
//   more pitches): the top voice against the mean of the voices under it.
//     score = 100 · clamp(0.5 + meanDiff/10)   (level = 50, top 5 velocity above = 100)
//   'through' (no covered bars, top ≥ 2 above), 'level', or 'covered' (bars where the inner
//   voices were ≥ 3 louder on average).
//   → {score, meanDiff, chords, melody: 'through'|'level'|'covered', covered: [{first, last, bars}], remark}
//
// playerMusicality({played, song, phrases, section, songId, perf}) → {shape, flex, voicing} | null
// compactMusicality(m) → the same without the per-note / per-beat curves (for practice:result).

import {beatInfo, beatsOf} from '../score-core.mjs';
import {barsText, detectPhrases, dynamicLevel, markAt} from '../practice-core.mjs';

const EPS = 1e-6;
const round = (v, k = 0) => Math.round(v * 10 ** k) / 10 ** k;
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = xs => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Pearson correlation, 0 when either side is flat. */
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx < EPS || syy < EPS ? 0 : sxy / Math.sqrt(sxx * syy);
}

// ───────── Phrase shaping ─────────

/** The melody: the top voice of the right hand (all notes when there is no right hand), one note per score time. */
export function melodyLine(notes) {
  const withV = notes.filter(p => Number.isFinite(p.velocity) && Number.isFinite(p.t));
  const right = withV.filter(p => p.hand !== 'l');
  const byT = new Map();
  for (const p of right.length ? right : withV) if (!byT.has(p.t) || byT.get(p.t).n < p.n) byT.set(p.t, p);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** The model of a shaped phrase over its melody notes → {model: [velocity], peak (index)}. */
export function shapeModel(line, {marks = [], hairpins = [], arch = 10, ramp = 12} = {}) {
  if (!line.length) return {model: [], peak: -1};
  // The peak: the highest note; among equals the longest, then the first.
  let peak = 0;
  line.forEach((p, i) => {
    const b = line[peak];
    if (p.n > b.n || (p.n === b.n && (p.d ?? 0) > (b.d ?? 0) + EPS)) peak = i;
  });
  const t0 = line[0].t, tp = line[peak].t, t1 = line.at(-1).t;
  const pins = hairpins.filter(h => h.end > t0 - EPS && h.t < t1 + EPS && h.end - h.t > EPS);
  const archAmp = pins.length ? arch * .3 : arch; // the composer's hairpin outweighs the generic arch
  const hasMarks = marks.some(m => dynamicLevel(m.mark) != null);
  const model = line.map(p => {
    const shape = p.t <= tp + EPS ? (tp - t0 > EPS ? (p.t - t0) / (tp - t0) : 1) : 1 - 1.4 * (p.t - tp) / Math.max(EPS, t1 - tp);
    const base = hasMarks ? (dynamicLevel(markAt(marks, p.t, p.staff)?.mark) ?? 0) : 0;
    let pin = 0;
    for (const h of pins) {
      const sign = h.form === 'dim' ? -1 : 1;
      if (p.t >= h.t - EPS && p.t <= h.end + EPS) pin += sign * ramp * clamp((p.t - h.t) / (h.end - h.t), 0, 1);
      // After the hairpin the new level holds until a mark takes over.
      else if (p.t > h.end && !marks.some(m => m.t >= h.end - EPS && m.t <= p.t + EPS && dynamicLevel(m.mark) != null)) pin += sign * ramp;
    }
    return base + archAmp * shape + pin;
  });
  return {model, peak};
}

/** Phrase shaping for a passage (see the head of the file). */
export function phraseShape(notes, {phrases = [], measures = [], marks = {}, minNotes = 4} = {}) {
  const line = melodyLine(notes);
  if (line.length < minNotes || !phrases.length) return null;
  const out = [];
  let worst = null;
  for (const ph of phrases) {
    const pl = line.filter(p => p.measure >= ph.first && p.measure <= ph.last);
    if (pl.length < minNotes) continue;
    const {model, peak} = shapeModel(pl, {marks: marks.dynamics ?? [], hairpins: marks.hairpins ?? []});
    const v = pl.map(p => p.velocity);
    const r = correlation(v, model), spread = sd(v);
    const score = Math.round(clamp(60 + 40 * r, 0, 100) * (.7 + .3 * clamp(spread / 6, 0, 1)));
    const mV = mean(v), mM = mean(model);
    // How far the arrival and the taper fell short of the model (velocity units).
    const opening = Math.max(1, Math.ceil(peak / 3));
    const vOpen = mean(v.slice(0, opening)), mOpen = mean(model.slice(0, opening));
    const arrive = peak >= 2 && model[peak] - mOpen >= 4 ? (model[peak] - mOpen) - (v[peak] - vOpen) : 0;
    const last = pl.length - 1;
    const taper = peak < last && model[last] - mM <= -3 ? (v[last] - mV) - (model[last] - mM) : 0;
    const phrase = {
      first: ph.first, last: ph.last, bars: barsText(measures, ph.first, ph.last), score,
      peak: {t: pl[peak].t, measure: pl[peak].measure},
      points: pl.map((p, i) => ({t: p.t, v: p.velocity, m: round(mV + model[i] - mM, 1)})),
    };
    out.push(phrase);
    if (score < 75) for (const [kind, def, at] of [['arrive', arrive, pl[peak].measure], ['taper', taper, pl[last].measure]])
      if (def >= 5 && (!worst || def > worst.def)) worst = {kind, def, at};
  }
  if (!out.length) return null;
  const weights = out.map(p => p.points.length);
  const score = Math.round(out.reduce((a, p, i) => a + p.score * weights[i], 0) / weights.reduce((a, b) => a + b, 0));
  let hint = null;
  if (worst) {
    const where = barsText(measures, worst.at);
    hint = worst.kind === 'arrive' ? `Let ${where} arrive — the line peaks there.` : `Taper the cadence in ${where}.`;
  } else if (score >= 80) hint = 'The phrases rise and fall.';
  return {score, phrases: out, hint};
}

// ───────── Rubato and timing feel ─────────

/** One onset per score time (the median of a chord's notes): [{t, at}] in score order. */
export function onsetsOf(notes) {
  const byT = new Map();
  for (const p of notes) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.at)) continue;
    if (!byT.has(p.t)) byT.set(p.t, []);
    byT.get(p.t).push(p.at);
  }
  return [...byT].map(([t, ats]) => ({t, at: median(ats)})).sort((a, b) => a.t - b.t);
}

// Performance time at score time t, interpolated between onsets (null outside them).
function msAt(onsets, t) {
  if (!onsets.length || t < onsets[0].t - EPS || t > onsets.at(-1).t + EPS) return null;
  let lo = 0, hi = onsets.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (onsets[mid].t <= t + EPS) lo = mid; else hi = mid; }
  const a = onsets[lo], b = onsets[hi];
  if (Math.abs(t - a.t) < EPS) return a.at;
  if (Math.abs(t - b.t) < EPS) return b.at;
  return a.at + (b.at - a.at) * (t - a.t) / (b.t - a.t);
}

/** Tempo flex for a passage (see the head of the file). */
export function tempoFlex(onsets, {measures = [], first = 0, last = measures.length - 1, minBeats = 8} = {}) {
  // Keep onsets rising in both time and score time (a stray reversed pair can't make a negative beat).
  const ons = [];
  for (const o of [...onsets].sort((a, b) => a.t - b.t)) if (!ons.length || (o.t > ons.at(-1).t + EPS && o.at > ons.at(-1).at)) ons.push(o);
  if (ons.length < 4 || !measures.length) return null;
  const section = measures.slice(first, last + 1);
  const beats = beatsOf(section).map(b => {
    const m = section.find(x => b.t >= x.start - EPS && b.t < x.end - EPS) ?? section.at(-1);
    return {t: b.t, len: beatInfo(m.meter).len, measure: measures.indexOf(m)};
  });
  const pts = beats.map(b => {
    const a = msAt(ons, b.t), z = msAt(ons, b.t + b.len);
    return a != null && z != null && z - a > EPS ? {...b, log: Math.log(60000 * b.len / (z - a))} : {...b, log: null};
  });
  const valid = pts.filter(p => p.log != null);
  if (valid.length < minBeats) return null;
  const perBar = Math.max(1, Math.round(beatInfo(section[0].meter).beats));
  const half = Math.max(2, Math.round(perBar * .75));
  // Shaped tempo: a triangular moving average over the valid beats.
  const shaped = valid.map((p, i) => {
    let sw = 0, s = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(valid.length - 1, i + half); k++) { const w = half + 1 - Math.abs(k - i); sw += w; s += w * valid[k].log; }
    return s / sw;
  });
  // Steady drift: a straight line through the shaped tempo.
  const xs = valid.map((_, i) => i), mx = mean(xs), my = mean(shaped);
  let sxx = 0, sxy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (shaped[i] - my); });
  const slope = sxx > EPS ? sxy / sxx : 0;
  const trend = xs.map(x => my + slope * (x - mx));
  const flexPct = round(100 * sd(shaped.map((s, i) => s - trend[i])), 1);
  const resid = valid.map((p, i) => p.log - shaped[i]);
  const jitterPct = round(100 * sd(resid), 1);
  const driftPct = round(100 * (Math.exp(trend.at(-1) - trend[0]) - 1), 1);
  const meanBpm = Math.round(Math.exp(mean(valid.map(p => p.log))));
  const label = jitterPct > 9 ? 'unsteady' : flexPct >= 3.5 ? 'expressive' : 'steady';
  let remark;
  if (label === 'unsteady') {
    const byBar = new Map();
    valid.forEach((p, i) => { if (!byBar.has(p.measure)) byBar.set(p.measure, []); byBar.get(p.measure).push(Math.abs(resid[i])); });
    const [worst] = [...byBar].sort((a, b) => mean(b[1]) - mean(a[1]) || a[0] - b[0])[0];
    remark = `The pulse wavers around ${barsText(measures, worst)}; feel the beat underneath.`;
  } else if (label === 'expressive') remark = 'The tempo breathes with the phrases.';
  else remark = Math.abs(driftPct) >= 8 ? `A steady pulse, though it ${driftPct > 0 ? 'pressed on' : 'settled back'} gradually.` : 'A steady pulse.';
  const shapedAt = new Map(valid.map((p, i) => [p.t, shaped[i]]));
  const curve = pts.map(p => [round(p.t, 3), p.log == null ? null : Math.round(Math.exp(p.log)), shapedAt.has(p.t) ? Math.round(Math.exp(shapedAt.get(p.t))) : null]);
  return {label, meanBpm, driftPct, flexPct, jitterPct, curve, remark};
}

// ───────── Voicing ─────────

/** Melody over inner voices within one hand (see the head of the file). */
export function voicingReport(notes, {measures = [], hand = 'r', minChords = 3} = {}) {
  const want = h => (hand === 'l' ? h === 'l' : h !== 'l');
  const byT = new Map();
  for (const p of notes) {
    if (!want(p.hand) || !Number.isFinite(p.velocity) || !Number.isFinite(p.t)) continue;
    if (!byT.has(p.t)) byT.set(p.t, []);
    byT.get(p.t).push(p);
  }
  const chords = [];
  for (const [t, list] of byT) {
    if (new Set(list.map(p => p.n)).size < 2) continue;
    const top = Math.max(...list.map(p => p.n));
    const upper = list.filter(p => p.n === top), inner = list.filter(p => p.n !== top);
    chords.push({t, measure: upper[0].measure, diff: mean(upper.map(p => p.velocity)) - mean(inner.map(p => p.velocity))});
  }
  if (chords.length < minChords) return null;
  chords.sort((a, b) => a.t - b.t);
  const meanDiff = round(mean(chords.map(c => c.diff)), 1);
  const bars = new Map();
  for (const c of chords) { if (!bars.has(c.measure)) bars.set(c.measure, []); bars.get(c.measure).push(c.diff); }
  const coveredBars = [...bars].filter(([, d]) => mean(d) <= -3).map(([i]) => i).sort((a, b) => a - b);
  const covered = [];
  for (const i of coveredBars) {
    const run = covered.at(-1);
    if (run && run.last === i - 1) run.last = i; else covered.push({first: i, last: i});
  }
  for (const run of covered) run.bars = barsText(measures, run.first, run.last);
  const melody = covered.length ? 'covered' : meanDiff >= 2 ? 'through' : 'level';
  const where = covered.slice(0, 2).map(r => r.bars).join(' and ');
  const remark = melody === 'through' ? 'The melody comes through.'
    : melody === 'covered' ? `The melody is covered in ${where}; let the top voice sing.`
      : 'Top and inner voices sound level; let the melody sing a little above them.';
  return {score: Math.round(100 * clamp(.5 + meanDiff / 10, 0, 1)), meanDiff, chords: chords.length, melody, covered, remark};
}

// ───────── In the player and in recordings ─────────

/** All three for a pass in the player. Velocity-based measures need a real keyboard; the tempo flex only a performance run. */
export function playerMusicality({played = [], song, phrases, section, songId = '', perf = false} = {}) {
  if (!song?.measures?.length) return null;
  const id = String(songId ?? '');
  const exercise = id.startsWith('ex:') && !id.startsWith('ex:progression');
  const linked = played.filter(p => p.id != null);
  const real = linked.filter(p => p.source !== 'screen');
  const [first, last] = section ?? [0, song.measures.length - 1];
  const out = {shape: null, flex: null, voicing: null};
  if (!exercise && real.length >= 4) {
    const ph = clipPhrases(phrases ?? detectPhrases({measures: song.measures, events: song.events ?? [], slurs: song.marks?.slurs ?? []}), first, last);
    out.shape = phraseShape(real, {phrases: ph, measures: song.measures, marks: song.marks ?? {}});
    out.voicing = voicingReport(real, {measures: song.measures});
  }
  if (perf) out.flex = tempoFlex(onsetsOf(linked), {measures: song.measures, first, last});
  return out.shape || out.flex || out.voicing ? out : null;
}

/** Phrases inside a section (clipped to it). */
export const clipPhrases = (phrases, first, last) => phrases
  .filter(p => p.last >= first && p.first <= last)
  .map(p => ({first: Math.max(first, p.first), last: Math.min(last, p.last)}));

/** Without the curves: the shape that goes into practice:result and the teacher's context. */
export function compactMusicality(m) {
  if (!m) return null;
  const out = {};
  if (m.shape) out.shape = {score: m.shape.score, hint: m.shape.hint, phrases: m.shape.phrases.map(p => ({bars: p.bars, score: p.score}))};
  if (m.flex) { const {curve: _c, ...rest} = m.flex; out.flex = rest; }
  if (m.voicing) out.voicing = {score: m.voicing.score, melody: m.voicing.melody, meanDiff: m.voicing.meanDiff, covered: m.voicing.covered.map(r => r.bars), remark: m.voicing.remark};
  return Object.keys(out).length ? out : null;
}

/** One line of text per measure, for the teacher CLI. */
export function musicalityLines(m) {
  if (!m) return [];
  const out = [];
  if (m.shape) out.push(`Phrasing: ${m.shape.score}/100${m.shape.phrases?.length ? ` (${m.shape.phrases.map(p => `${p.bars} ${p.score}`).join(', ')})` : ''}${m.shape.hint ? ` · ${m.shape.hint}` : ''}`);
  if (m.flex) out.push(`Tempo feel: ${m.flex.label} · ♩ ≈ ${m.flex.meanBpm} · flex ±${m.flex.flexPct}% · beat-to-beat ±${m.flex.jitterPct}% · drift ${m.flex.driftPct > 0 ? '+' : ''}${m.flex.driftPct}%`);
  if (m.voicing) out.push(`Voicing: ${m.voicing.score}/100 · ${m.voicing.remark}`);
  return out;
}
