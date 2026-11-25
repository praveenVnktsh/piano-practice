import {describe, it, expect} from 'vitest';
import {
  correlation, melodyLine, shapeModel, phraseShape, onsetsOf, tempoFlex, voicingReport, playerMusicality,
  compactMusicality, clipPhrases, musicalityLines,
} from '../src/analysis/musicality.mjs';

// n bars of 4/4 (or another meter): measure i spans [len·i, len·(i+1)).
const bars = (n, meter = {count: 4, unit: 4}) => {
  const len = 4 * meter.count / meter.unit;
  return Array.from({length: n}, (_, i) => ({index: i, start: len * i, end: len * (i + 1), label: String(i + 1), meter}));
};
// A seeded random so the noisy cases are repeatable.
const rng = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = r => () => { let s = 0; for (let k = 0; k < 6; k++) s += r(); return s - 3; };

// A four-bar phrase in quarter notes, melody rising to bar 3 beat 1 (the highest note) and falling.
const PITCHES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 72, 71, 69, 67, 65, 64, 60];
const phraseNotes = (velocity, {offset = 0, first = 0} = {}) => PITCHES.map((n, i) => ({
  n, t: offset + i, d: 1, hand: 'r', staff: 1, measure: first + Math.floor(i / 4), at: 1000 + (offset + i) * 500, velocity: velocity(i),
}));
const PEAK = PITCHES.indexOf(74); // 8: bar 3, beat 1

describe('correlation', () => {
  it('is 1 for proportional series, −1 for opposite ones and 0 when flat', () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(correlation([5, 5, 5], [1, 2, 3])).toBe(0);
    expect(correlation([1], [1])).toBe(0);
  });
});

describe('melodyLine', () => {
  it('keeps the top right-hand note at each score time', () => {
    const line = melodyLine([
      {n: 60, t: 0, hand: 'r', velocity: 50}, {n: 67, t: 0, hand: 'r', velocity: 60}, {n: 48, t: 0, hand: 'l', velocity: 70},
      {n: 64, t: 1, hand: 'r', velocity: 55}, {n: 72, t: 1, hand: 'l', velocity: 40},
    ]);
    expect(line.map(p => p.n)).toEqual([67, 64]);
  });
  it('uses every hand when there is no right hand, and skips notes without velocity', () => {
    expect(melodyLine([{n: 48, t: 0, hand: 'l', velocity: 50}, {n: 50, t: 1, hand: 'l', velocity: NaN}]).map(p => p.n)).toEqual([48]);
  });
});

describe('shapeModel', () => {
  const line = PITCHES.map((n, i) => ({n, t: i, d: 1}));
  it('rises to the highest note and tapers below the start at the cadence', () => {
    const {model, peak} = shapeModel(line);
    expect(peak).toBe(PEAK);
    expect(Math.max(...model)).toBe(model[PEAK]);
    expect(model[0]).toBe(0);
    expect(model.at(-1)).toBeLessThan(model[0]);
    for (let i = 1; i <= PEAK; i++) expect(model[i]).toBeGreaterThan(model[i - 1]);
  });
  it('chooses the longest of equal highest notes', () => {
    const l = [{n: 60, t: 0, d: 1}, {n: 70, t: 1, d: 1}, {n: 65, t: 2, d: 1}, {n: 70, t: 3, d: 2}, {n: 60, t: 5, d: 1}];
    expect(shapeModel(l).peak).toBe(3);
  });
  it('follows the written dynamics', () => {
    const marks = [{t: 0, mark: 'p'}, {t: 8, mark: 'f'}];
    const {model} = shapeModel(line, {marks});
    expect(model[9] - model[7]).toBeGreaterThan(30); // the step from p to f outweighs the arch
  });
  it('lets a hairpin outweigh the arch', () => {
    const {model} = shapeModel(line, {hairpins: [{t: 0, end: 15, form: 'dim'}]});
    expect(model.at(-1)).toBeLessThan(model[0] - 10);
    expect(model[PEAK]).toBeLessThan(model[0]); // the arch alone would make the peak the loudest
  });
  it('is empty for no notes', () => expect(shapeModel([])).toEqual({model: [], peak: -1}));
});

describe('phraseShape', () => {
  const measures = bars(8);
  const phrases = [{first: 0, last: 3}];
  const arch = i => (i <= PEAK ? 55 + 2.5 * i : 75 - 3.5 * (i - PEAK));
  it('scores a shaped phrase highly and says so quietly', () => {
    const s = phraseShape(phraseNotes(arch), {phrases, measures});
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.phrases).toHaveLength(1);
    expect(s.phrases[0]).toMatchObject({first: 0, last: 3, bars: 'bars 1–4', peak: {t: PEAK, measure: 2}});
    expect(s.phrases[0].points).toHaveLength(16);
    expect(s.hint).toBe('The phrases rise and fall.');
  });
  it('asks a flat phrase to arrive at its peak', () => {
    const s = phraseShape(phraseNotes(() => 64), {phrases, measures});
    expect(s.score).toBeLessThan(50);
    expect(s.hint).toBe('Let bar 3 arrive — the line peaks there.');
  });
  it('asks for a taper when the line grows to the peak but not down again', () => {
    const s = phraseShape(phraseNotes(i => (i <= PEAK ? 50 + 3 * i : 74 + (i - PEAK))), {phrases, measures});
    expect(s.score).toBeLessThan(75);
    expect(s.hint).toBe('Taper the cadence in bar 4.');
  });
  it('scores an inverted shape lower than a flat one', () => {
    const inverted = phraseShape(phraseNotes(i => 130 - arch(i)), {phrases, measures});
    const flat = phraseShape(phraseNotes(() => 64), {phrases, measures});
    expect(inverted.score).toBeLessThan(flat.score);
  });
  it('gives at most one hint for several phrases, from the one that missed most', () => {
    const notes = [...phraseNotes(arch), ...phraseNotes(() => 64, {offset: 16, first: 4})];
    const s = phraseShape(notes, {phrases: [{first: 0, last: 3}, {first: 4, last: 7}], measures});
    expect(s.phrases).toHaveLength(2);
    expect(s.phrases[0].score).toBeGreaterThan(s.phrases[1].score);
    expect(s.hint).toBe('Let bar 7 arrive — the line peaks there.');
    expect(s.score).toBe(Math.round((s.phrases[0].score + s.phrases[1].score) / 2));
  });
  it('respects a written diminuendo: tapering through it is right', () => {
    const marks = {hairpins: [{t: 0, end: 15, form: 'dim'}]};
    const falling = phraseShape(phraseNotes(i => 80 - 2 * i), {phrases, measures, marks});
    const arched = phraseShape(phraseNotes(arch), {phrases, measures, marks});
    expect(falling.score).toBeGreaterThan(arched.score);
  });
  it('needs enough melody notes and phrases', () => {
    expect(phraseShape(phraseNotes(arch).slice(0, 3), {phrases, measures})).toBeNull();
    expect(phraseShape(phraseNotes(arch), {phrases: [], measures})).toBeNull();
    expect(phraseShape(phraseNotes(arch), {phrases: [{first: 6, last: 7}], measures})).toBeNull();
  });
  it('never exclaims', () => {
    for (const v of [arch, () => 64, i => 100 - i]) expect(phraseShape(phraseNotes(v), {phrases, measures}).hint).not.toMatch(/!/);
  });
});

describe('tempoFlex', () => {
  const measures = bars(16);
  // One onset per beat; `bpmAt(beat)` sets the local tempo, `noise` adds onset scatter (ms).
  const play = (bpmAt, {beats = 64, noise = 0, seed = 3} = {}) => {
    const g = gauss(rng(seed));
    const out = [];
    let at = 0;
    for (let b = 0; b <= beats; b++) { out.push({t: b, at: at + noise * g()}); at += 60000 / bpmAt(b); }
    return out;
  };
  it('calls a metronomic run steady, at its tempo', () => {
    const f = tempoFlex(play(() => 90), {measures});
    expect(f.label).toBe('steady');
    expect(f.meanBpm).toBe(90);
    expect(f.flexPct).toBeLessThan(.5);
    expect(f.jitterPct).toBeLessThan(.5);
    expect(Math.abs(f.driftPct)).toBeLessThan(.5);
    expect(f.remark).toBe('A steady pulse.');
    expect(f.curve).toHaveLength(64);
    expect(f.curve[0]).toEqual([0, 90, 90]);
  });
  it('separates a steady drift from flex', () => {
    const f = tempoFlex(play(b => 80 + b * .25), {measures});
    expect(f.label).toBe('steady');
    expect(f.driftPct).toBeGreaterThan(15);
    expect(f.flexPct).toBeLessThan(1.5);
    expect(f.remark).toBe('A steady pulse, though it pressed on gradually.');
  });
  it('calls phrase-length give and take expressive', () => {
    const f = tempoFlex(play(b => 80 * (1 + .1 * Math.sin(2 * Math.PI * b / 16)), {noise: 4}), {measures});
    expect(f.label).toBe('expressive');
    expect(f.flexPct).toBeGreaterThan(3.5);
    expect(f.jitterPct).toBeLessThan(9);
    expect(f.remark).toBe('The tempo breathes with the phrases.');
  });
  it('calls beat-to-beat scatter unsteady and names where', () => {
    const onsets = play(() => 90, {noise: 4});
    for (const o of onsets) if (o.t >= 20 && o.t < 24) o.at += o.t % 2 ? 140 : -140; // bar 6 lurches
    const f = tempoFlex(onsets, {measures});
    expect(f.label).toBe('unsteady');
    expect(f.jitterPct).toBeGreaterThan(9);
    expect(f.remark).toMatch(/^The pulse wavers around bar [567]; feel the beat underneath\.$/);
  });
  it('keeps small human scatter steady', () => {
    expect(tempoFlex(play(() => 100, {noise: 6}), {measures}).label).toBe('steady');
  });
  it('works in 3/4 and over a section', () => {
    const m3 = bars(12, {count: 3, unit: 4});
    const onsets = play(() => 72, {beats: 24}).map(o => ({...o, t: o.t + 6})); // bars 3–10
    const f = tempoFlex(onsets, {measures: m3, first: 2, last: 9});
    expect(f.label).toBe('steady');
    expect(f.meanBpm).toBe(72);
    expect(f.curve[0][0]).toBe(6);
  });
  it('ignores reversed onsets and needs enough beats', () => {
    const onsets = play(() => 90, {beats: 20});
    onsets.splice(5, 0, {t: 5.5, at: 100}); // crossed: earlier in time than its neighbours
    expect(tempoFlex(onsets, {measures}).label).toBe('steady');
    expect(tempoFlex(play(() => 90, {beats: 6}), {measures})).toBeNull();
    expect(tempoFlex([], {measures})).toBeNull();
  });
  it('builds one onset per score time from a chord', () => {
    expect(onsetsOf([{t: 0, at: 10}, {t: 0, at: 20}, {t: 0, at: 30}, {t: 1, at: 500}, {t: 2, at: NaN}])).toEqual([{t: 0, at: 20}, {t: 1, at: 500}]);
  });
});

describe('voicingReport', () => {
  const measures = bars(8);
  // Right-hand chords, one per beat: top voice `top(i)`, two inner voices at `inner(i)`.
  const chords = (top, inner, count = 16) => Array.from({length: count}, (_, i) => [
    {n: 72, t: i, hand: 'r', measure: Math.floor(i / 4), velocity: top(i)},
    {n: 67, t: i, hand: 'r', measure: Math.floor(i / 4), velocity: inner(i)},
    {n: 64, t: i, hand: 'r', measure: Math.floor(i / 4), velocity: inner(i)},
    {n: 48, t: i, hand: 'l', measure: Math.floor(i / 4), velocity: 90}, // the left hand is not judged
  ]).flat();
  it('hears the melody come through', () => {
    const v = voicingReport(chords(() => 78, () => 62), {measures});
    expect(v).toMatchObject({melody: 'through', chords: 16, meanDiff: 16, score: 100, covered: []});
    expect(v.remark).toBe('The melody comes through.');
  });
  it('names the bars where the melody is covered', () => {
    const v = voicingReport(chords(i => (i >= 4 && i < 12 ? 58 : 75), () => 66), {measures});
    expect(v.melody).toBe('covered');
    expect(v.covered).toEqual([{first: 1, last: 2, bars: 'bars 2–3'}]);
    expect(v.remark).toBe('The melody is covered in bars 2–3; let the top voice sing.');
  });
  it('lists at most two covered runs', () => {
    const v = voicingReport(chords(i => ([0, 2, 3].includes(Math.floor(i / 4)) ? 55 : 75), () => 66), {measures});
    expect(v.covered.map(r => r.bars)).toEqual(['bar 1', 'bars 3–4']);
    expect(v.remark).toBe('The melody is covered in bar 1 and bars 3–4; let the top voice sing.');
  });
  it('calls equal voices level', () => {
    const v = voicingReport(chords(() => 66, () => 66), {measures});
    expect(v).toMatchObject({melody: 'level', score: 50});
  });
  it('can judge the left hand, and needs chords', () => {
    expect(voicingReport(chords(() => 78, () => 62), {measures, hand: 'l'})).toBeNull(); // single notes only
    expect(voicingReport(chords(() => 78, () => 62, 2), {measures})).toBeNull();
  });
});

describe('playerMusicality and compactMusicality', () => {
  const measures = bars(8);
  const events = PITCHES.map((n, i) => ({id: `e${i}`, n, t: i, d: i === 15 ? 2 : 1, hand: 'r', staff: 1}));
  const song = {measures, events, marks: {}};
  const arch = i => (i <= PEAK ? 55 + 2.5 * i : 75 - 3.5 * (i - PEAK));
  const played = phraseNotes(arch).map((p, i) => ({...p, id: `e${i}`, source: 'midi'}));
  it('shapes pieces with a real keyboard and adds the flex in a performance run', () => {
    const m = playerMusicality({played, song, phrases: [{first: 0, last: 3}], section: [0, 3], songId: 'fur-elise', perf: true});
    expect(m.shape.score).toBeGreaterThan(85);
    expect(m.flex.label).toBe('steady');
    expect(m.voicing).toBeNull();
    const c = compactMusicality(m);
    expect(c.shape).toEqual({score: m.shape.score, hint: m.shape.hint, phrases: [{bars: 'bars 1–4', score: m.shape.phrases[0].score}]});
    expect(c.flex.curve).toBeUndefined();
    expect(c.flex.label).toBe('steady');
    expect(JSON.stringify(c)).not.toMatch(/points/);
  });
  it('skips velocity measures for screen taps and exercises', () => {
    const taps = played.map(p => ({...p, source: 'screen'}));
    expect(playerMusicality({played: taps, song, section: [0, 3], songId: 'x'})).toBeNull();
    expect(playerMusicality({played: taps, song, section: [0, 3], songId: 'x', perf: true}).flex.label).toBe('steady');
    expect(playerMusicality({played, song, section: [0, 3], songId: 'ex:scale-c'})).toBeNull();
  });
  it('detects the phrases itself when none are given', () => {
    expect(playerMusicality({played, song, songId: 'x'}).shape.phrases.length).toBeGreaterThan(0);
  });
  it('clips phrases to the section', () => {
    expect(clipPhrases([{first: 0, last: 3}, {first: 4, last: 7}, {first: 8, last: 9}], 2, 5)).toEqual([{first: 2, last: 3}, {first: 4, last: 5}]);
  });
  it('prints one line per measure for the teacher', () => {
    const lines = musicalityLines(compactMusicality(playerMusicality({played, song, phrases: [{first: 0, last: 3}], section: [0, 3], songId: 'x', perf: true})));
    expect(lines[0]).toMatch(/^Phrasing: \d+\/100 \(bars 1–4 \d+\)/);
    expect(lines[1]).toMatch(/^Tempo feel: steady · ♩ ≈ 120/);
    expect(musicalityLines(null)).toEqual([]);
    expect(compactMusicality(null)).toBeNull();
  });
});
