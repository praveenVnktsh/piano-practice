// Mock exam marking, in the style of a graded practical exam report. Pure; tested in
// tests/record-report.test.js.
//
// Each item is marked from its take's report: quality q = 60 % notes (accuracy) + 25 % timing
// + 15 % evenness (0–100; timing again for pieces), and mark = max × markFraction(q), rounded
// (q 100 → full marks, 97 → 90 %, 90 → 82 %, 80 → 75 %, 65 → 66.7 %, 50 → 55 %). Bands, for an item
// and for the whole exam, are fractions of the maximum:
//   Distinction ≥ 90 %, Merit ≥ 80 %, Pass ≥ 66.7 % (e.g. 27 / 24 / 20 out of 30), else Below pass.
// Pieces are out of 30, the scale and sight-reading out of 21 (as in the familiar exams).

export const ITEM_MAX = {piece: 30, scale: 21, 'sight-reading': 21};
export const BANDS = [[.9, 'Distinction'], [.8, 'Merit'], [2 / 3, 'Pass'], [0, 'Below pass']];
export const bandOf = (mark, max) => BANDS.find(([f]) => mark >= Math.ceil(f * max - 1e-9))[1];

/** 0–100 from a report's accuracy, timing score and evenness score. */
export function quality(report) {
  if (!report?.summary) return 0;
  const acc = report.summary.accuracy ?? 0;
  const timing = report.timing?.score ?? acc;
  const even = report.evenness?.score ?? timing;
  return Math.round(.6 * acc + .25 * timing + .15 * even);
}

// Quality → fraction of the marks: generous low down, strict at the top (a slip or two keeps
// a piece off full marks), like an examiner's scale.
const CURVE = [[0, .3], [50, .55], [65, 2 / 3], [80, .75], [90, .82], [97, .9], [100, 1]];
export function markFraction(q) {
  q = Math.max(0, Math.min(100, q));
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i];
    if (q <= x1) { const [x0, y0] = CURVE[i - 1]; return y0 + (y1 - y0) * (q - x0) / (x1 - x0); }
  }
  return 1;
}
export function itemMark(report, max) {
  if (!report?.summary || !report.summary.right) return 0;
  return Math.max(0, Math.min(max, Math.round(max * markFraction(quality(report)))));
}

/** A sentence or two in an examiner's voice. */
export function itemComment(report, kind = 'piece') {
  if (!report?.summary?.right) return 'Not performed.';
  const {accuracy} = report.summary, t = report.timing ?? {};
  const notes = accuracy >= 97 ? 'Notes secure and accurate throughout'
    : accuracy >= 90 ? 'Notes largely secure, with a few slips'
    : accuracy >= 75 ? 'Generally reliable notes, though slips interrupted the flow'
    : accuracy >= 50 ? 'The notes were not yet fully secure'
    : 'Many notes were missed or uncertain';
  const pulse = t.score == null ? '' : t.score >= 85 ? 'a steady, well-judged pulse' : t.score >= 65 ? 'a mostly steady pulse' : 'an uneven pulse';
  let s = pulse ? `${notes}, with ${pulse}` : notes;
  if (t.meanBpm) s += ` at about ♩ = ${t.meanBpm}`;
  if (t.meanBpm && t.writtenBpm) s += t.meanBpm > t.writtenBpm * 1.15 ? ', rather fast for the marking' : t.meanBpm < t.writtenBpm * .8 ? ', a cautious tempo' : '';
  s += '.';
  const worst = report.bars?.filter(b => b.notes >= 2 && b.accuracy < 75).sort((a, b) => a.accuracy - b.accuracy)[0];
  if (worst && accuracy < 97) s += ` ${worst.label === 'Pickup' ? 'The pickup' : `Bar ${worst.label}`} needs attention.`;
  else if (t.drift) s += ` The tempo ${t.drift.to > t.drift.from ? 'pressed forward' : 'slackened'} towards the end.`;
  else if (t.rushed) s += ` ${t.rushed.charAt(0).toUpperCase() + t.rushed.slice(1)} hurried.`;
  if (kind === 'scale' && report.evenness?.score != null)
    s += report.evenness.score >= 80 ? ' Even in touch and rhythm.' : ' Aim for a more even touch.';
  if (kind === 'piece' && report.dynamics?.remarks?.length) s += ` ${report.dynamics.remarks[0]}`;
  return s.replace(/\.\./g, '.');
}

/**
 * The results sheet. items: [{kind, songId, title, takeId, report}] → validated-shape sheet
 * {items: [{kind, songId, title, takeId, mark, max, band, comment, accuracy, timing, evenness}], total, max, band, remarks}.
 */
export function examResults(items) {
  const out = items.map(it => {
    const max = ITEM_MAX[it.kind] ?? 30;
    const mark = itemMark(it.report, max);
    return {
      kind: it.kind, songId: it.songId ?? null, title: it.title || '', takeId: it.takeId ?? null,
      mark, max, band: bandOf(mark, max), comment: itemComment(it.report, it.kind),
      accuracy: it.report?.summary?.accuracy ?? null, timing: it.report?.timing?.score ?? null, evenness: it.report?.evenness?.score ?? null,
    };
  });
  const total = out.reduce((a, it) => a + it.mark, 0), max = out.reduce((a, it) => a + it.max, 0);
  const band = bandOf(total, max);
  const best = out.slice().sort((a, b) => b.mark / b.max - a.mark / a.max)[0];
  const weakest = out.slice().sort((a, b) => a.mark / a.max - b.mark / b.max)[0];
  const remarks = [];
  if (band === 'Distinction') remarks.push('A distinguished, assured performance overall.');
  else if (band === 'Merit') remarks.push('A creditable performance, with much to enjoy.');
  else if (band === 'Pass') remarks.push('A sound foundation; secure the notes and the pulse will follow.');
  else remarks.push('Not yet at a passing standard: practise the weakest item slowly and try again.');
  if (best && weakest && best !== weakest) remarks.push(`Strongest: ${best.title}. Most to gain: ${weakest.title}.`);
  return {items: out, total, max, band, remarks};
}
