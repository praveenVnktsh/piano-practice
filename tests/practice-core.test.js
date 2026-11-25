import {describe, expect, test} from 'vitest';

import {
  BarTally, applyTiming, articulationReport, barsText, blockChords, chainStep, clampLatency, detectPhrases, dynamicLevel, dynamicsReport,
  evenness, evennessRemark, fitLine, heatLevel, ladderNext, ladderRungs, markAt, measureLatency, mergeBarStats, nextPhrase, nextTempoStep,
  normaliseBarStats, pageAtTime, pageOf, paginate, pedalReport, phraseAt, recordBest, rhythmVariation, startChain, velocityName, weakPassage,
} from '../src/practice-core.mjs';
import {passage} from '../src/score-core.mjs';

const bars = (n, len = 4, meter = {count: 4, unit: 4}) =>
  Array.from({length: n}, (_, i) => ({id: 'm' + i, label: String(i + 1), index: i, start: i * len, end: (i + 1) * len, meter}));
let uid = 0;
const ev = (n, t, d = 1, hand = 'r', extra = {}) => ({id: 'e' + uid++, n, t, d, hand, staff: hand === 'l' ? 2 : 1, ...extra});

describe('trouble spots', () => {
  test('BarTally counts right and wrong per bar', () => {
    const t = new BarTally();
    t.add(0, true); t.add(0, true); t.add(0, false); t.add(2, false); t.add(-1, true);
    expect(t.list()).toEqual([{index: 0, accuracy: 67, attempts: 3}, {index: 2, accuracy: 0, attempts: 1}]);
  });

  test('normaliseBarStats accepts percent or fractions and resolves labels', () => {
    const measures = bars(4);
    expect([...normaliseBarStats([{index: 1, label: '2', accuracy: 80, attempts: 3}], measures)]).toEqual([[1, {accuracy: 80, attempts: 3}]]);
    expect(normaliseBarStats([{index: 0, accuracy: .5}, {index: 1, accuracy: 1}], measures).get(0).accuracy).toBe(50);
    expect(normaliseBarStats([{label: '3', accuracy: 70}], measures).get(2).accuracy).toBe(70);
    expect(normaliseBarStats(null).size).toBe(0);
    expect(normaliseBarStats([{index: 0, accuracy: null, attempts: 2}], measures).size).toBe(0);
    expect(normaliseBarStats([{index: 9, accuracy: 50}], measures).size).toBe(0);
  });

  test('mergeBarStats prefers long-term numbers', () => {
    const merged = mergeBarStats(new Map([[1, {accuracy: 50, attempts: 4}]]), new Map([[1, {accuracy: 90, attempts: 1}], [2, {accuracy: 70, attempts: 1}]]));
    expect(merged.get(1).accuracy).toBe(50);
    expect(merged.get(2).accuracy).toBe(70);
  });

  test('heatLevel', () => {
    expect([heatLevel(100), heatLevel(85), heatLevel(40)]).toEqual(['good', 'fair', 'weak']);
  });

  test('weakPassage loops the worst bar with neighbours', () => {
    const stats = new Map([[0, {accuracy: 100, attempts: 2}], [4, {accuracy: 60, attempts: 2}], [9, {accuracy: 85, attempts: 2}]]);
    expect(weakPassage(stats, 12)).toEqual({first: 3, last: 5, worst: 4});
    expect(weakPassage(new Map([[0, {accuracy: 50, attempts: 1}]]), 3)).toEqual({first: 0, last: 1, worst: 0});
    expect(weakPassage(new Map([[2, {accuracy: 99, attempts: 1}]]), 3)).toBeNull();
  });

  test('weakPassage takes in a nearby weak bar', () => {
    const stats = new Map([[4, {accuracy: 50, attempts: 1}], [6, {accuracy: 70, attempts: 1}]]);
    expect(weakPassage(stats, 12)).toEqual({first: 3, last: 6, worst: 4});
  });
});

describe('chaining', () => {
  test('forward chaining adds a bar after each clean pass', () => {
    let c = startChain(2, 4, 'forward');
    expect(c).toMatchObject({first: 2, last: 2});
    let r = chainStep(c, 80);
    expect(r).toMatchObject({grew: false, done: false});
    r = chainStep(c, 100); c = r.chain;
    expect(r.grew).toBe(true); expect(c).toMatchObject({first: 2, last: 3});
    c = chainStep(c, 96).chain;
    expect(c).toMatchObject({first: 2, last: 4});
    expect(chainStep(c, 100)).toMatchObject({grew: false, done: true});
  });

  test('backward chaining starts from the end', () => {
    let c = startChain(0, 2, 'backward');
    expect(c).toMatchObject({first: 2, last: 2, dir: 'backward'});
    c = chainStep(c, 100).chain;
    expect(c).toMatchObject({first: 1, last: 2});
    c = chainStep(c, 100).chain;
    expect(c).toMatchObject({first: 0, last: 2});
    expect(chainStep(c, 100).done).toBe(true);
  });
});

describe('phrases', () => {
  test('rests and long notes end phrases', () => {
    const measures = bars(8);
    const events = [];
    // Two 4-bar phrases: crotchets, each ending on a held note then a rest.
    for (let b = 0; b < 8; b++) {
      if (b === 3 || b === 7) { events.push(ev(60, b * 4, 3)); continue; }
      for (let k = 0; k < 4; k++) events.push(ev(60 + k, b * 4 + k, 1));
    }
    expect(detectPhrases({measures, events})).toEqual([{first: 0, last: 3}, {first: 4, last: 7}]);
  });

  test('no clear ends: four-bar chunks; a short tail joins the last phrase', () => {
    const measures = bars(10);
    const events = [];
    for (let t = 0; t < 40; t++) events.push(ev(60 + (t % 5), t, 1));
    expect(detectPhrases({measures, events})).toEqual([{first: 0, last: 3}, {first: 4, last: 7}, {first: 8, last: 9}]);
    expect(detectPhrases({measures: bars(9), events: events.filter(e => e.t < 36)}).at(-1)).toEqual({first: 4, last: 8});
  });

  test('a long slur end marks a phrase end', () => {
    const measures = bars(8), events = [];
    for (let t = 0; t < 32; t++) events.push(ev(60 + (t % 3), t, 1));
    const phrases = detectPhrases({measures, events, slurs: [{start: 0, end: 19.5}]});
    expect(phrases[0]).toEqual({first: 0, last: 4}); // a five-bar slur, not the default four-bar cut
    // A slur over only two bars is too weak to end a phrase on its own.
    expect(detectPhrases({measures, events, slurs: [{start: 0, end: 7.5}]})[0]).toEqual({first: 0, last: 3});
  });

  test('a pickup joins the first phrase', () => {
    const measures = bars(5).map((m, i) => (i === 0 ? {...m, pickup: true, label: 'Pickup'} : m));
    const events = [];
    for (let t = 0; t < 20; t++) events.push(ev(60 + (t % 4), t, 1));
    expect(detectPhrases({measures, events})[0]).toEqual({first: 0, last: 4});
  });

  test('phraseAt and nextPhrase', () => {
    const ps = [{first: 0, last: 3}, {first: 4, last: 7}];
    expect(phraseAt(ps, 5)).toEqual(ps[1]);
    expect(nextPhrase(ps, 3)).toEqual(ps[1]);
    expect(nextPhrase(ps, 1)).toEqual(ps[1]);
    expect(nextPhrase(ps, 7)).toBeNull();
    expect(detectPhrases({})).toEqual([]);
  });
});

describe('rhythm variations', () => {
  const run = () => [0, .5, 1, 1.5, 2, 2.5, 3, 3.5].map((t, i) => ev(60 + i, t, .5));

  test('dotted: long-short pairs (3:1)', () => {
    const evs = run();
    const c = rhythmVariation(evs, 'dotted');
    expect(evs.map(e => c.get(e.id).t)).toEqual([0, .75, 1, 1.75, 2, 2.75, 3, 3.75]);
    expect(c.get(evs[0].id).d).toBe(.75);
    expect(c.get(evs[1].id).d).toBe(.25);
  });

  test('reversed dotted: short-long pairs (1:3)', () => {
    const evs = run();
    const c = rhythmVariation(evs, 'reversed');
    expect(evs.map(e => c.get(e.id).t)).toEqual([0, .25, 1, 1.25, 2, 2.25, 3, 3.25]);
  });

  test('leaves short runs, long notes and the other hand alone', () => {
    const evs = [ev(60, 0, .5), ev(62, .5, .5), ev(64, 1, .5), ev(48, 0, 4, 'l'), ev(65, 2, 2)];
    expect(rhythmVariation(evs, 'dotted').size).toBe(0);
    expect(rhythmVariation(run(), 'nope').size).toBe(0);
  });

  test('applyTiming regroups a passage', () => {
    const score = {measures: bars(1), events: run()};
    const p = passage(score, 0, 0);
    const v = applyTiming(p, rhythmVariation(p.events, 'dotted'));
    expect(v.groups.map(g => g.t)).toEqual([0, .75, 1, 1.75, 2, 2.75, 3, 3.75]);
    expect(p.groups.map(g => g.t)[1]).toBe(.5); // original untouched
    expect(applyTiming(p, new Map())).toBe(p);
  });
});

describe('blocked chords', () => {
  test('an Alberti bass becomes one chord per beat', () => {
    const measures = bars(1);
    // C G E G per beat, in sixteenths (0.25), left hand; melody in the right.
    const evs = [];
    for (let b = 0; b < 4; b++) [48, 55, 52, 55].forEach((n, k) => evs.push(ev(n, b + k * .25, .25, 'l')));
    evs.push(ev(72, 0, 4));
    const c = blockChords(evs, measures);
    const p = applyTiming(passage({measures, events: evs}, 0, 0), c);
    expect(p.groups.map(g => [g.t, g.notes.sort()])).toEqual([[0, [48, 52, 55, 72]], [1, [48, 52, 55]], [2, [48, 52, 55]], [3, [48, 52, 55]]]);
    expect([...c.values()].filter(x => x.drop).length).toBe(4); // the repeated G
  });

  test('two-beat figures in eighths, and scales are left alone', () => {
    const measures = bars(1, 3, {count: 3, unit: 4});
    const evs = [48, 55, 52, 55, 60, 55].map((n, k) => ev(n, k * .5, .5, 'l'));
    const c = blockChords(evs, measures);
    expect(c.get(evs[0].id)).toEqual({t: 0, d: 2}); // C G E G over two beats
    const scale = [60, 62, 64, 65, 67, 69, 71, 72].map((n, k) => ev(n, k * .5, .5));
    expect(blockChords(scale, bars(1)).size).toBe(0);
  });
});

describe('tempo ladder and best tempo', () => {
  test('ladder rungs and steps', () => {
    expect(ladderRungs(100)).toEqual([60, 70, 80, 90, 100]);
    expect(ladderRungs(30)).toEqual([20, 23, 25, 28, 30]);
    expect(ladderNext(60, 100, 98)).toBe(70);
    expect(ladderNext(65, 100, 98)).toBe(70);
    expect(ladderNext(60, 100, 80)).toBe(60);
    expect(ladderNext(100, 100, 100)).toBe(100);
  });

  test('records the best clean tempo and suggests the next step', () => {
    let r = recordBest({}, '0-3', 66, 97);
    expect(r).toEqual({bests: {'0-3': 66}, improved: true});
    expect(recordBest(r.bests, '0-3', 60, 100).improved).toBe(false);
    expect(recordBest(r.bests, '0-3', 80, 90).improved).toBe(false);
    r = recordBest(r.bests, '0-3', 70, 100);
    expect(r.bests['0-3']).toBe(70);
    expect(nextTempoStep(66, 100)).toBe(69);
    expect(nextTempoStep(30, 100)).toBe(32);
    expect(nextTempoStep(98, 100)).toBe(100);
    expect(nextTempoStep(104, 100)).toBe(100);
    expect(nextTempoStep(null, 100)).toBeNull();
  });
});

describe('evenness', () => {
  // A two-octave scale at 500 ms per quarter (eighths = 250 ms), 120 ms late overall.
  const scale = (jitter = () => 0, vel = () => 70) => Array.from({length: 16}, (_, i) =>
    ({n: 60 + i, t: i * .5, at: 1000 + 120 + i * 250 + jitter(i), velocity: vel(i), hand: 'r', measure: Math.floor(i / 8)}));

  test('fitLine', () => {
    expect(fitLine([{x: 0, y: 1}, {x: 1, y: 3}, {x: 2, y: 5}])).toEqual({a: 1, b: 2});
    expect(fitLine([{x: 1, y: 1}])).toBeNull();
  });

  test('a perfectly even run scores 100, whatever the delay', () => {
    const e = evenness(scale());
    expect(e.score).toBe(100);
    expect(e.timingSdMs).toBe(0);
    expect(e.msPerQuarter).toBe(500);
    expect(e.points).toHaveLength(16);
    expect(evennessRemark(e)).toBe('Even and controlled.');
  });

  test('uneven timing and velocity lower the score', () => {
    const e = evenness(scale(i => (i % 2 ? 30 : -30), i => (i % 2 ? 60 : 80)));
    expect(e.timingSdMs).toBeCloseTo(30, 0);
    expect(e.velocitySd).toBe(10);
    expect(e.score).toBeLessThan(70);
  });

  test('one late note is named', () => {
    const e = evenness(scale(i => (i === 10 ? 60 : 0)));
    expect(e.score).toBeLessThan(100);
    expect(evennessRemark(e, bars(2))).toBe('A little uneven in bar 2: one note came late.');
  });

  test('a heavier hand is named', () => {
    const notes = [...scale(), ...scale().map(p => ({...p, n: p.n - 12, hand: 'l', velocity: 85}))];
    expect(evennessRemark(evenness(notes))).toBe('Left hand a touch heavier than the right.');
  });

  test('too few notes → null', () => {
    expect(evenness(scale().slice(0, 3))).toBeNull();
    expect(evennessRemark(null)).toBeNull();
  });
});

describe('dynamics', () => {
  test('levels and names', () => {
    expect(dynamicLevel('p')).toBe(50);
    expect(dynamicLevel(' ff ')).toBe(106);
    expect(dynamicLevel('sfz')).toBeNull();
    expect(velocityName(80)).toBe('mf');
    expect(velocityName(10)).toBe('ppp');
  });

  test('markAt finds the level in force', () => {
    const marks = [{t: 0, mark: 'p', staff: 1}, {t: 8, mark: 'f', staff: 1}];
    expect(markAt(marks, 4, 1).mark).toBe('p');
    expect(markAt(marks, 8, 1).mark).toBe('f');
    expect(markAt(marks, 8, 2).mark).toBe('f'); // staff 2 has none: the top staff's mark applies
    expect(markAt([], 1, 1)).toBeNull();
  });

  const measures = bars(4);
  const notes = (from, to, velocity, hand = 'r') => {
    const out = [];
    for (let t = from; t < to; t++) out.push({t, measure: Math.floor(t / 4), velocity, hand, staff: hand === 'l' ? 2 : 1});
    return out;
  };

  test('a forte that does not stand out is noticed', () => {
    const r = dynamicsReport([...notes(0, 8, 70), ...notes(8, 16, 72)], {marks: [{t: 0, mark: 'p', staff: 1}, {t: 8, mark: 'f', staff: 1}], measures});
    expect(r.marks.map(m => [m.mark, m.bars])).toEqual([['p', 'bars 1–2'], ['f', 'bars 3–4']]);
    expect(r.remarks[0]).toBe('The f in bars 3–4 could step out more from the p before it.');
  });

  test('a good contrast leaves no remark; absolute level is checked otherwise', () => {
    const good = dynamicsReport([...notes(0, 8, 50), ...notes(8, 16, 92)], {marks: [{t: 0, mark: 'p'}, {t: 8, mark: 'f'}], measures, hands: 'right'});
    expect(good.remarks).toEqual([]);
    const loud = dynamicsReport(notes(0, 8, 95), {marks: [{t: 0, mark: 'p'}], measures, hands: 'right'});
    expect(loud.remarks[0]).toBe('Bars 1–2, marked p, came out nearer f.');
  });

  test('a flat crescendo is noticed', () => {
    const r = dynamicsReport(notes(0, 8, 60), {hairpins: [{t: 0, end: 8, form: 'cres'}], measures, hands: 'right'});
    expect(r.hairpins[0]).toMatchObject({form: 'cres', change: 0});
    expect(r.remarks[0]).toBe('The crescendo in bars 1–2 stayed rather level.');
    const grows = dynamicsReport(notes(0, 8, 0).map((p, i) => ({...p, velocity: 50 + i * 4})), {hairpins: [{t: 0, end: 8, form: 'cres'}], measures, hands: 'right'});
    expect(grows.remarks).toEqual([]);
  });

  test('hand balance: a heavy left hand', () => {
    const r = dynamicsReport([...notes(0, 16, 64), ...notes(0, 8, 64, 'l'), ...notes(8, 16, 80, 'l')], {measures});
    expect(r.balance.heavy).toBe('bars 3–4');
    expect(r.remarks[0]).toBe('Left hand a touch heavy in bars 3–4.');
    expect(dynamicsReport(notes(0, 2, 60), {measures})).toBeNull();
  });
});

describe('articulation', () => {
  const line = (gap, extra = {}) => Array.from({length: 6}, (_, i) =>
    ({t: i, d: 1, qms: 500, at: i * 500, off: (i + 1) * 500 - gap, hand: 'r', measure: 0, ...extra}));

  test('legato line: overlap is good, gaps are detached', () => {
    expect(articulationReport(line(-20), {legato: true})).toMatchObject({legatoPairs: 5, detachedPairs: 0, overlapMs: 20, remarks: []});
    const r = articulationReport(line(80), {legato: true, measures: bars(1)});
    expect(r.detachedPairs).toBe(5);
    expect(r.remarks[0]).toBe('The line in bar 1 came out a little detached: join them.');
  });

  test('only slurred notes count when not legato', () => {
    expect(articulationReport(line(80), {slurs: []}).legatoPairs).toBe(0);
    expect(articulationReport(line(80), {slurs: [{start: 0, end: 2}]}).legatoPairs).toBe(2);
  });

  test('staccato notes held too long', () => {
    const r = articulationReport(line(20, {stacc: true}), {measures: bars(1)});
    expect(r.staccato).toEqual({count: 6, held: 6});
    expect(r.remarks[0]).toBe('The staccato notes in bar 1 are held a little long.');
    expect(articulationReport(line(300, {stacc: true})).staccato.held).toBe(0);
    expect(articulationReport([])).toBeNull();
  });
});

describe('pedal', () => {
  test('marks caught within a beat', () => {
    const marks = [{t: 0, dir: 'down'}, {t: 4, dir: 'bounce'}, {t: 7.5, dir: 'up'}, {t: 8, dir: 'down'}];
    expect(pedalReport([{pos: .2, down: true}, {pos: 3.9, down: false}, {pos: 4.3, down: true}], marks)).toMatchObject({marks: 3, caught: 2, presses: 2, remark: null});
    expect(pedalReport([], marks).remark).toMatch(/none was used/);
    expect(pedalReport([{pos: 20, down: true}], marks).remark).toMatch(/missed/);
    expect(pedalReport([{pos: 0, down: true}], []).remark).toBeNull();
  });
});

describe('latency', () => {
  const clicks = Array.from({length: 8}, (_, i) => 1000 + i * 600);
  test('median offset of taps against clicks, skipping the run-in', () => {
    const taps = clicks.map((c, i) => c + 80 + (i % 2 ? 10 : -10));
    expect(measureLatency(clicks, taps)).toEqual({ms: 80, spread: 10, n: 6});
  });
  test('ignores stray taps and needs enough of them', () => {
    const taps = [...clicks.slice(2).map(c => c + 50), 1000 + 2 * 600 + 300];
    expect(measureLatency(clicks, taps).ms).toBe(50);
    expect(measureLatency(clicks, [clicks[3] + 40])).toBeNull();
    expect(measureLatency([1000], [1000])).toBeNull();
  });
  test('clampLatency', () => {
    expect([clampLatency(1000), clampLatency(-500), clampLatency('42.4'), clampLatency('x')]).toEqual([400, -100, 42, 0]);
  });
});

describe('pages', () => {
  const boxes = [{x0: 40, x1: 300}, {x0: 300, x1: 520}, {x0: 520, x1: 800}, {x0: 800, x1: 1500}, {x0: 1500, x1: 1700}];
  test('paginate fits whole measures to the width', () => {
    expect(paginate(boxes, 600)).toEqual([
      {first: 0, last: 1, x0: 0, x1: 520},
      {first: 2, last: 2, x0: 520, x1: 800},
      {first: 3, last: 3, x0: 800, x1: 1500},
      {first: 4, last: 4, x0: 1500, x1: 1700},
    ]);
  });
  test('turns a beat early', () => {
    const pages = paginate(boxes, 600), measures = bars(5);
    expect(pageOf(pages, 1)).toBe(0);
    expect(pageAtTime(pages, measures, 6.5)).toBe(0);
    expect(pageAtTime(pages, measures, 7)).toBe(1); // one beat before bar 3
    expect(pageAtTime(pages, measures, 7, 0)).toBe(0);
    expect(pageAtTime(pages, measures, 99)).toBe(3);
    expect(pageAtTime([], measures, 1)).toBe(0);
  });
});

test('barsText', () => {
  const m = bars(3);
  expect(barsText(m, 0)).toBe('bar 1');
  expect(barsText(m, 0, 2)).toBe('bars 1–3');
  expect(barsText([{label: 'Pickup', pickup: true}, {label: '1'}], 0, 1)).toBe('bars pickup–1');
});
