// Listen and compare (docs/ROADMAP.md phase 15): one bar of the score, played by the sampler,
// beside the same bar of a recorded take, so the two can be heard A/B. The reference is
// played evenly at the take's own tempo in that bar (from the alignment's time warp), so the
// two clips last about as long and differ only in what the playing did. Pure; no DOM, no audio.
// Unit-tested in tests/record-compare.test.js.
//
//   const cmp = prepareCompare(song, take)          aligns once
//   cmp.bars                                         [{i, label}] the bars of the take's section
//   cmp.clip(i) → {reference: [note], take: [note], seconds: {reference, take}} | null
//     note = {n, delay (s from the clip's start), dur (s), velocity (0…1)}

import {alignTake, warpFns} from './align.mjs';
import {expectedNotes, playedNotes, takeSection} from './report.mjs';
import {dynamicLevel, markAt} from '../practice-core.mjs';

const EPS = 1e-6;
const LEAD_MS = 60; // a note this much early still belongs to the bar

export function prepareCompare(song, take) {
  const measures = song.measures;
  const [first, last] = takeSection(song, take);
  const {notes: exp} = expectedNotes(song, take);
  const played = playedNotes(take);
  const al = alignTake(exp, played, {tempo: take.tempo || song.tempo || 100});
  const {msAt} = warpFns(al.warp, al.mpq);
  const marks = song.marks?.dynamics ?? [];
  const bars = [];
  for (let i = first; i <= last; i++) bars.push({i, label: measures[i].pickup ? 'Pickup' : String(measures[i].label)});

  function clip(i) {
    const m = measures[i];
    if (!m || i < first || i > last) return null;
    const from = msAt(m.start), to = msAt(m.end);
    const mpq = to - from > EPS ? (to - from) / Math.max(EPS, m.end - m.start) : al.mpq;
    const reference = exp.filter(e => e.measure === i).sort((a, b) => a.t - b.t || a.n - b.n).map(e => ({
      n: e.n,
      delay: Math.max(0, (e.t - m.start) * mpq / 1000),
      dur: Math.max(.08, (e.d || .25) * mpq / 1000),
      velocity: (dynamicLevel(markAt(marks, e.t, e.staff)?.mark) ?? 72) / 127,
    }));
    const start = from - LEAD_MS;
    const mine = played.filter(p => p.at >= start && p.at < to - LEAD_MS).sort((a, b) => a.at - b.at).map(p => ({
      n: p.n,
      delay: Math.max(0, (p.at - from) / 1000),
      dur: Math.min(4, Math.max(.06, (p.off - p.at) / 1000)),
      velocity: Math.max(.05, Math.min(1, (Number.isFinite(p.velocity) ? p.velocity : 80) / 127)),
    }));
    const end = list => list.reduce((a, q) => Math.max(a, q.delay + Math.min(q.dur, 1.5)), 0);
    return {reference, take: mine, seconds: {reference: Math.max((m.end - m.start) * mpq / 1000, end(reference)), take: Math.max((to - from) / 1000, end(mine))}};
  }
  return {bars, clip};
}
