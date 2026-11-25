import {describe, expect, it} from 'vitest';
import {alignTake, performanceOrder, warpFns} from '../src/record/align.mjs';

// A C-major melody, one note per quarter, with a left-hand note on every bar's downbeat.
const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 69, 67, 65];
const score = [
  ...melody.map((n, i) => ({t: i, n, hand: 'r'})),
  ...[0, 4, 8, 12].map(t => ({t, n: 48, hand: 'l'})),
];

// Played times for score time t under a tempo that drifts from 100 to 70 BPM (smoothly).
const drift = t => {
  // ms per quarter rises linearly from 600 (100 BPM) to ~857 (70 BPM) over 16 quarters.
  const a = 600, b = (857 - 600) / 16;
  return 500 + a * t + b * t * t / 2;
};
const perform = (notes, at = drift, jitter = () => 0) => notes.map(({t, n}) => ({at: Math.round(at(t) + jitter(t, n)), n}));

describe('alignTake', () => {
  it('matches every note of a clean take, whatever the tempo drift', () => {
    const played = perform(score);
    const r = alignTake(score, played, {tempo: 100});
    expect(r.pairs).toHaveLength(score.length);
    expect(r.missed).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.wrong).toEqual([]);
    for (const [e, p] of r.pairs) expect(played[p].n).toBe(score[e].n);
    // The warp follows the drift: score time 12 ↔ the played time of t = 12.
    const {msAt, tAt} = warpFns(r.warp, r.mpq);
    expect(Math.abs(msAt(12) - drift(12))).toBeLessThan(2);
    expect(Math.abs(tAt(drift(7.5)) - 7.5)).toBeLessThan(.05);
  });

  it('handles a much slower and much faster performance than written', () => {
    for (const mpq of [1500, 250]) {
      const played = perform(score, t => 2000 + t * mpq);
      const r = alignTake(score, played, {tempo: 100});
      expect(r.pairs).toHaveLength(score.length);
      expect(r.mpq).toBeCloseTo(mpq, 0);
    }
  });

  it('reports missed notes and extra notes', () => {
    const missing = new Set([3, 9]); // melody indices 3 (F4) and 9 (E4)
    const played = perform(score.filter((_, i) => !missing.has(i)));
    played.push({at: Math.round(drift(5.5)), n: 61}); // a stray C♯ between two notes, nothing due there
    const r = alignTake(score, played, {tempo: 100});
    expect(r.missed.sort((a, b) => a - b)).toEqual([3, 9]);
    expect(r.extra).toHaveLength(1);
    expect(played[r.extra[0]].n).toBe(61);
    expect(r.pairs).toHaveLength(score.length - 2);
  });

  it('calls a different key played where a note was due a wrong note', () => {
    const played = perform(score).map(p => (p.n === 67 && Math.abs(p.at - drift(4)) < 5 ? {...p, n: 69} : p)); // A4 for G4 at t = 4
    const r = alignTake(score, played, {tempo: 100});
    expect(r.wrong).toHaveLength(1);
    const [e, p] = r.wrong[0];
    expect(score[e]).toMatchObject({t: 4, n: 67});
    expect(played[p].n).toBe(69);
    expect(r.missed).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('copes with a pause and a restart of a bar (repeated notes become extras)', () => {
    // Plays bars 1–2, stops for three seconds, plays bar 2 again, then goes on.
    const played = [];
    const at = t => 500 + t * 600;
    for (const e of score.filter(e => e.t < 8)) played.push({at: at(e.t), n: e.n});
    for (const e of score.filter(e => e.t >= 4 && e.t < 8)) played.push({at: at(e.t) + 2400 + 3000, n: e.n});
    for (const e of score.filter(e => e.t >= 8)) played.push({at: at(e.t) + 2400 + 3000, n: e.n});
    const r = alignTake(score, played, {tempo: 100});
    expect(r.missed).toEqual([]);
    expect(r.pairs).toHaveLength(score.length);
    expect(r.extra).toHaveLength(5); // the repeated bar 2: four melody notes and the bass note
  });

  it('pairs a rolled chord whose notes arrive out of pitch order', () => {
    const chordScore = [{t: 0, n: 48}, {t: 0, n: 55}, {t: 0, n: 64}, {t: 1, n: 60}];
    const played = [{at: 100, n: 64}, {at: 160, n: 48}, {at: 220, n: 55}, {at: 700, n: 60}];
    const r = alignTake(chordScore, played, {tempo: 100});
    expect(r.pairs).toHaveLength(4);
    expect(r.extra).toEqual([]);
  });

  it('returns everything missed / extra for empty inputs', () => {
    expect(alignTake(score, []).missed).toHaveLength(score.length);
    expect(alignTake([], [{at: 0, n: 60}]).extra).toEqual([0]);
  });

  it('orders chord notes by pitch within a cluster', () => {
    const order = performanceOrder([{at: 10, n: 67}, {at: 0, n: 60}, {at: 20, n: 64}, {at: 500, n: 62}]);
    expect(order).toEqual([1, 2, 0, 3]);
  });
});
