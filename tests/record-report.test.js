import {describe, expect, it} from 'vitest';
import {buildReport, barLines, expectedNotes} from '../src/record/report.mjs';
import {Recorder, trimLead} from '../src/record/recorder.mjs';
import {bandOf, examResults, itemMark, markFraction, quality} from '../src/record/exam.mjs';
import {compactSummary, examText, reportText, sendText, takeLine} from '../src/record/text.mjs';
import {takeMeta, validateTake} from '../src/record/take.mjs';

// Four bars of 4/4: right hand in quarters (16 notes), left hand a half note twice a bar.
const RH = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 69, 67, 65];
function song() {
  const measures = [0, 1, 2, 3].map(i => ({id: 'm' + i, index: i, label: String(i + 1), start: i * 4, end: i * 4 + 4, pickup: false, visit: 1, meter: {count: 4, unit: 4}}));
  const events = [
    ...RH.map((n, i) => ({id: 'r' + i, t: i, d: 1, n, hand: 'r', staff: 1})),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((t, i) => ({id: 'l' + i, t, d: 2, n: i % 2 ? 43 : 48, hand: 'l', staff: 2})),
  ];
  return {measures, events, marks: {dynamics: [], hairpins: [], slurs: [], pedals: []}, tempo: 100};
}
const take = (notes, extra = {}) => validateTake({id: 'abcdefgh12', songId: 'test-piece', title: 'Test piece', at: Date.UTC(2026, 10, 24, 9), tempo: 100,
  section: [0, 3], hands: 'both', mode: 'free', source: 'midi', notes, pedal: [], ...extra});

// Performs the score at `mpq` ms per quarter; `edit(event, row)` can drop (null) or change a note.
function perform(s, mpq = 600, edit = (e, row) => row, jitter = () => 0) {
  const rows = [];
  for (const e of s.events) {
    const row = edit(e, [Math.round(400 + e.t * mpq + jitter(e)), e.n, e.hand === 'l' ? 60 : 80, Math.round(e.d * mpq * .9)]);
    if (row) rows.push(row);
  }
  return rows;
}

describe('buildReport', () => {
  it('scores a clean, steady take at 100 %', () => {
    const s = song();
    const r = buildReport({song: s, take: take(perform(s, 600)), now: 1});
    expect(r.summary).toEqual({expected: 24, right: 24, missed: 0, wrong: 0, extra: 0, accuracy: 100});
    expect(r.timing.meanBpm).toBe(100);
    expect(r.timing.sdMs).toBeLessThan(1);
    expect(r.timing.score).toBe(100);
    expect(r.timing.curve).toHaveLength(16); // one point per beat
    expect(r.timing.curve.every(([, bpm]) => bpm === 100)).toBe(true);
    expect(r.timing.drift).toBeNull();
    expect(r.verdict).toBe('Clean.');
    expect(r.score).toBe(100);
    expect(r.bars.map(b => b.accuracy)).toEqual([100, 100, 100, 100]);
    expect(barLines(r)).toEqual([]);
  });

  it('counts missed, wrong and extra notes in the right bars', () => {
    const s = song();
    const notes = perform(s, 600, (e, row) => {
      if (e.id === 'r5') return null; // bar 2: F4 missed
      if (e.id === 'r10') return [row[0], 69, row[2], row[3]]; // bar 3: A4 for G4
      return row;
    });
    notes.push([400 + 13.5 * 600, 61, 70, 100]); // bar 4: a stray C♯4 between beats
    const r = buildReport({song: s, take: take(notes)});
    expect(r.summary).toMatchObject({expected: 24, right: 22, missed: 2, wrong: 1, extra: 1});
    expect(r.summary.accuracy).toBe(Math.round(100 * 22 / 26));
    const [b1, b2, b3, b4] = r.bars;
    expect(b1).toMatchObject({right: 6, missed: [], extra: 0, accuracy: 100});
    expect(b2.missed).toEqual(['F4']);
    expect(b3.wrong).toEqual([['G4', 'A4']]);
    expect(b4.extra).toBe(1);
    expect(barLines(r).map(l => `${l.label}: ${l.text}`)).toEqual(['Bar 2: F4 missed', 'Bar 3: A4 for G4', 'Bar 4: 1 extra']);
  });

  it('draws a tempo curve that follows a gradual ritardando and notices the drift', () => {
    const s = song();
    // ms per quarter grows from 500 (120 BPM) to ~750 (80 BPM).
    const at = t => 300 + 500 * t + (250 / 16) * t * t / 2;
    const notes = s.events.map(e => [Math.round(at(e.t)), e.n, 70, 300]);
    const r = buildReport({song: s, take: take(notes)});
    expect(r.summary.accuracy).toBe(100);
    const bpms = r.timing.curve.map(c => c[1]).filter(v => v != null);
    expect(bpms[0]).toBeGreaterThan(bpms.at(-1) + 20);
    expect(r.timing.drift).not.toBeNull();
    expect(r.timing.drift.from).toBeGreaterThan(r.timing.drift.to);
    // A smooth ritardando is not uneven timing.
    expect(r.timing.score).toBeGreaterThanOrEqual(90);
    expect(r.remarks.join(' ')).toMatch(/settled back/);
  });

  it('measures uneven timing as a lower timing score', () => {
    const s = song();
    const jitter = e => (e.hand === 'r' ? [0, 70, -60, 40][e.t % 4] : 0);
    const r = buildReport({song: s, take: take(perform(s, 600, (e, row) => row, jitter))});
    expect(r.timing.sdMs).toBeGreaterThan(20);
    expect(r.timing.score).toBeLessThan(90);
    expect(r.summary.accuracy).toBe(100);
  });

  it('compares one hand only when the take was of one hand', () => {
    const s = song();
    const notes = perform(s, 600, (e, row) => (e.hand === 'r' ? row : null));
    const r = buildReport({song: s, take: take(notes, {hands: 'right'})});
    expect(r.summary).toMatchObject({expected: 16, right: 16, accuracy: 100});
    expect(expectedNotes(s, {hands: 'left', section: [0, 0]}).notes).toHaveLength(2);
  });

  it('uses the whole piece when the take has no valid section', () => {
    const s = song();
    const r = buildReport({song: s, take: take(perform(s), {section: [2, 9]})});
    expect(r.section).toEqual([0, 3]);
  });

  it('prints as text for the teacher, bar by bar', () => {
    const s = song();
    const t = take(perform(s, 600, (e, row) => (e.id === 'r5' ? null : row)));
    t.report = buildReport({song: s, take: t});
    const text = reportText(t);
    expect(text).toMatch(/Take abcdefgh12: Test piece \[test-piece\]/);
    expect(text).toMatch(/Notes: 96% accuracy · 23 of 24 right · 1 missed/);
    expect(text).toMatch(/Bar 2 \(\d+%\): F4 missed/);
    expect(text).toMatch(/Timing: ♩ ≈ 100/);
    expect(reportText({...t, report: null})).toMatch(/Not compared with the score yet/);
    expect(takeLine(takeMeta(t))).toMatch(/^abcdefgh12 · 2026-11-24 09:00 · Test piece \[test-piece\].*accuracy 96%/);
    const c = compactSummary(t);
    expect(c).toMatchObject({takeId: 'abcdefgh12', songId: 'test-piece', accuracy: 96, meanBpm: 100});
    expect(JSON.stringify(c).length).toBeLessThan(2000);
    expect(sendText(t)).toMatch(/Take abcdefgh12\.$/);
  });
});

describe('Recorder', () => {
  it('records note on/off with velocity, the pedal, and times from the start', () => {
    const r = new Recorder();
    r.start(1000);
    r.noteOn(60, 90, 1500, 'midi');
    r.pedal(127, 1550);
    r.pedal(100, 1560); // still down: ignored
    r.noteOn(64, 70.4, 1600, 'midi');
    r.noteOff(60, 1900);
    r.noteOn(64, 80, 2000, 'midi'); // re-struck without release
    r.pedal(0, 2100);
    const out = r.stop(2500);
    expect(out.notes).toEqual([[500, 60, 90, 400], [600, 64, 70, 400], [1000, 64, 80, 500]]);
    expect(out.pedal).toEqual([[550, 127], [1100, 0]]);
    expect(out.durationMs).toBe(1500);
    expect(out.source).toBe('midi');
    expect(trimLead(out).source).toBe('midi');
  });

  it('trims the silence before the first note', () => {
    const t = trimLead({notes: [[2000, 60, 80, 100]], pedal: [[100, 127], [2500, 0]], durationMs: 3000}, 300);
    expect(t.notes).toEqual([[300, 60, 80, 100]]);
    expect(t.pedal).toEqual([[0, 127], [800, 0]]);
    expect(t.durationMs).toBe(1300);
  });
});

describe('exam marks', () => {
  const report = (accuracy, timing, even = null) => ({summary: {accuracy, right: 10}, timing: {score: timing, meanBpm: 90}, evenness: even == null ? null : {score: even}, bars: []});
  it('maps quality to marks and bands', () => {
    expect(quality(report(100, 100))).toBe(100);
    expect(itemMark(report(100, 100), 30)).toBe(30);
    expect(itemMark(report(90, 80), 30)).toBe(24); // q = 86 → 0.792 × 30 = 23.8: Merit
    expect(itemMark(report(97, 100), 30)).toBe(28); // two slips in sixty notes: q = 98 → 0.933
    expect(markFraction(65)).toBeCloseTo(2 / 3);
    expect(markFraction(0)).toBe(.3);
    expect(bandOf(27, 30)).toBe('Distinction');
    expect(bandOf(26, 30)).toBe('Merit');
    expect(bandOf(24, 30)).toBe('Merit');
    expect(bandOf(20, 30)).toBe('Pass');
    expect(bandOf(19, 30)).toBe('Below pass');
    expect(bandOf(14, 21)).toBe('Pass');
    expect(itemMark(null, 30)).toBe(0);
  });
  it('builds a results sheet with a total and an overall band', () => {
    const sheet = examResults([
      {kind: 'piece', title: 'A', takeId: 'aaaaaaaa11', report: report(98, 90)},
      {kind: 'piece', title: 'B', takeId: 'bbbbbbbb11', report: report(80, 70)},
      {kind: 'scale', title: 'C major', takeId: 'cccccccc11', report: report(100, 85, 82)},
    ]);
    expect(sheet.max).toBe(81);
    expect(sheet.items.map(i => i.max)).toEqual([30, 30, 21]);
    expect(sheet.total).toBe(sheet.items.reduce((a, i) => a + i.mark, 0));
    expect(['Distinction', 'Merit', 'Pass', 'Below pass']).toContain(sheet.band);
    expect(sheet.items[0].comment).toMatch(/secure/);
    expect(sheet.items[2].comment).toMatch(/Even in touch/);
    expect(examText({id: 'xxxxxxxx11', at: Date.UTC(2026, 0, 2), ...sheet})).toMatch(/Mock exam xxxxxxxx11 · 2026-01-02 00:00 · \d+\/81/);
  });
});
