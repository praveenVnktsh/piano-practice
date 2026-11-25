import {describe, expect, test} from 'vitest';
import {
  barStats, barStatsFrom, dueReviews, evaluatePasses, goalProgress, pieceMastery, plateaus, repertoire,
  REVIEW_INTERVALS, reviewSchedule, sectionMastery, setMasteryDoc, troubleSpots,
} from '../src/progress/mastery.js';

const DAY = 864e5;
const T0 = Date.UTC(2026, 0, 5, 12); // a Monday, noon UTC
let n = 0;
const pass = (over = {}) => ({type: 'practice:result', id: 'r' + String(++n).padStart(6, '0'), songId: 'fur-elise', title: 'Für Elise',
  section: [0, 7], mode: 'wait', hands: 'both', tempo: 72, right: 50, wrong: 0, accuracy: 100, timing: null, durationMs: 60000, at: T0, tz: 0, ...over});
const docOf = events => ({events, totals: {songs: {}, days: {}, trainer: {}}, settings: {}});

describe('evaluatePasses (status of one bar range)', () => {
  test('learning until two of the last five passes are ≥ 90 % at ≥ 75 % of target', () => {
    const slow = pass({accuracy: 98, tempo: 50}); // 50 < 0.75 × 72 = 54
    expect(evaluatePasses([pass({accuracy: 80})], {target: 72}).status).toBe('learning');
    expect(evaluatePasses([pass({accuracy: 95, tempo: 60}), slow], {target: 72}).status).toBe('learning');
    const r = evaluatePasses([pass({accuracy: 95, tempo: 60}), pass({accuracy: 91, tempo: 56, at: T0 + 1000})], {target: 72});
    expect(r).toMatchObject({status: 'secure', securedAt: T0 + 1000});
  });
  test('one-hand passes do not count; no passes → null', () => {
    expect(evaluatePasses([pass({hands: 'right'}), pass({hands: 'left'})], {target: 72}).status).toBe('learning');
    expect(evaluatePasses([]).status).toBe(null);
  });
  test('the two good passes must fall in a window of five', () => {
    const ps = [pass(), ...Array.from({length: 5}, () => pass({accuracy: 70})), pass()];
    expect(evaluatePasses(ps, {target: 72}).status).toBe('learning');
  });
  test('polished needs 3 timed passes ≥ 95 % at target tempo on 2+ days', () => {
    const base = [pass(), pass()];
    const timed = (d, over = {}) => pass({mode: 'timed', accuracy: 96, at: T0 + d * DAY, ...over});
    expect(evaluatePasses([...base, timed(0), timed(0), timed(0)], {target: 72}).status).toBe('secure'); // one day only
    expect(evaluatePasses([...base, timed(0), timed(0), timed(1, {tempo: 60})], {target: 72}).status).toBe('secure'); // too slow
    expect(evaluatePasses([...base, timed(0), timed(0), timed(1, {mode: 'wait'})], {target: 72}).status).toBe('secure'); // wait mode
    expect(evaluatePasses([...base, timed(0), timed(0), timed(1)], {target: 72})).toMatchObject({status: 'polished', polishedAt: T0 + DAY});
  });
  test('without a target the tempo conditions are skipped', () => {
    expect(evaluatePasses([pass({tempo: 30}), pass({tempo: 30})]).status).toBe('secure');
  });
});

describe('pieceMastery', () => {
  test('the weakest bar decides; measureCount from the results sets the bars judged', () => {
    const doc = docOf([pass({section: [0, 3], measureCount: 8}), pass({section: [0, 3], measureCount: 8})]);
    const m = pieceMastery(doc, 'fur-elise', {target: 72, now: T0});
    expect(m).toMatchObject({status: 'learning', measureCount: 8, coverage: 0.5, attempts: 2, best: 100, bestCleanTempo: 72});
    expect(m.weakest).toEqual([4, 5, 6, 7]);
    doc.events.push(pass({section: [4, 7]}), pass({section: [4, 7]}));
    expect(pieceMastery(doc, 'fur-elise', {target: 72, now: T0})).toMatchObject({status: 'secure', coverage: 1});
  });
  test('without measureCount, every bar practised is judged', () => {
    const doc = docOf([pass({section: [0, 3]}), pass({section: [0, 3]}), pass({section: [4, 5], accuracy: 60})]);
    expect(pieceMastery(doc, 'fur-elise', {target: 72}).status).toBe('learning');
  });
  test('listened only → learning; untouched → null', () => {
    const doc = docOf([]);
    doc.totals.songs['ode-to-joy'] = {title: 'Ode', ms: 60000, attempts: 0};
    expect(pieceMastery(doc, 'ode-to-joy').status).toBe('learning');
    expect(pieceMastery(doc, 'nothing').status).toBe(null);
  });
});

describe('spaced repetition', () => {
  const polishedDoc = () => {
    const t = d => pass({mode: 'timed', accuracy: 97, at: T0 + d * DAY});
    return docOf([pass(), pass(), t(0), t(0), t(1)]); // polished at T0 + 1 day
  };
  test('intervals grow 1, 3, 7… after good reviews; a weak review starts again', () => {
    expect(REVIEW_INTERVALS.slice(0, 5)).toEqual([1, 3, 7, 14, 30]);
    const polishedAt = T0 + DAY;
    const s0 = reviewSchedule(polishedAt, [], {tz: 0});
    expect(s0).toMatchObject({due: '2026-01-07', reviews: 0});
    const r = d => pass({at: T0 + d * DAY, accuracy: 93});
    expect(reviewSchedule(polishedAt, [r(1.4)], {tz: 0}).due).toBe('2026-01-07'); // too early: ignored
    expect(reviewSchedule(polishedAt, [r(2)], {tz: 0})).toMatchObject({due: '2026-01-10', reviews: 1, step: 1});
    expect(reviewSchedule(polishedAt, [r(2), r(5)], {tz: 0})).toMatchObject({due: '2026-01-17', reviews: 2});
    expect(reviewSchedule(polishedAt, [r(2), pass({at: T0 + 5 * DAY, accuracy: 70})], {tz: 0})).toMatchObject({due: '2026-01-11', lapses: 1, step: 0});
  });
  test('polished → due for review → maintained after a review → due again', () => {
    const doc = polishedDoc();
    expect(pieceMastery(doc, 'fur-elise', {target: 72, now: T0 + DAY}).status).toBe('polished');
    expect(dueReviews(doc, {targets: {'fur-elise': 72}, now: T0 + DAY})).toEqual([]);
    expect(dueReviews(doc, {targets: {'fur-elise': 72}, now: T0 + 2 * DAY}).map(m => m.songId)).toEqual(['fur-elise']);
    doc.events.push(pass({at: T0 + 2 * DAY, accuracy: 94}));
    expect(pieceMastery(doc, 'fur-elise', {target: 72, now: T0 + 2 * DAY}).status).toBe('maintained');
    expect(pieceMastery(doc, 'fur-elise', {target: 72, now: T0 + 6 * DAY})).toMatchObject({status: 'polished', review: {isDue: true, overdueDays: 1}});
  });
  test('repertoire leaves exercises out', () => {
    const doc = polishedDoc();
    doc.events.push(pass({songId: 'ex:scale:C:major:both:2:up-down'}));
    expect(repertoire(doc, {now: T0}).map(m => m.songId)).toEqual(['fur-elise']);
  });
});

describe('bar stats (trouble spots)', () => {
  const doc = docOf([
    pass({section: [0, 3], misses: [{measure: '2', expected: ['E5'], played: ['F5']}]}),
    pass({section: [0, 3], misses: [{measure: '2', expected: ['E5'], played: []}, {measure: '3', expected: ['A4'], played: []}]}),
    pass({section: [2, 5], misses: []}),
    pass({section: [0, 1], accuracy: 80}), // no misses recorded: counts as an attempt only
  ]);
  test('accuracy per bar from misses vs passes covering it (guessed labels)', () => {
    expect(barStatsFrom(doc, 'fur-elise')).toEqual([
      {label: '1', index: 0, accuracy: 100, attempts: 3},
      {label: '2', index: 1, accuracy: 0, attempts: 3},
      {label: '3', index: 2, accuracy: 67, attempts: 3},
      {label: '4', index: 3, accuracy: 100, attempts: 3},
      {label: '5', index: 4, accuracy: 100, attempts: 1},
      {label: '6', index: 5, accuracy: 100, attempts: 1},
    ]);
    expect(troubleSpots(doc, 'fur-elise', {n: 2}).map(b => b.label)).toEqual(['2', '3']);
  });
  test('with the song’s measures, labels follow the score (pickup = index 0)', () => {
    const measures = [{label: 'Pickup', index: 0, pickup: true}, {label: '1', index: 1}, {label: '2', index: 2}, {label: '3', index: 3}];
    const rows = barStatsFrom(doc, 'fur-elise', {measures});
    expect(rows.find(r => r.index === 2)).toMatchObject({label: '2', accuracy: 33});
    expect(rows.find(r => r.index === 0)).toMatchObject({label: 'Pickup', accuracy: 100});
  });
  test('a miss labelled "Pickup" shifts the guessed labels (index i = bar i)', () => {
    const d = docOf([pass({section: [0, 2], misses: [{measure: 'Pickup', expected: ['E5'], played: []}, {measure: '2', expected: ['A4'], played: []}]})]);
    expect(barStatsFrom(d, 'fur-elise')).toEqual([
      {label: 'Pickup', index: 0, accuracy: 0, attempts: 1},
      {label: '1', index: 1, accuracy: 100, attempts: 1},
      {label: '2', index: 2, accuracy: 0, attempts: 1},
    ]);
  });
  test('barStats(songId) reads the cached document', () => {
    setMasteryDoc(null);
    expect(barStats('fur-elise')).toEqual([]);
    setMasteryDoc(doc);
    expect(barStats('fur-elise')).toHaveLength(6);
    expect(barStats('other')).toEqual([]);
    setMasteryDoc(null);
  });
});

describe('sections, plateaus and goals', () => {
  test('sectionMastery groups by exact range', () => {
    const doc = docOf([pass({section: [0, 3]}), pass({section: [0, 3], at: T0 + 1}), pass({section: [4, 7], accuracy: 50, at: T0 + 2})]);
    expect(sectionMastery(doc, 'fur-elise', {target: 72})).toEqual([
      expect.objectContaining({section: [4, 7], status: 'learning', attempts: 1}),
      expect.objectContaining({section: [0, 3], status: 'secure', attempts: 2}),
    ]);
  });
  test('a section stuck below target for 3 days is a plateau; improvement is not', () => {
    const now = T0 + 4 * DAY;
    const stuck = docOf([0, 1, 2, 3].map(d => pass({section: [8, 11], accuracy: 78 + (d % 2), at: T0 + d * DAY})));
    expect(plateaus(stuck, {now, targets: {'fur-elise': 72}})).toEqual([expect.objectContaining({songId: 'fur-elise', section: [8, 11], days: 4, firstBest: 78, lastBest: 79})]);
    const better = docOf([0, 1, 2].map(d => pass({section: [8, 11], accuracy: 70 + d * 8, at: T0 + d * DAY})));
    expect(plateaus(better, {now})).toEqual([]);
    const twoDays = docOf([0, 1].map(d => pass({section: [8, 11], accuracy: 70, at: T0 + d * DAY})));
    expect(plateaus(twoDays, {now})).toEqual([]);
  });
  test('goal progress from the fastest clean pass', () => {
    const doc = docOf([pass({tempo: 60, accuracy: 92}), pass({tempo: 70, accuracy: 80})]);
    const goal = {songId: 'fur-elise', bpm: 72, accuracy: 90, by: '2026-03-01'};
    expect(goalProgress(goal, doc, {now: T0})).toMatchObject({bestTempo: 60, met: false, overdue: false});
    expect(goalProgress(goal, doc, {now: T0}).fraction).toBeCloseTo(60 / 72);
    expect(goalProgress(goal, doc, {now: Date.UTC(2026, 2, 3)})).toMatchObject({overdue: true});
    doc.events.push(pass({tempo: 74, accuracy: 95}));
    expect(goalProgress(goal, doc, {now: T0})).toMatchObject({met: true, fraction: 1});
  });
});
