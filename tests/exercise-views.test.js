// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseRoute} from '../src/app/router.js';
import {mountRhythmTrainer} from '../src/rhythm/view.js';
import {mountTheory, mountTheoryLesson, loadTheory} from '../src/theory/view.js';
import {mountEarTrainer} from '../src/ear/view.js';
import {mountSightReading} from '../src/sightread/view.js';
import {generateRhythm} from '../src/rhythm/patterns.js';
import {LESSONS} from '../src/theory/lessons.js';

const note = (n, time) => window.dispatchEvent(new CustomEvent('piano:note', {detail: {note: n, velocity: 80, source: 'midi', time: time ?? performance.now()}}));
const click = el => el.dispatchEvent(new MouseEvent('click', {bubbles: true}));

describe('routes', () => {
  it('parses the new exercise routes', () => {
    expect(parseRoute('#/exercises/sight-reading')).toEqual({name: 'sight-reading'});
    expect(parseRoute('#/exercises/rhythm')).toEqual({name: 'rhythm'});
    expect(parseRoute('#/exercises/theory')).toEqual({name: 'theory'});
    expect(parseRoute('#/exercises/theory/intervals')).toEqual({name: 'theory-lesson', arg: 'intervals'});
    expect(parseRoute('#/exercises/theory/intervals/')).toEqual({name: 'theory-lesson', arg: 'intervals'});
    expect(parseRoute('#/exercises/ear')).toEqual({name: 'ear'});
    expect(parseRoute('#/play/sr%3Agrade-1%3A5')).toEqual({name: 'play', id: 'sr:grade-1:5'});
    expect(parseRoute('#/exercises/theory/Bad Id')).toEqual({name: 'today'});
  });
});

describe('exercise views', () => {
  let results, view;
  const onResult = e => results.push(e.detail);
  beforeEach(() => {
    const data = new Map();
    vi.stubGlobal('localStorage', {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), clear: () => data.clear()});
    results = [];
    window.addEventListener('trainer:result', onResult);
  });
  afterEach(() => {
    view?.destroy(); view = null;
    window.removeEventListener('trainer:result', onResult);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('rhythm: taps on time through a round give a clean result', () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date']});
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const seed = Math.floor(.5 * 0xffffff) + 1;
    view = mountRhythmTrainer(document.body);
    const primary = document.querySelector('.rh-primary');
    expect(primary.textContent).toBe('Start');
    expect(document.querySelectorAll('.rh-staff .eg-ev').length).toBeGreaterThan(2);
    for (let k = 0; k < 4; k++) {
      const p = generateRhythm('crotchets', seed);
      const qms = 60000 / 80;
      const t0 = performance.now();
      click(primary);
      const startAt = t0 + 250 + 4 * qms;
      for (const o of p.onsets) {
        vi.advanceTimersByTime(startAt + o * qms - performance.now());
        note(60, performance.now() + 30); // 30 ms late: still "on time"
      }
      vi.advanceTimersByTime(startAt + 8 * qms + 1000 - performance.now());
      expect(document.querySelector('.rh-status').textContent).toBe('Clean.');
      expect(document.querySelectorAll('.rh-staff .eg-ev.is-perfect').length).toBe(p.onsets.length);
      click(primary); // Next rhythm / See results
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({level: 'rhythm:crotchets', wrong: 0, accuracy: 100, avgMs: 30});
    expect(document.querySelector('.rh-results').hidden).toBe(false);
  });

  it('rhythm: no taps are all misses', () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date']});
    view = mountRhythmTrainer(document.body);
    click(document.querySelector('.rh-primary'));
    vi.advanceTimersByTime(20000);
    expect(document.querySelector('.rh-status').dataset.tone).toBe('bad');
    expect(document.querySelectorAll('.rh-staff .eg-ev.is-miss').length).toBeGreaterThan(0);
  });

  it('theory: cards, then questions answered on the keys or by choice, then a result', () => {
    const lesson = LESSONS.find(l => l.id === 'key-signatures');
    view = mountTheoryLesson(document.body, {lesson: lesson.id});
    expect(view.title).toBe('Key signatures');
    for (let i = 0; i < lesson.cards.length; i++) {
      expect(document.querySelector('.th-eyebrow').textContent).toBe(`${i + 1} of ${lesson.cards.length}`);
      if (lesson.cards[i].widget) expect(document.querySelectorAll('.th-ck')).toHaveLength(12);
      click(document.querySelector('.th-next'));
    }
    let asked = 0;
    while (document.querySelector('.th-question')) {
      asked++;
      const choice = document.querySelector('.th-choice');
      if (choice) click(choice);
      else for (let n = 60; n < 72 && document.querySelector('.th-next').hidden; n++) note(n);
      expect(document.querySelector('.th-feedback').textContent).toMatch(/^(Right|Not quite)\./);
      click(document.querySelector('.th-next'));
    }
    expect(asked).toBeGreaterThanOrEqual(5);
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe('theory:key-signatures');
    expect(results[0].right + results[0].wrong).toBe(asked);
    expect(loadTheory().lessons['key-signatures'].attempts).toBe(1);
    expect(document.querySelector('.th-results')).toBeTruthy();
  });

  it('theory: the list and an unknown lesson', () => {
    view = mountTheory(document.body);
    expect(document.querySelectorAll('.th-item')).toHaveLength(LESSONS.length);
    view.destroy();
    view = mountTheoryLesson(document.body, {lesson: 'nope'});
    expect(document.body.textContent).toContain('No such lesson');
  });

  it('ear: a round of interval questions, answered by choice and by playing', () => {
    vi.useFakeTimers();
    view = mountEarTrainer(document.body);
    expect(document.querySelectorAll('.ear-kind')).toHaveLength(4);
    let n = 0;
    while (document.querySelector('.ear-card')) {
      if (n % 2) click(document.querySelector('.th-choice'));
      else { note(60); note(60 + {M2: 2, M3: 4, P5: 7, P8: 12}[document.querySelector('.th-choice').dataset.id]); }
      click(document.querySelector('.th-next'));
      vi.advanceTimersByTime(300);
      n++;
    }
    expect(n).toBe(10);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({level: 'ear:int-1'});
    expect(results[0].right + results[0].wrong).toBe(10);
  });

  it('ear: melodies are played back', () => {
    vi.useFakeTimers();
    localStorage.setItem('piano-practice.ear', JSON.stringify({kind: 'melodies'}));
    view = mountEarTrainer(document.body);
    expect(document.querySelector('.th-choice')).toBeNull();
    expect(document.querySelector('.kb-keys')).toBeTruthy();
    note(1); // a wrong first note
    expect(document.querySelector('.th-feedback').dataset.tone).toBe('bad');
  });

  it('sight-reading: opens a new piece at the chosen level', () => {
    const open = vi.fn();
    view = mountSightReading(document.body, {open});
    click(document.querySelector('[data-level="grade-3"]'));
    click(document.querySelector('.sr-start'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^sr:grade-3:\d+$/));
    expect(JSON.parse(localStorage.getItem('piano-practice.sight-reading')).level).toBe('grade-3');
  });
});
