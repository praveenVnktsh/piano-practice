// Suggested fingering (docs/ROADMAP.md, Phase 19): for music with no printed fingering, a
// finger (1–5) for every struck note of each hand. Pure, no DOM.
//
//   suggestFingering(notes, {hand, beginner, fixed}) → Map(id → finger)
//       notes: one hand's struck notes [{id, n (MIDI), t, end}] (times in quarter notes);
//       hand: 'r' | 'l'; fixed: Map(id → finger) printed fingers the answer must keep.
//   suggestForSong(song, {printed, beginner}) → Map(id → finger) for the notes in bars (per staff)
//       that have no printed fingering at all; printed = printedFingering(mei) (./printed.mjs).
//
// The method is a Viterbi search (dynamic programming) over finger assignments, slice by slice:
// a slice is the notes one hand strikes together; a chord's fingers rise bottom → top in the right
// hand (thumb lowest) and fall in the left. Costs, in the spirit of Parncutt et al. (1997, "An
// ergonomic model of keyboard fingering"), all in rough "effort points":
//   - stretch: the interval between two fingers against a table of practical / comfortable /
//     relaxed spans per finger pair (SPANS); outside relaxed 1 point a semitone, outside
//     comfortable 2 more, outside practical 10 more (chords only count comfortable and practical);
//   - crossing: thumb under / finger over (CROSS by the finger crossed), more onto a black thumb;
//     two fingers other than the thumb crossing is all but impossible;
//   - same finger on two different notes in a row; changing finger on a repeated note (unless the
//     repeat is fast, when keeping the finger costs instead);
//   - thumb on a black key, little finger on a black key;
//   - hand position: each finger step should be a white-key step (five-finger positions), stronger
//     for beginners, who also pay more for crossings;
//   - a finger still holding a note can't play the next one.
// A rest of an eighth or more lets the hand move freely (capped cost), and so does a leap no hand
// can stretch. Accuracy against the conventional scale and arpeggio fingerings is measured in
// tests/fingering.test.js.

// [minPrac, minComf, minRel, maxRel, maxComf, maxPrac]: semitones from the lower-numbered finger's
// note to the higher one's, right hand (the left hand is mirrored).
const SPANS = {
  12: [-5, -3, 1, 5, 8, 10], 13: [-4, -2, 3, 7, 10, 12], 14: [-3, -1, 5, 9, 12, 14], 15: [-1, 1, 7, 10, 13, 15],
  23: [1, 1, 1, 2, 3, 5], 24: [1, 1, 3, 4, 5, 7], 25: [2, 2, 5, 6, 8, 10],
  34: [1, 1, 1, 2, 3, 4], 35: [1, 1, 3, 4, 5, 7], 45: [1, 1, 1, 2, 3, 5],
};
export const CROSS = {2: 4, 3: 1.5, 4: 2.5, 5: 9}; // thumb passing under (or this finger over the thumb)
export const WEIGHTS = {
  sameFinger: 5, repeatChange: 1, fastRepeat: 1, blackThumb: 2.5, blackFifth: 1, blackThumbCross: 2,
  triple: .5, crossSemitone: .3, crossWide: 0, crossPrac: 1, crossEasy: .6, impossible: 12, busy: 20, rest: 2.5, leap: 6, position: .2,
};
const W = WEIGHTS;
const BEGINNER = {cross: 1.6, position: .8};
const REST = .5; // quarters of silence that free the hand
const FAST = .25; // a repeat this close (quarters) wants a finger change
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = n => BLACK.has(((n % 12) + 12) % 12);
// White-key index: C D E F G A B = 0..6 per octave, a black key halfway between its neighbours.
const WHITE = [0, .5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const whiteIndex = n => Math.floor(n / 12) * 7 + WHITE[((n % 12) + 12) % 12];

const beyond = (v, lo, hi) => Math.max(0, lo - v) + Math.max(0, v - hi);

/** Stretch cost of two fingers on two notes (x = mirrored pitch), sequential or together. */
function spanCost(xa, fa, xb, fb, chord) {
  const [lo, hi] = fa < fb ? [fa, fb] : [fb, fa];
  const span = fa < fb ? xb - xa : xa - xb; // higher finger's note minus lower finger's note
  const [minP, minC, minR, maxR, maxC, maxP] = SPANS[lo * 10 + hi];
  const prac = beyond(span, minP, maxP);
  return (chord ? 0 : beyond(span, minR, maxR)) + 2 * beyond(span, minC, maxC) + 10 * prac;
}

function makeStep(opts) {
  const cross = opts.beginner ? BEGINNER.cross : 1;
  const posW = opts.beginner ? BEGINNER.position : W.position;
  const x = opts.hand === 'l' ? n => -n : n => n;
  // a → b: notes {n, t, end}, fingers fa → fb.
  return function step(a, fa, b, fb) {
    const d = x(b.n) - x(a.n);
    const fast = b.t - a.t <= FAST;
    if (d === 0) return fa === fb ? (fast ? W.fastRepeat : 0) : (fast ? 0 : W.repeatChange);
    if (fa === fb) return W.sameFinger + Math.abs(d) * .25;
    const [lo, hi] = fa < fb ? [fa, fb] : [fb, fa];
    const span = fa < fb ? d : -d;
    if (span <= 0) { // crossing
      if (lo !== 1) return W.impossible;
      const thumbN = fa === 1 ? a.n : b.n, otherN = fa === 1 ? b.n : a.n;
      const [minP] = SPANS[10 + hi];
      // Passing from a black key onto a white thumb is the easy crossing; the wider, the harder.
      const easy = isBlack(otherN) && !isBlack(thumbN) ? W.crossEasy : 1;
      return cross * CROSS[hi] * easy + W.crossSemitone * -span + W.crossWide * Math.max(0, -span - 2) + W.crossPrac * Math.max(0, minP - span)
        + (isBlack(thumbN) && !isBlack(otherN) ? W.blackThumbCross : 0);
    }
    const steps = Math.abs(whiteIndex(b.n) - whiteIndex(a.n));
    return spanCost(x(a.n), fa, x(b.n), fb, false) + posW * Math.abs(steps - (hi - lo));
  };
}

// All strictly rising finger tuples of length k (k ≤ 5).
function tuples(k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let f = start; f <= 5 - (k - acc.length - 1); f++) rec(f + 1, [...acc, f]);
  };
  rec(1, []);
  return out;
}

/** Notes struck together → slices sorted by time; each slice's notes sorted bottom → top in x. */
function slicesOf(notes, hand) {
  const x = hand === 'l' ? n => -n : n => n;
  const byT = new Map();
  for (const e of notes) {
    const key = Math.round(e.t * 1e4);
    if (!byT.has(key)) byT.set(key, []);
    byT.get(key).push(e);
  }
  return [...byT.values()].map(group => {
    const pitches = new Map(); // unisons in two voices share a finger
    for (const e of group) {
      const p = pitches.get(e.n);
      if (p) { p.ids.push(e.id); p.end = Math.max(p.end, e.end ?? e.t); } else pitches.set(e.n, {n: e.n, t: e.t, end: e.end ?? e.t, ids: [e.id]});
    }
    const ns = [...pitches.values()].sort((a, b) => x(a.n) - x(b.n));
    return {t: group[0].t, end: Math.max(...ns.map(p => p.end)), notes: ns};
  }).sort((a, b) => a.t - b.t);
}

export function suggestFingering(notes, {hand = 'r', beginner = false, fixed = new Map()} = {}) {
  const out = new Map();
  if (!notes?.length) return out;
  const x = hand === 'l' ? n => -n : n => n;
  const step = makeStep({hand, beginner});
  const posW = beginner ? BEGINNER.position : W.position;
  const slices = slicesOf(notes, hand);
  // Each slice's candidate states: finger tuples (bottom → top) with their own cost.
  const states = slices.map(s => {
    const k = s.notes.length;
    if (k > 5) return [{f: null, own: 0}];
    const raw = tuples(k); // in x order: RH bottom → top, LH top → bottom (thumb on the top note)
    const list = [];
    for (const f of raw) {
      let ok = true, own = 0;
      s.notes.forEach((p, i) => {
        const want = p.ids.map(id => fixed.get(id)).find(v => v >= 1 && v <= 5);
        if (want != null && want !== f[i]) ok = false;
        if (isBlack(p.n) && f[i] === 1) own += W.blackThumb;
        if (isBlack(p.n) && f[i] === 5) own += W.blackFifth;
      });
      if (!ok) continue;
      for (let i = 1; i < k; i++) {
        const lo = s.notes[i - 1].n, hi = s.notes[i].n;
        own += spanCost(x(lo), f[i - 1], x(hi), f[i], true) + posW * Math.abs(Math.abs(whiteIndex(hi) - whiteIndex(lo)) - (f[i] - f[i - 1]));
      }
      if (k > 2) own += spanCost(x(s.notes[0].n), f[0], x(s.notes[k - 1].n), f[k - 1], true) * .5;
      list.push({f, own});
    }
    // Printed fingers that don't fit (a typo, a substitution): ignore them rather than fail.
    return list.length ? list : tuples(k).map(f => ({f, own: 0}));
  });
  const trans = (P, sp, Q, sq) => {
    if (!sp.f || !sq.f) return 0;
    const gap = Q.t - P.end;
    let sum = 0, cnt = 0, extra = 0;
    P.notes.forEach((p, i) => Q.notes.forEach((q, j) => { sum += step(p, sp.f[i], q, sq.f[j]); cnt++; }));
    let c = sum / cnt;
    // Notes still held: their fingers are busy, and the new notes must reach from them.
    P.notes.forEach((p, i) => {
      if (p.end <= Q.t + 1e-6) return;
      Q.notes.forEach((q, j) => {
        if (q.n === p.n) return;
        if (sq.f[j] === sp.f[i]) extra += W.busy;
        else extra += spanCost(x(p.n), sp.f[i], x(q.n), sq.f[j], true);
      });
    });
    const leap = Math.abs(x(Q.notes[0].n) - x(P.notes[0].n)) > 15 && Math.abs(x(Q.notes.at(-1).n) - x(P.notes.at(-1).n)) > 15;
    if (gap >= REST - 1e-6) c = Math.min(c, W.rest);
    else if (leap) c = Math.min(c, W.leap);
    return c + extra;
  };
  // Three single notes in a row: did the hand have to change position between the first and the
  // third (Parncutt's position-change count and size)? This is what keeps a broken chord inside
  // one hand position instead of crossing the thumb under on every note.
  const triple = (A, sa, B, sb, C, sc) => {
    if (!sa.f || !sc.f || A.notes.length > 1 || B.notes.length > 1 || C.notes.length > 1) return 0;
    if (B.t - A.end >= REST - 1e-6 || C.t - B.end >= REST - 1e-6) return 0;
    const a = A.notes[0].n, c = C.notes[0].n, fa = sa.f[0], fc = sc.f[0];
    if (a === c) return 0;
    if (fa === fc) return W.triple * 2;
    // A thumb crossing in between already paid for moving the hand (step costs).
    const b = B.notes[0].n, fb = sb.f[0];
    const crossed = (f1, n1, f2, n2) => (f2 - f1) * (x(n2) - x(n1)) < 0;
    if (crossed(fa, a, fb, b) || crossed(fb, b, fc, c)) return 0;
    const [lo, hi] = fa < fc ? [fa, fc] : [fc, fa];
    const span = fa < fc ? x(c) - x(a) : x(a) - x(c);
    const [minP, minC, , , maxC, maxP] = SPANS[lo * 10 + hi];
    const comf = beyond(span, minC, maxC);
    return W.triple * ((beyond(span, minP, maxP) > 0 ? 2 : comf > 0 ? 1 : 0) + comf);
  };
  // Second-order Viterbi: the state is the fingering of the last two slices.
  const n = slices.length;
  const pick = new Array(n);
  if (n === 1) {
    const own = states[0].map(s => s.own);
    pick[0] = own.indexOf(Math.min(...own));
  } else {
    // dp[k][j]: best cost with slice i-1 in state k and slice i in state j.
    let dp = states[0].map(sp => states[1].map(sq => sp.own + trans(slices[0], sp, slices[1], sq) + sq.own));
    const back = [null, null];
    for (let i = 2; i < n; i++) {
      const A = slices[i - 2], B = slices[i - 1], C = slices[i];
      const prev = states[i - 2], mid = states[i - 1], cur = states[i];
      const next = mid.map(() => new Array(cur.length));
      const bp = mid.map(() => new Array(cur.length));
      mid.forEach((sb, k) => cur.forEach((sc, j) => {
        let best = Infinity, arg = 0;
        prev.forEach((sa, h) => {
          const v = dp[h][k] + triple(A, sa, B, sb, C, sc);
          if (v < best - 1e-9) { best = v; arg = h; }
        });
        next[k][j] = best + trans(B, sb, C, sc) + sc.own;
        bp[k][j] = arg;
      }));
      dp = next; back.push(bp);
    }
    let best = Infinity;
    dp.forEach((row, k) => row.forEach((v, j) => { if (v < best - 1e-9) { best = v; pick[n - 2] = k; pick[n - 1] = j; } }));
    for (let i = n - 1; i >= 2; i--) pick[i - 2] = back[i][pick[i - 1]][pick[i]];
  }
  slices.forEach((s, i) => {
    const st = states[i][pick[i]];
    if (st.f) s.notes.forEach((p, k) => { for (const id of p.ids) out.set(id, st.f[k]); });
  });
  return out;
}

const measureAt = (measures, t) => {
  let lo = 0, hi = measures.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measures[mid].start <= t + 1e-6) lo = mid; else hi = mid - 1; }
  return measures[lo];
};

/**
 * Suggestions for a whole song ({segments, measures}: src/song.js). Printed fingering is never
 * overridden: it anchors the search, and a bar's staff with any printed number gets no suggestion.
 */
export function suggestForSong(song, {printed = {fingers: new Map(), bars: new Set()}, beginner = false} = {}) {
  const out = new Map();
  const segs = (song?.segments ?? []).filter(s => s.id === (s.root ?? s.id) && Number.isFinite(s.n));
  if (!segs.length || !song.measures?.length) return out;
  for (const hand of ['r', 'l']) {
    const notes = segs.filter(s => (s.hand ?? 'r') === hand).map(s => ({id: s.id, n: s.n, t: s.t, end: s.end, staff: s.staff}));
    const fingers = suggestFingering(notes, {hand, beginner, fixed: printed.fingers});
    for (const e of notes) {
      const f = fingers.get(e.id);
      if (f == null || printed.fingers.has(e.id)) continue;
      const m = measureAt(song.measures, e.t);
      if (printed.bars.has(`${m.id}:${e.staff ?? 1}`)) continue;
      out.set(e.id, f);
    }
  }
  return out;
}
