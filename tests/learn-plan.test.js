import {describe, expect, test} from 'vitest';

import {
  barsLabel, buildPlan, currentStep, goalTempo, isSetUp, listenMeets, listenSpan, planProgress, resultMeets, stepText, PASS,
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
    expect(by('0-7:join')).toMatchObject({section: [0, 7], tempo: 100, phrase: 1});
    expect(stepText(by('4-7:left'))).toBe('Left hand alone · Phrase 2 of 2 · Bars 5–8');
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

  test('a repeat played again is skipped, but the phrase after it joins to the repeat', () => {
    const m = bars(12).map((b, i) => ({...b, visit: i >= 4 && i < 8 ? 2 : 1}));
    const p = buildPlan({phrases: [{first: 0, last: 3}, {first: 4, last: 7}, {first: 8, last: 11}], measures: m, events: both(12)}, {target: 100});
    expect(p.filter(s => s.kind === 'listen').map(s => s.key)).toEqual(['0-3:listen', '8-11:listen']);
    expect(p.filter(s => s.kind === 'join').map(s => s.key)).toEqual(['4-11:join']);
    expect(p.at(-1).key).toBe('0-11:whole');
    expect(p[0].detail).toBe('Phrase 1 of 2 · Bars 1–4');
    expect(p[0].hint).toBeTruthy();
  });

  test('no phrases, no plan', () => {
    expect(buildPlan({phrases: []})).toEqual([]);
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
