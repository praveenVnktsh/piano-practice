// Aligns a recorded performance with the score, tolerant to tempo drift, pauses, missed,
// wrong and extra notes. Pure; unit-tested in tests/record-align.test.js.
//
//   alignTake(expected, played, {tempo}) → {pairs, missed, wrong, extra, warp, mpq}
//     expected: [{t (quarter notes), n (MIDI)}, …]   the score's notes (any order)
//     played:   [{at (ms), n}, …]                     the take's notes (any order)
//     pairs:  [[expectedIndex, playedIndex], …]      matched notes (same pitch), in score order
//     wrong:  [[expectedIndex, playedIndex], …]      a different key played where a note was due
//     missed: [expectedIndex, …]                     due but not played (wrong ones not included)
//     extra:  [playedIndex, …]                       played, matching nothing (wrong ones not included)
//     warp:   [[t, ms], …]                           score time ↔ performance time, monotone
//     mpq:    ms per quarter note overall
//
// Method: chords in the performance are clustered by onset and sorted by pitch, so both
// sequences read "in score order". Pass 1 is a longest-common-subsequence on pitch alone
// (no timing at all, so any tempo, rubato or pause is fine) and gives a rough time warp.
// Pass 2 re-runs the alignment weighting each match by how close it falls to that warp, and
// refuses matches far from it (a stray repeat of a phrase can't steal notes from elsewhere).
// A last pass pairs leftovers of equal pitch close in time (rolled chords) and calls an
// unmatched played note close to an unmatched expected one a wrong note.

const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Order of the played notes: chords (onsets within chordMs) sorted by pitch. */
export function performanceOrder(played, chordMs = 35) {
  const idx = played.map((_, i) => i).sort((a, b) => played[a].at - played[b].at || played[a].n - played[b].n);
  const out = [];
  let cluster = [], start = -Infinity;
  for (const i of idx) {
    if (played[i].at - start > chordMs) {
      out.push(...cluster.sort((a, b) => played[a].n - played[b].n));
      cluster = []; start = played[i].at;
    }
    cluster.push(i);
  }
  out.push(...cluster.sort((a, b) => played[a].n - played[b].n));
  return out;
}

// Weighted LCS over two index lists. weight(ei, pj) → 0 (no match) or a positive integer.
function lcs(E, P, weight) {
  const m = E.length, k = P.length, W = k + 1;
  const dir = new Uint8Array((m + 1) * W);
  let prev = new Float64Array(W), cur = new Float64Array(W);
  for (let i = 1; i <= m; i++) {
    cur[0] = 0;
    const ei = E[i - 1];
    for (let j = 1; j <= k; j++) {
      const up = prev[j], left = cur[j - 1];
      let best = up, d = 1;
      if (left > best) { best = left; d = 2; }
      const w = weight(ei, P[j - 1]);
      if (w > 0 && prev[j - 1] + w >= best) { best = prev[j - 1] + w; d = 3; }
      cur[j] = best; dir[i * W + j] = d;
    }
    [prev, cur] = [cur, prev];
  }
  const pairs = [];
  for (let i = m, j = k; i > 0 && j > 0;) {
    const d = dir[i * W + j];
    if (d === 3) { pairs.push([E[i - 1], P[j - 1]]); i--; j--; } else if (d === 1) i--; else j--;
  }
  return pairs.reverse();
}

/** Monotone warp points [[t, ms], …] from matched pairs: one point per score onset (median time). */
export function warpFromPairs(pairs, expected, played) {
  const byT = new Map();
  for (const [e, p] of pairs) {
    const t = expected[e].t;
    if (!byT.has(t)) byT.set(t, []);
    byT.get(t).push(played[p].at);
  }
  const pts = [...byT].map(([t, ats]) => [t, median(ats)]).sort((a, b) => a[0] - b[0]);
  // Keep the longest run that rises in both coordinates (drops the odd crossed match).
  const n = pts.length, len = new Array(n).fill(1), from = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - 64); j < i; j++)
    if (pts[j][1] < pts[i][1] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; from[i] = j; }
  let end = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[end]) end = i;
  const keep = [];
  for (let i = n ? end : -1; i >= 0; i = from[i]) keep.push(pts[i]);
  return keep.reverse();
}

/** Least-squares slope (ms per quarter) through warp points, or null. */
export function warpSlope(warp) {
  if (warp.length < 2) return null;
  const mx = warp.reduce((a, p) => a + p[0], 0) / warp.length, my = warp.reduce((a, p) => a + p[1], 0) / warp.length;
  let sxx = 0, sxy = 0;
  for (const [x, y] of warp) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  return sxx > 1e-9 && sxy > 0 ? sxy / sxx : null;
}

/** Interpolating functions over a warp: msAt(t) and its inverse tAt(ms); straight lines (mpq) outside. */
export function warpFns(warp, mpq) {
  const pts = warp.length ? warp : [[0, 0]];
  const msAt = t => {
    if (t <= pts[0][0]) return pts[0][1] - (pts[0][0] - t) * mpq;
    const last = pts.at(-1);
    if (t >= last[0]) return last[1] + (t - last[0]) * mpq;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
    const [t0, m0] = pts[lo], [t1, m1] = pts[hi];
    return m0 + (m1 - m0) * (t - t0) / (t1 - t0);
  };
  const tAt = ms => {
    if (ms <= pts[0][1]) return pts[0][0] - (pts[0][1] - ms) / mpq;
    const last = pts.at(-1);
    if (ms >= last[1]) return last[0] + (ms - last[1]) / mpq;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][1] <= ms) lo = mid; else hi = mid; }
    const [t0, m0] = pts[lo], [t1, m1] = pts[hi];
    return m1 === m0 ? t0 : t0 + (t1 - t0) * (ms - m0) / (m1 - m0);
  };
  return {msAt, tAt};
}

// For very long takes (beyond maxCells), a greedy left-to-right match that follows the tempo.
function greedy(E, P, expected, played, mpq0) {
  const used = new Set(), pairs = [];
  let anchorT = null, anchorMs = null, mpq = mpq0, misses = 0;
  const firstAt = played[P[0]]?.at ?? 0;
  for (const e of E) {
    const {t, n} = expected[e];
    const pred = anchorT == null ? firstAt : anchorMs + (t - anchorT) * mpq;
    const win = Math.max(300, mpq * (1 + misses));
    let best = -1, bestD = Infinity;
    for (const p of P) {
      if (used.has(p) || played[p].n !== n) continue;
      const d = Math.abs(played[p].at - pred);
      if (anchorT == null ? played[p].at < firstAt + 4000 && d < bestD : d <= win && d < bestD) { best = p; bestD = d; }
    }
    if (best < 0) { misses++; continue; }
    used.add(best); pairs.push([e, best]); misses = 0;
    const at = played[best].at;
    if (anchorT != null && t > anchorT) mpq = clamp(.8 * mpq + .2 * (at - anchorMs) / (t - anchorT), mpq0 / 3, mpq0 * 3);
    anchorT = t; anchorMs = at;
  }
  return pairs;
}

export function alignTake(expected, played, {tempo = 100, chordMs = 35, maxCells = 30e6} = {}) {
  const E = expected.map((_, i) => i).sort((a, b) => expected[a].t - expected[b].t || expected[a].n - expected[b].n);
  const P = performanceOrder(played, chordMs);
  const mpq0 = 60000 / (tempo > 0 ? tempo : 100);
  const empty = {pairs: [], missed: E.slice(), wrong: [], extra: P.slice(), warp: [], mpq: mpq0};
  if (!E.length || !P.length) return empty;

  const big = E.length * P.length > maxCells;
  // Pass 1: pitch only.
  let pairs = big ? greedy(E, P, expected, played, mpq0) : lcs(E, P, (e, p) => (expected[e].n === played[p].n ? 1 : 0));
  let warp = warpFromPairs(pairs, expected, played);
  let mpq = warpSlope(warp) ?? mpq0;
  if (warp.length < 2) { // too little to warp on: anchor the first notes, assume the written tempo
    const t0 = expected[E[0]].t, a0 = played[P[0]].at;
    warp = [[t0, a0]]; mpq = mpq0;
  }
  let fns = warpFns(warp, mpq);
  const tol = clamp(1.25 * mpq, 300, 1500);

  // Pass 2: weighted by closeness to the warp.
  if (!big) {
    pairs = lcs(E, P, (e, p) => {
      if (expected[e].n !== played[p].n) return 0;
      const dev = Math.abs(played[p].at - fns.msAt(expected[e].t));
      return dev > tol ? 0 : 1000 - Math.round(500 * dev / tol);
    });
    const w2 = warpFromPairs(pairs, expected, played);
    if (w2.length >= 2) { warp = w2; mpq = warpSlope(warp) ?? mpq; fns = warpFns(warp, mpq); }
  }

  // Leftovers: equal pitch close in time (a rolled chord read out of order).
  const usedE = new Set(pairs.map(p => p[0])), usedP = new Set(pairs.map(p => p[1]));
  const near = (limit, same) => {
    const cands = [];
    for (const e of E) {
      if (usedE.has(e)) continue;
      const due = fns.msAt(expected[e].t);
      for (const p of P) {
        if (usedP.has(p) || same !== (played[p].n === expected[e].n)) continue;
        const d = Math.abs(played[p].at - due);
        if (d <= limit) cands.push([d, e, p]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [, e, p] of cands) if (!usedE.has(e) && !usedP.has(p)) { usedE.add(e); usedP.add(p); out.push([e, p]); }
    return out;
  };
  pairs.push(...near(tol / 2, true));
  const wrong = near(Math.max(150, .5 * mpq), false);
  pairs.sort((a, b) => expected[a[0]].t - expected[b[0]].t || expected[a[0]].n - expected[b[0]].n);
  wrong.sort((a, b) => expected[a[0]].t - expected[b[0]].t);
  return {
    pairs, wrong,
    missed: E.filter(e => !usedE.has(e)),
    extra: P.filter(p => !usedP.has(p)).sort((a, b) => played[a].at - played[b].at),
    warp, mpq,
  };
}
