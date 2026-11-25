// The comparison of a take with the score: wrong / missed / extra notes per bar, timing per
// beat (a tempo curve), evenness, dynamics against the marks, articulation and pedal. Pure;
// reuses the player's touch analysis (src/practice-core.mjs). Unit-tested in
// tests/record-report.test.js.
//
//   expectedNotes(song, take) → the score notes the take is compared with
//   playedNotes(take)         → the take's notes as {at, n, velocity, off}
//   buildReport({song, take}) → report (stored with the take; see ./take.mjs)
//
// Report: {v, songId, section, hands, computedAt,
//   summary: {expected, right, missed, wrong, extra, accuracy (0–100)},
//   bars: [{i, label, notes, right, missed: ['E5', …], wrong: [['E5', 'F5'], …] (written, played), extra, accuracy, bpm, devMs}],
//   timing: {meanBpm, writtenBpm, sdMs, score, curve: [[t, bpm|null, devMs|null], …] (one per beat), drift, rushed, slowed},
//   evenness: {score, timingSdMs, velocitySd, velocityMean} | null   (exercises only),
//   dynamics, articulation, pedal (practice-core shapes) | null,
//   remarks: [..], verdict, score (0–100 overall)}

import {passage, beatInfo, beatsOf, handFilter} from '../score-core.mjs';
import {evenness, evennessRemark, dynamicsReport, articulationReport, pedalReport, barsText, fitLine} from '../practice-core.mjs';
import {alignTake, warpFns} from './align.mjs';

export const REPORT_VERSION = 2;
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const round = (v, k = 0) => Math.round(v * 10 ** k) / 10 ** k;
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : NaN; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const VERDICTS = [[98, 'Clean.'], [90, 'Well played.'], [75, 'Nearly there.'], [50, 'Taking shape.'], [0, 'Slowly, then.']];
export const verdictFor = acc => VERDICTS.find(([min]) => acc >= min)[1];

/** The section a take is compared with: its own, else the whole piece. */
export function takeSection(song, take) {
  const n = song.measures.length;
  const s = take.section;
  return Array.isArray(s) && s[0] >= 0 && s[1] >= s[0] && s[1] < n ? s : [0, n - 1];
}

/** Score notes for the take's section and hands (notes carried in from before the section are left out). */
export function expectedNotes(song, take) {
  const [first, last] = takeSection(song, take);
  const p = passage(song, first, last);
  const want = handFilter(take.hands || 'both');
  const measureOf = t => {
    const i = song.measures.findIndex(m => m.start <= t + 1e-6 && t + 1e-6 < m.end);
    return i < 0 ? last : Math.max(first, Math.min(last, i));
  };
  return {passage: p, notes: p.events.filter(e => !e.carried && want(e)).map(e => ({...e, measure: measureOf(e.t)}))};
}

export const playedNotes = take => take.notes.map(([at, n, velocity, d]) => ({at, n, velocity, off: at + d}));

// Local tempo around time t: a line through the points within ±w quarters (≥ 3 points; the
// window doubles once at the edges of the take).
function localLine(points, t, w) {
  for (const k of [1, 2]) {
    const near = points.filter(p => Math.abs(p.x - t) <= k * w + 1e-6);
    if (near.length >= 3) return fitLine(near);
  }
  return null;
}

/** Builds the report. song: {measures, events, marks}; take: a validated take. */
export function buildReport({song, take, now = Date.now()}) {
  const [first, last] = takeSection(song, take);
  const measures = song.measures;
  const {notes: exp} = expectedNotes(song, take);
  const played = playedNotes(take);
  const al = alignTake(exp, played, {tempo: take.tempo || song.tempo || 100});
  const {tAt} = warpFns(al.warp, al.mpq);
  const realKeys = take.source !== 'screen';
  const measureIndexAt = t => {
    const i = measures.findIndex(m => m.start <= t + 1e-6 && t + 1e-6 < m.end);
    return i < 0 ? (t < measures[first].start ? first : last) : Math.max(first, Math.min(last, i));
  };

  // ── Notes per bar ──
  const bars = new Map();
  for (let i = first; i <= last; i++) bars.set(i, {i, label: measures[i].pickup ? 'Pickup' : String(measures[i].label), notes: 0, right: 0, missed: [], wrong: [], extra: 0});
  for (const e of exp) bars.get(e.measure).notes++;
  for (const [e] of al.pairs) bars.get(exp[e].measure).right++;
  for (const e of al.missed) bars.get(exp[e].measure).missed.push(noteName(exp[e].n));
  for (const [e, p] of al.wrong) bars.get(exp[e].measure).wrong.push([noteName(exp[e].n), noteName(played[p].n)]);
  for (const p of al.extra) bars.get(measureIndexAt(tAt(played[p].at))).extra++;

  const summary = {expected: exp.length, right: al.pairs.length, missed: al.missed.length + al.wrong.length, wrong: al.wrong.length, extra: al.extra.length};
  summary.accuracy = Math.round(100 * summary.right / Math.max(1, summary.expected + summary.extra + summary.wrong));

  // ── Timing: one onset per score time (the median of the chord's notes) ──
  const byT = new Map();
  for (const [e, p] of al.pairs) {
    const t = exp[e].t;
    if (!byT.has(t)) byT.set(t, []);
    byT.get(t).push(played[p].at);
  }
  const onsets = [...byT].map(([t, ats]) => ({x: t, y: median(ats)})).sort((a, b) => a.x - b.x);
  const line = fitLine(onsets);
  const timing = {meanBpm: null, writtenBpm: take.tempo || null, sdMs: null, score: null, curve: [], drift: null, rushed: null, slowed: null};
  const sectionMeasures = measures.slice(first, last + 1);
  if (line && line.b > 0 && onsets.length >= 4) {
    timing.meanBpm = Math.round(60000 / line.b);
    const win = m => Math.max(2, beatInfo(m.meter).bar / 2 + 1e-6); // half a bar each side, at least 2 quarters
    const devs = onsets.map(o => {
      const l = localLine(onsets, o.x, win(measures[measureIndexAt(o.x)]));
      return l && l.b > 0 ? o.y - (l.a + l.b * o.x) : o.y - (line.a + line.b * o.x);
    });
    timing.sdMs = round(sd(devs), 1);
    timing.score = Math.round(clamp(100 - (timing.sdMs - 12) * 1.25, 0, 100));
    const devAt = new Map(onsets.map((o, k) => [o.x, devs[k]]));
    for (const b of beatsOf(sectionMeasures)) {
      const m = measures[measureIndexAt(b.t)], len = beatInfo(m.meter).len;
      const l = localLine(onsets, b.t + len / 2, win(m));
      const bpm = l && l.b > 0 ? Math.round(60000 / l.b) : null;
      const inBeat = [...devAt].filter(([t]) => t >= b.t - 1e-6 && t < b.t + len - 1e-6).map(([, d]) => d);
      timing.curve.push([round(b.t, 3), bpm != null && bpm < 1000 ? bpm : null, inBeat.length ? Math.round(mean(inBeat)) : null]);
    }
    // Drift: the first and last quarter of the take.
    const tempos = timing.curve.filter(c => c[1] != null);
    if (tempos.length >= 8) {
      const q = Math.max(2, Math.floor(tempos.length / 4));
      const from = Math.round(median(tempos.slice(0, q).map(c => c[1]))), to = Math.round(median(tempos.slice(-q).map(c => c[1])));
      if (Math.abs(to - from) / from >= .08) timing.drift = {from, to};
    }
    // Bars well above / below the mean tempo, as a run of bars.
    const barTempo = new Map();
    for (const [t, bpm] of timing.curve) if (bpm != null) {
      const i = measureIndexAt(t);
      if (!barTempo.has(i)) barTempo.set(i, []);
      barTempo.get(i).push(bpm);
    }
    for (const [i, list] of barTempo) bars.get(i).bpm = Math.round(mean(list));
    const run = test => {
      let best = null, cur = null;
      for (let i = first; i <= last; i++) {
        const v = bars.get(i).bpm;
        if (v != null && test(v)) { cur = cur && cur.last === i - 1 ? {...cur, last: i} : {first: i, last: i}; if (!best || cur.last - cur.first > best.last - best.first) best = cur; } else if (v != null) cur = null;
      }
      return best ? barsText(measures, best.first, best.last) : null;
    };
    // A gradual drift is reported as such, not as bars that hurried or held back.
    timing.rushed = timing.drift ? null : run(v => v > timing.meanBpm * 1.1);
    timing.slowed = timing.drift ? null : run(v => v < timing.meanBpm * .9);
    for (const [t, d] of devAt) { const b = bars.get(measureIndexAt(t)); (b.devs ||= []).push(Math.abs(d)); }
  }
  for (const b of bars.values()) {
    b.accuracy = Math.round(100 * b.right / Math.max(1, b.notes + b.extra + b.wrong.length));
    if (b.devs) { b.devMs = Math.round(mean(b.devs)); delete b.devs; }
    b.missed = b.missed.filter((_, k) => k < 12);
    b.wrong = b.wrong.slice(0, 12);
  }

  // ── Touch: the player's analysis on the matched notes ──
  const qms = timing.meanBpm ? 60000 / timing.meanBpm : al.mpq;
  const matched = al.pairs.map(([e, p]) => {
    const s = exp[e], q = played[p];
    return {n: s.n, id: s.id, t: s.t, d: s.d, hand: s.hand, staff: s.staff, stacc: !!s.stacc, measure: s.measure,
      at: q.at, off: q.off, velocity: realKeys ? q.velocity : NaN, qms, source: take.source};
  });
  const id = String(take.songId || '');
  const exercise = id.startsWith('ex:') && !id.startsWith('ex:progression');
  const marks = song.marks ?? {};
  // Evenness is for scales and arpeggios (as in the player); a piece's shaping isn't unevenness.
  const ev = exercise && matched.length >= 6 ? evenness(matched) : null;
  const evenOut = ev ? {score: ev.score, timingSdMs: ev.timingSdMs, velocitySd: realKeys ? ev.velocitySd : null, velocityMean: realKeys ? ev.velocityMean : null} : null;
  const dynamics = realKeys && !exercise ? dynamicsReport(matched, {marks: marks.dynamics ?? [], hairpins: marks.hairpins ?? [], measures, hands: take.hands || 'both'}) : null;
  const articulation = realKeys ? articulationReport(matched, {slurs: marks.slurs ?? [], legato: exercise, measures}) : null;
  let pedal = null;
  if (take.pedal?.length || marks.pedals?.length) {
    const inSection = (marks.pedals ?? []).filter(m => m.t >= measures[first].start - 1e-6 && m.t < measures[last].end);
    const presses = (take.pedal || []).map(([ms, v]) => ({pos: tAt(ms), down: v >= 64}));
    if (presses.length || inSection.length) pedal = pedalReport(presses, inSection);
  }

  // ── Remarks: the few sentences worth reading ──
  const remarks = [];
  const worst = [...bars.values()].filter(b => b.notes >= 2 && b.accuracy < 80).sort((a, b) => a.accuracy - b.accuracy || a.i - b.i);
  if (summary.accuracy >= 98) remarks.push('Every note in place.');
  else if (worst.length) {
    const ids = worst.slice(0, 3).map(b => b.i).sort((a, b) => a - b);
    const labels = ids.map(i => (measures[i].pickup ? 'the pickup' : measures[i].label));
    remarks.push(ids.length === 1 ? `Most slips came in ${barsText(measures, ids[0])}.` : `Most slips came in bars ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}.`);
  }
  if (timing.drift) remarks.push(`The tempo ${timing.drift.to > timing.drift.from ? 'pressed on' : 'settled back'} from ♩ ≈ ${timing.drift.from} to ♩ ≈ ${timing.drift.to}.`);
  else if (timing.rushed) remarks.push(`${cap(timing.rushed)} hurried a little.`);
  else if (timing.slowed) remarks.push(`${cap(timing.slowed)} held back a little.`);
  else if (timing.score != null && timing.score >= 80) remarks.push('A steady pulse throughout.');
  if (exercise && ev) { const r = evennessRemark(ev, measures); if (r) remarks.push(r); }
  remarks.push(...(dynamics?.remarks ?? []).slice(0, 1), ...(articulation?.remarks ?? []).slice(0, 1));
  if (pedal?.remark) remarks.push(pedal.remark);

  const evenScore = evenOut?.score ?? timing.score ?? summary.accuracy;
  const score = Math.round(.6 * summary.accuracy + .25 * (timing.score ?? summary.accuracy) + .15 * evenScore);
  const strip = r => { if (!r) return null; const {points: _p, ...rest} = r; return rest; };
  return {
    v: REPORT_VERSION, songId: take.songId, section: [first, last], hands: take.hands || 'both', computedAt: now,
    summary, bars: [...bars.values()], timing,
    evenness: evenOut, dynamics: strip(dynamics), articulation, pedal,
    remarks: [...new Set(remarks)].slice(0, 4), verdict: verdictFor(summary.accuracy), score,
  };
}

/** Problem bars as short lines: "Bar 5: E5 missed; F5 for E5; 1 extra". */
export function barLines(report, {limit = 40} = {}) {
  const out = [];
  for (const b of report.bars) {
    const parts = [];
    if (b.missed.length) parts.push(`${b.missed.join(' ')} missed`);
    if (b.wrong.length) parts.push(b.wrong.map(([w, p]) => `${p} for ${w}`).join(', '));
    if (b.extra) parts.push(`${b.extra} extra`);
    if (!parts.length) continue;
    out.push({i: b.i, label: b.label === 'Pickup' ? 'Pickup' : `Bar ${b.label}`, text: parts.join('; '), accuracy: b.accuracy});
    if (out.length >= limit) break;
  }
  return out;
}
