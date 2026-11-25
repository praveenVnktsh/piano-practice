import {describe, expect, test} from 'vitest';

import {
  barsLabel, buildPlan, groupPassages, planPassages, repeatRuns, stepTitle, currentStep, goalTempo, isSetUp, listenMeets, listenSpan, planProgress, resultMeets, stepText, PASS,
} from '../src/learn/plan.mjs';
import {startingKeys} from '../src/learn/position.mjs';
import {appendEvents, emptyDoc, normalizeDoc, sanitizeEvent} from '../src/progress/model.js';

const bars = (n, len = 4) => Array.from({length: n}, (_, i) => ({id: 'm' + i, label: String(i + 1), index: i, start: i * len, end: (i + 1) * len, meter: {count: 4, unit: 4}}));
let uid = 0;
const ev = (n, t, d = 1, hand = 'r') => ({id: 'e' + uid++, n, t, d, hand});
// Both hands in every bar.
const both = n => Array.from({length: n * 4}, (_, t) => [ev(60 + (t % 5), t), ev(48, t, 1, 'l')]).flat();

describe('buildPlan', () => {
  const measures = bars(8), events = both(8);
  const phrases = [{first: 0, last: 3}, {first: 4, last: 7}];
  const plan = buildPlan({phrases, measures, events}, {target: 100});

  test('each phrase walks listen → right → left → slow → tempo, later phrases join the one before, then the whole piece', () => {
    expect(plan.map(s => s.key)).toEqual([
      '0-3:listen', '0-3:right', '0-3:left', '0-3:slow', '0-3:tempo',
      '4-7:listen', '4-7:right', '4-7:left', '4-7:slow', '4-7:tempo', '0-7:join',
      '0-7:whole',
    ]);
  });

  test('steps carry what the player needs: section, hands, mode, intent, tempo, strategy', () => {
    const by = k => plan.find(s => s.key === k);
    expect(by('0-3:listen')).toMatchObject({section: [0, 3], hands: 'both', intent: 'listen', tempo: 100});
    expect(by('0-3:right')).toMatchObject({hands: 'right', mode: 'wait', intent: 'practice'});
    expect(by('0-3:slow')).toMatchObject({hands: 'both', mode: 'timed', tempo: 60, strategy: 'off'});
    expect(by('0-3:tempo')).toMatchObject({tempo: 60, goal: 100, strategy: 'ladder'});
    expect(goalTempo(by('0-3:tempo'))).toBe(100);
    expect(by('0-7:join')).toMatchObject({section: [0, 7], tempo: 100, passage: 1});
    expect(stepText(by('4-7:left'))).toBe('Left hand · Passage 2 of 2 · Bars 5–8');
    expect(stepTitle(by('4-7:left'))).toBe('Passage 2 of 2 · Left hand');
    expect(stepTitle(by('0-7:whole'))).toBe('The whole piece');
  });

  test('a phrase with one hand only skips the hands-separate steps; one phrase has no join or whole step', () => {
    const rh = Array.from({length: 16}, (_, t) => ev(60, t));
    const p = buildPlan({phrases: [{first: 0, last: 3}], measures: bars(4), events: rh}, {target: 80});
    expect(p.map(s => s.kind)).toEqual(['listen', 'slow', 'tempo']);
  });

  test('a very slow target needs no separate "up to tempo" step', () => {
    const p = buildPlan({phrases: [{first: 0, last: 1}], measures: bars(2), events: both(2)}, {target: 20});
    expect(p.map(s => s.kind)).toEqual(['listen', 'right', 'left', 'slow']);
    expect(p.at(-1).tempo).toBe(20); // never below 20 BPM
  });

  test('a passage with the same notes as an earlier one is one quick "play it through" step', () => {
    // Bars 9–12 replay bars 1–4 note for note.
    const evs = [];
    for (let t = 0; t < 48; t++) { const b = Math.floor(t / 4), k = b >= 8 ? t - 32 : t; evs.push(ev(60 + (k % 7), t), ev(48 + (Math.floor(k / 4) % 3), t, 1, 'l')); }
    const p = buildPlan({phrases: [{first: 0, last: 3}, {first: 4, last: 7}, {first: 8, last: 11}], measures: bars(12), events: evs}, {target: 100});
    const third = p.filter(s => s.section[0] === 8 && s.kind !== 'whole');
    expect(third.map(s => s.key)).toEqual(['8-11:through']);
    expect(third[0]).toMatchObject({same: 0, hands: 'both', mode: 'timed', tempo: 100, label: 'Play it through'});
    expect(third[0].detail).toBe('Bars 9–12 · same as passage 1');
    expect(stepTitle(third[0])).toBe('Same as passage 1 · Play it through');
    // Numbered among the new music: two passages, not three.
    expect(p[0].detail).toBe('Passage 1 of 2 · Bars 1–4');
    expect(p.at(-1).key).toBe('0-11:whole');
    expect(p[0].hint).toBeTruthy();
  });

  test('no phrases, no plan', () => {
    expect(buildPlan({phrases: []})).toEqual([]);
  });
});

describe('groupPassages', () => {
  const ph = (...lens) => { let a = 0; return lens.map(n => { const p = {first: a, last: a + n - 1}; a += n; return p; }); };
  const len = ps => ps.map(p => p.last - p.first + 1);

  test('short phrases merge into passages of 4–8 bars at phrase ends', () => {
    expect(len(groupPassages(ph(2, 2, 2, 2, 4, 4), bars(16)))).toEqual([4, 4, 4, 4]);
    expect(len(groupPassages(ph(2, 3, 4, 2, 2), bars(13)))).toEqual([5, 4, 4]);
    expect(len(groupPassages(ph(4, 4, 4), bars(12)))).toEqual([4, 4, 4]);
  });

  test('a phrase longer than 8 bars is cut into near-equal parts; a short tail joins the passage before', () => {
    expect(len(groupPassages(ph(12), bars(12)))).toEqual([6, 6]);
    expect(len(groupPassages(ph(17), bars(17)))).toEqual([6, 5, 6]);
    expect(len(groupPassages(ph(4, 2), bars(6)))).toEqual([6]);
    expect(len(groupPassages(ph(8, 2), bars(10)))).toEqual([8, 2]); // can't fit: stays short
  });

  test('a pickup bar does not count', () => {
    const m = bars(9); m[0] = {...m[0], pickup: true};
    expect(len(groupPassages(ph(3, 2, 4), m))).toEqual([5, 4]); // pickup + 4 bars, then 4
  });

  test('a long minuet-like piece: 27 short phrases become a handful of passages', () => {
    const lens = Array.from({length: 27}, (_, i) => (i % 3 === 2 ? 4 : 2)).slice(0, 27);
    const total = lens.reduce((a, b) => a + b, 0);
    const out = groupPassages(ph(...lens), bars(total));
    expect(out.length).toBeLessThanOrEqual(Math.ceil(total / 4));
    expect(out.every(p => p.last - p.first + 1 >= 4 && p.last - p.first + 1 <= 8)).toBe(true);
  });
});

describe('repeats', () => {
  // 24 bars: A (1–8), A again (9–16), B (17–24); every bar differs within A and B.
  const tune = () => {
    const out = [];
    for (let b = 0; b < 24; b++) {
      const k = b >= 8 && b < 16 ? b - 8 : b;
      for (let q = 0; q < 4; q++) out.push(ev(60 + ((k * 3 + q) % 12), b * 4 + q), ev(36 + k, b * 4 + q, 1, 'l'));
    }
    return out;
  };
  const ph = n => Array.from({length: n / 2}, (_, i) => ({first: i * 2, last: i * 2 + 1}));

  test('repeatRuns finds a literal repeat of four bars or more', () => {
    expect(repeatRuns(bars(24), tune())).toEqual([{first: 8, last: 15, from: 0}]);
    expect(repeatRuns(bars(24), tune(), {min: 9})).toEqual([]);
    expect(repeatRuns(bars(4), [])).toEqual([]); // empty bars never match
  });

  test('planPassages: new music grouped from phrases, the repeat as one passage', () => {
    expect(planPassages(ph(24), bars(24), tune())).toEqual([
      {first: 0, last: 3}, {first: 4, last: 7}, {first: 8, last: 15, from: 0}, {first: 16, last: 19}, {first: 20, last: 23},
    ]);
  });

  test('the plan numbers new music only and gives the repeat one step', () => {
    const p = buildPlan({phrases: ph(24), measures: bars(24), events: tune()}, {target: 100});
    const rep = p.filter(s => s.kind === 'through');
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({section: [8, 15], same: 0});
    expect(stepTitle(p.find(s => s.key === '16-19:listen'))).toBe('Passage 3 of 4 · Listen');
    expect(p.find(s => s.key.endsWith('-19:join')).section).toEqual([8, 19]); // the repeat's last eight bars and passage 3
    expect(p.length).toBeLessThan(30);
  });
});

describe('step completion', () => {
  const measures = bars(8), events = both(8);
  const plan = buildPlan({phrases: [{first: 0, last: 3}, {first: 4, last: 7}], measures, events}, {target: 100});
  const by = k => plan.find(s => s.key === k);
  const result = o => ({section: [0, 3], hands: 'both', mode: 'timed', tempo: 100, accuracy: 95, ...o});

  test('hands-separate steps: the right hand, the bars, accuracy ≥ PASS, any tempo or mode', () => {
    const right = by('0-3:right');
    expect(resultMeets(right, result({hands: 'right', mode: 'wait', tempo: 40}))).toBe(true);
    expect(resultMeets(right, result({hands: 'right', accuracy: PASS - 1}))).toBe(false);
    expect(resultMeets(right, result({hands: 'left'}))).toBe(false);
    expect(resultMeets(right, result({hands: 'right', section: [1, 3]}))).toBe(false); // doesn't cover bar 1
    expect(resultMeets(right, result({hands: 'right', section: [0, 7]}))).toBe(true);  // covers more: fine
  });

  test('play-along steps need both hands, play along, and the step tempo (−1 BPM)', () => {
    const slow = by('0-3:slow');
    expect(resultMeets(slow, result({tempo: 60}))).toBe(true);
    expect(resultMeets(slow, result({tempo: 59}))).toBe(true);
    expect(resultMeets(slow, result({tempo: 55}))).toBe(false);
    expect(resultMeets(slow, result({tempo: 60, mode: 'wait'}))).toBe(false);
    expect(resultMeets(slow, result({tempo: 60, hands: 'right'}))).toBe(false);
    const tempo = by('0-3:tempo');
    expect(resultMeets(tempo, result({tempo: 80}))).toBe(false);
    expect(resultMeets(tempo, result({tempo: 100}))).toBe(true);
    expect(resultMeets(by('0-7:join'), result({section: [0, 7]}))).toBe(true);
    expect(resultMeets(by('0-7:join'), result({section: [4, 7]}))).toBe(false);
  });

  test('listen steps are done by a finished listen that covers the bars, never by a result', () => {
    const listen = by('0-3:listen');
    expect(listenMeets(listen, [0, 3])).toBe(true);
    expect(listenMeets(listen, [0, 7])).toBe(true);
    expect(listenMeets(listen, [0, 2])).toBe(false);
    expect(resultMeets(listen, result())).toBe(false);
    expect(listenMeets(by('0-3:right'), [0, 3])).toBe(false);
  });

  test('the current step is the first not done; progress counts the done ones', () => {
    expect(currentStep(plan, []).key).toBe('0-3:listen');
    const done = new Set(['0-3:listen', '0-3:right']);
    expect(currentStep(plan, done).key).toBe('0-3:left');
    expect(planProgress(plan, done)).toEqual({done: 2, total: 12, index: 2});
    // Keys from an older plan (other phrases) don't count.
    expect(planProgress(plan, ['9-12:listen']).done).toBe(0);
    expect(currentStep(plan, plan.map(s => s.key))).toBeNull();
    expect(planProgress(plan, plan.map(s => s.key)).index).toBe(12);
  });

  test('isSetUp: the player already has the step’s bars, hands and mode', () => {
    const left = by('0-3:left');
    expect(isSetUp(left, {section: [0, 3], hands: 'left', mode: 'wait'})).toBe(true);
    expect(isSetUp(left, {section: [0, 3], hands: 'both', mode: 'wait'})).toBe(false);
    expect(isSetUp(left, {section: [0, 4], hands: 'left', mode: 'wait'})).toBe(false);
    expect(isSetUp(by('0-3:listen'), {section: [0, 3], hands: 'right', mode: 'timed'})).toBe(true);
    expect(isSetUp(left, null)).toBe(false);
  });
});

describe('helpers', () => {
  test('barsLabel speaks like the player', () => {
    const m = bars(4);
    expect(barsLabel(m, 0, 3)).toBe('Bars 1–4');
    expect(barsLabel(m, 2, 2)).toBe('Bar 3');
    const pick = [{label: 'Pickup', pickup: true}, {label: '1'}, {label: '2'}];
    expect(barsLabel(pick, 0, 2)).toBe('Pickup – bar 2');
    expect(barsLabel(pick, 0, 0)).toBe('The pickup');
  });

  test('listenSpan: whole bars for about thirty seconds, at least one', () => {
    // 4/4 at ♩ = 60: 4 s a bar → 7 bars is 28 s; 8 would be 32 s.
    expect(listenSpan(bars(20), 60)).toEqual([0, 6]);
    expect(listenSpan(bars(3), 60)).toEqual([0, 2]);
    expect(listenSpan(bars(20, 40), 60)).toEqual([0, 0]);
    expect(listenSpan([], 60)).toEqual([0, 0]);
  });

  test('startingKeys: the first five pitches of each hand, carried notes and the other hand left out', () => {
    const events = [
      {n: 72, t: -1, hand: 'r', carried: true},
      ...[60, 62, 64, 62, 65, 67, 69].map((n, t) => ({n, t, hand: 'r'})),
      ...[48, 55].map((n, t) => ({n, t, hand: 'l'})),
    ];
    const both = startingKeys(events);
    expect([...both.keys()]).toEqual([48, 55, 60, 62, 64, 65, 67]);
    expect(both.get(48)).toBe('l');
    expect(both.get(60)).toBe('r');
    expect([...startingKeys(events, {hands: 'left'}).keys()]).toEqual([48, 55]);
    expect([...startingKeys(events, {hands: 'right', perHand: 2}).keys()]).toEqual([60, 62]);
  });
});

describe('learn:step in the progress document', () => {
  const at = Date.UTC(2026, 10, 20, 9);
  const step = (o, i = 0) => sanitizeEvent({type: 'learn:step', id: 'learn' + i + 'x', songId: 'fur-elise', title: 'Für Elise', total: 12, at: at + i * 1000, tz: 0, ...o}, at + 1e9);

  test('sanitizeEvent validates actions and step keys', () => {
    expect(step({action: 'start', next: {key: '0-3:listen', label: 'Listen · Bars 1–4'}})).toMatchObject({action: 'start', total: 12, next: {key: '0-3:listen'}});
    expect(step({action: 'done', key: '0-3:listen', next: null})).toMatchObject({key: '0-3:listen', next: null});
    expect(step({action: 'done'})).toBeNull();                     // a done step needs its key
    expect(step({action: 'done', key: '<script>'})).toBeNull();
    expect(step({action: 'jump'})).toBeNull();
    expect(step({action: 'start', songId: ''})).toBeNull();
    expect(step({action: 'start', next: {key: 'nope', label: 'x'}}).next).toBeNull();
  });

  test('totals.learn keeps each plan: active, done steps, the next step; not practice time', () => {
    const doc = emptyDoc();
    appendEvents(doc, [
      step({action: 'start', next: {key: '0-3:listen', label: 'Listen'}}, 0),
      step({action: 'done', key: '0-3:listen', next: {key: '0-3:right', label: 'Right hand alone'}}, 1),
      step({action: 'done', key: '0-3:right', next: {key: '0-3:left', label: 'Left hand alone'}}, 2),
    ]);
    expect(doc.totals.learn['fur-elise']).toMatchObject({
      title: 'Für Elise', active: true, done: ['0-3:listen', '0-3:right'], total: 12, next: {key: '0-3:left'}, startedAt: at,
    });
    expect(doc.totals.days).toEqual({});
    appendEvents(doc, [step({action: 'stop', next: {key: '0-3:left', label: 'Left'}}, 3)]);
    expect(doc.totals.learn['fur-elise'].active).toBe(false);
    expect(doc.totals.learn['fur-elise'].done).toHaveLength(2);
    // A late, older "done" still counts its step but doesn't change the plan's state.
    appendEvents(doc, [step({action: 'done', key: '0-3:slow', next: null}, -5)]);
    expect(doc.totals.learn['fur-elise']).toMatchObject({active: false, next: {key: '0-3:left'}});
    expect(doc.totals.learn['fur-elise'].done).toContain('0-3:slow');
  });

  test('normalizeDoc keeps totals.learn and rebuilds it from raw events', () => {
    const doc = emptyDoc();
    appendEvents(doc, [step({action: 'start', next: {key: '0-3:listen', label: 'Listen'}})]);
    expect(normalizeDoc(JSON.parse(JSON.stringify(doc))).totals.learn['fur-elise'].active).toBe(true);
    const {totals, ...raw} = JSON.parse(JSON.stringify(doc));
    expect(totals).toBeTruthy();
    expect(normalizeDoc(raw).totals.learn['fur-elise'].active).toBe(true);
  });
});
